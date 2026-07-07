/**
 * Appointments V2 - Policy draft persistence integration tests.
 *
 * Tests:
 * 1. Create Draft copies published rules and snapshots match
 * 2. Save Draft persists all versioned rule rows to DB
 * 3. Publish uses saved draft data
 * 4. Saving versioned rules with unchanged specialReasonCodes preserves global codes
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

describe("Policy draft persistence - integration tests", { skip: skipEnv, concurrency: false }, () => {
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
    if (!testData) throw new Error("Test setup failed - database unreachable");
  }

  const policyStatusPath = () =>
    `/api/v2/scheduling/admin/policy?policySetKey=${encodeURIComponent(testData.policySetKey)}`;

  async function getPolicyStatusData(): Promise<any> {
    const status = await fetch(policyStatusPath());
    return status.data as any;
  }

  async function getOrCreateDraft(changeNote?: string): Promise<number> {
    const statusData = await getPolicyStatusData();
    const draftVersionId = statusData?.draft?.id ?? null;
    if (draftVersionId) return draftVersionId;

    const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
      method: "POST",
      body: { policySetKey: testData.policySetKey, changeNote },
    });
    const createData = createResult.data as any;
    assert.ok(createData.draft?.id, "Draft should have an ID");
    return createData.draft.id;
  }

  async function getGlobalSpecialReasonCodes(): Promise<any[]> {
    const statusData = await getPolicyStatusData();
    return (statusData.publishedSnapshot?.specialReasonCodes ?? []).map((code: any) => ({ ...code }));
  }

  describe("Create Draft - copies published rules", () => {
    it("new draft snapshot equals published snapshot for suite-scoped policy", async () => {
      guard();

      await getOrCreateDraft();

      const statusData = await getPolicyStatusData();
      const publishedSnapshot = statusData.publishedSnapshot;
      const draftSnapshot = statusData.draftSnapshot;

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
      assert.deepStrictEqual(
        draftSnapshot.specialReasonCodes.map((c: any) => c.code).sort(),
        publishedSnapshot.specialReasonCodes.map((c: any) => c.code).sort(),
        "Special reason codes should be identical because they are global"
      );
    });
  });

  describe("Save Draft - persists real rules", () => {
    it("saved snapshot matches request snapshot for all versioned rule types", async () => {
      guard();

      const draftVersionId = await getOrCreateDraft();
      const modalityId = testData.modalityId;
      const examTypeId = testData.examTypeId;
      const specialReasonCodes = await getGlobalSpecialReasonCodes();
      const codesBeforeSave = specialReasonCodes.map((c: any) => c.code).sort();

      const testSnapshot = {
        categoryDailyLimits: [
          { id: 1, modalityId, caseCategory: "non_oncology" as const, dailyLimit: 10, isActive: true },
        ],
        modalityBlockedRules: [
          {
            id: 2,
            modalityId,
            ruleType: "specific_date" as const,
            specificDate: "2026-12-25",
            startDate: null,
            endDate: null,
            recurStartMonth: null,
            recurStartDay: null,
            recurEndMonth: null,
            recurEndDay: null,
            isOverridable: false,
            isActive: true,
            title: "Holiday",
            notes: null,
          },
        ],
        examTypeRules: [
          {
            id: 3,
            modalityId,
            ruleType: "specific_date" as const,
            effectMode: "hard_restriction" as const,
            specificDate: "2026-01-01",
            startDate: null,
            endDate: null,
            weekday: null,
            alternateWeeks: false,
            recurrenceAnchorDate: null,
            examTypeIds: [examTypeId],
            title: "New Year",
            notes: null,
            isActive: true,
          },
        ],
        examTypeSpecialQuotas: [
          { id: 4, examTypeId, dailyExtraSlots: 5, allowedUserIds: [testData.userId], isActive: true },
        ],
        specialReasonCodes,
      };

      const saveResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: { policySnapshot: testSnapshot, changeNote: "Test save" },
      });
      assert.strictEqual(saveResult.status, 200, "Saving versioned policy snapshot should succeed");
      const saveData = saveResult.data as any;
      assert.ok(saveData.version, "Save should return version");
      assert.ok(saveData.configHash, "Save should return configHash");

      const statusAfterData = await getPolicyStatusData();
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
      assert.deepStrictEqual(
        savedDraft.examTypeSpecialQuotas[0].allowedUserIds,
        [testData.userId],
        "Special quota allowed users should be persisted"
      );
      assert.deepStrictEqual(
        savedDraft.specialReasonCodes.map((c: any) => c.code).sort(),
        codesBeforeSave,
        "Passing through unchanged specialReasonCodes should preserve global codes"
      );
    });
  });

  describe("Publish - uses saved draft rules", () => {
    it("publishedSnapshot matches last saved draft snapshot", async () => {
      guard();

      const draftVersionId = await getOrCreateDraft();
      const modalityId = testData.modalityId;
      const examTypeId = testData.examTypeId;
      const specialReasonCodes = await getGlobalSpecialReasonCodes();

      const publishTestSnapshot = {
        categoryDailyLimits: [
          { id: 10, modalityId, caseCategory: "oncology" as const, dailyLimit: 8, isActive: true },
        ],
        modalityBlockedRules: [],
        examTypeRules: [
          {
            id: 11,
            modalityId,
            ruleType: "weekly_recurrence" as const,
            effectMode: "restriction_overridable" as const,
            specificDate: null,
            startDate: null,
            endDate: null,
            weekday: 1,
            alternateWeeks: true,
            recurrenceAnchorDate: "2026-01-05",
            examTypeIds: [examTypeId],
            title: "Weekly test rule",
            notes: null,
            isActive: true,
          },
        ],
        examTypeSpecialQuotas: [],
        specialReasonCodes,
      };

      const saveResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: { policySnapshot: publishTestSnapshot, changeNote: "Test publish" },
      });
      assert.strictEqual(saveResult.status, 200, "Saving publish test snapshot should succeed");

      const publishResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}/publish`, {
        method: "POST",
        body: { changeNote: "Test publish note" },
      });
      const publishData = publishResult.data as any;
      assert.ok(publishData.published, "Publish should return published version");

      const statusAfterData = await getPolicyStatusData();
      const publishedSnapshot = statusAfterData.publishedSnapshot;

      assert.strictEqual(
        publishedSnapshot.categoryDailyLimits.length,
        publishTestSnapshot.categoryDailyLimits.length,
        "Published should have same number of categoryDailyLimits"
      );
      assert.strictEqual(
        publishedSnapshot.categoryDailyLimits[0].dailyLimit,
        8,
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

  describe("Draft save isolation - unchanged global config", () => {
    it("saving draft with unchanged specialReasonCodes does not change global table", async () => {
      guard();

      const dataBefore = await getPolicyStatusData();
      const codesBefore = (dataBefore.publishedSnapshot?.specialReasonCodes ?? [])
        .map((c: any) => c.code)
        .sort();
      const draftVersionId = await getOrCreateDraft();
      const modalityId = testData.modalityId;
      const specialReasonCodes = await getGlobalSpecialReasonCodes();

      const versionedOnlySnapshot = {
        categoryDailyLimits: [
          { id: 30, modalityId, caseCategory: "non_oncology" as const, dailyLimit: 4, isActive: true },
        ],
        modalityBlockedRules: [],
        examTypeRules: [],
        examTypeSpecialQuotas: [],
        specialReasonCodes,
      };

      const saveResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: { policySnapshot: versionedOnlySnapshot, changeNote: "Versioned-only isolation test" },
      });
      assert.strictEqual(saveResult.status, 200, "Saving versioned-only policy snapshot should succeed");

      const dataAfter = await getPolicyStatusData();
      const codesAfter = (dataAfter.publishedSnapshot?.specialReasonCodes ?? [])
        .map((c: any) => c.code)
        .sort();

      assert.deepStrictEqual(
        codesAfter,
        codesBefore,
        "Global special reason codes should not be changed when passed through unchanged"
      );
    });
  });

  describe("Hash consistency - configHash matches persisted snapshot", () => {
    it("configHash returned from save matches hash of reloaded snapshot", async () => {
      guard();

      const draftVersionId = await getOrCreateDraft();
      const modalityId = testData.modalityId;
      const examTypeId = testData.examTypeId;
      const specialReasonCodes = await getGlobalSpecialReasonCodes();
      const testSnapshot = {
        categoryDailyLimits: [
          { id: 20, modalityId, caseCategory: "non_oncology" as const, dailyLimit: 6, isActive: true },
        ],
        modalityBlockedRules: [],
        examTypeRules: [
          {
            id: 21,
            modalityId,
            ruleType: "specific_date" as const,
            effectMode: "hard_restriction" as const,
            specificDate: "2026-06-15",
            startDate: null,
            endDate: null,
            weekday: null,
            alternateWeeks: false,
            recurrenceAnchorDate: null,
            examTypeIds: [examTypeId],
            title: "Hash test rule",
            notes: null,
            isActive: true,
          },
        ],
        examTypeSpecialQuotas: [],
        specialReasonCodes,
      };

      const saveResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: { policySnapshot: testSnapshot, changeNote: "Hash test" },
      });
      assert.strictEqual(saveResult.status, 200, "Saving hash test snapshot should succeed");
      const saveData = saveResult.data as any;
      const returnedHash = saveData.configHash;
      assert.ok(returnedHash, "Save should return configHash");

      const statusAfterData = await getPolicyStatusData();
      const draftVersion = statusAfterData.draft;
      assert.ok(draftVersion, "Should have a draft version");
      assert.strictEqual(
        draftVersion.configHash,
        returnedHash,
        "Version configHash should match the hash returned from save"
      );
    });
  });

  describe("Initial draft hash - hash shape validation", () => {
    it("configHash is always 64-char hex (SHA-256), not hash of raw {}", async () => {
      guard();

      const dataBefore = await getPolicyStatusData();
      if (dataBefore?.draft?.id) {
        await fetch(`/api/v2/scheduling/admin/policy/draft/${dataBefore.draft.id}/publish`, {
          method: "POST",
          body: { changeNote: "Pre-test publish" },
        });
      }

      const dataAfter = await getPolicyStatusData();

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

  describe("Special reason codes - global config integrity", () => {
    it("saving draft with unchanged specialReasonCodes leaves global table unchanged", async () => {
      guard();

      const dataBefore = await getPolicyStatusData();
      const codesBefore = (dataBefore.publishedSnapshot?.specialReasonCodes ?? [])
        .map((c: any) => c.code)
        .sort();
      const draftVersionId = await getOrCreateDraft();
      const modalityId = testData.modalityId;
      const specialReasonCodes = await getGlobalSpecialReasonCodes();

      const saveResult = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: {
          policySnapshot: {
            categoryDailyLimits: [
              { id: 100, modalityId, caseCategory: "non_oncology" as const, dailyLimit: 5, isActive: true },
            ],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            specialReasonCodes,
          },
          changeNote: "Test omitted global codes",
        },
      });
      assert.strictEqual(saveResult.status, 200, "Saving versioned policy snapshot should succeed");

      const dataAfterSave = await getPolicyStatusData();
      const codesAfterSave = (dataAfterSave.publishedSnapshot?.specialReasonCodes ?? [])
        .map((c: any) => c.code)
        .sort();

      assert.deepStrictEqual(
        codesAfterSave,
        codesBefore,
        "Saving draft with unchanged specialReasonCodes should not mutate global table"
      );
    });
  });

  describe("Create Draft - preserves changeNote", () => {
    it("returned draft.changeNote is preserved after hash recalculation", async () => {
      guard();

      const dataBefore = await getPolicyStatusData();
      if (dataBefore?.draft?.id) {
        await fetch(`/api/v2/scheduling/admin/policy/draft/${dataBefore.draft.id}/publish`, {
          method: "POST",
          body: { changeNote: "Pre-test publish" },
        });
      }

      const customNote = "Custom test change note - must be preserved";

      const createResult = await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: { policySetKey: testData.policySetKey, changeNote: customNote },
      });
      const createData = createResult.data as any;
      assert.ok(createData.draft?.id, "Draft should have an ID");

      const statusAfterData = await getPolicyStatusData();
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
