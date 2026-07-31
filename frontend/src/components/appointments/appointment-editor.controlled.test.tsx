import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { LanguageProvider } from "@/providers/language-provider-component";
import { AppointmentEditor } from "./appointment-editor";

const updateAppointmentMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  updateAppointment: (...args: unknown[]) => updateAppointmentMock(...args),
}));

vi.mock("@/v2/appointments/api", () => ({
  useV2ExamTypes: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));

const appointment = {
  id: 42,
  patientId: 7,
  modalityId: 1,
  examTypeId: 3,
  reportingPriorityId: 2,
  accessionNumber: "ACC-42",
  appointmentDate: "2026-07-26",
  dailySequence: 1,
  status: "scheduled",
  arabicFullName: "Ø§Ù„Ù…Ø±ÙŠØ¶",
  englishFullName: "Test Patient",
  nationalId: null,
  mrn: "MRN-42",
  ageYears: 40,
  sex: "F",
  phone1: null,
  modalityNameAr: "CT",
  modalityNameEn: "CT",
  modalityCode: "CT",
  modalityGeneralInstructionAr: null,
  modalityGeneralInstructionEn: null,
  examNameAr: "Head",
  examNameEn: "Head",
  examSpecificInstructionAr: null,
  examSpecificInstructionEn: null,
  priorityNameAr: "عاجل",
  priorityNameEn: "Urgent",
  modalitySlotNumber: null,
  requiresReport: true,
  notes: "Original note",
} as AppointmentWithDetails;

function renderEditor(props: Partial<React.ComponentProps<typeof AppointmentEditor>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <AppointmentEditor appointment={appointment} lookups={{ modalities: [], examTypes: [], priorities: [{ id: 2, code: "urgent", nameAr: "عاجل", nameEn: "Urgent", sortOrder: 1 }], specialReasons: [] }} {...props} />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem("rispro-language", "en");
  updateAppointmentMock.mockReset();
  updateAppointmentMock.mockResolvedValue({ ...appointment, notes: "Saved note" });
});

describe("AppointmentEditor controlled mode", () => {
  it("renders the edit form only when controlled editing is enabled and never exposes void in the normal footer", async () => {
    renderEditor({ editing: true });

    expect(screen.getByLabelText("Notes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Void appointment" })).toBeNull();
    expect(screen.queryByText(/prompt|confirm/i)).toBeNull();
  });

  it("calls the safe generic update payload and reports the updated appointment", async () => {
    const onUpdated = vi.fn();
    renderEditor({ editing: true, onUpdated });

    await userEvent.clear(screen.getByLabelText("Notes"));
    await userEvent.type(screen.getByLabelText("Notes"), "Saved note");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateAppointmentMock).toHaveBeenCalledWith(42, expect.objectContaining({
      examTypeId: 3,
      reportingPriorityId: 2,
      requiresReport: true,
      notes: "Saved note",
    }));
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Saved note");
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ notes: "Saved note" }));
  });

  it("returns through the controlled cancel callback without changing appointment data", async () => {
    const onCancel = vi.fn();
    renderEditor({ editing: true, onCancel });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(updateAppointmentMock).not.toHaveBeenCalled();
  });
});
