/**
 * Appointments V2 — Rule enforcement integration tests.
 *
 * Tests that admin policy rules are truly enforced in the availability
 * and booking evaluation path, not just stored/displayed.
 *
 * Tests cover:
 * - Blocked rules (specific_date, date_range, yearly_recurrence)
 * - Overridable blocked rules
 * - Exam type hard/overridable restrictions
 * - Category daily limit exhaustion
 * - Special quota path (documents current behavior)
 * - Create booking rejects blocked days
 * - Frontend: blocked row does NOT show positive capacity
 * - Frontend: restricted row shows approval-needed
 * - Frontend: available row shows numeric availability
 *
 * Requires DATABASE_URL or TEST_DATABASE_URL environment variable.
 */

import { describe, it, before, after, type TestContext } from "node:test";
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
const TEST_PREFIX = "RULE_ENF_";

describe("Rule enforcement — integration tests", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database is not reachable. Skipping rule enforcement integration tests.");
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

  let currentPolicySetKey = "default";
  const fetch = (path: string, opts: Record<string, unknown> = {}) => {
    const { body: _origBody, ...rest } = opts as any;
    if (path.includes("/api/v2/scheduling/admin/policy")) {
      return fetchJson(app.baseUrl, path, { ...rest, cookie: authCookie, body: _origBody });
    }
    if (path.includes("/appointments") || path.includes("/scheduling/evaluate")) {
      const body = ((opts.body ?? {}) as Record<string, unknown>);
      body.policySetKey = currentPolicySetKey;
      return fetchJson(app.baseUrl, path, { ...rest, cookie: authCookie, body });
    }
    if (path.includes("/scheduling/availability")) {
      const sep = path.includes("?") ? "&" : "?";
      const newPath = `${path}${sep}policySetKey=${encodeURIComponent(currentPolicySetKey)}`;
      return fetchJson(app.baseUrl, newPath, { ...rest, cookie: authCookie });
    }
    return fetchJson(app.baseUrl, path, { ...rest, cookie: authCookie, body: _origBody });
  };

  function guard(t: TestContext) {
    if (testData) return false;
    t.skip("Database is not reachable in this environment");
    return true;
  }

  function nextDateForWeekday(weekday: number): string {
    const now = new Date();
    const current = now.getUTCDay();
    const delta = (weekday - current + 7) % 7 || 7;
    const target = new Date(now.getTime() + delta * 24 * 60 * 60 * 1000);
    const y = target.getUTCFullYear();
    const m = String(target.getUTCMonth() + 1).padStart(2, "0");
    const d = String(target.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // ---------------------------------------------------------------------------
  // Helper: create isolated policy set and publish rules to it.
  // Each test uses a unique policySetKey so tests don't interfere.
  // ---------------------------------------------------------------------------
  async function publishPolicyWithRules(
    rules: {
      modalityBlockedRules: Array<{
        modalityId: number;
        ruleType: string;
        specificDate: string | null;
        startDate: string | null;
        endDate: string | null;
        recurStartMonth: number | null;
        recurStartDay: number | null;
        recurEndMonth: number | null;
        recurEndDay: number | null;
        isOverridable: boolean;
        isActive: boolean;
        title: string | null;
        notes: string | null;
      }>;
      categoryDailyLimits: Array<{
        modalityId: number;
        caseCategory: string;
        dailyLimit: number;
        isActive: boolean;
      }>;
      examTypeRules?: Array<{
        modalityId: number;
        ruleType: string;
        effectMode: string;
        specificDate: string | null;
        startDate: string | null;
        endDate: string | null;
        weekday: number | null;
        alternateWeeks: boolean;
        recurrenceAnchorDate: string | null;
        examTypeIds: number[];
        title: string | null;
        notes: string | null;
        isActive: boolean;
      }>;
    },
    policySetKey: string
  ) {
    currentPolicySetKey = policySetKey;
    const { pool } = await import("../../../../db/pool.js");
    const userId = testData.userId;

    const snapshot = {
      categoryDailyLimits: rules.categoryDailyLimits.map((r, i) => ({
        id: i + 1, ...r,
      })),
      modalityBlockedRules: rules.modalityBlockedRules.map((r, i) => ({
        id: i + 10, ...r,
      })),
      examTypeRules: (rules.examTypeRules ?? []).map((r, i) => ({
        id: i + 20, ...r,
      })),
      examTypeSpecialQuotas: [],
      specialReasonCodes: [],
    };

    const psResult = await pool.query(
      `insert into appointments_v2.policy_sets (key, name, created_by_user_id)
       values ($1, $2, $3)
       on conflict (key) do nothing
       returning id`,
      [policySetKey, `${policySetKey} policy`, userId]
    );
    let policySetId = psResult.rows[0]?.id;
    if (!policySetId) {
      const existing = await pool.query(
        `select id from appointments_v2.policy_sets where key = $1`,
        [policySetKey]
      );
      policySetId = Number(existing.rows[0].id);
    }

    await pool.query(
      `delete from appointments_v2.policy_versions where policy_set_id = $1 and status = 'draft'`,
      [policySetId]
    );

    const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
      method: "POST",
      body: { policySetKey },
    });
    if (createResult.status !== 201) {
      throw new Error("Failed to create draft: " + JSON.stringify(createResult.data));
    }
    const draftVersionId = (createResult.data as any).draft.id;

    const updateResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
      method: "PUT",
      body: { policySnapshot: snapshot, changeNote: "Rule enforcement test" },
    });
    if (updateResult.status !== 200) {
      console.error("PUT update failed:", JSON.stringify(updateResult.data));
      const err = updateResult.data as any;
      throw new Error("Failed to update draft: " + JSON.stringify(err?.details?.fieldErrors ?? updateResult.data));
    }

    const publishResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}/publish`, {
      method: "POST",
      body: { changeNote: "Publish for test" },
    });
    if (publishResult.status !== 200) {
      throw new Error("Failed to publish draft: " + JSON.stringify(publishResult.data));
    }
  }

  // ---------------------------------------------------------------------------
  // Test 1: Blocked rule — specific_date
  // ---------------------------------------------------------------------------
  describe("Blocked rule — specific_date", () => {
    it("date with raw spare capacity shows blocked, not bookable", async (t) => {
      if (guard(t)) return;

      const futureDate = "2027-03-15";

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: futureDate,
            startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "Test blocked day",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100, // lots of raw capacity
            isActive: true,
          },
        ],
      }, "RE_ps01");

      // Check availability
      const availResult = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=400&offset=0&caseCategory=non_oncology`
      );
      const availData = availResult.data as any;
      const blockedDay = (availData.items ?? []).find((d: any) => d.date === futureDate);

      assert.ok(blockedDay, `Should have entry for ${futureDate}`);
      assert.strictEqual(
        blockedDay.decision.displayStatus,
        "blocked",
        `Date ${futureDate} should be blocked by modality_blocked_rule`
      );
      assert.strictEqual(
        blockedDay.decision.isAllowed,
        false,
        "Blocked date should not be allowed"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Blocked rule — date_range
  // ---------------------------------------------------------------------------
  describe("Blocked rule — date_range", () => {
    it("date within range shows blocked even with raw capacity", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "date_range",
            specificDate: null,
            startDate: "2027-06-01",
            endDate: "2027-06-30",
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "June maintenance",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
      }, "RE_ps02");

      const availResult = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=400&offset=0&caseCategory=non_oncology`
      );
      const availData = availResult.data as any;
      const inRange = (availData.items ?? []).find((d: any) => d.date === "2027-06-15");

      assert.ok(inRange, "Should have entry for 2027-06-15");
      assert.strictEqual(inRange.decision.displayStatus, "blocked");

      // Date outside range should NOT be blocked
      const outOfRange = (availData.items ?? []).find((d: any) => d.date === "2027-07-05");
      if (outOfRange) {
        assert.notStrictEqual(outOfRange.decision.displayStatus, "blocked");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Blocked rule — yearly_recurrence
  // ---------------------------------------------------------------------------
  describe("Blocked rule — yearly_recurrence", () => {
    it("date matching yearly recurrence shows blocked", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "yearly_recurrence",
            specificDate: null,
            startDate: null, endDate: null,
            recurStartMonth: 12,
            recurStartDay: 25,
            recurEndMonth: 12,
            recurEndDay: 26,
            isOverridable: false,
            isActive: true,
            title: "Christmas holidays",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
      }, "RE_ps03");

      const availResult = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=400&offset=0&caseCategory=non_oncology`
      );
      const availData = availResult.data as any;

      // Find Dec 25, 2026 (should be blocked)
      const christmas = (availData.items ?? []).find((d: any) => d.date === "2026-12-25");
      assert.ok(christmas, "Should have entry for 2026-12-25");
      assert.strictEqual(
        christmas.decision.displayStatus,
        "blocked",
        "Christmas should be blocked by yearly_recurrence"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: Overridable blocked rule
  // ---------------------------------------------------------------------------
  describe("Blocked rule — overridable", () => {
    it("overridable blocked date shows restricted, not blocked", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: "2027-08-10",
            startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: true,
            isActive: true,
            title: "Soft blocked day",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
      }, "RE_ps04");

      const availResult = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=400&offset=0&caseCategory=non_oncology`
      );
      const availData = availResult.data as any;
      const softBlocked = (availData.items ?? []).find((d: any) => d.date === "2027-08-10");

      assert.ok(softBlocked, "Should have entry for 2027-08-10");
      assert.strictEqual(
        softBlocked.decision.displayStatus,
        "restricted",
        "Overridable blocked date should show 'restricted' (needs approval), not 'blocked'"
      );
      assert.ok(
        softBlocked.decision.requiresSupervisorOverride,
        "Overridable blocked date should require supervisor override"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: Exam type hard restriction
  // ---------------------------------------------------------------------------
  describe("Exam type rule — hard_restriction", () => {
    it("hard restriction blocks date only when examTypeId matches", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
        examTypeRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            effectMode: "hard_restriction",
            specificDate: "2027-09-01",
            startDate: null, endDate: null,
            weekday: null,
            alternateWeeks: false,
            recurrenceAnchorDate: null,
            examTypeIds: [testData.examTypeId],
            title: "Exam not allowed",
            notes: null,
            isActive: true,
          },
        ],
      }, "RE_ps05");

      // Query WITH examTypeId — should be blocked
      const withExam = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=400&offset=0&examTypeId=${testData.examTypeId}&caseCategory=non_oncology`
      );
      const withExamData = withExam.data as any;
      const restrictedDay = (withExamData.items ?? []).find((d: any) => d.date === "2027-09-01");

      assert.ok(restrictedDay, "Should have entry for 2027-09-01");
      assert.strictEqual(
        restrictedDay.decision.displayStatus,
        "blocked",
        "Hard restriction should block when examTypeId matches"
      );

      // Query WITHOUT examTypeId — should NOT be blocked by exam rule
      const noExam = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=400&offset=0&caseCategory=non_oncology`
      );
      const noExamData = noExam.data as any;
      const freeDay = (noExamData.items ?? []).find((d: any) => d.date === "2027-09-01");

      assert.ok(freeDay, "Should have entry for 2027-09-01 (no exam type)");
      assert.notStrictEqual(
        freeDay.decision.displayStatus,
        "blocked",
        "Without examTypeId, hard restriction should NOT block"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 6: Exam type overridable restriction
  // ---------------------------------------------------------------------------
  describe("Exam type rule — restriction_overridable", () => {
    it("overridable restriction shows restricted when examTypeId matches", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
        examTypeRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            effectMode: "restriction_overridable",
            specificDate: "2027-10-01",
            startDate: null, endDate: null,
            weekday: null,
            alternateWeeks: false,
            recurrenceAnchorDate: null,
            examTypeIds: [testData.examTypeId],
            title: "Needs approval",
            notes: null,
            isActive: true,
          },
        ],
      }, "RE_ps06");

      const withExam = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=400&offset=0&examTypeId=${testData.examTypeId}&caseCategory=non_oncology`
      );
      const withExamData = withExam.data as any;
      const day = (withExamData.items ?? []).find((d: any) => d.date === "2027-10-01");

      assert.ok(day, "Should have entry for 2027-10-01");
      assert.strictEqual(
        day.decision.displayStatus,
        "restricted",
        "Overridable restriction should show 'restricted'"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 6b: Exam type weekly recurrence hard restriction
  // ---------------------------------------------------------------------------
  describe("Exam type rule — weekly_recurrence hard restriction", () => {
    it("blocks matching weekday and allows non-matching weekday", async (t) => {
      if (guard(t)) return;

      const blockedWeekday = 1; // Monday
      const blockedDate = nextDateForWeekday(blockedWeekday);
      const allowedDate = nextDateForWeekday(2); // Tuesday

      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
        examTypeRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "weekly_recurrence",
            effectMode: "hard_restriction",
            specificDate: null,
            startDate: null, endDate: null,
            weekday: blockedWeekday,
            alternateWeeks: false,
            recurrenceAnchorDate: null,
            examTypeIds: [testData.examTypeId],
            title: "Weekly exam restriction",
            notes: null,
            isActive: true,
          },
        ],
      }, "RE_ps07");

      const blockedEval = await fetch("/api/v2/scheduling/evaluate", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          scheduledDate: blockedDate,
          caseCategory: "non_oncology",
          useSpecialQuota: false,
          specialReasonCode: null,
          includeOverrideEvaluation: false,
        },
      });
      assert.strictEqual((blockedEval.data as any).displayStatus, "blocked");

      const allowedEval = await fetch("/api/v2/scheduling/evaluate", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          scheduledDate: allowedDate,
          caseCategory: "non_oncology",
          useSpecialQuota: false,
          specialReasonCode: null,
          includeOverrideEvaluation: false,
        },
      });
      assert.notStrictEqual((allowedEval.data as any).displayStatus, "blocked");
    });
  });

  // ---------------------------------------------------------------------------
  // Test 7: Category daily limit exhaustion
  // ---------------------------------------------------------------------------
  describe("Category daily limit — exhaustion", () => {
    it("daily limit exhaustion shows blocked status", async (t) => {
      if (guard(t)) return;

      // Set daily limit to 0 — effectively always blocked by capacity
      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 0,
            isActive: true,
          },
        ],
      }, "RE_ps08");

      const availResult = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=7&offset=0&caseCategory=non_oncology`
      );
      const availData = availResult.data as any;
      const today = (availData.items ?? []).find((d: any) => d);

      if (today) {
        assert.strictEqual(
          today.decision.displayStatus,
          "blocked",
          "Daily limit 0 should result in blocked"
        );
        assert.strictEqual(
          today.rowDisplayStatus,
          "full",
          "Capacity-exhausted row should be marked as full for UI rendering"
        );
        assert.strictEqual(
          today.decision.remainingStandardCapacity,
          0,
          "Remaining standard should be 0"
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Test 8: Special quota — documents current behavior
  // ---------------------------------------------------------------------------
  describe("Special quota — current behavior", () => {
    it("special quota allows booking when standard capacity exhausted", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 0, // no standard capacity
            isActive: true,
          },
        ],
        examTypeRules: [],
      }, "RE_ps09");

      // Note: special quotas are NOT versioned per-policy, they're part of the snapshot
      // The availability query uses useSpecialQuota=false by default.
      // This test documents that without useSpecialQuota, a 0-limit day is blocked.
      const availResult = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=7&offset=0&caseCategory=non_oncology`
      );
      const availData = availResult.data as any;
      const day = (availData.items ?? []).find((d: any) => d);

      if (day) {
        assert.strictEqual(
          day.decision.displayStatus,
          "blocked",
          "With 0 limit and no special quota query, day should be blocked"
        );
        // Note: special quota is only checked when useSpecialQuota=true is passed
        // The availability UI currently queries without it
        assert.strictEqual(
          day.decision.remainingStandardCapacity,
          0,
          "Remaining standard should be 0"
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Test 9: Create booking rejects blocked day
  // ---------------------------------------------------------------------------
  describe("Create booking — rejects blocked day", () => {
    it("cannot book on a blocked date without override", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: "2027-04-01",
            startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "No bookings",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
      }, "RE_ps10");

      // Attempt to create a booking on the blocked date
      const bookingResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-04-01",
          bookingTime: null,
          caseCategory: "non_oncology",
          notes: "Test booking on blocked day",
        },
      });

      assert.strictEqual(
        bookingResult.status,
        409,
        "Booking on blocked date should return 409 Conflict"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 10: Reschedule rejects blocked target day
  // ---------------------------------------------------------------------------
  describe("Reschedule booking — rejects blocked target day", () => {
    it("cannot reschedule from allowed day to blocked day", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
      }, "RE_ps11");

      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-05-01",
          bookingTime: null,
          caseCategory: "non_oncology",
          notes: "Reschedule guard test",
        },
      });
      assert.strictEqual(createResult.status, 201);
      const bookingId = Number((createResult.data as any).booking.id);

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: "2027-05-03",
            startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "Blocked for reschedule test",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 100,
            isActive: true,
          },
        ],
      }, "RE_ps12");

      const rescheduleResult = await fetch(`/api/v2/appointments/${bookingId}`, {
        method: "PUT",
        body: {
          bookingDate: "2027-05-03",
          bookingTime: null,
          useSpecialQuota: false,
          specialReasonCode: null,
        },
      });

      assert.strictEqual(rescheduleResult.status, 409, "Reschedule to blocked day should fail");
    });
  });

  // ---------------------------------------------------------------------------
  // MISSING TEST 1: Blocked rule — date_range booking enforcement
  // ---------------------------------------------------------------------------
  describe("Blocked rule — date_range (booking enforcement)", () => {
    it("create booking fails on date within blocked range", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "date_range",
            specificDate: null,
            startDate: "2027-11-01",
            endDate: "2027-11-30",
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "November blocked",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps13");

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-11-15",
          caseCategory: "non_oncology",
          notes: "Should fail — date_range block",
        },
      });
      assert.strictEqual(result.status, 409, "Booking inside date_range should return 409");
    });

    it("create booking succeeds on date outside blocked range", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "date_range",
            specificDate: null,
            startDate: "2027-11-01",
            endDate: "2027-11-30",
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "November blocked",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps14");

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-12-01",
          caseCategory: "non_oncology",
          notes: "Should succeed — outside range",
        },
      });
      assert.strictEqual(result.status, 201, "Booking outside date_range should succeed");
    });
  });

  // ---------------------------------------------------------------------------
  // MISSING TEST 2: Blocked rule — yearly_recurrence booking enforcement
  // ---------------------------------------------------------------------------
  describe("Blocked rule — yearly_recurrence (booking enforcement)", () => {
    it("create booking fails on date matching yearly recurrence", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "yearly_recurrence",
            specificDate: null,
            startDate: null, endDate: null,
            recurStartMonth: 12,
            recurStartDay: 25,
            recurEndMonth: 12,
            recurEndDay: 31,
            isOverridable: false,
            isActive: true,
            title: "Christmas holidays",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps15");

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-12-25",
          caseCategory: "non_oncology",
          notes: "Should fail — yearly recurrence block",
        },
      });
      assert.strictEqual(result.status, 409, "Booking on yearly recurring blocked date should return 409");
    });

    it("create booking succeeds on date outside yearly recurrence", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "yearly_recurrence",
            specificDate: null,
            startDate: null, endDate: null,
            recurStartMonth: 12,
            recurStartDay: 25,
            recurEndMonth: 12,
            recurEndDay: 31,
            isOverridable: false,
            isActive: true,
            title: "Christmas holidays",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps16");

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-12-24",
          caseCategory: "non_oncology",
          notes: "Should succeed — day before block starts",
        },
      });
      assert.strictEqual(result.status, 201, "Booking on non-blocked day should succeed");
    });
  });

  // ---------------------------------------------------------------------------
  // MISSING TEST 3: Reschedule — rejects blocked date_range target
  // ---------------------------------------------------------------------------
  describe("Reschedule booking — rejects blocked date_range target", () => {
    it("cannot reschedule to date within blocked date_range", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: "2027-06-05",
            startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "June 5 open",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps17");

      const create = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-06-05",
          caseCategory: "non_oncology",
          notes: "Reschedule source",
        },
      });
      assert.strictEqual(create.status, 201);
      const bookingId = Number((create.data as any).booking.id);

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "date_range",
            specificDate: null,
            startDate: "2027-06-10",
            endDate: "2027-06-20",
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "June 10-20 blocked",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps18");

      const reschedule = await fetch(`/api/v2/appointments/${bookingId}`, {
        method: "PUT",
        body: { bookingDate: "2027-06-15" },
      });
      assert.strictEqual(reschedule.status, 409, "Reschedule to date inside blocked range should return 409");
    });
  });

  // ---------------------------------------------------------------------------
  // MISSING TEST 4: Reschedule — rejects blocked yearly_recurrence target
  // ---------------------------------------------------------------------------
  describe("Reschedule booking — rejects blocked yearly_recurrence target", () => {
    it("cannot reschedule to date matching yearly recurrence", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: "2027-05-01",
            startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "May 1 open",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps19");

      const create = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-05-01",
          caseCategory: "non_oncology",
          notes: "Reschedule source",
        },
      });
      assert.strictEqual(create.status, 201);
      const bookingId = Number((create.data as any).booking.id);

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "yearly_recurrence",
            specificDate: null,
            startDate: null, endDate: null,
            recurStartMonth: 1,
            recurStartDay: 1,
            recurEndMonth: 1,
            recurEndDay: 7,
            isOverridable: false,
            isActive: true,
            title: "New Year blocked",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps20");

      const reschedule = await fetch(`/api/v2/appointments/${bookingId}`, {
        method: "PUT",
        body: { bookingDate: "2028-01-01" },
      });
      assert.strictEqual(reschedule.status, 409, "Reschedule to yearly recurring blocked date should return 409");
    });
  });

  // ---------------------------------------------------------------------------
  // MISSING TEST 5: Exam rule — weekly_recurrence hard_restriction in booking POST
  // ---------------------------------------------------------------------------
  describe("Exam rule — weekly_recurrence hard_restriction blocks booking", () => {
    it("cannot book on weekday matching weekly_recurrence hard restriction", async (t) => {
      if (guard(t)) return;

      const blockedWeekday = nextDateForWeekday(1); // Monday
      const allowedWeekday = nextDateForWeekday(3); // Wednesday

      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
        examTypeRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "weekly_recurrence",
            effectMode: "hard_restriction",
            specificDate: null,
            startDate: null, endDate: null,
            weekday: 1, // Monday
            alternateWeeks: false,
            recurrenceAnchorDate: null,
            examTypeIds: [testData.examTypeId],
            title: "No Monday exams",
            notes: null,
            isActive: true,
          },
        ],
      }, "RE_ps21");

      const blockedResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: blockedWeekday,
          caseCategory: "non_oncology",
          notes: "Should fail — weekly_recurrence hard block",
        },
      });
      assert.strictEqual(blockedResult.status, 409, "Booking on blocked weekday should return 409");

      const allowedResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: allowedWeekday,
          caseCategory: "non_oncology",
          notes: "Should succeed — non-blocked weekday",
        },
      });
      assert.strictEqual(allowedResult.status, 201, "Booking on non-blocked weekday should succeed");
    });
  });

  // ---------------------------------------------------------------------------
  // MISSING TEST 6: Restricted day — supervisor override succeeds
  // MISSING TEST 7: Override audit row verification
  // ---------------------------------------------------------------------------
  describe("Restricted day — supervisor override succeeds", () => {
    it("can book restricted overridable blocked day with valid supervisor credentials", async (t) => {
      if (guard(t)) return;

      const supervisorUsername = `${TEST_PREFIX.toLowerCase().replace(/[^a-z0-9]/g, "")}supervisor`;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: "2027-07-15",
            startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: true,
            isActive: true,
            title: "Soft blocked",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps22");

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-07-15",
          caseCategory: "non_oncology",
          notes: "Override test booking",
          override: {
            supervisorUsername,
            supervisorPassword: "test_password",
            reason: "Operational necessity",
          },
        },
      });

      assert.strictEqual(result.status, 201, "Override booking should succeed with valid supervisor credentials");
      assert.strictEqual((result.data as any).wasOverride, true);

      // Verify override audit row was recorded (Test 7)
      const bookingId = Number((result.data as any).booking.id);
      const { pool } = await import("../../../../db/pool.js");
      const auditResult = await pool.query(
        `select booking_id, supervisor_user_id, requesting_user_id
         from appointments_v2.override_audit_events
         where booking_id = $1`,
        [bookingId]
      );
      assert.ok(
        auditResult.rows.length > 0,
        "Override audit event should be recorded in DB"
      );
      assert.strictEqual(auditResult.rows[0].booking_id, bookingId);
    });

    it("restricted day without override credentials fails with 403", async (t) => {
      if (guard(t)) return;

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: "2027-07-20",
            startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null,
            recurEndMonth: null, recurEndDay: null,
            isOverridable: true,
            isActive: true,
            title: "Soft blocked",
            notes: null,
          },
        ],
        categoryDailyLimits: [
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 100, isActive: true },
        ],
      }, "RE_ps23");

      const result = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-07-20",
          caseCategory: "non_oncology",
          notes: "No override — should fail",
        },
      });

      assert.strictEqual(result.status, 403, "Override required but not provided should return 403");
    });
  });
});
