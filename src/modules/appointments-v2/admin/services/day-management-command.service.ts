import type { PoolClient } from "pg";
import { validateIsoDate, getTripoliToday } from "../../../../utils/date.js";
import { logAuditEntry } from "../../../../services/audit-service.js";
import type {
  CreateDayExamMixQuotaDto,
  CreateDayExamRestrictionDto,
  CreateDayModalityBlockDto,
  DayManagementMutationBaseDto,
  DayManagementMutationResultDto,
  DayManagementRemovableRuleFamily,
  DayManagementRuleType,
  PolicySnapshotDto,
  RemoveDayManagementRuleDto,
} from "../../api/dto/admin-scheduling.dto.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { listExamTypesForModality } from "../../catalog/repositories/exam-type-catalog.repo.js";
import { getBookedCountsByCategoryForDate } from "../../scheduler/repositories/capacity.repo.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { withTransaction } from "../../shared/utils/transactions.js";
import { hashConfigSnapshot } from "../../shared/utils/hashing.js";
import { validatePolicyDraftWithClient } from "../../rules/services/validate-policy.js";
import {
  archiveOldPublishedVersions,
  createDraftVersion,
  deleteAllRulesForVersion,
  findDraftVersion,
  findPolicySetByKey,
  findPublishedVersion,
  findVersionById,
  getNextVersionNumber,
  insertCategoryDailyLimit,
  insertExamMixQuotaRule,
  insertExamTypeRule,
  insertModalityBlockedRule,
  insertSpecialQuotaRule,
  publishVersion,
  updateDraftConfig,
} from "../repositories/admin-policy.repo.js";
import { loadPolicySnapshot } from "./policy-snapshot.service.js";

type NormalizedBase = Omit<DayManagementMutationBaseDto, "policySetKey" | "modalityId" | "expectedPublishedVersionId" | "reason"> & {
  policySetKey: string;
  modalityId: number;
  expectedPublishedVersionId: number;
  reason: string;
};

type MutationMetadata = {
  action: "created" | "removed";
  ruleType: DayManagementRuleType;
  actionType: string;
  oldValues?: Record<string, unknown>;
  ruleValues: Record<string, unknown>;
};

export async function createDayModalityBlock(input: CreateDayModalityBlockDto, userId: number): Promise<DayManagementMutationResultDto> {
  const base = normalizeBase(input);
  if (typeof input.isOverridable !== "boolean") throw invalid("isOverridable must be a boolean.", "day_management_invalid_input");
  return runMutation(base, userId, `block modality`, async ({ snapshot }) => {
    if (snapshot.modalityBlockedRules.some((rule) => rule.isActive && Number(rule.modalityId) === base.modalityId && rule.ruleType === "specific_date" && rule.specificDate === base.date)) {
      throw conflict("A specific-date modality block already exists.", "day_management_rule_already_exists");
    }
    snapshot.modalityBlockedRules.push({
      id: 0, modalityId: base.modalityId, ruleType: "specific_date", specificDate: base.date, startDate: null, endDate: null,
      recurStartMonth: null, recurStartDay: null, recurEndMonth: null, recurEndDay: null, isOverridable: input.isOverridable,
      isActive: true, title: `Day block - ${base.date}`, notes: base.reason,
    });
    return { action: "created", ruleType: "block_modality", actionType: "modality_day_block_created", ruleValues: { isOverridable: input.isOverridable } };
  });
}

