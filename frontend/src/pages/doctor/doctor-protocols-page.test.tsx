import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorMe, DoctorProtocolingAppointment } from "@/types/api";
import { DoctorProtocolsPage } from "./doctor-protocols-page";

const appointment: DoctorProtocolingAppointment = {
  appointmentId: 42,
  accessionNumber: "V2-000042",
  patientId: 9,
  patientMrn: "MRN-9",
  patientNationalId: "LEGACY-9",
  patientArabicName: "مريض عربي",
  patientEnglishName: "Request Scan Patient",
  patientDicomId: "002888",
  studyInstanceUid: null,
  ageYears: 35,
  sex: "M",
  appointmentDate: "2026-07-22",
  appointmentTime: "09:00:00",
  modalityId: 4,
  modalityCode: "CT",
  modalityName: "CT",
  examTypeId: 10,
  examTypeName: "CT Chest",
  caseCategory: "non_oncology",
  clinicalNotes: "Pre-operative staging and chest review.",
  appointmentStatus: "scheduled",
  protocolStatus: "NOT_PROTOCOLLED",
  assignment: null,
};

const { mockCreateAssignment, mockFetchAppointments, mockFetchAppointmentDetail, mockGetAppointmentById, mockPatientSummary, mockRescheduleBooking } = vi.hoisted(() => ({ mockCreateAssignment: vi.fn(), mockFetchAppointments: vi.fn(), mockFetchAppointmentDetail: vi.fn(), mockGetAppointmentById: vi.fn(), mockPatientSummary: vi.fn(), mockRescheduleBooking: vi.fn() }));

