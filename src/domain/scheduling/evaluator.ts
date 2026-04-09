import { validateIsoDate } from "../../utils/date.js";
import type {
  ExamTypeScheduleRule,
  ModalityBlockedRule,
  SchedulingCandidateInput,
  SchedulingDecisionContext,
  SchedulingResult
} from "./types.js";

function parseIsoDate(isoDate: string): Date {
  const normalized = validateIsoDate(isoDate, "scheduledDate");
  return new Date(`${normalized}T00:00:00Z`);
}

function isDateWithinRange(isoDate: string, startDate: string | null, endDate: string | null): boolean {
  if (!startDate || !endDate) return false;
  return isoDate >= startDate && isoDate <= endDate;
}

function dayOfWeek0Sunday(isoDate: string): number {
  return parseIsoDate(isoDate).getUTCDay();
}

function matchesYearlyRecurrence(rule: ModalityBlockedRule, isoDate: string): boolean {
  if (
    !rule.recurStartMonth ||
    !rule.recurStartDay ||
    !rule.recurEndMonth ||
    !rule.recurEndDay
  ) {
    return false;
  }

  const [yearStr, monthStr, dayStr] = isoDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const target = month * 100 + day;
  const start = rule.recurStartMonth * 100 + rule.recurStartDay;
  const end = rule.recurEndMonth * 100 + rule.recurEndDay;

  if (Number.isNaN(year) || Number.isNaN(target) || Number.isNaN(start) || Number.isNaN(end)) {
    return false;
  }

  if (start <= end) {
    return target >= start && target <= end;
  }

  return target >= start || target <= end;
}

function matchesBlockedRule(rule: ModalityBlockedRule, isoDate: string): boolean {
  if (rule.ruleType === "specific_date") {
    return Boolean(rule.specificDate && rule.specificDate === isoDate);
  }

  if (rule.ruleType === "date_range") {
    return isDateWithinRange(isoDate, rule.startDate, rule.endDate);
  }

  return matchesYearlyRecurrence(rule, isoDate);
}

function matchesExamRestrictionRule(rule: ExamTypeScheduleRule, isoDate: string): boolean {
  if (rule.ruleType === "specific_date") {
    return Boolean(rule.specificDate && rule.specificDate === isoDate);
  }

  if (rule.ruleType === "date_range") {
    return isDateWithinRange(isoDate, rule.startDate, rule.endDate);
  }

  if (!isDateWithinRange(isoDate, rule.startDate, rule.endDate)) {
    return false;
  }

  if (rule.weekday === null || rule.weekday === undefined) {
    return false;
  }

  if (dayOfWeek0Sunday(isoDate) !== rule.weekday) {
    return false;
  }

  if (!rule.alternateWeeks) {
    return true;
  }

  const anchor = rule.recurrenceAnchorDate || rule.startDate;
  if (!anchor) {
    return false;
  }

  const target = parseIsoDate(isoDate).getTime();
  const anchorMs = parseIsoDate(anchor).getTime();
  const daysDiff = Math.floor((target - anchorMs) / (24 * 60 * 60 * 1000));
  const weeksDiff = Math.floor(daysDiff / 7);
  return weeksDiff % 2 === 0;
}

function buildDisplayStatus(isAllowed: boolean, requiresOverride: boolean): SchedulingResult["displayStatus"] {
  if (isAllowed) return "available";
  if (requiresOverride) return "restricted";
  return "blocked";
}

