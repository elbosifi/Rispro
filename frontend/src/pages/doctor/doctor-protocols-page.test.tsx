import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorMe, DoctorProtocolingAppointment } from "@/types/api";
import { t as translate, type TranslationKey } from "@/lib/i18n";
import { buildRadiantPacsTagUrl } from "./doctor-reporting-board-page.helpers";
import { DoctorProtocolsPage } from "./doctor-protocols-page";

function render(ui: ReactElement) {
  return renderTestingLibrary(<MemoryRouter>{ui}</MemoryRouter>);
}

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
  mriPrimaryScreeningImplantSite: null,
  mriPrimaryScreeningImplantDescription: null,
  mriPrimaryScreeningPreviousReviewerNameReported: null,
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
  phoneticMatchCount: 2, studyCount: 1, studies: [{ orthancStudyId: "old-study", studyInstanceUid: "1.2.3", accessionNumber: null, patientId: "OLD-77", patientName: "ALSIFI^SERAJ^ALI", patientBirthDate: "19800102", patientSex: "M", studyDate: "20240102", studyDescription: "Historical CT", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 20 }],
} as const;

const { mockCreateAssignment, mockFetchAppointments, mockFetchAppointmentDetail, mockFetchProtocolPolicy, mockFetchProtocolingPatientHistory, mockFetchHistoricalPacsCandidates, mockSearchHistoricalPacsPatientId, mockRequestReconciliation, mockGetAppointmentById, mockPatientSummary, mockRescheduleBooking, mockUpdateReportRequirement } = vi.hoisted(() => ({ mockCreateAssignment: vi.fn(), mockFetchAppointments: vi.fn(), mockFetchAppointmentDetail: vi.fn(), mockFetchProtocolPolicy: vi.fn(), mockFetchProtocolingPatientHistory: vi.fn(), mockFetchHistoricalPacsCandidates: vi.fn(), mockSearchHistoricalPacsPatientId: vi.fn(), mockRequestReconciliation:vi.fn(), mockGetAppointmentById: vi.fn(), mockPatientSummary: vi.fn(), mockRescheduleBooking: vi.fn(), mockUpdateReportRequirement: vi.fn() }));

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
  requestProtocolingPatientIdentityReconciliation:mockRequestReconciliation,
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
    mockRequestReconciliation.mockReset();mockRequestReconciliation.mockResolvedValue({job:{id:1,status:"queued"}});
  });

  it("selects the appointment from the appointmentId URL", async () => {
    renderTestingLibrary(<MemoryRouter initialEntries={["/doctor/protocols?appointmentId=42"]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider></MemoryRouter>);

    expect((await screen.findByTestId("protocoling-request-documents")).getAttribute("data-appointment-id")).toBe("42");
  });

  it("filters the worklist by appointment status and preserves waiting-first preference", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    const appointmentStatus = await screen.findByLabelText("Appointment status");
    expect((appointmentStatus as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("Scheduled")).toBeTruthy();

    const waitingFirst = screen.getByRole("checkbox", { name: "Waiting patients first" });
    expect(waitingFirst.hasAttribute("disabled")).toBe(false);
    await userEvent.click(waitingFirst);
    await waitFor(() => expect(mockFetchAppointments).toHaveBeenLastCalledWith(expect.objectContaining({ appointmentStatus: null, waitingFirst: true })));

    await userEvent.selectOptions(appointmentStatus, "completed");
    await waitFor(() => expect(mockFetchAppointments).toHaveBeenLastCalledWith(expect.objectContaining({ appointmentStatus: "completed", waitingFirst: false })));
    expect(waitingFirst.hasAttribute("disabled")).toBe(true);

    const protocolStatus = screen.getByLabelText("Protocol status");
    await userEvent.selectOptions(protocolStatus, "ASSIGNED");
    await waitFor(() => expect(mockFetchAppointments).toHaveBeenLastCalledWith(expect.objectContaining({ protocolStatus: "ASSIGNED", appointmentStatus: "completed", waitingFirst: false })));

    await userEvent.selectOptions(appointmentStatus, "");
    await waitFor(() => expect(mockFetchAppointments).toHaveBeenLastCalledWith(expect.objectContaining({ appointmentStatus: null, waitingFirst: true })));
  });

  it("refreshes the protocoling appointment worklist after ten seconds", async () => {
    vi.useFakeTimers();
    const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mockFetchAppointments.mock.calls.length).toBeGreaterThanOrEqual(2);
    view.unmount();
    vi.useRealTimers();
  });

  it("requires explicit confirmation before requesting Patient Identity Reconciliation",async()=>{mockFetchProtocolingPatientHistory.mockResolvedValue({pacsStatus:"available",historicalPacsIndexStatus:"ready",historicalPacsLastSuccessAt:null,canReconcilePatientIdentity:true,currentPatient:{id:9,patientId:"NEW-9",name:"Current Patient",birthDate:"1990-01-02"},items:[{appointmentId:null,orthancStudyId:"study-old",studyInstanceUid:"1.2.3.4",accessionNumber:"OLD-ACC",date:"2024-01-02",time:null,modalities:["CT"],description:"Historical CT",appointmentStatus:null,reportAvailable:false,source:"pacs_only",identityDiscrepancy:null,historicalPatientId:"OLD-9",historicalPatientName:"Old^Patient",historicalPatientBirthDate:"19800102",reconciliation:null}]});render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DoctorProtocolsPage me={me}/></QueryClientProvider>);await userEvent.click(await screen.findByRole("button",{name:"Assign"}));await userEvent.click(screen.getByRole("button",{name:"Patient history"}));await userEvent.click(await screen.findByRole("button",{name:"Reconcile patient identity"}));const dialog=screen.getByRole("heading",{name:"Patient Identity Reconciliation"}).closest<HTMLElement>('[role="dialog"]')!;expect(within(dialog).getByText(/Old\^Patient/)).toBeTruthy();expect(within(dialog).getByText(/Current Patient/)).toBeTruthy();const submit=within(dialog).getByRole("button",{name:"Reconcile patient identity"});expect(submit.hasAttribute("disabled")).toBe(true);await userEvent.click(within(dialog).getByRole("checkbox"));await userEvent.click(submit);await waitFor(()=>expect(mockRequestReconciliation).toHaveBeenCalledWith(42,"1.2.3.4","OLD-ACC"));expect(mockRequestReconciliation).toHaveBeenCalledTimes(1);});

  it("reconciles an automatic historical candidate using the selected study identity", async () => {
    const candidate = { ...historicalCandidate, patientName: "GROUP^NAME", patientBirthDate: "19700101", studies: [{ ...historicalCandidate.studies[0], studyInstanceUid: "1.2.auto", accessionNumber: "AUTO-ACC", patientId: "OLD-AUTO", patientName: "STUDY^LEVEL", patientBirthDate: "19881231" }] };
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: true, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: "1990-01-02" }, items: [{ appointmentId: 7, orthancStudyId: null, studyInstanceUid: null, accessionNumber: "RIS-ONLY", date: "2024-01-01", time: null, modalities: ["CT"], description: "RISpro only", appointmentStatus: "completed", reportAvailable: false, source: "rispro_only", identityDiscrepancy: null }] });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [candidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const section = screen.getByRole("region", { name: "Possible older PACS studies" });
    await userEvent.click(await within(section).findByRole("button", { name: "Reconcile patient identity" }));
    const dialog = screen.getByRole("heading", { name: "Patient Identity Reconciliation" }).closest<HTMLElement>('[role="dialog"]')!;
    expect(within(dialog).getByText(/Patient ID: OLD-AUTO/)).toBeTruthy();
    expect(within(dialog).getByText(/Patient name: STUDY\^LEVEL/)).toBeTruthy();
    expect(within(dialog).getByText(/DOB: 19881231/)).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: "Reconcile patient identity" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(submit);
    await waitFor(() => expect(mockRequestReconciliation).toHaveBeenCalledWith(42, "1.2.auto", "AUTO-ACC"));
  });

  it("hides completed reconciliation candidates and their empty possible-studies section", async () => {
    const candidate = { ...historicalCandidate, studies: [{ ...historicalCandidate.studies[0], studyDescription: "Reconciled candidate", reconciliation: { id: 1, operationType: "reconcile", status: "completed", oldPatientId: "OLD-77", failureCode: null } }] };
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [candidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Possible older PACS studies" })).toBeNull());
    expect(screen.queryByText("Reconciled candidate")).toBeNull();
  });

  it("keeps only actionable studies and their visible count in mixed candidates", async () => {
    const candidate = { ...historicalCandidate, studyCount: 2, studies: [{ ...historicalCandidate.studies[0], orthancStudyId: "reconciled", studyDescription: "Reconciled candidate", reconciliation: { id: 1, operationType: "reconcile", status: "completed", oldPatientId: "OLD-77", failureCode: null } }, { ...historicalCandidate.studies[0], orthancStudyId: "actionable", studyDescription: "Actionable candidate" }] };
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [candidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const section = await screen.findByRole("region", { name: "Possible older PACS studies" });
    expect(within(section).queryByText("Reconciled candidate")).toBeNull();
    expect(section.textContent).toContain("Actionable candidate");
    expect(within(section).getByText("1 possible study")).toBeTruthy();
  });

  it("keeps failed forward reconciliation actionable with Retry", async () => {
    const candidate = { ...historicalCandidate, studies: [{ ...historicalCandidate.studies[0], reconciliation: { id: 1, operationType: "reconcile", status: "failed", oldPatientId: "OLD-77", failureCode: "SAFE_FAILURE" } }] };
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: true, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: "1990-01-02" }, items: [] });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [candidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const section = await screen.findByRole("region", { name: "Possible older PACS studies" });
    expect(section.textContent).toContain("Historical CT");
    expect(within(section).getByText("Reconciliation failed")).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Retry reconciliation" })).toBeTruthy();
  });

  it("hides pending or failed reversals but shows a completed reversal", async () => {
    for (const [status, hidden] of [["queued", true], ["processing", true], ["failed", true], ["completed", false]] as const) {
      const candidate = { ...historicalCandidate, studies: [{ ...historicalCandidate.studies[0], reconciliation: { id: 1, operationType: "reverse", status, oldPatientId: "OLD-77", failureCode: status === "failed" ? "SAFE_FAILURE" : null } }] };
      mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [candidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
      const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
      await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
      await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
      if (hidden) await waitFor(() => expect(screen.queryByRole("region", { name: "Possible older PACS studies" })).toBeNull());
      else expect((await screen.findByRole("region", { name: "Possible older PACS studies" })).textContent).toContain("Historical CT");
      view.unmount();
    }
  });

  it("uses the same reconciliation dialog and endpoint for manual old Patient ID results", async () => {
    const candidate = { ...historicalCandidate, studies: [{ ...historicalCandidate.studies[0], studyInstanceUid: "1.2.manual", accessionNumber: "MANUAL-ACC" }] };
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: true, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: "1990-01-02" }, items: [] });
    mockSearchHistoricalPacsPatientId.mockResolvedValue([candidate]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Old PACS Patient ID" }), "OLD-77");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.click(await screen.findByRole("button", { name: "Reconcile patient identity" }));
    const dialog = screen.getByRole("heading", { name: "Patient Identity Reconciliation" }).closest<HTMLElement>('[role="dialog"]')!;
    expect(within(dialog).getByText(/StudyInstanceUID: 1.2.manual/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Reconcile patient identity" }));
    await waitFor(() => expect(mockRequestReconciliation).toHaveBeenCalledWith(42, "1.2.manual", "MANUAL-ACC"));
    await waitFor(() => expect(mockSearchHistoricalPacsPatientId).toHaveBeenCalledTimes(2));
  });

  it("shows queued, completed, and failed reconciliation states without hiding history or offering unnecessary actions", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({pacsStatus:"available",historicalPacsIndexStatus:"ready",historicalPacsLastSuccessAt:null,canReconcilePatientIdentity:true,currentPatient:{id:9,patientId:"NEW-9",name:"Current Patient",birthDate:"1990-01-02"},items:[
      {appointmentId:null,orthancStudyId:"current",studyInstanceUid:"1.current",accessionNumber:"CURRENT",date:"2024-01-01",time:null,modalities:["CT"],description:"Already current",appointmentStatus:null,reportAvailable:false,source:"pacs_only",identityDiscrepancy:null,historicalPatientId:"NEW-9",reconciliation:null},
      {appointmentId:null,orthancStudyId:"queued",studyInstanceUid:"1.queued",accessionNumber:"QUEUED",date:"2024-01-02",time:null,modalities:["CT"],description:"Queued study",appointmentStatus:null,reportAvailable:false,source:"pacs_only",identityDiscrepancy:null,historicalPatientId:"OLD-1",reconciliation:{id:1,status:"queued",oldPatientId:"OLD-1",operationType:"reconcile",failureCode:null}},
      {appointmentId:null,orthancStudyId:"done",studyInstanceUid:"1.done",accessionNumber:"DONE",date:"2024-01-03",time:null,modalities:["CT"],description:"Completed study",appointmentStatus:null,reportAvailable:false,source:"pacs_only",identityDiscrepancy:null,historicalPatientId:"NEW-9",reconciliation:{id:2,status:"completed",oldPatientId:"OLD-2",operationType:"reconcile",failureCode:null}},
      {appointmentId:null,orthancStudyId:"failed",studyInstanceUid:"1.failed",accessionNumber:"FAILED",date:"2024-01-04",time:null,modalities:["CT"],description:"Failed study",appointmentStatus:null,reportAvailable:false,source:"pacs_only",identityDiscrepancy:null,historicalPatientId:"OLD-3",reconciliation:{id:3,status:"failed",oldPatientId:"OLD-3",operationType:"reconcile",failureCode:"SAFE_FAILURE"}},
    ]});
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DoctorProtocolsPage me={me}/></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button",{name:"Assign"}));
    await userEvent.click(screen.getByRole("button",{name:"Patient history"}));
    expect(await screen.findByText("Reconciliation pending")).toBeTruthy();
    expect(screen.getByText(/Reconciled · Previous ID: OLD-2/)).toBeTruthy();
    expect(screen.getByText("Reconciliation failed")).toBeTruthy();
    expect(screen.getByText(/Already current/)).toBeTruthy();
    expect(screen.getByRole("button",{name:"Retry reconciliation"})).toBeTruthy();
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

  it("labels historical candidates as possible matches, opens RadiAnt by old Patient ID, and performs exact old Patient ID lookup", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", items: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [historicalCandidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    mockSearchHistoricalPacsPatientId.mockResolvedValue([{ ...historicalCandidate, classification: "exact", reasons: ["exact_patient_id"] }]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const panel = screen.getByRole("heading", { name: "Patient history" }).closest("aside")!;
    const history = within(panel);
    expect(await history.findByText("Possible older PACS studies")).toBeTruthy();
    expect(history.getByText("Search old PACS Patient ID")).toBeTruthy();
    expect(history.getByText("Possible patient match")).toBeTruthy();
    expect(history.getByText(/02\/01\/2024/)).toBeTruthy();
    expect(history.queryByText("20240102")).toBeNull();
    expect(history.getByText("2 series · 20 images")).toBeTruthy();
    const openOldStudies = history.getByRole("link", { name: "Open old studies in RadiAnt" });
    expect(openOldStudies.getAttribute("href")).toBe(buildRadiantPacsTagUrl("00100020", "OLD-77"));
    expect(history.queryByRole("button", { name: /Attach|Migrate|Merge|Remap/i })).toBeNull();
    await userEvent.click(history.getByText("Why this matched"));
    expect(history.getByText("fuzzy english name")).toBeTruthy();
    await userEvent.type(history.getByRole("textbox", { name: "Old PACS Patient ID" }), "OLD-77");
    await userEvent.click(history.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(mockSearchHistoricalPacsPatientId).toHaveBeenCalledWith(42, "OLD-77"));
    expect((await history.findAllByText(/Old Patient ID: OLD-77/)).length).toBeGreaterThanOrEqual(2);
    expect(history.getByText("Exact Patient ID match")).toBeTruthy();
  });

  it("hides historical candidate reconciliation without permission", async () => {
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: false, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: null }, items: [] });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [historicalCandidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const section = screen.getByRole("region", { name: "Possible older PACS studies" });
    expect(await within(section).findByText("Study UID: 1.2.3")).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "Reconcile patient identity" })).toBeNull();
  });

  it("distinguishes duplicate-looking historical studies and targets each Study UID", async () => {
    const studies = ["1.2.duplicate.one", "1.2.duplicate.two"].map((studyInstanceUid, index) => ({ ...historicalCandidate.studies[0], orthancStudyId: `resource-${index}`, studyInstanceUid, accessionNumber: "SAME-ACC", studyDate: "20240102", studyDescription: "Same study" }));
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: true, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: null }, items: [] });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [{ ...historicalCandidate, studyCount: 2, studies }], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const section = screen.getByRole("region", { name: "Possible older PACS studies" });
    for (const studyInstanceUid of ["1.2.duplicate.one", "1.2.duplicate.two"]) expect(within(section).getByText(`Study UID: ${studyInstanceUid}`)).toBeTruthy();
    const buttons = within(section).getAllByRole("button", { name: "Reconcile patient identity" });
    await userEvent.click(buttons[0]!);
    const firstDialog = screen.getByRole("heading", { name: "Patient Identity Reconciliation" }).closest<HTMLElement>('[role="dialog"]')!;
    expect(within(firstDialog).getByText(/StudyInstanceUID: 1.2.duplicate.one/)).toBeTruthy();
    await userEvent.click(within(firstDialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(buttons[1]!);
    const secondDialog = screen.getByRole("heading", { name: "Patient Identity Reconciliation" }).closest<HTMLElement>('[role="dialog"]')!;
    expect(within(secondDialog).getByText(/StudyInstanceUID: 1.2.duplicate.two/)).toBeTruthy();
  });

  it("applies forward and reversal state semantics to historical candidate studies", async () => {
    const stateStudy = (suffix: string, operationType: "reconcile" | "reverse", status: "queued" | "completed" | "failed") => ({ ...historicalCandidate.studies[0], orthancStudyId: suffix, studyInstanceUid: `1.${suffix}`, studyDescription: suffix, reconciliation: { id: suffix.length, status, oldPatientId: `OLD-${suffix}`, operationType, failureCode: status === "failed" ? "SAFE_FAILURE" : null } });
    const studies = [stateStudy("forward-queued", "reconcile", "queued"), stateStudy("forward-completed", "reconcile", "completed"), stateStudy("forward-failed", "reconcile", "failed"), stateStudy("reverse-queued", "reverse", "queued"), stateStudy("reverse-failed", "reverse", "failed"), stateStudy("reverse-completed", "reverse", "completed")];
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: true, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: null }, items: [] });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [{ ...historicalCandidate, studyCount: studies.length, studies }], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const section = screen.getByRole("region", { name: "Possible older PACS studies" });
    expect(await within(section).findByText("Reconciliation pending")).toBeTruthy();
    expect(section.textContent).toContain("forward-failed");
    expect(section.textContent).toContain("reverse-completed");
    expect(section.textContent).not.toContain("forward-completed");
    expect(section.textContent).not.toContain("reverse-queued");
    expect(section.textContent).not.toContain("reverse-failed");
    expect(within(section).getAllByRole("button", { name: "Retry reconciliation" })).toHaveLength(1);
    expect(within(section).getAllByRole("button", { name: "Reconcile patient identity" })).toHaveLength(1);
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
    expect(history.getByText("Searching old PACS records…")).toBeTruthy();
    expect(history.getByText("Patient history above is already available.")).toBeTruthy();
    expect(history.queryByText(/Old Patient ID: OLD-77/)).toBeNull();

    await act(async () => resolveHistorical({ historicalCandidates: [historicalCandidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null }));
    expect(await history.findByText(/Old Patient ID: OLD-77/)).toBeTruthy();
    expect(history.queryByText("Searching old PACS records…")).toBeNull();
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
    expect(await history.findByText("Old PACS search unavailable.")).toBeTruthy();
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

    expect(history.getByText("Searching old PACS records…")).toBeTruthy();
    expect(history.queryByText("No possible older PACS studies found.")).toBeNull();
    await act(async () => resolveHistorical({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null }));
    expect(await history.findByText("No possible older PACS studies found.")).toBeTruthy();
    expect(history.queryByText("Searching old PACS records…")).toBeNull();
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

  it("shows the MRI review warning and patient-reported screening details in the assignment modal", async () => {
    const mriAppointment = { ...appointment, modalityCode: "MRI" as const, modalityName: "MRI", modalitySafetyWorkflowType: "mri_primary_implant_screening" as const, mriPrimaryScreeningResult: "implant_reported_review_required" as const, mriPrimaryScreeningImplantSite: "Left hip", mriPrimaryScreeningImplantDescription: "Orthopedic fixation hardware", mriPrimaryScreeningPreviousReviewerNameReported: "Dr. Previous" };
    mockFetchAppointments.mockResolvedValue([mriAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: mriAppointment, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    expect(await screen.findByText("MRI primary screening complete")).toBeTruthy();
    expect(screen.getByText("Implant reported — MRI staff review required")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    const modal = screen.getByRole("dialog", { name: "Assign protocol" });
    expect(within(modal).getByText("MRI SAFETY REVIEW REQUIRED")).toBeTruthy();
    expect(within(modal).getByText("Implant/device site:").parentElement?.textContent).toContain("Left hip");
    expect(within(modal).getByText("Description:").parentElement?.textContent).toContain("Orthopedic fixation hardware");
    expect(within(modal).getByText("Previous reviewer reported by patient:").parentElement?.textContent).toContain("Dr. Previous");
    expect(within(modal).getByTestId("protocol-entry-pane").contains(within(modal).getByTestId("mri-primary-safety-panel"))).toBe(true);
    expect(appointment.modalitySafetyWorkflowType).toBe("standard_acknowledgement");
  });

  it("shows the negative primary-screening result without claiming MRI clearance", async () => {
    const mriAppointment = { ...appointment, modalityCode: "MRI" as const, modalityName: "MRI", modalitySafetyWorkflowType: "mri_primary_implant_screening" as const, mriPrimaryScreeningResult: "no_known_implant_reported" as const };
    mockFetchAppointments.mockResolvedValue([mriAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: mriAppointment, assignmentDetail: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    const modal = screen.getByRole("dialog", { name: "Assign protocol" });
    expect(within(modal).getByText("No known implant/device reported")).toBeTruthy();
    expect(within(modal).queryByText(/MRI cleared|Cleared for MRI|MRI safe/i)).toBeNull();
  });

  it("shows an MRI primary-screening warning when no screening is recorded", async () => {
    const mriAppointment = { ...appointment, modalityCode: "MRI" as const, modalityName: "MRI", modalitySafetyWorkflowType: "mri_primary_implant_screening" as const };
    mockFetchAppointments.mockResolvedValue([mriAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: mriAppointment, assignmentDetail: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    expect(within(screen.getByRole("dialog", { name: "Assign protocol" })).getByText("MRI PRIMARY SCREENING NOT RECORDED")).toBeTruthy();
  });

  it("does not render an MRI primary-screening badge for standard CT workflow", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await screen.findByRole("button", { name: "Assign" });
    expect(screen.queryByText("MRI primary screening complete")).toBeNull();
    expect(screen.queryByText("MRI primary screening not recorded")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(within(screen.getByRole("dialog", { name: "Assign protocol" })).queryByLabelText("MRI primary screening")).toBeNull();
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

  it("does not render overflow actions for a new blank assignment", async () => {
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

  it("keeps confirmed historical attestation evidence and reconciliation available", async () => {
    const candidate = { ...historicalCandidate, classification: "strong_demographic", studies: [{ ...historicalCandidate.studies[0], attestation: { studyInstanceUid: "1.2.3", status: "confirmed", recordedByUserId: 123, recordedByName: "Modality Staff", recordedAt: "2026-06-18T08:00:00Z" } }] };
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: true, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: null }, items: [] });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [candidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" })); await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const section = screen.getByRole("region", { name: "Possible older PACS studies" });
    expect(within(section).getByText("Strong demographic match")).toBeTruthy(); expect(within(section).getByText(/Patient confirmed/)).toBeTruthy(); expect(within(section).getByText(/Modality Staff/)).toBeTruthy(); expect(within(section).getByText(/18\/06\/2026/)).toBeTruthy(); expect(within(section).getByRole("button", { name: /Reconcile/ })).toBeTruthy();
  });

  it("keeps denied historical studies visible and reconciliation unchanged", async () => {
    const candidate = { ...historicalCandidate, studies: [{ ...historicalCandidate.studies[0], studyDescription: "Denied study", attestation: { studyInstanceUid: "1.2.3", status: "denied", recordedByUserId: 123, recordedByName: "Modality Staff", recordedAt: "2026-06-18T08:00:00Z" } }] };
    mockFetchProtocolingPatientHistory.mockResolvedValue({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, canReconcilePatientIdentity: true, currentPatient: { id: 9, patientId: "NEW-9", name: "Current Patient", birthDate: null }, items: [] });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [candidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" })); await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const section = screen.getByRole("region", { name: "Possible older PACS studies" });
    expect(within(section).getByText("Possible patient match")).toBeTruthy(); expect(within(section).getByText(/Patient denied ownership/)).toBeTruthy(); expect(within(section).getByText(/Denied study/)).toBeTruthy(); expect(within(section).getByRole("button", { name: /Reconcile/ })).toBeTruthy();
  });
});
