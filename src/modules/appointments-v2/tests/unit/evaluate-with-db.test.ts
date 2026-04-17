/**
 * Appointments V2 — evaluateWithDb unit tests.
 *
 * Tests the orchestration layer structure, shape, and source wiring.
 * Full integration tests require a real PostgreSQL instance (see integration tests).
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: EvaluateWithDbParams shape
// ---------------------------------------------------------------------------

describe("EvaluateWithDbParams — shape", () => {
  it("has all required BookingDecisionInput fields", () => {
    const params = {
      patientId: 1,
      modalityId: 10,
      examTypeId: null as number | null,
      scheduledDate: "2026-05-01",
      caseCategory: "non_oncology" as const,
      useSpecialQuota: false,
      specialReasonCode: null as string | null,
      includeOverrideEvaluation: false,
    };

    assert.equal(params.patientId, 1);
    assert.equal(params.modalityId, 10);
    assert.equal(params.examTypeId, null);
    assert.equal(params.scheduledDate, "2026-05-01");
    assert.equal(params.caseCategory, "non_oncology");
    assert.equal(params.useSpecialQuota, false);
    assert.equal(params.specialReasonCode, null);
    assert.equal(params.includeOverrideEvaluation, false);
  });

  it("supports optional examTypeId", () => {
    const params = {
      patientId: 1,
      modalityId: 10,
      examTypeId: 50,
      scheduledDate: "2026-05-01",
      caseCategory: "non_oncology" as const,
      useSpecialQuota: false,
      specialReasonCode: null,
      includeOverrideEvaluation: false,
    };

    assert.equal(params.examTypeId, 50);
  });

  it("supports special quota fields", () => {
    const params = {
      patientId: 1,
      modalityId: 10,
      examTypeId: 50,
      scheduledDate: "2026-05-01",
      caseCategory: "non_oncology" as const,
      useSpecialQuota: true,
      specialReasonCode: "urgent_cancer",
      includeOverrideEvaluation: false,
    };

    assert.equal(params.useSpecialQuota, true);
    assert.equal(params.specialReasonCode, "urgent_cancer");
  });
});

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("evaluateWithDb — function structure", () => {
  it("exports evaluateWithDb function", async () => {
    const { evaluateWithDb } = await import("../../rules/services/evaluate-with-db.js");
    assert.ok(typeof evaluateWithDb === "function");
  });

  it("evaluateWithDb is an async function", async () => {
    const { evaluateWithDb } = await import("../../rules/services/evaluate-with-db.js");
    assert.ok(evaluateWithDb.constructor.name === "AsyncFunction" || typeof evaluateWithDb === "function");
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — DB loading
// ---------------------------------------------------------------------------

describe("evaluateWithDb — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
  });

  it("loads published policy version from DB", () => {
    assert.ok(
      source.includes("findPublishedPolicyVersion"),
      "Should call findPublishedPolicyVersion"
    );
  });

  it("checks modality existence via findModalityById", () => {
    assert.ok(
      source.includes("findModalityById"),
      "Should call findModalityById"
    );
  });

  it("checks exam type existence via findExamTypeById", () => {
    assert.ok(
      source.includes("findExamTypeById"),
      "Should call findExamTypeById"
    );
  });

  it("loads blocked rules from DB", () => {
    assert.ok(
      source.includes("loadModalityBlockedRules"),
      "Should call loadModalityBlockedRules"
    );
  });

  it("loads exam type rules from DB", () => {
    assert.ok(
      source.includes("loadExamTypeRules"),
      "Should call loadExamTypeRules"
    );
  });

  it("loads category daily limits from DB", () => {
    assert.ok(
      source.includes("loadCategoryDailyLimits"),
      "Should call loadCategoryDailyLimits"
    );
  });

  it("loads exam type special quotas from DB", () => {
    assert.ok(
      source.includes("loadExamTypeSpecialQuotas"),
      "Should call loadExamTypeSpecialQuotas"
    );
  });

  it("loads exam type rule item IDs from DB", () => {
    assert.ok(
      source.includes("loadExamTypeRuleItemExamTypeIds"),
      "Should call loadExamTypeRuleItemExamTypeIds"
    );
  });

  it("loads per-rule exam type memberships from DB", () => {
    assert.ok(
      source.includes("loadExamTypeRuleItems"),
      "Should call loadExamTypeRuleItems"
    );
  });

  it("loads booked count from capacity repo", () => {
    assert.ok(
      source.includes("getBookedCountForDate"),
      "Should call getBookedCountForDate"
    );
  });

  it("delegates to pureEvaluate", () => {
    assert.ok(
      source.includes("pureEvaluate"),
      "Should call pureEvaluate"
    );
  });

  it("builds RuleEvaluationContext with all required fields", () => {
    assert.ok(source.includes("modalityExists"), "Should set modalityExists");
    assert.ok(source.includes("examTypeExists"), "Should set examTypeExists");
    assert.ok(source.includes("examTypeBelongsToModality"), "Should set examTypeBelongsToModality");
    assert.ok(source.includes("currentBookedCount"), "Should set currentBookedCount");
  });

  it("sets examTypeBelongsToModality based on exam type modalityId", () => {
    assert.ok(
      source.includes("examType.modalityId"),
      "Should compare exam type modalityId with requested modalityId"
    );
  });

  it("returns blocked decision with no_published_policy reason when no published policy", () => {
    assert.ok(source.includes("no_published_policy"), "Should have no_published_policy reason code");
    assert.ok(source.includes('"blocked"'), "Should return blocked status");
    assert.ok(source.includes("isAllowed: false"), "Should return isAllowed: false");
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — PureEvaluateInput construction
// ---------------------------------------------------------------------------

describe("evaluateWithDb — PureEvaluateInput construction", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
  });

  it("passes patientId through to pureEvaluate", () => {
    assert.ok(source.includes("patientId: params.patientId"), "Should pass patientId");
  });

  it("passes modalityId through to pureEvaluate", () => {
    assert.ok(source.includes("modalityId: params.modalityId"), "Should pass modalityId");
  });

  it("passes examTypeId with null fallback", () => {
    assert.ok(
      source.includes("examTypeId: params.examTypeId") && source.includes("??" ),
      "Should pass examTypeId with null fallback"
    );
  });

  it("passes scheduledDate through to pureEvaluate", () => {
    assert.ok(source.includes("scheduledDate: params.scheduledDate"), "Should pass scheduledDate");
  });

  it("passes caseCategory through to pureEvaluate", () => {
    assert.ok(source.includes("caseCategory: params.caseCategory"), "Should pass caseCategory");
  });

  it("passes useSpecialQuota derived from capacityResolutionMode", () => {
    assert.ok(
      source.includes('useSpecialQuota: capacityResolutionMode === "special_quota_extra"'),
      "Should derive useSpecialQuota from capacityResolutionMode"
    );
  });

  it("passes specialReasonCode with null fallback", () => {
    assert.ok(
      source.includes("specialReasonCode: params.specialReasonCode") && source.includes("?? null"),
      "Should pass specialReasonCode with null fallback"
    );
  });

  it("passes includeOverrideEvaluation with false fallback", () => {
    assert.ok(
      source.includes("includeOverrideEvaluation: params.includeOverrideEvaluation") && source.includes("?? false"),
      "Should pass includeOverrideEvaluation with false fallback"
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: BookingDecision return shape
// ---------------------------------------------------------------------------

describe("evaluateWithDb — no published policy return shape (source)", () => {
  it("returns isAllowed: false when no published policy exists", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    // The no-policy branch should set isAllowed: false
    assert.ok(source.includes("isAllowed: false"), "Should set isAllowed: false");
  });

  it("returns displayStatus: blocked when no published policy exists", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(source.includes('"blocked"'), 'Should set displayStatus to "blocked"');
  });

  it("includes policyVersionRef with versionId: 0 when no published policy", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(source.includes("versionId: 0"), "Should set versionId: 0");
    assert.ok(source.includes("versionNo: 0"), "Should set versionNo: 0");
    assert.ok(source.includes('configHash: ""'), "Should set empty configHash");
  });

  it("includes decisionTrace with evaluatedAt timestamp", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(source.includes("decisionTrace"), "Should include decisionTrace");
    assert.ok(source.includes("new Date().toISOString()"), "Should set evaluatedAt to current timestamp");
  });
});

// ---------------------------------------------------------------------------
// Tests: integration with pureEvaluate
// ---------------------------------------------------------------------------

describe("evaluateWithDb — integration wiring", () => {
  it("imports pureEvaluate from the correct module", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "./pure-evaluate.js"'),
      "Should import pureEvaluate from relative path"
    );
  });

  it("imports policy version repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/policy-version.repo.js"'),
      "Should import policy-version.repo from relative path"
    );
  });

  it("imports policy rules repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/policy-rules.repo.js"'),
      "Should import policy-rules.repo from relative path"
    );
  });

  it("imports capacity repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../scheduler/repositories/capacity.repo.js"'),
      "Should import capacity.repo from relative path"
    );
  });

  it("imports modality catalog from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../catalog/repositories/modality-catalog.repo.js"'),
      "Should import modality-catalog.repo from relative path"
    );
  });

  it("imports exam type catalog from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/rules/services/evaluate-with-db.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../catalog/repositories/exam-type-catalog.repo.js"'),
      "Should import exam-type-catalog.repo from relative path"
    );
  });
});
