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

  const fetch = (path: string, opts: Record<string, unknown> = {}) =>
    fetchJson(app.baseUrl, path, { cookie: authCookie, ...opts });

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

  function uniqueDate(): string {
    const now = Date.now();
    const day = (now % 28) + 1;
    const month = Math.floor(now / 28) % 12 + 1;
    return "2027-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  describe("Create booking — special quota consumption", () => {
    it("creates booking with useSpecialQuota=true", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 0);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 3);

      // Debug: Check what policy version the backend uses
      const { pool } = await import("../../../../db/pool.js");
      const pv = await pool.query(
        "select id, status from appointments_v2.policy_versions where policy_set_id = (select id from appointments_v2.policy_sets where key = 'default') and status = 'published'"
      );
      console.log("Published PV:", pv.rows);
      console.log("Test PV:", testData.policyVersionId);
      const quotaCheck = await pool.query(
        "select * from appointments_v2.exam_type_special_quotas where policy_version_id = $1 and exam_type_id = $2",
        [testData.policyVersionId, testData.examTypeId]
      );
      console.log("Quota check:", quotaCheck.rows);

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

      console.log("Create result:", result.status, result.data);
      assert.strictEqual(result.status, 201);
      const booking = (result.data as Record<string, unknown>).booking as Record<string, unknown>;
      assert.strictEqual((booking as Record<string, unknown>).usesSpecialQuota, true);
    });
  });

  describe("Create booking — respects remaining quota", () => {
    it("second special quota booking succeeds", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 0);
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
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 0);
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
    });
  });

  describe("Cancel booking — releases special quota", () => {
    it("cancelling frees quota for rebooking", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 0);
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
      const fromDate = uniqueDate();
      const toDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 0);
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
        },
      });
      const booking = (createResult.data as Record<string, unknown>).booking as Record<string, unknown>;
      const bookingId = Number((booking as Record<string, unknown>).id);

      const result = await fetch("/api/v2/appointments/" + bookingId, {
        method: "PUT",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: toDate,
          caseCategory: "non_oncology",
        },
      });
      assert.strictEqual(result.status, 200);
    });

    it.skip("reschedule onto exhausted special-quota day fails", async () => {
      guard();
      const runId = Date.now() % 100000;
      const specialDate = "2028-01-" + String(runId % 30 + 1).padStart(2, "0");
      const normalDate = "2028-02-" + String(runId % 30 + 1).padStart(2, "0");
      
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 1);
      await insertSpecialQuota(testData.policyVersionId, testData.examTypeId, 1);

      const fillResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: specialDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(fillResult.status, 201, "Fill-up booking should succeed");

      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: normalDate,
          caseCategory: "non_oncology",
        },
      });
      assert.strictEqual(createResult.status, 201, "Normal booking should succeed");
      const booking = (createResult.data as Record<string, unknown>).booking as Record<string, unknown>;
      const bookingId = Number((booking as Record<string, unknown>).id);

      const result = await fetch("/api/v2/appointments/" + bookingId, {
        method: "PUT",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: specialDate,
          caseCategory: "non_oncology",
          useSpecialQuota: true,
        },
      });
      assert.strictEqual(result.status, 409, "Reschedule to exhausted special-quota day should fail");
    });
  });

  describe("Non-special booking — does not mutate special quota", () => {
    it("standard booking leaves special quota available", async () => {
      guard();
      const sqDate = uniqueDate();
      await setDailyLimit(testData.modalityId, testData.policyVersionId, 1);
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
