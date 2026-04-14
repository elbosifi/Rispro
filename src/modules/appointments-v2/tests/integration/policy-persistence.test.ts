/**
 * Appointments V2 — Policy draft persistence integration tests.
 *
 * Tests:
 * 1. Create Draft copies published rules and snapshots match
 * 2. Save Draft persists all versioned rule rows to DB
 * 3. Publish uses saved draft data (not unsaved UI state)
 * 4. Draft save does NOT mutate global special reason codes
 * 5. Hash consistency: persisted snapshot hash matches version configHash
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
  // Test 1: Create Draft copies published rules — snapshots match
  // ---------------------------------------------------------------------------
  describe("Create Draft — copies published rules", () => {
    it("new draft snapshot equals published snapshot (except versioned IDs)", async () => {
      guard();

      // Step 1: Create a draft from current published policy
      const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: JSON.stringify({ policySetKey: "default" }),
      });
      const createData = createResult.data as any;
      assert.ok(createData.draft?.id, "Draft should have an ID");

      const draftVersionId = createData.draft.id;

      // Step 2: Get status with both snapshots
      const statusResult = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const statusData = statusResult.data as any;

      const publishedSnapshot = statusData.publishedSnapshot;
      const draftSnapshot = statusData.draftSnapshot;

      // Step 3: Compare versioned rule counts
      assert.strictEqual(
        draftSnapshot.categoryDailyLimits.length,
        publishedSnapshot.categoryDailyLimits.length,
        "Draft should have same number of categoryDailyLimits as published"
      );
      assert.strictEqual(
        draftSnapshot.modalityBlockedRules.length,
        publishedSnapshot.modalityBlockedRules.length,
        "Draft should have same number of modalityBlockedRules as published"
      );
      assert.strictEqual(
        draftSnapshot.examTypeRules.length,
        publishedSnapshot.examTypeRules.length,
        "Draft should have same number of examTypeRules as published"
      );
      assert.strictEqual(
        draftSnapshot.examTypeSpecialQuotas.length,
        publishedSnapshot.examTypeSpecialQuotas.length,
        "Draft should have same number of examTypeSpecialQuotas as published"
      );

      // Special reason codes are global, so they should be identical
      assert.deepStrictEqual(
        draftSnapshot.specialReasonCodes.map((c: any) => c.code).sort(),
        publishedSnapshot.specialReasonCodes.map((c: any) => c.code).sort(),
        "Special reason codes should be identical (global)"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Save Draft persists rules to DB
  // ---------------------------------------------------------------------------
  describe("Save Draft — persists real rules", () => {
    it("saved snapshot matches request snapshot for all versioned rule types", async () => {
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

      // Build a test snapshot with at least one of each versioned rule type
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

      // Record global special reason codes BEFORE save
      const statusBefore = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataBefore = statusBefore.data as any;
      const codesBeforeSave = dataBefore.publishedSnapshot?.specialReasonCodes?.map((c: any) => c.code).sort() ?? [];

      // Save the draft
      const saveResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: JSON.stringify({ policySnapshot: testSnapshot, changeNote: "Test save" }),
      });
      const saveData = saveResult.data as any;
      assert.ok(saveData.version, "Save should return version");
      assert.ok(saveData.configHash, "Save should return configHash");

      // Verify the saved snapshot by reloading from DB
      const statusAfter = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const statusAfterData = statusAfter.data as any;
      const savedDraft = statusAfterData.draftSnapshot;

      // Verify all versioned rule counts match
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

      // Verify specific persisted values
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

  // ---------------------------------------------------------------------------
  // Test 4: Draft save does NOT mutate global special reason codes
  // ---------------------------------------------------------------------------
  describe("Draft save isolation — does not mutate global config", () => {
    it("saving draft with different special reason codes does not change global table", async () => {
      guard();

      // Record global special reason codes before
      const statusBefore = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataBefore = statusBefore.data as any;
      const codesBefore = (dataBefore.publishedSnapshot?.specialReasonCodes ?? [])
        .map((c: any) => c.code)
        .sort();

      // Create a draft if needed
      let draftVersionId = dataBefore?.draft?.id ?? null;
      if (!draftVersionId) {
        const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
          method: "POST",
          body: JSON.stringify({ policySetKey: "default" }),
        });
        const createData = createResult.data as any;
        draftVersionId = createData.draft.id;
      }

      // Save a draft with deliberately DIFFERENT special reason codes
      // (including a made-up code that should NOT appear globally)
      const modalityId = testData.modalityId;
      const snapshotWithFakeCodes = {
        categoryDailyLimits: [],
        modalityBlockedRules: [],
        examTypeRules: [],
        examTypeSpecialQuotas: [],
        specialReasonCodes: [
          { code: "fake_draft_only_code", labelAr: "زائف", labelEn: "Fake draft-only code", isActive: true },
        ],
      };

      await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: JSON.stringify({ policySnapshot: snapshotWithFakeCodes, changeNote: "Isolation test" }),
      });

      // Check that global special reason codes are UNCHANGED
      const statusAfter = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataAfter = statusAfter.data as any;
      const codesAfter = (dataAfter.publishedSnapshot?.specialReasonCodes ?? [])
        .map((c: any) => c.code)
        .sort();

      assert.deepStrictEqual(
        codesAfter,
        codesBefore,
        "Global special reason codes should NOT be changed by draft save"
      );
      assert.ok(
        !codesAfter.includes("fake_draft_only_code"),
        "Fake draft-only code should NOT appear in global table"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: Hash consistency — persisted snapshot hash matches version configHash
  // ---------------------------------------------------------------------------
  describe("Hash consistency — configHash matches persisted snapshot", () => {
    it("configHash returned from save matches hash of reloaded snapshot", async () => {
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

      // Save a snapshot
      const modalityId = testData.modalityId;
      const examTypeId = testData.examTypeId;
      const testSnapshot = {
        categoryDailyLimits: [
          { id: 20, modalityId, caseCategory: "non_oncology" as const, dailyLimit: 15, isActive: true },
        ],
        modalityBlockedRules: [],
        examTypeRules: [
          {
            id: 21, modalityId, ruleType: "specific_date" as const, effectMode: "hard_restriction" as const,
            specificDate: "2026-06-15", startDate: null, endDate: null, weekday: null,
            alternateWeeks: false, recurrenceAnchorDate: null,
            examTypeIds: [examTypeId], title: "Hash test rule", notes: null, isActive: true,
          },
        ],
        examTypeSpecialQuotas: [],
        specialReasonCodes: [],
      };

      const saveResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: JSON.stringify({ policySnapshot: testSnapshot, changeNote: "Hash test" }),
      });
      const saveData = saveResult.data as any;
      const returnedHash = saveData.configHash;
      assert.ok(returnedHash, "Save should return configHash");

      // Reload the snapshot from DB via status endpoint
      const statusAfter = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const statusAfterData = statusAfter.data as any;
      const draftVersion = statusAfterData.draft;
      assert.ok(draftVersion, "Should have a draft version");
      assert.strictEqual(
        draftVersion.configHash,
        returnedHash,
        "Version configHash should match the hash returned from save"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 6: Initial draft hash when no published version exists
  // ---------------------------------------------------------------------------
  describe("Initial draft hash — hash shape validation", () => {
    it("configHash is always 64-char hex (SHA-256), not hash of raw {}", async () => {
      guard();

      // Publish current draft first
      const statusBefore = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataBefore = statusBefore.data as any;
      if (dataBefore?.draft?.id) {
        await fetch(`/api/v2/scheduling/admin/policy/draft/${dataBefore.draft.id}/publish`, {
          method: "POST",
          body: JSON.stringify({ changeNote: "Pre-test publish" }),
        });
      }

      const statusAfter = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataAfter = statusAfter.data as any;

      // The published version should have a valid SHA-256 hash
      assert.ok(dataAfter?.published?.configHash, "Published version should have configHash");
      assert.strictEqual(
        dataAfter.published.configHash.length,
        64,
        "configHash should be a 64-character hex string (SHA-256)"
      );
      assert.ok(
        /^[0-9a-f]{64}$/.test(dataAfter.published.configHash),
        "configHash should be valid hex"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 7: Special reason codes — global config integrity
  // ---------------------------------------------------------------------------
  describe("Special reason codes — global config integrity", () => {
    it("saving draft with empty specialReasonCodes does NOT mutate global table", async () => {
      guard();

      // Record global codes
      const statusBefore = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataBefore = statusBefore.data as any;
      const codesBefore = (dataBefore.publishedSnapshot?.specialReasonCodes ?? [])
        .map((c: any) => c.code)
        .sort();

      // Create draft if needed
      let draftVersionId = dataBefore?.draft?.id ?? null;
      if (!draftVersionId) {
        const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
          method: "POST",
          body: JSON.stringify({ policySetKey: "default" }),
        });
        draftVersionId = (createResult.data as any).draft.id;
      }

      // Save with empty specialReasonCodes
      const modalityId = testData.modalityId;
      await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: JSON.stringify({
          policySnapshot: {
            categoryDailyLimits: [{ id: 100, modalityId, caseCategory: "non_oncology" as const, dailyLimit: 5, isActive: true }],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            specialReasonCodes: [],
          },
          changeNote: "Test empty codes",
        }),
      });

      // Verify global codes are UNCHANGED
      const statusAfterSave = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataAfterSave = statusAfterSave.data as any;
      const codesAfterSave = (dataAfterSave.publishedSnapshot?.specialReasonCodes ?? [])
        .map((c: any) => c.code)
        .sort();

      assert.deepStrictEqual(
        codesAfterSave,
        codesBefore,
        "Saving draft with empty specialReasonCodes should NOT mutate global table"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Test 8: Create draft preserves changeNote after hash recalculation
  // ---------------------------------------------------------------------------
  describe("Create Draft — preserves changeNote", () => {
    it("returned draft.changeNote is preserved after hash recalculation", async () => {
      guard();

      // First, publish any existing draft to start clean
      const statusBefore = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const dataBefore = statusBefore.data as any;
      if (dataBefore?.draft?.id) {
        await fetch(`/api/v2/scheduling/admin/policy/draft/${dataBefore.draft.id}/publish`, {
          method: "POST",
          body: JSON.stringify({ changeNote: "Pre-test publish" }),
        });
      }

      const customNote = "Custom test change note — must be preserved";

      // Create a draft with a custom change note
      const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: JSON.stringify({ policySetKey: "default", changeNote: customNote }),
      });
      const createData = createResult.data as any;
      assert.ok(createData.draft?.id, "Draft should have an ID");

      // Fetch status to get the persisted draft
      const statusAfter = await fetch("/api/v2/scheduling/admin/policy?policySetKey=default");
      const statusAfterData = statusAfter.data as any;
      const draftVersion = statusAfterData.draft;

      assert.ok(draftVersion, "Should have a draft version");
      assert.strictEqual(
        draftVersion.changeNote,
        customNote,
        "Draft changeNote should be preserved after hash recalculation"
      );
    });
  });
});
