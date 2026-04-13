/**
 * Appointments V2 — Preview policy impact service.
 *
 * Compares a draft version's rules against the currently published version
 * to show what would change if the draft were published.
 * Returns a diff of rule changes (added, removed, modified).
 */

import type { PoolClient } from "pg";
import {
  findVersionById,
  findPublishedVersion,
  loadAllRulesForVersion,
  type PolicyRuleRow,
} from "../repositories/admin-policy.repo.js";
import { pool } from "../../../../db/pool.js";
import type { PolicyPreviewDto, PolicyRuleDiffDto } from "../../api/dto/admin-scheduling.dto.js";

// Backward-compatible alias used by legacy unit tests.
export type PolicyImpactDiff = PolicyPreviewDto;

export async function previewPolicyImpact(
  draftVersionId: number
): Promise<PolicyPreviewDto> {
  const client = await pool.connect();
  try {
    return previewPolicyImpactInternal(client, draftVersionId);
  } finally {
    client.release();
  }
}

async function previewPolicyImpactInternal(
  client: PoolClient,
  draftVersionId: number
): Promise<PolicyPreviewDto> {
  // 1. Find the draft version
  const draft = await findVersionById(client, draftVersionId);
  if (!draft) {
    throw new Error(`Draft version ${draftVersionId} not found.`);
  }

  if (draft.status !== "draft") {
    throw new Error(`Version ${draftVersionId} is '${draft.status}', not 'draft'.`);
  }

  // 2. Find the published version for the same policy set
  const published = await findPublishedVersionByPolicySetId(client, draft.policySetId);

  // 3. Load rules for both versions
  const draftRules = await loadAllRulesForVersion(client, draftVersionId);
  const publishedRules = published
    ? await loadAllRulesForVersion(client, published.id)
    : [];

  // 4. Compute the diff
  const draftRuleIds = new Set(draftRules.map((r) => r.id));
  const publishedRuleIds = new Set(publishedRules.map((r) => r.id));

  const addedRules = draftRules.filter((r) => !publishedRuleIds.has(r.id)).map(toRuleDiffDto);
  const removedRules = publishedRules.filter((r) => !draftRuleIds.has(r.id)).map(toRuleDiffDto);
  const modifiedRules: Array<{ draft: PolicyRuleDiffDto; published: PolicyRuleDiffDto }> = [];

  // Check for rules in both that may have been modified
  for (const draftRule of draftRules) {
    if (publishedRuleIds.has(draftRule.id)) {
      const pubRule = publishedRules.find((r) => r.id === draftRule.id);
      if (pubRule && JSON.stringify(draftRule) !== JSON.stringify(pubRule)) {
        modifiedRules.push({ draft: toRuleDiffDto(draftRule), published: toRuleDiffDto(pubRule) });
      }
    }
  }

  const warnings: string[] = [];
  if (!published) {
    warnings.push(
      "No published version exists for this policy set. Publishing will make this the first published version."
    );
  }
  if (addedRules.length === 0 && removedRules.length === 0 && modifiedRules.length === 0) {
    warnings.push("No rule differences detected between draft and published version.");
  }

  return {
    draftVersionId,
    publishedVersionId: published?.id ?? null,
    addedRulesCount: addedRules.length,
    removedRulesCount: removedRules.length,
    modifiedRulesCount: modifiedRules.length,
    addedRules,
    removedRules,
    modifiedRules,
    warnings,
  };
}

function toRuleDiffDto(row: PolicyRuleRow): PolicyRuleDiffDto {
  return {
    id: row.id,
    ruleType: row.ruleType,
    modalityId: row.modalityId,
    caseCategory: row.caseCategory,
    dailyLimit: row.dailyLimit,
    isActive: row.isActive,
  };
}

async function findPublishedVersionByPolicySetId(
  client: PoolClient,
  policySetId: number
): Promise<{ id: number; policySetId: number; versionNo: number; status: string } | null> {
  const SQL = `
    select id, policy_set_id as "policySetId", version_no as "versionNo", status
    from appointments_v2.policy_versions
    where policy_set_id = $1 and status = 'published'
    order by version_no desc
    limit 1
  `;
  const result = await client.query(SQL, [policySetId]);
  return result.rows[0] ?? null;
}
