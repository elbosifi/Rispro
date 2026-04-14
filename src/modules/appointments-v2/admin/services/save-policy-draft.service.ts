/**
 * Appointments V2 — Save policy draft service.
 *
 * Authoritatively replaces the draft config snapshot (D006).
 * All versioned rule rows for the version are deleted and re-inserted from the
 * provided snapshot, then the authoritative snapshot is reloaded from DB
 * and the config hash is recomputed from that persisted data.
 *
 * NOTE: specialReasonCodes are global config and are NOT written per-version.
 * They are loaded globally by loadPolicySnapshot() and included in the returned
 * snapshot for display, but draft save does NOT mutate the global table.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { hashConfigSnapshot } from "../../shared/utils/hashing.js";
import { loadPolicySnapshot } from "./policy-snapshot.service.js";
import {
  findVersionById,
  updateDraftConfig,
  deleteAllRulesForVersion,
  insertCategoryDailyLimit,
  insertModalityBlockedRule,
  insertExamTypeRule,
  insertExamTypeSpecialQuota,
  type PolicyVersionRow,
} from "../repositories/admin-policy.repo.js";
import type { PolicySnapshotDto } from "../../api/dto/admin-scheduling.dto.js";

export interface SavePolicyDraftResult {
  version: PolicyVersionRow;
  configHash: string;
}

export async function savePolicyDraft(
  versionId: number,
  policySnapshot: PolicySnapshotDto,
  userId: number,
  changeNote: string | null = null
): Promise<SavePolicyDraftResult> {
  return withTransaction(async (client) => {
    return savePolicyDraftInternal(client, versionId, policySnapshot, userId, changeNote);
  });
}

async function savePolicyDraftInternal(
  client: PoolClient,
  versionId: number,
  policySnapshot: PolicySnapshotDto,
  userId: number,
  changeNote: string | null
): Promise<SavePolicyDraftResult> {
  // 1. Find the version
  const version = await findVersionById(client, versionId);
  if (!version) {
    throw new SchedulingError(
      404,
      `Policy version ${versionId} not found.`,
      ["policy_version_not_found"]
    );
  }

  // 2. Must be a draft
  if (version.status !== "draft") {
    throw new SchedulingError(
      409,
      `Policy version ${versionId} is '${version.status}' and cannot be modified. Only drafts can be saved.`,
      ["policy_version_not_draft"]
    );
  }

  // 3. Delete all existing versioned rules for this version (authoritative replace)
  await deleteAllRulesForVersion(client, versionId);

  // 4. Insert all versioned rule rows from the snapshot
  for (const rule of policySnapshot.categoryDailyLimits) {
    await insertCategoryDailyLimit(client, versionId, {
      modalityId: rule.modalityId,
      caseCategory: rule.caseCategory,
      dailyLimit: rule.dailyLimit,
      isActive: rule.isActive,
    });
  }

  for (const rule of policySnapshot.modalityBlockedRules) {
    await insertModalityBlockedRule(client, versionId, {
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

  for (const rule of policySnapshot.examTypeRules) {
    await insertExamTypeRule(client, versionId, {
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

  for (const rule of policySnapshot.examTypeSpecialQuotas) {
    await insertExamTypeSpecialQuota(client, versionId, {
      examTypeId: rule.examTypeId,
      dailyExtraSlots: rule.dailyExtraSlots,
      isActive: rule.isActive,
    });
  }

  // NOTE: specialReasonCodes are global/live config. We do NOT mutate the
  // global special_reason_codes table during draft save. This preserves draft
  // isolation — two concurrent drafts cannot overwrite each other's special
  // reason codes. The codes are loaded globally by loadPolicySnapshot() and
  // appear in the snapshot for display, but are managed separately.

  // 5. Reload the authoritative persisted snapshot from DB.
  // This gives us the canonical representation (DB-assigned IDs, canonical
  // ordering, etc.) instead of trusting the raw client payload.
  const persistedSnapshot = await loadPolicySnapshot(client, versionId);

  // 6. Compute the config hash from the reloaded DB snapshot (authoritative)
  const configHash = hashConfigSnapshot(persistedSnapshot);

  // 7. Update the draft version row
  const updated = await updateDraftConfig(client, versionId, configHash, changeNote);
  if (!updated) {
    throw new SchedulingError(
      500,
      "Failed to update draft configuration.",
      ["draft_update_failed"]
    );
  }

  // 8. Return the updated version
  const refreshed = await findVersionById(client, versionId);
  if (!refreshed) {
    throw new SchedulingError(
      500,
      "Failed to retrieve updated draft.",
      ["draft_retrieve_failed"]
    );
  }

  return {
    version: refreshed,
    configHash,
  };
}
