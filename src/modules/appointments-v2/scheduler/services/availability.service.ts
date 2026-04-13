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
import { getBookedCountForDate } from "../../scheduler/repositories/capacity.repo.js";
import { addDays, todayIso } from "../../shared/utils/dates.js";
import { pool } from "../../../../db/pool.js";

export interface AvailabilityDayDto {
  date: string;
  dailyCapacity: number;
  bookedCount: number;
  remainingCapacity: number;
  isFull: boolean;
  decision: BookingDecision;
}

export interface GetAvailabilityParams {
  modalityId: number;
  days: number;
  offset: number;
  examTypeId?: number | null;
  caseCategory: "oncology" | "non_oncology";
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

  // Find the applicable category limit
  const categoryLimit = categoryLimits.find(
    (l) => l.caseCategory === params.caseCategory && l.isActive
  );
  const dailyCapacity = categoryLimit ? categoryLimit.dailyLimit : modality.dailyCapacity;

  // 5. Generate dates
  const startDate = todayIso();
  const results: AvailabilityDayDto[] = [];

  for (let i = params.offset; i < params.offset + params.days; i++) {
    const date = addDays(startDate, i);

    // 6. Load booked count for this date
    const bookedCount = await getBookedCountForDate(
      client,
      params.modalityId,
      date,
      params.caseCategory
    );

    const remainingCapacity = Math.max(0, dailyCapacity - bookedCount);
    const isFull = remainingCapacity <= 0;

    // 7. Evaluate the decision for this date
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
      specialQuotas,
      currentBookedCount: bookedCount,
    };

    const pureInput: PureEvaluateInput = {
      patientId: 0, // 0 = availability query (no specific patient yet)
      modalityId: params.modalityId,
      examTypeId: params.examTypeId ?? null,
      scheduledDate: date,
      caseCategory: params.caseCategory,
      useSpecialQuota: params.useSpecialQuota ?? false,
      specialReasonCode: params.specialReasonCode ?? null,
      includeOverrideEvaluation: params.includeOverrideCandidates ?? false,
      context,
    };

    const decision = await pureEvaluate(pureInput);

    results.push({
      date,
      dailyCapacity,
      bookedCount,
      remainingCapacity,
      isFull,
      decision,
    });
  }

  return { items: results, noPublishedPolicy: false };
}
