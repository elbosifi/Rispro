import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManageDayDialog } from "./manage-day-dialog";
import type { DayManagementContextDto } from "@/v2/appointments/types";

const useV2DayManagementContextMock = vi.fn();
const useCreateV2DayModalityBlockMock = vi.fn();
const useCreateV2DayExamRestrictionMock = vi.fn();
const useCreateV2DayExamMixQuotaMock = vi.fn();
const useRemoveV2DayManagementRuleMock = vi.fn();
const mutation = { isPending: false, mutateAsync: vi.fn().mockResolvedValue({}) };

function resetMutationHooks() {
  useCreateV2DayModalityBlockMock.mockReturnValue(mutation);
  useCreateV2DayExamRestrictionMock.mockReturnValue(mutation);
  useCreateV2DayExamMixQuotaMock.mockReturnValue(mutation);
  useRemoveV2DayManagementRuleMock.mockReturnValue(mutation);
}

resetMutationHooks();

vi.mock("@/v2/appointments/api", () => ({
  useV2DayManagementContext: (params: unknown) => useV2DayManagementContextMock(params),
  useCreateV2DayModalityBlock: () => useCreateV2DayModalityBlockMock(),
  useCreateV2DayExamRestriction: () => useCreateV2DayExamRestrictionMock(),
  useCreateV2DayExamMixQuota: () => useCreateV2DayExamMixQuotaMock(),
  useRemoveV2DayManagementRule: () => useRemoveV2DayManagementRuleMock(),
}));

const context: DayManagementContextDto = {
  date: "2026-05-20",
  modality: { id: 1, code: "CT", name: "CT", nameAr: "الأشعة المقطعية", nameEn: "CT", dailyCapacity: 25, isActive: true },
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
  examTypeOptions: [
    { id: 3, name: "CT Head", nameAr: "تصوير الرأس", nameEn: "CT Head" },
    { id: 4, name: "MR Spine", nameAr: "العمود الفقري", nameEn: "MR Spine" },
  ],
  supportedDayRuleTypes: ["block_modality", "restrict_exam_types", "set_exam_mix_quota"],
};

function renderDialog() {
  return render(<ManageDayDialog open onClose={vi.fn()} language="en" modalityId={1} modalityLabel="CT" date="2026-05-20" dateLabel="Wednesday, May 20, 2026" />);
}

afterEach(() => { vi.clearAllMocks(); resetMutationHooks(); });

describe("ManageDayDialog", () => {
  it("renders authoritative context and disables all mutation entry points for a draft", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: context, isLoading: false, isError: false, refetch: vi.fn() });
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
    expect(screen.getByRole("button", { name: "Block modality" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Restrict exam types" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Set exam-mix quota" }).getAttribute("disabled")).not.toBeNull();
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    expect(removeButtons.length).toBe(3);
    removeButtons.forEach((button) => expect(button.getAttribute("disabled")).not.toBeNull());
    removeButtons.forEach((button) => fireEvent.click(button));
    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("does not show a draft warning when no draft exists", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: { ...context, policy: { ...context.policy, draft: null } }, isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    expect(screen.queryByText(/unpublished scheduling policy draft exists/)).toBeNull();
    expect(screen.getByRole("button", { name: "Block modality" }).getAttribute("disabled")).toBeNull();
  });

  it("shows a compact loading state", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderDialog();

    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("shows an error state and remains closable", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderDialog();

    expect(screen.getByText("Day policy information could not be loaded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("submits the block form with the current published version", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useCreateV2DayModalityBlockMock.mockReturnValue({ isPending: false, mutateAsync });
    useV2DayManagementContextMock.mockReturnValue({ data: { ...context, policy: { ...context.policy, draft: null } }, isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();
    expect(screen.getByText("Existing bookings are not cancelled or rescheduled by day policy rules.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    expect(screen.getByRole("alert").textContent).toContain("Reason");
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Scanner maintenance" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ policySetKey: "default", modalityId: 1, date: "2026-05-20", expectedPublishedVersionId: 1, reason: "Scanner maintenance", isOverridable: false });
    expect(screen.getByText("Existing bookings are not cancelled or rescheduled by day policy rules.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.click(screen.getByLabelText("Allow supervisor override"));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Scanner maintenance with override" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenLastCalledWith({ policySetKey: "default", modalityId: 1, date: "2026-05-20", expectedPublishedVersionId: 1, reason: "Scanner maintenance with override", isOverridable: true });
  });

  it("validates exam selection and submits an exact hard restriction payload", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useCreateV2DayExamRestrictionMock.mockReturnValue({ isPending: false, mutateAsync });
    useV2DayManagementContextMock.mockReturnValue({ data: { ...context, policy: { ...context.policy, draft: null } }, isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    expect(screen.getByRole("checkbox", { name: "CT Head" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "MR Spine" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Restriction validation" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply restriction" }));
    expect(screen.getByRole("alert").textContent).toContain("Select at least one exam type.");
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "CT Head" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("hard_restriction");
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Contrast safety restriction" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply restriction" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ policySetKey: "default", modalityId: 1, date: "2026-05-20", expectedPublishedVersionId: 1, examTypeIds: [3], effectMode: "hard_restriction", reason: "Contrast safety restriction" });
  });

  it("submits the supervisor-overridable exam restriction effect mode", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useCreateV2DayExamRestrictionMock.mockReturnValue({ isPending: false, mutateAsync });
    useV2DayManagementContextMock.mockReturnValue({ data: { ...context, policy: { ...context.policy, draft: null } }, isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "MR Spine" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "restriction_overridable" } });
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Supervisor review restriction" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply restriction" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ policySetKey: "default", modalityId: 1, date: "2026-05-20", expectedPublishedVersionId: 1, examTypeIds: [4], effectMode: "restriction_overridable", reason: "Supervisor review restriction" });
  });

  it("validates exam-mix quota inputs and submits an exact payload", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useCreateV2DayExamMixQuotaMock.mockReturnValue({ isPending: false, mutateAsync });
    useV2DayManagementContextMock.mockReturnValue({ data: { ...context, policy: { ...context.policy, draft: null } }, isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Set exam-mix quota" }));
    expect(screen.getByRole("checkbox", { name: "CT Head" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "MR Spine" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Quota validation" } });
    fireEvent.click(screen.getByRole("button", { name: "Set quota" }));
    expect(screen.getByRole("alert").textContent).toContain("Select at least one exam type.");
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "MR Spine" }));
    const dailyLimit = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(dailyLimit.getAttribute("min")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Set quota" }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.change(dailyLimit, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Set quota" }));
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(dailyLimit, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Set quota" }));
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(dailyLimit, { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Set quota" }));
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(dailyLimit, { target: { value: "26" } });
    fireEvent.click(screen.getByRole("button", { name: "Set quota" }));
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(dailyLimit, { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Exam mix capacity limit" } });
    fireEvent.click(screen.getByRole("button", { name: "Set quota" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ policySetKey: "default", modalityId: 1, date: "2026-05-20", expectedPublishedVersionId: 1, examTypeIds: [4], dailyLimit: 10, reason: "Exam mix capacity limit" });
  });
});
