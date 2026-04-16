/**
 * Appointments V2 — Special quota and resolution mode DB-backed integration tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const TEST_PREFIX = "SQMODE_";

describe("Special quota + capacity resolution modes — DB-backed integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database not reachable. Skipping special quota mode tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");
  });

  after(async () => {
    if (!testData) return;
    await app.close();
    await testDb.cleanup();
  });

  function guard() {
    if (!testData) throw new Error("Test setup failed");
  }

  const fetch = (path: string, opts: Record<string, unknown> = {}) => {
    const { body: origBody, ...rest } = opts as Record<string, unknown> & { body?: unknown };
    if (path.includes("/api/v2/appointments")) {
      const body = origBody as Record<string, unknown> | undefined;
      if (body) {
        return fetchJson(app.baseUrl, path, {
          cookie: authCookie,
          ...rest,
          body: { ...body, policySetKey: testData.policySetKey },
        });
      }
    }
    return fetchJson(app.baseUrl, path, {
      cookie: authCookie,
      ...rest,
      ...(origBody !== undefined ? { body: origBody } : {}),
    });
  };

  async function db() {
    const mod = await import("../../../../db/pool.js");
    return mod.pool;
  }

  async function createPatient(): Promise<number> {
    const pool = await db();
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const nationalId = `9${randomUUID().replace(/-/g, "").slice(0, 11)}`;
    const result = await pool.query<{ id: number }>(
      `insert into patients (
         arabic_full_name,
         english_full_name,
         national_id,
         normalized_arabic_name,
         sex,
         age_years,
         identifier_type,
         identifier_value
       )
       values ($1, $2, $3, $4, 'M', 34, 'national_id', $5)
       returning id`,
      [
        `${TEST_PREFIX}${suffix}مريض`,
        `${TEST_PREFIX}${suffix} Patient`,
        nationalId,
        `${TEST_PREFIX}${suffix}مريض`,
        nationalId,
      ]
    );
    return Number(result.rows[0].id);
  }

  async function setModalityCapacity(dailyCapacity: number): Promise<void> {
    const pool = await db();
    await pool.query(`update modalities set daily_capacity = $2 where id = $1`, [testData.modalityId, dailyCapacity]);
  }

  async function setCategoryLimits(oncology: number | null, nonOncology: number | null): Promise<void> {
    const pool = await db();
    await pool.query(
      `delete from appointments_v2.category_daily_limits where policy_version_id = $1 and modality_id = $2`,
      [testData.policyVersionId, testData.modalityId]
    );

    if (oncology != null) {
      await pool.query(
        `insert into appointments_v2.category_daily_limits
           (policy_version_id, modality_id, case_category, daily_limit, is_active)
         values ($1, $2, 'oncology', $3, true)`,
        [testData.policyVersionId, testData.modalityId, oncology]
      );
    }

    if (nonOncology != null) {
      await pool.query(
        `insert into appointments_v2.category_daily_limits
           (policy_version_id, modality_id, case_category, daily_limit, is_active)
         values ($1, $2, 'non_oncology', $3, true)`,
        [testData.policyVersionId, testData.modalityId, nonOncology]
      );
    }
  }

  async function setSpecialQuota(dailyExtraSlots: number): Promise<void> {
    const pool = await db();
    await pool.query(
      `insert into appointments_v2.exam_type_special_quotas
        (policy_version_id, exam_type_id, daily_extra_slots, is_active)
      values ($1, $2, $3, true)
      on conflict (policy_version_id, exam_type_id) do update set daily_extra_slots = $3, is_active = true`,
      [testData.policyVersionId, testData.examTypeId, dailyExtraSlots]
    );
  }

  async function createBooking(params: {
    patientId: number;
    bookingDate: string;
    caseCategory: "oncology" | "non_oncology";
    capacityResolutionMode?: "standard" | "category_override" | "special_quota_extra";
    specialReasonCode?: string | null;
    specialReasonNote?: string | null;
    override?: {
      supervisorUsername: string;
      supervisorPassword: string;
      reason: string;
    };
  }) {
    return fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: params.patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: params.bookingDate,
        caseCategory: params.caseCategory,
        capacityResolutionMode: params.capacityResolutionMode,
        specialReasonCode: params.specialReasonCode ?? null,
        specialReasonNote: params.specialReasonNote ?? null,
        override: params.override,
      },
    });
  }

  let dayOffset = 0;
  function uniqueDate(): string {
    dayOffset += 1;
    const d = new Date(Date.UTC(2042, 0, 1));
    d.setUTCDate(d.getUTCDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  }

  it("category full + total has room -> category_override succeeds without consuming special quota", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(1, 1);
    await setSpecialQuota(0);

    const p1 = await createPatient();
    const p2 = await createPatient();

    const first = await createBooking({
      patientId: p1,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
    });
    assert.equal(first.status, 201);

    const second = await createBooking({
      patientId: p2,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "category_override",
    });
    assert.equal(second.status, 201);

    const booking = (second.data as Record<string, unknown>).booking as Record<string, unknown>;
    assert.equal(booking.capacityResolutionMode, "category_override");
    assert.equal(booking.usesSpecialQuota, false);
  });

  it("total full + special quota available -> special_quota_extra succeeds and persists uses_special_quota=true", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(1);
    await setCategoryLimits(null, null);
    await setSpecialQuota(1);

    const p1 = await createPatient();
    const p2 = await createPatient();

    const base = await createBooking({
      patientId: p1,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
    });
    assert.equal(base.status, 201);

    const special = await createBooking({
      patientId: p2,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
      specialReasonNote: "Needs extra slot",
    });
    assert.equal(special.status, 201);

    const specialBooking = (special.data as Record<string, unknown>).booking as Record<string, unknown>;
    assert.equal(specialBooking.capacityResolutionMode, "special_quota_extra");
    assert.equal(specialBooking.usesSpecialQuota, true);

    const pool = await db();
    const row = await pool.query<{ uses_special_quota: boolean; capacity_resolution_mode: string }>(
      `select uses_special_quota, capacity_resolution_mode
       from appointments_v2.bookings
       where id = $1`,
      [Number(specialBooking.id)]
    );
    assert.equal(row.rows[0]?.uses_special_quota, true);
    assert.equal(row.rows[0]?.capacity_resolution_mode, "special_quota_extra");
  });

  it("total full + no special quota -> special_quota_extra blocked", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(1);
    await setCategoryLimits(null, null);
    await setSpecialQuota(0);

    const p1 = await createPatient();
    const p2 = await createPatient();

    const base = await createBooking({
      patientId: p1,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
    });
    assert.equal(base.status, 201);

    const special = await createBooking({
      patientId: p2,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(special.status, 409);
  });

  it("override audit snapshot records selected capacityResolutionMode", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(3);
    await setCategoryLimits(null, null);
    await setSpecialQuota(2);

    const pool = await db();
    await pool.query(
      `insert into appointments_v2.modality_blocked_rules
        (policy_version_id, modality_id, rule_type, specific_date, is_overridable, is_active, title)
       values ($1, $2, 'specific_date', $3::date, true, true, 'Supervisor-only day')`,
      [testData.policyVersionId, testData.modalityId, date]
    );
    const supervisorRow = await pool.query<{ username: string }>(
      `select username from users where id = $1`,
      [testData.userId]
    );

    const patientId = await createPatient();
    const result = await createBooking({
      patientId,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
      override: {
        supervisorUsername: supervisorRow.rows[0]?.username ?? "",
        supervisorPassword: "test_password",
        reason: "approved",
      },
    });
    assert.equal(result.status, 201);

    const booking = (result.data as Record<string, unknown>).booking as Record<string, unknown>;
    const audit = await pool.query<{ mode: string | null }>(
      `select decision_snapshot->>'capacityResolutionMode' as mode
       from appointments_v2.override_audit_events
       where booking_id = $1
       order by id desc
       limit 1`,
      [Number(booking.id)]
    );
    assert.equal(audit.rows[0]?.mode, "special_quota_extra");
  });

  it("cancel and reschedule release/preserve quota according to selected mode", async () => {
    guard();
    const sourceDate = uniqueDate();
    const targetDate = uniqueDate();
    await setModalityCapacity(1);
    await setCategoryLimits(null, null);
    await setSpecialQuota(1);

    const p1 = await createPatient();
    const p2 = await createPatient();

    const created = await createBooking({
      patientId: p1,
      bookingDate: sourceDate,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(created.status, 201);
    const createdBooking = (created.data as Record<string, unknown>).booking as Record<string, unknown>;
    const bookingId = Number(createdBooking.id);

    const rescheduled = await fetch(`/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        bookingDate: targetDate,
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
      },
    });
    assert.equal(rescheduled.status, 200);

    const pool = await db();
    const afterReschedule = await pool.query<{ uses_special_quota: boolean; capacity_resolution_mode: string }>(
      `select uses_special_quota, capacity_resolution_mode
       from appointments_v2.bookings
       where id = $1`,
      [bookingId]
    );
    assert.equal(afterReschedule.rows[0]?.uses_special_quota, true);
    assert.equal(afterReschedule.rows[0]?.capacity_resolution_mode, "special_quota_extra");

    const sourceRebook = await createBooking({
      patientId: p2,
      bookingDate: sourceDate,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(sourceRebook.status, 201);

    const targetBooking = (rescheduled.data as Record<string, unknown>).booking as Record<string, unknown>;
    const cancelResult = await fetch(`/api/v2/appointments/${Number(targetBooking.id)}/cancel`, {
      method: "POST",
    });
    assert.equal(cancelResult.status, 200);

    const sourceSecondTry = await createBooking({
      patientId: await createPatient(),
      bookingDate: targetDate,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(sourceSecondTry.status, 201);
  });
});
