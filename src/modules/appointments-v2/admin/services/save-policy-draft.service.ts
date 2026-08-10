/**
 * Appointments V2 — Save policy draft service.
 *
 * Authoritatively replaces the draft config snapshot (D006).
 * All versioned rule rows for the version are deleted and re-inserted from the
 * provided snapshot, then the authoritative snapshot is reloaded from DB
 * and the config hash is recomputed from that persisted data.
 *
 * NOTE: specialReasonCodes are global config. They are edited from the policy
 * draft UI, but saved to the global special_reason_codes table, not per-version.
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
  insertSpecialQuotaRule,
  insertExamMixQuotaRule,
  upsertSpecialReasonCodes,
  type PolicyVersionRow,
} from "../repositories/admin-policy.repo.js";
import type { PolicySnapshotDto } from "../../api/dto/admin-scheduling.dto.js";
import type { FieldValidationErrorDto } from "../../api/dto/admin-scheduling.dto.js";
import { findSpecialQuotaMembershipConflicts } from "../../rules/services/resolve-special-quota.js";

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
  await validateSpecialQuotaPolicy(client, versionId, policySnapshot);
  validateSpecialReasonCodes(policySnapshot);
  validateExamRestrictionPolicy(policySnapshot);
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

  for (const rule of policySnapshot.specialQuotaRules) {
    await insertSpecialQuotaRule(client, versionId, {
      logicalKey: rule.logicalKey,
      modalityId: rule.modalityId,
      title: rule.title,
      examTypeIds: rule.examTypeIds,
      dailyExtraSlots: rule.dailyExtraSlots,
      allowedUserIds: rule.allowedUserIds,
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

  if (Array.isArray(policySnapshot.specialReasonCodes)) {
    await upsertSpecialReasonCodes(
      client,
      policySnapshot.specialReasonCodes.map((code) => ({
        code: code.code.trim(),
        labelAr: code.labelAr.trim(),
        labelEn: code.labelEn.trim(),
        isActive: code.isActive,
      })),
      userId
    );
  }

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

function validateSpecialReasonCodes(policySnapshot: PolicySnapshotDto): void {
  const fieldErrors: FieldValidationErrorDto[] = [];
  const seenCodes = new Set<string>();

  if (!Array.isArray(policySnapshot.specialReasonCodes)) return;

  policySnapshot.specialReasonCodes.forEach((row, index) => {
    const code = String(row.code ?? "").trim();
    const labelAr = String(row.labelAr ?? "").trim();
    const labelEn = String(row.labelEn ?? "").trim();

    if (!code) {
      fieldErrors.push({ field: `specialReasonCodes[${index}].code`, code: "special_reason_code_required", message: "Special reason code is required." });
    } else if (!/^[a-zA-Z0-9_-]+$/.test(code)) {
      fieldErrors.push({ field: `specialReasonCodes[${index}].code`, code: "special_reason_code_invalid", message: "Use letters, numbers, underscores, or hyphens only." });
    } else if (seenCodes.has(code)) {
      fieldErrors.push({ field: `specialReasonCodes[${index}].code`, code: "special_reason_code_duplicate", message: "Special reason code must be unique." });
    }

    if (!labelAr) {
      fieldErrors.push({ field: `specialReasonCodes[${index}].labelAr`, code: "special_reason_label_ar_required", message: "Arabic label is required." });
    }
    if (!labelEn) {
      fieldErrors.push({ field: `specialReasonCodes[${index}].labelEn`, code: "special_reason_label_en_required", message: "English label is required." });
    }
    seenCodes.add(code);
  });

  if (fieldErrors.length > 0) {
    throw new SchedulingError(400, "Invalid special reason code configuration.", ["special_reason_codes_invalid"], fieldErrors);
  }
}

async function validateSpecialQuotaPolicy(
  client: PoolClient,
  policyVersionId: number,
  policySnapshot: PolicySnapshotDto
): Promise<void> {
  const fieldErrors: FieldValidationErrorDto[] = [];
  const quotas = policySnapshot.specialQuotaRules;
  const activeQuotas = quotas.filter((row) => row.isActive);
  const modalityIds = [...new Set(activeQuotas.map((row) => Number(row.modalityId)).filter((id) => Number.isInteger(id) && id > 0))];
  const examTypeIds = [...new Set(activeQuotas.flatMap((row) => row.examTypeIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const allowedUserIds = [
    ...new Set(
      quotas.flatMap((row) => row.allowedUserIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  const existingModalities = new Set<number>();
  if (modalityIds.length > 0) {
    const result = await client.query<{ id: number }>(`select id from modalities where id = any($1::bigint[])`, [modalityIds]);
    for (const row of result.rows) existingModalities.add(Number(row.id));
  }

  const examTypeModalityById = new Map<number, number | null>();
  if (examTypeIds.length > 0) {
    const result = await client.query<{ id: number; modalityId: number | null }>(
      `select id, modality_id as "modalityId" from exam_types where id = any($1::bigint[])`,
      [examTypeIds]
    );
    for (const row of result.rows) examTypeModalityById.set(Number(row.id), row.modalityId == null ? null : Number(row.modalityId));
  }

  const activeUserIds = new Set<number>();
  const existingUserIds = new Set<number>();
  const superAdminUserIds = new Set<number>();
  if (allowedUserIds.length > 0) {
    const result = await client.query<{ id: number; role: string; isActive: boolean }>(
      `select id, role, is_active as "isActive" from users where id = any($1::bigint[])`,
      [allowedUserIds]
    );
    for (const row of result.rows) {
      existingUserIds.add(Number(row.id));
      if (row.isActive) activeUserIds.add(Number(row.id));
      if (row.role === "super_admin") superAdminUserIds.add(Number(row.id));
    }
  }

  const existingInactiveMemberships = new Set<string>();
  const existingMembershipResult = await client.query<{ logicalKey: string; userId: number }>(
    `
      select quota.logical_key::text as "logicalKey", quota_user.user_id as "userId"
      from appointments_v2.special_quota_rules quota
      join appointments_v2.special_quota_rule_users quota_user on quota_user.quota_rule_id = quota.id
      join users app_user on app_user.id = quota_user.user_id
      where quota.policy_version_id = $1 and app_user.is_active = false
    `,
    [policyVersionId]
  );
  for (const row of existingMembershipResult.rows) {
    existingInactiveMemberships.add(`${row.logicalKey}:${Number(row.userId)}`);
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const seenLogicalKeys = new Set<string>();
  for (const [index, row] of quotas.entries()) {
    const fieldBase = `policySnapshot.specialQuotaRules[${index}]`;
    const logicalKey = String(row.logicalKey ?? "").trim().toLowerCase();
    const modalityId = Number(row.modalityId);
    const selectedExamTypeIds = (row.examTypeIds ?? []).map(Number);
    const selectedUserIds = (row.allowedUserIds ?? []).map(Number);

    if (!uuidPattern.test(logicalKey)) {
      fieldErrors.push({ field: `${fieldBase}.logicalKey`, code: "special_quota_logical_key_invalid", message: "Special Quota logicalKey must be a valid UUID." });
    } else if (seenLogicalKeys.has(logicalKey)) {
      fieldErrors.push({ field: `${fieldBase}.logicalKey`, code: "special_quota_logical_key_duplicate", message: "Special Quota logicalKey must be unique in the policy." });
    }
    seenLogicalKeys.add(logicalKey);

    if (new Set(selectedExamTypeIds).size !== selectedExamTypeIds.length) {
      fieldErrors.push({ field: `${fieldBase}.examTypeIds`, code: "special_quota_exam_type_duplicate", message: "Special Quota exam memberships must be unique." });
    }
    if (new Set(selectedUserIds).size !== selectedUserIds.length) {
      fieldErrors.push({ field: `${fieldBase}.allowedUserIds`, code: "special_quota_user_duplicate", message: "Special Quota user memberships must be unique." });
    }

    if (row.isActive) {
      if (!Number.isInteger(modalityId) || modalityId <= 0 || !existingModalities.has(modalityId)) {
        fieldErrors.push({ field: `${fieldBase}.modalityId`, code: "special_quota_modality_invalid", message: "Active Special Quota must select an existing modality." });
      }
      if (!Number.isInteger(row.dailyExtraSlots) || Number(row.dailyExtraSlots) <= 0) {
        fieldErrors.push({ field: `${fieldBase}.dailyExtraSlots`, code: "special_quota_daily_slots_invalid", message: "Active Special Quota dailyExtraSlots must be a positive integer." });
      }
      if (selectedExamTypeIds.length === 0) {
        fieldErrors.push({ field: `${fieldBase}.examTypeIds`, code: "special_quota_exam_types_required", message: "Active Special Quota must include at least one exam type." });
      }
      if (selectedUserIds.length === 0) {
        fieldErrors.push({ field: `${fieldBase}.allowedUserIds`, code: "special_quota_users_required", message: "Active Special Quota must authorize at least one user." });
      }
      for (const examTypeId of selectedExamTypeIds) {
        if (!Number.isInteger(examTypeId) || examTypeId <= 0 || !examTypeModalityById.has(examTypeId)) {
          fieldErrors.push({ field: `${fieldBase}.examTypeIds`, code: "special_quota_exam_type_invalid", message: `Exam type ${examTypeId} does not exist.` });
        } else if (examTypeModalityById.get(examTypeId) !== modalityId) {
          fieldErrors.push({ field: `${fieldBase}.examTypeIds`, code: "special_quota_exam_type_modality_mismatch", message: `Exam type ${examTypeId} does not belong to modality ${modalityId}.` });
        }
      }
    }

    for (const userId of selectedUserIds) {
      if (!existingUserIds.has(userId)) {
        fieldErrors.push({
          field: `${fieldBase}.allowedUserIds`,
          code: "special_quota_user_invalid",
          message: `Authorized user ${userId} does not exist.`,
        });
      } else if (!activeUserIds.has(userId) && !existingInactiveMemberships.has(`${logicalKey}:${userId}`)) {
        fieldErrors.push({ field: `${fieldBase}.allowedUserIds`, code: "special_quota_inactive_user_new", message: `Inactive user ${userId} cannot be newly authorized.` });
      }
      if (superAdminUserIds.has(userId)) {
        fieldErrors.push({
          field: `${fieldBase}.allowedUserIds`,
          code: "special_quota_super_admin_implicit",
          message: "Super admins are allowed implicitly and should not be stored in special quota allow-lists.",
        });
      }
    }
  }

  for (const conflict of findSpecialQuotaMembershipConflicts(quotas)) {
    const conflictingIndex = quotas.findIndex((row) => Number(row.id) === conflict.secondRuleId);
    fieldErrors.push({
      field: `policySnapshot.specialQuotaRules[${Math.max(0, conflictingIndex)}].examTypeIds`,
      code: "special_quota_ambiguous_overlap",
      message: `Special Quota rules ${conflict.firstRuleId} and ${conflict.secondRuleId} both authorize user ${conflict.userId} for exam type ${conflict.examTypeId}.`,
    });
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

function validateExamRestrictionPolicy(policySnapshot: PolicySnapshotDto): void {
  const fieldErrors: FieldValidationErrorDto[] = [];
  for (const [index, row] of policySnapshot.examTypeRules.entries()) {
    if (!row.isActive) continue;
    if (!Array.isArray(row.examTypeIds) || row.examTypeIds.length === 0) {
      fieldErrors.push({
        field: `policySnapshot.examTypeRules[${index}].examTypeIds`,
        code: "exam_rule_exam_types_required",
        message: "Active exam restriction rule must include at least one linked exam type.",
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

    const configuredRows = [oncology, nonOncology].filter((row) => row != null);
    for (const configured of configuredRows) {
      if (Number(configured.dailyLimit) > modalityCapacity) {
        fieldErrors.push({
          field: `policySnapshot.categoryDailyLimits[modalityId=${modalityId}][caseCategory=${configured.caseCategory}]`,
          code: "category_limit_exceeds_modality_capacity",
          message: `Configured ${configured.caseCategory} limit exceeds modality daily capacity (${modalityCapacity}).`,
        });
      }
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
