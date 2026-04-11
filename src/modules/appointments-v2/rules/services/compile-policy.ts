/**
 * Appointments V2 — Compile policy.
 *
 * Loads all rule data for a given policy version from the database
 * and assembles it into an in-memory policy object ready for evaluation.
 * This is the bridge between the persisted config and the pure evaluator.
 */

import type { PoolClient } from "pg";
import {
  findVersionById,
  loadAllRulesForVersion,
} from "../../admin/repositories/admin-policy.repo.js";
import {
  loadModalityBlockedRules,
  loadExamTypeRules,
  loadCategoryDailyLimits,
  loadExamTypeSpecialQuotas,
} from "../repositories/policy-rules.repo.js";

export interface CompiledPolicyContext {
  policyVersionId: number;
  policySetKey: string;
  policyVersionNo: number;
  policyConfigHash: string;
  blockedRules: unknown[];
  examTypeRules: unknown[];
  categoryLimits: unknown[];
  specialQuotas: unknown[];
  examTypeRuleItemExamTypeIds: number[];
}

export interface CompiledPolicy {
  policySetKey: string;
  versionId: number;
  versionNo: number;
  status: "draft" | "published" | "archived";
  configHash: string;
  context: CompiledPolicyContext;
}

export async function compilePolicy(
  client: PoolClient,
  policyVersionId: number,
  policySetKey: string
): Promise<CompiledPolicy> {
  // 1. Find the version
  const version = await findVersionById(client, policyVersionId);
  if (!version) {
    throw new Error(`Policy version ${policyVersionId} not found.`);
  }

  // 2. Load all rules
  const blockedRules = await loadModalityBlockedRules(client, policyVersionId, 0); // 0 = all modalities
  const examTypeRules = await loadExamTypeRules(client, policyVersionId, 0); // 0 = all modalities
  const categoryLimits = await loadCategoryDailyLimits(client, policyVersionId, 0); // 0 = all modalities
  const specialQuotas = await loadExamTypeSpecialQuotas(client, policyVersionId);

  return {
    policySetKey,
    versionId: version.id,
    versionNo: version.versionNo,
    status: version.status,
    configHash: version.configHash,
    context: {
      policyVersionId,
      policySetKey,
      policyVersionNo: version.versionNo,
      policyConfigHash: version.configHash,
      blockedRules,
      examTypeRules,
      categoryLimits,
      specialQuotas,
      examTypeRuleItemExamTypeIds: [], // TODO: load from exam_type_rule_items
    },
  };
}
