import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  isDatabaseAvailable,
  canReachDatabase,
  setupTestDatabase,
  seedTestData,
  createTestApp,
  fetchJson,
  createTestAuthCookie,
  type TestData,
} from "./helpers.js";

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "OVREQ_";

describe("Scheduling override requests — integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let receptionistId = 0;
  let supervisorCookie = "";
  let superAdminCookie = "";
  let receptionistCookie = "";

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    app = await createTestApp();
    supervisorCookie = createTestAuthCookie(testData.userId, "supervisor");

    const { pool } = await import("../../../../db/pool.js");
    const bcryptHash = "$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS";
    const receptionist = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'receptionist', true)
       on conflict (username) do update set password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}receptionist`, bcryptHash, `${TEST_PREFIX}Receptionist`]
    );
    receptionistId = Number(receptionist.rows[0].id);
    receptionistCookie = createTestAuthCookie(receptionistId, "receptionist");

    const superAdmin = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'super_admin', true)
       on conflict (username) do update set password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}superadmin`, bcryptHash, `${TEST_PREFIX}SuperAdmin`]
    );
    superAdminCookie = createTestAuthCookie(Number(superAdmin.rows[0].id), "super_admin");
  });

  after(async () => {
    if (!testData) return;
    await app.close();
    await testDb.cleanup();
  });

  const fetchAs = (cookie: string, path: string, opts: Record<string, unknown> = {}) =>
    fetchJson(app.baseUrl, path, { cookie, ...opts });

  async function createPatient() {
    const { pool } = await import("../../../../db/pool.js");
    const nationalId = `7${Math.random().toString().slice(2, 13).padEnd(11, "0").slice(0, 11)}`;
    const row = await pool.query<{ id: number }>(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, identifier_type, identifier_value)
       values ($1, $2, $3, $4, 'M', 40, 'national_id', $5)
       returning id`,
      [`${TEST_PREFIX}مريض`, `${TEST_PREFIX} Patient`, nationalId, `${TEST_PREFIX}مريض`, nationalId]
    );
    return Number(row.rows[0].id);
  }

  async function fillNonOncologyCategory(date: string, count = 5) {
    for (let i = 0; i < count; i += 1) {
      const patientId = await createPatient();
      const created = await fetchAs(supervisorCookie, "/api/v2/appointments", {
        method: "POST",
        body: {
          patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: date,
          caseCategory: "non_oncology",
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(created.status, 201);
    }
  }

  async function requestCategoryOverride(date: string, patientId = 0) {
    const targetPatientId = patientId || await createPatient();
    return fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "create_booking",
        requesterReason: "Clinical urgency needs approval",
        requestPayload: {
          patientId: targetPatientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: date,
          bookingTime: null,
          caseCategory: "non_oncology",
          policySetKey: testData.policySetKey,
        },
        createdFromContext: "integration_test",
      },
    });
  }

  it("receptionist creates a pending create-booking request and supervisor approves it", async () => {
    if (!testData) return;
    const date = "2042-02-01";
    await fillNonOncologyCategory(date);

    const requested = await requestCategoryOverride(date);
    assert.equal(requested.status, 201);
    assert.equal((requested.data as any).request.status, "pending");
    assert.equal((requested.data as any).request.overrideType, "category_override");

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((requested.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Approved for urgent clinical need" },
    });
    assert.equal(approved.status, 200);
    assert.equal((approved.data as any).request.status, "approved");
    assert.ok(Number((approved.data as any).booking.id) > 0);
  });

  it("rejects without approver reason and lets a receptionist see only their own requests", async () => {
    if (!testData) return;
    const date = "2042-02-02";
    await fillNonOncologyCategory(date);
    const requested = await requestCategoryOverride(date);
    assert.equal(requested.status, 201);

    const rejectedWithoutReason = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((requested.data as any).request.id)}/reject`, {
      method: "POST",
      body: { approverReason: "" },
    });
    assert.equal(rejectedWithoutReason.status, 400);

    const ownList = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests");
    assert.equal(ownList.status, 200);
    assert.ok((ownList.data as any).requests.every((row: any) => Number(row.requesterUserId) === receptionistId));
  });

  it("prevents receptionist approval and prevents duplicate approval from creating another booking", async () => {
    if (!testData) return;
    const date = "2042-02-03";
    await fillNonOncologyCategory(date);
    const requested = await requestCategoryOverride(date);
    const requestId = Number((requested.data as any).request.id);

    const receptionistApproval = await fetchAs(receptionistCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "not allowed" },
    });
    assert.equal(receptionistApproval.status, 403);

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Approved once" },
    });
    assert.equal(approved.status, 200);

    const duplicate = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Approved twice" },
    });
    assert.equal(duplicate.status, 409);
  });

  it("supervisor approves a pending reschedule request and audit is written", async () => {
    if (!testData) return;
    const sourceDate = "2042-02-04";
    const targetDate = "2042-02-05";
    const patientId = await createPatient();
    const booking = await fetchAs(supervisorCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: sourceDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(booking.status, 201);
    await fillNonOncologyCategory(targetDate);

    const request = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "reschedule_booking",
        bookingId: Number((booking.data as any).booking.id),
        requesterReason: "Patient requested this date",
        requestPayload: {
          bookingDate: targetDate,
          bookingTime: null,
          policySetKey: testData.policySetKey,
        },
      },
    });
    assert.equal(request.status, 201);

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((request.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Approved reschedule" },
    });
    assert.equal(approved.status, 200);
    assert.equal((approved.data as any).booking.bookingDate, targetDate);

    const { pool } = await import("../../../../db/pool.js");
    const audit = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from appointments_v2.override_audit_events
       where booking_id = $1 and override_type = 'category_override'`,
      [Number((booking.data as any).booking.id)]
    );
    assert.equal(audit.rows[0]?.count, 1);
  });

  it("blocks expired approval and total capacity approval by supervisor while allowing superadmin", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    await pool.query(`update modalities set daily_capacity = 1 where id = $1`, [testData.modalityId]);
    await pool.query(
      `update appointments_v2.category_daily_limits set daily_limit = 1 where policy_version_id = $1 and modality_id = $2`,
      [testData.policyVersionId, testData.modalityId]
    );
    const date = "2042-02-06";
    await fillNonOncologyCategory(date, 1);

    const expired = await requestCategoryOverride(date);
    assert.equal(expired.status, 201);
    await pool.query(`update appointments_v2.scheduling_override_requests set expires_at = now() - interval '1 minute' where id = $1`, [
      Number((expired.data as any).request.id),
    ]);
    const expiredApproval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((expired.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "too late" },
    });
    assert.equal(expiredApproval.status, 409);

    const total = await requestCategoryOverride(date);
    assert.equal(total.status, 201);
    assert.equal((total.data as any).request.overrideType, "total_capacity_override");

    const supervisorApproval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((total.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "not enough permission" },
    });
    assert.equal(supervisorApproval.status, 403);

    const superAdminApproval = await fetchAs(superAdminCookie, `/api/v2/scheduling-override-requests/${Number((total.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Total capacity approved" },
    });
    assert.equal(superAdminApproval.status, 200);
  });
});
