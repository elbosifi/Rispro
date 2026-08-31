import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComplementaryRecall } from "@/lib/api/complementary-recalls";
import RecallRequestsPage from "./recall-requests-page";

const { mockFetchRecalls, mockFetchDoctorRecalls, mockUpdateRecall, mockAcknowledge, mockMarkSeen } = vi.hoisted(() => ({ mockFetchRecalls: vi.fn(), mockFetchDoctorRecalls: vi.fn(), mockUpdateRecall: vi.fn(), mockAcknowledge: vi.fn(), mockMarkSeen: vi.fn() }));

vi.mock("@/lib/api/complementary-recalls", () => ({
  fetchComplementaryRecalls: mockFetchRecalls,
  acknowledgeComplementaryRecall: mockAcknowledge,
  withdrawComplementaryRecall: vi.fn(),
}));
vi.mock("@/lib/api/doctor-portal-reporting", () => ({
  fetchDoctorComplementaryRecalls: mockFetchDoctorRecalls,
  updateDoctorComplementaryRecallInstructions: mockUpdateRecall,
  withdrawComplementaryRecallRequest: vi.fn(),
}));
vi.mock("@/lib/api-hooks", () => ({ markComplementaryRecallsSeen: mockMarkSeen }));
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: { role: "doctor" } }) }));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en", isArabic: false }) }));
vi.mock("@/components/appointments/appointment-manage-modal", () => ({ AppointmentManageModal: () => null }));

const recall: ComplementaryRecall = {
  id: 42,
  originalAppointmentId: 9,
  recallAppointmentId: null,
  receptionInstruction: "Call the patient before booking.",
  technologistInstruction: "Repeat the delayed phase.",
  reasonCode: "missing_sequence_phase",
  qaClassification: "acquisition_error",
  urgency: "within_24_hours",
  dueAt: "2026-09-01T08:00:00.000Z",
  reportingDisposition: "separate_report",
  status: "pending_scheduling",
  requestedByUserId: 2,
  requestedAt: "2039-06-15T08:00:00.000Z",
  receptionSeenAt: null,
  receptionAcknowledgedAt: null,
  receptionAcknowledgedByUserId: null,
  scheduledAt: null,
  completedAt: null,
  cancelledAt: null,
  patientDisplayName: "Recall Patient",
  patientEnglishName: "Recall Patient",
  patientMrn: "MRN-42",
  originalAccession: "V2-000009",
  originalExam: "CT Chest",
  originalExamEn: "CT Chest",
  modalityCode: "CT",
  modalityName: "Computed tomography",
  modalityNameEn: "Computed tomography",
  requesterDisplayName: "Doctor One",
};
const acknowledgedRecall: ComplementaryRecall = { ...recall, receptionSeenAt: "2039-06-15T08:30:00.000Z", receptionAcknowledgedAt: "2039-06-15T08:30:00.000Z", receptionAcknowledgedByUserId: 7, receptionAcknowledgedByDisplayName: "Reception One" };

function renderPage(mode: "reception" | "doctor") {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><RecallRequestsPage mode={mode} /></QueryClientProvider></MemoryRouter>);
}

describe("Recall Requests metadata", () => {
  beforeEach(() => {
    mockFetchRecalls.mockReset();
    mockFetchDoctorRecalls.mockReset();
    mockUpdateRecall.mockReset();
    mockAcknowledge.mockReset();
    mockMarkSeen.mockReset();
    mockFetchRecalls.mockResolvedValue([recall]);
    mockFetchDoctorRecalls.mockResolvedValue([recall]);
    mockUpdateRecall.mockResolvedValue(recall);
    mockAcknowledge.mockResolvedValue(acknowledgedRecall);
  });

  it("renders structured metadata for reception", async () => {
    renderPage("reception");

    expect(await screen.findByText("Missing sequence or phase")).toBeTruthy();
    expect(screen.getByText("Acquisition error")).toBeTruthy();
    expect(screen.getByText("Within 24 hours")).toBeTruthy();
    expect(screen.getByText("Separate report")).toBeTruthy();
    expect(screen.getByText("Due date/time:")).toBeTruthy();
    await waitFor(() => expect(mockMarkSeen).toHaveBeenCalledWith([42]));
  });

  it("acknowledges pending reception requests and renders the acknowledgement", async () => {
    mockMarkSeen.mockImplementation(() => new Promise<void>(() => undefined));
    mockFetchRecalls.mockReset();
    mockFetchRecalls.mockResolvedValueOnce([recall]).mockResolvedValue([acknowledgedRecall]);
    renderPage("reception");

    await userEvent.click(await screen.findByRole("button", { name: "Acknowledge request" }));
    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledWith(42));
    expect(await screen.findByText(/Acknowledged.*Reception One/)).toBeTruthy();
    expect(screen.getByText(/10:30/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acknowledge request" })).toBeNull();
  });

  it("shows acknowledgement read-only in reception and doctor views", async () => {
    mockFetchRecalls.mockResolvedValue([acknowledgedRecall]);
    mockFetchDoctorRecalls.mockResolvedValue([acknowledgedRecall]);
    renderPage("reception");
    expect(await screen.findByText(/Acknowledged.*Reception One/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acknowledge request" })).toBeNull();

    renderPage("doctor");
    expect(await screen.findByText(/Acknowledged.*Reception One/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acknowledge request" })).toBeNull();
  });

  it("edits structured metadata only through the doctor request dialog", async () => {
    renderPage("doctor");

    await userEvent.click(await screen.findByRole("button", { name: "Edit request" }));
    expect((screen.getByLabelText("Recall reason") as HTMLSelectElement).value).toBe("missing_sequence_phase");
    expect((screen.getByLabelText("QA classification") as HTMLSelectElement).value).toBe("acquisition_error");
    expect((screen.getByLabelText("Urgency") as HTMLSelectElement).value).toBe("within_24_hours");
    expect((screen.getByLabelText("Reporting disposition") as HTMLSelectElement).value).toBe("separate_report");
    expect((screen.getByLabelText("Due date/time") as HTMLInputElement).value).toBe("2026-09-01T10:00");

    await userEvent.selectOptions(screen.getByLabelText("Recall reason"), "incorrect_protocol");
    await userEvent.selectOptions(screen.getByLabelText("QA classification"), "protocol_error");
    await userEvent.selectOptions(screen.getByLabelText("Urgency"), "same_day");
    await userEvent.selectOptions(screen.getByLabelText("Reporting disposition"), "no_separate_report");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdateRecall).toHaveBeenCalledWith(42, expect.objectContaining({
      receptionInstruction: "Call the patient before booking.",
      technologistInstruction: "Repeat the delayed phase.",
      reasonCode: "incorrect_protocol",
      qaClassification: "protocol_error",
      urgency: "same_day",
      dueAt: "2026-09-01T08:00:00.000Z",
      reportingDisposition: "no_separate_report",
    })));
  });
});
