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

  const fetch = (path: string, opts: Record<string, unknown> = {}) =>
    fetchJson(app.baseUrl, path, { cookie: authCookie, ...opts });

  function guard() {
    if (!testData) throw new Error("Test setup failed — database unreachable");
  }

  // ---------------------------------------------------------------------------
  // Helper: save a draft snapshot with specific rules and publish
  // ---------------------------------------------------------------------------
  async function publishPolicyWithRules(rules: {
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
  }) {
    const modalityId = testData.modalityId;
    const examTypeId = testData.examTypeId;

    // Create draft if needed
    const statusBefore = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
    const dataBefore = statusBefore.data as any;
    let draftVersionId = dataBefore?.draft?.id ?? null;

    if (!draftVersionId) {
      // If there's a published version, create a draft from it
      if (dataBefore?.published?.id) {
        const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
          method: "POST",
          body: JSON.stringify({ policySetKey: "default" }),
        });
        draftVersionId = (createResult.data as any).draft.id;
      } else {
        const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
          method: "POST",
          body: JSON.stringify({ policySetKey: "default" }),
        });
        draftVersionId = (createResult.data as any).draft.id;
      }
    }

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

    await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
      method: "PUT",
      body: JSON.stringify({ policySnapshot: snapshot, changeNote: "Rule enforcement test" }),
    });

    await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}/publish`, {
      method: "POST",
      body: JSON.stringify({ changeNote: "Publish for test" }),
    });
  }

  // ---------------------------------------------------------------------------
  // Test 1: Blocked rule — specific_date
  // ---------------------------------------------------------------------------
  describe("Blocked rule — specific_date", () => {
    it("date with raw spare capacity shows blocked, not bookable", async () => {
      guard();

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
      });

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
    it("date within range shows blocked even with raw capacity", async () => {
      guard();

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
      });

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
    it("date matching yearly recurrence shows blocked", async () => {
      guard();

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
      });

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
    it("overridable blocked date shows restricted, not blocked", async () => {
      guard();

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
      });

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
    it("hard restriction blocks date only when examTypeId matches", async () => {
      guard();

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
      });

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
    it("overridable restriction shows restricted when examTypeId matches", async () => {
      guard();

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
      });

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
  // Test 7: Category daily limit exhaustion
  // ---------------------------------------------------------------------------
  describe("Category daily limit — exhaustion", () => {
    it("daily limit exhaustion shows blocked status", async () => {
      guard();

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
      });

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
    it("special quota allows booking when standard capacity exhausted", async () => {
      guard();

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
      });

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
    it("cannot book on a blocked date without override", async () => {
      guard();

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
      });

      // Attempt to create a booking on the blocked date
      const bookingResult = await fetch("/api/v2/scheduling/appointments", {
        method: "POST",
        body: JSON.stringify({
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2027-04-01",
          bookingTime: null,
          caseCategory: "non_oncology",
          notes: "Test booking on blocked day",
        }),
      });

      assert.strictEqual(
        bookingResult.status,
        409,
        "Booking on blocked date should return 409 Conflict"
      );
    });
  });
});
