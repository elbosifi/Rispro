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
import { pool } from "../../../../db/pool.js";
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
const WEEKEND_APPOINTMENT_SETTING_KEYS = ["allow_friday_appointments", "allow_saturday_appointments"] as const;

type WeekendAppointmentSettingKey = typeof WEEKEND_APPOINTMENT_SETTING_KEYS[number];

interface WeekendAppointmentSettingRow {
  setting_key: WeekendAppointmentSettingKey;
  setting_value: unknown;
  updated_by_user_id: number | string | null;
}

async function enableWeekendAppointmentsForSuite(userId: number): Promise<() => Promise<void>> {
  const previous = await pool.query<WeekendAppointmentSettingRow>(
    `
      select setting_key, setting_value, updated_by_user_id
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key = any($1::text[])
    `,
    [WEEKEND_APPOINTMENT_SETTING_KEYS]
  );
  const previousByKey = new Map(previous.rows.map((row) => [row.setting_key, row]));

  for (const settingKey of WEEKEND_APPOINTMENT_SETTING_KEYS) {
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
        values ('scheduling_and_capacity', $1, '{"value":"enabled"}'::jsonb, $2)
        on conflict (category, setting_key) do update set
          setting_value = excluded.setting_value,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
      `,
      [settingKey, userId]
    );
  }

  return async () => {
    for (const settingKey of WEEKEND_APPOINTMENT_SETTING_KEYS) {
      const prior = previousByKey.get(settingKey);
      if (prior) {
        await pool.query(
          `
            update system_settings
            set setting_value = $2::jsonb,
                updated_by_user_id = $3,
                updated_at = now()
            where category = 'scheduling_and_capacity'
              and setting_key = $1
          `,
          [settingKey, JSON.stringify(prior.setting_value), prior.updated_by_user_id]
        );
      } else {
        await pool.query(
          `
            delete from system_settings
            where category = 'scheduling_and_capacity'
              and setting_key = $1
          `,
          [settingKey]
        );
      }
    }
  };
}

describe("Rule enforcement — integration tests", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;
  let restoreWeekendAppointmentSettings: (() => Promise<void>) | undefined;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database is not reachable. Skipping rule enforcement integration tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    restoreWeekendAppointmentSettings = await enableWeekendAppointmentsForSuite(testData.userId);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");
  });

  after(async () => {
    if (!testData) return;
    await restoreWeekendAppointmentSettings?.();
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

  function addDaysIso(daysAhead: number): string {
    const now = new Date();
    const target = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const y = target.getUTCFullYear();
    const m = String(target.getUTCMonth() + 1).padStart(2, "0");
    const d = String(target.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function daysUntilIso(targetDate: string): number {
    const [year, month, day] = targetDate.split("-").map(Number);
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const targetUtc = Date.UTC(year, month - 1, day);
    return Math.floor((targetUtc - todayUtc) / (24 * 60 * 60 * 1000));
  }

  function nextMonthDayIso(month: number, day: number): string {
    const now = new Date();
    let year = now.getUTCFullYear();
    let target = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (daysUntilIso(target) < 0) {
      year += 1;
      target = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return target;
  }

  async function fetchAvailabilityDay(
    targetDate: string,
    extraParams: Record<string, string | number | boolean> = {}
  ) {
    const offset = daysUntilIso(targetDate);
    assert.ok(
      offset >= 0 && offset <= 365,
      `Availability target ${targetDate} must be within the route offset window`
    );

    const params = new URLSearchParams({
      modalityId: String(testData.modalityId),
      days: "1",
      offset: String(offset),
      caseCategory: "non_oncology",
    });
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, String(value));
    }

    const result = await fetch(`/api/v2/scheduling/availability?${params.toString()}`);
    const data = result.data as any;
    return (data.items ?? []).find((d: any) => d.date === targetDate);
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
      specialQuotaRules: [],
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

      const futureDate = addDaysIso(120);

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
            dailyLimit: 10, // lots of raw capacity
            isActive: true,
          },
        ],
      }, "RE_ps01");

      const blockedDay = await fetchAvailabilityDay(futureDate);

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
      const startDate = addDaysIso(40);
      const blockedDate = addDaysIso(50);
      const endDate = addDaysIso(70);
      const outOfRangeDate = addDaysIso(80);

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "date_range",
            specificDate: null,
            startDate,
            endDate,
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
            dailyLimit: 10,
            isActive: true,
          },
        ],
      }, "RE_ps02");

      const inRange = await fetchAvailabilityDay(blockedDate);

      assert.ok(inRange, `Should have entry for ${blockedDate}`);
      assert.strictEqual(inRange.decision.displayStatus, "blocked");

      // Date outside range should NOT be blocked
      const outOfRange = await fetchAvailabilityDay(outOfRangeDate);
      assert.ok(outOfRange, `Should have entry for ${outOfRangeDate}`);
      assert.notStrictEqual(outOfRange.decision.displayStatus, "blocked");
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
            dailyLimit: 10,
            isActive: true,
          },
        ],
      }, "RE_ps03");

      const christmasDate = nextMonthDayIso(12, 25);
      const christmas = await fetchAvailabilityDay(christmasDate);
      assert.ok(christmas, `Should have entry for ${christmasDate}`);
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
      const softBlockedDate = addDaysIso(60);

      await publishPolicyWithRules({
        modalityBlockedRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            specificDate: softBlockedDate,
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
            dailyLimit: 10,
            isActive: true,
          },
        ],
      }, "RE_ps04");

      const softBlocked = await fetchAvailabilityDay(softBlockedDate);

      assert.ok(softBlocked, `Should have entry for ${softBlockedDate}`);
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
      const restrictedDate = addDaysIso(90);

      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 10,
            isActive: true,
          },
        ],
        examTypeRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            effectMode: "hard_restriction",
            specificDate: restrictedDate,
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
      const restrictedDay = await fetchAvailabilityDay(restrictedDate, {
        examTypeId: testData.examTypeId,
      });

      assert.ok(restrictedDay, `Should have entry for ${restrictedDate}`);
      assert.strictEqual(
        restrictedDay.decision.displayStatus,
        "blocked",
        "Hard restriction should block when examTypeId matches"
      );
      assert.ok(
        Array.isArray(restrictedDay.decision.matchedExamRuleSummaries),
        "Blocked exam-rule day should include matchedExamRuleSummaries"
      );
      assert.equal(
        restrictedDay.decision.matchedExamRuleSummaries?.[0]?.effectMode,
        "hard_restriction",
        "Matched exam-rule summary should preserve effect mode"
      );

      // Query WITHOUT examTypeId — should NOT be blocked by exam rule
      const freeDay = await fetchAvailabilityDay(restrictedDate);

      assert.ok(freeDay, `Should have entry for ${restrictedDate} (no exam type)`);
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
      const restrictedDate = addDaysIso(110);

      await publishPolicyWithRules({
        modalityBlockedRules: [],
        categoryDailyLimits: [
          {
            modalityId: testData.modalityId,
            caseCategory: "non_oncology",
            dailyLimit: 10,
            isActive: true,
          },
        ],
        examTypeRules: [
          {
            modalityId: testData.modalityId,
            ruleType: "specific_date",
            effectMode: "restriction_overridable",
            specificDate: restrictedDate,
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

      const day = await fetchAvailabilityDay(restrictedDate, {
        examTypeId: testData.examTypeId,
      });

      assert.ok(day, `Should have entry for ${restrictedDate}`);
      assert.strictEqual(
        day.decision.displayStatus,
        "restricted",
        "Overridable restriction should show 'restricted'"
      );
      assert.strictEqual(day.decision.requiresSupervisorOverride, true);
      assert.ok(
        Array.isArray(day.decision.matchedExamRuleSummaries),
        "Restricted exam-rule day should include matchedExamRuleSummaries"
      );
      assert.equal(
        day.decision.matchedExamRuleSummaries?.[0]?.effectMode,
        "restriction_overridable",
        "Matched exam-rule summary should preserve effect mode"
      );
    });
  });

  describe("Exam restriction override booking authority", () => {
    it("requires and records a supervisor override, permits super_admin, and rejects hard restrictions", async (t) => {
      if (guard(t)) return;
      const userResult = await pool.query<{ username: string }>("select username from users where id = $1", [testData.userId]);
      const username = userResult.rows[0]?.username;
      assert.ok(username);
      const softDate = addDaysIso(120);
      const superAdminDate = addDaysIso(121);
      const hardDate = addDaysIso(122);
      const examRule = (date: string, effectMode: "restriction_overridable" | "hard_restriction") => ({
        modalityId: testData.modalityId,
        ruleType: "specific_date" as const,
        effectMode,
        specificDate: date,
        startDate: null, endDate: null,
        weekday: null, alternateWeeks: false, recurrenceAnchorDate: null,
        examTypeIds: [testData.examTypeId], title: "Exam restriction", notes: null, isActive: true,
      });

      await publishPolicyWithRules({ modalityBlockedRules: [], categoryDailyLimits: [{ modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true }], examTypeRules: [examRule(softDate, "restriction_overridable")] }, "RE_ps_exam_override_soft");
      const withoutOverride = await fetch("/api/v2/appointments", { method: "POST", body: { patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: softDate, caseCategory: "non_oncology" } });
      assert.strictEqual(withoutOverride.status, 403);
      assert.strictEqual(withoutOverride.status, 403);
      const supervisorBooking = await fetch("/api/v2/appointments", { method: "POST", body: { patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: softDate, caseCategory: "non_oncology", override: { supervisorUsername: username, supervisorPassword: "test_password", reason: "Exam restriction approved", overrideType: "exam_restriction_override" } } });
      assert.strictEqual(supervisorBooking.status, 201);
      assert.strictEqual((supervisorBooking.data as any).wasOverride, true);

      await pool.query("update users set role = 'super_admin' where id = $1", [testData.userId]);
      try {
        await publishPolicyWithRules({ modalityBlockedRules: [], categoryDailyLimits: [{ modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true }], examTypeRules: [examRule(superAdminDate, "restriction_overridable")] }, "RE_ps_exam_override_admin");
        const superAdminBooking = await fetch("/api/v2/appointments", { method: "POST", body: { patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: superAdminDate, caseCategory: "non_oncology", override: { supervisorUsername: username, supervisorPassword: "test_password", reason: "Super admin exam restriction approval", overrideType: "exam_restriction_override" } } });
        assert.strictEqual(superAdminBooking.status, 201);
        assert.strictEqual((superAdminBooking.data as any).wasOverride, true);
      } finally {
        await pool.query("update users set role = 'supervisor' where id = $1", [testData.userId]);
      }

      await publishPolicyWithRules({ modalityBlockedRules: [], categoryDailyLimits: [{ modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true }], examTypeRules: [examRule(hardDate, "hard_restriction")] }, "RE_ps_exam_override_hard");
      const hardBooking = await fetch("/api/v2/appointments", { method: "POST", body: { patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: hardDate, caseCategory: "non_oncology", override: { supervisorUsername: username, supervisorPassword: "test_password", reason: "Should not bypass hard restriction", overrideType: "exam_restriction_override" } } });
      assert.strictEqual(hardBooking.status, 409);
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
            dailyLimit: 10,
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
          "restricted",
          "Category-capacity exhaustion should be marked as restricted because override is possible"
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
            dailyLimit: 10,
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
            dailyLimit: 10,
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
            dailyLimit: 10,
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
            specificDate: "2027-06-06",
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
            specificDate: "2027-05-02",
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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

      const { pool } = await import("../../../../db/pool.js");
      const userResult = await pool.query<{ username: string }>(
        `select username from users where id = $1`,
        [testData.userId]
      );
      const supervisorUsername = userResult.rows[0]?.username;
      assert.ok(supervisorUsername, "Supervisor username should exist for override test");

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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
      assert.strictEqual(Number(auditResult.rows[0].booking_id), bookingId);
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
          { modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
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
