import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { LanguageProvider } from "@/providers/language-provider-component";
import { AppointmentManageModal } from "./appointment-manage-modal";

const mocks = vi.hoisted(() => ({
  getAppointmentById: vi.fn(),
  fetchAppointmentLookups: vi.fn(),
  fetchPatientDirectorySummary: vi.fn(),
  fetchPublicAppointmentReportStatus: vi.fn(),
  updateAppointmentStatus: vi.fn(),
}));

vi.mock("@/lib/api-hooks", () => ({
  cancelAppointment: vi.fn(),
  fetchAppointmentLookups: (...args: unknown[]) => mocks.fetchAppointmentLookups(...args),
  fetchPatientDirectorySummary: (...args: unknown[]) => mocks.fetchPatientDirectorySummary(...args),
  fetchPublicAppointmentReportStatus: (...args: unknown[]) => mocks.fetchPublicAppointmentReportStatus(...args),
  fetchPublicSchedulingCapacitySettings: vi.fn(async () => ({
    allow_reception_override_requests_from_availability: "enabled",
    can_request_scheduling_override: "enabled",
  })),
  getAppointmentById: (...args: unknown[]) => mocks.getAppointmentById(...args),
  updateAppointmentStatus: (...args: unknown[]) => mocks.updateAppointmentStatus(...args),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 1, role: "super_admin" } }),
}));

vi.mock("@/v2/appointments/api", () => ({
  useV2Availability: () => ({ data: { items: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useV2ExamTypes: () => ({ data: [], isLoading: false }),
  useV2SpecialReasonCodes: () => ({ data: [] }),
  useCreateSchedulingOverrideRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/components/appointments/appointment-editor", () => ({
  AppointmentEditor: ({ appointment, editing, onUpdated }: { appointment: AppointmentWithDetails; editing?: boolean; onUpdated?: (value: AppointmentWithDetails) => void }) => editing ? (
    <div data-testid="appointment-editor">
      <span>{appointment.englishFullName}</span>
      <button type="button" onClick={() => onUpdated?.({ ...appointment, englishFullName: "Updated Patient", accessionNumber: "ACC-UPDATED" })}>Update appointment</button>
    </div>
  ) : null,
}));

vi.mock("@/components/documents/request-documents-panel", () => ({
  RequestDocumentsPanel: ({ appointmentId, patientId, previewMode, expanded, onExpandedChange }: { appointmentId: number; patientId: number; previewMode?: string; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void }) => (
    <div data-testid="request-documents-panel" data-appointment-id={appointmentId} data-patient-id={patientId} data-preview-mode={previewMode} data-expanded={expanded ? "true" : "false"}>
      Request documents content
      <button type="button" onClick={() => onExpandedChange?.(!expanded)}>{expanded ? "Exit expanded review" : "Expand review"}</button>
    </div>
  ),
}));

vi.mock("@/components/patients/patient-drawer", () => ({
  PatientDrawer: ({ patientId }: { patientId: number }) => <div data-testid="patient-drawer">Patient {patientId}</div>,
}));

vi.mock("@/lib/appointment-printing", () => ({ printAppointmentSlipById: vi.fn() }));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));

const appointment = {
  id: 42,
  modalityId: 1,
  examTypeId: 3,
  accessionNumber: "ACC-42",
  dailySequence: 1,
  patientId: 7,
  caseCategory: "non_oncology",
  arabicFullName: "المريض",
  englishFullName: "Test Patient",
  nationalId: null,
  mrn: "MRN-42",
  ageYears: 40,
  sex: "F",
  phone1: null,
  modalityNameAr: "التصوير المقطعي",
  modalityNameEn: "CT",
  modalityCode: "CT",
  modalityGeneralInstructionAr: null,
  modalityGeneralInstructionEn: null,
  examNameAr: "الرأس",
  examNameEn: "Head",
  examSpecificInstructionAr: null,
  examSpecificInstructionEn: null,
  priorityNameAr: null,
  priorityNameEn: null,
  modalitySlotNumber: null,
  appointmentDate: "2026-07-26",
  appointmentTime: null,
  status: "scheduled",
  isWalkIn: false,
  notes: null,
  createdAt: "2026-07-25T08:00:00Z",
  updatedAt: "2026-07-25T08:00:00Z",
  publicCancelToken: "report-token",
  publicAppointmentUrl: "https://rispro.test/public/appointment?t=report-token",
  protocolAssignmentSummary: null,
} as AppointmentWithDetails;

function renderModal(props: Partial<React.ComponentProps<typeof AppointmentManageModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <AppointmentManageModal appointmentId={42} open onClose={vi.fn()} {...props} />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem("rispro-language", "en");
  mocks.getAppointmentById.mockReset();
  mocks.getAppointmentById.mockResolvedValue(appointment);
  mocks.fetchAppointmentLookups.mockReset();
  mocks.fetchAppointmentLookups.mockResolvedValue({ modalities: [], priorities: [] });
  mocks.fetchPatientDirectorySummary.mockReset();
  mocks.fetchPatientDirectorySummary.mockResolvedValue({
    demographics: { id: 7, mrn: "MRN-42", arabicFullName: "Ø§Ù„Ù…Ø±ÙŠØ¶", englishFullName: "Test Patient", sex: "F", ageYears: 40, demographicsEstimated: false, dateOfBirth: "1986-01-01" },
    identifiers: { nationalId: "NAT-42", identifierType: "national_id", identifierValue: "NAT-42", items: [{ id: 1, typeCode: "national_id", value: "NAT-42", isPrimary: true }] },
    contact: { phone1: "0912345678", phone2: "0922222222", address: "Tripoli" },
    category: "non_oncology",
    registration: { createdAt: null, createdByUserId: null, createdByName: null, createdByUsername: null },
    warnings: { missingPhone: false, missingDob: false, missingSex: false, missingName: false, incompleteData: false, possibleDuplicate: false, duplicateReasons: [] },
    lastAppointment: null,
    nextAppointment: null,
    recentAppointments: [],
    noShow: { noShowCount: 0, bookingRestricted: false, lastNoShowAppointment: null, lastAuthorizationUser: null, lastAuthorizationDate: null, lastAuthorizationReason: null },
  });
  mocks.fetchPublicAppointmentReportStatus.mockReset();
  mocks.fetchPublicAppointmentReportStatus.mockResolvedValue({ enabled: true, state: "final", canViewReport: true, message: "Report is ready.", checkButtonLabel: "Check report status", viewButtonLabel: "Open report" });
  mocks.updateAppointmentStatus.mockReset();
  mocks.updateAppointmentStatus.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("rispro-language");
  vi.restoreAllMocks();
});

