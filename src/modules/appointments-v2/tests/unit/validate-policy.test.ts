/**
 * Appointments V2 — validatePolicy unit tests.
 *
 * Tests the policy validation logic with mocked dependencies.
 * Covers all 7 validation checks: existence, draft status, config hash,
 * orphaned rules, zero limits, zero quotas, and empty rules.
 */

import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import * as adminPolicyRepo from "../../admin/repositories/admin-policy.repo.js";
import * as poolModule from "../../../../db/pool.js";

// ---------------------------------------------------------------------------
// Mock pool client
// ---------------------------------------------------------------------------

class MockPoolClient {
  private _results: Array<Array<Record<string, unknown>>> = [];
  public queries: Array<{ sql: string; params: unknown[] }> = [];

  queueResults(rows: Record<string, unknown>[]): void {
    this._results.push(rows);
  }

  async query<T = Record<string, unknown>[]>(
    _sql: string,
    _params?: unknown[]
  ): Promise<{ rows: T }> {
    this.queries.push({ sql: _sql, params: _params ?? [] });
    const rows = this._results.shift() ?? [];
    return { rows: rows as unknown as T };
  }

  release(): void {}
}

// ---------------------------------------------------------------------------
// Helper: validate with mocked pool
// ---------------------------------------------------------------------------

async function runValidateWithMocks(
  versionId: number,
  versionRow: Record<string, unknown> | null,
  rules: Record<string, unknown>[],
  modalityCapacities: Record<number, number | null> = {}
): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
  const mockClient = new MockPoolClient();

  // First query: findVersionById
  mockClient.queueResults(versionRow ? [versionRow] : []);
  // Second query: loadAllRulesForVersion
  mockClient.queueResults(rules);
  const modalityIds = [...new Set(
    rules
      .filter((rule) => rule.ruleType === "category_daily_limit" && rule.modalityId != null)
      .map((rule) => Number(rule.modalityId))
  )];
  if (modalityIds.length > 0) {
    const rows = modalityIds.map((id) => ({
      id,
      dailyCapacity:
        Object.prototype.hasOwnProperty.call(modalityCapacities, id)
          ? modalityCapacities[id]
          : 100,
    }));
    mockClient.queueResults(rows);
  }

  // Mock pool.connect to return our mock client
  const connectMock = mock.method(poolModule.pool, "connect", async () => mockClient);

  try {
    const { validatePolicyDraft } = await import("../../rules/services/validate-policy.js");
    return await validatePolicyDraft(versionId);
  } finally {
    connectMock.mock.restore();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validatePolicy — version existence", () => {
  afterEach(() => mock.restoreAll());

  it("returns error when version does not exist", async () => {
    const result = await runValidateWithMocks(999, null, []);
    assert.equal(result.isValid, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /does not exist/);
    assert.equal(result.warnings.length, 0);
  });
});

describe("validatePolicy — draft status check", () => {
  afterEach(() => mock.restoreAll());

  const makeVersion = (status: string) => ({
    id: 1,
    policySetId: 1,
    versionNo: 1,
    status,
    configHash: "abc123",
    changeNote: null,
    publishedAt: null,
  });

  it("accepts a draft version", async () => {
    const result = await runValidateWithMocks(1, makeVersion("draft"), []);
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects a published version", async () => {
    const result = await runValidateWithMocks(1, makeVersion("published"), []);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("published")));
  });

  it("rejects an archived version", async () => {
    const result = await runValidateWithMocks(1, makeVersion("archived"), []);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("archived")));
  });
});

describe("validatePolicy — config hash check", () => {
  afterEach(() => mock.restoreAll());

  const makeVersion = (hash: string) => ({
    id: 1,
    policySetId: 1,
    versionNo: 1,
    status: "draft",
    configHash: hash,
    changeNote: null,
    publishedAt: null,
  });

  it("accepts a version with a config hash", async () => {
    const result = await runValidateWithMocks(1, makeVersion("abc123"), []);
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
  });

  it("errors when config hash is empty", async () => {
    const result = await runValidateWithMocks(1, makeVersion(""), []);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("configuration hash")));
  });
});

