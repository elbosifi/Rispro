import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorMe, DoctorProtocolingAppointment, ProtocolAssignment } from "@/types/api";
import type { ProtocolLibraryCtPhaseRow, ProtocolLibraryCtTechniqueRow, ProtocolLibraryVersion, ProtocolLibraryVersionDetail } from "@/types/api";
import * as apiHooks from "@/lib/api-hooks";
import { t as translate, type TranslationKey } from "@/lib/i18n";
import { buildRadiantPatientUrl } from "@/lib/radiant";
import { DoctorProtocolsPage, ProtocolingAppointmentWorkspace } from "./doctor-protocols-page";
import { transcribeDictation } from "@/lib/medical-dictation-api";
import { DEFAULT_DICTATION_PREFERENCES, saveDictationPreferences } from "@/lib/dictation-preferences";

vi.mock("@/lib/medical-dictation-api", () => ({ transcribeDictation: vi.fn() }));

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

const { mockCreateAssignment, mockCancelAssignment, mockCreateComplementaryRecall, mockWithdrawComplementaryRecall, mockFetchAppointments, mockFetchAppointmentDetail, mockFetchProtocolPolicy, mockFetchProtocolingPatientHistory, mockFetchHistoricalPacsCandidates, mockSearchHistoricalPacsPatientId, mockRequestReconciliation, mockGetAppointmentById, mockPatientSummary, mockRescheduleBooking, mockUpdateProtocolExamType, mockUpdateReportRequirement, mockExamTypes } = vi.hoisted(() => ({ mockCreateAssignment: vi.fn(), mockCancelAssignment: vi.fn(), mockCreateComplementaryRecall: vi.fn(), mockWithdrawComplementaryRecall: vi.fn(), mockFetchAppointments: vi.fn(), mockFetchAppointmentDetail: vi.fn(), mockFetchProtocolPolicy: vi.fn(), mockFetchProtocolingPatientHistory: vi.fn(), mockFetchHistoricalPacsCandidates: vi.fn(), mockSearchHistoricalPacsPatientId: vi.fn(), mockRequestReconciliation:vi.fn(), mockGetAppointmentById: vi.fn(), mockPatientSummary: vi.fn(), mockRescheduleBooking: vi.fn(), mockUpdateProtocolExamType: vi.fn(), mockUpdateReportRequirement: vi.fn(), mockExamTypes: [{ id: 10, name: "CT Chest", nameEn: "CT Chest", nameAr: "صدر", code: "CTC", modalityId: 4, isActive: true }, { id: 11, name: "CT Chest Abdomen", nameEn: "CT Chest Abdomen", nameAr: "صدر وبطن", code: "CTCA", modalityId: 4, isActive: true }, { id: 12, name: "MRI Brain", nameEn: "MRI Brain", nameAr: "دماغ", code: "MRB", modalityId: 5, isActive: true }, { id: 13, name: "Inactive CT", nameEn: "Inactive CT", nameAr: "فحص غير نشط", code: "CTI", modalityId: 4, isActive: false }] }));

vi.mock("@/lib/api-hooks", () => ({
  activateProtocolLibraryVersion: vi.fn(), cancelDoctorProtocolAssignment: mockCancelAssignment, createDoctorProtocolAssignment: mockCreateAssignment,
  createComplementaryRecallRequest: mockCreateComplementaryRecall,
  withdrawComplementaryRecallRequest: mockWithdrawComplementaryRecall,
  createProtocolLibraryAnatomyRegion: vi.fn(), createProtocolLibraryCtPhasePreset: vi.fn(), createProtocolLibraryCtPhaseRow: vi.fn(),
  createProtocolLibraryDraftFromActive: vi.fn(), createProtocolLibraryMriSequencePreset: vi.fn(), createProtocolLibraryMriSequenceRow: vi.fn(),
  createProtocolLibraryProtocol: vi.fn(), deleteProtocolLibraryCtPhaseRow: vi.fn(), deleteProtocolLibraryMriSequenceRow: vi.fn(),
  deleteProtocolLibraryCtTechnique: vi.fn(), duplicateProtocolLibraryCtVersion: vi.fn(),
  confirmMriSequenceImport: vi.fn(), downloadMriSequenceImportTemplate: vi.fn(), exportMriSequencePresetsWorkbook: vi.fn(),
  confirmProtocolImport: vi.fn(), downloadProtocolImportTemplate: vi.fn(), inspectProtocolImport: vi.fn(), previewProtocolImport: vi.fn(),
  exportAllProtocolLibraryWorkbooks: vi.fn(), exportProtocolLibraryProtocolWorkbook: vi.fn(), exportProtocolLibraryVersionWorkbook: vi.fn(),
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
  upsertProtocolLibraryCtTechnique: vi.fn(),
  updateDoctorProtocolReportRequirement: mockUpdateReportRequirement,
  updateDoctorProtocolExamType: mockUpdateProtocolExamType,
}));

vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/lib/protocol-printing", () => ({ printProtocolSheet: vi.fn() }));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en", isArabic: false, t: (key: TranslationKey, params?: Record<string, string | number>) => translate("en", key, params) }) }));
vi.mock("@/v2/appointments/api", () => ({
  rescheduleV2Booking: mockRescheduleBooking,
  fetchV2Modalities: vi.fn(async () => []),
  useV2ExamTypes: () => ({ data: mockExamTypes, isLoading: false, isError: false }),
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

const activeFreeTextAssignment: ProtocolAssignment = {
  assignmentId: 701,
  protocolId: null,
  protocolVersionId: null,
  protocolName: null,
  versionNumber: null,
  scannerId: null,
  scannerName: null,
  protocolNotes: "Keep the patient-specific instructions.",
  contrastNotes: null,
  freeTextProtocol: "Axial T1 and T2 with contrast when indicated.",
  status: "ASSIGNED",
  assignedBy: 3,
  assignedAt: "2026-07-22T08:00:00.000Z",
};

function examUpdateResult(
  protocolDisposition: "kept" | "cleared" | "none" = "none",
  sourceAppointment: DoctorProtocolingAppointment = appointment,
) {
  return {
    booking: { examTypeId: 11 },
    detail: {
      appointment: {
        ...sourceAppointment,
        examTypeId: 11,
        examTypeName: "CT Chest Abdomen",
        protocolStatus: protocolDisposition === "cleared" ? "NOT_PROTOCOLLED" : sourceAppointment.protocolStatus,
        assignment: protocolDisposition === "cleared" ? null : sourceAppointment.assignment,
      },
      assignmentDetail: protocolDisposition === "cleared" ? null : sourceAppointment.assignment == null ? null : { assignment: sourceAppointment.assignment, ctPhases: [], mriSequences: [] },
    },
    protocolDisposition,
  };
}

function setActiveProtocolFixture() {
  const activeAppointment = {
    ...appointment,
    protocolStatus: "ASSIGNED" as const,
    assignment: activeFreeTextAssignment,
  };
  mockFetchAppointments.mockResolvedValue([activeAppointment]);
  mockFetchAppointmentDetail.mockResolvedValue({
    appointment: activeAppointment,
    assignmentDetail: { assignment: activeFreeTextAssignment, ctPhases: [], mriSequences: [] },
  });
  return activeAppointment;
}

function protocolImportConfirmCalls(): unknown[][] {
  return (apiHooks.confirmProtocolImport as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe("Doctor protocoling request documents", () => {
  beforeEach(() => {
    mockExamTypes.splice(0, mockExamTypes.length,
      { id: 10, name: "CT Chest", nameEn: "CT Chest", nameAr: "صدر", code: "CTC", modalityId: 4, isActive: true },
      { id: 11, name: "CT Chest Abdomen", nameEn: "CT Chest Abdomen", nameAr: "صدر وبطن", code: "CTCA", modalityId: 4, isActive: true },
      { id: 12, name: "MRI Brain", nameEn: "MRI Brain", nameAr: "دماغ", code: "MRB", modalityId: 5, isActive: true },
      { id: 13, name: "Inactive CT", nameEn: "Inactive CT", nameAr: "فحص غير نشط", code: "CTI", modalityId: 4, isActive: false },
    );
    mockFetchAppointments.mockResolvedValue([appointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment, assignmentDetail: null });
    mockFetchProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null });
    mockFetchAppointments.mockReset();
    mockFetchAppointmentDetail.mockReset();
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
    mockCreateComplementaryRecall.mockReset();
    mockCreateComplementaryRecall.mockResolvedValue({ recall: { id: 1, status: "pending_scheduling" } });
    mockWithdrawComplementaryRecall.mockReset();
    mockWithdrawComplementaryRecall.mockResolvedValue({ id: 1, status: "cancelled", recallAppointmentId: null });
    mockRescheduleBooking.mockReset();
    mockRescheduleBooking.mockResolvedValue({ booking: { id: 42, examTypeId: 11 } });
    mockUpdateProtocolExamType.mockReset();
    mockUpdateProtocolExamType.mockResolvedValue(examUpdateResult());
    mockUpdateReportRequirement.mockReset();
    mockUpdateReportRequirement.mockResolvedValue({ booking: { id: 42, requiresReport: true } });
    mockCancelAssignment.mockReset();
    mockCancelAssignment.mockResolvedValue({ success: true });
    mockRequestReconciliation.mockReset();mockRequestReconciliation.mockResolvedValue({job:{id:1,status:"queued"}});
  });

  it("selects the appointment from the appointmentId URL", async () => {
    renderTestingLibrary(<MemoryRouter initialEntries={["/doctor/protocols?appointmentId=42"]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider></MemoryRouter>);

    expect((await screen.findByTestId("protocoling-request-documents")).getAttribute("data-appointment-id")).toBe("42");
  });

  describe("protocol dictation", () => {
    const stopTrack = vi.fn();
    const cleaned = "Axial T1.\n\nNo contrast.";
    let mediaDevicesDescriptor: PropertyDescriptor | undefined;
    beforeEach(() => {
      localStorage.clear();
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
      vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      stopTrack.mockClear();
      class Recorder {
        static isTypeSupported() { return true; }
        state = "inactive";
        mimeType = "audio/webm";
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start() { this.state = "recording"; }
        stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["synthetic audio"]) }); this.onstop?.(); }
      }
      vi.stubGlobal("MediaRecorder", Recorder);
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
      vi.mocked(transcribeDictation).mockReset();
      vi.mocked(transcribeDictation).mockResolvedValue({ text: "Um axial T1 period new paragraph no contrast period</s>", processing_seconds: 1 });
      vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([]);
    });
    afterEach(() => {
      cleanup(); vi.mocked(document.hasFocus).mockRestore(); vi.unstubAllGlobals(); vi.mocked(window.scrollTo).mockRestore();
      if (mediaDevicesDescriptor) Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    });
    async function openAssignment() {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const view = render(<QueryClientProvider client={client}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
      await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
      return { ...view, client };
    }
    async function startRecording(label = "free-text protocol") {
      fireEvent.click(screen.getByRole("button", { name: `Dictate ${label}` }));
      await screen.findByText(/Recording.* 0 \/ 60/);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.queryByRole("textbox", { name: "Basic Cleaned Text" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Insert Text" })).toBeNull();
    }
    async function stopAndInsert(field: HTMLElement, expected = cleaned) {
      fireEvent.click(screen.getByRole("button", { name: /^Stop dictation$/ }));
      await waitFor(() => expect(field).toHaveProperty("value", expected));
      expect(mockCreateAssignment).not.toHaveBeenCalled();
    }

    it("holds the microphone icon and transcribes on release without restarting on click", async () => {
      await openAssignment();
      const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      const button = screen.getByRole("button", { name: "Dictate free-text protocol" });
      fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
      await screen.findByText(/Recording.* 0 \/ 60/);
      expect(transcribeDictation).not.toHaveBeenCalled();
      fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
      fireEvent.click(button, { detail: 1 });
      await waitFor(() => expect(field).toHaveProperty("value", cleaned));
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      expect(transcribeDictation).toHaveBeenCalledTimes(1); expect(mockCreateAssignment).not.toHaveBeenCalled();
    });
    it("recovers from releasing the microphone icon while first-time permission is pending", async () => {
      let grant!: (value: MediaStream) => void;
      vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise((resolve) => { grant = resolve; }));
      await openAssignment();
      const button = screen.getByRole("button", { name: "Dictate free-text protocol" });
      const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
      await screen.findByText(/Waiting for microphone permission/);
      fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
      fireEvent.click(button, { detail: 1 });
      await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream));
      expect(stopTrack).toHaveBeenCalled(); expect(transcribeDictation).not.toHaveBeenCalled();
      expect(screen.getByText(/Recording cancelled before/)).toBeTruthy();
      expect(button).toHaveProperty("disabled", false);
      fireEvent.pointerDown(button, { button: 0, pointerId: 2 });
      await screen.findByText(/Recording.* 0 \/ 60/);
      fireEvent.pointerUp(button, { button: 0, pointerId: 2 });
      await waitFor(() => expect(field).toHaveProperty("value", cleaned));
      expect(transcribeDictation).toHaveBeenCalledTimes(1); expect(mockCreateAssignment).not.toHaveBeenCalled();
    });

    it.each([
      ["free-text protocol", "Free-text protocol"],
      ["patient-specific instructions", "Protocol instructions"],
      ["contrast/preparation instructions", "Contrast/preparation instructions"],
    ])("dictates directly into the existing %s field without another editor or automatic save", async (buttonLabel, fieldLabel) => {
      if (buttonLabel !== "free-text protocol") vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([libraryProtocol]);
      const { client } = await openAssignment();
      if (buttonLabel !== "free-text protocol") await userEvent.click(screen.getByRole("button", { name: "Additional instructions" }));
      const field = screen.getByRole("textbox", { name: fieldLabel });
      const editors = screen.getAllByRole("textbox").length;
      await startRecording(buttonLabel); await stopAndInsert(field);
      expect(screen.getAllByRole("textbox")).toHaveLength(editors);
      fireEvent.change(field, { target: { value: cleaned + " Edited in place." } });
      expect(field).toHaveProperty("value", cleaned + " Edited in place.");
      expect(mockUpdateProtocolExamType).not.toHaveBeenCalled();
      expect(screen.getByRole("radio", { name: buttonLabel === "free-text protocol" ? "Free-text protocol" : "Saved protocol" }).getAttribute("aria-checked")).toBe("true");
      if (buttonLabel === "free-text protocol") {
        act(() => client.setQueryData(["doctor", "protocol-library", "protocols"], [libraryProtocol]));
        expect(screen.getByRole("radio", { name: "Free-text protocol" }).getAttribute("aria-checked")).toBe("true");
      }
      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.getByRole("heading", { name: "Discard unsaved changes?" })).toBeTruthy();
      expect(stopTrack).toHaveBeenCalled();
    });
    it.each([
      ["Before after", 7, 7, "Before Axial T1.\n\nNo contrast. after", 31],
      ["Before OLD after", 7, 10, "Before Axial T1.\n\nNo contrast. after", 30],
    ])("inserts at the captured cursor/selection in %j", async (original, start, end, expected, caret) => {
      await openAssignment();
      const field = screen.getByRole("textbox", { name: "Free-text protocol" }) as HTMLTextAreaElement;
      fireEvent.change(field, { target: { value: original } }); field.focus(); field.setSelectionRange(Number(start), Number(end)); fireEvent.select(field);
      await startRecording(); await stopAndInsert(field, String(expected));
      await waitFor(() => expect(field.selectionStart).toBe(caret));
    });
    it("appends when no cursor was captured and keeps the existing explicit Save shortcut", async () => {
      await openAssignment();
      const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      fireEvent.change(field, { target: { value: "Existing." } });
      await startRecording();
      await userEvent.keyboard("{Control>}s{/Control}{Control>}{Enter}{/Control}{Alt>}{ArrowRight}{/Alt}");
      expect(mockCreateAssignment).not.toHaveBeenCalled();
      await stopAndInsert(field, "Existing. " + cleaned);
      await userEvent.keyboard("{Control>}s{/Control}");
      await waitFor(() => expect(mockCreateAssignment).toHaveBeenCalledWith(42, expect.objectContaining({ freeTextProtocol: "Existing. " + cleaned })));
    });
    it("holds physical Right Shift, ignores repeat, and inserts directly on release", async () => {
      await openAssignment();
      const field = screen.getByRole("textbox", { name: "Free-text protocol" }); field.focus();
      fireEvent.keyDown(field, { code: "ShiftRight", key: "Shift", shiftKey: true });
      await screen.findByText(/Recording.* 0 \/ 60/);
      fireEvent.keyDown(window, { code: "ShiftRight", key: "Shift", shiftKey: true, repeat: true });
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      fireEvent.keyUp(window, { code: "ShiftRight", key: "Shift" });
      await waitFor(() => expect(field).toHaveProperty("value", cleaned));
      expect(transcribeDictation).toHaveBeenCalledTimes(1); expect(mockCreateAssignment).not.toHaveBeenCalled();
    });
    it("toggles F9 and accepts simultaneous SpeechMike commands without overlapping sessions", async () => {
      saveDictationPreferences({ ...DEFAULT_DICTATION_PREFERENCES, keyboardMode: "toggle", keyboardShortcut: { code: "F9", ctrl: false, alt: false, shift: false, meta: false }, speechMikeEnabled: true });
      await openAssignment(); const field = screen.getByRole("textbox", { name: "Free-text protocol" }); field.focus();
      fireEvent.keyDown(window, { code: "F9", key: "F9" }); fireEvent.keyUp(window, { code: "F9" });
      await screen.findByText(/Recording.* 0 \/ 60/);
      fireEvent.keyDown(window, { code: "F13", key: "F13" });
      fireEvent.keyDown(window, { code: "F9", key: "F9" }); fireEvent.keyUp(window, { code: "F9" });
      fireEvent.keyDown(window, { code: "F14", key: "F14" });
      await waitFor(() => expect(field).toHaveProperty("value", cleaned));
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1); expect(transcribeDictation).toHaveBeenCalledTimes(1);
    });
    it("requires a selected existing field for keyboard events and supports repeated SpeechMike sessions", async () => {
      saveDictationPreferences({ ...DEFAULT_DICTATION_PREFERENCES, keyboardEnabled: false, speechMikeEnabled: true });
      await openAssignment(); fireEvent.keyDown(window, { code: "F13", key: "F13" });
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
      expect(screen.getByText("Select a Protocoling text field before dictating.")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Additional instructions" }));
      const field = screen.getByRole("textbox", { name: "Protocol instructions" }); field.focus();
      for (let i = 1; i <= 2; i++) {
        fireEvent.keyDown(window, { code: "F13", key: "F13" }); await screen.findByText(/Recording.* 0 \/ 60/);
        fireEvent.keyDown(window, { code: "F14", key: "F14" });
        await waitFor(() => expect(field).toHaveProperty("value", Array(i).fill(cleaned).join(" ")));
      }
      expect(transcribeDictation).toHaveBeenCalledTimes(2); expect(mockCreateAssignment).not.toHaveBeenCalled();
    });
    it("can stop a mouse recording through SpeechMike", async () => {
      saveDictationPreferences({ ...DEFAULT_DICTATION_PREFERENCES, speechMikeEnabled: true });
      await openAssignment(); const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      await startRecording(); fireEvent.keyDown(window, { code: "F14", key: "F14" });
      await waitFor(() => expect(field).toHaveProperty("value", cleaned));
    });
    it.each(["hold", "toggle"] as const)("inserts SpeechMike Numpad + %s dictation at the cursor and keeps keyboard hold working", async (mode) => {
      saveDictationPreferences({ ...DEFAULT_DICTATION_PREFERENCES, speechMikeEnabled: true, speechMikeMode: mode });
      await openAssignment();
      const field = screen.getByRole("textbox", { name: "Free-text protocol" }) as HTMLTextAreaElement;
      fireEvent.change(field, { target: { value: "Before OLD after" } });
      field.focus(); field.setSelectionRange(7, 10); fireEvent.select(field);
      fireEvent.keyDown(window, { code: "NumpadAdd", key: "+" });
      await screen.findByText(/Recording.* 0 \/ 60/);
      fireEvent.keyDown(window, { code: "NumpadAdd", key: "+", repeat: true });
      fireEvent.keyUp(window, { code: "NumpadAdd", key: "+" });
      if (mode === "toggle") {
        expect(transcribeDictation).not.toHaveBeenCalled();
        fireEvent.keyDown(window, { code: "NumpadAdd", key: "+" });
        fireEvent.keyUp(window, { code: "NumpadAdd", key: "+" });
      }
      await waitFor(() => expect(field.value).toBe("Before " + cleaned + " after"));
      expect(transcribeDictation).toHaveBeenCalledTimes(1);
      field.focus();
      fireEvent.keyDown(window, { code: "ShiftRight", key: "Shift", shiftKey: true });
      await screen.findByText(/Recording.* 0 \/ 60/);
      fireEvent.keyUp(window, { code: "ShiftRight", key: "Shift" });
      await waitFor(() => expect(transcribeDictation).toHaveBeenCalledTimes(2));
      expect(mockCreateAssignment).not.toHaveBeenCalled();
    });
    it("releases a microphone granted after early key release without inserting or transcribing", async () => {
      let grant!: (value: MediaStream) => void;
      vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise((resolve) => { grant = resolve; }));
      saveDictationPreferences({ ...DEFAULT_DICTATION_PREFERENCES, keyboardShortcut: { code: "F9", ctrl: false, alt: false, shift: false, meta: false } });
      await openAssignment(); screen.getByRole("textbox", { name: "Free-text protocol" }).focus();
      fireEvent.keyDown(window, { code: "F9", key: "F9" });
      await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));
      fireEvent.keyUp(window, { code: "F9", key: "F9" });
      await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream));
      expect(stopTrack).toHaveBeenCalled(); expect(transcribeDictation).not.toHaveBeenCalled();
      expect(screen.getByText(/Recording cancelled before/)).toBeTruthy();
    });
    it("stops on browser focus loss and inserts into the original field", async () => {
      await openAssignment(); const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      await startRecording(); fireEvent.blur(window);
      await waitFor(() => expect(field).toHaveProperty("value", cleaned)); expect(stopTrack).toHaveBeenCalled();
    });
    it("keeps field text on failure and retries without duplicate requests", async () => {
      vi.mocked(transcribeDictation).mockRejectedValueOnce(new Error("MedASR is unavailable."));
      await openAssignment(); const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      fireEvent.change(field, { target: { value: "Keep this." } });
      await startRecording(); fireEvent.click(screen.getByRole("button", { name: /^Stop dictation$/ }));
      expect((await screen.findByRole("alert")).textContent).toContain("MedASR is unavailable.");
      expect(field).toHaveProperty("value", "Keep this.");
      const retry = screen.getByRole("button", { name: "Retry dictation" });
      fireEvent.click(retry); fireEvent.click(retry);
      await waitFor(() => expect(field).toHaveProperty("value", "Keep this. " + cleaned));
      expect(transcribeDictation).toHaveBeenCalledTimes(2);
    });
    it("shows microphone permission failures in place", async () => {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
      await openAssignment(); fireEvent.click(screen.getByRole("button", { name: "Dictate free-text protocol" }));
      expect((await screen.findByRole("alert")).textContent).toContain("Microphone access is unavailable");
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("textbox", { name: "Free-text protocol" })).toHaveProperty("value", "");
    });
    it.each(["Cancel", "Escape", "appointment close"])("discards audio on %s without changing or saving field contents", async (action) => {
      const view = await openAssignment(); await startRecording(); stopTrack.mockClear();
      if (action === "appointment close") view.unmount();
      else {
        if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" });
        else fireEvent.click(screen.getByRole("button", { name: "Cancel dictation" }));
        expect(screen.getByRole("textbox", { name: "Free-text protocol" })).toHaveProperty("value", "");
        expect(screen.getByRole("dialog", { name: "Assign protocol" })).toBeTruthy();
      }
      expect(stopTrack).toHaveBeenCalled(); expect(transcribeDictation).not.toHaveBeenCalled(); expect(mockCreateAssignment).not.toHaveBeenCalled();
    });
    it("discards a pending transcription on appointment navigation", async () => {
      let resolve!: (result: { text: string; processing_seconds: number }) => void;
      vi.mocked(transcribeDictation).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
      const next = { ...appointment, appointmentId: 43 };
      mockFetchAppointmentDetail.mockImplementation(async (id: number) => ({ appointment: id === 43 ? next : appointment, assignmentDetail: null }));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const workspace = (id: number) => <QueryClientProvider client={client}><ProtocolingAppointmentWorkspace appointmentId={id} canAssign onClose={vi.fn()} /></QueryClientProvider>;
      const view = render(workspace(42)); await screen.findByRole("textbox", { name: "Free-text protocol" });
      await startRecording(); fireEvent.click(screen.getByRole("button", { name: /^Stop dictation$/ }));
      await waitFor(() => expect(transcribeDictation).toHaveBeenCalledTimes(1));
      view.rerender(<MemoryRouter>{workspace(43)}</MemoryRouter>);
      await waitFor(() => expect(screen.getByTestId("protocoling-request-documents").getAttribute("data-appointment-id")).toBe("43"));
      await act(async () => resolve({ text: "Wrong patient period", processing_seconds: 1 }));
      expect(screen.getByRole("textbox", { name: "Free-text protocol" })).toHaveProperty("value", ""); expect(mockCreateAssignment).not.toHaveBeenCalled();
    });
    it("cancels a pending transcription and preserves edits typed in the existing field", async () => {
      let resolve!: (result: { text: string; processing_seconds: number }) => void;
      vi.mocked(transcribeDictation).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
      await openAssignment(); const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      await startRecording(); fireEvent.click(screen.getByRole("button", { name: /^Stop dictation$/ }));
      await waitFor(() => expect(transcribeDictation).toHaveBeenCalledTimes(1));
      fireEvent.change(field, { target: { value: "Typed while processing." } });
      fireEvent.click(screen.getByRole("button", { name: "Cancel dictation" }));
      await act(async () => resolve({ text: "Cancelled dictation period", processing_seconds: 1 }));
      expect(field).toHaveProperty("value", "Typed while processing."); expect(mockCreateAssignment).not.toHaveBeenCalled();
    });
    it("preserves text typed during recognition and appends when the captured range is no longer valid", async () => {
      let resolve!: (result: { text: string; processing_seconds: number }) => void;
      vi.mocked(transcribeDictation).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
      await openAssignment(); const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      await startRecording(); fireEvent.click(screen.getByRole("button", { name: /^Stop dictation$/ }));
      await waitFor(() => expect(transcribeDictation).toHaveBeenCalledTimes(1));
      fireEvent.change(field, { target: { value: "Typed while processing." } });
      await act(async () => resolve({ text: "no contrast period", processing_seconds: 1 }));
      expect(field).toHaveProperty("value", "Typed while processing. No contrast."); expect(mockCreateAssignment).not.toHaveBeenCalled();
    });
    it("inserts into the original field without stealing focus from another field", async () => {
      let resolve!: (result: { text: string; processing_seconds: number }) => void;
      vi.mocked(transcribeDictation).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
      await openAssignment(); const field = screen.getByRole("textbox", { name: "Free-text protocol" });
      await userEvent.click(screen.getByRole("button", { name: "Additional instructions" }));
      await startRecording(); fireEvent.click(screen.getByRole("button", { name: /^Stop dictation$/ }));
      await waitFor(() => expect(transcribeDictation).toHaveBeenCalledTimes(1));
      const notes = screen.getByRole("textbox", { name: "Protocol instructions" }); notes.focus();
      fireEvent.change(notes, { target: { value: "Continue typing here." } });
      await act(async () => resolve({ text: "no contrast period", processing_seconds: 1 }));
      expect(field).toHaveProperty("value", "No contrast.");
      await act(async () => new Promise<void>((done) => requestAnimationFrame(() => done())));
      expect(document.activeElement).toBe(notes); expect(notes).toHaveProperty("value", "Continue typing here.");
    });
  });

  it("renders the existing Protocoling workspace as an embedded single case without navigating or polling the worklist", async () => {
    const onClose = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ProtocolingAppointmentWorkspace appointmentId={42} canAssign onClose={onClose} /></QueryClientProvider>);

    expect((await screen.findByTestId("protocoling-request-documents")).getAttribute("data-appointment-id")).toBe("42");
    expect(mockFetchAppointmentDetail).toHaveBeenCalledWith(42);
    expect(mockFetchAppointments).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Patient history" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open appointment and patient details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Previous appointment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next appointment" })).toBeNull();
    expect(screen.queryByText("1 of 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign and next" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows embedded loading immediately and exposes a retryable detail error", async () => {
    mockFetchAppointmentDetail.mockRejectedValueOnce(new Error("Temporary appointment detail failure")).mockResolvedValue({ appointment, assignmentDetail: null });
    const onClose = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ProtocolingAppointmentWorkspace appointmentId={42} canAssign onClose={onClose} /></QueryClientProvider>);

    expect(screen.getByTestId("protocoling-appointment-workspace-shell")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading appointment protocol details");
    expect(mockFetchAppointments).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toContain("Temporary appointment detail failure");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect((await screen.findByTestId("protocoling-request-documents")).getAttribute("data-appointment-id")).toBe("42");
    expect(mockFetchAppointmentDetail).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("notifies the parent after a successful embedded report edit", async () => {
    const onUpdated = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ProtocolingAppointmentWorkspace appointmentId={42} canAssign onClose={vi.fn()} onUpdated={onUpdated} /></QueryClientProvider>);

    await screen.findByTestId("protocoling-request-documents");
    await userEvent.click(screen.getByRole("button", { name: "Edit report requirement" }));
    await userEvent.click(screen.getByLabelText("No"));
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(mockUpdateReportRequirement).toHaveBeenCalledWith(42, false));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
  });

  it("requires structured recall selections and sends their default metadata", async () => {
    const completedAppointment = { ...appointment, appointmentStatus: "completed" as const };
    mockFetchAppointments.mockResolvedValue([completedAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: completedAppointment, assignmentDetail: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Request additional imaging" }));
    const dialog = screen.getByRole("heading", { name: "Request additional imaging" }).closest('[role="dialog"]') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    if (!dialog) return;
    expect(within(dialog).getByRole("heading", { name: "Request additional imaging" })).toBeTruthy();
    expect((within(dialog).getByLabelText("Urgency") as HTMLSelectElement).value).toBe("routine");
    const submit = within(dialog).getByRole("button", { name: "Request additional imaging" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await userEvent.selectOptions(within(dialog).getByLabelText("Recall reason"), "missing_sequence_phase");
    await userEvent.selectOptions(within(dialog).getByLabelText("QA classification"), "acquisition_error");
    fireEvent.change(within(dialog).getByLabelText("Due date/time"), { target: { value: "2026-09-01T10:00" } });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "What additional imaging is needed?" }), "Repeat the delayed phase");
    expect(submit.hasAttribute("disabled")).toBe(true);
    const addToReport = within(dialog).getByRole("button", { name: /^Add to this report/ });
    await userEvent.click(addToReport);
    expect(addToReport.getAttribute("aria-pressed")).toBe("true");
    expect(submit.hasAttribute("disabled")).toBe(false);
    await userEvent.click(submit);

    await waitFor(() => expect(mockCreateComplementaryRecall).toHaveBeenCalledWith(42, {
      receptionInstruction: null,
      technologistInstruction: "Repeat the delayed phase",
      reasonCode: "missing_sequence_phase",
      qaClassification: "acquisition_error",
      urgency: "routine",
      dueAt: "2026-09-01T08:00:00.000Z",
      reportingDisposition: "supplement_original_report",
      requestedModalityId: null,
      requestedExamTypeId: null,
      originalReportDependency: "imaging_completed",
      notifyOnArrival: false,
      notifyOnImagingCompleted: false,
    }));
  });

  it("keeps the shared request entry point closed when an active recall exists", async () => {
    const activeAppointment = { ...appointment, appointmentStatus: "completed" as const, activeComplementaryRecall: { id: 8, status: "pending_scheduling" as const }, latestComplementaryRecall: { id: 8, status: "pending_scheduling" as const } };
    mockFetchAppointments.mockResolvedValue([activeAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: activeAppointment, assignmentDetail: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));

    expect(screen.queryByRole("button", { name: "Request additional imaging" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw request" })).toBeTruthy();
  });

  it("opens the shared withdrawal confirmation for a pending recall", async () => {
    const activeAppointment = { ...appointment, appointmentStatus: "completed" as const, activeComplementaryRecall: { id: 8, status: "pending_scheduling" as const }, latestComplementaryRecall: { id: 8, status: "pending_scheduling" as const } };
    mockFetchAppointments.mockResolvedValue([activeAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: activeAppointment, assignmentDetail: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    const dialog = screen.getByRole("heading", { name: "Withdraw additional imaging request" }).closest<HTMLElement>('[role="dialog"]')!;
    expect(within(dialog).getByText("Current status: Awaiting scheduling")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw request" }));

    await waitFor(() => expect(mockWithdrawComplementaryRecall).toHaveBeenCalledWith(8));
  });

  it("preserves the scheduled status badge and does not offer withdrawal", async () => {
    const activeAppointment = { ...appointment, appointmentStatus: "completed" as const, activeComplementaryRecall: { id: 9, status: "scheduled" as const }, latestComplementaryRecall: { id: 9, status: "scheduled" as const } };
    mockFetchAppointments.mockResolvedValue([activeAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: activeAppointment, assignmentDetail: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    expect((await screen.findAllByText("Additional imaging pending · Scheduled")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(screen.queryByRole("button", { name: "Request additional imaging" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw request" })).toBeNull();
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

  it("keeps the planned protocol scanner distinct from the MPPS performed device", async () => {
    const acquiredAppointment = {
      ...appointment,
      assignment: {
        assignmentId: 77,
        protocolId: 9,
        protocolVersionId: 10,
        protocolName: "Chest routine",
        versionNumber: 2,
        scannerId: 5,
        scannerName: "Planned CT",
        protocolNotes: null,
        contrastNotes: null,
        freeTextProtocol: null,
        status: "ASSIGNED" as const,
        assignedBy: 3,
        assignedByName: "Dr Current Author",
        assignedAt: "2026-07-22T08:00:00Z",
      },
      acquisitionSummary: {
        source: "mpps" as const,
        sourceAeTitle: "CT-PERFORMED",
        dicomDeviceId: 7,
        equipmentId: 12,
        equipmentName: "Performed CT",
        equipmentVendor: "Philips",
        equipmentModel: "Incisive",
        startedAt: "2026-07-22T09:00:00.000Z",
        endedAt: "2026-07-22T09:27:00.000Z",
        durationSeconds: 1620,
        performedStatus: "COMPLETED" as const,
        discontinuationReason: null,
      },
    };
    mockFetchAppointments.mockResolvedValue([acquiredAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: acquiredAppointment, assignmentDetail: { assignment: acquiredAppointment.assignment, ctPhases: [], mriSequences: [] } });

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    const performed = await screen.findByTestId("protocoling-performed-acquisition");
    expect(performed.textContent).toContain("Performed on: Performed CT");
    expect(performed.textContent).toContain("27 min");
    expect(screen.getByText(/Protocol scanner: Planned CT/)).toBeTruthy();
    expect(screen.getByText(/Protocol by Dr Current Author/).textContent).toContain("·");
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    const summary = screen.getByRole("heading", { name: "Assigned protocol summary" }).parentElement!;
    expect(within(summary).getByText(/Chest routine v2/)).toBeTruthy();
    expect(within(summary).getByText("Protocol by: Dr Current Author")).toBeTruthy();
    expect(within(summary).getByText(/Protocolled:/)).toBeTruthy();
  });

  it("shows a protocol timestamp on its own and the expanded search placeholder", async () => {
    const timestampOnlyAppointment = {
      ...appointment,
      assignment: {
        assignmentId: 78, protocolId: null, protocolVersionId: null, protocolName: null, versionNumber: null,
        scannerId: null, scannerName: null, protocolNotes: null, contrastNotes: null, freeTextProtocol: "Axial CT",
        status: "ASSIGNED" as const, assignedBy: null, assignedByName: null, assignedAt: "2026-07-22T08:00:00Z",
      },
    };
    mockFetchAppointments.mockResolvedValue([timestampOnlyAppointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: timestampOnlyAppointment, assignmentDetail: { assignment: timestampOnlyAppointment.assignment, ctPhases: [], mriSequences: [] } });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    expect((await screen.findByRole("textbox", { name: "Search protocoling appointments" })).getAttribute("placeholder")).toBe("Name, MRN, Primary ID, accession, phone, exam…");
    expect(await screen.findByText("Free-text protocol")).toBeTruthy();
    expect(screen.getByText(/Protocolled /)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    const summary = screen.getByRole("heading", { name: "Assigned protocol summary" }).parentElement!;
    expect(within(summary).getByText("Axial CT")).toBeTruthy();
    expect(within(summary).queryByText(/Protocol by:/)).toBeNull();
    expect(within(summary).getByText(/Protocolled:/)).toBeTruthy();
  });

  it("uses the standard DD/MM/YYYY date input while sending ISO date filters", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    const dateFrom = await screen.findByLabelText("From");
    expect(dateFrom.getAttribute("type")).toBe("text");
    await userEvent.clear(dateFrom);
    await userEvent.type(dateFrom, "01092026");
    await userEvent.tab();

    await waitFor(() => expect(mockFetchAppointments).toHaveBeenLastCalledWith(expect.objectContaining({ dateFrom: "2026-09-01" })));
    expect((dateFrom as HTMLInputElement).value).toBe("01/09/2026");
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
      { appointmentId: 11, orthancStudyId: "study-11", studyInstanceUid: "1.2.matched", accessionNumber: "V2-001111", date: "2026-08-16", time: "10:00", modalities: ["CT"], description: "Matched PACS CT", appointmentStatus: "completed", reportAvailable: false, source: "rispro_pacs" },
    ] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const row = (await screen.findByText(/Matched PACS CT/)).closest("div")!;

    expect(within(row).getByText("PACS")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "SonicDICOM" }).getAttribute("href")).toContain("/api/doctor/protocoling/appointments/11/open-sonicdicom?scope=study");
    expect(within(row).getByRole("link", { name: "RadiAnt" }).getAttribute("href")).toContain("0020000D");
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
    expect(openOldStudies.getAttribute("href")).toBe(buildRadiantPatientUrl("OLD-77"));
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

  it("exposes a retry button when patient history loading fails", async () => {
    mockFetchProtocolingPatientHistory.mockRejectedValueOnce(new Error("network error"));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={me} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));
    const history = within(screen.getByRole("heading", { name: "Patient history" }).closest("aside")!);

    expect(await history.findByText("Unable to load patient history.")).toBeTruthy();
    const retryButton = history.getByRole("button", { name: "Retry patient history" });
    expect(retryButton).toBeTruthy();

    mockFetchProtocolingPatientHistory.mockResolvedValueOnce({ pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, items: [] });
    await userEvent.click(retryButton);
    await waitFor(() => expect(mockFetchProtocolingPatientHistory).toHaveBeenCalledTimes(2));
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

    await userEvent.click(screen.getByRole("button", { name: "More protocol actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Clear assignment" }));
    expect(await screen.findByRole("heading", { name: "Clear protocol assignment?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear assignment" }));
    expect(mockCancelAssignment).toHaveBeenCalledWith(42);
  });

  it("prompts to discard unsaved changes through a dialog when closing", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Free-text protocol" }), "Axial T1");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Discard unsaved changes?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("dialog", { name: "Assign protocol" })).toBeNull();
  });

  it("edits examination type within the current modality and refreshes the header", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    const protocol = screen.getByRole("textbox", { name: "Free-text protocol" });
    await userEvent.type(protocol, "Unsaved protocol draft remains in the editor.");
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    expect(screen.getByRole("option", { name: /CT Chest Abdomen/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /MRI Brain/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Inactive CT/ })).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));

    await waitFor(() => expect(mockUpdateProtocolExamType).toHaveBeenCalledWith(42, 11, undefined));
    expect(mockRescheduleBooking).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Change examination type?" })).toBeNull();
    expect(await within(screen.getByRole("dialog", { name: "Assign protocol" })).findByText("CT Chest Abdomen")).toBeTruthy();
    expect((protocol as HTMLTextAreaElement).value).toBe("Unsaved protocol draft remains in the editor.");
    expect(screen.queryByRole("dialog", { name: /supervisor/i })).toBeNull();
  });

  it("allows clinical examination correction for a completed protocoling appointment", async () => {
    mockFetchAppointments.mockResolvedValue([{ ...appointment, appointmentStatus: "completed" }]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: { ...appointment, appointmentStatus: "completed" }, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    expect((screen.getByRole("button", { name: "Edit examination type" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks whether to keep or clear an active protocol and keeps free-text content when requested", async () => {
    const activeAppointment = setActiveProtocolFixture();
    mockUpdateProtocolExamType.mockResolvedValue(examUpdateResult("kept", activeAppointment));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Change" }));
    const protocol = screen.getByRole("textbox", { name: "Free-text protocol" }) as HTMLTextAreaElement;
    expect(protocol.value).toBe(activeFreeTextAssignment.freeTextProtocol);
    await userEvent.clear(protocol);
    await userEvent.type(protocol, "Unsaved protocol edits stay visible when keeping the assignment.");
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));

    const dialog = await screen.findByRole("dialog", { name: "Change examination type?" });
    expect(within(dialog).getByText(/already has an assigned protocol/i)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Change exam & keep protocol" }));

    await waitFor(() => expect(mockUpdateProtocolExamType).toHaveBeenCalledWith(42, 11, "keep"));
    expect(protocol.value).toBe("Unsaved protocol edits stay visible when keeping the assignment.");
  });

  it("clears the active protocol only after the explicit clear decision succeeds", async () => {
    const activeAppointment = setActiveProtocolFixture();
    let resolveUpdate: ((result: ReturnType<typeof examUpdateResult>) => void) | undefined;
    mockUpdateProtocolExamType.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Change" }));
    const protocol = screen.getByRole("textbox", { name: "Free-text protocol" }) as HTMLTextAreaElement;
    await userEvent.clear(protocol);
    await userEvent.type(protocol, "Unsubmitted protocol edit is protected until the server confirms clear.");
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));
    await userEvent.click(await screen.findByRole("button", { name: "Change exam & clear protocol" }));

    await waitFor(() => expect(mockUpdateProtocolExamType).toHaveBeenCalledWith(42, 11, "clear"));
    expect(protocol.value).toBe("Unsubmitted protocol edit is protected until the server confirms clear.");
    expect(screen.getByText("Current assignment")).toBeTruthy();
    await act(async () => { resolveUpdate?.(examUpdateResult("cleared", activeAppointment)); });
    await waitFor(() => expect(protocol.value).toBe(""));
    expect(screen.queryByText("Current assignment")).toBeNull();
  });

  it("cancels the protocol decision without changing the examination", async () => {
    setActiveProtocolFixture();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Change" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));
    const dialog = await screen.findByRole("dialog", { name: "Change examination type?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mockUpdateProtocolExamType).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Change examination type?" })).toBeNull();
    expect(screen.getByText("CT Chest", { exact: true, selector: "span" })).toBeTruthy();
  });

  it.each(["keep", "clear"] as const)("preserves active protocol editor state when %s correction fails", async (disposition) => {
    setActiveProtocolFixture();
    mockUpdateProtocolExamType.mockRejectedValue(new Error("Exam update denied"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Change" }));
    const protocol = screen.getByRole("textbox", { name: "Free-text protocol" }) as HTMLTextAreaElement;
    await userEvent.clear(protocol);
    await userEvent.type(protocol, "Keep this unsaved protocol text after failure.");
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));
    await userEvent.click(await screen.findByRole("button", { name: `Change exam & ${disposition} protocol` }));

    expect(await screen.findByText("Exam update denied")).toBeTruthy();
    expect(protocol.value).toBe("Keep this unsaved protocol text after failure.");
    expect(screen.getByText("Current assignment")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /supervisor/i })).toBeNull();
  });

  it("disables all protocol disposition actions while correction is pending and ignores duplicate attempts", async () => {
    setActiveProtocolFixture();
    mockUpdateProtocolExamType.mockReturnValue(new Promise(() => undefined));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Change" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));
    const dialog = await screen.findByRole("dialog", { name: "Change examination type?" });
    const keep = within(dialog).getByRole("button", { name: "Change exam & keep protocol" }) as HTMLButtonElement;
    await userEvent.click(keep);

    await waitFor(() => expect(mockUpdateProtocolExamType).toHaveBeenCalledTimes(1));
    expect(keep.disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Change exam & clear protocol" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Updating...", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Change examination type?" })).toBeTruthy();
    expect(mockUpdateProtocolExamType).toHaveBeenCalledTimes(1);
  });

  it("uses the server detail and synchronizes caches when the selected exam option disappears", async () => {
    let resolveUpdate: ((result: ReturnType<typeof examUpdateResult>) => void) | undefined;
    mockUpdateProtocolExamType.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const view = render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit examination type" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Examination type" }), "11");
    await userEvent.click(screen.getByRole("button", { name: "Update exam" }));
    await waitFor(() => expect(mockUpdateProtocolExamType).toHaveBeenCalledWith(42, 11, undefined));

    mockExamTypes.splice(1, 1);
    view.rerender(<MemoryRouter><QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider></MemoryRouter>);
    const serverAppointment = { ...appointment, examTypeId: 11, examTypeName: "Server-authoritative CT exam" };
    await act(async () => { resolveUpdate?.({ ...examUpdateResult("none"), detail: { appointment: serverAppointment, assignmentDetail: null } }); });

    expect(await screen.findByText("Server-authoritative CT exam", { exact: true, selector: "span" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Edit examination type" })).toBeNull();
    const cachedDetail = queryClient.getQueryData<{ appointment: DoctorProtocolingAppointment }>(["doctor", "protocoling", "appointments", 42]);
    expect(cachedDetail?.appointment.examTypeName).toBe("Server-authoritative CT exam");
    const cachedList = queryClient.getQueriesData<DoctorProtocolingAppointment[]>({ queryKey: ["doctor", "protocoling", "appointments"] })
      .map(([, data]) => data)
      .find((items) => items?.some((item) => item.appointmentId === 42));
    expect(cachedList?.find((item) => item.appointmentId === 42)?.examTypeName).toBe("Server-authoritative CT exam");
  });

  it("preserves entered protocol text when an examination update fails", async () => {
    mockUpdateProtocolExamType.mockRejectedValue(new Error("Exam update denied"));
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

  it("offers one modality-aware new protocol flow while preserving CT and MRI creation forms", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    expect(screen.getAllByRole("button", { name: "New protocol" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "New protocol" }));
    const chooser = screen.getByRole("dialog", { name: "New protocol" });
    expect(within(chooser).getByText("Select the imaging modality.")).toBeTruthy();
    expect(within(chooser).getByRole("button", { name: /CT protocol/ })).toBeTruthy();
    expect(within(chooser).getByRole("button", { name: /MRI protocol/ })).toBeTruthy();
    await userEvent.click(within(chooser).getByRole("button", { name: /CT protocol/ }));
    expect(screen.getByRole("textbox", { name: "Protocol name" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Indication" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Anatomy region" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "New protocol" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "New protocol" })).getByRole("button", { name: /MRI protocol/ }));
    expect(screen.getByRole("combobox", { name: "Anatomy region" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Category" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "IV contrast policy" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Oral contrast policy" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Bowel preparation" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Initial change summary" })).toBeTruthy();
  });
});

describe("Protocol workbook import controls", () => {
  it("shows the full-protocol XLSX controls only in Protocol Library administration", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    expect(screen.queryByRole("button", { name: "Download XLSX template" })).toBeNull();
    expect(screen.queryByText("Import protocols XLSX")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Library setup" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import / Export" }));
    expect(await screen.findByRole("button", { name: "Download XLSX template" })).toBeTruthy();
    expect(screen.getByText("Import protocols XLSX")).toBeTruthy();
    expect(screen.getByText(/saved as drafts and require review before activation/i)).toBeTruthy();
  });

  it("shows synchronization counts and requires explicit confirmation for deactivation", async () => {
    vi.mocked(apiHooks.inspectProtocolImport).mockClear();
    vi.mocked(apiHooks.previewProtocolImport).mockClear();
    vi.mocked(apiHooks.confirmProtocolImport).mockClear();
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([]);
    vi.mocked(apiHooks.inspectProtocolImport).mockResolvedValue({ format: "xlsx", sheets: [], unknownSheets: [], scope: "ALL_PROTOCOLS", authoritativeSync: true, legacy: false });
    vi.mocked(apiHooks.previewProtocolImport).mockResolvedValue({ protocolRows: [{ rowNumber: 2, protocolKey: "old", protocolName: "Old MRI", modality: "MRI", protocolId: 17, action: "deactivate_protocol", errors: [] }], ctPhaseRows: [], ctTechniqueRows: [], mriSequenceRows: [], summary: { protocols: 1, createProtocols: 1, updateProtocols: 2, unchangedProtocols: 4, deactivateProtocols: 1, ctPhases: 0, ctTechniques: 0, mriSequences: 0, errors: 0 }, scope: "ALL_PROTOCOLS", authoritativeSync: true, legacy: false, deactivationProtocolNames: ["Old MRI"], canConfirm: true });
    vi.mocked(apiHooks.confirmProtocolImport).mockResolvedValue({ createdProtocols: 1, updatedProtocols: 2, unchangedProtocols: 4, deactivatedProtocols: 1, alreadyInactiveProtocols: 0, createdCtProtocols: 1, createdMriProtocols: 0, createdCtPhases: 0, updatedCtPhases: 0, removedCtPhases: 0, createdCtTechniques: 0, updatedCtTechniques: 0, removedCtTechniques: 0, createdMriSequenceRows: 0, updatedMriSequenceRows: 0, removedMriSequenceRows: 0 });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(screen.getByRole("button", { name: "Library setup" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import / Export" }));
    const file = new File(["xlsx"], "protocols.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByLabelText("Import protocols XLSX"), { target: { files: [file] } });
    await waitFor(() => expect(apiHooks.inspectProtocolImport).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole("button", { name: "Preview import" }));
    expect(screen.getByText("Create")).toBeTruthy();
    expect(screen.getByText("Deactivate")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    expect(screen.getByRole("heading", { name: "Apply protocol library synchronization?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(apiHooks.confirmProtocolImport).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm import" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply synchronization" }));
    await waitFor(() => expect(protocolImportConfirmCalls().at(-1)?.[0]).toEqual(expect.objectContaining({ confirmMissingProtocolDeactivation: true })));
    expect(screen.getByText("Protocol synchronization applied: 1 created, 2 updated, 4 unchanged, 1 deactivated.")).toBeTruthy();
  });

  it("confirms a synchronized workbook directly when no protocols are deactivated", async () => {
    vi.mocked(apiHooks.inspectProtocolImport).mockClear();
    vi.mocked(apiHooks.previewProtocolImport).mockClear();
    vi.mocked(apiHooks.confirmProtocolImport).mockClear();
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([]);
    vi.mocked(apiHooks.inspectProtocolImport).mockResolvedValue({ format: "xlsx", sheets: [], unknownSheets: [], scope: "SINGLE_PROTOCOL", authoritativeSync: false, legacy: false });
    vi.mocked(apiHooks.previewProtocolImport).mockResolvedValue({ protocolRows: [], ctPhaseRows: [], ctTechniqueRows: [], mriSequenceRows: [], summary: { protocols: 0, createProtocols: 0, updateProtocols: 0, unchangedProtocols: 0, deactivateProtocols: 0, ctPhases: 0, ctTechniques: 0, mriSequences: 0, errors: 0 }, scope: "SINGLE_PROTOCOL", authoritativeSync: false, legacy: false, deactivationProtocolNames: [], canConfirm: true });
    vi.mocked(apiHooks.confirmProtocolImport).mockResolvedValue({ createdProtocols: 0, updatedProtocols: 0, unchangedProtocols: 0, deactivatedProtocols: 0, alreadyInactiveProtocols: 0, createdCtProtocols: 0, createdMriProtocols: 0, createdCtPhases: 0, updatedCtPhases: 0, removedCtPhases: 0, createdCtTechniques: 0, updatedCtTechniques: 0, removedCtTechniques: 0, createdMriSequenceRows: 0, updatedMriSequenceRows: 0, removedMriSequenceRows: 0 });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(screen.getByRole("button", { name: "Library setup" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import / Export" }));
    const file = new File(["xlsx"], "protocol.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByLabelText("Import protocols XLSX"), { target: { files: [file] } });
    await waitFor(() => expect(apiHooks.inspectProtocolImport).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole("button", { name: "Preview import" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm import" }));
    await waitFor(() => expect(protocolImportConfirmCalls()[0]?.[0]).toEqual(expect.objectContaining({ confirmMissingProtocolDeactivation: false })));
    expect(screen.queryByRole("heading", { name: "Apply protocol library synchronization?" })).toBeNull();
  });
});

const libraryProtocol = {
  id: 101,
  name: "Liver Multiphasic CT",
  modality: "CT" as const,
  anatomyRegionId: null,
  anatomyRegionName: "Liver",
  category: "General",
  indication: "Characterize focal liver lesion",
  contrastPolicy: null,
  oralContrastPolicy: null,
  bowelPreparation: null,
  preparationNotes: null,
  activeVersionId: 202,
  activeVersionNumber: "1.7",
  activeVersionStatus: "ACTIVE" as const,
  latestDraftVersionId: null,
  latestDraftVersionNumber: null,
  isActive: true,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

const phase = (id: number, orderIndex: number, name: string, timingType: "NON_CONTRAST" | "BOLUS_TRACKING" = "BOLUS_TRACKING") => ({
  id,
  protocolVersionId: 201,
  orderIndex,
  ctPhasePresetId: null,
  ctPhasePresetName: null,
  presetContrastStatus: null,
  presetTimingType: null,
  presetDelaySeconds: null,
  presetBolusTrackingSite: null,
  presetTriggerHu: null,
  presetDefaultCoverage: null,
  presetReconstructionNotes: null,
  presetInstructions: null,
  customPhaseName: name,
  timingOverride: null,
  timingType,
  delaySeconds: null,
  bolusTrackingSite: timingType === "BOLUS_TRACKING" ? "Abdominal aorta" : null,
  triggerHu: timingType === "BOLUS_TRACKING" ? 150 : null,
  postTriggerDelaySeconds: timingType === "BOLUS_TRACKING" ? 18 : null,
  coverageOverride: "Liver dome to lower margin",
  reconstructionOverride: null,
  instructionsOverride: null,
  isRequired: true,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
});

const draftVersion: ProtocolLibraryVersion = { id: 201, protocolId: 101, versionNumber: "1.0", status: "DRAFT", changeSummary: "Initial protocol version", protocolNotes: null, createdBy: 1, approvedBy: null, approvedAt: null, retiredAt: null, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" };
const activeVersion: ProtocolLibraryVersion = { ...draftVersion, id: 202, versionNumber: "1.7", status: "ACTIVE", changeSummary: "Approved liver multiphasic protocol", protocolNotes: "Use for characterization of indeterminate focal liver lesions." };
const technique: ProtocolLibraryCtTechniqueRow = { id: 301, protocolVersionId: 202, scannerId: 401, scannerName: "GE Revolution CT", scannerVendor: "GE Healthcare", scannerModel: "Revolution CT", kvMode: "FIXED", kvp: 120, tubeCurrentMode: "AUTOMATIC", fixedMa: null, referenceMas: null, exposureControl: "SmartmA", noiseIndex: 25, minMa: 100, maxMa: 500, reconstructionMethod: "ASiR-V", reconstructionStrength: "40", reconstructionImageDefinition: null, sliceThicknessMm: 1.25, reconstructionIntervalMm: 0.625, kernel: "STANDARD", createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" };

function libraryDetail(version: ProtocolLibraryVersion = draftVersion, phases?: ProtocolLibraryCtPhaseRow[], techniques: ProtocolLibraryCtTechniqueRow[] = []): ProtocolLibraryVersionDetail {
  const phaseRows = phases ?? [phase(1, 1, "Noncontrast", "NON_CONTRAST"), phase(2, 2, "Arterial"), phase(3, 3, "Portal venous"), phase(4, 4, "Delayed")];
  return { protocol: { ...libraryProtocol, activeVersionId: version.status === "ACTIVE" ? version.id : null, activeVersionNumber: version.status === "ACTIVE" ? version.versionNumber : null, activeVersionStatus: version.status === "ACTIVE" ? "ACTIVE" : null, latestDraftVersionId: version.status === "DRAFT" ? version.id : null, latestDraftVersionNumber: version.status === "DRAFT" ? version.versionNumber : null }, version, ctPhases: phaseRows, mriSequences: [], ctTechniques: techniques };
}

describe("CT protocol library workbench", () => {
  beforeEach(() => {
    mockFetchAppointments.mockResolvedValue([appointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment, assignmentDetail: null });
    mockFetchProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null });
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([libraryProtocol]);
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail());
    vi.mocked(apiHooks.fetchProtocolLibraryAnatomyRegions).mockResolvedValue([]);
    vi.mocked(apiHooks.fetchProtocolLibraryScanners).mockResolvedValue([{ id: 401, name: "GE Revolution CT", modality: "CT", vendor: "GE Healthcare", model: "Revolution CT", fieldStrength: null, ctSliceDetectorSpecification: null, location: null, notes: null, isActive: true, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" }]);
    vi.mocked(apiHooks.fetchProtocolLibraryCtPhasePresets).mockResolvedValue([]);
    vi.mocked(apiHooks.fetchProtocolLibraryMriSequencePresets).mockResolvedValue([]);
    vi.mocked(apiHooks.createProtocolLibraryProtocol).mockResolvedValue({ protocol: libraryProtocol, version: draftVersion });
    vi.mocked(apiHooks.activateProtocolLibraryVersion).mockResolvedValue(libraryDetail(activeVersion));
    vi.mocked(apiHooks.deleteProtocolLibraryCtPhaseRow).mockResolvedValue(libraryDetail());
  });

  it("renders the clinical protocol list with contrast and combined version status", async () => {
    const activeOnly = { ...libraryProtocol, id: 101, name: "Brain acute", anatomyRegionName: "Brain", category: "General", indication: "Trauma and stroke imaging", contrastPolicy: "Non-contrast" };
    const draftOnly = { ...libraryProtocol, id: 102, name: "Brain tumor", anatomyRegionName: "Brain", category: "Oncology", indication: "Tumor and infection assessment", contrastPolicy: "With IV contrast", activeVersionId: null, activeVersionNumber: null, activeVersionStatus: null, latestDraftVersionId: 302, latestDraftVersionNumber: "1.0" };
    const activeAndDraft = { ...libraryProtocol, id: 103, name: "CAP oncology", anatomyRegionName: "Chest / abdomen / pelvis", category: "Oncology", indication: "Staging and treatment response", contrastPolicy: "With IV contrast", activeVersionNumber: "2.0", latestDraftVersionId: 303, latestDraftVersionNumber: "2.1" };
    const inactive = { ...libraryProtocol, id: 104, name: "Inactive protocol", isActive: false };
    const noVersion = { ...libraryProtocol, id: 105, name: "No version protocol", activeVersionId: null, activeVersionNumber: null, activeVersionStatus: null, latestDraftVersionId: null, latestDraftVersionNumber: null };
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([activeOnly, draftOnly, activeAndDraft, inactive, noVersion]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));

    expect(await screen.findByRole("heading", { name: "Protocols" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Protocol" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Contrast" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Indication" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Active version" })).toBeNull();
    expect(within(screen.getByRole("row", { name: /Brain acute/ })).getByText("Non-contrast")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Brain acute/ })).getByText(/ACTIVE.*v1\.7/)).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Brain tumor/ })).getByText("DRAFT")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Brain tumor/ })).getByText("Needs activation")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /CAP oncology/ })).getByText("DRAFT CHANGES PENDING")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Inactive protocol/ })).getByText("INACTIVE")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /No version protocol/ })).getByText("NO VERSION")).toBeTruthy();
  });

  it("searches protocol name and clinical metadata while retaining compact filters", async () => {
    const rows = [
      { ...libraryProtocol, id: 201, name: "Name match", indication: "Routine follow-up", anatomyRegionName: "Liver", category: "General", contrastPolicy: "Non-contrast" },
      { ...libraryProtocol, id: 202, name: "Indication match", indication: "Stroke triage", anatomyRegionName: "Brain", category: "General", contrastPolicy: "With IV contrast" },
      { ...libraryProtocol, id: 203, name: "Anatomy match", indication: "Routine follow-up", anatomyRegionName: "Knee", category: "General", contrastPolicy: "Non-contrast" },
      { ...libraryProtocol, id: 204, name: "Category match", indication: "Routine follow-up", anatomyRegionName: "Chest", category: "Oncology", contrastPolicy: "Non-contrast" },
      { ...libraryProtocol, id: 205, name: "Contrast match", indication: "Routine follow-up", anatomyRegionName: "Pelvis", category: "General", contrastPolicy: "Dynamic contrast" },
      { ...libraryProtocol, id: 206, name: "MRI filter", modality: "MRI" as const, indication: "Routine follow-up", anatomyRegionName: "Brain", category: "General", contrastPolicy: "Non-contrast" },
      { ...libraryProtocol, id: 207, name: "Draft filter", activeVersionId: null, activeVersionNumber: null, activeVersionStatus: null, latestDraftVersionId: 307, latestDraftVersionNumber: "1.0" },
    ];
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue(rows);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    const search = await screen.findByRole("textbox", { name: "Search protocols" });

    for (const [term, name] of [["name match", "Name match"], ["stroke triage", "Indication match"], ["knee", "Anatomy match"], ["oncology", "Category match"], ["dynamic contrast", "Contrast match"]]) {
      await userEvent.clear(search);
      await userEvent.type(search, term);
      expect(screen.getByRole("row", { name: new RegExp(name) })).toBeTruthy();
    }
    await userEvent.clear(search);
    expect(screen.getByRole("row", { name: /MRI filter/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Draft filter/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^CT$/ }));
    expect(screen.queryByRole("row", { name: /MRI filter/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^MRI$/ }));
    expect(screen.getByRole("row", { name: /MRI filter/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /Name match/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Active$/ }));
    expect(screen.getByRole("row", { name: /MRI filter/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /Draft filter/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Draft$/ }));
    expect(screen.getByRole("row", { name: /Draft filter/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /MRI filter/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^All$/ }));
    expect(screen.getByRole("row", { name: /MRI filter/ })).toBeTruthy();
  });

  it("keeps row actions in an accessible overflow menu and confirms deactivation", async () => {
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([libraryProtocol]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));

    const more = await screen.findByRole("button", { name: "More actions for Liver Multiphasic CT" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Deactivate protocol" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Deactivate protocol" }));
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("heading", { name: "Deactivate protocol?" })).toBeTruthy();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(apiHooks.updateProtocolLibraryProtocol).not.toHaveBeenCalled();
  });

  it("offers all, protocol, and exact-version XLSX exports through the typed download helpers", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(screen.getByRole("button", { name: "Library setup" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import / Export" }));
    await userEvent.click(await screen.findByRole("button", { name: "Export all protocols XLSX" }));
    expect(apiHooks.exportAllProtocolLibraryWorkbooks).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Export Liver Multiphasic CT XLSX" }));
    expect(vi.mocked(apiHooks.exportProtocolLibraryProtocolWorkbook).mock.calls[0]?.[0]).toBe(101);
    await userEvent.click(screen.getByRole("button", { name: "Protocols" }));
    await userEvent.click(screen.getByRole("button", { name: /^Open Liver Multiphasic CT$/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Export this version XLSX" }));
    expect(vi.mocked(apiHooks.exportProtocolLibraryVersionWorkbook).mock.calls[0]?.[0]).toBe(201);
  });

  it("shows download failures instead of silently ignoring them", async () => {
    vi.mocked(apiHooks.exportAllProtocolLibraryWorkbooks).mockRejectedValueOnce(new Error("Workbook download failed"));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(screen.getByRole("button", { name: "Library setup" }));
    await userEvent.click(await screen.findByRole("button", { name: "Import / Export" }));
    await userEvent.click(await screen.findByRole("button", { name: "Export all protocols XLSX" }));

    expect(await screen.findByText("Workbook download failed")).toBeTruthy();
  });

  it("renders the empty draft as a phase-first workspace with disabled publish", async () => {
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([]);
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail(draftVersion, []));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(screen.getByRole("button", { name: "New protocol" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "New protocol" })).getByRole("button", { name: /CT protocol/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Protocol name" }), "Liver Multiphasic CT");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByTestId("protocol-builder")).toBeTruthy();
    expect(screen.getByText("Internal protocol notes")).toBeTruthy();
    expect(screen.getByText("No phases yet")).toBeTruthy();
    expect(screen.getByText("Build this CT protocol by adding acquisitions in scan order.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish protocol" })).toHaveProperty("disabled", true);
    expect(screen.queryByText("CT protocol summary")).toBeNull();
  });

  it("renders phase readbacks and scanner summaries without duplicating the protocol summary", async () => {
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail(activeVersion, undefined, [technique]));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Open Liver Multiphasic CT$/ }));
    expect(await screen.findByText("Liver Multiphasic CT")).toBeTruthy();
    expect(screen.getByText("Portal venous")).toBeTruthy();
    expect(screen.getAllByText("Bolus tracking · Abdominal aorta · 150 HU · +18 sec").length).toBeGreaterThan(0);
    expect(screen.getByText("1 scanner configured")).toBeTruthy();
    expect(screen.queryByText("CT protocol summary")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Internal protocol notes" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Advanced technique/ }));
    expect(screen.getByText("120 kVp · SmartmA · NI 25 · 100–500 mA · ASiR-V 40% · 1.25 / 0.625 mm · STANDARD")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "← Back to protocols" }));
    expect(await screen.findByRole("columnheader", { name: "Protocol" })).toBeTruthy();
  });

  it("shows resulting revision versions and exact duplicate source context", async () => {
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail(activeVersion, undefined, [technique]));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Open Liver Multiphasic CT$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create revision" }));
    expect(screen.getByRole("heading", { name: "Create revision" })).toBeTruthy();
    expect(screen.getByText("Creates v1.8")).toBeTruthy();
    expect(screen.getByText("Creates v2.0")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(screen.getByRole("heading", { name: "Duplicate protocol" })).toBeTruthy();
    expect(screen.getByText("Source: Liver Multiphasic CT · v1.7 · ACTIVE")).toBeTruthy();
    expect(screen.getByText("4 CT phases · 1 scanner technique")).toBeTruthy();
  });

  it("confirms phase removal through a shared dialog", async () => {
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Open Liver Multiphasic CT$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Arterial phase" }));
    expect(screen.getByRole("heading", { name: "Remove Arterial phase?" })).toBeTruthy();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove phase" }));
    await waitFor(() => expect(apiHooks.deleteProtocolLibraryCtPhaseRow).toHaveBeenCalledWith(201, 2));
  });

  it("shows publish review content for a populated draft", async () => {
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([{ ...libraryProtocol, activeVersionId: null, activeVersionNumber: null, activeVersionStatus: null, latestDraftVersionId: 201, latestDraftVersionNumber: "1.0" }]);
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail(draftVersion, undefined, [technique]));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Open Liver Multiphasic CT$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Publish protocol" }));
    expect(screen.getByRole("heading", { name: "Publish protocol?" })).toBeTruthy();
    expect(screen.getByText("Liver Multiphasic CT · v1.0")).toBeTruthy();
    expect(screen.getByText("4 CT phases · 1 scanner technique")).toBeTruthy();
    expect(screen.getByText("This version will become the active protocol used for future assignments.")).toBeTruthy();
  });

  it("confirms scanner-technique removal through a shared dialog", async () => {
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([{ ...libraryProtocol, activeVersionId: null, activeVersionNumber: null, activeVersionStatus: null, latestDraftVersionId: 201, latestDraftVersionNumber: "1.0" }]);
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail(draftVersion, undefined, [technique]));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Open Liver Multiphasic CT$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Advanced technique/ }));
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    expect(screen.getByRole("heading", { name: "Remove GE Revolution CT technique?" })).toBeTruthy();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Remove GE Revolution CT technique?" })).toBeNull();
  });

  it("protects dirty Advanced Technique edits before collapsing", async () => {
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail(draftVersion, undefined, [technique]));
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([{ ...libraryProtocol, activeVersionId: null, activeVersionNumber: null, activeVersionStatus: null, latestDraftVersionId: 201, latestDraftVersionNumber: "1.0" }]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={{ ...me, canSupervise: true }} /></QueryClientProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Protocol Library" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Open Liver Multiphasic CT$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Advanced technique/ }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Noise Index"));
    await userEvent.type(screen.getByLabelText("Noise Index"), "30");
    await userEvent.click(screen.getByRole("button", { name: /Advanced technique/ }));
    expect(screen.getByRole("heading", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect((screen.getByLabelText("Noise Index") as HTMLInputElement).value).toBe("30");
  });
});

