import { describe, expect, it } from "vitest";
import { getPolicyDiffRiskSummary } from "../utils/policy-diff-risk";
import type { PolicySnapshotDto } from "../types";

function emptySnapshot(): PolicySnapshotDto {
  return {
    categoryDailyLimits: [],
    modalityBlockedRules: [],
    examTypeRules: [],
    examTypeSpecialQuotas: [],
    examMixQuotaRules: [],
    specialReasonCodes: [],
  };
}

describe("getPolicyDiffRiskSummary", () => {
  it("reports exam selections cleared and hard restriction changes", () => {
    const published = emptySnapshot();
    published.examTypeRules.push({
      id: 1,
      modalityId: 7,
      ruleType: "specific_date",
      effectMode: "restriction_overridable",
      specificDate: "2027-01-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      examTypeIds: [11],
      title: null,
      notes: null,
      isActive: true,
    });

    const draft = emptySnapshot();
    draft.examTypeRules.push({ ...published.examTypeRules[0]!, effectMode: "hard_restriction", examTypeIds: [] });

    const result = getPolicyDiffRiskSummary(published, draft);

    expect(result.affectedSections).toContain("Exam restriction rules");
    expect(result.highRiskWarnings.some((warning) => warning.message === "Exam selection cleared.")).toBe(true);
    expect(result.highRiskWarnings.some((warning) => warning.message.includes("hard restriction"))).toBe(true);
  });

  it("reports reduced category, exam mix, and special quota limits", () => {
    const published = emptySnapshot();
    published.categoryDailyLimits.push({ id: 1, modalityId: 7, caseCategory: "oncology", dailyLimit: 10, isActive: true });
    published.examMixQuotaRules = [{
      id: 2,
      modalityId: 7,
      title: null,
      ruleType: "specific_date",
      specificDate: "2027-01-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      dailyLimit: 5,
      examTypeIds: [11],
      isActive: true,
    }];
    published.examTypeSpecialQuotas.push({ id: 3, examTypeId: 11, dailyExtraSlots: 3, allowedUserIds: [], isActive: true });

    const draft = emptySnapshot();
    draft.categoryDailyLimits.push({ ...published.categoryDailyLimits[0]!, dailyLimit: 8 });
    draft.examMixQuotaRules = [{ ...published.examMixQuotaRules[0]!, dailyLimit: 4 }];
    draft.examTypeSpecialQuotas.push({ ...published.examTypeSpecialQuotas[0]!, dailyExtraSlots: 1 });

    const result = getPolicyDiffRiskSummary(published, draft);

    expect(result.highRiskWarnings.some((warning) => warning.message === "Category daily limit reduced.")).toBe(true);
    expect(result.highRiskWarnings.some((warning) => warning.message === "Exam mix quota daily limit reduced.")).toBe(true);
    expect(result.highRiskWarnings.some((warning) => warning.message === "Special quota extra slots reduced.")).toBe(true);
  });
});
