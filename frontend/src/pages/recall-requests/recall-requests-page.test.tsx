import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComplementaryRecall } from "@/lib/api/complementary-recalls";
import RecallRequestsPage from "./recall-requests-page";

const { mockFetchRecalls, mockFetchDoctorRecalls, mockUpdateRecall, mockAcknowledge, mockRecordContact, mockMarkSeen } = vi.hoisted(() => ({ mockFetchRecalls: vi.fn(), mockFetchDoctorRecalls: vi.fn(), mockUpdateRecall: vi.fn(), mockAcknowledge: vi.fn(), mockRecordContact: vi.fn(), mockMarkSeen: vi.fn() }));
const languageState = vi.hoisted(() => ({ value: "en" as "en" | "ar" }));

vi.mock("@/lib/api/complementary-recalls", () => ({
  fetchComplementaryRecalls: mockFetchRecalls,
  acknowledgeComplementaryRecall: mockAcknowledge,
  recordComplementaryRecallContactAttempt: mockRecordContact,
  withdrawComplementaryRecall: vi.fn(),
}));
vi.mock("@/lib/api/doctor-portal-reporting", () => ({
  fetchDoctorComplementaryRecalls: mockFetchDoctorRecalls,
  updateDoctorComplementaryRecallInstructions: mockUpdateRecall,
  withdrawComplementaryRecallRequest: vi.fn(),
}));
vi.mock("@/lib/api-hooks", () => ({ markComplementaryRecallsSeen: mockMarkSeen }));
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: { role: "doctor" } }) }));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: languageState.value, isArabic: languageState.value === "ar" }) }));
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
  patientPhone1: "0912345678",
  patientPhone2: "0923456789",
  contactAttempts: [],
};
const acknowledgedRecall: ComplementaryRecall = { ...recall, receptionSeenAt: "2039-06-15T08:30:00.000Z", receptionAcknowledgedAt: "2039-06-15T08:30:00.000Z", receptionAcknowledgedByUserId: 7, receptionAcknowledgedByDisplayName: "Reception One" };
const contactedRecall: ComplementaryRecall = { ...recall, receptionSeenAt: "2026-09-01T08:30:00.000Z", receptionAcknowledgedAt: "2026-09-01T08:30:00.000Z", receptionAcknowledgedByUserId: 7, receptionAcknowledgedByDisplayName: "Reception One", contactAttempts: [{ id: 1, recallRequestId: 42, contactMethod: "phone", contactValue: "0912345678", outcome: "no_answer", note: "Left callback request", followUpAt: "2026-09-01T08:30:00.000Z", recordedByUserId: 7, recordedByDisplayName: "Reception One", createdAt: "2026-09-01T08:30:00.000Z" }] };
const secondRecall: ComplementaryRecall = { ...recall, id: 43, originalAppointmentId: 10, patientDisplayName: "Patient B", patientEnglishName: "Patient B", patientMrn: "MRN-43", originalAccession: "V2-000010", patientPhone1: "0934567890", patientPhone2: null, contactAttempts: [{ id: 2, recallRequestId: 43, contactMethod: "whatsapp", contactValue: "0934567890", outcome: "reached_agreed", note: null, followUpAt: null, recordedByUserId: 8, recordedByDisplayName: "Reception Two", createdAt: "2026-09-01T09:30:00.000Z" }] };

function renderPage(mode: "reception" | "doctor") {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><RecallRequestsPage mode={mode} /></QueryClientProvider></MemoryRouter>);
}

