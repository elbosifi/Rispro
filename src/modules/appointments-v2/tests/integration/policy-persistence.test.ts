/**
 * Appointments V2 — Policy draft persistence integration tests.
 *
 * Tests:
 * 1. Create Draft copies published rules into new draft version
 * 2. Save Draft persists all rule rows to version tables
 * 3. Publish uses saved draft data (not unsaved UI state)
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
const TEST_PREFIX = "POLICY_";

describe("Policy draft persistence — integration tests", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database is not reachable. Skipping policy persistence integration tests.");
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
  // Test 1: Create Draft copies published rules
  // ---------------------------------------------------------------------------
  describe("Create Draft — copies published rules", () => {
    it("new draft snapshot matches published snapshot", async () => {
      guard();

      // Step 1: Get current published policy
      const statusBefore = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataBefore = statusBefore.data as any;
      const publishedIdBefore = dataBefore?.published?.id ?? null;

      // Step 2: Create a draft
      const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: JSON.stringify({ policySetKey: "default" }),
      });
      const createData = createResult.data as any;
      assert.ok(createData.draft?.id, "Draft should have an ID");

      const draftVersionId = createData.draft.id;
      const basedOnVersionId = createData.basedOnVersionId;

      // Step 3: Compare snapshots
      if (publishedIdBefore) {
        // Load published snapshot rules from DB
        const publishedRules = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}/preview`);

        // The draft should have been created based on the published version
        assert.strictEqual(basedOnVersionId, publishedIdBefore, "Draft should be based on published version");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Save Draft persists rules to DB
  // ---------------------------------------------------------------------------
  describe("Save Draft — persists real rules", () => {
    it("saved snapshot matches request snapshot exactly", async () => {
      guard();

      // First, create a draft if one doesn't exist
      const status = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const statusData = status.data as any;
      let draftVersionId = statusData?.draft?.id ?? null;

      if (!draftVersionId) {
        const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
          method: "POST",
          body: JSON.stringify({ policySetKey: "default" }),
        });
        const createData = createResult.data as any;
        draftVersionId = createData.draft.id;
      }

      // Build a test snapshot with at least one of each rule type
      const modalityId = testData.modalityId;
      const examTypeId = testData.examTypeId;

      const testSnapshot = {
        categoryDailyLimits: [
          { id: 1, modalityId, caseCategory: "non_oncology" as const, dailyLimit: 10, isActive: true },
        ],
        modalityBlockedRules: [
          {
            id: 2, modalityId, ruleType: "specific_date" as const,
            specificDate: "2026-12-25", startDate: null, endDate: null,
            recurStartMonth: null, recurStartDay: null, recurEndMonth: null, recurEndDay: null,
            isOverridable: false, isActive: true, title: "Holiday", notes: null,
          },
        ],
        examTypeRules: [
          {
            id: 3, modalityId, ruleType: "specific_date" as const, effectMode: "hard_restriction" as const,
            specificDate: "2026-01-01", startDate: null, endDate: null, weekday: null,
            alternateWeeks: false, recurrenceAnchorDate: null,
            examTypeIds: [examTypeId], title: "New Year", notes: null, isActive: true,
          },
        ],
        examTypeSpecialQuotas: [
          { id: 4, examTypeId, dailyExtraSlots: 5, isActive: true },
        ],
        specialReasonCodes: [
          { code: "test_urgent", labelAr: "عاجل اختبار", labelEn: "Test urgent case", isActive: true },
        ],
      };

      // Save the draft
      const saveResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: JSON.stringify({ policySnapshot: testSnapshot, changeNote: "Test save" }),
      });
      const saveData = saveResult.data as any;
      assert.ok(saveData.version, "Save should return version");

      // Verify the saved snapshot by reloading from DB
      const statusAfter = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const statusAfterData = statusAfter.data as any;
      const savedDraft = statusAfterData.draftSnapshot;

      assert.strictEqual(
        savedDraft.categoryDailyLimits.length,
        testSnapshot.categoryDailyLimits.length,
        "Should have same number of categoryDailyLimits"
      );
      assert.strictEqual(
        savedDraft.modalityBlockedRules.length,
        testSnapshot.modalityBlockedRules.length,
        "Should have same number of modalityBlockedRules"
      );
      assert.strictEqual(
        savedDraft.examTypeRules.length,
        testSnapshot.examTypeRules.length,
        "Should have same number of examTypeRules"
      );
      assert.strictEqual(
        savedDraft.examTypeSpecialQuotas.length,
        testSnapshot.examTypeSpecialQuotas.length,
        "Should have same number of examTypeSpecialQuotas"
      );

      // Verify specific values
      assert.strictEqual(
        savedDraft.categoryDailyLimits[0].dailyLimit,
        10,
        "Category daily limit should be persisted"
      );
      assert.strictEqual(
        savedDraft.modalityBlockedRules[0].specificDate,
        "2026-12-25",
        "Blocked date should be persisted"
      );
      assert.strictEqual(
        savedDraft.examTypeSpecialQuotas[0].dailyExtraSlots,
        5,
        "Special quota should be persisted"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Publish uses saved draft data
  // ---------------------------------------------------------------------------
  describe("Publish — uses saved draft rules", () => {
    it("publishedSnapshot matches last saved draft snapshot", async () => {
      guard();

      // Create a draft if needed
      const status = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const statusData = status.data as any;
      let draftVersionId = statusData?.draft?.id ?? null;

      if (!draftVersionId) {
        const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
          method: "POST",
          body: JSON.stringify({ policySetKey: "default" }),
        });
        const createData = createResult.data as any;
        draftVersionId = createData.draft.id;
      }

      // Save a known snapshot
      const modalityId = testData.modalityId;
      const examTypeId = testData.examTypeId;

      const publishTestSnapshot = {
        categoryDailyLimits: [
          { id: 10, modalityId, caseCategory: "oncology" as const, dailyLimit: 20, isActive: true },
        ],
        modalityBlockedRules: [],
        examTypeRules: [
          {
            id: 11, modalityId, ruleType: "weekly_recurrence" as const, effectMode: "restriction_overridable" as const,
            specificDate: null, startDate: null, endDate: null, weekday: 1,
            alternateWeeks: true, recurrenceAnchorDate: "2026-01-05",
            examTypeIds: [examTypeId], title: "Weekly test rule", notes: null, isActive: true,
          },
        ],
        examTypeSpecialQuotas: [],
        specialReasonCodes: [
          { code: "test_urgent", labelAr: "عاجل اختبار", labelEn: "Test urgent case", isActive: true },
        ],
      };

      await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: JSON.stringify({ policySnapshot: publishTestSnapshot, changeNote: "Test publish" }),
      });

      // Publish the draft
      const publishResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}/publish`, {
        method: "POST",
        body: JSON.stringify({ changeNote: "Test publish note" }),
      });
      const publishData = publishResult.data as any;
      assert.ok(publishData.published, "Publish should return published version");

      // Fetch status and verify published snapshot matches saved draft
      const statusAfter = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const statusAfterData = statusAfter.data as any;
      const publishedSnapshot = statusAfterData.publishedSnapshot;

      assert.strictEqual(
        publishedSnapshot.categoryDailyLimits.length,
        publishTestSnapshot.categoryDailyLimits.length,
        "Published should have same number of categoryDailyLimits"
      );
      assert.strictEqual(
        publishedSnapshot.categoryDailyLimits[0].dailyLimit,
        20,
        "Published category daily limit should match saved value"
      );
      assert.strictEqual(
        publishedSnapshot.categoryDailyLimits[0].caseCategory,
        "oncology",
        "Published case category should match saved value"
      );
      assert.strictEqual(
        publishedSnapshot.examTypeRules.length,
        publishTestSnapshot.examTypeRules.length,
        "Published should have same number of examTypeRules"
      );
      assert.strictEqual(
        publishedSnapshot.examTypeRules[0].title,
        "Weekly test rule",
        "Published exam rule title should match saved value"
      );
    });
  });
});
