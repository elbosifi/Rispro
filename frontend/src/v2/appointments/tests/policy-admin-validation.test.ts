import { describe, expect, it } from "vitest";
import { validatePolicyDraftForAdmin } from "../utils/policy-admin-validation";
import type { PolicyDisplayLookupsDto, PolicySnapshotDto } from "../types";

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

const displayLookups: PolicyDisplayLookupsDto = {
  modalities: [{ id: 1, name: "CT", nameAr: "CT", nameEn: "CT", code: "CT", isActive: true }],
  examTypes: [
    { id: 10, name: "CT Head", nameAr: "CT Head", nameEn: "CT Head", code: "CTH", modalityId: 1, isActive: true },
    { id: 11, name: "Old CT", nameAr: "Old CT", nameEn: "Old CT", code: "OLD", modalityId: 1, isActive: false },
    { id: 12, name: "MRI Brain", nameAr: "MRI Brain", nameEn: "MRI Brain", code: "MRB", modalityId: 2, isActive: true },
  ],
  users: [
    { id: 20, username: "active", fullName: "Active User", role: "supervisor", isActive: true },
    { id: 21, username: "inactive", fullName: "Inactive User", role: "supervisor", isActive: false },
  ],
};

describe("validatePolicyDraftForAdmin", () => {
  it("reports blocking empty active exam selections and duplicate category limits", () => {
    const snapshot = emptySnapshot();
    snapshot.categoryDailyLimits = [
      { id: 1, modalityId: 1, caseCategory: "oncology", dailyLimit: 2, isActive: true },
      { id: 2, modalityId: 1, caseCategory: "oncology", dailyLimit: 3, isActive: true },
    ];
    snapshot.examTypeRules = [{
      id: 3,
      modalityId: 1,
      ruleType: "specific_date",
      effectMode: "hard_restriction",
      specificDate: "2027-01-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      examTypeIds: [],
      title: null,
      notes: null,
      isActive: true,
    }];
    snapshot.examMixQuotaRules = [{
      id: 4,
      modalityId: 1,
      title: "Mix",
      ruleType: "specific_date",
      specificDate: "2027-01-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      dailyLimit: 1,
      examTypeIds: [],
      isActive: true,
    }];

    const result = validatePolicyDraftForAdmin(snapshot, displayLookups);

    expect(result.errors.map((item) => item.section)).toContain("Daily category limits");
    expect(result.errors.some((item) => item.message.includes("Duplicate active limit"))).toBe(true);
    expect(result.errors.some((item) => item.section === "Exam restriction rules" && item.message.includes("select at least one exam"))).toBe(true);
    expect(result.errors.some((item) => item.section === "Exam mix quota groups" && item.message.includes("select at least one exam"))).toBe(true);
  });

  it("classifies unknown selected exams as blocking and inactive selected exams as warnings", () => {
    const snapshot = emptySnapshot();
    snapshot.examTypeRules = [{
      id: 5,
      modalityId: 1,
      ruleType: "specific_date",
      effectMode: "hard_restriction",
      specificDate: "2027-01-01",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      examTypeIds: [11, 999],
      title: null,
      notes: null,
      isActive: true,
    }];

    const result = validatePolicyDraftForAdmin(snapshot, displayLookups);

    expect(result.errors.some((item) => item.message.includes("Unknown exam type ID 999"))).toBe(true);
    expect(result.warnings.some((item) => item.message.includes("Old CT") && item.message.includes("inactive"))).toBe(true);
  });

  it("warns for retained inactive special-quota users and rejects unknown users", () => {
    const snapshot = emptySnapshot();
    snapshot.specialQuotaRules = [
      {
        id: 6,
        logicalKey: "00000000-0000-0000-0000-000000000006",
        modalityId: 1,
        title: "CT overflow",
        examTypeIds: [10],
        dailyExtraSlots: 1,
        allowedUserIds: [21, 999],
        isActive: true,
      },
    ];

    const result = validatePolicyDraftForAdmin(snapshot, displayLookups);

    expect(result.warnings.some((item) => item.message.includes("Inactive User") && item.message.includes("inactive"))).toBe(true);
    expect(result.errors.some((item) => item.message.includes("Unknown user ID 999"))).toBe(true);
  });

  it("rejects invalid group capacity, missing users, modality mismatch, and overlapping exam pools", () => {
    const snapshot = emptySnapshot();
    snapshot.specialQuotaRules = [
      {
        id: 6,
        logicalKey: "00000000-0000-0000-0000-000000000006",
        modalityId: 1,
        title: "First",
        examTypeIds: [10, 12],
        dailyExtraSlots: 0,
        allowedUserIds: [],
        isActive: true,
      },
      {
        id: 7,
        logicalKey: "00000000-0000-0000-0000-000000000007",
        modalityId: 1,
        title: "Second",
        examTypeIds: [10],
        dailyExtraSlots: 1,
        allowedUserIds: [20],
        isActive: true,
      },
    ];

    const messages = validatePolicyDraftForAdmin(snapshot, displayLookups).errors.map((item) => item.message);
    expect(messages.some((message) => message.includes("positive number of extra slots"))).toBe(true);
    expect(messages.some((message) => message.includes("authorize at least one user"))).toBe(true);
    expect(messages.some((message) => message.includes("does not belong to the selected modality"))).toBe(true);
    expect(messages.some((message) => message.includes("overlapping pools are not allowed"))).toBe(true);
  });

  it("reports invalid date ranges and recurrence fields", () => {
    const snapshot = emptySnapshot();
    snapshot.modalityBlockedRules = [{
      id: 7,
      modalityId: 1,
      ruleType: "date_range",
      specificDate: null,
      startDate: "2027-02-01",
      endDate: "2027-01-01",
      recurStartMonth: null,
      recurStartDay: null,
      recurEndMonth: null,
      recurEndDay: null,
      isOverridable: false,
      isActive: true,
      title: null,
      notes: null,
    }, {
      id: 8,
      modalityId: 1,
      ruleType: "yearly_recurrence",
      specificDate: null,
      startDate: null,
      endDate: null,
      recurStartMonth: 13,
      recurStartDay: 1,
      recurEndMonth: 1,
      recurEndDay: 40,
      isOverridable: false,
      isActive: true,
      title: null,
      notes: null,
    }];
    snapshot.examTypeRules = [{
      id: 9,
      modalityId: 1,
      ruleType: "weekly_recurrence",
      effectMode: "hard_restriction",
      specificDate: null,
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
      examTypeIds: [10],
      title: null,
      notes: null,
      isActive: true,
    }];

    const result = validatePolicyDraftForAdmin(snapshot, displayLookups);

    expect(result.errors.some((item) => item.section === "Blocked dates" && item.message.includes("start date must be before"))).toBe(true);
    expect(result.errors.some((item) => item.section === "Blocked dates" && item.message.includes("valid recurrence"))).toBe(true);
    expect(result.errors.some((item) => item.section === "Exam restriction rules" && item.message.includes("weekday"))).toBe(true);
  });
});