describe("Recall Requests metadata", () => {
  beforeEach(() => {
    languageState.value = "en";
    mockFetchRecalls.mockReset();
    mockFetchDoctorRecalls.mockReset();
    mockUpdateRecall.mockReset();
    mockAcknowledge.mockReset();
    mockRecordContact.mockReset();
    mockMarkSeen.mockReset();
    mockFetchRecalls.mockResolvedValue([recall]);
    mockFetchDoctorRecalls.mockResolvedValue([recall]);
    mockUpdateRecall.mockResolvedValue(recall);
    mockAcknowledge.mockResolvedValue(acknowledgedRecall);
    mockRecordContact.mockResolvedValue(contactedRecall.contactAttempts[0]);
  });

  it("shows live patient phones, empty contact state, and the reception action", async () => {
    renderPage("reception");

    expect(await screen.findByText("Phone 1:")).toBeTruthy();
    expect(screen.getByText("0912345678")).toBeTruthy();
    expect(screen.getByText("0923456789")).toBeTruthy();
    expect(screen.getByText("Not contacted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record contact attempt" })).toBeTruthy();
  });

  it("keeps each contact workflow inside its recall article", async () => {
    mockFetchRecalls.mockResolvedValue([recall, secondRecall]);
    renderPage("reception");

    const articles = await screen.findAllByRole("article");
    const articleA = articles.find((article) => within(article).queryByText("Recall Patient"));
    const articleB = articles.find((article) => within(article).queryByText("Patient B"));
    expect(articleA).toBeTruthy();
    expect(articleB).toBeTruthy();
    expect(within(articleA as HTMLElement).getByText("Not contacted")).toBeTruthy();
    expect(within(articleA as HTMLElement).getByRole("button", { name: "Record contact attempt" })).toBeTruthy();
    expect(within(articleA as HTMLElement).queryByText("Reached / agreed")).toBeNull();
    expect(within(articleB as HTMLElement).getAllByText((_, element) => Boolean(element?.textContent?.includes("Last contact: Reached / agreed"))).length).toBeGreaterThan(0);
    expect(within(articleB as HTMLElement).getAllByText("0934567890").length).toBeGreaterThan(0);
    expect(within(articleB as HTMLElement).getByText("Contact history (1)")).toBeTruthy();
    expect(screen.getAllByText("Patient contact").every((node) => node.closest("article"))).toBe(true);
  });

  it("renders AR-06 contact labels in Arabic without mojibake", async () => {
    languageState.value = "ar";
    renderPage("reception");

    expect(await screen.findByText("تواصل المريض")).toBeTruthy();
    expect(screen.getByText("لم يتم التواصل")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "تسجيل محاولة تواصل" }));
    expect(screen.getByText("طريقة التواصل")).toBeTruthy();
    expect(screen.getByText("النتيجة")).toBeTruthy();
    expect(screen.getByRole("option", { name: "هاتف" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "لم يرد" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "تسجيل" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "إلغاء" })).toBeTruthy();
    const renderedText = document.body.textContent ?? "";
    expect(renderedText).not.toContain("Â·");
    expect(renderedText).not.toContain("Savingâ€¦");
  });

  it("records a phone contact with the manual value and Tripoli follow-up instant", async () => {
    mockFetchRecalls.mockReset();
    mockFetchRecalls.mockResolvedValueOnce([recall]).mockResolvedValue([contactedRecall]);
    renderPage("reception");
    await userEvent.click(await screen.findByRole("button", { name: "Record contact attempt" }));
    expect(screen.getByLabelText("Contact method")).toBeTruthy();
    expect(screen.getByLabelText("Contact used")).toBeTruthy();
    expect(screen.getByLabelText("Outcome")).toBeTruthy();
    expect(screen.getByLabelText("Follow-up date/time")).toBeTruthy();
    expect(screen.getByLabelText("Note")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Contact used"), "0987654321");
    await userEvent.type(screen.getByLabelText("Follow-up date/time"), "2026-09-01T10:30");
    await userEvent.click(screen.getByRole("button", { name: "Record attempt" }));

    await waitFor(() => expect(mockRecordContact).toHaveBeenCalledWith(42, { contactMethod: "phone", contactValue: "0987654321", outcome: "no_answer", note: null, followUpAt: "2026-09-01T08:30:00.000Z" }));
    await waitFor(() => expect(mockFetchRecalls.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("shows contact history read-only for doctors and renders newest contact details", async () => {
    mockFetchDoctorRecalls.mockResolvedValue([contactedRecall]);
    renderPage("doctor");

    expect((await screen.findAllByText((_, element) => Boolean(element?.textContent?.includes("Last contact: No answer")))).length).toBeGreaterThan(0);
    expect(screen.getAllByText((content) => content.includes("No answer")).length).toBeGreaterThan(0);
    expect(screen.getByText("Contact history (1)")).toBeTruthy();
    await userEvent.click(screen.getByText("Contact history (1)"));
    expect(screen.getByText("0912345678")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record contact attempt" })).toBeNull();
  });

  it("renders structured metadata for reception", async () => {
    renderPage("reception");

    expect(await screen.findByText("Missing sequence or phase")).toBeTruthy();
    expect(screen.getByText("Acquisition error")).toBeTruthy();
    expect(screen.getByText("Within 24 hours")).toBeTruthy();
    expect(screen.getByText("Separate report")).toBeTruthy();
    expect(screen.queryByText("Due date/time:")).toBeNull();
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

  it("shows computed operational attention, filters across statuses, and keeps it read-only for doctors", async () => {
    const overdue = { ...recall, id: 50, patientDisplayName: "Overdue patient", patientEnglishName: "Overdue patient", effectiveDueAt: "2026-08-31T08:00:00.000Z", latestFollowUpAt: "2026-08-31T09:00:00.000Z", isOverdue: true, isFollowUpDue: true, dueAt: null };
    const dueToday = { ...recall, id: 51, patientDisplayName: "Today patient", patientEnglishName: "Today patient", effectiveDueAt: "2026-09-01T12:00:00.000Z", isDueToday: true, dueAt: null };
    const scheduledLate = { ...recall, id: 52, patientDisplayName: "Scheduled late patient", patientEnglishName: "Scheduled late patient", status: "scheduled" as const, recallAppointmentId: 99, effectiveDueAt: "2026-09-02T08:00:00.000Z", recallAppointmentDate: "2026-09-03", recallAppointmentTime: "10:00:00", recallAppointmentStartsAt: "2026-09-03T08:00:00.000Z", isOverdue: true, isScheduledAfterTarget: true };
    mockFetchRecalls.mockResolvedValue([recall, dueToday, scheduledLate, overdue]);
    mockFetchDoctorRecalls.mockResolvedValue([overdue]);
    renderPage("reception");

    expect(await screen.findByText("Overdue patient")).toBeTruthy();
    expect((await screen.findAllByRole("button", { name: /Needs booking/ })).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Due today/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Overdue/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Follow-up due/ })).toBeTruthy();
    expect(screen.getByText(/^OVERDUE/)).toBeTruthy();
    expect(screen.getByText(/^FOLLOW-UP DUE/)).toBeTruthy();
    expect(screen.getAllByText("Target:").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /Overdue/ }));
    expect(screen.getByText("Overdue patient")).toBeTruthy();
    expect(screen.getByText("Scheduled late patient")).toBeTruthy();
    expect(screen.getByText("SCHEDULED AFTER TARGET")).toBeTruthy();
    expect(screen.getByText(/Appointment: 03\/09\/2026, 10:00/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Due today/ }));
    expect(screen.getByText("Today patient")).toBeTruthy();
    expect(screen.queryByText("Overdue patient")).toBeNull();

  });

  it("shows operational attention read-only for doctors", async () => {
    const doctorOverdue = { ...recall, effectiveDueAt: "2026-08-31T08:00:00.000Z", isOverdue: true, isFollowUpDue: true };
    mockFetchDoctorRecalls.mockResolvedValue([doctorOverdue]);
    renderPage("doctor");

    expect(await screen.findByText(/^OVERDUE/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record contact attempt" })).toBeNull();
  });
});