export async function createDayExamRestriction(input: CreateDayExamRestrictionDto, userId: number): Promise<DayManagementMutationResultDto> {
  const base = normalizeBase(input);
  if (input.effectMode !== "hard_restriction" && input.effectMode !== "restriction_overridable") throw invalid("effectMode is invalid.", "day_management_invalid_input");
  return runMutation(base, userId, "restrict exam types", async ({ snapshot, activeExamTypeIds }) => {
    const examTypeIds = normalizeExamTypeIds(input.examTypeIds, activeExamTypeIds);
    const existingSameScope = snapshot.examTypeRules.find((rule) => rule.isActive && Number(rule.modalityId) === base.modalityId && rule.ruleType === "specific_date" && rule.specificDate === base.date && sameIds(rule.examTypeIds, examTypeIds));
    if (existingSameScope) {
      if (existingSameScope.effectMode === input.effectMode) throw conflict("An identical specific-date exam restriction already exists.", "day_management_rule_already_exists");
      throw conflict("A specific-date exam restriction already exists for the same exam types. Remove it before changing the restriction mode.", "day_management_rule_scope_conflict");
    }
    snapshot.examTypeRules.push({
      id: 0, modalityId: base.modalityId, ruleType: "specific_date", effectMode: input.effectMode, specificDate: base.date,
      startDate: null, endDate: null, weekday: null, alternateWeeks: false, recurrenceAnchorDate: null,
      title: `Day exam restriction - ${base.date}`, notes: base.reason, isActive: true, examTypeIds,
    });
    return { action: "created", ruleType: "restrict_exam_types", actionType: "modality_day_exam_restriction_created", ruleValues: { effectMode: input.effectMode, examTypeIds } };
  });
}

export async function createDayExamMixQuota(input: CreateDayExamMixQuotaDto, userId: number): Promise<DayManagementMutationResultDto> {
  const base = normalizeBase(input);
  return runMutation(base, userId, "set exam-mix quota", async ({ snapshot, activeExamTypeIds, modality }) => {
    const examTypeIds = normalizeExamTypeIds(input.examTypeIds, activeExamTypeIds);
    const dailyLimit = Number(input.dailyLimit);
    if (!Number.isInteger(dailyLimit) || dailyLimit <= 0 || (Number.isFinite(Number(modality.dailyCapacity)) && Number(modality.dailyCapacity) > 0 && dailyLimit > Number(modality.dailyCapacity))) {
      throw invalid("dailyLimit must be a valid positive limit for this modality.", "day_management_invalid_daily_limit");
    }
    snapshot.examMixQuotaRules ??= [];
    const existingSameScope = snapshot.examMixQuotaRules.find((rule) => rule.isActive && Number(rule.modalityId) === base.modalityId && rule.ruleType === "specific_date" && rule.specificDate === base.date && sameIds(rule.examTypeIds, examTypeIds));
    if (existingSameScope) {
      if (Number(existingSameScope.dailyLimit) === dailyLimit) throw conflict("An identical specific-date exam-mix quota already exists.", "day_management_rule_already_exists");
      throw conflict("A specific-date exam-mix quota already exists for the same exam types. Remove it before changing the daily limit.", "day_management_rule_scope_conflict");
    }
    snapshot.examMixQuotaRules.push({
      id: 0, modalityId: base.modalityId, title: `Day exam-mix quota - ${base.date}`, ruleType: "specific_date", specificDate: base.date,
      startDate: null, endDate: null, weekday: null, alternateWeeks: false, recurrenceAnchorDate: null, dailyLimit, isActive: true, examTypeIds,
    });
    return { action: "created", ruleType: "set_exam_mix_quota", actionType: "modality_day_exam_mix_quota_created", ruleValues: { dailyLimit, examTypeIds } };
  });
}

