/**
 * Appointments V2 — Special quota DB-backed integration tests.
 */

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
const TEST_PREFIX = "SQTEST_";

describe("Special quota — DB-backed integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database not reachable. Skipping special quota tests.");
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
    return fetchJson(app.baseUrl, path, { cookie: authCookie, ...rest, ...(origBody !== undefined ? { body: origBody } : {}) });
  };

  function guard() {
    if (!testData) throw new Error("Test setup failed");
  }

  async function insertSpecialQuota(policyVersionId: number, examTypeId: number, dailyExtraSlots: number) {
    const { pool } = await import("../../../../db/pool.js");
    await pool.query(
      `insert into appointments_v2.exam_type_special_quotas
        (policy_version_id, exam_type_id, daily_extra_slots, is_active)
      values ($1, $2, $3, true)
      on conflict (policy_version_id, exam_type_id) do update set daily_extra_slots = $3`,
      [policyVersionId, examTypeId, dailyExtraSlots]
    );
  }

  async function setDailyLimit(modalityId: number, policyVersionId: number, dailyLimit: number) {
    const { pool } = await import("../../../../db/pool.js");
    await pool.query(
      `insert into appointments_v2.category_daily_limits
        (policy_version_id, modality_id, case_category, daily_limit, is_active)
      values ($1, $2, 'non_oncology', $3, true)
      on conflict (policy_version_id, modality_id, case_category) do update set daily_limit = $3`,
      [policyVersionId, modalityId, dailyLimit]
    );
  }

  let uniqueDayOffset = 0;
  function uniqueDate(): string {
    uniqueDayOffset += 1;
    const d = new Date(Date.UTC(2040, 0, 1));
    d.setUTCDate(d.getUTCDate() + uniqueDayOffset);
    return d.toISOString().slice(0, 10);
  }

  describe("Create booking — special quota consumption", () => {
    it("creates booking with useSpecialQuota=true", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 1);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 3);

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: sqDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
          specialReasonCode: "urgent_oncology",
          specialReasonNote: "High-risk urgent case",
        },
      });

      assert.strictEqual(result.status, 201);
      const booking = (result.data as Record<string, unknown>).booking as Record<string, unknown>;
      assert.strictEqual((booking as Record<string, unknown>).usesSpecialQuota, true);

      const { pool } = await import("../../../../db/pool.js");
      const dbCheck = await pool.query(
        `select uses_special_quota, special_reason_code, special_reason_note
         from appointments_v2.bookings where id = $1`,
        [Number((booking as Record<string, unknown>).id)]
      );
      assert.strictEqual(dbCheck.rows[0]?.uses_special_quota, true, "DB should have uses_special_quota=true");
      assert.strictEqual(dbCheck.rows[0]?.special_reason_code, "urgent_oncology");
      assert.strictEqual(dbCheck.rows[0]?.special_reason_note, "High-risk urgent case");
    });
  });

  describe("Create booking — respects remaining quota", () => {
    it("second special quota booking succeeds", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 2);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 3);

      const r1 = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: sqDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(r1.status, 201);

      const r2 = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: sqDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(r2.status, 201);
    });

    it("third booking fails when quota exhausted", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 2);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 2);

      for (let i = 0; i < 2; i++) {
        await fetch("/api/v2/appointments", {
          method: "POST",
          body: {
            patientId: testData.patientId,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: sqDate,
            caseCategory: "non_oncology",
            useSpecialQuota: true,
          },
        });
      }

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: sqDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(result.status, 409);

      const { pool } = await import("../../../../db/pool.js");
      const dbCheck = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from appointments_v2.bookings
         where modality_id = $1
           and exam_type_id = $2
           and booking_date = $3::date
           and uses_special_quota = true
           and status <> 'cancelled'`,
        [testData.modalityId, testData.examTypeId, sqDate]
      );
      assert.strictEqual(Number(dbCheck.rows[0]?.count || "0"), 2);
    });
  });

  describe("Cancel booking — releases special quota", () => {
    it("cancelling frees quota for rebooking", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 1);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 1);

      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: sqDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(createResult.status, 201);
      const booking = (createResult.data as Record<string, unknown>).booking as Record<string, unknown>;
      const bookingId = Number((booking as Record<string, unknown>).id);

      await fetch("/api/v2/appointments/" + bookingId + "/cancel", { method: "POST" });

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: sqDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(result.status, 201);
    });
  });

  describe("Reschedule booking — release/reconsume", () => {
    it("reschedule off special-quota day succeeds", async () => {
      guard();
      const runId = Date.now() % 10000;
      const fromDate = "2033-01-" + String(runId % 28 + 1).padStart(2, "0");
      const toDate = "2033-02-" + String(runId % 28 + 1).padStart(2, "0");
      // toDate needs standard capacity > 0 since we're not using special quota
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 1);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 1);

      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: fromDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
          specialReasonCode: "medical_priority",
          specialReasonNote: "Initial quota booking",
        },
      });
      const booking = (createResult.data as Record<string, unknown>).booking as Record<string, unknown>;
      const bookingId = Number((booking as Record<string, unknown>).id);
      assert.strictEqual(fromDate !== toDate, true, "fromDate and toDate must differ");

      const result = await fetch("/api/v2/appointments/" + bookingId, {
        method: "PUT",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: toDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
          specialReasonCode: "equipment_window",
          specialReasonNote: "Moved due to scanner window",
        },
      });
      assert.strictEqual(result.status, 200);

      const { pool } = await import("../../../../db/pool.js");
      const dbCheck = await pool.query(
        `select booking_date, uses_special_quota, special_reason_code, special_reason_note
         from appointments_v2.bookings where id = $1`,
        [bookingId]
      );
      assert.strictEqual(dbCheck.rows.length, 1, "Booking should exist in DB");
      assert.strictEqual(dbCheck.rows[0]?.uses_special_quota, false);
      assert.strictEqual(dbCheck.rows[0]?.special_reason_code, "equipment_window");
      assert.strictEqual(dbCheck.rows[0]?.special_reason_note, "Moved due to scanner window");
    });

    it("reschedule onto exhausted special-quota day fails", async () => {
      guard();
      const runId = (Date.now() % 10000) + 800;
      const fullDate = "2036-01-" + String(runId % 28 + 1).padStart(2, "0");
      const startDate = "2036-02-" + String(runId % 28 + 1).padStart(2, "0");
      
      assert.strictEqual(fullDate !== startDate, true, "fullDate and startDate must differ");

      // Setup: 1 standard slot (for normal booking), 1 special quota (for target date)
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 1);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 1);

      // First: fill up special quota on fullDate with useSpecialQuota=true
      const fillResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: fullDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(fillResult.status, 201, "Fill-up booking should succeed");

      // Second: create a normal booking on startDate (uses standard capacity)
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: startDate,
          caseCategory: "non_oncology",
        },
      });
      assert.strictEqual(createResult.status, 201, "Normal booking should succeed");
      const booking = (createResult.data as Record<string, unknown>).booking as Record<string, unknown>;
      const bookingId = Number((booking as Record<string, unknown>).id);

      // Third: reschedule FROM startDate TO fullDate with useSpecialQuota=true
      // fullDate already has special quota exhausted (1/1 used)
      // Backend should block because special quota is exhausted
      const result = await fetch("/api/v2/appointments/" + bookingId, {
        method: "PUT",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: fullDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });

      // STRICT EXPECTATION: This SHOULD FAIL WITH 409
      assert.strictEqual(result.status, 409, "Reschedule to exhausted special-quota day must fail with 409");
    });
  });

  describe("Non-special booking — does not mutate special quota", () => {
    it("standard booking leaves special quota available", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 2);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 3);

      await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: sqDate,
          caseCategory: "non_oncology",
        },
      });

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: sqDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(result.status, 201);
    });
  });
});
