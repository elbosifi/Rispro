/**
 * Appointments V2 — DB-backed booking decision evaluator.
 *
 * This is the orchestration layer between the API routes and the pure
 * `pureEvaluate()` decision engine. It loads all rule data from the
 * database for the given policy version and booking candidate, builds a
 * `RuleEvaluationContext`, and delegates to `pureEvaluate()`.
 *
 * This function IS NOT pure — it calls the database. But the decision
 * logic itself (pureEvaluate) remains side-effect-free and fully testable.
 */

import type { PoolClient } from "pg";
import type { BookingDecision } from "../models/booking-decision.js";
import type { BookingDecisionInput } from "../models/booking-decision.js";
import { pureEvaluate } from "./pure-evaluate.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../models/rule-evaluation-context.js";
import { findPublishedPolicyVersion } from "../repositories/policy-version.repo.js";
import {
  loadModalityBlockedRules,
  loadExamTypeRules,
  loadCategoryDailyLimits,
  loadExamTypeSpecialQuotas,
  loadExamTypeRuleItemExamTypeIds,
} from "../repositories/policy-rules.repo.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { findExamTypeById } from "../../catalog/repositories/exam-type-catalog.repo.js";
import {
  getBookedCountForDate,
  getBookedCountsByCategoryForDate,
  getSpecialQuotaBookedCount,
} from "../../scheduler/repositories/capacity.repo.js";

export interface EvaluateWithDbParams extends BookingDecisionInput {}

/**
 * Load context and evaluate a booking candidate against the currently
 * published policy. This is the function called by the POST /evaluate endpoint.
 */
export async function evaluateWithDb(
  client: PoolClient,
  params: EvaluateWithDbParams,
  policySetKey: string = "default"
): Promise<BookingDecision> {
  // 1. Load the published policy version
  const publishedVersion = await findPublishedPolicyVersion(client, policySetKey);
  if (!publishedVersion) {
    // No published policy — return blocked with a clear reason
    return {
      isAllowed: false,
      requiresSupervisorOverride: false,
      displayStatus: "blocked",
      suggestedBookingMode: "standard",
      consumedCapacityMode: null,
      remainingStandardCapacity: null,
      remainingSpecialQuota: null,
      matchedRuleIds: [],
      reasons: [
        {
          code: "no_published_policy",
          severity: "error",
          message: "No scheduling policy has been published.",
        },
      ],
      policyVersionRef: {
        policySetKey,
        versionId: 0,
        versionNo: 0,
        configHash: "",
      },
      decisionTrace: {
        evaluatedAt: new Date().toISOString(),
        input: params,
      },
    };
  }

  // 2. Load integrity checks — do the requested entities exist?
  const modality = await findModalityById(client, params.modalityId);
  const modalityExists = modality !== null;

  let examTypeExists = true; // true if no exam type specified
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

  // 3. Load all rule data for this policy version
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

  // 4. Load current booking count for the bucket
  const currentBookedCount = await getBookedCountForDate(
    client,
    params.modalityId,
    params.scheduledDate,
    params.caseCategory
  );
  const bookedCounts = await getBookedCountsByCategoryForDate(
    client,
    params.modalityId,
    params.scheduledDate
  );

  // 5. Load special quota booked count (only when examTypeId is provided)
  let currentSpecialQuotaBookedCount = 0;
  if (params.examTypeId != null) {
    currentSpecialQuotaBookedCount = await getSpecialQuotaBookedCount(client, {
      modalityId: params.modalityId,
      bookingDate: params.scheduledDate,
      caseCategory: params.caseCategory,
      examTypeId: params.examTypeId,
    });
  }

  // 6. Build the context
  const context: RuleEvaluationContext = {
    policyVersionId: publishedVersion.id,
    policySetKey,
    policyVersionNo: publishedVersion.versionNo,
    policyConfigHash: publishedVersion.configHash,
    modalityExists,
    examTypeExists,
    examTypeBelongsToModality,
    blockedRules,
    examTypeRules,
    examTypeRuleItemExamTypeIds,
    categoryLimits,
    modalityDailyCapacity: modality?.dailyCapacity ?? null,
    currentBookedCountTotal: bookedCounts.total,
    currentBookedCountOncology: bookedCounts.oncology,
    currentBookedCountNonOncology: bookedCounts.nonOncology,
    specialQuotas,
    currentBookedCount,
    currentSpecialQuotaBookedCount,
  };

  // 6. Evaluate
  const pureInput: PureEvaluateInput = {
    patientId: params.patientId,
    modalityId: params.modalityId,
    examTypeId: params.examTypeId ?? null,
    scheduledDate: params.scheduledDate,
    caseCategory: params.caseCategory,
    useSpecialQuota: params.useSpecialQuota ?? false,
    specialReasonCode: params.specialReasonCode ?? null,
    includeOverrideEvaluation: params.includeOverrideEvaluation ?? false,
    context,
  };

  return pureEvaluate(pureInput);
}