vi.mock("@/lib/api-hooks", () => ({
  activateProtocolLibraryVersion: vi.fn(), cancelDoctorProtocolAssignment: vi.fn(), createDoctorProtocolAssignment: mockCreateAssignment,
  createProtocolLibraryAnatomyRegion: vi.fn(), createProtocolLibraryCtPhasePreset: vi.fn(), createProtocolLibraryCtPhaseRow: vi.fn(),
  createProtocolLibraryDraftFromActive: vi.fn(), createProtocolLibraryMriSequencePreset: vi.fn(), createProtocolLibraryMriSequenceRow: vi.fn(),
  createProtocolLibraryProtocol: vi.fn(), deleteProtocolLibraryCtPhaseRow: vi.fn(), deleteProtocolLibraryMriSequenceRow: vi.fn(),
  confirmMriSequenceImport: vi.fn(), downloadMriSequenceImportTemplate: vi.fn(), exportMriSequencePresetsWorkbook: vi.fn(),
  fetchDoctorProtocolingAppointmentDetail: mockFetchAppointmentDetail,
  fetchDoctorProtocolingAppointments: mockFetchAppointments,
  getAppointmentById: mockGetAppointmentById,
  fetchProtocolLibraryAnatomyRegions: vi.fn(async () => []), fetchProtocolLibraryCtPhasePresets: vi.fn(async () => []),
  fetchProtocolLibraryMriSequencePresets: vi.fn(async () => []), fetchProtocolLibraryVersionDetail: vi.fn(async () => null),
  fetchProtocolLibraryProtocols: vi.fn(async () => []), fetchProtocolLibraryScanners: vi.fn(async () => []),
  inspectMriSequenceImport: vi.fn(), previewMriSequenceImport: vi.fn(), reorderProtocolLibraryCtPhaseRows: vi.fn(),
  reorderProtocolLibraryMriSequenceRows: vi.fn(), updateProtocolLibraryCtPhaseRow: vi.fn(), updateProtocolLibraryAnatomyRegion: vi.fn(),
  updateProtocolLibraryCtPhasePreset: vi.fn(), updateProtocolLibraryMriSequenceRow: vi.fn(), updateProtocolLibraryMriSequencePreset: vi.fn(),
  updateProtocolLibraryProtocol: vi.fn(), updateProtocolLibraryScanner: vi.fn(), updateProtocolLibraryVersion: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/lib/protocol-printing", () => ({ printProtocolSheet: vi.fn() }));
vi.mock("@/v2/appointments/api", () => ({
  rescheduleV2Booking: mockRescheduleBooking,
  useV2ExamTypes: () => ({ data: [{ id: 10, name: "CT Chest", nameEn: "CT Chest", nameAr: "صدر", code: "CTC", modalityId: 4, isActive: true }, { id: 11, name: "CT Chest Abdomen", nameEn: "CT Chest Abdomen", nameAr: "صدر وبطن", code: "CTCA", modalityId: 4, isActive: true }, { id: 12, name: "MRI Brain", nameEn: "MRI Brain", nameAr: "دماغ", code: "MRB", modalityId: 5, isActive: true }], isLoading: false, isError: false }),
}));
vi.mock("@/components/appointments/appointment-information-view", () => ({
  AppointmentDetailsReadOnly: ({ readOnly }: { readOnly?: boolean }) => <div data-testid="read-only-appointment-details">{readOnly ? "Read-only appointment details" : "Editable appointment details"}</div>,
}));
vi.mock("@/components/patients/patient-summary-formatters", () => ({
  usePatientDirectorySummary: () => mockPatientSummary(),
}));
vi.mock("@/components/patients/patient-summary-content", () => ({
  PatientSummaryContent: () => <div data-testid="shared-patient-summary-content">Shared patient summary</div>,
}));
vi.mock("@/components/documents/request-documents-panel", () => ({
  RequestDocumentsPanel: ({ appointmentId, patientId, appointmentRefType, title }: { appointmentId: number; patientId: number; appointmentRefType: string; title: string }) => (
    <div data-testid="protocoling-request-documents" data-appointment-id={appointmentId} data-patient-id={patientId} data-ref-type={appointmentRefType}>{title}</div>
  ),
}));

const me = {
  hasActiveDoctorProfile: true,
  profile: null,
  doctorRole: "specialist",
  canFinalizeReports: false,
  canAssignProtocols: true,
  canSupervise: false,
  allowedModalities: [],
  moduleCapabilities: [],
  canAccessCoreWorkspace: true,
} as DoctorMe;

describe("Doctor protocoling request documents", () => {
  beforeEach(() => {
    mockFetchAppointments.mockResolvedValue([appointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment, assignmentDetail: null });
    mockGetAppointmentById.mockResolvedValue(appointment);
    mockPatientSummary.mockReturnValue({ data: { id: 9 }, isLoading: false, isError: false, refetch: vi.fn() });
    mockCreateAssignment.mockReset();
    mockRescheduleBooking.mockReset();
    mockRescheduleBooking.mockResolvedValue({ booking: { id: 42, examTypeId: 11 } });
  });

  it("shows the Arabic-first clinical header and prior-study actions", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    expect(screen.getByRole("heading", { name: "مريض عربي" })).toBeTruthy();
    expect(screen.getAllByText("Request Scan Patient").some((element) => element.tagName === "P")).toBe(true);
    expect(screen.getByText("Age / sex").parentElement?.textContent).toContain("35 / M");
    expect(screen.getByText("Primary ID").parentElement?.textContent).toContain("002888");
    expect(screen.getByText("MRN").parentElement?.textContent).toContain("MRN-9");
    expect(screen.getByText("Appointment").parentElement?.textContent).toContain("22/07/2026 · 09:00");
    const modal = screen.getByRole("dialog", { name: "Assign protocol" });
    expect(within(modal).getByText("Modality").parentElement?.textContent).toContain("CT");
    expect(within(modal).getByText("Examination").parentElement?.textContent).toContain("CT Chest");
    expect(within(modal).getByText("Non-oncology")).toBeTruthy();
    expect(within(modal).getByText("Clinical indication:").parentElement?.textContent).toContain("Pre-operative staging");
    expect(screen.queryByRole("link", { name: "Open current study" })).toBeNull();
    expect(screen.getByRole("link", { name: "Patient studies" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Patient studies in RadiAnt" }).getAttribute("href")).toContain("00100020");
    expect(screen.getByRole("link", { name: "Patient studies in RadiAnt" }).getAttribute("href")).toContain("002888");
  });

  it("edits examination type within the current modality and refreshes the header", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    expect(screen.getByRole("option", { name: /CT Chest Abdomen/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /MRI Brain/ })).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));

    await waitFor(() => expect(mockRescheduleBooking).toHaveBeenCalledWith(42, { bookingDate: "2026-07-22", bookingTime: "09:00:00", examTypeId: 11 }));
    expect(await within(screen.getByRole("dialog", { name: "Assign protocol" })).findByText("CT Chest Abdomen")).toBeTruthy();
  });

  it("preserves entered protocol text when an examination update fails", async () => {
    mockRescheduleBooking.mockRejectedValue(new Error("Exam update denied"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("radio", { name: "Free-text protocol" }));
    const protocol = screen.getByRole("textbox", { name: "Free-text protocol" });
    await userEvent.type(protocol, "Keep this protocol draft.");
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));

    expect(await screen.findByText("Exam update denied")).toBeTruthy();
    expect((protocol as HTMLTextAreaElement).value).toBe("Keep this protocol draft.");
  });

  it("renders the existing request-document panel for the selected V2 appointment", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click((await screen.findAllByRole("button", { name: "Assign" }))[0]);
    const panel = await screen.findByTestId("protocoling-request-documents");
    expect(panel.textContent).toBe("Appointment request documents");
    expect(panel.getAttribute("data-appointment-id")).toBe("42");
    expect(panel.getAttribute("data-patient-id")).toBe("9");
    expect(panel.getAttribute("data-ref-type")).toBe("v2_booking");
  });

  it("offers free-text mode and submits it without a saved protocol", async () => {
    mockCreateAssignment.mockResolvedValue({ appointment, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("radio", { name: "Free-text protocol" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Free-text protocol" }), "Axial T2 and DWI; no contrast.");
    await userEvent.click(screen.getByRole("button", { name: "Assign and next" }));

    expect(mockCreateAssignment).toHaveBeenCalledWith(42, expect.objectContaining({ protocolId: null, freeTextProtocol: "Axial T2 and DWI; no contrast." }));
  });

  it("navigates through the current filtered worklist and shows position", async () => {
    const nextAppointment = { ...appointment, appointmentId: 43, patientId: 10, patientMrn: "MRN-10", patientEnglishName: "Next Patient" };
    mockFetchAppointments.mockResolvedValue([appointment, nextAppointment]);
    mockFetchAppointmentDetail.mockImplementation(async (appointmentId: number) => ({ appointment: appointmentId === 43 ? nextAppointment : appointment, assignmentDetail: null }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click((await screen.findAllByRole("button", { name: "Assign" }))[0]);
    expect(screen.getByText("1 of 2")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Next appointment/ }));
    expect(await screen.findByText("2 of 2")).toBeTruthy();
    expect((await screen.findByTestId("protocoling-request-documents")).getAttribute("data-appointment-id")).toBe("43");
    expect(screen.getByRole("button", { name: /Next appointment/ }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Previous appointment/ }).getAttribute("disabled")).toBeNull();
  });

  it("opens read-only appointment and patient details without resetting protocol work", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("radio", { name: "Free-text protocol" }));
    const protocol = screen.getByRole("textbox", { name: "Free-text protocol" });
    await userEvent.type(protocol, "Preserve this protocol while reviewing details.");
    await userEvent.click(screen.getByRole("button", { name: "Open appointment and patient details" }));

    const drawer = await screen.findByTestId("protocoling-details-drawer");
    expect(drawer).toBeTruthy();
    expect(drawer.className).toContain("w-full");
    expect(drawer.className).toContain("sm:w-[480px]");
    expect(screen.getByTestId("read-only-appointment-details").textContent).toBe("Read-only appointment details");
    expect(within(drawer).queryByRole("button", { name: /Edit|Change status|Reschedule/ })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Patient" }));
    expect(screen.getByTestId("shared-patient-summary-content")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Appointment" }).getAttribute("aria-selected")).toBe("false");
    const closeButtons = screen.getAllByRole("button", { name: "Close appointment and patient details" });
    await userEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByTestId("protocoling-details-drawer")).toBeNull();
    expect((protocol as HTMLTextAreaElement).value).toBe("Preserve this protocol while reviewing details.");
    expect(screen.getByTestId("protocoling-request-documents")).toBeTruthy();
  });

  it("refreshes the details drawer for the appointment selected by worklist navigation", async () => {
    const nextAppointment = { ...appointment, appointmentId: 43, patientId: 10, patientMrn: "MRN-10", patientEnglishName: "Next Patient" };
    mockFetchAppointments.mockResolvedValue([appointment, nextAppointment]);
    mockFetchAppointmentDetail.mockImplementation(async (appointmentId: number) => ({ appointment: appointmentId === 43 ? nextAppointment : appointment, assignmentDetail: null }));
    mockGetAppointmentById.mockImplementation(async (appointmentId: number) => ({ ...appointment, appointmentId, patientId: appointmentId === 43 ? 10 : 9, patientEnglishName: appointmentId === 43 ? "Next Patient" : appointment.patientEnglishName }));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click((await screen.findAllByRole("button", { name: "Assign" }))[0]);
    await userEvent.click(screen.getByRole("button", { name: "Open appointment and patient details" }));
    expect(await screen.findByText("Read-only appointment details")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Next appointment/ }));
    expect(await screen.findByText("2 of 2")).toBeTruthy();
    expect(screen.queryByTestId("protocoling-details-drawer")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open appointment and patient details" }));
    expect(within(screen.getByTestId("protocoling-details-drawer")).getByText("Next Patient")).toBeTruthy();
    expect(mockGetAppointmentById).toHaveBeenLastCalledWith(43);
  });

  it("shows appointment detail loading and retryable error states", async () => {
    mockGetAppointmentById.mockImplementation(() => new Promise(() => undefined));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const loadingView = render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Open appointment and patient details" }));
    expect((await screen.findByRole("status")).textContent).toContain("Loading appointment details...");

    loadingView.unmount();
    mockGetAppointmentById.mockRejectedValue(new Error("temporary failure"));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Open appointment and patient details" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Appointment details are unavailable right now.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