export function evaluateSchedulingCandidate(
  input: SchedulingCandidateInput,
  context: SchedulingDecisionContext
): SchedulingResult {
  const reasons: string[] = [];
  const matchedRuleIds = new Set<number>();
  let requiresSupervisorOverride = false;
  let consumedCapacityMode: SchedulingResult["consumedCapacityMode"] = null;
  let suggestedBookingMode: SchedulingResult["suggestedBookingMode"] = null;

  // 1) Integrity checks.
  if (!context.integrity.modalityExists) {
    reasons.push("modality_not_found");
  }
  if (input.examTypeId && !context.integrity.examTypeExists) {
    reasons.push("exam_type_not_found");
  }
  if (input.examTypeId && !context.integrity.examTypeBelongsToModality) {
    reasons.push("exam_type_modality_mismatch");
  }
  if (context.integrity.malformedRuleConfig) {
    reasons.push("malformed_rule_configuration");
  }

  // 2) Hard blocks by modality/date.
  for (const blockedRule of context.blockedRules) {
    if (!matchesBlockedRule(blockedRule, input.scheduledDate)) continue;
    matchedRuleIds.add(blockedRule.id);
    reasons.push("modality_blocked_rule_match");
    if (!blockedRule.isOverridable) {
      return {
        isAllowed: false,
        requiresSupervisorOverride: false,
        blockReasons: Array.from(new Set(reasons)),
        matchedRuleIds: Array.from(matchedRuleIds),
        remainingCategoryCapacity: {
          oncology: context.capacity.categoryLimits.oncology === null
            ? null
            : Math.max(context.capacity.categoryLimits.oncology - context.capacity.bookedTotals.oncology, 0),
          nonOncology: context.capacity.categoryLimits.nonOncology === null
            ? null
            : Math.max(context.capacity.categoryLimits.nonOncology - context.capacity.bookedTotals.nonOncology, 0)
        },
        remainingSpecialQuota:
          context.capacity.specialQuotaLimit === null
            ? null
            : Math.max(context.capacity.specialQuotaLimit - context.capacity.specialQuotaConsumed, 0),
        consumedCapacityMode: null,
        suggestedBookingMode: null,
        displayStatus: "blocked",
        evaluationSnapshot: {
          precedenceStage: "hard_blocks",
          input,
          contextSummary: context
        }
      };
    }

    reasons.push("modality_blocked_overridable");
    requiresSupervisorOverride = true;
  }

  // 3) Exam-type schedule restriction checks.
  const matchedExamRules = context.examTypeRules.filter((rule) => matchesExamRestrictionRule(rule, input.scheduledDate));
  for (const rule of matchedExamRules) {
    matchedRuleIds.add(rule.id);
  }

  if (matchedExamRules.length > 0) {
    const hasAllowedMatch = matchedExamRules.some((rule) => {
      if (rule.allowedExamTypeIds.length === 0) return true;
      if (!input.examTypeId) return false;
      return rule.allowedExamTypeIds.includes(input.examTypeId);
    });

    if (!hasAllowedMatch) {
      reasons.push("exam_type_not_allowed_for_rule");
      const hasHardRule = matchedExamRules.some((rule) => rule.effectMode === "hard_restriction");
      if (hasHardRule) {
        return {
          isAllowed: false,
          requiresSupervisorOverride: false,
          blockReasons: Array.from(new Set(reasons)),
          matchedRuleIds: Array.from(matchedRuleIds),
          remainingCategoryCapacity: {
            oncology: context.capacity.categoryLimits.oncology === null
              ? null
              : Math.max(context.capacity.categoryLimits.oncology - context.capacity.bookedTotals.oncology, 0),
            nonOncology: context.capacity.categoryLimits.nonOncology === null
              ? null
              : Math.max(context.capacity.categoryLimits.nonOncology - context.capacity.bookedTotals.nonOncology, 0)
          },
          remainingSpecialQuota:
            context.capacity.specialQuotaLimit === null
              ? null
              : Math.max(context.capacity.specialQuotaLimit - context.capacity.specialQuotaConsumed, 0),
          consumedCapacityMode: null,
          suggestedBookingMode: null,
          displayStatus: "blocked",
          evaluationSnapshot: {
            precedenceStage: "exam_type_restrictions",
            input,
            contextSummary: context
          }
        };
      }
      requiresSupervisorOverride = true;
    }
  }

  // 4) Capacity checks.
  const remainingCategoryCapacity = {
    oncology:
      context.capacity.categoryLimits.oncology === null
        ? null
        : Math.max(context.capacity.categoryLimits.oncology - context.capacity.bookedTotals.oncology, 0),
    nonOncology:
      context.capacity.categoryLimits.nonOncology === null
        ? null
        : Math.max(context.capacity.categoryLimits.nonOncology - context.capacity.bookedTotals.nonOncology, 0)
  };

  const categoryRemaining =
    input.caseCategory === "oncology"
      ? remainingCategoryCapacity.oncology
      : remainingCategoryCapacity.nonOncology;

  const hasStandardCapacityByGlobal =
    context.capacity.standardDailyCapacity === null ||
    context.capacity.bookedTotals.total < context.capacity.standardDailyCapacity;
  const hasStandardCapacityByCategory = categoryRemaining === null || categoryRemaining > 0;
  const hasStandardCapacity = hasStandardCapacityByGlobal && hasStandardCapacityByCategory;

  const remainingSpecialQuota =
    context.capacity.specialQuotaLimit === null
      ? null
      : Math.max(context.capacity.specialQuotaLimit - context.capacity.specialQuotaConsumed, 0);

  const specialQuotaAvailable = remainingSpecialQuota !== null && remainingSpecialQuota > 0;

  if (hasStandardCapacity) {
    consumedCapacityMode = "standard";
    suggestedBookingMode = "standard";
  } else if (input.useSpecialQuota && specialQuotaAvailable) {
    consumedCapacityMode = "special";
    suggestedBookingMode = "special";
  } else if (input.useSpecialQuota && !specialQuotaAvailable) {
    reasons.push("special_quota_exhausted");
    requiresSupervisorOverride = true;
  } else if (!hasStandardCapacity) {
    reasons.push("standard_capacity_exhausted");
    requiresSupervisorOverride = true;
  }

  // 5) Override eligibility and final status.
  const canUseOverride = input.includeOverrideEvaluation && requiresSupervisorOverride;
  const isAllowed = reasons.length === 0 || canUseOverride;

  if (!isAllowed) {
    consumedCapacityMode = null;
    suggestedBookingMode = null;
  } else if (canUseOverride) {
    consumedCapacityMode = "override";
    suggestedBookingMode = "override";
  }

  return {
    isAllowed,
    requiresSupervisorOverride,
    blockReasons: Array.from(new Set(reasons)),
    matchedRuleIds: Array.from(matchedRuleIds),
    remainingCategoryCapacity,
    remainingSpecialQuota,
    consumedCapacityMode,
    suggestedBookingMode,
    displayStatus: buildDisplayStatus(isAllowed, requiresSupervisorOverride),
    evaluationSnapshot: {
      precedence: [
        "integrity_checks",
        "hard_blocks",
        "exam_type_restrictions",
        "capacity_checks",
        "override_eligibility"
      ],
      input,
      reasons: Array.from(new Set(reasons)),
      matchedRuleIds: Array.from(matchedRuleIds),
      contextSummary: context
    }
  };
}