export async function removeDayManagementRule(family: DayManagementRemovableRuleFamily, ruleId: number, input: RemoveDayManagementRuleDto, userId: number): Promise<DayManagementMutationResultDto> {
  const base = normalizeBase(input);
  if (!Number.isInteger(ruleId) || ruleId <= 0) throw invalid("ruleId must be a positive integer.", "day_management_rule_not_found");
  return runMutation(base, userId, `remove ${family} rule`, async ({ snapshot }) => {
    const rules = family === "block_modality" ? snapshot.modalityBlockedRules : family === "restrict_exam_types" ? snapshot.examTypeRules : snapshot.examMixQuotaRules ?? [];
    const index = rules.findIndex((rule) => Number(rule.id) === ruleId);
    if (index < 0) throw new SchedulingError(404, "Day management rule was not found.", ["day_management_rule_not_found"]);
    const rule = rules[index]!;
    if (Number(rule.modalityId) !== base.modalityId || !rule.isActive || rule.ruleType !== "specific_date" || rule.specificDate !== base.date) {
      if (rule.ruleType !== "specific_date") throw conflict("Only specific-date rules can be removed from Manage Day.", "day_management_rule_not_day_specific");
      throw new SchedulingError(404, "Day management rule was not found.", ["day_management_rule_not_found"]);
    }
    rules.splice(index, 1);
    return {
      action: "removed", ruleType: family, actionType: "modality_day_rule_removed",
      oldValues: { ruleId, ruleType: family, title: rule.title, specificDate: rule.specificDate }, ruleValues: { ruleId },
    };
  });
}

async function runMutation(
  base: NormalizedBase,
  userId: number,
  changeAction: string,
  mutate: (context: { snapshot: PolicySnapshotDto; activeExamTypeIds: Set<number>; modality: Awaited<ReturnType<typeof findModalityById>> & {} }) => Promise<MutationMetadata>,
): Promise<DayManagementMutationResultDto> {
  return withTransaction(async (client) => {
    const policySet = await findPolicySetByKey(client, base.policySetKey);
    if (!policySet) throw new SchedulingError(404, "Scheduling policy set was not found.", ["policy_set_not_found"]);
    await client.query("select id from appointments_v2.policy_sets where id = $1 for update", [policySet.id]);
    if (await findDraftVersion(client, base.policySetKey)) throw conflict("An unpublished scheduling policy draft already exists.", "day_management_draft_conflict");
    const published = await findPublishedVersion(client, base.policySetKey);
    if (!published) throw conflict("No published scheduling policy exists.", "day_management_no_published_policy");
    if (Number(published.id) !== base.expectedPublishedVersionId) throw conflict("Scheduling policy changed. Refresh the day context.", "day_management_context_stale");

    const modality = await findModalityById(client, base.modalityId);
    if (!modality) throw new SchedulingError(404, "Scheduling modality was not found.", ["modality_not_found"]);
    if (!modality.isActive) throw conflict("Scheduling modality is inactive.", "modality_inactive");
    const activeExamTypeIds = new Set((await listExamTypesForModality(client, base.modalityId)).map((item) => Number(item.id)));
    const snapshot = structuredClone(await loadPolicySnapshot(client, published.id));
    const metadata = await mutate({ snapshot, activeExamTypeIds, modality });

    const note = trimNote(`Manage Day: ${changeAction} ${modality.code} on ${base.date} - ${base.reason}`);
    const draft = await createDraftVersion(client, policySet.id, await getNextVersionNumber(client, policySet.id), "pending", userId, note);
    await persistVersionedSnapshot(client, draft.id, snapshot);
    const persistedSnapshot = await loadPolicySnapshot(client, draft.id);
    await updateDraftConfig(client, draft.id, hashConfigSnapshot(persistedSnapshot), note);
    const validation = await validatePolicyDraftWithClient(client, draft.id);
    if (!validation.isValid) throw new SchedulingError(400, "Day management policy validation failed.", ["day_management_policy_validation_failed"], { errors: validation.errors, warnings: validation.warnings });
    await archiveOldPublishedVersions(client, policySet.id, draft.id);
    if (!await publishVersion(client, draft.id, userId)) throw conflict("Scheduling policy publication conflicted.", "day_management_publish_conflict");
    const finalVersion = await findVersionById(client, draft.id);
    if (!finalVersion || finalVersion.status !== "published") throw new SchedulingError(500, "Published policy could not be retrieved.", ["day_management_publish_failed"]);
    const counts = metadata.action === "created" ? await getBookedCountsByCategoryForDate(client, base.modalityId, base.date) : null;
    const auditEntry = await logAuditEntry({
      entityType: "scheduling_policy_day", entityId: finalVersion.id, actionType: metadata.actionType, oldValues: metadata.oldValues ?? null,
      newValues: { action: metadata.action, ruleType: metadata.ruleType, modalityId: base.modalityId, modalityCode: modality.code, date: base.date, reason: base.reason, previousPublishedVersionId: published.id, newPublishedVersionId: finalVersion.id, ...metadata.ruleValues, ...(counts ? { bookedTotal: counts.total, oncologyBooked: counts.oncology, nonOncologyBooked: counts.nonOncology } : {}) },
      changedByUserId: userId,
    }, client);
    if (!auditEntry) throw new SchedulingError(503, "Manage Day requires the audit trail to be enabled.", ["day_management_audit_required"]);
    return { action: metadata.action, ruleType: metadata.ruleType, modalityId: base.modalityId, date: base.date, previousPublishedVersionId: Number(published.id), published: finalVersion };
  }, { isolationLevel: "serializable", operationName: "day_management_command" });
}

