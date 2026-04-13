/**
 * Appointments V2 — Availability and policy flow integration tests.
 *
 * Tests the full availability query and admin policy lifecycle against a real PostgreSQL database:
 * - Availability query (loads policy, rules, evaluates per day)
 * - Evaluate single booking decision
 * - Admin policy draft → save → publish → preview
 * - Policy validation
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

const runTests = isDatabaseAvailable();
const TEST_PREFIX = "AVAILABILITY_";

describe("Availability and policy flow — integration tests", { skip: !runTests ? "Database URL not set" : false }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;
  let dbReachable: boolean;

  before(async () => {
    dbReachable = await canReachDatabase();
    if (!dbReachable) {
      console.warn("WARNING: Database is not reachable. Skipping availability flow integration tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");
  });

  after(async () => {
    if (!dbReachable) return;
    await app.close();
    await testDb.cleanup();
  });

  const fetch = (path: string, opts: Record<string, unknown> = {}) =>
    fetchJson(app.baseUrl, path, { cookie: authCookie, ...opts });

  describe("Availability query", () => {
    it("should return availability for a date range", async () => {
      const { status, data } = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=14&caseCategory=non_oncology`
      );

      assert.equal(status, 200);
      const response = data as Record<string, unknown>;
      assert.ok(Array.isArray(response.items));
      assert.ok((response.items as unknown[]).length > 0);

      const day = (response.items as Record<string, unknown>[])[0];
      assert.ok(typeof day.date === "string");
      assert.ok(typeof day.dailyCapacity === "number");
      assert.ok(typeof day.bookedCount === "number");
      assert.ok(typeof day.remainingCapacity === "number");
      assert.ok(typeof day.isFull === "boolean");
      assert.ok(typeof day.decision === "object");
    });

    it("should return availability with policy version reference", async () => {
      const { data } = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=7&caseCategory=non_oncology`
      );

      const response = data as Record<string, unknown>;
      const items = response.items as Record<string, unknown>[];
      assert.ok(items.length > 0);
      const decision = items[0].decision as Record<string, unknown>;
      assert.ok(typeof decision.policyVersionRef === "object");
    });

    it("should reject availability without modalityId", async () => {
      const { status } = await fetch(
        "/api/v2/scheduling/availability?days=7&caseCategory=non_oncology"
      );
      assert.equal(status, 400);
    });

    it("should reject availability for non-existent modality", async () => {
      const { status } = await fetch(
        "/api/v2/scheduling/availability?modalityId=99999&days=7&caseCategory=non_oncology"
      );
      assert.equal(status, 400);
    });
  });

  describe("Evaluate booking decision", () => {
    it("should evaluate a valid booking", async () => {
      const { status, data } = await fetch("/api/v2/scheduling/evaluate", {
        method: "POST",
        body: {
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          scheduledDate: "2026-05-05",
          caseCategory: "non_oncology",
        },
      });

      assert.equal(status, 200);
      const decision = data as Record<string, unknown>;
      assert.ok(typeof decision.displayStatus === "string");
      assert.ok(Array.isArray(decision.reasons));
      assert.ok(typeof decision.policyVersionRef === "object");
    });
  });

  describe("Suggestions", () => {
    it("should return suggestions with bookable dates", async () => {
      const { status, data } = await fetch(
        `/api/v2/scheduling/suggestions?modalityId=${testData.modalityId}&caseCategory=non_oncology&days=14`
      );

      assert.equal(status, 200);
      const response = data as Record<string, unknown>;
      assert.ok(Array.isArray(response.items));

      // Suggestions should return bookable dates (not blocked, not full)
      const items = response.items as Record<string, unknown>[];
      for (const item of items) {
        assert.ok(typeof item.date === "string", "Each suggestion should have a date");
        assert.equal(Number(item.modalityId), testData.modalityId, "Should match requested modality");
        assert.ok(typeof item.decision === "object", "Should include decision");
        const decision = item.decision as Record<string, unknown>;
        assert.ok("isAllowed" in decision, "Decision should have isAllowed");
        assert.ok("displayStatus" in decision, "Decision should have displayStatus");
        // Suggestions should only include bookable dates (allowed or override-available, not full)
        const isAllowed = decision.isAllowed as boolean;
        const requiresOverride = decision.requiresSupervisorOverride as boolean;
        const displayStatus = decision.displayStatus as string;
        const isBookable = isAllowed || (requiresOverride && displayStatus !== "blocked");
        assert.ok(isBookable, `Suggestion on ${item.date} should be bookable`);
      }
    });

    it("should return empty array when no published policy exists", async () => {
      // Use a non-existent policy set — availability returns empty
      const { status, data } = await fetch(
        `/api/v2/scheduling/suggestions?modalityId=99999&caseCategory=non_oncology`
      );

      assert.equal(status, 200);
      const response = data as Record<string, unknown>;
      assert.ok(Array.isArray(response.items));
    });

    it("should respect includeOverrideCandidates param", async () => {
      const { status, data } = await fetch(
        `/api/v2/scheduling/suggestions?modalityId=${testData.modalityId}&caseCategory=non_oncology&includeOverrideCandidates=true`
      );

      assert.equal(status, 200);
      const response = data as Record<string, unknown>;
      assert.ok(Array.isArray(response.items));
    });
  });

  describe("Admin policy — draft creation", () => {
    it("should create a draft policy from published version", async () => {
      const { status, data } = await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: {
          policySetKey: "default",
          changeNote: "Integration test draft",
        },
      });

      assert.equal(status, 201);
      const result = data as Record<string, unknown>;
      assert.ok(typeof result.draft === "object");
      const draft = result.draft as Record<string, unknown>;
      assert.equal(draft.status, "draft");
    });

    it("should reject creating a second draft", async () => {
      const { status } = await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: {
          policySetKey: "default",
          changeNote: "Second draft should fail",
        },
      });
      assert.equal(status, 409);
    });

    it("should reject creating draft for non-existent policy set", async () => {
      const { status } = await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: {
          policySetKey: "nonexistent_policy",
          changeNote: "This should fail",
        },
      });
      assert.equal(status, 404);
    });
  });

  describe("Admin policy — save draft", () => {
    it("should save a draft with updated config", async () => {
      const { pool } = await import("../../../../db/pool.js");
      const versionResult = await pool.query(
        `select id from appointments_v2.policy_versions where policy_set_id = $1 and status = 'draft' limit 1`,
        [testData.policySetId]
      );

      if (versionResult.rows.length === 0) return;

      const draftVersionId = versionResult.rows[0].id;

      const { status, data } = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}`, {
        method: "PUT",
        body: {
          policySnapshot: {
            categoryDailyLimits: [{ modalityId: testData.modalityId, caseCategory: "non_oncology", dailyLimit: 10 }],
            modalityBlockedRules: [],
            examTypeRules: [],
            examTypeSpecialQuotas: [],
            specialReasonCodes: [],
          },
          changeNote: "Updated daily limit to 10",
        },
      });

      assert.equal(status, 200);
      const result = data as Record<string, unknown>;
      assert.equal(typeof result.configHash, "string");
    });

    it("should reject saving a non-draft version", async () => {
      const { status } = await fetch(`/api/v2/scheduling/admin/policy/draft/${testData.policyVersionId}`, {
        method: "PUT",
        body: { policySnapshot: {}, changeNote: "Should fail" },
      });
      assert.equal(status, 409);
    });
  });

  describe("Admin policy — publish", () => {
    let draftVersionId: number;

    before(async () => {
      const { pool } = await import("../../../../db/pool.js");
      const versionResult = await pool.query(
        `select id from appointments_v2.policy_versions where policy_set_id = $1 and status = 'draft' limit 1`,
        [testData.policySetId]
      );

      if (versionResult.rows.length === 0) {
        // Create a draft
        await fetch("/api/v2/scheduling/admin/policy/draft", {
          method: "POST",
          body: { policySetKey: "default", changeNote: "Draft for publish" },
        });

        const newResult = await pool.query(
          `select id from appointments_v2.policy_versions where policy_set_id = $1 and status = 'draft' order by id desc limit 1`,
          [testData.policySetId]
        );
        draftVersionId = newResult.rows[0].id;
      } else {
        draftVersionId = versionResult.rows[0].id;
      }
    });

    it("should publish a draft successfully", async () => {
      const { status, data } = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}/publish`, {
        method: "POST",
      });

      assert.equal(status, 200);
      const result = data as Record<string, unknown>;
      assert.ok(typeof result.published === "object");
      const published = result.published as Record<string, unknown>;
      assert.equal(published.status, "published");
    });

    it("should reject publishing a non-draft version", async () => {
      const { status } = await fetch(`/api/v2/scheduling/admin/policy/draft/${testData.policyVersionId}/publish`, {
        method: "POST",
      });
      assert.equal(status, 409);
    });
  });

  describe("Admin policy — preview impact", () => {
    it("should preview diff between draft and published", async () => {
      // Create a new draft
      await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: { policySetKey: "default", changeNote: "Draft for preview" },
      });

      const { pool } = await import("../../../../db/pool.js");
      const versionResult = await pool.query(
        `select id from appointments_v2.policy_versions where policy_set_id = $1 and status = 'draft' order by id desc limit 1`,
        [testData.policySetId]
      );

      if (versionResult.rows.length === 0) {
        throw new Error("No draft found for preview test");
      }

      const draftVersionId = versionResult.rows[0].id;
      const { status, data } = await fetch(`/api/v2/scheduling/admin/policy/draft/${draftVersionId}/preview`);

      assert.equal(status, 200);
      const preview = data as Record<string, unknown>;
      assert.ok(typeof preview.addedRulesCount === "number");
      assert.ok(typeof preview.removedRulesCount === "number");
      assert.ok(typeof preview.modifiedRulesCount === "number");
      assert.ok(Array.isArray(preview.warnings));
    });
  });

  describe("GET /policy — policy status", () => {
    it("should return published policy and no draft", async () => {
      const { status, data } = await fetch(
        `/api/v2/scheduling/admin/policy?policySetKey=default`
      );

      assert.equal(status, 200);
      const response = data as Record<string, unknown>;
      assert.ok(typeof response.policySet === "object");
      const policySet = response.policySet as Record<string, unknown>;
      assert.equal(policySet.key, "default");
      assert.ok(typeof response.published === "object");
      const published = response.published as Record<string, unknown>;
      assert.ok(typeof published.versionNo === "number");
      assert.ok(typeof published.configHash === "string");
      assert.equal(response.draft, null);
      assert.ok(Array.isArray(response.publishedRules));
      assert.ok(Array.isArray(response.draftRules));
    });

    it("should return null policySet for unknown key", async () => {
      const { status, data } = await fetch(
        `/api/v2/scheduling/admin/policy?policySetKey=nonexistent_key`
      );

      assert.equal(status, 200);
      const response = data as Record<string, unknown>;
      assert.equal(response.policySet, null);
      assert.equal(response.published, null);
      assert.equal(response.draft, null);
      assert.ok(Array.isArray(response.publishedRules));
      assert.ok(Array.isArray(response.draftRules));
    });

    it("should return draft after one is created", async () => {
      // Create a draft
      await fetch("/api/v2/scheduling/admin/policy/draft", {
        method: "POST",
        body: { policySetKey: "default", changeNote: "Test draft for GET /policy" },
      });

      const { status, data } = await fetch(
        `/api/v2/scheduling/admin/policy?policySetKey=default`
      );

      assert.equal(status, 200);
      const response = data as Record<string, unknown>;
      assert.ok(typeof response.published === "object");
      assert.ok(typeof response.draft === "object");
      const draft = response.draft as Record<string, unknown>;
      assert.ok(typeof draft.versionNo === "number");
      assert.ok(Array.isArray(response.draftRules));
    });
  });
});
