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
import {
  pureEvaluate,
  evaluateExamMixQuotaSummaries,
  type EvaluatedExamMixQuotaSummary,
} from "../../rules/services/pure-evaluate.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../../rules/models/rule-evaluation-context.js";
import { findPublishedPolicyVersion } from "../../rules/repositories/policy-version.repo.js";
import {
  loadModalityBlockedRules,
  loadExamTypeRules,
  loadCategoryDailyLimits,
  loadExamTypeSpecialQuotas,
  loadExamTypeRuleItemExamTypeIds,
  loadExamTypeRuleItems,
  loadExamMixQuotaRules,
  loadExamMixQuotaRuleItems,
} from "../../rules/repositories/policy-rules.repo.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { findExamTypeById } from "../../catalog/repositories/exam-type-catalog.repo.js";
import {
  getBookedCountsByCategoryForDate,
  getSpecialQuotaBookedCount,
  getExamMixConsumedCountsByRule,
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
  examMixQuotaSummaries: EvaluatedExamMixQuotaSummary[];
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

type WeekdayName = "sunday" | "friday" | "saturday";

function normalizeSettingToggle(value: unknown, fallbackEnabled: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "enabled" || normalized === "true" || normalized === "1") return true;
  if (normalized === "disabled" || normalized === "false" || normalized === "0") return false;
  return fallbackEnabled;
}

function weekdayNameFromIsoDate(isoDate: string): WeekdayName | "other" {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  if (day === 0) return "sunday";
  if (day === 5) return "friday";
  if (day === 6) return "saturday";
  return "other";
}

async function loadDisabledBookingDays(client: PoolClient): Promise<Set<WeekdayName>> {
  const { rows } = await client.query<{ setting_key: string; setting_value: unknown }>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key in (
          'allow_friday_appointments',
          'allow_saturday_appointments',
          'allow_sunday_appointments'
        )
    `
  );

  const valuesByKey = rows.reduce<Record<string, unknown>>((accumulator, row) => {
    const raw = row.setting_value;
    const nestedValue =
      raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)
        ? (raw as Record<string, unknown>).value
        : raw;
    accumulator[row.setting_key] = nestedValue;
    return accumulator;
  }, {});

  const disabled = new Set<WeekdayName>();
  if (!normalizeSettingToggle(valuesByKey.allow_friday_appointments, true)) disabled.add("friday");
  if (!normalizeSettingToggle(valuesByKey.allow_saturday_appointments, true)) disabled.add("saturday");
  if (!normalizeSettingToggle(valuesByKey.allow_sunday_appointments, true)) disabled.add("sunday");
  return disabled;
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
  const examTypeRuleItems = await loadExamTypeRuleItems(
    client,
    publishedVersion.id,
    params.modalityId
  );
  const examMixQuotaRules = await loadExamMixQuotaRules(
    client,
    publishedVersion.id,
    params.modalityId
  );
  const examMixQuotaRuleItems = await loadExamMixQuotaRuleItems(
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
  const disabledBookingDays = await loadDisabledBookingDays(client);

  // 5. Generate dates
  const startDate = todayIso();
  const results: AvailabilityDayDto[] = [];

  for (let i = params.offset; i < params.offset + params.days; i++) {
    const date = addDays(startDate, i);
    const weekday = weekdayNameFromIsoDate(date);
    if (weekday !== "other" && disabledBookingDays.has(weekday)) {
      continue;
    }

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
    const currentExamMixConsumedByRuleId = await getExamMixConsumedCountsByRule(client, {
      policyVersionId: publishedVersion.id,
      modalityId: params.modalityId,
      bookingDate: date,
      ruleIds: examMixQuotaRules.map((row) => Number(row.id)),
    });

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
      examTypeRuleItems,
      categoryLimits,
      modalityDailyCapacity: modalityTotalCapacity,
      currentBookedCountTotal: bookedCounts.total,
      currentBookedCountOncology: bookedCounts.oncology,
      currentBookedCountNonOncology: bookedCounts.nonOncology,
      specialQuotas,
      currentBookedCount: bookedCountForCategory,
      currentSpecialQuotaBookedCount,
      examMixQuotaRules,
      examMixQuotaRuleItems,
      currentExamMixConsumedByRuleId,
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
    const examMixQuotaSummaries = evaluateExamMixQuotaSummaries(pureInput);

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
      examMixQuotaSummaries,
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