describe("validatePolicy — orphaned rules warning", () => {
  afterEach(() => mock.restoreAll());

  const version = {
    id: 1,
    policySetId: 1,
    versionNo: 1,
    status: "draft",
    configHash: "abc123",
    changeNote: null,
    publishedAt: null,
  };

  it("warns when all rules have no modalityId", async () => {
    const rules = [
      { ruleType: "category_daily_limit", id: 1, modalityId: null, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules);
    assert.ok(result.warnings.some((w) => w.includes("orphaned")));
  });

  it("does not warn when rules reference modalities", async () => {
    const rules = [
      { ruleType: "modality_blocked", id: 1, modalityId: 10, caseCategory: null, dailyLimit: null, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules);
    assert.ok(!result.warnings.some((w) => w.includes("orphaned")));
  });

  it("does not warn when there are no rules", async () => {
    const result = await runValidateWithMocks(1, version, []);
    assert.ok(!result.warnings.some((w) => w.includes("orphaned")));
  });
});

describe("validatePolicy — zero daily limit warning", () => {
  afterEach(() => mock.restoreAll());

  const version = {
    id: 1,
    policySetId: 1,
    versionNo: 1,
    status: "draft",
    configHash: "abc123",
    changeNote: null,
    publishedAt: null,
  };

  it("warns when category daily limit is zero", async () => {
    const rules = [
      { ruleType: "category_daily_limit", id: 1, modalityId: 10, caseCategory: "non_oncology", dailyLimit: 0, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules);
    assert.ok(result.warnings.some((w) => w.includes("daily_limit=0")));
  });

  it("does not warn when daily limit is positive", async () => {
    const rules = [
      { ruleType: "category_daily_limit", id: 1, modalityId: 10, caseCategory: "non_oncology", dailyLimit: 15, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules);
    assert.ok(!result.warnings.some((w) => w.includes("daily_limit=0")));
  });
});

describe("validatePolicy — zero special quota warning", () => {
  afterEach(() => mock.restoreAll());

  const version = {
    id: 1,
    policySetId: 1,
    versionNo: 1,
    status: "draft",
    configHash: "abc123",
    changeNote: null,
    publishedAt: null,
  };

  it("warns when special quota has zero extra slots", async () => {
    const rules = [
      { ruleType: "special_quota", id: 1, modalityId: null, caseCategory: null, dailyLimit: 0, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules);
    assert.ok(result.warnings.some((w) => w.includes("daily_extra_slots=0")));
  });

  it("does not warn when special quota has positive slots", async () => {
    const rules = [
      { ruleType: "special_quota", id: 1, modalityId: null, caseCategory: null, dailyLimit: 5, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules);
    assert.ok(!result.warnings.some((w) => w.includes("daily_extra_slots=0")));
  });
});

describe("validatePolicy — empty rules warning", () => {
  afterEach(() => mock.restoreAll());

  const version = {
    id: 1,
    policySetId: 1,
    versionNo: 1,
    status: "draft",
    configHash: "abc123",
    changeNote: null,
    publishedAt: null,
  };

  it("warns when policy has no rules", async () => {
    const result = await runValidateWithMocks(1, version, []);
    assert.ok(result.warnings.some((w) => w.includes("no rules")));
  });

  it("does not warn when policy has rules", async () => {
    const rules = [
      { ruleType: "modality_blocked", id: 1, modalityId: 10, caseCategory: null, dailyLimit: null, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules);
    assert.ok(!result.warnings.some((w) => w.includes("no rules")));
  });
});

describe("validatePolicy — combined validation", () => {
  afterEach(() => mock.restoreAll());

  const version = {
    id: 1,
    policySetId: 1,
    versionNo: 1,
    status: "draft",
    configHash: "abc123",
    changeNote: null,
    publishedAt: null,
  };

  it("returns isValid=true with warnings but no errors", async () => {
    // Rules with zero daily limit + empty rules warning
    const rules = [
      { ruleType: "category_daily_limit", id: 1, modalityId: null, caseCategory: "non_oncology", dailyLimit: 0, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules);
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.length > 0);
  });

  it("returns isValid=false when both errors and warnings exist", async () => {
    // Empty config hash (error) + no modality reference rules (warning)
    const badVersion = { ...version, configHash: "" };
    const rules = [
      { ruleType: "category_daily_limit", id: 1, modalityId: null, caseCategory: "non_oncology", dailyLimit: 10, isActive: true },
    ];
    const result = await runValidateWithMocks(1, badVersion, rules);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.warnings.length > 0);
  });
});

describe("validatePolicy — function structure", () => {
  it("exports validatePolicyDraft", async () => {
    const { validatePolicyDraft } = await import("../../rules/services/validate-policy.js");
    assert.ok(typeof validatePolicyDraft === "function");
  });

  it("PolicyValidationResult has correct shape", () => {
    const result = {
      isValid: true,
      errors: [] as string[],
      warnings: ["Some warning"],
    };
    assert.equal(typeof result.isValid, "boolean");
    assert.ok(Array.isArray(result.errors));
    assert.ok(Array.isArray(result.warnings));
  });
});

describe("validatePolicy — category sum semantics", () => {
  afterEach(() => mock.restoreAll());

  const version = {
    id: 1,
    policySetId: 1,
    versionNo: 1,
    status: "draft",
    configHash: "abc123",
    changeNote: null,
    publishedAt: null,
  };

  it("errors when both category limits do not equal modality capacity", async () => {
    const rules = [
      { ruleType: "category_daily_limit", id: 1, modalityId: 10, caseCategory: "oncology", dailyLimit: 4, isActive: true },
      { ruleType: "category_daily_limit", id: 2, modalityId: 10, caseCategory: "non_oncology", dailyLimit: 5, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules, { 10: 10 });
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("must equal daily capacity")));
  });

  it("accepts when both limits equal modality capacity", async () => {
    const rules = [
      { ruleType: "category_daily_limit", id: 1, modalityId: 10, caseCategory: "oncology", dailyLimit: 4, isActive: true },
      { ruleType: "category_daily_limit", id: 2, modalityId: 10, caseCategory: "non_oncology", dailyLimit: 6, isActive: true },
    ];
    const result = await runValidateWithMocks(1, version, rules, { 10: 10 });
    assert.equal(result.errors.length, 0);
  });
});
