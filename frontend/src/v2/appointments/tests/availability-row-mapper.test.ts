import { describe, expect, it } from "vitest";
import { isAvailabilityRowVisible, mapAvailabilityRow } from "../hooks/availability-row-mapper";
import type { AvailabilityDayDto } from "../types";

function baseDay(): AvailabilityDayDto {
  return {
    date: "2027-01-02",
    bucketMode: "partitioned",
    modalityTotalCapacity: 20,
    bookedTotal: 19,
    oncology: { reserved: 10, filled: 5, remaining: 5 },
    nonOncology: { reserved: 10, filled: 9, remaining: 1 },
    specialQuotaSummary: null,
    dailyCapacity: 20,
    bookedCount: 19,
    remainingCapacity: 1,
    isFull: false,
    decision: {
      isAllowed: false,
      requiresSupervisorOverride: true,
      displayStatus: "restricted",
      suggestedBookingMode: "override",
      consumedCapacityMode: "override",
      remainingStandardCapacity: 1,
      remainingSpecialQuota: null,
      matchedRuleIds: [201],
      reasons: [{ code: "exam_type_not_allowed_for_rule", severity: "warning", message: "Fallback reason" }],
      policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "hash" },
      decisionTrace: { evaluatedAt: "", input: {} },
    },
  };
}

describe("availability-row-mapper exam-rule summary precedence", () => {
  it("prefers structured matched exam-rule summary over generic reason text", () => {
    const day = baseDay();
    day.decision.matchedExamRuleSummaries = [
      {
        ruleId: "201",
        title: "Brain MRI restriction",
        ruleType: "specific_date",
        effectMode: "restriction_overridable",
        isBlocking: false,
      },
    ];

    const row = mapAvailabilityRow(day, "en");
    expect(row.matchedExamRuleSummary?.title).toBe("Brain MRI restriction");
    expect(row.matchedExamRuleSummary?.effectLabel).toBe("Restricted unless supervisor approves");
    expect(row.reasonText).toBe("");
  });

  it("falls back to generic reason text when no structured matched exam-rule summary exists", () => {
    const row = mapAvailabilityRow(baseDay(), "en");
    expect(row.matchedExamRuleSummary).toBeNull();
    expect(row.reasonText).toBe("Fallback reason");
  });

  it("formats day labels in Arabic when language is ar", () => {
    const row = mapAvailabilityRow(baseDay(), "ar");
    expect(row.dayLabel).toContain("السبت");
    expect(row.dayLabel).toContain("يناير");
  });

  it("maps category-only exhaustion as restricted, not a full modality day", () => {
    const day = baseDay();
    day.rowDisplayStatus = undefined;
    day.decision.displayStatus = "blocked";
    day.decision.reasons = [{ code: "category_capacity_exhausted", severity: "error", message: "Category is full" }];
    day.remainingCapacity = 3;
    day.decision.remainingStandardCapacity = 3;

    const row = mapAvailabilityRow(day, "en");

    expect(row.status).toBe("restricted");
    expect(row.remainingCapacity).toBe(3);
  });

  it("maps total modality exhaustion as full", () => {
    const day = baseDay();
    day.rowDisplayStatus = undefined;
    day.decision.displayStatus = "blocked";
    day.decision.reasons = [{ code: "modality_daily_capacity_exhausted", severity: "error", message: "Modality is full" }];
    day.remainingCapacity = 0;
    day.decision.remainingStandardCapacity = 0;

    const row = mapAvailabilityRow(day, "en");

    expect(row.status).toBe("full");
  });

  it("keeps Friday and Saturday as metadata only unless policy hides them", () => {
    const friday = baseDay();
    friday.date = "2027-01-01";
    friday.decision.displayStatus = "available";
    friday.decision.reasons = [];
    const saturday = baseDay();
    saturday.date = "2027-01-02";
    saturday.decision.displayStatus = "available";
    saturday.decision.reasons = [];

    expect(mapAvailabilityRow(friday, "en").isWeekend).toBe(true);
    expect(mapAvailabilityRow(friday, "en").hideAlways).toBe(false);
    expect(mapAvailabilityRow(saturday, "en").isWeekend).toBe(true);
    expect(mapAvailabilityRow(saturday, "en").hideAlways).toBe(false);
  });

  it("marks rows policy-hidden only when backend sends weekday disabled reason", () => {
    const day = baseDay();
    day.date = "2027-01-03";
    day.decision.reasons = [{ code: "weekday_appointments_disabled", severity: "error", message: "Disabled weekday" }];

    expect(mapAvailabilityRow(day, "en").hideAlways).toBe(true);
  });

  it("does not display a row with remaining capacity as full", () => {
    const day = baseDay();
    day.rowDisplayStatus = "full";
    day.decision.displayStatus = "available";
    day.decision.reasons = [];
    day.remainingCapacity = 1;
    day.decision.remainingStandardCapacity = 1;

    expect(mapAvailabilityRow(day, "en").status).toBe("available");
  });

  it("full-day visibility only affects full rows", () => {
    const restricted = mapAvailabilityRow(baseDay(), "en");
    const full = { ...restricted, date: "2027-01-03", status: "full" as const };

    expect(isAvailabilityRowVisible(restricted, { showFullDays: false, showPolicyHiddenDays: false })).toBe(true);
    expect(isAvailabilityRowVisible(full, { showFullDays: false, showPolicyHiddenDays: false })).toBe(false);
    expect(isAvailabilityRowVisible(full, { showFullDays: true, showPolicyHiddenDays: false })).toBe(true);
  });

  it("policy-hidden visibility does not show full rows when full days are hidden", () => {
    const row = {
      ...mapAvailabilityRow(baseDay(), "en"),
      status: "full" as const,
      hideAlways: true,
    };

    expect(isAvailabilityRowVisible(row, { showFullDays: false, showPolicyHiddenDays: true })).toBe(false);
  });
});
