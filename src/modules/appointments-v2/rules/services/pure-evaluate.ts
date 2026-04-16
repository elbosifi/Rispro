/**
 * Appointments V2 — Pure booking decision evaluator.
 *
 * This is a side-effect-free function: it accepts all rule data via
 * PureEvaluateInput and returns a BookingDecision. No DB calls, no
 * mutations. This makes it fully unit-testable.
 *
 * Precedence (D008):
 *   1. Integrity checks
 *   2. Hard blocks (modality blocked rules)
 *   3. Exam/service eligibility (exam type rules)
 *   4. Category capacity
 *   5. Special quota
 *   6. Override eligibility
 *   7. Final decision assembly
 */

import type { BookingDecision } from "../models/booking-decision.js";
import type { PureEvaluateInput, RuleEvaluationContext } from "../models/rule-evaluation-context.js";
import type { ReasonCode, DecisionStatus } from "../../shared/types/common.js";
import { blockedRuleMatchesDate, examRuleMatchesDate } from "../utils/date-rule-matching.js";

/** Helper to build a reason code */
function reason(
  code: string,
  severity: "error" | "warning",
  message: string,
  ruleRef?: { type: string; id: number }
): ReasonCode {
  return { code, severity, message, ruleRef };
}

// ---------------------------------------------------------------------------
// Step 1: Integrity checks
// ---------------------------------------------------------------------------
function checkIntegrity(
  input: PureEvaluateInput
): { ok: boolean; reasons: ReasonCode[] } {
  const reasons: ReasonCode[] = [];
  const ctx = input.context;

  if (!ctx.modalityExists) {
    reasons.push(
      reason("modality_not_found", "error", "The requested modality does not exist.")
    );
    return { ok: false, reasons };
  }

  if (input.examTypeId != null) {
    if (!ctx.examTypeExists) {
      reasons.push(
        reason("exam_type_not_found", "error", "The requested exam type does not exist.")
      );
      return { ok: false, reasons };
    }
    if (!ctx.examTypeBelongsToModality) {
      reasons.push(
        reason(
          "exam_type_modality_mismatch",
          "error",
          "The exam type does not belong to the requested modality."
        )
      );
      return { ok: false, reasons };
    }
  }

  // Note: We do NOT check for malformed blocked rules here.
  // Incomplete rules (missing dates) are harmless — blockedRuleMatchesDate()
  // already returns false for them, so they never match any date. Failing
  // the entire evaluation with a malformed_rule_configuration error would
  // incorrectly block ALL dates when a draft has an incomplete rule row.

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true, reasons: [] };
}

// ---------------------------------------------------------------------------
// Step 2: Hard blocks — modality blocked rules
// ---------------------------------------------------------------------------
function checkHardBlocks(
  input: PureEvaluateInput
): { blocked: boolean; overridable: boolean; reasons: ReasonCode[]; matchedIds: number[] } {
  const ctx = input.context;
  const reasons: ReasonCode[] = [];
  const matchedIds: number[] = [];

  for (const rule of ctx.blockedRules) {
    if (!rule.isActive) continue;
    if (!blockedRuleMatchesDate(rule, input.scheduledDate)) continue;

    matchedIds.push(rule.id);

    if (!rule.isOverridable) {
      reasons.push(
        reason(
          "modality_blocked_rule_match",
          "error",
          rule.title ?? "This date is blocked for the modality.",
          { type: "modality_blocked_rule", id: rule.id }
        )
      );
      // Hard block found — return immediately (non-overridable)
      return { blocked: true, overridable: false, reasons, matchedIds };
    } else {
      // Overridable block
      reasons.push(
        reason(
          "modality_blocked_overridable",
          "warning",
          rule.title ?? "This date is blocked but can be overridden by a supervisor.",
          { type: "modality_blocked_rule", id: rule.id }
        )
      );
    }
  }

  return { blocked: false, overridable: reasons.length > 0, reasons, matchedIds };
}

