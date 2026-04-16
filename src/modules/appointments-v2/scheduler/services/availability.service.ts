/**
 * Appointments V2 — Availability service.
 *
 * Combines capacity data with the decision engine output to return
 * explicit availability for a date range. Each day includes a full
 * BookingDecision (D005 compliance).
 *
 * Stage 5: Real implementation with DB loading + pureEvaluate.
 */

import type { PoolClient } from "pg";
import type { BookingDecision } from "../../rules/models/booking-decision.js";
import { pureEvaluate } from "../../rules/services/pure-evaluate.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../../rules/models/rule-evaluation-context.js";
import { findPublishedPolicyVersion } from "../../rules/repositories/policy-version.repo.js";
import {
  loadModalityBlockedRules,
  loadExamTypeRules,
  loadCategoryDailyLimits,
  loadExamTypeSpecialQuotas,
  loadExamTypeRuleItemExamTypeIds,
} from "../../rules/repositories/policy-rules.repo.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { findExamTypeById } from "../../catalog/repositories/exam-type-catalog.repo.js";
import {
  getBookedCountsByCategoryForDate,
  getSpecialQuotaBookedCount,
} from "../../scheduler/repositories/capacity.repo.js";
import { addDays, todayIso } from "../../shared/utils/dates.js";
import { pool } from "../../../../db/pool.js";
import type { CapacityResolutionMode } from "../../shared/types/common.js";

export interface AvailabilityDayDto {
  date: string;
  bucketMode: "partitioned" | "total_only";
  modalityTotalCapacity: number;
  bookedTotal: number;
  oncology: {
    reserved: number | null;
    filled: number;
    remaining: number | null;
  };
  nonOncology: {
    reserved: number | null;
    filled: number;
    remaining: number | null;
  };
  specialQuotaSummary: {
    examTypeId: number;
    configured: number;
    consumed: number;
    remaining: number;
  } | null;
  // Backward-compatible fields
  dailyCapacity: number;
  bookedCount: number;
  remainingCapacity: number;
  isFull: boolean;
  rowDisplayStatus: "available" | "restricted" | "blocked" | "full";
  decision: BookingDecision;
}

export interface GetAvailabilityParams {
  modalityId: number;
  days: number;
  offset: number;
  examTypeId?: number | null;
  caseCategory: "oncology" | "non_oncology";
  capacityResolutionMode?: CapacityResolutionMode;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  includeOverrideCandidates?: boolean;
}

export interface AvailabilityQueryResult {
  items: AvailabilityDayDto[];
  noPublishedPolicy: boolean;
}

export async function getAvailability(
  params: GetAvailabilityParams,
  policySetKey: string = "default"
): Promise<AvailabilityDayDto[]> {
  const result = await getAvailabilityWithMeta(params, policySetKey);
  return result.items;
}

export async function getAvailabilityWithMeta(
  params: GetAvailabilityParams,
  policySetKey: string = "default"
): Promise<AvailabilityQueryResult> {
  const client = await pool.connect();
  try {
    return getAvailabilityInternal(client, params, policySetKey);
  } finally {
    client.release();
  }
}

