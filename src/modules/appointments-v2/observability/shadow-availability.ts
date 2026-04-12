/**
 * Appointments V2 — Shadow mode availability wrapper.
 *
 * D010: When shadow mode is enabled, this wrapper:
 * 1. Calls the normal availability service
 * 2. Also computes V2 decisions for each date
 * 3. Logs structured diffs (without changing the response)
 *
 * The shadow mode is gated behind an environment variable or settings flag.
 */

import type { PoolClient } from "pg";
import { pureEvaluate } from "../rules/services/pure-evaluate.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../rules/models/rule-evaluation-context.js";
import { findPublishedPolicyVersion } from "../rules/repositories/policy-version.repo.js";
import {
  loadModalityBlockedRules,
  loadExamTypeRules,
  loadCategoryDailyLimits,
  loadExamTypeSpecialQuotas,
  loadExamTypeRuleItemExamTypeIds,
} from "../rules/repositories/policy-rules.repo.js";
import { findModalityById } from "../catalog/repositories/modality-catalog.repo.js";
import { findExamTypeById } from "../catalog/repositories/exam-type-catalog.repo.js";
import { getBookedCountForDate } from "../scheduler/repositories/capacity.repo.js";
import { addDays, todayIso } from "../shared/utils/dates.js";
import { pool } from "../../../db/pool.js";
import type { AvailabilityDayDto, GetAvailabilityParams } from "../scheduler/services/availability.service.js";
import {
  compareLegacyVsV2,
  logShadowDiffs,
  type ShadowDiffEntry,
} from "./shadow-diff.js";

/**
 * Check if shadow mode is enabled.
 * Uses environment variable SHADOW_MODE_ENABLED (default: false).
 */
export function isShadowModeEnabled(): boolean {
  return process.env.SHADOW_MODE_ENABLED === "true";
}

/**
 * Run availability with shadow mode comparison.
 *
 * If shadow mode is disabled, this is a pass-through to the normal availability service.
 * If enabled, it also computes V2 decisions and logs diffs.
 *
 * @param legacyResults - The legacy availability results (to compare against)
 * @param params - The availability query parameters
 * @param policySetKey - The policy set key (default: "default")
 */
export async function runAvailabilityWithShadow(
  legacyResults: AvailabilityDayDto[],
  params: GetAvailabilityParams,
  policySetKey: string = "default"
): Promise<AvailabilityDayDto[]> {
  // If shadow mode is not enabled, just return the legacy results as-is
  if (!isShadowModeEnabled()) {
    return legacyResults;
  }

  try {
    // Compute V2 decisions for each date in parallel with the legacy results
    const shadowDiffs = await computeShadowDiffs(legacyResults, params, policySetKey);

    if (shadowDiffs.length > 0) {
      logShadowDiffs(shadowDiffs);
    }
  } catch (error) {
    // Log the error but don't fail the request — shadow mode must not affect user behavior
    console.error("Shadow mode comparison failed:", error);
  }

  // Always return the legacy results unchanged
  return legacyResults;
}

/**
 * Compute V2 decisions for each date in the legacy results and compare.
 */
async function computeShadowDiffs(
  legacyResults: AvailabilityDayDto[],
  params: GetAvailabilityParams,
  policySetKey: string
): Promise<ShadowDiffEntry[]> {
  const client = await pool.connect();
  try {
    return computeShadowDiffsInternal(client, legacyResults, params, policySetKey);
  } finally {
    client.release();
  }
}

async function computeShadowDiffsInternal(
  client: PoolClient,
  legacyResults: AvailabilityDayDto[],
  params: GetAvailabilityParams,
  policySetKey: string
): Promise<ShadowDiffEntry[]> {
  // Load the published policy once
  const publishedVersion = await findPublishedPolicyVersion(client, policySetKey);
  if (!publishedVersion) {
    return []; // No published policy — skip shadow comparison
  }

  // Load integrity checks
  let examTypeExists = true;
  let examTypeBelongsToModality = true;
  if (params.examTypeId != null) {
    const examType = await findExamTypeById(client, params.examTypeId);
    examTypeExists = examType !== null;
    if (examType && examType.modalityId != null) {
      examTypeBelongsToModality = examType.modalityId === params.modalityId;
    } else {
      examTypeBelongsToModality = false;
    }
  }

  // Load rules once (same for all dates)
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

  const diffs: ShadowDiffEntry[] = [];

  // Compare each date
  for (const legacyDay of legacyResults) {
    // Load booked count for this date
    const currentBookedCount = await getBookedCountForDate(
      client,
      params.modalityId,
      legacyDay.date,
      params.caseCategory
    );

    // Build context
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
      currentBookedCount,
    };

    // Build pure evaluate input
    const pureInput: PureEvaluateInput = {
      patientId: 0, // Shadow mode — no specific patient
      modalityId: params.modalityId,
      examTypeId: params.examTypeId ?? null,
      scheduledDate: legacyDay.date,
      caseCategory: params.caseCategory,
      useSpecialQuota: params.useSpecialQuota ?? false,
      specialReasonCode: params.specialReasonCode ?? null,
      includeOverrideEvaluation: params.includeOverrideCandidates ?? false,
      context,
    };

    const v2Decision = await pureEvaluate(pureInput);

    // Build legacy outcome from the legacy result
    const legacyOutcome = {
      isBookable: legacyDay.decision?.isAllowed ?? !legacyDay.isFull,
      displayStatus: legacyDay.decision?.displayStatus,
      blockedReasons: legacyDay.decision?.reasons.map((r) => r.code),
    };

    // Compare
    const diff = compareLegacyVsV2(
      legacyDay.date,
      params.modalityId,
      params.examTypeId ?? null,
      params.caseCategory,
      legacyOutcome,
      v2Decision
    );

    diffs.push(diff);
  }

  return diffs;
}
