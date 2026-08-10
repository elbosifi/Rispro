import { describe, expect, it } from "vitest";
import { getPolicyDiffRiskSummary } from "../utils/policy-diff-risk";
import type { PolicySnapshotDto } from "../types";

function emptySnapshot(): PolicySnapshotDto {
  return {
    categoryDailyLimits: [],
    modalityBlockedRules: [],
    examTypeRules: [],
    specialQuotaRules: [],
    examMixQuotaRules: [],
    specialReasonCodes: [],
  };
}

describe("getPolicyDiffRiskSummary", () => {
  it("does not report high-risk removals for cloned snapshots with different DB ids", () => {
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
      title: "Whole Spine",
      notes: null,
      isActive: true,
    });

    const draft = emptySnapshot();
    draft.examTypeRules.push({ ...published.examTypeRules[0]!, id: 99 });

    const result = getPolicyDiffRiskSummary(published, draft);

    expect(result.highRiskWarnings).toEqual([]);
    expect(result.affectedSections).toEqual([]);
  });

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
      title: "Whole Spine",
      notes: null,
      isActive: true,
    });

    const draft = emptySnapshot();
    draft.examTypeRules.push({ ...published.examTypeRules[0]!, effectMode: "hard_restriction", examTypeIds: [] });

    const result = getPolicyDiffRiskSummary(published, draft);

    expect(result.affectedSections).toContain("Exam restriction rules");
    expect(result.highRiskWarnings.some((warning) => warning.message.includes("Whole Spine") && warning.message.includes("1 selected exam"))).toBe(true);
    expect(result.highRiskWarnings.some((warning) => warning.message.includes("Supervisor-overridable restriction -> Hard restriction"))).toBe(true);
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
    published.specialQuotaRules.push({ id: 3, logicalKey: "00000000-0000-0000-0000-000000000003", modalityId: 1, title: "MRI pool", examTypeIds: [11], dailyExtraSlots: 3, allowedUserIds: [], isActive: true });

    const draft = emptySnapshot();
    draft.categoryDailyLimits.push({ ...published.categoryDailyLimits[0]!, dailyLimit: 8 });
    draft.examMixQuotaRules = [{ ...published.examMixQuotaRules[0]!, dailyLimit: 4 }];
    draft.specialQuotaRules.push({ ...published.specialQuotaRules[0]!, dailyExtraSlots: 1 });

    const result = getPolicyDiffRiskSummary(published, draft);

    expect(result.highRiskWarnings.some((warning) => warning.message.includes("daily limit 10 -> 8"))).toBe(true);
    expect(result.highRiskWarnings.some((warning) => warning.message.includes("daily limit 5 -> 4"))).toBe(true);
    expect(result.highRiskWarnings.some((warning) => warning.message.includes("extra slots 3 -> 1"))).toBe(true);
  });

  it("reports removed active exam restriction and exam mix rules with names", () => {
    const published = emptySnapshot();
    published.examTypeRules.push({
      id: 1,
      modalityId: 7,
      ruleType: "weekly_recurrence",
      effectMode: "hard_restriction",
      specificDate: null,
      startDate: null,
      endDate: null,
      weekday: 1,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      examTypeIds: [11],
      title: "Whole Spine",
      notes: null,
      isActive: true,
    });
    published.examMixQuotaRules = [{
      id: 2,
      modalityId: 8,
      title: "Breast ultrasound",
      ruleType: "date_range",
      specificDate: null,
      startDate: "2026-04-01",
      endDate: "2028-01-01",
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      dailyLimit: 10,
      examTypeIds: [12],
      isActive: true,
    }];

    const result = getPolicyDiffRiskSummary(published, emptySnapshot(), {
      modalities: [
        { id: 7, name: "MRI", nameAr: "MRI AR", nameEn: "MRI", code: "MR", isActive: true },
        { id: 8, name: "Ultrasound", nameAr: "US AR", nameEn: "Ultrasound", code: "US", isActive: true },
      ],
      examTypes: [
        { id: 11, name: "Spine", nameAr: null, nameEn: "Spine", code: "SP", modalityId: 7, isActive: true },
        { id: 12, name: "Breast US", nameAr: null, nameEn: "Breast US", code: "BUS", modalityId: 8, isActive: true },
      ],
      users: [],
    });

    expect(result.highRiskWarnings.some((warning) => warning.message.includes("MRI (MR)") && warning.message.includes("Whole Spine") && warning.message.includes("Weekly recurrence Monday"))).toBe(true);
    expect(result.highRiskWarnings.some((warning) => warning.message.includes("Ultrasound (US)") && warning.message.includes("Breast ultrasound") && warning.message.includes("daily limit 10"))).toBe(true);
  });
});