async function getAvailabilityInternal(
  client: PoolClient,
  params: GetAvailabilityParams,
  policySetKey: string
): Promise<AvailabilityQueryResult> {
  const capacityResolutionMode: CapacityResolutionMode =
    params.capacityResolutionMode ??
    (params.useSpecialQuota ? "special_quota_extra" : "standard");
  // 1. Load the published policy
  const publishedVersion = await findPublishedPolicyVersion(client, policySetKey);
  if (!publishedVersion) {
    return { items: [], noPublishedPolicy: true };
  }

  // 2. Load modality for daily capacity
  const modality = await findModalityById(client, params.modalityId);
  if (!modality) {
    return { items: [], noPublishedPolicy: false };
  }

  // 3. Load integrity checks
  let examTypeExists = true;
  let examTypeBelongsToModality = true;
  if (params.examTypeId != null) {
    const examType = await findExamTypeById(client, params.examTypeId);
    examTypeExists = examType !== null;
    if (examType && examType.modalityId != null) {
      examTypeBelongsToModality = Number(examType.modalityId) === params.modalityId;
    } else {
      examTypeBelongsToModality = false;
    }
  }

  // 4. Load rules once (they're the same for all dates in the range)
  const blockedRules = await loadModalityBlockedRules(
    client,
    publishedVersion.id,
    params.modalityId
  );
  const examTypeRules = await loadExamTypeRules(
    client,
    publishedVersion.id,
    params.modalityId
  );
  const categoryLimits = await loadCategoryDailyLimits(
    client,
    publishedVersion.id,
    params.modalityId
  );
  const specialQuotas = await loadExamTypeSpecialQuotas(
    client,
    publishedVersion.id
  );

  const examTypeRuleItemExamTypeIds = await loadExamTypeRuleItemExamTypeIds(
    client,
    publishedVersion.id,
    params.modalityId
  );

  const activeOncology = categoryLimits.find(
    (l) => l.isActive && l.caseCategory === "oncology"
  );
  const activeNonOncology = categoryLimits.find(
    (l) => l.isActive && l.caseCategory === "non_oncology"
  );
  const modalityTotalCapacity = modality.dailyCapacity ?? 0;
  const bucketMode: "partitioned" | "total_only" =
    activeOncology || activeNonOncology ? "partitioned" : "total_only";

  // 5. Generate dates
  const startDate = todayIso();
  const results: AvailabilityDayDto[] = [];

  for (let i = params.offset; i < params.offset + params.days; i++) {
    const date = addDays(startDate, i);

    const bookedCounts = await getBookedCountsByCategoryForDate(
      client,
      params.modalityId,
      date
    );
    const bookedCountForCategory =
      params.caseCategory === "oncology" ? bookedCounts.oncology : bookedCounts.nonOncology;

    // 7. Load special quota booked count (only when examTypeId is provided)
    let currentSpecialQuotaBookedCount = 0;
    let specialQuotaSummary: AvailabilityDayDto["specialQuotaSummary"] = null;
    if (params.examTypeId != null) {
      currentSpecialQuotaBookedCount = await getSpecialQuotaBookedCount(client, {
        modalityId: params.modalityId,
        bookingDate: date,
        examTypeId: params.examTypeId,
      });
      const quota = specialQuotas.find(
        (q) => q.isActive && Number(q.examTypeId) === Number(params.examTypeId)
      );
      if (quota) {
        specialQuotaSummary = {
          examTypeId: Number(quota.examTypeId),
          configured: quota.dailyExtraSlots,
          consumed: currentSpecialQuotaBookedCount,
          remaining: Math.max(0, quota.dailyExtraSlots - currentSpecialQuotaBookedCount),
        };
      }
    }

    let oncologyReserved: number | null = null;
    let nonOncologyReserved: number | null = null;
    if (bucketMode === "partitioned") {
      if (activeOncology && activeNonOncology) {
        oncologyReserved = activeOncology.dailyLimit;
        nonOncologyReserved = activeNonOncology.dailyLimit;
      } else if (activeOncology) {
        oncologyReserved = activeOncology.dailyLimit;
        nonOncologyReserved = Math.max(0, modalityTotalCapacity - activeOncology.dailyLimit);
      } else if (activeNonOncology) {
        nonOncologyReserved = activeNonOncology.dailyLimit;
        oncologyReserved = Math.max(0, modalityTotalCapacity - activeNonOncology.dailyLimit);
      }
    }

    const remainingCapacity = Math.max(0, modalityTotalCapacity - bookedCounts.total);
    const isFull = remainingCapacity <= 0;

    // 8. Evaluate the decision for this date
    const context: RuleEvaluationContext = {
      policyVersionId: publishedVersion.id,
      policySetKey,
      policyVersionNo: publishedVersion.versionNo,
      policyConfigHash: publishedVersion.configHash,
      modalityExists: true,
      examTypeExists,
      examTypeBelongsToModality,
      blockedRules,
      examTypeRules,
      examTypeRuleItemExamTypeIds,
      categoryLimits,
      modalityDailyCapacity: modalityTotalCapacity,
      currentBookedCountTotal: bookedCounts.total,
      currentBookedCountOncology: bookedCounts.oncology,
      currentBookedCountNonOncology: bookedCounts.nonOncology,
      specialQuotas,
      currentBookedCount: bookedCountForCategory,
      currentSpecialQuotaBookedCount,
    };

    const pureInput: PureEvaluateInput = {
      patientId: 0, // 0 = availability query (no specific patient yet)
      modalityId: params.modalityId,
      examTypeId: params.examTypeId ?? null,
      scheduledDate: date,
      caseCategory: params.caseCategory,
      capacityResolutionMode,
      useSpecialQuota: capacityResolutionMode === "special_quota_extra",
      specialReasonCode: params.specialReasonCode ?? null,
      includeOverrideEvaluation: params.includeOverrideCandidates ?? false,
      context,
    };

    const decision = await pureEvaluate(pureInput);

    results.push({
      date,
      bucketMode,
      modalityTotalCapacity,
      bookedTotal: bookedCounts.total,
      oncology: {
        reserved: oncologyReserved,
        filled: bookedCounts.oncology,
        remaining:
          oncologyReserved == null ? null : Math.max(0, oncologyReserved - bookedCounts.oncology),
      },
      nonOncology: {
        reserved: nonOncologyReserved,
        filled: bookedCounts.nonOncology,
        remaining:
          nonOncologyReserved == null
            ? null
            : Math.max(0, nonOncologyReserved - bookedCounts.nonOncology),
      },
      specialQuotaSummary,
      dailyCapacity: modalityTotalCapacity,
      bookedCount: bookedCounts.total,
      remainingCapacity,
      isFull,
      rowDisplayStatus:
        decision.displayStatus === "blocked" &&
        decision.reasons.some((r) => r.code === "standard_capacity_exhausted")
          ? "full"
          : decision.displayStatus,
      decision,
    });
  }

  return { items: results, noPublishedPolicy: false };
}
