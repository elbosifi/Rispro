import { pool } from "../../../../db/pool.js";
import type {
  DayManagementContextDto,
  DayManagementExamTypeDto,
  PolicySnapshotDto,
  PolicyVersionDto,
} from "../../api/dto/admin-scheduling.dto.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import {
  findDraftVersion,
  findPolicySetByKey,
  findPublishedVersion,
} from "../repositories/admin-policy.repo.js";
import { loadPolicySnapshot } from "./policy-snapshot.service.js";
import { loadPolicyDisplayLookups } from "./policy-display-lookups.service.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { listExamTypesForModality } from "../../catalog/repositories/exam-type-catalog.repo.js";
import { getBookedCountsByCategoryForDate } from "../../scheduler/repositories/capacity.repo.js";
import { loadClosedWeekdays, weekdayNameFromIsoDate } from "../../scheduler/services/closed-weekday-settings.js";
import {
  blockedRuleMatchesDate,
  examMixQuotaRuleMatchesDate,
  examRuleMatchesDate,
} from "../../rules/utils/date-rule-matching.js";

const EMPTY_SNAPSHOT: PolicySnapshotDto = {
  categoryDailyLimits: [],
  modalityBlockedRules: [],
  examTypeRules: [],
  specialQuotaRules: [],
  examMixQuotaRules: [],
  specialReasonCodes: [],
};

const SUPPORTED_DAY_RULE_TYPES: DayManagementContextDto["supportedDayRuleTypes"] = [
  "block_modality",
  "restrict_exam_types",
  "set_exam_mix_quota",
];

function toPolicyVersionDto(version: PolicyVersionDto | null): PolicyVersionDto | null {
  if (!version) return null;
  return {
    ...version,
    id: Number(version.id),
    policySetId: Number(version.policySetId),
    versionNo: Number(version.versionNo),
  };
}

function examTypeDto(examType: { id: number; name: string | null; nameAr: string | null; nameEn: string | null }): DayManagementExamTypeDto {
  return { id: Number(examType.id), name: examType.name, nameAr: examType.nameAr, nameEn: examType.nameEn };
}

export async function getDayManagementContext(params: {
  modalityId: number;
  date: string;
  policySetKey?: string;
}): Promise<DayManagementContextDto> {
  const policySetKey = params.policySetKey ?? "default";
  const client = await pool.connect();
  try {
    const policySet = await findPolicySetByKey(client, policySetKey);
    if (!policySet) {
      throw new SchedulingError(404, "Scheduling policy set was not found.", ["policy_set_not_found"]);
    }

    const modality = await findModalityById(client, params.modalityId);
    if (!modality) {
      throw new SchedulingError(404, "Scheduling modality was not found.", ["modality_not_found"]);
    }

    const [published, draft, bookedCounts, closedWeekdays, examTypeOptions] = await Promise.all([
      findPublishedVersion(client, policySetKey),
      findDraftVersion(client, policySetKey),
      getBookedCountsByCategoryForDate(client, params.modalityId, params.date),
      loadClosedWeekdays(client),
      listExamTypesForModality(client, params.modalityId),
    ]);
    const publishedSnapshot = published ? await loadPolicySnapshot(client, published.id) : EMPTY_SNAPSHOT;

    const modalityBlocks = publishedSnapshot.modalityBlockedRules.filter(
      (rule) => rule.isActive && Number(rule.modalityId) === params.modalityId && blockedRuleMatchesDate(rule, params.date)
    );
    const examTypeRestrictions = publishedSnapshot.examTypeRules.filter(
      (rule) => rule.isActive && Number(rule.modalityId) === params.modalityId && examRuleMatchesDate(rule, params.date)
    );
    const examMixQuotas = (publishedSnapshot.examMixQuotaRules ?? []).filter(
      (rule) => rule.isActive && Number(rule.modalityId) === params.modalityId && examMixQuotaRuleMatchesDate(rule, params.date)
    );
    const categoryDailyLimits = publishedSnapshot.categoryDailyLimits.filter(
      (rule) => rule.isActive && Number(rule.modalityId) === params.modalityId
    );
    const specialQuotas = publishedSnapshot.specialQuotaRules.filter(
      (rule) => rule.isActive && Number(rule.modalityId) === params.modalityId
    );
    const examTypeIds = new Set<number>();
    for (const rule of [...examTypeRestrictions, ...examMixQuotas, ...specialQuotas]) {
      for (const examTypeId of rule.examTypeIds) examTypeIds.add(Number(examTypeId));
    }
    const displayLookups = await loadPolicyDisplayLookups(client, {
      modalityIds: [],
      examTypeIds: [...examTypeIds].sort((a, b) => a - b),
      userIds: [],
    });
    const examTypesById = new Map(displayLookups.examTypes.map((examType) => [Number(examType.id), examTypeDto(examType)]));
    const resolveExamTypes = (ids: number[]) => ids.map((id) => {
      const numericId = Number(id);
      return examTypesById.get(numericId) ?? { id: numericId, name: null, nameAr: null, nameEn: null };
    });
    const weekday = weekdayNameFromIsoDate(params.date);

    return {
      date: params.date,
      modality: {
        id: Number(modality.id),
        code: modality.code,
        name: modality.name,
        nameAr: modality.nameAr,
        nameEn: modality.nameEn,
        dailyCapacity: modality.dailyCapacity == null ? null : Number(modality.dailyCapacity),
        isActive: modality.isActive,
      },
      bookingSummary: {
        bookedTotal: bookedCounts.total,
        oncologyBooked: bookedCounts.oncology,
        nonOncologyBooked: bookedCounts.nonOncology,
      },
      policy: { policySetKey, published: toPolicyVersionDto(published), draft: toPolicyVersionDto(draft) },
      effectiveRules: {
        modalityBlocks: modalityBlocks.map(({ modalityId: _modalityId, isActive: _isActive, ...rule }) => ({ ...rule, id: Number(rule.id) })),
        examTypeRestrictions: examTypeRestrictions.map(({ modalityId: _modalityId, examTypeIds, isActive: _isActive, ...rule }) => ({ ...rule, id: Number(rule.id), examTypes: resolveExamTypes(examTypeIds) })),
        examMixQuotas: examMixQuotas.map(({ modalityId: _modalityId, examTypeIds, isActive: _isActive, ...rule }) => ({ ...rule, id: Number(rule.id), dailyLimit: Number(rule.dailyLimit), examTypes: resolveExamTypes(examTypeIds) })),
      },
      globalConstraints: {
        categoryDailyLimits: categoryDailyLimits.map(({ id, caseCategory, dailyLimit }) => ({ id: Number(id), caseCategory, dailyLimit: Number(dailyLimit) })),
        specialQuotas: specialQuotas.map(({ modalityId: _modalityId, examTypeIds, allowedUserIds: _allowedUserIds, isActive: _isActive, ...rule }) => ({ ...rule, id: Number(rule.id), dailyExtraSlots: Number(rule.dailyExtraSlots), examTypes: resolveExamTypes(examTypeIds) })),
        closedWeekday: weekday === "other" || !closedWeekdays.includes(weekday) ? null : weekday,
      },
      examTypeOptions: examTypeOptions.map(examTypeDto),
      supportedDayRuleTypes: SUPPORTED_DAY_RULE_TYPES,
    };
  } finally {
    client.release();
  }
}
