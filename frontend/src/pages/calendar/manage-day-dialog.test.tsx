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

type DialogOptions = { open?: boolean; onClose?: () => void; modalityId?: number | null; modalityLabel?: string; date?: string; dateLabel?: string };

function dialogElement({ open = true, onClose = vi.fn(), modalityId = 1, modalityLabel = "CT", date = "2026-05-20", dateLabel = "Wednesday, May 20, 2026" }: DialogOptions = {}) {
  return <ManageDayDialog open={open} onClose={onClose} language="en" modalityId={modalityId} modalityLabel={modalityLabel} date={date} dateLabel={dateLabel} />;
}

function renderDialog(options: DialogOptions = {}) {
  return render(dialogElement(options));
}

function availableContext() {
  return { ...context, policy: { ...context.policy, draft: null } };
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
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Review and publish change")).toBeTruthy();
    expect(screen.getByText("Not allowed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ policySetKey: "default", modalityId: 1, date: "2026-05-20", expectedPublishedVersionId: 1, reason: "Scanner maintenance", isOverridable: false });
    expect(screen.getByText("Existing bookings are not cancelled or rescheduled by day policy rules.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.click(screen.getByLabelText("Allow supervisor override"));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Scanner maintenance with override" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    expect(screen.getByText("Allowed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));
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
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getAllByText("CT Head").length).toBeGreaterThan(1);
    expect(screen.getByText("Hard restriction")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));
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
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Supervisor-overridable restriction")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));
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
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getAllByText("7").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ policySetKey: "default", modalityId: 1, date: "2026-05-20", expectedPublishedVersionId: 1, examTypeIds: [4], dailyLimit: 10, reason: "Exam mix capacity limit" });
  });

  it("clears create state when closed and reopened", () => {
    const onClose = vi.fn();
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CT Head" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Temporary restriction" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "restriction_overridable" } });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(<ManageDayDialog open={false} onClose={onClose} language="en" modalityId={1} modalityLabel="CT" date="2026-05-20" dateLabel="Wednesday, May 20, 2026" />);
    view.rerender(<ManageDayDialog open onClose={onClose} language="en" modalityId={1} modalityLabel="CT" date="2026-05-20" dateLabel="Wednesday, May 20, 2026" />);
    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));

    expect((screen.getByRole("checkbox", { name: "CT Head" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("hard_restriction");
  });

  it("clears editor fields when switching create actions", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CT Head" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Temporary restriction" } });
    fireEvent.click(screen.getByRole("button", { name: "Set exam-mix quota" }));

    expect((screen.getByRole("checkbox", { name: "CT Head" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    expect((screen.getByRole("checkbox", { name: "Allow supervisor override" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("");
  });

  it("does not carry a create reason into removal", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "This reason must not carry" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    expect(screen.getByRole("button", { name: "Remove rule" })).toBeTruthy();
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("");
  });

  it("does not carry a removal reason into a create action", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Removal reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));

    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("");
  });

  it("clears the active editor when the selected date changes", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog({ date: "2030-01-10", dateLabel: "Thursday, January 10, 2030" });

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CT Head" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Date-specific restriction" } });
    view.rerender(<ManageDayDialog open onClose={vi.fn()} language="en" modalityId={1} modalityLabel="CT" date="2030-01-11" dateLabel="Friday, January 11, 2030" />);

    expect(screen.queryByRole("button", { name: "Apply restriction" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    expect((screen.getByRole("checkbox", { name: "CT Head" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("");
  });

  it("clears the active editor when the selected modality changes", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CT Head" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Modality-specific restriction" } });
    view.rerender(<ManageDayDialog open onClose={vi.fn()} language="en" modalityId={2} modalityLabel="MR" date="2026-05-20" dateLabel="Wednesday, May 20, 2026" />);

    expect(screen.queryByRole("button", { name: "Apply restriction" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    expect((screen.getByRole("checkbox", { name: "CT Head" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps success feedback after a mutation but clears it after reopening", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    const onClose = vi.fn();
    useCreateV2DayModalityBlockMock.mockReturnValue({ isPending: false, mutateAsync });
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Successful update" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status").textContent).toContain("Day-specific rule saved.");
    expect(screen.queryByRole("button", { name: "Block modality" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Block modality" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    view.rerender(<ManageDayDialog open={false} onClose={onClose} language="en" modalityId={1} modalityLabel="CT" date="2026-05-20" dateLabel="Wednesday, May 20, 2026" />);
    view.rerender(<ManageDayDialog open onClose={onClose} language="en" modalityId={1} modalityLabel="CT" date="2026-05-20" dateLabel="Wednesday, May 20, 2026" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears the current editor when cancelled", () => {
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CT Head" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Cancel this editor" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));

    expect((screen.getByRole("checkbox", { name: "CT Head" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("");
  });

  it("blocks close paths while a mutation is pending", () => {
    const onClose = vi.fn();
    const blockMutation = { isPending: false, mutateAsync: vi.fn() };
    useCreateV2DayModalityBlockMock.mockReturnValue(blockMutation);
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    blockMutation.isPending = true;
    view.rerender(dialogElement({ onClose }));

    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").firstElementChild!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks action and removal entry points while a mutation is pending", () => {
    const blockMutation = { isPending: false, mutateAsync: vi.fn() };
    useCreateV2DayModalityBlockMock.mockReturnValue(blockMutation);
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    blockMutation.isPending = true;
    view.rerender(dialogElement());

    const blockButtons = screen.getAllByRole("button", { name: "Block modality" });
    expect(blockButtons[0]!.getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Restrict exam types" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Set exam-mix quota" }).getAttribute("disabled")).not.toBeNull();
    screen.getAllByRole("button", { name: "Remove" }).forEach((button) => expect(button.getAttribute("disabled")).not.toBeNull());
    fireEvent.click(blockButtons[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    expect(screen.getByRole("checkbox", { name: "Allow supervisor override" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove rule" })).toBeNull();
  });

  it("freezes the block modality form while its mutation is pending", () => {
    const blockMutation = { isPending: false, mutateAsync: vi.fn() };
    useCreateV2DayModalityBlockMock.mockReturnValue(blockMutation);
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow supervisor override" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Block pending" } });
    blockMutation.isPending = true;
    view.rerender(dialogElement());

    expect(screen.getByRole("checkbox", { name: "Allow supervisor override" }).getAttribute("disabled")).not.toBeNull();
    expect((screen.getByRole("checkbox", { name: "Allow supervisor override" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByPlaceholderText("Enter a reason").getAttribute("disabled")).not.toBeNull();
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("Block pending");
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Block modality" })[1]!.getAttribute("disabled")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("checkbox", { name: "Allow supervisor override" })).toBeTruthy();
  });

  it("freezes the exam restriction form while its mutation is pending", () => {
    const restrictionMutation = { isPending: false, mutateAsync: vi.fn() };
    useCreateV2DayExamRestrictionMock.mockReturnValue(restrictionMutation);
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    restrictionMutation.isPending = true;
    view.rerender(dialogElement());

    screen.getAllByRole("checkbox").forEach((checkbox) => expect(checkbox.getAttribute("disabled")).not.toBeNull());
    expect(screen.getByRole("combobox").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByPlaceholderText("Enter a reason").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Apply restriction" }).getAttribute("disabled")).not.toBeNull();
  });

  it("freezes the exam-mix quota form while its mutation is pending", () => {
    const quotaMutation = { isPending: false, mutateAsync: vi.fn() };
    useCreateV2DayExamMixQuotaMock.mockReturnValue(quotaMutation);
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Set exam-mix quota" }));
    quotaMutation.isPending = true;
    view.rerender(dialogElement());

    screen.getAllByRole("checkbox").forEach((checkbox) => expect(checkbox.getAttribute("disabled")).not.toBeNull());
    expect(screen.getByRole("spinbutton").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByPlaceholderText("Enter a reason").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Set quota" }).getAttribute("disabled")).not.toBeNull();
  });

  it("freezes removal confirmation and keeps the dialog open while removal is pending", () => {
    const onClose = vi.fn();
    const removeMutation = { isPending: false, mutateAsync: vi.fn() };
    useRemoveV2DayManagementRuleMock.mockReturnValue(removeMutation);
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog({ onClose });

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Remove pending" } });
    removeMutation.isPending = true;
    view.rerender(dialogElement({ onClose }));

    expect(screen.getByPlaceholderText("Enter a reason").getAttribute("disabled")).not.toBeNull();
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("Remove pending");
    expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove rule" }).getAttribute("disabled")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not submit a second mutation while the first is pending", async () => {
    let resolveMutation: (() => void) | undefined;
    const blockMutation = { isPending: false, mutateAsync: vi.fn(() => new Promise<void>((resolve) => { resolveMutation = resolve; })) };
    useCreateV2DayModalityBlockMock.mockReturnValue(blockMutation);
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Submit once" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));
    await waitFor(() => expect(blockMutation.mutateAsync).toHaveBeenCalledTimes(1));
    blockMutation.isPending = true;
    view.rerender(dialogElement());
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));
    expect(blockMutation.mutateAsync).toHaveBeenCalledTimes(1);
    resolveMutation?.();
  });

  it("keeps a failed mutation in review and allows retry or editing", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("Request failed"));
    useCreateV2DayExamRestrictionMock.mockReturnValue({ isPending: false, mutateAsync });
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CT Head" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Keep this after failure" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply restriction" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish change" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Request failed"));
    expect(screen.getByText("Review and publish change")).toBeTruthy();
    expect(screen.getByText("Keep this after failure")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to edit" }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish change" }).getAttribute("disabled")).toBeNull();
  });

  it("reviews removal before publishing the exact existing removal payload", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useRemoveV2DayManagementRuleMock.mockReturnValue({ isPending: false, mutateAsync });
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Remove scanner maintenance" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove rule" }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Review and publish change")).toBeTruthy();
    expect(screen.getAllByText("Scanner maintenance").length).toBeGreaterThan(1);
    expect(screen.getByText("This change takes effect immediately for new booking decisions.")).toBeTruthy();
    expect(screen.getByText("Existing bookings are not cancelled or rescheduled.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove and publish" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ family: "block_modality", ruleId: 10, input: { policySetKey: "default", modalityId: 1, date: "2026-05-20", expectedPublishedVersionId: 1, reason: "Remove scanner maintenance" } }));
  });

  it("returns from review to the populated editor without mutating", () => {
    const mutateAsync = vi.fn();
    useCreateV2DayExamRestrictionMock.mockReturnValue({ isPending: false, mutateAsync });
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Restrict exam types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CT Head" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "restriction_overridable" } });
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Preserve this review" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply restriction" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox", { name: "CT Head" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("restriction_overridable");
    expect((screen.getByPlaceholderText("Enter a reason") as HTMLTextAreaElement).value).toBe("Preserve this review");
  });

  it("clears review state when closed or when its context changes", () => {
    const onClose = vi.fn();
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Close review state" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    expect(screen.getByText("Review and publish change")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(dialogElement({ open: false, onClose }));
    view.rerender(dialogElement({ onClose }));
    expect(screen.queryByText("Review and publish change")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Date review state" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    view.rerender(dialogElement({ onClose, date: "2026-05-21", dateLabel: "Thursday, May 21, 2026" }));
    expect(screen.queryByText("Review and publish change")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Modality review state" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    view.rerender(dialogElement({ onClose, modalityId: 2, modalityLabel: "MR", date: "2026-05-21", dateLabel: "Thursday, May 21, 2026" }));
    expect(screen.queryByText("Review and publish change")).toBeNull();
  });

  it("locks final review controls while publishing is pending", () => {
    const onClose = vi.fn();
    const blockMutation = { isPending: false, mutateAsync: vi.fn() };
    useCreateV2DayModalityBlockMock.mockReturnValue(blockMutation);
    useV2DayManagementContextMock.mockReturnValue({ data: availableContext(), isLoading: false, isError: false, refetch: vi.fn() });
    const view = renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Block modality" }));
    fireEvent.change(screen.getByPlaceholderText("Enter a reason"), { target: { value: "Pending review" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Block modality" })[1]!);
    blockMutation.isPending = true;
    view.rerender(dialogElement({ onClose }));

    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to edit" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Publish change" }).getAttribute("disabled")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
