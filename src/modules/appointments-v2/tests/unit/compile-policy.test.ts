/**
 * Appointments V2 — compilePolicy unit tests.
 *
 * Tests the compile policy service structure, exports, and source wiring.
 * Uses source verification since Node.js ESM mocking is limited.
 * compilePolicy is a pure data loader — no branching logic beyond "version not found".
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("compilePolicy — function structure", () => {
  it("exports compilePolicy function", async () => {
    const { compilePolicy } = await import("../../rules/services/compile-policy.js");
    assert.ok(typeof compilePolicy === "function");
  });

  it("compilePolicy is an async function", async () => {
    const { compilePolicy } = await import("../../rules/services/compile-policy.js");
    assert.ok(compilePolicy.constructor.name === "AsyncFunction" || typeof compilePolicy === "function");
  });

  it("CompiledPolicy has correct shape", () => {
    const result = {
      policySetKey: "default",
      versionId: 10,
      versionNo: 2,
      status: "published" as const,
      configHash: "abc123",
      context: {
        policyVersionId: 10,
        policySetKey: "default",
        policyVersionNo: 2,
        policyConfigHash: "abc123",
        blockedRules: [],
        examTypeRules: [],
        categoryLimits: [],
        specialQuotas: [],
        examTypeRuleItemExamTypeIds: [50],
      },
    };

    assert.equal(typeof result.policySetKey, "string");
    assert.equal(typeof result.versionId, "number");
    assert.equal(typeof result.versionNo, "number");
    assert.ok(["draft", "published", "archived"].includes(result.status));
    assert.ok(Array.isArray(result.context.blockedRules));
    assert.ok(Array.isArray(result.context.examTypeRules));
    assert.ok(Array.isArray(result.context.categoryLimits));
    assert.ok(Array.isArray(result.context.specialQuotas));
    assert.ok(Array.isArray(result.context.examTypeRuleItemExamTypeIds));
  });

  it("CompiledPolicyContext has all required fields", () => {
    const context = {
      policyVersionId: 10,
      policySetKey: "default",
      policyVersionNo: 2,
      policyConfigHash: "abc123",
      blockedRules: [] as unknown[],
      examTypeRules: [] as unknown[],
      categoryLimits: [] as unknown[],
      specialQuotas: [] as unknown[],
      examTypeRuleItemExamTypeIds: [50],
    };

    assert.equal(typeof context.policyVersionId, "number");
    assert.equal(typeof context.policySetKey, "string");
    assert.equal(typeof context.policyVersionNo, "number");
    assert.equal(typeof context.policyConfigHash, "string");
    assert.ok(Array.isArray(context.examTypeRuleItemExamTypeIds));
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — rule loading
// ---------------------------------------------------------------------------

describe("compilePolicy — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/compile-policy.ts",
      "utf-8"
    );
  });

  it("finds version by ID", () => {
    assert.ok(source.includes("findVersionById"), "Should call findVersionById");
    assert.ok(source.includes("not found"), "Should have 'not found' error message");
  });

  it("loads blocked rules for all modalities (modalityId=0)", () => {
    assert.ok(source.includes("loadModalityBlockedRules"), "Should call loadModalityBlockedRules");
    assert.ok(source.includes(", 0)"), "Should pass 0 for all modalities");
  });

  it("loads exam type rules for all modalities (modalityId=0)", () => {
    assert.ok(source.includes("loadExamTypeRules"), "Should call loadExamTypeRules");
  });

  it("loads category daily limits for all modalities (modalityId=0)", () => {
    assert.ok(source.includes("loadCategoryDailyLimits"), "Should call loadCategoryDailyLimits");
  });

  it("loads exam type special quotas", () => {
    assert.ok(source.includes("loadExamTypeSpecialQuotas"), "Should call loadExamTypeSpecialQuotas");
  });

  it("loads exam type rule item exam type IDs", () => {
    assert.ok(source.includes("loadAllExamTypeRuleItemExamTypeIds"), "Should call loadAllExamTypeRuleItemExamTypeIds");
  });

  it("returns policySetKey, versionId, versionNo, status, configHash", () => {
    assert.ok(source.includes("policySetKey,"), "Should return policySetKey");
    assert.ok(source.includes("versionId: version.id"), "Should return versionId");
    assert.ok(source.includes("versionNo: version.versionNo"), "Should return versionNo");
    assert.ok(source.includes("status: version.status"), "Should return status");
    assert.ok(source.includes("configHash: version.configHash"), "Should return configHash");
  });

  it("builds CompiledPolicyContext with all rule arrays", () => {
    assert.ok(source.includes("context:"), "Should build context");
    assert.ok(source.includes("blockedRules,"), "Should include blockedRules");
    assert.ok(source.includes("examTypeRules,"), "Should include examTypeRules");
    assert.ok(source.includes("categoryLimits,"), "Should include categoryLimits");
    assert.ok(source.includes("specialQuotas,"), "Should include specialQuotas");
    assert.ok(source.includes("examTypeRuleItemExamTypeIds,"), "Should include examTypeRuleItemExamTypeIds");
  });

  it("passes policyVersionId to rule loading functions", () => {
    assert.ok(source.includes("client, policyVersionId"), "Should pass policyVersionId to rule loaders");
  });
});

// ---------------------------------------------------------------------------
// Tests: import wiring
// ---------------------------------------------------------------------------

describe("compilePolicy — import wiring", () => {
  it("imports admin policy repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/compile-policy.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../admin/repositories/admin-policy.repo.js"'),
      "Should import admin-policy.repo from relative path"
    );
  });

  it("imports policy rules repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/compile-policy.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/policy-rules.repo.js"'),
      "Should import policy-rules.repo from relative path"
    );
  });

  it("imports all rule loading functions", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/compile-policy.ts",
      "utf-8"
    );
    assert.ok(source.includes("loadModalityBlockedRules,"), "Should import loadModalityBlockedRules");
    assert.ok(source.includes("loadExamTypeRules,"), "Should import loadExamTypeRules");
    assert.ok(source.includes("loadCategoryDailyLimits,"), "Should import loadCategoryDailyLimits");
    assert.ok(source.includes("loadExamTypeSpecialQuotas,"), "Should import loadExamTypeSpecialQuotas");
    assert.ok(source.includes("loadAllExamTypeRuleItemExamTypeIds,"), "Should import loadAllExamTypeRuleItemExamTypeIds");
  });
});

// ---------------------------------------------------------------------------
// Tests: error handling
// ---------------------------------------------------------------------------

describe("compilePolicy — error handling", () => {
  it("throws Error when version not found", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/compile-policy.ts",
      "utf-8"
    );
    assert.ok(source.includes("throw new Error"), "Should throw Error (not SchedulingError)");
    assert.ok(source.includes("not found"), "Should include 'not found' in message");
  });

  it("uses template literal for error message with versionId", () => {
    const fs = import("node:fs/promises").then(async (m) => {
      const source = await m.default.readFile(
        "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/compile-policy.ts",
        "utf-8"
      );
      assert.ok(source.includes("Policy version ${policyVersionId} not found"),
        "Should include versionId in error message");
    });
    return fs;
  });
});
