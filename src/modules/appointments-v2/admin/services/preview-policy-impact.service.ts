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

  // 4. Compute the diff using semantic content first, then conservative identity.
  const diff = diffPolicyRules(draftRules, publishedRules);

  const warnings: string[] = [];
  if (!published) {
    warnings.push(
      "No published version exists for this policy set. Publishing will make this the first published version."
    );
  }
  if (diff.ambiguousIdentityKeys.length > 0) {
    warnings.push("Ambiguous rule identity; shown as added/removed instead of modified.");
  }
  if (diff.addedRules.length === 0 && diff.removedRules.length === 0 && diff.modifiedRules.length === 0) {
    warnings.push("No rule differences detected between draft and published version.");
  }

  return {
    draftVersionId,
    publishedVersionId: published?.id ?? null,
    addedRulesCount: diff.addedRules.length,
    removedRulesCount: diff.removedRules.length,
    modifiedRulesCount: diff.modifiedRules.length,
    addedRules: diff.addedRules,
    removedRules: diff.removedRules,
    modifiedRules: diff.modifiedRules,
    warnings,
  };
}

function diffPolicyRules(draftRules: PolicyRuleRow[], publishedRules: PolicyRuleRow[]): {
  addedRules: PolicyRuleDiffDto[];
  removedRules: PolicyRuleDiffDto[];
  modifiedRules: Array<{ draft: PolicyRuleDiffDto; published: PolicyRuleDiffDto }>;
  ambiguousIdentityKeys: string[];
} {
  const unmatchedDraft = [...draftRules];
  const unmatchedPublished = [...publishedRules];

  for (let draftIndex = unmatchedDraft.length - 1; draftIndex >= 0; draftIndex--) {
    const draftKey = contentKey(unmatchedDraft[draftIndex]);
    const publishedIndex = unmatchedPublished.findIndex((rule) => contentKey(rule) === draftKey);
    if (publishedIndex >= 0) {
      unmatchedDraft.splice(draftIndex, 1);
      unmatchedPublished.splice(publishedIndex, 1);
    }
  }

  const modifiedRules: Array<{ draft: PolicyRuleDiffDto; published: PolicyRuleDiffDto }> = [];
  const ambiguousIdentityKeys: string[] = [];
  const draftIdentityCounts = countByIdentity(unmatchedDraft);
  const publishedIdentityCounts = countByIdentity(unmatchedPublished);

  for (let draftIndex = unmatchedDraft.length - 1; draftIndex >= 0; draftIndex--) {
    const draftRule = unmatchedDraft[draftIndex];
    const key = identityKey(draftRule);
    if (!key) continue;
    if ((draftIdentityCounts.get(key) ?? 0) !== 1 || (publishedIdentityCounts.get(key) ?? 0) !== 1) {
      if ((draftIdentityCounts.get(key) ?? 0) > 0 && (publishedIdentityCounts.get(key) ?? 0) > 0) {
        ambiguousIdentityKeys.push(key);
      }
      continue;
    }
    const publishedIndex = unmatchedPublished.findIndex((rule) => identityKey(rule) === key);
    if (publishedIndex >= 0) {
      modifiedRules.push({
        draft: toRuleDiffDto(draftRule),
        published: toRuleDiffDto(unmatchedPublished[publishedIndex]),
      });
      unmatchedDraft.splice(draftIndex, 1);
      unmatchedPublished.splice(publishedIndex, 1);
    }
  }

  return {
    addedRules: unmatchedDraft.map(toRuleDiffDto),
    removedRules: unmatchedPublished.map(toRuleDiffDto),
    modifiedRules,
    ambiguousIdentityKeys: [...new Set(ambiguousIdentityKeys)],
  };
}

function countByIdentity(rows: PolicyRuleRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = identityKey(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function contentKey(row: PolicyRuleRow): string {
  if (row.contentKey) return row.contentKey;
  return JSON.stringify({
    ruleType: row.ruleType,
    modalityId: row.modalityId,
    caseCategory: row.caseCategory,
    dailyLimit: row.dailyLimit,
    isActive: row.isActive,
  });
}

function identityKey(row: PolicyRuleRow): string {
  if (row.identityKey) return row.identityKey;
  if (row.ruleType === "category_daily_limit") {
    return `${row.ruleType}|${row.modalityId ?? ""}|${row.caseCategory ?? ""}`;
  }
  if (row.ruleType === "special_quota") {
    return `${row.ruleType}|${row.modalityId ?? ""}|${row.caseCategory ?? ""}`;
  }
  return `${row.ruleType}|${row.modalityId ?? ""}|${row.caseCategory ?? ""}`;
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
