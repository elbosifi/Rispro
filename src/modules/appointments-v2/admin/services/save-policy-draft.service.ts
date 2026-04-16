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
  insertExamMixQuotaRule,
  type PolicyVersionRow,
} from "../repositories/admin-policy.repo.js";
import type { PolicySnapshotDto } from "../../api/dto/admin-scheduling.dto.js";
import type { FieldValidationErrorDto } from "../../api/dto/admin-scheduling.dto.js";

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

  await validateCategoryCapacityPolicy(client, policySnapshot);
  validateExamMixPolicy(policySnapshot);

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

  for (const rule of policySnapshot.examMixQuotaRules ?? []) {
    await insertExamMixQuotaRule(client, versionId, {
      modalityId: rule.modalityId,
      title: rule.title,
      ruleType: rule.ruleType,
      specificDate: rule.specificDate,
      startDate: rule.startDate,
      endDate: rule.endDate,
      weekday: rule.weekday,
      alternateWeeks: rule.alternateWeeks,
      recurrenceAnchorDate: rule.recurrenceAnchorDate,
      dailyLimit: rule.dailyLimit,
      isActive: rule.isActive,
      examTypeIds: rule.examTypeIds,
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

function validateExamMixPolicy(policySnapshot: PolicySnapshotDto): void {
  const fieldErrors: FieldValidationErrorDto[] = [];
  for (const [index, row] of (policySnapshot.examMixQuotaRules ?? []).entries()) {
    if (!Number.isInteger(row.dailyLimit) || Number(row.dailyLimit) <= 0) {
      fieldErrors.push({
        field: `policySnapshot.examMixQuotaRules[${index}].dailyLimit`,
        code: "exam_mix_daily_limit_invalid",
        message: "Exam mix dailyLimit must be a positive integer.",
      });
    }
    if (!Array.isArray(row.examTypeIds) || row.examTypeIds.length === 0) {
      fieldErrors.push({
        field: `policySnapshot.examMixQuotaRules[${index}].examTypeIds`,
        code: "exam_mix_exam_types_required",
        message: "Exam mix rule must include at least one linked exam type.",
      });
    }
    if (row.ruleType === "specific_date" && !row.specificDate) {
      fieldErrors.push({
        field: `policySnapshot.examMixQuotaRules[${index}].specificDate`,
        code: "exam_mix_specific_date_required",
        message: "specific_date exam mix rule requires specificDate.",
      });
    }
    if (row.ruleType === "date_range" && (!row.startDate || !row.endDate)) {
      fieldErrors.push({
        field: `policySnapshot.examMixQuotaRules[${index}]`,
        code: "exam_mix_date_range_required",
        message: "date_range exam mix rule requires startDate and endDate.",
      });
    }
    if (row.ruleType === "weekly_recurrence" && row.weekday == null) {
      fieldErrors.push({
        field: `policySnapshot.examMixQuotaRules[${index}].weekday`,
        code: "exam_mix_weekday_required",
        message: "weekly_recurrence exam mix rule requires weekday.",
      });
    }
  }
  if (fieldErrors.length > 0) {
    throw new SchedulingError(
      400,
      "Validation failed",
      ["validation_failed"],
      { fieldErrors }
    );
  }
}

async function validateCategoryCapacityPolicy(
  client: PoolClient,
  policySnapshot: PolicySnapshotDto
): Promise<void> {
  const activeLimits = policySnapshot.categoryDailyLimits.filter((row) => row.isActive);
  if (activeLimits.length === 0) return;

  const modalityIds = [...new Set(activeLimits.map((row) => Number(row.modalityId)).filter((v) => Number.isFinite(v) && v > 0))];
  if (modalityIds.length === 0) return;

  const modalities = await client.query<{ id: number; dailyCapacity: number | null }>(
    `
      select id, daily_capacity as "dailyCapacity"
      from modalities
      where id = any($1::bigint[])
    `,
    [modalityIds]
  );
  const capacityByModality = new Map<number, number | null>();
  for (const row of modalities.rows) {
    capacityByModality.set(Number(row.id), row.dailyCapacity == null ? null : Number(row.dailyCapacity));
  }

  const byModality = new Map<number, Array<PolicySnapshotDto["categoryDailyLimits"][number]>>();
  for (const row of activeLimits) {
    const modalityId = Number(row.modalityId);
    const existing = byModality.get(modalityId) ?? [];
    existing.push(row);
    byModality.set(modalityId, existing);
  }

  const fieldErrors: FieldValidationErrorDto[] = [];
  for (const [modalityId, rows] of byModality) {
    const modalityCapacity = capacityByModality.get(modalityId) ?? null;
    if (modalityCapacity == null || !Number.isFinite(modalityCapacity)) {
      fieldErrors.push({
        field: `policySnapshot.categoryDailyLimits[modalityId=${modalityId}]`,
        code: "modality_capacity_missing",
        message: `Modality ${modalityId} has no valid daily capacity configured.`,
      });
      continue;
    }

    const oncology = rows.find((r) => r.caseCategory === "oncology");
    const nonOncology = rows.find((r) => r.caseCategory === "non_oncology");

    if (oncology && nonOncology) {
      const sum = Number(oncology.dailyLimit) + Number(nonOncology.dailyLimit);
      if (sum !== modalityCapacity) {
        fieldErrors.push({
          field: `policySnapshot.categoryDailyLimits[modalityId=${modalityId}]`,
          code: "category_limits_must_equal_modality_capacity",
          message: `Oncology + non-oncology limits must equal modality daily capacity (${modalityCapacity}).`,
        });
      }
      continue;
    }

    const configured = oncology ?? nonOncology;
    if (!configured) continue;
    if (Number(configured.dailyLimit) > modalityCapacity) {
      fieldErrors.push({
        field: `policySnapshot.categoryDailyLimits[modalityId=${modalityId}][caseCategory=${configured.caseCategory}]`,
        code: "category_limit_exceeds_modality_capacity",
        message: `Configured ${configured.caseCategory} limit exceeds modality daily capacity (${modalityCapacity}).`,
      });
    }
  }

  if (fieldErrors.length > 0) {
    throw new SchedulingError(
      400,
      "Validation failed",
      ["validation_failed"],
      { fieldErrors }
    );
  }
}
