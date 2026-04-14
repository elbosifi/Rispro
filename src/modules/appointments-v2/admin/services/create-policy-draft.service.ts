/**
 * Appointments V2 — Create policy draft service.
 *
 * Creates a new draft version based on the currently published version.
 * When a published version exists, all its rule rows are copied into the
 * new draft version and the config hash is recalculated from the persisted data.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { hashConfigSnapshot } from "../../shared/utils/hashing.js";
import { loadPolicySnapshot } from "./policy-snapshot.service.js";
import {
  findPolicySetByKey,
  findPublishedVersion,
  findDraftVersion,
  findVersionById,
  getNextVersionNumber,
  createDraftVersion,
  updateDraftConfig,
  deleteAllRulesForVersion,
  insertCategoryDailyLimit,
  insertModalityBlockedRule,
  insertExamTypeRule,
  insertExamTypeSpecialQuota,
  type PolicyVersionRow,
} from "../repositories/admin-policy.repo.js";
import { pool } from "../../../../db/pool.js";

export interface CreatePolicyDraftResult {
  draft: PolicyVersionRow;
  basedOnVersionId: number;
}

export async function createPolicyDraft(
  policySetKey: string,
  userId: number,
  changeNote: string | null = null
): Promise<CreatePolicyDraftResult> {
  return withTransaction(async (client) => {
    return createPolicyDraftInternal(client, policySetKey, userId, changeNote);
  });
}

async function createPolicyDraftInternal(
  client: PoolClient,
  policySetKey: string,
  userId: number,
  changeNote: string | null
): Promise<CreatePolicyDraftResult> {
  // 1. Find the policy set
  const policySet = await findPolicySetByKey(client, policySetKey);
  if (!policySet) {
    throw new SchedulingError(
      404,
      `Policy set '${policySetKey}' not found.`,
      ["policy_set_not_found"]
    );
  }

  // 2. Check if a draft already exists
  const existingDraft = await findDraftVersion(client, policySetKey);
  if (existingDraft) {
    throw new SchedulingError(
      409,
      `A draft already exists for policy set '${policySetKey}' (version ${existingDraft.versionNo}).`,
      ["draft_already_exists"]
    );
  }

  // 3. Find the published version to base the draft on
  const published = await findPublishedVersion(client, policySetKey);
  if (!published) {
    // No published version — create a draft with empty config
    const nextVersion = await getNextVersionNumber(client, policySet.id);
    const emptyConfigHash = hashConfigSnapshot({});
    const draft = await createDraftVersion(
      client,
      policySet.id,
      nextVersion,
      emptyConfigHash,
      userId,
      changeNote ?? "Initial draft (no published version)"
    );
    return { draft, basedOnVersionId: 0 };
  }

  // 4. Load the published snapshot (rule rows from DB)
  const publishedSnapshot = await loadPolicySnapshot(client, published.id);

  // 5. Create the draft version row
  const nextVersion = await getNextVersionNumber(client, policySet.id);
  const draft = await createDraftVersion(
    client,
    policySet.id,
    nextVersion,
    published.configHash, // temporary hash; will be recalculated below
    userId,
    changeNote ?? `Draft based on published version ${published.versionNo}`
  );

  // 6. Copy all rule rows from the published snapshot into the draft version
  await copySnapshotIntoVersion(client, draft.id, publishedSnapshot);

  // 7. Recalculate hash from the actually-persisted rules
  const configHash = hashConfigSnapshot(publishedSnapshot);
  await updateDraftConfig(client, draft.id, configHash, null);

  // 8. Refresh and return
  const refreshedDraft = await findVersionById(client, draft.id);
  if (!refreshedDraft) {
    throw new SchedulingError(
      500,
      "Failed to retrieve created draft.",
      ["draft_retrieve_failed"]
    );
  }

  return { draft: refreshedDraft, basedOnVersionId: published.id };
}

/**
 * Persists a PolicySnapshotDto into the rule tables for a given version.
 * This is the inverse of loadPolicySnapshot.
 */
async function copySnapshotIntoVersion(
  client: PoolClient,
  policyVersionId: number,
  snapshot: ReturnType<typeof loadPolicySnapshot> extends Promise<infer T> ? T : never
): Promise<void> {
  // Ensure the version starts clean (no rules should exist for a fresh version,
  // but we do this defensively)
  await deleteAllRulesForVersion(client, policyVersionId);

  for (const rule of snapshot.categoryDailyLimits) {
    await insertCategoryDailyLimit(client, policyVersionId, {
      modalityId: rule.modalityId,
      caseCategory: rule.caseCategory,
      dailyLimit: rule.dailyLimit,
      isActive: rule.isActive,
    });
  }

  for (const rule of snapshot.modalityBlockedRules) {
    await insertModalityBlockedRule(client, policyVersionId, {
      modalityId: rule.modalityId,
      ruleType: rule.ruleType,
      specificDate: rule.specificDate,
      startDate: rule.startDate,
      endDate: rule.endDate,
      recurStartMonth: rule.recurStartMonth,
      recurStartDay: rule.recurStartDay,
      recurEndMonth: rule.recurEndMonth,
      recurEndDay: rule.recurEndDay,
      isOverridable: rule.isOverridable,
      isActive: rule.isActive,
      title: rule.title,
      notes: rule.notes,
    });
  }

  for (const rule of snapshot.examTypeRules) {
    await insertExamTypeRule(client, policyVersionId, {
      modalityId: rule.modalityId,
      ruleType: rule.ruleType,
      effectMode: rule.effectMode,
      specificDate: rule.specificDate,
      startDate: rule.startDate,
      endDate: rule.endDate,
      weekday: rule.weekday,
      alternateWeeks: rule.alternateWeeks,
      recurrenceAnchorDate: rule.recurrenceAnchorDate,
      title: rule.title,
      notes: rule.notes,
      isActive: rule.isActive,
      examTypeIds: rule.examTypeIds,
    });
  }

  for (const rule of snapshot.examTypeSpecialQuotas) {
    await insertExamTypeSpecialQuota(client, policyVersionId, {
      examTypeId: rule.examTypeId,
      dailyExtraSlots: rule.dailyExtraSlots,
      isActive: rule.isActive,
    });
  }

  // Note: specialReasonCodes are global; we don't copy them here.
  // They are already loaded globally by loadPolicySnapshot.
}
