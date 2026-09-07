import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManageDayDialog } from "./manage-day-dialog";
import type { DayManagementContextDto } from "@/v2/appointments/types";

const useV2DayManagementContextMock = vi.fn();

vi.mock("@/v2/appointments/api", () => ({
  useV2DayManagementContext: (params: unknown) => useV2DayManagementContextMock(params),
}));

const context: DayManagementContextDto = {
  date: "2026-05-20",
  modality: { id: 1, code: "CT", name: "CT", nameAr: "الأشعة المقطعية", nameEn: "CT", dailyCapacity: 20, isActive: true },
  bookingSummary: { bookedTotal: 7, oncologyBooked: 3, nonOncologyBooked: 4 },
  policy: {
    policySetKey: "default",
    published: { id: 1, policySetId: 1, versionNo: 4, status: "published", configHash: "published", changeNote: null, createdAt: "2026-05-01", publishedAt: "2026-05-01" },
    draft: { id: 2, policySetId: 1, versionNo: 5, status: "draft", configHash: "draft", changeNote: null, createdAt: "2026-05-02", publishedAt: null },
  },
  effectiveRules: {
    modalityBlocks: [{ id: 10, ruleType: "specific_date", specificDate: "2026-05-20", startDate: null, endDate: null, recurStartMonth: null, recurStartDay: null, recurEndMonth: null, recurEndDay: null, isOverridable: false, title: "Scanner maintenance", notes: "Service window" }],
    examTypeRestrictions: [{ id: 11, ruleType: "specific_date", effectMode: "hard_restriction", specificDate: "2026-05-20", startDate: null, endDate: null, weekday: null, alternateWeeks: false, recurrenceAnchorDate: null, title: "Contrast restriction", notes: null, examTypes: [{ id: 3, name: "CT Head", nameAr: "تصوير الرأس", nameEn: "CT Head" }] }],
    examMixQuotas: [{ id: 12, ruleType: "specific_date", specificDate: "2026-05-20", startDate: null, endDate: null, weekday: null, alternateWeeks: false, recurrenceAnchorDate: null, title: "Head quota", dailyLimit: 2, examTypes: [{ id: 3, name: "CT Head", nameAr: "تصوير الرأس", nameEn: "CT Head" }] }],
  },
  globalConstraints: {
    categoryDailyLimits: [{ id: 13, caseCategory: "oncology", dailyLimit: 15 }, { id: 14, caseCategory: "non_oncology", dailyLimit: 10 }],
    specialQuotas: [{ id: 15, logicalKey: "quota-key", title: "Urgent reserve", dailyExtraSlots: 3, examTypes: [{ id: 3, name: "CT Head", nameAr: "تصوير الرأس", nameEn: "CT Head" }] }],
    closedWeekday: "friday",
  },
  examTypeOptions: [{ id: 3, name: "CT Head", nameAr: "تصوير الرأس", nameEn: "CT Head" }],
  supportedDayRuleTypes: ["block_modality", "restrict_exam_types", "set_exam_mix_quota"],
};

function renderDialog() {
  return render(<ManageDayDialog open onClose={vi.fn()} language="en" modalityId={1} modalityLabel="CT" date="2026-05-20" dateLabel="Wednesday, May 20, 2026" />);
}

afterEach(() => vi.clearAllMocks());

describe("ManageDayDialog", () => {
  it("renders the authoritative day context without mutation controls", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: context, isLoading: false, isError: false });
    renderDialog();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Wednesday, May 20, 2026.*CT/)).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("Existing bookings are not cancelled or rescheduled by day policy rules.")).toBeTruthy();
    expect(screen.getByText("Scanner maintenance")).toBeTruthy();
    expect(screen.getByText("CT Head")).toBeTruthy();
    expect(screen.getByText(/Daily limit: 2/)).toBeTruthy();
    expect(screen.getByText("Global modality policy")).toBeTruthy();
    expect(screen.getByText("Urgent reserve")).toBeTruthy();
    expect(screen.getByText(/Appointments are disabled for this weekday/)).toBeTruthy();
    expect(screen.getByText(/unpublished scheduling policy draft exists/)).toBeTruthy();
    expect(screen.getByText("Block modality")).toBeTruthy();
    expect(screen.getByText("Restrict exam types")).toBeTruthy();
    expect(screen.getByText("Set exam-mix quota")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apply|block|publish/i })).toBeNull();
  });

  it("does not show a draft warning when no draft exists", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: { ...context, policy: { ...context.policy, draft: null } }, isLoading: false, isError: false });
    renderDialog();

    expect(screen.queryByText(/unpublished scheduling policy draft exists/)).toBeNull();
  });

  it("shows a compact loading state", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderDialog();

    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("shows an error state and remains closable", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderDialog();

    expect(screen.getByText("Day policy information could not be loaded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});
