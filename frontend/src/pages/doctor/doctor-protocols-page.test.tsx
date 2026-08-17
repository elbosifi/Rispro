import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorMe, DoctorProtocolingAppointment } from "@/types/api";
import { t as translate, type TranslationKey } from "@/lib/i18n";
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
  requiresReport: true,
  modalityId: 4,
  modalityCode: "CT",
  modalityName: "CT",
  modalitySafetyWorkflowType: "standard_acknowledgement",
  mriPrimaryScreeningResult: null,
  examTypeId: 10,
  examTypeName: "CT Chest",
  caseCategory: "non_oncology",
  clinicalNotes: "Pre-operative staging and chest review.",
  appointmentStatus: "scheduled",
  protocolStatus: "NOT_PROTOCOLLED",
  assignment: null,
};

const historicalCandidate = {
  historicalPatientId: "OLD-77", patientName: "ALSIFI^SERAJ^ALI", patientBirthDate: "19800102", patientSex: "M",
  classification: "possible", reasons: ["fuzzy_english_name"], authoritative: false, matchRank: 9, nameSimilarity: 0.74,
  phoneticMatchCount: 2, studyCount: 1, studies: [{ orthancStudyId: "old-study", studyInstanceUid: "1.2.3", accessionNumber: "OLD-ACC", patientId: "OLD-77", patientName: "ALSIFI^SERAJ^ALI", patientBirthDate: "19800102", patientSex: "M", studyDate: "20240102", studyDescription: "Historical CT", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 20 }],
} as const;

const { mockCreateAssignment, mockFetchAppointments, mockFetchAppointmentDetail, mockFetchProtocolPolicy, mockFetchProtocolingPatientHistory, mockFetchHistoricalPacsCandidates, mockSearchHistoricalPacsPatientId, mockGetAppointmentById, mockPatientSummary, mockRescheduleBooking, mockUpdateReportRequirement } = vi.hoisted(() => ({ mockCreateAssignment: vi.fn(), mockFetchAppointments: vi.fn(), mockFetchAppointmentDetail: vi.fn(), mockFetchProtocolPolicy: vi.fn(), mockFetchProtocolingPatientHistory: vi.fn(), mockFetchHistoricalPacsCandidates: vi.fn(), mockSearchHistoricalPacsPatientId: vi.fn(), mockGetAppointmentById: vi.fn(), mockPatientSummary: vi.fn(), mockRescheduleBooking: vi.fn(), mockUpdateReportRequirement: vi.fn() }));

vi.mock("@/lib/api-hooks", () => ({
  activateProtocolLibraryVersion: vi.fn(), cancelDoctorProtocolAssignment: vi.fn(), createDoctorProtocolAssignment: mockCreateAssignment,
  createProtocolLibraryAnatomyRegion: vi.fn(), createProtocolLibraryCtPhasePreset: vi.fn(), createProtocolLibraryCtPhaseRow: vi.fn(),
  createProtocolLibraryDraftFromActive: vi.fn(), createProtocolLibraryMriSequencePreset: vi.fn(), createProtocolLibraryMriSequenceRow: vi.fn(),
  createProtocolLibraryProtocol: vi.fn(), deleteProtocolLibraryCtPhaseRow: vi.fn(), deleteProtocolLibraryMriSequenceRow: vi.fn(),
  confirmMriSequenceImport: vi.fn(), downloadMriSequenceImportTemplate: vi.fn(), exportMriSequencePresetsWorkbook: vi.fn(),
  fetchDoctorProtocolingAppointmentDetail: mockFetchAppointmentDetail,
  fetchDoctorProtocolingAppointments: mockFetchAppointments,
  fetchRequestDocumentProtocolPolicy: mockFetchProtocolPolicy,
  fetchProtocolingHistoricalPacsCandidates: mockFetchHistoricalPacsCandidates,
  fetchProtocolingPatientHistory: mockFetchProtocolingPatientHistory,
  searchProtocolingHistoricalPacsPatientId: mockSearchHistoricalPacsPatientId,
  getAppointmentById: mockGetAppointmentById,
  fetchProtocolLibraryAnatomyRegions: vi.fn(async () => []), fetchProtocolLibraryCtPhasePresets: vi.fn(async () => []),
  fetchProtocolLibraryMriSequencePresets: vi.fn(async () => []), fetchProtocolLibraryVersionDetail: vi.fn(async () => null),
  fetchProtocolLibraryProtocols: vi.fn(async () => []), fetchProtocolLibraryScanners: vi.fn(async () => []),
  inspectMriSequenceImport: vi.fn(), previewMriSequenceImport: vi.fn(), reorderProtocolLibraryCtPhaseRows: vi.fn(),
  reorderProtocolLibraryMriSequenceRows: vi.fn(), updateProtocolLibraryCtPhaseRow: vi.fn(), updateProtocolLibraryAnatomyRegion: vi.fn(),
  updateProtocolLibraryCtPhasePreset: vi.fn(), updateProtocolLibraryMriSequenceRow: vi.fn(), updateProtocolLibraryMriSequencePreset: vi.fn(),
  updateProtocolLibraryProtocol: vi.fn(), updateProtocolLibraryScanner: vi.fn(), updateProtocolLibraryVersion: vi.fn(),
  updateDoctorProtocolReportRequirement: mockUpdateReportRequirement,
}));

vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/lib/protocol-printing", () => ({ printProtocolSheet: vi.fn() }));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en", isArabic: false, t: (key: TranslationKey) => translate("en", key) }) }));
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
    mockFetchProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null });
    mockFetchProtocolingPatientHistory.mockClear();
    mockFetchProtocolingPatientHistory.mockResolvedValue({ items: [], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    mockFetchHistoricalPacsCandidates.mockReset();
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    mockSearchHistoricalPacsPatientId.mockReset();
    mockSearchHistoricalPacsPatientId.mockResolvedValue([]);
    mockGetAppointmentById.mockResolvedValue(appointment);
    mockPatientSummary.mockReturnValue({ data: { id: 9 }, isLoading: false, isError: false, refetch: vi.fn() });
    mockCreateAssignment.mockReset();
    mockRescheduleBooking.mockReset();
    mockRescheduleBooking.mockResolvedValue({ booking: { id: 42, examTypeId: 11 } });
    mockUpdateReportRequirement.mockReset();
    mockUpdateReportRequirement.mockResolvedValue({ booking: { id: 42, requiresReport: true } });
  });

  it("renders reconciled history with client-side modality filtering", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", items: [
      { appointmentId: 11, orthancStudyId: "s1", accessionNumber: "A-CT", date: "2026-08-16", time: "10:00", modalities: ["CT"], description: "CT Chest", appointmentStatus: "completed", reportAvailable: true, source: "rispro_pacs" },
      { appointmentId: 12, orthancStudyId: null, accessionNumber: "A-MR", date: "2026-08-15", time: "10:00", modalities: ["MRI"], description: "MRI Brain", appointmentStatus: "completed", reportAvailable: false, source: "rispro_only" },
      { appointmentId: null, orthancStudyId: "s3", accessionNumber: "A-US", date: "2026-08-14", time: null, modalities: ["US"], description: "US Abdomen", appointmentStatus: null, reportAvailable: false, source: "pacs_only" },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const panel = screen.getByRole("heading", { name: "Patient history" }).closest("aside")!;
    const history = within(panel);
    expect(history.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(history.getByText(/CT Chest/)).toBeTruthy(); expect(history.getByText(/MRI Brain/)).toBeTruthy(); expect(history.getByText(/US Abdomen/)).toBeTruthy();
    await userEvent.click(history.getByRole("button", { name: "CT" }));
    expect(history.getByText(/CT Chest/)).toBeTruthy(); expect(history.queryByText(/MRI Brain/)).toBeNull(); expect(history.queryByText(/US Abdomen/)).toBeNull();
    await userEvent.click(history.getByRole("button", { name: "MRI" }));
    expect(history.getByRole("button", { name: "CT" }).getAttribute("aria-pressed")).toBe("true"); expect(history.getByRole("button", { name: "MRI" }).getAttribute("aria-pressed")).toBe("true"); expect(history.getByText(/MRI Brain/)).toBeTruthy();
    await userEvent.click(history.getByRole("button", { name: "CT" })); expect(history.queryByText(/CT Chest/)).toBeNull(); expect(history.getByText(/MRI Brain/)).toBeTruthy();
    await userEvent.click(history.getByRole("button", { name: "MRI" })); expect(history.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true"); expect(history.getByText(/US Abdomen/)).toBeTruthy();
    expect(mockFetchProtocolingPatientHistory).toHaveBeenCalledTimes(1);
  });

  it("hides PACS viewers but preserves the report action for a RISpro-only history row", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", items: [
      { appointmentId: 11, orthancStudyId: null, accessionNumber: "V2-001111", date: "2026-08-16", time: "10:00", modalities: ["CT"], description: "RIS only CT", appointmentStatus: "completed", reportAvailable: true, source: "rispro_only" },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const row = (await screen.findByText(/RIS only CT/)).closest("div")!;

    expect(within(row).getByText("Not in PACS")).toBeTruthy();
    expect(within(row).queryByRole("link", { name: "SonicDICOM" })).toBeNull();
    expect(within(row).queryByRole("link", { name: "RadiAnt" })).toBeNull();
    expect(within(row).getByRole("link", { name: "Open report" })).toBeTruthy();
  });

  it("keeps matched PACS study viewers on the appointment study-scope route", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", items: [
      { appointmentId: 11, orthancStudyId: "study-11", accessionNumber: "V2-001111", date: "2026-08-16", time: "10:00", modalities: ["CT"], description: "Matched PACS CT", appointmentStatus: "completed", reportAvailable: false, source: "rispro_pacs" },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const row = (await screen.findByText(/Matched PACS CT/)).closest("div")!;

    expect(within(row).getByText("PACS")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "SonicDICOM" }).getAttribute("href")).toContain("/api/doctor/protocoling/appointments/11/open-sonicdicom?scope=study");
    expect(within(row).getByRole("link", { name: "RadiAnt" })).toBeTruthy();
  });

  it("keeps PACS-only accession viewers and omits the appointment-bound report action", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", items: [
      { appointmentId: null, orthancStudyId: "old-study", accessionNumber: "OLD-123", date: "2024-01-10", time: null, modalities: ["CT"], description: "Old PACS CT", appointmentStatus: null, reportAvailable: false, source: "pacs_only" },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const row = (await screen.findByText(/Old PACS CT/)).closest("div")!;

    expect(within(row).getByRole("link", { name: "SonicDICOM" }).getAttribute("href")).toContain("/api/doctor/protocoling/history/open-sonicdicom?accession=OLD-123");
    expect(within(row).getByRole("link", { name: "RadiAnt" }).getAttribute("href")).toContain("00080050");
    expect(within(row).queryByRole("link", { name: "Open report" })).toBeNull();
  });

  it("moves the patient-level viewer actions from the modal header into Patient History", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    const modal = screen.getByRole("dialog", { name: "Assign protocol" });
    const modalHeader = within(modal).getByRole("button", { name: "Patient history" }).closest("header")!;

    expect(within(modalHeader).queryByRole("link", { name: "Patient studies" })).toBeNull();
    expect(within(modalHeader).queryByRole("link", { name: "Patient studies in RadiAnt" })).toBeNull();
    expect(within(modalHeader).getByRole("button", { name: "Patient history" })).toBeTruthy();

    await userEvent.click(within(modalHeader).getByRole("button", { name: "Patient history" }));
    const panel = within(modal).getByRole("heading", { name: "Patient history" }).closest("aside")!;
    const patientStudies = within(panel).getAllByRole("link", { name: "Patient studies" });
    const patientStudiesInRadiAnt = within(panel).getAllByRole("link", { name: "Patient studies in RadiAnt" });
    expect(patientStudies).toHaveLength(1);
    expect(patientStudiesInRadiAnt).toHaveLength(1);
    expect(patientStudies[0].getAttribute("href")).toContain("/api/doctor/protocoling/appointments/42/open-sonicdicom?scope=patient");
    expect(patientStudiesInRadiAnt[0].getAttribute("href")).toContain("00100020");
    expect(patientStudiesInRadiAnt[0].getAttribute("href")).toContain("002888");
  });

  it("shows additional history rows client-side without another API request", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", items: Array.from({ length: 7 }, (_, index) => ({
      appointmentId: index + 1,
      orthancStudyId: null,
      accessionNumber: `HISTORY-${index + 1}`,
      date: `2026-08-${String(16 - index).padStart(2, "0")}`,
      time: "10:00",
      modalities: ["CT"],
      description: `History Study ${index + 1}`,
      appointmentStatus: "completed",
      reportAvailable: false,
      source: "rispro_only",
    })) });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const panel = screen.getByRole("heading", { name: "Patient history" }).closest("aside")!;
    const history = within(panel);
    await history.findByText(/History Study 1/);

    for (let index = 1; index <= 5; index += 1) expect(history.getByText(new RegExp(`History Study ${index}$`))).toBeTruthy();
    expect(history.queryByText(/History Study 6$/)).toBeNull();
    expect(history.queryByText(/History Study 7$/)).toBeNull();
    await userEvent.click(history.getByRole("button", { name: "Show more" }));
    for (let index = 1; index <= 7; index += 1) expect(history.getByText(new RegExp(`History Study ${index}$`))).toBeTruthy();
    expect(history.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(mockFetchProtocolingPatientHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps RISpro history visible without PACS status or viewer actions when PACS is unavailable", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "unavailable", items: [
      { appointmentId: 11, orthancStudyId: null, accessionNumber: "A-CT", date: "2026-08-16", time: "10:00", modalities: ["CT"], description: "CT Chest History", appointmentStatus: "completed", reportAvailable: false, source: "rispro_only" },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const panel = screen.getByRole("heading", { name: "Patient history" }).closest("aside")!;
    const history = within(panel);
    const row = (await history.findByText(/CT Chest History/)).closest("div")!;

    expect(history.getByText("PACS availability could not be checked. RISpro history is still shown.")).toBeTruthy();
    expect(history.queryByText("Not in PACS")).toBeNull();
    expect(within(row).queryByRole("link", { name: "SonicDICOM" })).toBeNull();
    expect(within(row).queryByRole("link", { name: "RadiAnt" })).toBeNull();
  });

  it("keeps RISpro history visible without viewer actions when Patient ID is unavailable", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "patient_id_unavailable", items: [
      { appointmentId: 11, orthancStudyId: null, accessionNumber: "A-CT", date: "2026-08-16", time: "10:00", modalities: ["CT"], description: "Patient ID unavailable history", appointmentStatus: "completed", reportAvailable: false, source: "rispro_only" },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const panel = screen.getByRole("heading", { name: "Patient history" }).closest("aside")!;
    const history = within(panel);
    const row = (await history.findByText(/Patient ID unavailable history/)).closest("div")!;

    expect(history.getByText("PACS history could not be checked because Patient ID is unavailable.")).toBeTruthy();
    expect(within(row).queryByRole("link", { name: "SonicDICOM" })).toBeNull();
    expect(within(row).queryByRole("link", { name: "RadiAnt" })).toBeNull();
  });

  it("labels historical candidates as non-authoritative and performs exact old Patient ID lookup", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", items: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [historicalCandidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    mockSearchHistoricalPacsPatientId.mockResolvedValue([{ ...historicalCandidate, classification: "exact", reasons: ["exact_patient_id"] }]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const panel = screen.getByRole("heading", { name: "Patient history" }).closest("aside")!;
    const history = within(panel);
    expect(await history.findByText("Possible historical PACS matches")).toBeTruthy();
    expect(history.getByText("Search old PACS Patient ID")).toBeTruthy();
    expect(history.getByText("Non-authoritative candidate")).toBeTruthy();
    expect(history.queryByRole("button", { name: /Attach|Migrate|Merge/i })).toBeNull();
    await userEvent.type(history.getByRole("textbox", { name: "Old PACS Patient ID" }), "OLD-77");
    await userEvent.click(history.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(mockSearchHistoricalPacsPatientId).toHaveBeenCalledWith(42, "OLD-77"));
    expect((await history.findAllByText(/Patient ID OLD-77/)).length).toBeGreaterThanOrEqual(2);
  });

  it("renders fast patient history while historical PACS matching is still running", async () => {
    let resolveHistorical!: (value: { historicalCandidates: [typeof historicalCandidate]; historicalPacsIndexStatus: "ready"; historicalPacsLastSuccessAt: null }) => void;
    mockFetchHistoricalPacsCandidates.mockReturnValue(new Promise((resolve) => { resolveHistorical = resolve; }));
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, items: [
      { appointmentId: 11, orthancStudyId: "fast-study", studyInstanceUid: "1.2.fast", accessionNumber: "FAST-11", date: "2026-08-16", time: "10:00", modalities: ["CT"], description: "Fast RISpro PACS history row", appointmentStatus: "completed", reportAvailable: false, source: "rispro_pacs", identityDiscrepancy: null },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const history = within(screen.getByRole("heading", { name: "Patient history" }).closest("aside")!);

    expect(await history.findByText(/Fast RISpro PACS history row/)).toBeTruthy();
    expect(history.getByText("Searching historical PACS matches…")).toBeTruthy();
    expect(history.getByText("Patient history above is already available independently. Wait here if you want to see possible historical PACS matches.")).toBeTruthy();
    expect(history.queryByText(/Patient ID OLD-77/)).toBeNull();

    await act(async () => resolveHistorical({ historicalCandidates: [historicalCandidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null }));
    expect(await history.findByText(/Patient ID OLD-77/)).toBeTruthy();
    expect(history.queryByText("Searching historical PACS matches…")).toBeNull();
    expect(history.getByText(/Fast RISpro PACS history row/)).toBeTruthy();
  });

  it("isolates historical PACS search failure from successful patient history", async () => {
    mockFetchHistoricalPacsCandidates.mockRejectedValue(new Error("historical search failed"));
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, items: [
      { appointmentId: 12, orthancStudyId: "fast-study-2", studyInstanceUid: "1.2.fast.2", accessionNumber: "FAST-12", date: "2026-08-15", time: "09:00", modalities: ["MRI"], description: "History survives fuzzy failure", appointmentStatus: "completed", reportAvailable: false, source: "rispro_pacs", identityDiscrepancy: null },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const history = within(screen.getByRole("heading", { name: "Patient history" }).closest("aside")!);

    expect(await history.findByText(/History survives fuzzy failure/)).toBeTruthy();
    expect(await history.findByText("Historical PACS search failed.")).toBeTruthy();
    expect(history.getByRole("button", { name: "Retry historical search" })).toBeTruthy();
    expect(history.queryByText("Unable to load patient history.")).toBeNull();
  });

  it("shows an explicit empty result only after historical PACS search completes", async () => {
    let resolveHistorical!: (value: { historicalCandidates: []; historicalPacsIndexStatus: "ready"; historicalPacsLastSuccessAt: null }) => void;
    mockFetchHistoricalPacsCandidates.mockReturnValue(new Promise((resolve) => { resolveHistorical = resolve; }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const history = within(screen.getByRole("heading", { name: "Patient history" }).closest("aside")!);

    expect(history.getByText("Searching historical PACS matches…")).toBeTruthy();
    expect(history.queryByText("Historical PACS search complete. No possible matches were found.")).toBeNull();
    await act(async () => resolveHistorical({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null }));
    expect(await history.findByText("Historical PACS search complete. No possible matches were found.")).toBeTruthy();
    expect(history.queryByText("Searching historical PACS matches…")).toBeNull();
  });

  it("shows the request-document queue policy only when enabled", async () => {
    mockFetchProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null });
    const enabledClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const enabled = render(<QueryClientProvider client={enabledClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    expect(await screen.findByText("Only appointments with an attached request/referral document are eligible for protocoling.")).toBeTruthy();
    enabled.unmount();

    mockFetchProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null });
    const disabledClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={disabledClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await screen.findByRole("button", { name: "Assign" });
    expect(screen.queryByTestId("protocol-request-document-policy")).toBeNull();
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
    expect(within(modal).queryByText("Clinical indication:")).toBeNull();
    expect(within(modal).getByRole("button", { name: "Edit report requirement" }).textContent).toContain("Report required");
    expect(screen.queryByRole("link", { name: "Open current study" })).toBeNull();
    expect(within(modal).queryByRole("link", { name: "Patient studies" })).toBeNull();
    expect(within(modal).queryByRole("link", { name: "Patient studies in RadiAnt" })).toBeNull();
    expect(within(modal).getByRole("button", { name: "Patient history" })).toBeTruthy();
  });

  it("renders MRI primary-screening badges in the worklist and assignment header only for the MRI workflow", async () => {
    const mriAppointment = { ...appointment, modalityCode: "MRI" as const, modalityName: "MRI", modalitySafetyWorkflowType: "mri_primary_implant_screening" as const, mriPrimaryScreeningResult: "implant_reported_review_required" as const };
    mockFetchAppointments.mockResolvedValue([mriAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: mriAppointment, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    expect(await screen.findByText("MRI primary screening complete")).toBeTruthy();
    expect(screen.getByText("Implant reported — MRI staff review required")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(within(screen.getByRole("dialog", { name: "Assign protocol" })).getAllByText("MRI primary screening complete").length).toBeGreaterThan(0);
    expect(appointment.modalitySafetyWorkflowType).toBe("standard_acknowledgement");
  });

  it("does not render an MRI primary-screening badge for standard CT workflow", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await screen.findByRole("button", { name: "Assign" });
    expect(screen.queryByText("MRI primary screening complete")).toBeNull();
    expect(screen.queryByText("MRI primary screening not recorded")).toBeNull();
  });

  it("shows and edits No report required through the V2 appointment update", async () => {
    const noReportAppointment = { ...appointment, requiresReport: false };
    mockFetchAppointments.mockResolvedValue([noReportAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: noReportAppointment, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    const reportButton = within(screen.getByRole("dialog", { name: "Assign protocol" })).getByRole("button", { name: "Edit report requirement" });
    expect(reportButton.textContent).toContain("No report required");
    await userEvent.click(reportButton);
    expect(screen.getByRole("dialog", { name: "Edit report requirement" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "No" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(mockUpdateReportRequirement).toHaveBeenCalledWith(42, true));
    expect((await within(screen.getByRole("dialog", { name: "Assign protocol" })).findByRole("button", { name: "Edit report requirement" })).textContent).toContain("Report required");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["appointment-manage-modal", 42] }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["modality-worklist"] });
  });

  it("keeps the report editor and protocol form state open when the report update fails", async () => {
    mockUpdateReportRequirement.mockRejectedValue(new Error("Report update denied"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("radio", { name: "Free-text protocol" }));
    const protocol = screen.getByRole("textbox", { name: "Free-text protocol" });
    await userEvent.type(protocol, "Keep this protocol draft.");
    await userEvent.click(screen.getByRole("button", { name: "Edit report requirement" }));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(await screen.findByText("Report update denied")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Edit report requirement" })).toBeTruthy();
    expect((protocol as HTMLTextAreaElement).value).toBe("Keep this protocol draft.");
  });

  it("hides More protocol actions for a new blank assignment", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    expect(screen.queryByRole("button", { name: "More protocol actions" })).toBeNull();
  });

  it("shows printable and clear actions in an overflow-safe menu and closes after printing", async () => {
    const assignedAppointment = {
      ...appointment,
      assignment: {
        assignmentId: 77,
        protocolId: null,
        protocolVersionId: null,
        protocolName: null,
        versionNumber: null,
        scannerId: null,
        scannerName: null,
        protocolNotes: null,
        contrastNotes: null,
        freeTextProtocol: "Axial T2",
        status: "ASSIGNED" as const,
        assignedBy: 3,
        assignedAt: "2026-07-22T08:00:00Z",
      },
    };
    mockFetchAppointments.mockResolvedValue([assignedAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: assignedAppointment, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Change" }));
    await userEvent.click(screen.getByRole("button", { name: "More protocol actions" }));
    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(menu.className).toContain("fixed");
    expect(screen.getByRole("menuitem", { name: "Print protocol" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Clear assignment" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "More protocol actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Print protocol" }));
    expect(screen.queryByRole("menu")).toBeNull();
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
