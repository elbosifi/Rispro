import { describe, expect, it } from "vitest";
import type { SchedulingDecisionDto } from "../types";
import {
  canRoleApproveSchedulingOverride,
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

function decisionWithReason(effectMode: string, reasonCode: string): SchedulingDecisionDto {
  const value = decision(effectMode, true);
  value.reasons = [{ code: reasonCode, severity: "error", message: reasonCode }];
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
    expect(inferSupportedOverrideTypeFromDecision(decisionWithReason("restriction_overridable", reasonCode))).toBeNull();
  });

  it("allows supervisors and super admins but not receptionists to approve it", () => {
    expect(canRoleApproveSchedulingOverride("supervisor", "exam_restriction_override")).toBe(true);
    expect(canRoleApproveSchedulingOverride("super_admin", "exam_restriction_override")).toBe(true);
    expect(canRoleApproveSchedulingOverride("receptionist", "exam_restriction_override")).toBe(false);
  });
});