describe("AppointmentManageModal", () => {
  it("loads using an appointment ID and shows a loading state", async () => {
    let resolveAppointment!: (value: AppointmentWithDetails) => void;
    mocks.getAppointmentById.mockReturnValue(new Promise((resolve) => { resolveAppointment = resolve; }));
    renderModal();

    expect((await screen.findByRole("status")).textContent).toContain("Loading appointment...");
    expect(mocks.getAppointmentById).toHaveBeenCalledWith(42);
    resolveAppointment(appointment);
    expect((await screen.findAllByText("ACC-42")).length).toBeGreaterThan(0);
  });

  it("shows a localized load error", async () => {
    mocks.getAppointmentById.mockRejectedValue(new Error("Appointment unavailable"));
    renderModal();

    expect((await screen.findByRole("alert")).textContent).toContain("Could not load the appointment.");
    expect(screen.getByText("Appointment unavailable")).toBeTruthy();
  });

  it("shows an invalid-reference state without requesting an appointment", async () => {
    renderModal({ appointmentId: "V2-000009" as unknown as number });

    expect((await screen.findByRole("alert")).textContent).toContain("The appointment reference is invalid or unavailable.");
    expect(mocks.getAppointmentById).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("renders appointment details, opens the initial tab, and passes document IDs", async () => {
    renderModal({ initialTab: "documents" });
    const dialog = await screen.findByRole("dialog", { name: "Manage" });
    await screen.findAllByText("ACC-42");

    expect((screen.getAllByText("Test Patient")).length).toBeGreaterThan(0);
    expect((screen.getAllByText("ACC-42")).length).toBeGreaterThan(0);
    expect((screen.getAllByText(/CT/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Head").length).toBeGreaterThan(0);
    expect(screen.getByText(/26\/07\/2026/)).toBeTruthy();
    expect(screen.getAllByText("Scheduled").length).toBeGreaterThan(0);
    expect(screen.getByTestId("compact-document-appointment-header")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Patient profile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" })).toBeTruthy();
    expect(screen.queryByText("Protocol: Not protocolled")).toBeNull();
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-appointment-id")).toBe("42");
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-patient-id")).toBe("7");
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-preview-mode")).toBe("inline");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("opens the Information page with both populated sections", async () => {
    renderModal({ initialTab: "details" });

    expect(await screen.findByRole("heading", { name: "Patient details" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Appointment details" })).toBeTruthy();
    expect((await screen.findAllByText("NAT-42")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("compact-document-appointment-header")).toBeTruthy();
    expect(screen.queryByTestId("appointment-editor")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("prioritizes formatted appointment and patient identity information", async () => {
    renderModal({ initialTab: "details" });

    await screen.findAllByText("NAT-42");
    expect(screen.getAllByText("Scheduled").length).toBeGreaterThan(0);
    expect(screen.getByText("Not required")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Patient details" }).parentElement?.parentElement?.textContent).toContain("Female");
    expect(screen.queryByText(/^F$/)).toBeNull();
    expect(screen.getByText("Time not assigned")).toBeTruthy();
    expect(screen.queryByLabelText("Appointment summary")).toBeNull();
    expect(screen.getByRole("heading", { name: "Examination" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Schedule and workflow" })).toBeTruthy();
    const demographics = screen.getByText("More demographics").closest("details");
    expect(demographics?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("More demographics"));
    expect(demographics?.hasAttribute("open")).toBe(true);
    expect(demographics?.textContent).toContain("01/01/1986");
  });

  it("opens status in a compact dialog without replacing the Documents workspace", async () => {
    renderModal({ initialTab: "documents" });
    await screen.findByTestId("request-documents-panel");

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change status" }));

    expect(screen.getByRole("heading", { name: "Change appointment status" })).toBeTruthy();
    expect(screen.getByTestId("request-documents-panel")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByLabelText("New status")).toBeTruthy();
  });

  it("canonicalizes a legacy status deep link and opens the dialog over Documents", async () => {
    const onTabChange = vi.fn();
    renderModal({ initialTab: "status", onTabChange });

    expect(await screen.findByRole("heading", { name: "Change appointment status" })).toBeTruthy();
    expect(screen.getByTestId("request-documents-panel")).toBeTruthy();
    expect(onTabChange).toHaveBeenCalledWith("documents");
  });

  it("requires a reason for reopening a completed appointment and preserves dialog input on failure", async () => {
    const completedAppointment = { ...appointment, status: "completed" as const };
    mocks.getAppointmentById.mockResolvedValueOnce(completedAppointment);
    mocks.updateAppointmentStatus.mockRejectedValueOnce(new Error("Status correction rejected"));
    renderModal({ initialTab: "documents" });
    await screen.findByTestId("request-documents-panel");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change status" }));
    fireEvent.change(screen.getByLabelText("New status"), { target: { value: "arrived" } });
    expect(screen.getByLabelText("Reason")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save status" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Correction requested by supervisor" } });
    expect(save).toHaveProperty("disabled", false);
    fireEvent.click(save);
    expect((await screen.findByRole("alert")).textContent).toContain("Status correction rejected");
    expect(screen.getByDisplayValue("Correction requested by supervisor")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Change appointment status" })).toBeTruthy();
  });

  it("updates the visible status and closes the compact dialog after a successful mutation", async () => {
    const updatedAppointment = { ...appointment, status: "completed" as const };
    mocks.getAppointmentById.mockResolvedValueOnce(appointment).mockResolvedValueOnce(updatedAppointment);
    renderModal({ initialTab: "documents" });
    await screen.findByTestId("request-documents-panel");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change status" }));
    fireEvent.change(screen.getByLabelText("New status"), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Change appointment status" })).toBeNull());
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(mocks.updateAppointmentStatus).toHaveBeenCalledWith(42, "completed", null);
  });

  it("closes only the status dialog on Escape", async () => {
    renderModal({ initialTab: "details" });
    await screen.findByRole("heading", { name: "Appointment details" });
    fireEvent.click(screen.getByRole("button", { name: "Change status" }));
    expect(screen.getByRole("heading", { name: "Change appointment status" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("heading", { name: "Change appointment status" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Appointment details" })).toBeTruthy();
  });

  it("does not expose ordinary reschedule or cancellation actions for completed appointments", async () => {
    mocks.getAppointmentById.mockResolvedValueOnce({ ...appointment, status: "completed" as const });
    renderModal({ initialTab: "details" });
    await screen.findByRole("heading", { name: "Appointment details" });
    expect(screen.queryByRole("button", { name: "Reschedule" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Reschedule" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Cancel appointment" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Change status" })).toBeTruthy();
  });

  it("enters and exits expanded document review with compact identity and close controls intact", async () => {
    renderModal({ initialTab: "documents" });
    await screen.findByTestId("request-documents-panel");

    fireEvent.click(screen.getByRole("button", { name: "Expand review" }));

    expect(screen.getByTestId("request-documents-panel").getAttribute("data-expanded")).toBe("true");
    expect(screen.getByTestId("compact-document-appointment-header")).toBeTruthy();
    expect((screen.getAllByText("Test Patient")).length).toBeGreaterThan(0);
    expect((screen.getAllByText("ACC-42")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Exit expanded review" }));

    expect(screen.getByTestId("request-documents-panel").getAttribute("data-expanded")).toBe("false");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("opens the More actions menu and refreshes displayed appointment data after an edit", async () => {
    renderModal({ initialTab: "details" });
    await screen.findByRole("heading", { name: "Appointment details" });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Change status" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Information" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Update appointment" }));
    expect((await screen.findAllByText("Updated Patient")).length).toBeGreaterThan(0);
    expect((screen.getAllByText("ACC-UPDATED")).length).toBeGreaterThan(0);
  });

  it("renders the authorized Void action only inside the separated More menu", async () => {
    renderModal({ initialTab: "details" });
    await screen.findByRole("heading", { name: "Appointment details" });
    expect(screen.queryByRole("button", { name: "Void appointment" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Void appointment" })).toBeTruthy();
    expect(screen.getByRole("menu").parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("menuitem", { name: "Void appointment" }));
    expect(screen.getByRole("heading", { name: "Void appointment" })).toBeTruthy();
    expect(screen.getByLabelText(/void reason/i)).toBeTruthy();
  });

  it("closes from the close button and Escape", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await screen.findAllByText("ACC-42");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockReset();
    renderModal({ onClose });
    await screen.findAllByText("ACC-42");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("uses RTL layout for Arabic", async () => {
    localStorage.setItem("rispro-language", "ar");
    renderModal();
    const dialog = await screen.findByRole("dialog", { name: "إدارة" });
    expect(dialog.getAttribute("dir")).toBe("rtl");
  });

  it("remains usable when the appointment ID changes", async () => {
    const { rerender } = renderModal();
    await screen.findAllByText("ACC-42");
    const secondAppointment = { ...appointment, id: 99, accessionNumber: "ACC-99", englishFullName: "Second Patient" };
    mocks.getAppointmentById.mockResolvedValueOnce(secondAppointment);
    rerender(
      <LanguageProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AppointmentManageModal appointmentId={99} open onClose={vi.fn()} />
        </QueryClientProvider>
      </LanguageProvider>,
    );
    expect((await screen.findAllByText("ACC-99")).length).toBeGreaterThan(0);
    expect((screen.getAllByText("Second Patient")).length).toBeGreaterThan(0);
  });

  it("loads when the appointment ID arrives as a numeric string", async () => {
    renderModal({ appointmentId: "42" as unknown as number });

    expect((await screen.findAllByText("ACC-42")).length).toBeGreaterThan(0);
    expect(mocks.getAppointmentById).toHaveBeenCalledWith(42);
  });
});