describe("Doctor protocoling usability enhancements", () => {
  beforeEach(() => {
    mockFetchAppointments.mockReset();
    mockFetchAppointmentDetail.mockReset();
    mockFetchAppointments.mockResolvedValue([appointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment, assignmentDetail: null });
    mockFetchProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null });
    mockFetchProtocolingPatientHistory.mockResolvedValue({ items: [], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    mockFetchHistoricalPacsCandidates.mockResolvedValue({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    mockSearchHistoricalPacsPatientId.mockResolvedValue([]);
    mockGetAppointmentById.mockResolvedValue(appointment);
    mockPatientSummary.mockReturnValue({ data: { id: 9 }, isLoading: false, isError: false, refetch: vi.fn() });
    mockCreateAssignment.mockReset();
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([]);
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue(libraryDetail());
    vi.mocked(apiHooks.fetchProtocolLibraryScanners).mockResolvedValue([]);
  });

  it("supports worklist quick-filtering by modality and waiting status with dynamic counts", async () => {
    const ctApt = { ...appointment, appointmentId: 101, modalityCode: "CT", appointmentStatus: "scheduled", patientEnglishName: "CT Patient" };
    const mriApt = { ...appointment, appointmentId: 102, modalityCode: "MRI", appointmentStatus: "scheduled", patientEnglishName: "MRI Patient" };
    const waitingApt = { ...appointment, appointmentId: 103, modalityCode: "CT", appointmentStatus: "waiting", patientEnglishName: "Waiting Patient" };

    mockFetchAppointments.mockResolvedValue([ctApt, mriApt, waitingApt]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    expect(await screen.findByRole("button", { name: "All (3)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "CT (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "MRI (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Waiting in Clinic (1)" })).toBeTruthy();

    expect(screen.getByText("CT Patient")).toBeTruthy();
    expect(screen.getByText("MRI Patient")).toBeTruthy();
    expect(screen.getByText("Waiting Patient")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "MRI (1)" }));
    expect(screen.queryByText("CT Patient")).toBeNull();
    expect(screen.getByText("MRI Patient")).toBeTruthy();
    expect(screen.queryByText("Waiting Patient")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Waiting in Clinic (1)" }));
    expect(screen.queryByText("CT Patient")).toBeNull();
    expect(screen.queryByText("MRI Patient")).toBeNull();
    expect(screen.getByText("Waiting Patient")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "All (3)" }));
    expect(screen.getByText("CT Patient")).toBeTruthy();
    expect(screen.getByText("MRI Patient")).toBeTruthy();
    expect(screen.getByText("Waiting Patient")).toBeTruthy();
  });

  it("sorts worklist appointments when column headers are clicked", async () => {
    const aptA = { ...appointment, appointmentId: 101, patientEnglishName: "Alpha Patient", examTypeName: "Zebra Scan" };
    const aptB = { ...appointment, appointmentId: 102, patientEnglishName: "Beta Patient", examTypeName: "Apple Scan" };

    mockFetchAppointments.mockResolvedValue([aptA, aptB]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await screen.findByText("Alpha Patient");

    await userEvent.click(screen.getByRole("button", { name: /Exam type/i }));
    const rows = screen.getAllByRole("row");
    expect(rows[1].textContent).toContain("Beta Patient");
    expect(rows[2].textContent).toContain("Alpha Patient");
  });

  it("keeps patient history and protocol entry pane simultaneously visible when history is opened", async () => {
    mockFetchAppointments.mockResolvedValue([appointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));

    expect(screen.getByTestId("protocol-entry-pane")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Patient history" }));

    expect(await screen.findByRole("region", { name: "Historical imaging" })).toBeTruthy();
    expect(screen.getByTestId("protocol-entry-pane")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("displays smart protocol suggestions matching exam type and supports customizing as free-text", async () => {
    const chestProtocol = { ...libraryProtocol, id: 108, name: "CT Chest Standard", activeVersionId: 208, activeVersionNumber: "1.0", activeVersionStatus: "ACTIVE" as const };
    vi.mocked(apiHooks.fetchProtocolLibraryProtocols).mockResolvedValue([chestProtocol]);
    vi.mocked(apiHooks.fetchProtocolLibraryVersionDetail).mockResolvedValue({
      protocol: chestProtocol,
      version: { ...activeVersion, id: 208, protocolNotes: "Standard chest protocol notes" },
      ctPhases: [phase(1, 1, "Arterial Phase")],
      mriSequences: [],
      ctTechniques: [],
    });

    mockFetchAppointments.mockResolvedValue([appointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));

    expect(await screen.findByText("Suggested for CT Chest")).toBeTruthy();
    const suggestionBtn = screen.getByRole("button", { name: "CT Chest Standard" });
    expect(suggestionBtn).toBeTruthy();

    await userEvent.click(suggestionBtn);

    const customizeBtn = await screen.findByRole("button", { name: "Customize as free-text" });
    expect(customizeBtn).toBeTruthy();

    await userEvent.click(customizeBtn);

    const textarea = screen.getByRole("textbox", { name: "Free-text protocol" }) as HTMLTextAreaElement;
    expect(textarea.value).toContain("CT Chest Standard");
    expect(textarea.value).toContain("Arterial Phase");
    expect(textarea.value).toContain("Standard chest protocol notes");
  });

  it("triggers assign and save via Ctrl+Enter and Ctrl+S keyboard shortcuts", async () => {
    mockCreateAssignment.mockResolvedValue({ appointment, assignmentDetail: null });
    mockFetchAppointments.mockResolvedValue([appointment]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));

    await userEvent.click(screen.getByRole("radio", { name: "Free-text protocol" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Free-text protocol" }), "Stat CT Chest with IV contrast");

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalledWith(42, expect.objectContaining({ freeTextProtocol: "Stat CT Chest with IV contrast" }));
    });

    mockCreateAssignment.mockClear();

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("radio", { name: "Free-text protocol" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Free-text protocol" }), "Stat CT Chest with IV contrast");

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalledWith(42, expect.objectContaining({ freeTextProtocol: "Stat CT Chest with IV contrast" }));
    });
  });

  it("formats appointment header without dangling time separator and isolates patient name", async () => {
    const aptWithNullTime = { ...appointment, appointmentTime: null, patientArabicName: "وريدة سليمان امحمد عبدالله" };
    mockFetchAppointments.mockResolvedValue([aptWithNullTime]);
    mockFetchAppointmentDetail.mockResolvedValue({ appointment: aptWithNullTime, assignmentDetail: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><DoctorProtocolsPage me={me} /></QueryClientProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "Assign" }));

    const dialog = await screen.findByRole("dialog", { name: "Assign protocol" });
    const arabicHeading = within(dialog).getByRole("heading", { name: "وريدة سليمان امحمد عبدالله" });
    expect(arabicHeading.getAttribute("dir")).toBe("auto");

    const appointmentLabel = within(dialog).getByText("Appointment", { selector: "span" });
    const appointmentContainer = appointmentLabel.parentElement;
    expect(appointmentContainer?.textContent).not.toMatch(/[·-]\s*$/);
    expect(appointmentContainer?.textContent).not.toContain("—");
  });
});
