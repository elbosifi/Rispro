import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AvailabilityRowViewModel } from "@/v2/appointments/hooks/useAppointmentAvailability";
import { LanguageProvider } from "@/providers/language-provider-component";
import { AppointmentManageModal } from "./appointment-manage-modal";

const mocks = vi.hoisted(() => ({
  getAppointmentById: vi.fn(),
  fetchAppointmentLookups: vi.fn(),
  fetchPatientDirectorySummary: vi.fn(),
  fetchPublicAppointmentReportStatus: vi.fn(),
  fetchPublicSchedulingCapacitySettings: vi.fn(),
  createSchedulingOverrideRequest: vi.fn(),
  deleteAppointment: vi.fn(),
  rescheduleV2Booking: vi.fn(),
  updateAppointmentStatus: vi.fn(),
  userRole: "super_admin" as "super_admin" | "supervisor" | "receptionist" | "doctor",
  availabilityRows: [] as AvailabilityRowViewModel[],
  availabilitySettings: "enabled" as "enabled" | "disabled",
}));

vi.mock("@/lib/api-hooks", () => ({
  cancelAppointment: vi.fn(),
  deleteAppointment: (...args: unknown[]) => mocks.deleteAppointment(...args),
  fetchAppointmentLookups: (...args: unknown[]) => mocks.fetchAppointmentLookups(...args),
  fetchPatientDirectorySummary: (...args: unknown[]) => mocks.fetchPatientDirectorySummary(...args),
  fetchPublicAppointmentReportStatus: (...args: unknown[]) => mocks.fetchPublicAppointmentReportStatus(...args),
  fetchPublicSchedulingCapacitySettings: (...args: unknown[]) => mocks.fetchPublicSchedulingCapacitySettings(...args),
  getAppointmentById: (...args: unknown[]) => mocks.getAppointmentById(...args),
  updateAppointmentStatus: (...args: unknown[]) => mocks.updateAppointmentStatus(...args),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 1, role: mocks.userRole } }),
}));