// ---------------------------------------------------------------------------
// Step 3: Exam/service eligibility
// ---------------------------------------------------------------------------
function checkExamEligibility(
  input: PureEvaluateInput
): {
  blocked: boolean;
  overridable: boolean;
  reasons: ReasonCode[];
  matchedIds: number[];
} {
  const ctx = input.context;
  const reasons: ReasonCode[] = [];
  const matchedIds: number[] = [];

  if (input.examTypeId == null) {
    // No exam type specified — skip exam rules
    return { blocked: false, overridable: false, reasons: [], matchedIds: [] };
  }

  // Does the exam type belong to any of the exam_type_rule_items?
  const applicableRules = ctx.examTypeRules.filter((rule) => {
    if (!rule.isActive) return false;
    if (!ctx.examTypeRuleItemExamTypeIds.includes(input.examTypeId!)) return false;
    if (!examRuleMatchesDate(rule, input.scheduledDate)) return false;
    return true;
  });

  let hardBlocked = false;

  for (const rule of applicableRules) {
    matchedIds.push(rule.id);

    if (rule.effectMode === "hard_restriction") {
      hardBlocked = true;
      reasons.push(
        reason(
          "exam_type_not_allowed_for_rule",
          "error",
          rule.title ?? "This exam type is not allowed on this date for the modality.",
          { type: "exam_type_rule", id: rule.id }
        )
      );
    } else {
      // restriction_overridable
      reasons.push(
        reason(
          "exam_type_not_allowed_for_rule",
          "warning",
          rule.title ?? "This exam type requires supervisor override on this date.",
          { type: "exam_type_rule", id: rule.id }
        )
      );
    }
  }

  if (hardBlocked) {
    return { blocked: true, overridable: false, reasons, matchedIds };
  }

  return { blocked: false, overridable: reasons.length > 0, reasons, matchedIds };
}

