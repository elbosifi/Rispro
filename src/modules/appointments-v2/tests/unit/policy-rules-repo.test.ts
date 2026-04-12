/**
 * Appointments V2 — Policy rules repository tests.
 *
 * Tests the 6 rule-loading query functions that power the decision engine.
 * These functions load blocked rules, exam type rules, category limits,
 * special quotas, and exam type rule item IDs from the V2 schema.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";

const repoPath = join(
  process.cwd(),
  "src/modules/appointments-v2/rules/repositories/policy-rules.repo.ts"
);
const source = readFileSync(repoPath, "utf-8");

// ---------------------------------------------------------------------------
// 1. loadModalityBlockedRules
// ---------------------------------------------------------------------------

describe("loadModalityBlockedRules", () => {
  it("exports loadModalityBlockedRules function", async () => {
    const { loadModalityBlockedRules } = await import(
      "../../rules/repositories/policy-rules.repo.js"
    );
    assert.strictEqual(typeof loadModalityBlockedRules, "function");
  });

  it("queries modality_blocked_rules table", () => {
    assert.ok(
      source.includes("appointments_v2.modality_blocked_rules"),
      "Should query modality_blocked_rules table"
    );
  });

  it("selects expected columns", () => {
    assert.ok(source.includes("policy_version_id"), "Should select policy_version_id");
    assert.ok(source.includes("modality_id"), "Should select modality_id");
    assert.ok(source.includes("is_active"), "Should select is_active");
  });

  it("filters by policy_version_id, modality_id, and is_active", () => {
    assert.ok(
      source.includes("where policy_version_id = $1"),
      "Should filter by policy_version_id"
    );
    assert.ok(
      source.includes("and modality_id = $2"),
      "Should filter by modality_id"
    );
    assert.ok(
      source.includes("and is_active = true"),
      "Should filter by is_active = true"
    );
  });

  it("passes policyVersionId and modalityId parameters", () => {
    const funcStart = source.indexOf("export async function loadModalityBlockedRules");
    const funcEnd = source.indexOf("export async function", funcStart + 1);
    const funcSource = source.slice(funcStart, funcEnd);

    assert.ok(
      funcSource.includes("policyVersionId") && funcSource.includes("modalityId"),
      "Should pass both parameters"
    );
  });
});

// ---------------------------------------------------------------------------
// 2. loadExamTypeRules
// ---------------------------------------------------------------------------

describe("loadExamTypeRules", () => {
  it("exports loadExamTypeRules function", async () => {
    const { loadExamTypeRules } = await import(
      "../../rules/repositories/policy-rules.repo.js"
    );
    assert.strictEqual(typeof loadExamTypeRules, "function");
  });

  it("queries exam_type_rules table", () => {
    assert.ok(
      source.includes("appointments_v2.exam_type_rules"),
      "Should query exam_type_rules table"
    );
  });

  it("selects expected columns", () => {
    assert.ok(source.includes("effect_mode"), "Should select effect_mode");
    assert.ok(source.includes("alternate_weeks"), "Should select alternate_weeks");
    assert.ok(source.includes("is_active"), "Should select is_active");
  });

  it("filters by policy_version_id, modality_id, and is_active", () => {
    assert.ok(
      source.includes("where policy_version_id = $1"),
      "Should filter by policy_version_id"
    );
    assert.ok(
      source.includes("and modality_id = $2"),
      "Should filter by modality_id"
    );
    assert.ok(
      source.includes("and is_active = true"),
      "Should filter by is_active = true"
    );
  });

  it("passes policyVersionId and modalityId parameters", () => {
    const funcStart = source.indexOf("export async function loadExamTypeRules");
    const funcEnd = source.indexOf("export async function", funcStart + 1);
    const funcSource = source.slice(funcStart, funcEnd);

    assert.ok(
      funcSource.includes("policyVersionId") && funcSource.includes("modalityId"),
      "Should pass both parameters"
    );
  });
});

// ---------------------------------------------------------------------------
// 3. loadCategoryDailyLimits
// ---------------------------------------------------------------------------

describe("loadCategoryDailyLimits", () => {
  it("exports loadCategoryDailyLimits function", async () => {
    const { loadCategoryDailyLimits } = await import(
      "../../rules/repositories/policy-rules.repo.js"
    );
    assert.strictEqual(typeof loadCategoryDailyLimits, "function");
  });

  it("queries category_daily_limits table", () => {
    assert.ok(
      source.includes("appointments_v2.category_daily_limits"),
      "Should query category_daily_limits table"
    );
  });

  it("selects expected columns", () => {
    assert.ok(source.includes("case_category"), "Should select case_category");
    assert.ok(source.includes("daily_limit"), "Should select daily_limit");
    assert.ok(source.includes("is_active"), "Should select is_active");
  });

  it("filters by policy_version_id, modality_id, and is_active", () => {
    assert.ok(
      source.includes("where policy_version_id = $1"),
      "Should filter by policy_version_id"
    );
    assert.ok(
      source.includes("and modality_id = $2"),
      "Should filter by modality_id"
    );
    assert.ok(
      source.includes("and is_active = true"),
      "Should filter by is_active = true"
    );
  });

  it("passes policyVersionId and modalityId parameters", () => {
    const funcStart = source.indexOf("export async function loadCategoryDailyLimits");
    const funcEnd = source.indexOf("export async function", funcStart + 1);
    const funcSource = source.slice(funcStart, funcEnd);

    assert.ok(
      funcSource.includes("policyVersionId") && funcSource.includes("modalityId"),
      "Should pass both parameters"
    );
  });
});

// ---------------------------------------------------------------------------
// 4. loadExamTypeSpecialQuotas
// ---------------------------------------------------------------------------

describe("loadExamTypeSpecialQuotas", () => {
  it("exports loadExamTypeSpecialQuotas function", async () => {
    const { loadExamTypeSpecialQuotas } = await import(
      "../../rules/repositories/policy-rules.repo.js"
    );
    assert.strictEqual(typeof loadExamTypeSpecialQuotas, "function");
  });

  it("queries exam_type_special_quotas table", () => {
    assert.ok(
      source.includes("appointments_v2.exam_type_special_quotas"),
      "Should query exam_type_special_quotas table"
    );
  });

  it("selects expected columns", () => {
    assert.ok(source.includes("exam_type_id"), "Should select exam_type_id");
    assert.ok(source.includes("daily_extra_slots"), "Should select daily_extra_slots");
    assert.ok(source.includes("is_active"), "Should select is_active");
  });

  it("filters by policy_version_id and is_active only (no modality filter)", () => {
    assert.ok(
      source.includes("where policy_version_id = $1"),
      "Should filter by policy_version_id"
    );
    assert.ok(
      source.includes("and is_active = true"),
      "Should filter by is_active = true"
    );
    // This function does NOT filter by modality_id — quotas are exam-type specific, not modality-specific
    const funcStart = source.indexOf("const LOAD_SPECIAL_QUOTAS_SQL");
    const funcEnd = source.indexOf("export async function loadExamTypeSpecialQuotas");
    const sqlSource = source.slice(funcStart, funcEnd);
    assert.ok(
      !sqlSource.toLowerCase().includes("modality_id"),
      "SQL should NOT filter by modality_id"
    );
  });

  it("passes only policyVersionId parameter", () => {
    const funcStart = source.indexOf("export async function loadExamTypeSpecialQuotas");
    const nextFunc = source.indexOf("\nexport async function", funcStart + 1);
    const funcEnd = nextFunc === -1 ? source.length : nextFunc;
    const funcSource = source.slice(funcStart, funcEnd);

    assert.ok(
      funcSource.includes("policyVersionId") && !funcSource.includes("modalityId"),
      "Should pass only policyVersionId"
    );
  });
});

// ---------------------------------------------------------------------------
// 5. loadExamTypeRuleItemExamTypeIds
// ---------------------------------------------------------------------------

describe("loadExamTypeRuleItemExamTypeIds", () => {
  it("exports loadExamTypeRuleItemExamTypeIds function", async () => {
    const { loadExamTypeRuleItemExamTypeIds } = await import(
      "../../rules/repositories/policy-rules.repo.js"
    );
    assert.strictEqual(typeof loadExamTypeRuleItemExamTypeIds, "function");
  });

  it("queries exam_type_rule_items and exam_type_rules tables (JOIN)", () => {
    assert.ok(
      source.includes("appointments_v2.exam_type_rule_items"),
      "Should query exam_type_rule_items table"
    );
    assert.ok(
      source.includes("appointments_v2.exam_type_rules"),
      "Should query exam_type_rules table"
    );
    assert.ok(
      source.includes("inner join") || source.includes("INNER JOIN"),
      "Should use JOIN to connect tables"
    );
  });

  it("selects exam_type_id column", () => {
    assert.ok(
      source.includes('exam_type_id as "examTypeId"'),
      'Should select exam_type_id as "examTypeId"'
    );
  });

  it("filters by policy_version_id, modality_id, and is_active on exam_type_rules", () => {
    assert.ok(
      source.includes("etr.policy_version_id = $1"),
      "Should filter exam_type_rules by policy_version_id"
    );
    assert.ok(
      source.includes("etr.modality_id = $2"),
      "Should filter exam_type_rules by modality_id"
    );
    assert.ok(
      source.includes("etr.is_active = true"),
      "Should filter exam_type_rules by is_active"
    );
  });

  it("passes policyVersionId and modalityId parameters", () => {
    const funcStart = source.indexOf("export async function loadExamTypeRuleItemExamTypeIds");
    const funcEnd = source.indexOf("export async function", funcStart + 1);
    const funcSource = source.slice(funcStart, funcEnd);

    assert.ok(
      funcSource.includes("[policyVersionId, modalityId]"),
      "Should pass both parameters"
    );
  });
});

// ---------------------------------------------------------------------------
// 6. loadAllExamTypeRuleItemExamTypeIds
// ---------------------------------------------------------------------------

describe("loadAllExamTypeRuleItemExamTypeIds", () => {
  it("exports loadAllExamTypeRuleItemExamTypeIds function", async () => {
    const { loadAllExamTypeRuleItemExamTypeIds } = await import(
      "../../rules/repositories/policy-rules.repo.js"
    );
    assert.strictEqual(typeof loadAllExamTypeRuleItemExamTypeIds, "function");
  });

  it("queries exam_type_rule_items and exam_type_rules tables (JOIN)", () => {
    assert.ok(
      source.includes("appointments_v2.exam_type_rule_items"),
      "Should query exam_type_rule_items table"
    );
    assert.ok(
      source.includes("appointments_v2.exam_type_rules"),
      "Should query exam_type_rules table"
    );
  });

  it("filters by policy_version_id only (no modality filter — all modalities)", () => {
    const sqlStart = source.indexOf("const LOAD_ALL_EXAM_RULE_ITEM_EXAM_TYPE_IDS_SQL");
    const sqlEnd = source.indexOf("export async function loadAllExamTypeRuleItemExamTypeIds");
    const sqlSource = source.slice(sqlStart, sqlEnd);

    assert.ok(
      sqlSource.includes("etr.policy_version_id = $1"),
      "Should filter by policy_version_id"
    );
    assert.ok(
      !sqlSource.toLowerCase().includes("modality_id"),
      "SQL should NOT filter by modality_id (all modalities)"
    );
  });

  it("uses distinct to avoid duplicate exam type IDs", () => {
    assert.ok(
      source.includes("distinct") || source.includes("DISTINCT"),
      "Should use DISTINCT to avoid duplicates"
    );
  });

  it("passes only policyVersionId parameter", () => {
    const funcStart = source.indexOf("export async function loadAllExamTypeRuleItemExamTypeIds");
    const funcEnd = source.length;
    const funcSource = source.slice(funcStart, funcEnd);

    assert.ok(
      funcSource.includes("policyVersionId") && !funcSource.includes("modalityId"),
      "Should pass only policyVersionId"
    );
  });
});
