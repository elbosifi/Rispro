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
} from "../repositories/admin-policy.repo.js";
import { pool } from "../../../../db/pool.js";

export interface PolicyImpactDiff {
  draftVersionId: number;
  publishedVersionId: number | null;
  addedRules: unknown[];
  removedRules: unknown[];
  modifiedRules: unknown[];
  ruleCountDraft: number;
  ruleCountPublished: number;
  warnings: string[];
}

export async function previewPolicyImpact(
  draftVersionId: number
): Promise<PolicyImpactDiff> {
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
): Promise<PolicyImpactDiff> {
  // 1. Find the draft version
  const draft = await findVersionById(client, draftVersionId);
  if (!draft) {
    throw new Error(`Draft version ${draftVersionId} not found.`);
  }

  if (draft.status !== "draft") {
    throw new Error(`Version ${draftVersionId} is '${draft.status}', not 'draft'.`);
  }

  // 2. Find the published version for the same policy set
  // We need the policy set key — we'll look it up via the policy set id
  // For now, find any published version for the same policy set id
  // TODO: Add a findPublishedVersionByPolicySetId query
  const published = await findPublishedVersionByPolicySetId(client, draft.policySetId);

  // 3. Load rules for both versions
  const draftRules = await loadAllRulesForVersion(client, draftVersionId);
  const publishedRules = published
    ? await loadAllRulesForVersion(client, published.id)
    : [];

  // 4. Compute the diff
  const draftRuleIds = new Set(draftRules.map((r) => r.id));
  const publishedRuleIds = new Set(publishedRules.map((r) => r.id));

  const addedRules = draftRules.filter((r) => !publishedRuleIds.has(r.id));
  const removedRules = publishedRules.filter((r) => !draftRuleIds.has(r.id));
  const modifiedRules: unknown[] = [];

  // Check for rules in both that may have been modified
  for (const draftRule of draftRules) {
    if (publishedRuleIds.has(draftRule.id)) {
      const pubRule = publishedRules.find((r) => r.id === draftRule.id);
      if (pubRule && JSON.stringify(draftRule) !== JSON.stringify(pubRule)) {
        modifiedRules.push({ id: draftRule.id, draft: draftRule, published: pubRule });
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
    addedRules,
    removedRules,
    modifiedRules,
    ruleCountDraft: draftRules.length,
    ruleCountPublished: publishedRules.length,
    warnings,
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
