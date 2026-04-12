/**
 * Appointments V2 — previewPolicyImpact unit tests.
 *
 * Tests the policy diff computation logic with mocked dependencies.
 * Covers: diff calculation, added/removed/modified rules,
 * warnings for no published version and no differences.
 */

import { describe, it, mock, afterEach } from "node:test";
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
// Test helpers
// ---------------------------------------------------------------------------

const DRAFT_VERSION = {
  id: 10,
  policySetId: 1,
  versionNo: 2,
  status: "draft",
  configHash: "draft_hash",
  changeNote: null,
  publishedAt: null,
};

const PUBLISHED_VERSION = {
  id: 5,
  policySetId: 1,
  versionNo: 1,
  status: "published",
  configHash: "pub_hash",
  changeNote: null,
  publishedAt: "2026-01-01T00:00:00Z",
};

function makeRule(id: number, type: string, modalityId: number | null, dailyLimit: number | null): Record<string, unknown> {
  return {
    ruleType: type,
    id,
    modalityId,
    caseCategory: null,
    dailyLimit,
    isActive: true,
  };
}

async function runPreviewWithMocks(
  draftVersionId: number,
  draftVersion: Record<string, unknown> | null,
  publishedVersion: Record<string, unknown> | null,
  draftRules: Record<string, unknown>[],
  publishedRules: Record<string, unknown>[]
): Promise<import("../../admin/services/preview-policy-impact.service.js").PolicyImpactDiff> {
  const mockClient = new MockPoolClient();

  // Query 1: findVersionById (draft)
  mockClient.queueResults(draftVersion ? [draftVersion] : []);
  // Query 2: findPublishedVersion by policySetId
  mockClient.queueResults(publishedVersion ? [publishedVersion] : []);
  // Query 3: loadAllRulesForVersion (draft)
  mockClient.queueResults(draftRules);
  // Query 4: loadAllRulesForVersion (published) — only if published exists
  mockClient.queueResults(publishedRules);

  const connectMock = mock.method(poolModule.pool, "connect", async () => mockClient);

  try {
    const { previewPolicyImpact } = await import("../../admin/services/preview-policy-impact.service.js");
    return await previewPolicyImpact(draftVersionId);
  } finally {
    connectMock.mock.restore();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("previewPolicyImpact — version not found", () => {
  afterEach(() => mock.restoreAll());

  it("throws when draft version does not exist", async () => {
    await assert.rejects(
      async () => runPreviewWithMocks(999, null, null, [], []),
      /Draft version 999 not found/
    );
  });
});

describe("previewPolicyImpact — wrong status", () => {
  afterEach(() => mock.restoreAll());

  it("throws when version is not a draft", async () => {
    const publishedAsDraft = { ...PUBLISHED_VERSION, status: "published" };
    await assert.rejects(
      async () => runPreviewWithMocks(5, publishedAsDraft, null, [], []),
      /is 'published', not 'draft'/
    );
  });
});

describe("previewPolicyImpact — added rules", () => {
  afterEach(() => mock.restoreAll());

  it("detects rules in draft but not in published", async () => {
    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      PUBLISHED_VERSION,
      [makeRule(1, "modality_blocked", 10, null), makeRule(2, "modality_blocked", 20, null)],
      [makeRule(1, "modality_blocked", 10, null)]
    );

    assert.equal((result.addedRules as unknown[]).length, 1);
    assert.equal((result.removedRules as unknown[]).length, 0);
    assert.equal((result.modifiedRules as unknown[]).length, 0);
  });
});

describe("previewPolicyImpact — removed rules", () => {
  afterEach(() => mock.restoreAll());

  it("detects rules in published but not in draft", async () => {
    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      PUBLISHED_VERSION,
      [makeRule(1, "modality_blocked", 10, null)],
      [makeRule(1, "modality_blocked", 10, null), makeRule(3, "modality_blocked", 30, null)]
    );

    assert.equal((result.addedRules as unknown[]).length, 0);
    assert.equal((result.removedRules as unknown[]).length, 1);
    assert.equal((result.modifiedRules as unknown[]).length, 0);
  });
});

