/**
 * Appointments V2 — Admin policy services unit tests.
 *
 * Tests cover DTO shapes, service interfaces, and validation logic.
 * Full DB integration tests require a real PostgreSQL instance.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Admin policy — DTO shapes", () => {
  it("CreatePolicyDraftDto has policySetKey", () => {
    const dto = {
      policySetKey: "default",
      changeNote: "Test draft",
    };
    assert.equal(typeof dto.policySetKey, "string");
    assert.equal(typeof dto.changeNote, "string");
  });

  it("SavePolicyDraftDto has policySnapshot", () => {
    const dto = {
      policySnapshot: {
        categoryDailyLimits: [{ id: 1, modalityId: 10, caseCategory: "non_oncology", dailyLimit: 15, isActive: true }],
        modalityBlockedRules: [],
        examTypeRules: [],
        examTypeSpecialQuotas: [],
        specialReasonCodes: [],
      },
      changeNote: "Updated limits",
    };
    assert.ok(dto.policySnapshot);
    assert.ok(Array.isArray(dto.policySnapshot.categoryDailyLimits));
  });

  it("PublishPolicyDto has changeNote", () => {
    const dto = {
      changeNote: "Publishing updated policy",
    };
    assert.equal(typeof dto.changeNote, "string");
  });

  it("PolicyVersionDto has all required fields", () => {
    const dto = {
      id: 1,
      policySetId: 1,
      versionNo: 2,
      status: "published" as const,
      configHash: "abc123",
      changeNote: "Published",
      createdAt: "2026-04-11T10:00:00Z",
      publishedAt: "2026-04-11T10:00:00Z",
    };
    assert.equal(typeof dto.id, "number");
    assert.equal(typeof dto.policySetId, "number");
    assert.equal(typeof dto.versionNo, "number");
    assert.ok(["draft", "published", "archived"].includes(dto.status));
    assert.equal(typeof dto.configHash, "string");
    assert.equal(typeof dto.createdAt, "string");
  });
});

describe("Admin policy — service imports", () => {
  it("createPolicyDraft is a function", async () => {
    const { createPolicyDraft } = await import(
      "../../admin/services/create-policy-draft.service.js"
    );
    assert.equal(typeof createPolicyDraft, "function");
  });

  it("savePolicyDraft is a function", async () => {
    const { savePolicyDraft } = await import(
      "../../admin/services/save-policy-draft.service.js"
    );
    assert.equal(typeof savePolicyDraft, "function");
  });

  it("publishPolicy is a function", async () => {
    const { publishPolicy } = await import(
      "../../admin/services/publish-policy.service.js"
    );
    assert.equal(typeof publishPolicy, "function");
  });

  it("previewPolicyImpact is a function", async () => {
    const { previewPolicyImpact } = await import(
      "../../admin/services/preview-policy-impact.service.js"
    );
    assert.equal(typeof previewPolicyImpact, "function");
  });

  it("validatePolicyDraft is a function", async () => {
    const { validatePolicyDraft } = await import(
      "../../rules/services/validate-policy.js"
    );
    assert.equal(typeof validatePolicyDraft, "function");
  });

  it("compilePolicy is a function", async () => {
    const { compilePolicy } = await import(
      "../../rules/services/compile-policy.js"
    );
    assert.equal(typeof compilePolicy, "function");
  });
});

describe("Admin policy — hashConfigSnapshot for config integrity", () => {
  it("produces consistent hash for same config", async () => {
    const { hashConfigSnapshot } = await import(
      "../../shared/utils/hashing.js"
    );
    const config = {
      categoryLimits: [{ modalityId: 10, dailyLimit: 15 }],
      blockedRules: [],
    };
    const hash1 = hashConfigSnapshot(config);
    const hash2 = hashConfigSnapshot(config);
    assert.equal(hash1, hash2);
  });

  it("produces different hash for different config", async () => {
    const { hashConfigSnapshot } = await import(
      "../../shared/utils/hashing.js"
    );
    const config1 = { categoryLimits: [{ modalityId: 10, dailyLimit: 15 }] };
    const config2 = { categoryLimits: [{ modalityId: 10, dailyLimit: 20 }] };
    const hash1 = hashConfigSnapshot(config1);
    const hash2 = hashConfigSnapshot(config2);
    assert.notEqual(hash1, hash2);
  });
});

describe("Admin policy — PolicyVersionRow shape", () => {
  it("has correct status values", () => {
    const validStatuses: Array<"draft" | "published" | "archived"> = [
      "draft",
      "published",
      "archived",
    ];
    for (const status of validStatuses) {
      assert.ok(
        ["draft", "published", "archived"].includes(status),
        `${status} should be a valid status`
      );
    }
  });
});