// ---------------------------------------------------------------------------
// Step 4 & 5: Capacity and special quota
// ---------------------------------------------------------------------------
function checkCapacity(
  input: PureEvaluateInput
): {
  status: DecisionStatus;
  remainingStandardCapacity: number | null;
  remainingSpecialQuota: number | null;
  reasons: ReasonCode[];
} {
  const ctx = input.context;
  const reasons: ReasonCode[] = [];
  const modalityDailyCapacity = ctx.modalityDailyCapacity;
  if (modalityDailyCapacity == null || modalityDailyCapacity <= 0) {
    reasons.push(
      reason(
        "modality_capacity_not_configured",
        "error",
        "This modality has no valid daily capacity configured."
      )
    );
    return {
      status: "blocked",
      remainingStandardCapacity: 0,
      remainingSpecialQuota: null,
      reasons,
    };
  }

  const activeLimits = ctx.categoryLimits.filter((l) => l.isActive);
  const oncologyLimit = activeLimits.find((l) => l.caseCategory === "oncology");
  const nonOncologyLimit = activeLimits.find((l) => l.caseCategory === "non_oncology");

  let partitioned = false;
  let oncologyReserve: number | null = null;
  let nonOncologyReserve: number | null = null;

  if (oncologyLimit && nonOncologyLimit) {
    const sum = oncologyLimit.dailyLimit + nonOncologyLimit.dailyLimit;
    if (sum !== modalityDailyCapacity) {
      reasons.push(
        reason(
          "invalid_category_capacity_configuration",
          "error",
          "Oncology and non-oncology limits must exactly match modality daily capacity."
        )
      );
      return {
        status: "blocked",
        remainingStandardCapacity: 0,
        remainingSpecialQuota: null,
        reasons,
      };
    }
    partitioned = true;
    oncologyReserve = oncologyLimit.dailyLimit;
    nonOncologyReserve = nonOncologyLimit.dailyLimit;
  } else if (oncologyLimit || nonOncologyLimit) {
    partitioned = true;
    if (oncologyLimit) {
      if (oncologyLimit.dailyLimit > modalityDailyCapacity) {
        reasons.push(
          reason(
            "invalid_category_capacity_configuration",
            "error",
            "Configured oncology limit exceeds modality daily capacity."
          )
        );
        return {
          status: "blocked",
          remainingStandardCapacity: 0,
          remainingSpecialQuota: null,
          reasons,
        };
      }
      oncologyReserve = oncologyLimit.dailyLimit;
      nonOncologyReserve = modalityDailyCapacity - oncologyLimit.dailyLimit;
    } else if (nonOncologyLimit) {
      if (nonOncologyLimit.dailyLimit > modalityDailyCapacity) {
        reasons.push(
          reason(
            "invalid_category_capacity_configuration",
            "error",
            "Configured non-oncology limit exceeds modality daily capacity."
          )
        );
        return {
          status: "blocked",
          remainingStandardCapacity: 0,
          remainingSpecialQuota: null,
          reasons,
        };
      }
      nonOncologyReserve = nonOncologyLimit.dailyLimit;
      oncologyReserve = modalityDailyCapacity - nonOncologyLimit.dailyLimit;
    }
  }

  const categoryBookedFallback =
    input.caseCategory === "oncology"
      ? ctx.currentBookedCountOncology
      : ctx.currentBookedCountNonOncology;
  const selectedBookedCount =
    categoryBookedFallback > 0 ? categoryBookedFallback : ctx.currentBookedCount;
  const totalBookedCount =
    ctx.currentBookedCountTotal > 0
      ? ctx.currentBookedCountTotal
      : (ctx.currentBookedCountOncology + ctx.currentBookedCountNonOncology) > 0
      ? (ctx.currentBookedCountOncology + ctx.currentBookedCountNonOncology)
      : ctx.currentBookedCount;

  const totalRemaining = modalityDailyCapacity - totalBookedCount;
  if (totalRemaining <= 0) {
    reasons.push(
      reason(
        "standard_capacity_exhausted",
        "error",
        "No remaining capacity for this modality date."
      )
    );
    return {
      status: "blocked",
      remainingStandardCapacity: 0,
      remainingSpecialQuota: null,
      reasons,
    };
  }

  let remainingStandardCapacity = totalRemaining;
  if (partitioned) {
    const reserve =
      input.caseCategory === "oncology" ? (oncologyReserve ?? 0) : (nonOncologyReserve ?? 0);
    const bookedInCategory = selectedBookedCount;
    const bucketRemaining = reserve - bookedInCategory;
    if (bucketRemaining <= 0) {
      reasons.push(
        reason(
          "standard_capacity_exhausted",
          "error",
          "No remaining capacity for this date and category."
        )
      );
      return {
        status: "blocked",
        remainingStandardCapacity: 0,
        remainingSpecialQuota: null,
        reasons,
      };
    }
    remainingStandardCapacity = Math.min(totalRemaining, bucketRemaining);
  }

  let remainingSpecialQuota: number | null = null;
  if (input.useSpecialQuota && input.examTypeId != null) {
    const examTypeIdNum = Number(input.examTypeId);
    const quota = ctx.specialQuotas.find(
      (q) => Number(q.examTypeId) === examTypeIdNum && q.isActive
    );
    if (quota && quota.dailyExtraSlots > 0) {
      remainingSpecialQuota = Math.max(
        0,
        quota.dailyExtraSlots - ctx.currentSpecialQuotaBookedCount
      );
    }
  }

  return {
    status: "available",
    remainingStandardCapacity,
    remainingSpecialQuota,
    reasons: [],
  };
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------
export async function pureEvaluate(
  input: PureEvaluateInput
): Promise<BookingDecision> {
  const allReasons: ReasonCode[] = [...(input.context.existingReasons ?? [])];
  const allMatchedIds: number[] = [];

  // Step 1: Integrity
  const integrity = checkIntegrity(input);
  allReasons.push(...integrity.reasons);

  if (!integrity.ok) {
    return buildDecision(input, "blocked", false, false, null, null, allMatchedIds, allReasons);
  }

  // Step 2: Hard blocks
  const hardBlocks = checkHardBlocks(input);
  allMatchedIds.push(...hardBlocks.matchedIds);
  allReasons.push(...hardBlocks.reasons);

  if (hardBlocks.blocked && !hardBlocks.overridable) {
    // Non-overridable hard block → blocked
    return buildDecision(input, "blocked", false, false, null, null, allMatchedIds, allReasons);
  }

  // Step 3: Exam eligibility
  const examCheck = checkExamEligibility(input);
  allMatchedIds.push(...examCheck.matchedIds);
  allReasons.push(...examCheck.reasons);

  if (examCheck.blocked && !examCheck.overridable) {
    // Hard exam restriction → blocked
    return buildDecision(input, "blocked", false, false, null, null, allMatchedIds, allReasons);
  }

  // Step 4 & 5: Capacity
  const capCheck = checkCapacity(input);
  allReasons.push(...capCheck.reasons);

  const hasOverridableBlocks = hardBlocks.overridable || examCheck.overridable;
  const capacityExhausted = capCheck.status === "blocked";

  // Step 6: Determine final status with override consideration
  let displayStatus: DecisionStatus;
  let requiresOverride = false;
  let suggestedMode: "standard" | "special" | "override" = "standard";
  let consumedCapacityMode: "standard" | "special" | "override" | null = "standard";

  if (capacityExhausted && hasOverridableBlocks) {
    // Both capacity exhausted AND overridable blocks
    displayStatus = "blocked";
    requiresOverride = true;
    suggestedMode = "override";
    consumedCapacityMode = null;
  } else if (capacityExhausted) {
    displayStatus = "blocked";
    suggestedMode = "override";
    consumedCapacityMode = null;
  } else if (hasOverridableBlocks) {
    displayStatus = "restricted";
    requiresOverride = true;
    suggestedMode = "override";
    consumedCapacityMode = "standard";
  } else {
    // Available — check if special quota is being used
    if (input.useSpecialQuota && capCheck.remainingSpecialQuota != null && capCheck.remainingSpecialQuota > 0) {
      suggestedMode = "special";
      consumedCapacityMode = "special";
    }
    displayStatus = "available";
  }

  // If override evaluation is explicitly requested, adjust
  if (input.includeOverrideEvaluation && (hasOverridableBlocks || capacityExhausted)) {
    requiresOverride = true;
    suggestedMode = "override";
    if (!capacityExhausted && !hasOverridableBlocks) {
      // Override requested but not actually needed
      requiresOverride = false;
      suggestedMode = "standard";
    }
  }

  return buildDecision(
    input,
    displayStatus,
    requiresOverride,
    displayStatus !== "blocked" || (requiresOverride && input.includeOverrideEvaluation),
    capCheck.remainingStandardCapacity,
    capCheck.remainingSpecialQuota,
    allMatchedIds,
    allReasons,
    consumedCapacityMode
  );
}

// ---------------------------------------------------------------------------
// Decision builder
// ---------------------------------------------------------------------------
function buildDecision(
  input: PureEvaluateInput,
  displayStatus: DecisionStatus,
  requiresOverride: boolean,
  isAllowed: boolean,
  remainingStandardCapacity: number | null,
  remainingSpecialQuota: number | null,
  matchedRuleIds: number[],
  reasons: ReasonCode[],
  consumedCapacityMode: "standard" | "special" | "override" | null = "standard"
): BookingDecision {
  const ctx = input.context;

  return {
    isAllowed,
    requiresSupervisorOverride: requiresOverride,
    displayStatus,
    suggestedBookingMode:
      displayStatus === "blocked" && !requiresOverride
        ? "override"
        : displayStatus === "restricted"
        ? "override"
        : input.useSpecialQuota && remainingSpecialQuota != null && remainingSpecialQuota > 0
        ? "special"
        : "standard",
    consumedCapacityMode,
    remainingStandardCapacity,
    remainingSpecialQuota,
    matchedRuleIds: [...new Set(matchedRuleIds)], // deduplicate
    reasons,
    policyVersionRef: {
      policySetKey: ctx.policySetKey,
      versionId: ctx.policyVersionId,
      versionNo: ctx.policyVersionNo,
      configHash: ctx.policyConfigHash,
    },
    decisionTrace: {
      evaluatedAt: new Date().toISOString(),
      input: {
        patientId: input.patientId,
        modalityId: input.modalityId,
        examTypeId: input.examTypeId,
        scheduledDate: input.scheduledDate,
        caseCategory: input.caseCategory,
        useSpecialQuota: input.useSpecialQuota,
        specialReasonCode: input.specialReasonCode,
        includeOverrideEvaluation: input.includeOverrideEvaluation,
      },
    },
  };
}