describe("previewPolicyImpact — modified rules", () => {
  afterEach(() => mock.restoreAll());

  it("detects rules with changed properties", async () => {
    const draftRules = [makeRule(1, "category_daily_limit", 10, 25)];
    const publishedRules = [makeRule(1, "category_daily_limit", 10, 15)];

    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      PUBLISHED_VERSION,
      draftRules,
      publishedRules
    );

    assert.equal((result.modifiedRules as unknown[]).length, 1);
    assert.equal((result.addedRules as unknown[]).length, 0);
    assert.equal((result.removedRules as unknown[]).length, 0);
  });

  it("does not flag unchanged rules as modified", async () => {
    const draftRules = [makeRule(1, "modality_blocked", 10, null)];
    const publishedRules = [makeRule(1, "modality_blocked", 10, null)];

    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      PUBLISHED_VERSION,
      draftRules,
      publishedRules
    );

    assert.equal((result.modifiedRules as unknown[]).length, 0);
  });
});

describe("previewPolicyImpact — no published version", () => {
  afterEach(() => mock.restoreAll());

  it("warns when no published version exists", async () => {
    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      null,
      [makeRule(1, "modality_blocked", 10, null)],
      []
    );

    const warnings = result.warnings as string[];
    assert.ok(warnings.some((w) => w.includes("No published version")));
  });

  it("returns publishedVersionId: null when no published version", async () => {
    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      null,
      [],
      []
    );

    assert.equal(result.publishedVersionId, null);
  });

  it("treats all draft rules as added when no published version", async () => {
    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      null,
      [makeRule(1, "modality_blocked", 10, null), makeRule(2, "modality_blocked", 20, null)],
      []
    );

    assert.equal((result.addedRules as unknown[]).length, 2);
  });
});

describe("previewPolicyImpact — no differences", () => {
  afterEach(() => mock.restoreAll());

  it("warns when draft and published are identical", async () => {
    const rules = [makeRule(1, "modality_blocked", 10, null)];
    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      PUBLISHED_VERSION,
      rules,
      rules
    );

    const warnings = result.warnings as string[];
    assert.ok(warnings.some((w) => w.includes("No rule differences")));
  });
});

describe("previewPolicyImpact — rule counts", () => {
  afterEach(() => mock.restoreAll());

  it("returns correct ruleCountDraft and ruleCountPublished", async () => {
    const result = await runPreviewWithMocks(
      10,
      DRAFT_VERSION,
      PUBLISHED_VERSION,
      [makeRule(1, "modality_blocked", 10, null), makeRule(2, "modality_blocked", 20, null)],
      [makeRule(1, "modality_blocked", 10, null)]
    );

    assert.equal(result.ruleCountDraft, 2);
    assert.equal(result.ruleCountPublished, 1);
  });
});

describe("previewPolicyImpact — function structure", () => {
  it("exports previewPolicyImpact", async () => {
    const { previewPolicyImpact } = await import("../../admin/services/preview-policy-impact.service.js");
    assert.ok(typeof previewPolicyImpact === "function");
  });

  it("PolicyImpactDiff has correct shape", () => {
    const diff = {
      draftVersionId: 10,
      publishedVersionId: 5,
      addedRules: [] as unknown[],
      removedRules: [] as unknown[],
      modifiedRules: [] as unknown[],
      ruleCountDraft: 2,
      ruleCountPublished: 1,
      warnings: [] as string[],
    };
    assert.equal(typeof diff.draftVersionId, "number");
    assert.ok(Array.isArray(diff.addedRules));
    assert.ok(Array.isArray(diff.removedRules));
    assert.ok(Array.isArray(diff.modifiedRules));
    assert.ok(Array.isArray(diff.warnings));
  });
});