vi.mock("@/v2/appointments/api", () => ({
  useV2Availability: () => ({ data: { items: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useV2ExamTypes: () => ({ data: [], isLoading: false }),
  useV2SpecialReasonCodes: () => ({ data: [] }),
  useCreateSchedulingOverrideRequest: () => ({ mutateAsync: mocks.createSchedulingOverrideRequest, isPending: false }),
  rescheduleV2Booking: (...args: unknown[]) => mocks.rescheduleV2Booking(...args),
}));

vi.mock("@/v2/appointments/hooks/useAppointmentAvailability", () => ({
  useAppointmentAvailability: () => ({
    enabled: true,
    rows: mocks.availabilityRows,
    rawItems: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
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
  RequestDocumentsPanel: ({ appointmentId, patientId, previewMode, expanded, onExpandedChange, workspaceRailSize, compactMobileWorkspace, supplementaryPanelPlacement, pdfUtilityToolbarPlacement, pdfInitialSizingMode, hideSatisfiedProtocolEligibilityStatus, supplementaryPanel }: { appointmentId: number; patientId: number; previewMode?: string; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void; workspaceRailSize?: string; compactMobileWorkspace?: boolean; supplementaryPanelPlacement?: string; pdfUtilityToolbarPlacement?: string; pdfInitialSizingMode?: string; hideSatisfiedProtocolEligibilityStatus?: boolean; supplementaryPanel?: ReactNode }) => (
    <div data-testid="request-documents-panel" data-appointment-id={appointmentId} data-patient-id={patientId} data-preview-mode={previewMode} data-expanded={expanded ? "true" : "false"} data-workspace-rail-size={workspaceRailSize} data-compact-mobile-workspace={compactMobileWorkspace ? "true" : "false"} data-supplementary-panel-placement={supplementaryPanelPlacement} data-pdf-utility-toolbar-placement={pdfUtilityToolbarPlacement} data-pdf-initial-sizing-mode={pdfInitialSizingMode} data-hide-satisfied-protocol-eligibility-status={hideSatisfiedProtocolEligibilityStatus ? "true" : "false"}>
      Request documents content
      {supplementaryPanel}
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
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
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
  mocks.fetchPublicSchedulingCapacitySettings.mockReset();
  mocks.fetchPublicSchedulingCapacitySettings.mockImplementation(async () => ({
    allow_reception_override_requests_from_availability: mocks.availabilitySettings,
    can_request_scheduling_override: mocks.availabilitySettings,
  }));
  mocks.updateAppointmentStatus.mockReset();
  mocks.updateAppointmentStatus.mockResolvedValue(undefined);
  mocks.createSchedulingOverrideRequest.mockReset();
  mocks.createSchedulingOverrideRequest.mockResolvedValue({ request: { id: 1, status: "pending" } });
  mocks.deleteAppointment.mockReset();
  mocks.deleteAppointment.mockResolvedValue(undefined);
  mocks.rescheduleV2Booking.mockReset();
  mocks.rescheduleV2Booking.mockResolvedValue(undefined);
  mocks.userRole = "super_admin";
  mocks.availabilitySettings = "enabled";
  mocks.availabilityRows = [];
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("rispro-language");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("fetches appointment detail on first open while rendering the list appointment as a placeholder", async () => {
    let resolveAppointment!: (value: AppointmentWithDetails) => void;
    const detailAppointment = { ...appointment, englishFullName: "Fetched detail" };
    mocks.getAppointmentById.mockReturnValue(new Promise((resolve) => { resolveAppointment = resolve; }));

    renderModal({ initialAppointment: { ...appointment, englishFullName: "List placeholder" } });

    expect((await screen.findAllByText("List placeholder")).length).toBeGreaterThan(0);
    expect(mocks.getAppointmentById).toHaveBeenCalledWith(42);
    resolveAppointment(detailAppointment);
    expect((await screen.findAllByText("Fetched detail")).length).toBeGreaterThan(0);
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
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-workspace-rail-size")).toBe("wide");
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-compact-mobile-workspace")).toBe("true");
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-supplementary-panel-placement")).toBe("before-documents");
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-pdf-utility-toolbar-placement")).toBe("top");
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-pdf-initial-sizing-mode")).toBe("fit-width");
    expect(screen.getByTestId("request-documents-panel").getAttribute("data-hide-satisfied-protocol-eligibility-status")).toBe("true");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("opens a finalized report in a protected new tab without navigating the modal", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const currentHref = window.location.href;
    renderModal({ initialTab: "documents" });

    await userEvent.click(await screen.findByRole("button", { name: /Check report/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Open report" }));

    expect(openSpy).toHaveBeenCalledWith(
      "/api/public/appointments/report-open?t=report-token",
      "_blank",
      "noopener,noreferrer",
    );
    expect(window.location.href).toBe(currentHref);
    expect(screen.getByRole("dialog", { name: "Manage" })).toBeTruthy();
  });

  it("makes mobile Documents the modal scroll owner without constraining its wrapper", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderModal({ initialTab: "documents" });

    const panel = await screen.findByTestId("request-documents-panel");
    const middle = panel.closest("[aria-busy]") as HTMLElement;
    expect(middle.className).toContain("overflow-y-auto");
    expect(middle.className).not.toContain("overflow-hidden");
    expect(panel.parentElement?.className).not.toContain("h-full");
    expect(panel.getAttribute("data-compact-mobile-workspace")).toBe("true");
  });

  it("retains the constrained desktop Documents workspace geometry", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderModal({ initialTab: "documents" });

    const panel = await screen.findByTestId("request-documents-panel");
    const middle = panel.closest("[aria-busy]") as HTMLElement;
    expect(middle.className).toContain("overflow-hidden");
    expect(panel.parentElement?.className).toContain("h-full");
  });

  it("keeps the persistent header badge cluster useful when values are missing", async () => {
    renderModal({ initialTab: "documents" });
    await screen.findByTestId("appointment-header-badge-cluster");

    const cluster = screen.getByTestId("appointment-header-badge-cluster");
    expect(cluster.textContent).toContain("Non-Oncology");
    expect(cluster.textContent).toContain("Scheduled");
    expect(cluster.textContent).toContain("Priority not assigned");
    expect(cluster.textContent).toContain("Report not required");
    expect(cluster.textContent).toContain("Protocol not assigned");
    expect(cluster.textContent).not.toContain("Additional Imaging");
    expect(cluster.textContent).not.toContain("scheduled");
  });

  it("shows assigned priority, report requirement, and protocol state without adding protocol badges to ultrasound", async () => {
    const protocolAppointment = {
      ...appointment,
      modalityCode: "MRI",
      modalityNameEn: "MRI",
      priorityNameEn: "STAT",
      requiresReport: true,
      protocolAssignmentSummary: {
        assignmentId: 1,
        protocolName: "MRI Brain",
        versionNumber: "1.0",
        scannerName: "MRI A",
        assignedBy: "Doctor",
        assignedAt: null,
        protocolNotes: null,
        contrastNotes: null,
      },
    } as AppointmentWithDetails;
    mocks.getAppointmentById.mockResolvedValueOnce(protocolAppointment);
    renderModal({ initialTab: "documents" });
    const cluster = await screen.findByTestId("appointment-header-badge-cluster");
    expect(cluster.textContent).toContain("STAT");
    expect(cluster.textContent).toContain("Report required");
    expect(cluster.textContent).toContain("Protocol assigned");

    cleanup();
    mocks.getAppointmentById.mockResolvedValueOnce({ ...protocolAppointment, modalityCode: "US", modalityNameEn: "Ultrasound", protocolAssignmentSummary: null });
    renderModal({ initialTab: "documents" });
    expect((await screen.findByTestId("appointment-header-badge-cluster")).textContent).not.toContain("Protocol");
  });

  it("shows free-text protocols alongside library protocols with clinical fallbacks", async () => {
    mocks.getAppointmentById.mockResolvedValueOnce({
      ...appointment,
      protocolAssignmentSummary: {
        assignmentId: 1,
        protocolName: null,
        versionNumber: null,
        freeTextProtocol: "CT neck, chest, abdomen and pelvis with IV contrast; portal venous phase.",
        scannerName: null,
        assignedBy: "Doctor",
        assignedAt: null,
        protocolNotes: null,
        contrastNotes: null,
      },
    } as AppointmentWithDetails);
    renderModal({ initialTab: "documents" });

    expect(await screen.findByText("Protocol assigned")).toBeTruthy();
    expect(screen.getByText("Free-text protocol")).toBeTruthy();
    expect(screen.getByText("CT neck, chest, abdomen and pelvis with IV contrast; portal venous phase.")).toBeTruthy();
    expect(screen.getByText("Scanner").parentElement?.textContent).toContain("Not selected");
    expect(screen.getByText("Protocol notes").parentElement?.textContent).toContain("None");
    expect(screen.getByText("Contrast notes").parentElement?.textContent).toContain("None");

    cleanup();
    mocks.getAppointmentById.mockResolvedValueOnce({
      ...appointment,
      protocolAssignmentSummary: {
        assignmentId: 2,
        protocolName: "CT CAP",
        versionNumber: "2",
        freeTextProtocol: "Add delayed imaging.",
        scannerName: "CT A",
        assignedBy: "Doctor",
        assignedAt: null,
        protocolNotes: "Keep arms raised.",
        contrastNotes: "IV contrast.",
      },
    } as AppointmentWithDetails);
    renderModal({ initialTab: "documents" });
    expect(await screen.findByText("CT CAP v2")).toBeTruthy();
    expect(screen.getByText("Add delayed imaging.")).toBeTruthy();
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
    const demographics = screen.getByRole("button", { name: "More demographics" });
    expect(demographics.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(demographics);
    expect(demographics.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("01/01/1986")).toBeTruthy();
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

  it("sends the exam restriction override type for supervisor rescheduling", async () => {
    mocks.userRole = "supervisor";
    mocks.availabilityRows = [{
      date: "2026-09-01",
      dayLabel: "Tue, Sep 1",
      status: "restricted",
      bucketMode: "total_only",
      remainingCapacity: 1,
      dailyCapacity: 10,
      oncologyReserved: null,
      oncologyFilled: 0,
      oncologyRemaining: null,
      nonOncologyReserved: null,
      nonOncologyFilled: 0,
      nonOncologyRemaining: null,
      specialQuotaRemaining: null,
      hasSpecialQuotaPath: false,
      matchedExamRuleSummary: {
        ruleId: "exam-rule-1",
        title: "Exam restriction",
        effectLabel: "Restricted unless supervisor approves",
        effectMode: "restriction_overridable",
        isBlocking: false,
      },
      reasonText: "Exam restriction",
      requiresSupervisorOverride: true,
      reasonCodes: ["exam_type_not_allowed_for_rule"],
    }];
    renderModal({ initialTab: "reschedule" });

    await userEvent.click(await screen.findByRole("button", { name: /2026-09-01 restricted/i }));
    await userEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(await screen.findByText("Supervisor Override Required")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Supervisor Username"), { target: { value: "sup" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "pass" } });
    fireEvent.change(screen.getByPlaceholderText("Override Reason"), { target: { value: "urgent" } });
    await userEvent.click(screen.getByRole("button", { name: "Approve & Book" }));

    await waitFor(() => expect(mocks.rescheduleV2Booking).toHaveBeenCalled());
    expect(mocks.rescheduleV2Booking.mock.calls[0][1].override).toMatchObject({
      supervisorUsername: "sup",
      supervisorPassword: "pass",
      reason: "urgent",
      overrideType: "exam_restriction_override",
    });
  });

  it("opens a combined authorization path when a reschedule has multiple override types", async () => {
    mocks.userRole = "supervisor";
    mocks.availabilityRows = [{
      date: "2026-09-01",
      dayLabel: "Tue, Sep 1",
      status: "restricted",
      bucketMode: "total_only",
      remainingCapacity: 1,
      dailyCapacity: 10,
      oncologyReserved: null,
      oncologyFilled: 0,
      oncologyRemaining: null,
      nonOncologyReserved: null,
      nonOncologyFilled: 0,
      nonOncologyRemaining: null,
      specialQuotaRemaining: null,
      matchedExamRuleSummary: {
        ruleId: "exam-rule-1",
        title: "Exam restriction",
        effectLabel: "Restricted unless supervisor approves",
        effectMode: "restriction_overridable",
        isBlocking: false,
      },
      reasonText: "Exam restriction and category capacity",
      requiresSupervisorOverride: true,
      reasonCodes: ["exam_type_not_allowed_for_rule", "category_capacity_exhausted"],
    }];
    renderModal({ initialTab: "reschedule" });

    await userEvent.click(await screen.findByRole("button", { name: /2026-09-01 restricted/i }));
    await userEvent.click(screen.getByRole("button", { name: "Reschedule" }));

    expect(await screen.findByText("Supervisor Override Required")).toBeTruthy();
    expect(screen.queryByText("Multiple scheduling restrictions apply. Resolve one restriction or choose another date.")).toBeNull();
    expect(mocks.rescheduleV2Booking).not.toHaveBeenCalled();
  });

  it("lets a super admin directly reschedule with the complete total-capacity and exam-mix override set", async () => {
    mocks.availabilityRows = [{
      date: "2026-09-02",
      dayLabel: "Wed, Sep 2",
      status: "full",
      bucketMode: "total_only",
      remainingCapacity: 0,
      dailyCapacity: 18,
      oncologyReserved: null,
      oncologyFilled: 0,
      oncologyRemaining: null,
      nonOncologyReserved: null,
      nonOncologyFilled: 18,
      nonOncologyRemaining: null,
      specialQuotaRemaining: null,
      reasonText: "Total capacity and exam mix exhausted",
      requiresSupervisorOverride: true,
      reasonCodes: ["modality_daily_capacity_exhausted", "exam_mix_quota_exhausted"],
    }];
    renderModal({ initialTab: "reschedule" });

    await userEvent.click(await screen.findByRole("button", { name: "Show full days" }));
    await userEvent.click(await screen.findByRole("button", { name: /2026-09-02 full/i }));
    fireEvent.change(screen.getByLabelText(/Capacity Resolution Action/), { target: { value: "total_capacity_override" } });
    await userEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(await screen.findByText("Supervisor Override Required")).toBeTruthy();
    expect(screen.getByText("Total modality capacity override")).toBeTruthy();
    expect(screen.getByText("Exam mix override")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Supervisor Username"), { target: { value: "superadmin" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "pass" } });
    fireEvent.change(screen.getByPlaceholderText("Override Reason"), { target: { value: "combined" } });
    await userEvent.click(screen.getByRole("button", { name: "Approve & Book" }));

    await waitFor(() => expect(mocks.rescheduleV2Booking).toHaveBeenCalledTimes(1));
    expect(mocks.rescheduleV2Booking.mock.calls[0][1].override).toMatchObject({
      overrideTypes: ["total_capacity_override", "exam_mix_override"],
      overrideType: "total_capacity_override",
    });
  });

  it("submits one combined deferred reschedule request for a supervisor", async () => {
    mocks.userRole = "supervisor";
    mocks.availabilityRows = [{
      date: "2026-09-02",
      dayLabel: "Wed, Sep 2",
      status: "full",
      bucketMode: "total_only",
      remainingCapacity: 0,
      dailyCapacity: 18,
      oncologyReserved: null,
      oncologyFilled: 0,
      oncologyRemaining: null,
      nonOncologyReserved: null,
      nonOncologyFilled: 18,
      nonOncologyRemaining: null,
      specialQuotaRemaining: null,
      reasonText: "Total capacity and exam mix exhausted",
      requiresSupervisorOverride: true,
      reasonCodes: ["modality_daily_capacity_exhausted", "exam_mix_quota_exhausted"],
    }];
    renderModal({ initialTab: "reschedule" });

    await userEvent.click(await screen.findByRole("button", { name: "Show full days" }));
    await userEvent.click(await screen.findByRole("button", { name: /2026-09-02 full/i }));
    await userEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(screen.queryByText("Supervisor Override Required")).toBeNull();
    expect(await screen.findByText(/Total modality capacity override, Exam mix override/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Explain why this appointment needs override approval"), { target: { value: "combined" } });
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => expect(mocks.createSchedulingOverrideRequest).toHaveBeenCalledTimes(1));
    expect(mocks.rescheduleV2Booking).not.toHaveBeenCalled();
    expect(mocks.createSchedulingOverrideRequest.mock.calls[0][0]).toMatchObject({
      requestType: "reschedule_booking",
      requestPayload: { bookingDate: "2026-09-02" },
    });
  });

  it("does not open a supervisor modal for a receptionist when reschedule requests are disabled", async () => {
    mocks.userRole = "receptionist";
    mocks.availabilitySettings = "disabled";
    mocks.availabilityRows = [{
      date: "2026-09-01",
      dayLabel: "Tue, Sep 1",
      status: "restricted",
      bucketMode: "total_only",
      remainingCapacity: 1,
      dailyCapacity: 10,
      oncologyReserved: null,
      oncologyFilled: 0,
      oncologyRemaining: null,
      nonOncologyReserved: null,
      nonOncologyFilled: 0,
      nonOncologyRemaining: null,
      specialQuotaRemaining: null,
      hasSpecialQuotaPath: false,
      matchedExamRuleSummary: {
        ruleId: "exam-rule-1",
        title: "Exam restriction",
        effectLabel: "Restricted unless supervisor approves",
        effectMode: "restriction_overridable",
        isBlocking: false,
      },
      reasonText: "Exam restriction",
      requiresSupervisorOverride: true,
      reasonCodes: ["exam_type_not_allowed_for_rule"],
    }];
    renderModal({ initialTab: "reschedule" });

    const restrictedDateButton = await screen.findByRole("button", { name: /2026-09-01 restricted/i }) as HTMLButtonElement;
    await waitFor(() => expect(restrictedDateButton.disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Reschedule" }) as HTMLButtonElement).disabled).toBe(true);

    expect(screen.queryByText("Supervisor Override Required")).toBeNull();
    expect(screen.queryByText("Request Approval")).toBeNull();
    expect(mocks.rescheduleV2Booking).not.toHaveBeenCalled();
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

  it("opens Void in a separate dialog, requires and clears its reason, and submits the trimmed reason", async () => {
    renderModal({ initialTab: "details" });
    await screen.findByRole("heading", { name: "Appointment details" });
    expect(screen.queryByRole("button", { name: "Void appointment" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Void appointment" })).toBeTruthy();
    expect(screen.getByRole("menu").parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("menuitem", { name: "Void appointment" }));
    expect(screen.getByRole("heading", { name: "Void appointment" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    const reason = screen.getByLabelText(/void reason/i) as HTMLTextAreaElement;
    reason.focus();
    expect(document.activeElement).toBe(reason);
    expect(screen.getByRole("button", { name: "Void appointment" })).toHaveProperty("disabled", true);
    fireEvent.change(reason, { target: { value: "  Duplicate booking  " } });
    expect(screen.getByRole("button", { name: "Void appointment" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Void appointment" }));
    await waitFor(() => expect(mocks.deleteAppointment).toHaveBeenCalledWith(42, "Duplicate booking"));
  });

  it("identifies complementary imaging and opens its original appointment", async () => {
    const onOpenAppointment = vi.fn();
    mocks.getAppointmentById.mockResolvedValueOnce({
      ...appointment,
      isAdditionalImaging: true,
      originalAppointmentId: 17,
      originalExam: "CT Chest",
      originalAccession: "ACC-17",
      requiresReport: false,
    } as AppointmentWithDetails);
    renderModal({ initialTab: "documents", onOpenAppointment });

    expect((await screen.findAllByText("Additional Imaging")).length).toBeGreaterThan(0);
    expect(screen.getByText("CT Chest")).toBeTruthy();
    expect(screen.getByText("ACC-17")).toBeTruthy();
    expect(screen.getByText("Reported with original examination")).toBeTruthy();
    expect(screen.queryByText("Report not required")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open original appointment" }));
    expect(onOpenAppointment).toHaveBeenCalledWith(17);
  });

  it("uses the compact mobile document workspace, collapses an empty protocol panel, and keeps one More action in the footer", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderModal({ initialTab: "documents" });

    expect((await screen.findByTestId("request-documents-panel")).getAttribute("data-compact-mobile-workspace")).toBe("true");
    await waitFor(() => expect(screen.getByText("Protocol and notes").closest("details")?.open).toBe(false));
    expect(screen.getAllByRole("button", { name: "More actions" })).toHaveLength(1);
  });

  it("keeps meaningful protocol content open on mobile and retains header More when no footer is available", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    mocks.userRole = "doctor";
    mocks.getAppointmentById.mockResolvedValueOnce({
      ...appointment,
      notes: "Patient needs contrast preparation.",
      protocolAssignmentSummary: {
        assignmentId: 1,
        protocolName: "CT Head",
        versionNumber: "1.0",
        scannerName: "CT A",
        assignedBy: "Doctor",
        assignedAt: null,
        protocolNotes: null,
        contrastNotes: null,
      },
    });
    renderModal({ initialTab: "documents" });

    await waitFor(() => expect(screen.getByText("Protocol and notes").closest("details")?.open).toBe(true));
    expect(screen.getAllByRole("button", { name: "More actions" })).toHaveLength(1);
  });

  it("clears the Void reason when cancelled and keeps the field usable on mobile", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderModal({ initialTab: "documents" });
    await screen.findByTestId("request-documents-panel");
    fireEvent.click(screen.getAllByRole("button", { name: "More actions" }).at(-1)!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Void appointment" }));

    const reason = screen.getByLabelText(/void reason/i) as HTMLTextAreaElement;
    reason.focus();
    expect(document.activeElement).toBe(reason);
    fireEvent.change(reason, { target: { value: "Mobile reason" } });
    expect(reason.value).toBe("Mobile reason");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Void appointment" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "More actions" }).at(-1)!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Void appointment" }));
    expect((screen.getByLabelText(/void reason/i) as HTMLTextAreaElement).value).toBe("");
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
