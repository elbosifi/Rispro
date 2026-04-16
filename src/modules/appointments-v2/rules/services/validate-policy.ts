/**
 * Appointments V2 — Validate policy draft.
 *
 * Checks completeness and consistency of a draft before publishing.
 * D006/D007 compliance: ensures the draft is safe to publish.
 */

import type { PoolClient } from "pg";
import {
  findVersionById,
  loadAllRulesForVersion,
  type PolicyRuleRow,
} from "../../admin/repositories/admin-policy.repo.js";
import { pool } from "../../../../db/pool.js";

export interface PolicyValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a policy draft. Returns errors and warnings.
 * Called by the publish service before publishing (D007).
 */
export async function validatePolicyDraft(
  policyVersionId: number
): Promise<PolicyValidationResult> {
  const client = await pool.connect();
  try {
    return validatePolicyDraftInternal(client, policyVersionId);
  } finally {
    client.release();
  }
}

async function validatePolicyDraftInternal(
  client: PoolClient,
  policyVersionId: number
): Promise<PolicyValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Version must exist
  const version = await findVersionById(client, policyVersionId);
  if (!version) {
    return {
      isValid: false,
      errors: [`Policy version ${policyVersionId} does not exist.`],
      warnings: [],
    };
  }

  // 2. Must be a draft
  if (version.status !== "draft") {
    errors.push(`Version ${policyVersionId} is '${version.status}', not 'draft'.`);
    return { isValid: false, errors, warnings };
  }

  // 3. Config hash must be non-empty
  if (!version.configHash || version.configHash.length === 0) {
    errors.push("Policy draft has no configuration hash.");
  }

  // 4. Load all rules for this version
  const rules = await loadAllRulesForVersion(client, policyVersionId);

  // 5. Check for orphaned rules (rules pointing to non-existent modalities/exam types)
  // This is a warning because it might be intentional (e.g., preparing for a new modality)
  const ruleModalities = new Set(
    rules.filter((r: PolicyRuleRow) => r.modalityId != null).map((r: PolicyRuleRow) => r.modalityId)
  );
  if (ruleModalities.size === 0 && rules.length > 0) {
    warnings.push("No rules reference a modality. All rules may be orphaned.");
  }

  // 6. Check for category limits with zero daily limit
  const zeroLimits = rules.filter(
    (r: PolicyRuleRow) => r.ruleType === "category_daily_limit" && r.dailyLimit === 0
  );
  if (zeroLimits.length > 0) {
    warnings.push(
      `${zeroLimits.length} category daily limit rule(s) have daily_limit=0. This blocks all bookings for those categories.`
    );
  }

  // 7. Check for special quota rules with zero extra slots
  const zeroQuotas = rules.filter(
    (r: PolicyRuleRow) => r.ruleType === "special_quota" && r.dailyLimit === 0
  );
  if (zeroQuotas.length > 0) {
    warnings.push(
      `${zeroQuotas.length} special quota rule(s) have daily_extra_slots=0. These quotas have no effect.`
    );
  }

  // 8. Check that there's at least one active rule or an empty config is intentional
  if (rules.length === 0) {
    warnings.push(
      "Policy draft has no rules. This means no scheduling restrictions will apply."
    );
  }

  // 9. Category limits must be consistent with modality daily capacity.
  const activeCategoryRules = rules.filter(
    (r: PolicyRuleRow) => r.ruleType === "category_daily_limit" && r.isActive && r.modalityId != null
  );
  if (activeCategoryRules.length > 0) {
    const modalityIds = [...new Set(activeCategoryRules.map((r) => Number(r.modalityId)))];
    const capacities = await client.query<{ id: number; dailyCapacity: number | null }>(
      `
        select id, daily_capacity as "dailyCapacity"
        from modalities
        where id = any($1::bigint[])
      `,
      [modalityIds]
    );
    const capacityByModality = new Map<number, number | null>();
    for (const row of capacities.rows) {
      capacityByModality.set(Number(row.id), row.dailyCapacity == null ? null : Number(row.dailyCapacity));
    }

    for (const modalityId of modalityIds) {
      const modalityCapacity = capacityByModality.get(modalityId) ?? null;
      if (modalityCapacity == null || !Number.isFinite(modalityCapacity)) {
        errors.push(`Modality ${modalityId} has no valid daily capacity.`);
        continue;
      }

      const rows = activeCategoryRules.filter((r) => Number(r.modalityId) === modalityId);
      const oncology = rows.find((r) => r.caseCategory === "oncology");
      const nonOncology = rows.find((r) => r.caseCategory === "non_oncology");
      if (oncology && nonOncology) {
        const sum = Number(oncology.dailyLimit ?? 0) + Number(nonOncology.dailyLimit ?? 0);
        if (sum !== modalityCapacity) {
          errors.push(
            `Modality ${modalityId}: oncology + non_oncology limits must equal daily capacity (${modalityCapacity}).`
          );
        }
      } else {
        const configured = oncology ?? nonOncology;
        if (!configured) continue;
        if (Number(configured.dailyLimit ?? 0) > modalityCapacity) {
          errors.push(
            `Modality ${modalityId}: ${configured.caseCategory} daily limit cannot exceed daily capacity (${modalityCapacity}).`
          );
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
