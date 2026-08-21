import { describe, expect, it } from "vitest";
import type { SchedulingDecisionDto } from "../types";
import {
  canRoleApproveSchedulingOverride,
  hasMultipleSupportedOverrideTypesFromDecision,
  inferSupportedOverrideTypeFromDecision,
} from "../utils/scheduling-override-requests";

function decision(effectMode: string, requiresSupervisorOverride: boolean): SchedulingDecisionDto {
  return {
    isAllowed: false,
    requiresSupervisorOverride,
    displayStatus: requiresSupervisorOverride ? "restricted" : "blocked",
    suggestedBookingMode: requiresSupervisorOverride ? "override" : "standard",
    consumedCapacityMode: null,
    remainingStandardCapacity: 1,
    remainingSpecialQuota: null,
    matchedRuleIds: [1],
    matchedExamRuleSummaries: [{ ruleId: "1", title: "Exam rule", ruleType: "specific_date", effectMode, isBlocking: !requiresSupervisorOverride }],
    reasons: [{ code: "exam_type_not_allowed_for_rule", severity: requiresSupervisorOverride ? "warning" : "error", message: "Exam rule" }],
    policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "hash" },
    decisionTrace: { evaluatedAt: "", input: {} },
  };
}

function decisionWithReasons(effectMode: string, reasonCodes: string[]): SchedulingDecisionDto {
  const value = decision(effectMode, true);
  value.reasons = reasonCodes.map((code) => ({ code, severity: "error", message: code }));
  return value;
}

describe("exam restriction scheduling override", () => {
  it("classifies only a soft exam restriction", () => {
    expect(inferSupportedOverrideTypeFromDecision(decision("restriction_overridable", true))).toBe("exam_restriction_override");
    expect(inferSupportedOverrideTypeFromDecision(decision("hard_restriction", false))).toBeNull();
  });

  it.each([
    "category_capacity_exhausted",
    "modality_daily_capacity_exhausted",
    "exam_mix_quota_exhausted",
    "closed_weekday_override_required",
  ])("does not mask a concurrent %s blocker", (reasonCode) => {
    expect(inferSupportedOverrideTypeFromDecision(decisionWithReasons("restriction_overridable", [reasonCode]))).toBeNull();
  });

  it.each(["category_override", "total_capacity_override"] as const)("treats %s capacity mode plus a soft exam restriction as multiple override types", (capacityResolutionMode) => {
    const value = decision("restriction_overridable", true);
    expect(inferSupportedOverrideTypeFromDecision(value, capacityResolutionMode)).toBeNull();
    expect(hasMultipleSupportedOverrideTypesFromDecision(value, capacityResolutionMode)).toBe(true);
  });

  it.each([
    ["category_capacity_exhausted", "exam_mix_quota_exhausted"],
    ["closed_weekday_override_required", "category_capacity_exhausted"],
  ])("does not mask multiple concurrent blockers: %s and %s", (firstReasonCode, secondReasonCode) => {
    expect(inferSupportedOverrideTypeFromDecision(
      decisionWithReasons("restriction_overridable", [firstReasonCode, secondReasonCode])
    )).toBeNull();
  });

  it("allows supervisors and super admins but not receptionists to approve it", () => {
    expect(canRoleApproveSchedulingOverride("supervisor", "exam_restriction_override")).toBe(true);
    expect(canRoleApproveSchedulingOverride("super_admin", "exam_restriction_override")).toBe(true);
    expect(canRoleApproveSchedulingOverride("receptionist", "exam_restriction_override")).toBe(false);
  });
});
