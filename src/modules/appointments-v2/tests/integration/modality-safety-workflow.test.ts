import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import {
  canReachDatabase,
  createTestApp,
  createTestAuthCookie,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
  type TestData,
} from "./helpers.js";

const skip = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const PREFIX = "MRI_SAFE_";

describe("modality safety workflow — integration", { skip }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(PREFIX);
    testData = await seedTestData(testDb.schemaName, PREFIX);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "super_admin");
  });

  after(async () => {
    if (!testData) return;
    await app.close();
    await testDb.cleanup();
  });

  async function setWorkflow(
    workflow: "standard_acknowledgement" | "mri_primary_implant_screening",
    warningEn: string | null = "Mandatory safety warning"
  ) {
    await pool.query(
      `update modalities set safety_warning_enabled = true, safety_warning_en = $2, safety_warning_ar = null, safety_workflow_type = $3 where id = $1`,
      [testData.modalityId, warningEn, workflow]
    );
  }

  async function create(body: Record<string, unknown>) {
    return fetch(`${app.baseUrl}/api/v2/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie },
      body: JSON.stringify({
        patientId: testData.patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: "2027-01-06",
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
        ...body,
      }),
    }).then(async (response) => ({ status: response.status, data: await response.json() as Record<string, any> }));
  }

  it("rejects a missing standard acknowledgement and accepts a valid one", async () => {
    await setWorkflow("standard_acknowledgement");
    const rejected = await create({ bookingDate: "2027-01-06" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.data.details?.code, "MODALITY_SAFETY_ACKNOWLEDGEMENT_REQUIRED");

    const accepted = await create({ bookingDate: "2027-01-07", modalitySafetyAcknowledged: true });
    assert.equal(accepted.status, 201);
  });

  it("requires MRI screening and an implant site when an implant is reported", async () => {
    await setWorkflow("mri_primary_implant_screening");
    const missing = await create({ bookingDate: "2027-01-08", modalitySafetyAcknowledged: true });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.details?.code, "MRI_PRIMARY_SCREENING_REQUIRED");

    const missingSite = await create({
      bookingDate: "2027-01-08",
      modalitySafetyAcknowledged: true,
      mriPrimaryScreening: { result: "implant_reported_review_required", implantSite: null },
    });
    assert.equal(missingSite.status, 400);
    assert.equal(missingSite.data.details?.code, "MRI_IMPLANT_SITE_REQUIRED");
  });

  it("persists valid no-implant screening with server-generated actor and timestamp and returns it in details", async () => {
    await setWorkflow("mri_primary_implant_screening");
    const created = await create({
      bookingDate: "2027-01-06",
      modalitySafetyAcknowledged: true,
      mriPrimaryScreening: {
        result: "no_known_implant_reported",
        implantSite: "ignored",
        implantDescription: "ignored",
        previousReviewerNameReported: "ignored",
        screenedByUserId: 999999,
        screenedAt: "2000-01-01T00:00:00.000Z",
      },
    });
    assert.equal(created.status, 201);
    const bookingId = Number(created.data.booking.id);
    const persisted = await pool.query(`select * from appointments_v2.mri_primary_screenings where booking_id = $1`, [bookingId]);
    assert.equal(persisted.rows[0].result, "no_known_implant_reported");
    assert.equal(persisted.rows[0].implant_site, null);
    assert.equal(Number(persisted.rows[0].screened_by_user_id), testData.userId);
    assert.notEqual(new Date(persisted.rows[0].screened_at).toISOString(), "2000-01-01T00:00:00.000Z");

    const detailsResponse = await fetch(`${app.baseUrl}/api/v2/read/appointments/${bookingId}`, { headers: { Cookie: authCookie } });
    const details = await detailsResponse.json() as Record<string, any>;
    assert.equal(detailsResponse.status, 200);
    assert.deepEqual(details.appointment.mriPrimaryScreening, {
      result: "no_known_implant_reported",
      implantSite: null,
      implantDescription: null,
      previousReviewerNameReported: null,
      screenedByUserId: testData.userId,
      screenedAt: persisted.rows[0].screened_at.toISOString(),
    });
  });

  it("persists valid implant-reported screening fields", async () => {
    await setWorkflow("mri_primary_implant_screening");
    const created = await create({
      bookingDate: "2027-01-05",
      modalitySafetyAcknowledged: true,
      mriPrimaryScreening: {
        result: "implant_reported_review_required",
        implantSite: " left hip ",
        implantDescription: "joint replacement",
        previousReviewerNameReported: "Dr Reported",
      },
    });
    assert.equal(created.status, 201);
    const persisted = await pool.query(`select * from appointments_v2.mri_primary_screenings where booking_id = $1`, [created.data.booking.id]);
    assert.equal(persisted.rows[0].result, "implant_reported_review_required");
    assert.equal(persisted.rows[0].implant_site, "left hip");
    assert.equal(persisted.rows[0].implant_description, "joint replacement");
    assert.equal(persisted.rows[0].previous_reviewer_name_reported, "Dr Reported");
  });

  it("keeps booking and screening insertion atomic", async () => {
    await setWorkflow("mri_primary_implant_screening");
    await pool.query(`
      create or replace function appointments_v2.fail_test_mri_screening() returns trigger language plpgsql as $$
      begin
        if new.implant_description = 'FORCE_ATOMIC_FAILURE' then raise exception 'forced screening failure'; end if;
        return new;
      end $$;
      create trigger fail_test_mri_screening before insert on appointments_v2.mri_primary_screenings
      for each row execute function appointments_v2.fail_test_mri_screening();
    `);
    try {
      const failed = await create({
        bookingDate: "2027-01-04",
        modalitySafetyAcknowledged: true,
        mriPrimaryScreening: {
          result: "implant_reported_review_required",
          implantSite: "hip",
          implantDescription: "FORCE_ATOMIC_FAILURE",
        },
      });
      assert.equal(failed.status, 500);
      const bookingCount = await pool.query(
        `select count(*)::int as count from appointments_v2.bookings where patient_id = $1 and booking_date = '2027-01-04'`,
        [testData.patientId]
      );
      assert.equal(bookingCount.rows[0].count, 0);
    } finally {
      await pool.query(`drop trigger if exists fail_test_mri_screening on appointments_v2.mri_primary_screenings`);
      await pool.query(`drop function if exists appointments_v2.fail_test_mri_screening()`);
    }
  });

  it("does not allow quota or override modes to bypass safety screening", async () => {
    await setWorkflow("mri_primary_implant_screening");
    for (const capacityResolutionMode of ["special_quota_extra", "category_override", "total_capacity_override"]) {
      const response = await create({ bookingDate: "2027-01-12", capacityResolutionMode });
      assert.equal(response.status, 400);
      assert.equal(response.data.details?.code, "MODALITY_SAFETY_ACKNOWLEDGEMENT_REQUIRED");
    }
  });

  it("blocks creation when an enabled warning has no configured text", async () => {
    await setWorkflow("standard_acknowledgement", null);
    const response = await create({ bookingDate: "2027-01-13", modalitySafetyAcknowledged: true });
    assert.equal(response.status, 400);
    assert.equal(response.data.details?.code, "MODALITY_SAFETY_WARNING_MISCONFIGURED");
  });
});