function normalizeBase(input: DayManagementMutationBaseDto): NormalizedBase {
  const policySetKey = String(input.policySetKey ?? "default").trim();
  const modalityId = Number(input.modalityId);
  const expectedPublishedVersionId = Number(input.expectedPublishedVersionId);
  let date: string;
  try { date = validateIsoDate(input.date); } catch { throw invalid("date must be in YYYY-MM-DD format.", "day_management_invalid_input"); }
  const reason = String(input.reason ?? "").trim();
  if (!policySetKey || !Number.isInteger(modalityId) || modalityId <= 0 || !Number.isInteger(expectedPublishedVersionId) || expectedPublishedVersionId <= 0) throw invalid("Day management input is invalid.", "day_management_invalid_input");
  if (reason.length < 3 || reason.length > 500) throw invalid("Reason must be between 3 and 500 characters.", "day_management_reason_invalid");
  if (date < getTripoliToday()) throw invalid("Past dates cannot be managed.", "day_management_past_date");
  return { policySetKey, modalityId, expectedPublishedVersionId, date, reason };
}

function normalizeExamTypeIds(values: unknown, activeIds: Set<number>): number[] {
  if (!Array.isArray(values) || values.length === 0) throw invalid("At least one active exam type is required.", "day_management_exam_type_invalid");
  const ids = values.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0 || !activeIds.has(id)) || new Set(ids).size !== ids.length) throw invalid("Exam types must be unique active exam types for this modality.", "day_management_exam_type_invalid");
  return ids.sort((a, b) => a - b);
}

function sameIds(left: number[], right: number[]): boolean { return left.length === right.length && [...left].map(Number).sort((a, b) => a - b).every((id, index) => id === right[index]); }
function trimNote(value: string): string { return value.length <= 1000 ? value : value.slice(0, 1000); }
function invalid(message: string, reasonCode: string): SchedulingError { return new SchedulingError(400, message, [reasonCode]); }
function conflict(message: string, reasonCode: string): SchedulingError { return new SchedulingError(409, message, [reasonCode]); }

async function persistVersionedSnapshot(client: PoolClient, policyVersionId: number, snapshot: PolicySnapshotDto): Promise<void> {
  await deleteAllRulesForVersion(client, policyVersionId);
  for (const rule of snapshot.categoryDailyLimits) await insertCategoryDailyLimit(client, policyVersionId, rule);
  for (const rule of snapshot.modalityBlockedRules) await insertModalityBlockedRule(client, policyVersionId, rule);
  for (const rule of snapshot.examTypeRules) await insertExamTypeRule(client, policyVersionId, rule);
  for (const rule of snapshot.specialQuotaRules) await insertSpecialQuotaRule(client, policyVersionId, rule);
  for (const rule of snapshot.examMixQuotaRules ?? []) await insertExamMixQuotaRule(client, policyVersionId, rule);
}
