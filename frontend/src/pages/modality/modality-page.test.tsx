import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModalityPage from "./modality-page";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { t as translate, type TranslationKey } from "@/lib/i18n";
import type { ModalityProtocolAssignment } from "@/types/api";

const fetchAppointmentLookupsMock = vi.fn();
const fetchModalityWorklistMock = vi.fn();
const fetchModalityProtocolAssignmentMock = vi.fn();
const fetchStatisticsMock = vi.fn();
const fetchModalityPreviousStudiesMock = vi.fn();
const recordModalityHistoricalPacsAttestationMock = vi.fn();
const pushToastMock = vi.fn();
const listAppointmentDocumentsMock = vi.fn();
const fetchRequestDocumentProtocolPolicyMock = vi.fn();
const uploadAppointmentDocumentMock = vi.fn();
const prepareScanSessionMock = vi.fn();
const createScanSessionMock = vi.fn();
const fetchCurrentSessionMock = vi.fn();
const fetchIntegrationStatusMock = vi.fn();
const completeAppointmentMock = vi.fn();
const fetchCdRobotDestinationsMock = vi.fn();
const fetchCdRobotDeliveriesMock = vi.fn();
const createCdRobotDeliveryMock = vi.fn();
const retryCdRobotDeliveryMock = vi.fn();
const updateAppointmentStatusMock = vi.fn();
const printAppointmentSlipByIdMock = vi.fn();
const printIrSpecimenLabelByIdMock = vi.fn();
const printProtocolSheetMock = vi.fn();
const languageState = vi.hoisted(() => ({ language: "en" as "en" | "ar" }));
const modalityPageSource = readFileSync(join(process.cwd(), "src/pages/modality/modality-page.tsx"), "utf8");
const mriPrimaryScreeningBadgesSource = readFileSync(join(process.cwd(), "src/components/appointments/mri-primary-screening-badges.tsx"), "utf8");
function LocationProbe() { const location = useLocation(); return <span data-testid="location">{location.pathname}{location.search}</span>; }

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchModalityWorklist: (...args: unknown[]) => fetchModalityWorklistMock(...args),
  fetchModalityProtocolAssignment: (...args: unknown[]) => fetchModalityProtocolAssignmentMock(...args),
  fetchStatistics: (...args: unknown[]) => fetchStatisticsMock(...args),
  fetchModalityPreviousStudies: (...args: unknown[]) => fetchModalityPreviousStudiesMock(...args),
  recordModalityHistoricalPacsAttestation: (...args: unknown[]) => recordModalityHistoricalPacsAttestationMock(...args),
  listAppointmentDocuments: (...args: unknown[]) => listAppointmentDocumentsMock(...args),
  fetchRequestDocumentProtocolPolicy: (...args: unknown[]) => fetchRequestDocumentProtocolPolicyMock(...args),
  uploadAppointmentDocument: (...args: unknown[]) => uploadAppointmentDocumentMock(...args),
  prepareScanSession: (...args: unknown[]) => prepareScanSessionMock(...args),
  createScanSession: (...args: unknown[]) => createScanSessionMock(...args),
  fetchCurrentSession: (...args: unknown[]) => fetchCurrentSessionMock(...args),
  fetchIntegrationStatus: (...args: unknown[]) => fetchIntegrationStatusMock(...args),
  completeAppointment: (...args: unknown[]) => completeAppointmentMock(...args),
  fetchCdRobotDestinations: (...args: unknown[]) => fetchCdRobotDestinationsMock(...args),
  fetchCdRobotDeliveries: (...args: unknown[]) => fetchCdRobotDeliveriesMock(...args),
  createCdRobotDelivery: (...args: unknown[]) => createCdRobotDeliveryMock(...args),
  retryCdRobotDelivery: (...args: unknown[]) => retryCdRobotDeliveryMock(...args),
  updateAppointmentStatus: (...args: unknown[]) => updateAppointmentStatusMock(...args),
}));

vi.mock("@/lib/appointment-printing", () => ({
  printAppointmentSlipById: (...args: unknown[]) => printAppointmentSlipByIdMock(...args),
  printIrSpecimenLabelById: (...args: unknown[]) => printIrSpecimenLabelByIdMock(...args),
}));

vi.mock("@/lib/protocol-printing", () => ({
  printProtocolSheet: (...args: unknown[]) => printProtocolSheetMock(...args),
  buildModalityProtocolPrintSheet: vi.fn((appointment: AppointmentWithDetails, assignment: ModalityProtocolAssignment) => ({
    patientName: appointment.englishFullName || appointment.arabicFullName,
    accession: appointment.accessionNumber,
    modality: assignment.modality,
    protocolName: assignment.protocolName || "Free-text protocol",
  })),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: (...args: unknown[]) => pushToastMock(...args),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({
    language: languageState.language,
    isArabic: languageState.language === "ar",
    t: (key: TranslationKey) => translate(languageState.language, key),
  }),
}));

vi.mock("@/lib/date-format", async () => {
  const actual = await vi.importActual<typeof import("@/lib/date-format")>("@/lib/date-format");
  return {
    ...actual,
    todayIsoDateLy: () => "2026-06-18",
  };
});

function appointment(overrides: Partial<AppointmentWithDetails> = {}): AppointmentWithDetails {
  return {
    id: 1,
    patientId: 10,
    modalityId: 1,
    examTypeId: 1,
    reportingPriorityId: 1,
    accessionNumber: "ACC-1",
    requiresReport: true,
    studyInstanceUid: null,
    specialReasonCode: null,
    specialReasonNote: null,
    appointmentDate: "2026-06-18",
    bookingTime: "09:00",
    dailySequence: 1,
    status: "waiting",
    isWalkIn: false,
    isOverbooked: false,
    overbookingReason: null,
    approvedByName: null,
    demographicsEstimated: false,
    notes: null,
    noShowReason: null,
    cancelReason: null,
    arrivedAt: null,
    completedAt: null,
    autoCompletedAt: null,
    createdAt: "2026-06-18T08:00:00Z",
    updatedAt: "2026-06-18T08:00:00Z",
    caseCategory: "oncology",
    arabicFullName: "Patient One",
    englishFullName: "Patient One",
    nationalId: "NAT-1",
    mrn: "MRN-1",
    ageYears: 42,
    sex: "F",
    phone1: null,
    address: null,
    modalityNameAr: "CT",
    modalityNameEn: "CT",
    modalityCode: "CT",
    modalityGeneralInstructionAr: null,
    modalityGeneralInstructionEn: null,
    examNameAr: "CT Brain",
    examNameEn: "CT Brain",
    examSpecificInstructionAr: null,
    examSpecificInstructionEn: null,
    specialReasonLabelAr: null,
    specialReasonLabelEn: null,
    priorityNameAr: "Routine",
    priorityNameEn: "Routine",
    modalitySlotNumber: 1,
    publicCancelToken: null,
    publicAppointmentUrl: null,
    patientWebPushSubscribed: false,
    patientWebPushSubscriptionCount: 0,
    createdByUserId: null,
    createdByName: null,
    createdByUsername: null,
    documentCount: 0,
    ...overrides,
  };
}

function ctAssignment(overrides: Partial<ModalityProtocolAssignment> = {}): ModalityProtocolAssignment {
  return {
    assignmentId: 90,
    appointmentId: 7,
    protocolId: 91,
    protocolVersionId: 92,
    protocolName: "CT Abdomen",
    versionNumber: "1.2",
    freeTextProtocol: null,
    modality: "CT",
    scannerId: 93,
    scannerName: "GE Revolution",
    scannerVendor: "GE",
    protocolNotes: "Renal protocol",
    contrastNotes: "IV contrast",
    assignedBy: "Dr. Protocol",
    assignedAt: "2026-06-29T08:00:00Z",
    status: "ASSIGNED",
    ctPhases: [{
      orderIndex: 1,
      phasePresetName: "Portal venous",
      customPhaseName: null,
      contrastStatus: "POST_CONTRAST",
      timingType: "FIXED_DELAY",
      delaySeconds: 70,
      timingOverride: null,
      coverage: "abdomen",
      coverageOverride: "Liver to symphysis",
      reconstructionNotes: "Soft tissue",
      reconstructionOverride: null,
      instructions: "Breath hold",
      instructionsOverride: null,
      isRequired: true,
    }],
    mriSequences: [],
    ...overrides,
  };
}

function mriAssignment(overrides: Partial<ModalityProtocolAssignment> = {}): ModalityProtocolAssignment {
  return {
    ...ctAssignment(),
    assignmentId: 95,
    appointmentId: 8,
    protocolName: "MRI Rectum Primary Staging",
    modality: "MRI",
    scannerName: "Philips Ingenia Elition 3T",
    scannerVendor: "Philips",
    ctPhases: [],
    mriSequences: [{
      orderIndex: 1,
      scannerId: 93,
      scannerName: "Philips Ingenia Elition 3T",
      sequencePresetName: "T2 TSE",
      vendorSequenceName: "T2W TSE",
      genericFamily: "TSE",
      weighting: "T2",
      defaultPlane: "axial",
      planeOverride: "oblique axial",
      defaultCoverage: "pelvis",
      coverageOverride: "rectum-centered",
      defaultBValues: "0, 800",
      bValuesOverride: null,
      defaultDynamicTiming: null,
      timingOverride: "pre-contrast",
      notes: "Small FOV",
      notesOverride: null,
      isRequired: true,
    }],
    ...overrides,
  };
}

function renderPage(
  rows: AppointmentWithDetails[],
  initialEntry = "/modality",
  cdDestinations: Array<{ key: string; name: string }> = [],
  options: { role?: string; scanner?: Record<string, unknown> | null; modalities?: Array<{ id: number; nameAr: string; nameEn: string; code: string; isActive: boolean }> } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  fetchAppointmentLookupsMock.mockResolvedValue({
    modalities: options.modalities ?? [{ id: 1, nameAr: "CT", nameEn: "CT", code: "CT", isActive: true }],
    examTypes: [],
    priorities: [],
    specialReasons: [],
  });
  fetchModalityWorklistMock.mockResolvedValue(rows);
  fetchModalityProtocolAssignmentMock.mockResolvedValue(null);
  listAppointmentDocumentsMock.mockResolvedValue([]);
  fetchRequestDocumentProtocolPolicyMock.mockResolvedValue({ requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null });
  uploadAppointmentDocumentMock.mockResolvedValue({ id: 90, patientId: 10, appointmentId: null, v2BookingId: rows[0]?.id ?? 1, documentType: "clinical_document", originalFilename: "clinical.pdf", storedPath: "", mimeType: "application/pdf", fileSize: 8, storageLocationType: "local_fallback", source: "manual_upload", createdAt: "2026-06-18T08:30:00.000Z" });
  prepareScanSessionMock.mockResolvedValue({ preparation: { documentType: "clinical_document", sessionCode: "SCAN-MODALITY", guidance: "Ready" } });
  createScanSessionMock.mockResolvedValue({ launchUrl: "rispro-scanner://scan?token=modality-test", expiresAt: "2026-06-18T09:00:00.000Z", fallbackUploadAllowed: true });
  fetchCurrentSessionMock.mockResolvedValue({ id: 1, role: options.role ?? "super_admin", username: "modality", fullName: "Modality Staff" });
  fetchIntegrationStatusMock.mockResolvedValue({ scanner: options.scanner ?? null });
  fetchStatisticsMock.mockResolvedValue({
    statusBreakdown: [
      { status: "waiting", count: rows.filter((row) => row.status === "waiting").length },
      { status: "arrived", count: rows.filter((row) => row.status === "arrived").length },
      { status: "in-progress", count: rows.filter((row) => row.status === "in-progress").length },
      { status: "completed", count: rows.filter((row) => row.status === "completed").length },
    ],
  });
  completeAppointmentMock.mockResolvedValue({ ok: true });
  fetchCdRobotDestinationsMock.mockResolvedValue({ destinations: cdDestinations });
  fetchCdRobotDeliveriesMock.mockResolvedValue({ deliveries: [] });
  createCdRobotDeliveryMock.mockResolvedValue({ delivery: { id: 1 } });
  retryCdRobotDeliveryMock.mockResolvedValue({ delivery: { id: 1 } });
  updateAppointmentStatusMock.mockResolvedValue({ ok: true });
  if (!fetchModalityPreviousStudiesMock.getMockImplementation()) fetchModalityPreviousStudiesMock.mockResolvedValue({ history: { items: [], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null }, historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, historicalCandidatesError: false });
  recordModalityHistoricalPacsAttestationMock.mockResolvedValue({ studyInstanceUid: "1.2.3", status: "confirmed", recordedByUserId: 1, recordedByName: "Modality Staff", recordedAt: "2026-06-18T08:00:00Z" });

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <ModalityPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

async function openBoard(
  rows: AppointmentWithDetails[],
  cdDestinations: Array<{ key: string; name: string }> = [],
  options: { role?: string; scanner?: Record<string, unknown> | null } = {},
) {
  const user = userEvent.setup();
  renderPage(rows, "/modality", cdDestinations, options);
  await screen.findByRole("option", { name: "CT" });
  await user.selectOptions(screen.getByRole("combobox"), "1");
  await screen.findByRole("button", { name: languageState.language === "ar" ? "نشط" : "Operational" });
  return user;
}

function boardAccessions() {
  return screen
    .getAllByTestId(/modality-board-row-/)
    .map((row) => within(row).getByTestId("modality-board-accession").textContent?.trim());
}

describe("ModalityPage modality board", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    pushToastMock.mockReset();
    languageState.language = "en";
  });

  it("disables document ingestion until a modality is selected", async () => {
    renderPage([]);
    expect((await screen.findByRole("button", { name: "Scan Documents" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("identifies additional imaging with its original study reference", async () => {
    await openBoard([appointment({ isAdditionalImaging: true, originalAccession: "V2-000123", originalExam: "CT Brain" })]);
    const row = screen.getByTestId("modality-board-row-1");
    /* Legacy tooltip-only assertion retained as a source-format sentinel.
    expect(within(row).getByText("Additional imaging").getAttribute("title")).toBe("V2-000123 · CT Brain");
    */
    expect(within(row).getByText("Additional Imaging").getAttribute("title")).toBeNull();
    expect(row.textContent).toContain("Original: CT Brain · V2-000123");
    cleanup();
    languageState.language = "ar";
    await openBoard([appointment({ isAdditionalImaging: true, originalAccession: "V2-000123", originalExam: "CT Brain", originalExamAr: "تصوير الدماغ المقطعي" })]);
    expect(within(screen.getByTestId("modality-board-row-1")).getByText("فحص تكميلي")).toBeTruthy();
    expect(screen.getByTestId("modality-board-row-1").textContent).toContain("الأصل: تصوير الدماغ المقطعي · V2-000123");
  });

  it("opens CT document ingestion with the selected modality ID", async () => {
    const user = userEvent.setup();
    renderPage([]);
    await screen.findByRole("option", { name: "CT" });
    await user.selectOptions(screen.getByRole("combobox"), "1");
    const button = screen.getByRole("button", { name: "Scan Documents" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/modality/document-ingestion?modalityId=1"));
  });

  it("keeps the specimen label action absent for non-IR modalities", async () => {
    const user = await openBoard([appointment({ id: 101 })]);
    await user.click(screen.getByTestId("modality-board-row-101"));
    expect(within(screen.getByTestId("selected-appointment-drawer")).queryByRole("button", { name: "Print specimen label" })).toBeNull();
  });

  it("prints a single IR specimen label only after required text is entered", async () => {
    let resolvePrint!: (result: { success: true; printerName: string; jobName: string }) => void;
    printIrSpecimenLabelByIdMock.mockReturnValue(new Promise<{ success: true; printerName: string; jobName: string }>((resolve) => { resolvePrint = resolve; }));
    const user = userEvent.setup();
    renderPage([appointment({ id: 102, modalityId: 2, modalityCode: "IR", modalityNameEn: "Interventional Radiology", accessionNumber: "V2-000102", englishFullName: "IR Patient", mrn: "MRN-IR" })], "/modality", [], { modalities: [{ id: 2, nameAr: "IR", nameEn: "Interventional Radiology", code: "IR", isActive: true }] });
    await screen.findByRole("option", { name: "Interventional Radiology" });
    await user.selectOptions(screen.getByRole("combobox"), "2");
    await user.click(await screen.findByTestId("modality-board-row-102"));
    const drawer = screen.getByTestId("selected-appointment-drawer");
    await user.click(within(drawer).getByRole("button", { name: "Print specimen label" }));
    const dialog = screen.getByRole("heading", { name: "Print specimen label" }).parentElement?.parentElement?.parentElement ?? document.body;
    expect(within(dialog).getByText("IR Patient")).toBeTruthy();
    expect(within(dialog).getByText("V2-000102")).toBeTruthy();
    expect(within(dialog).queryByText("MRN-IR")).toBeNull();
    const print = within(dialog).getByRole("button", { name: "Print" }) as HTMLButtonElement;
    expect(print.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("Specimen / Site"), "Liver lesion biopsy");
    expect(print.disabled).toBe(false);
    await user.click(print);
    await user.click(print);
    expect(printIrSpecimenLabelByIdMock).toHaveBeenCalledTimes(1);
    expect(printIrSpecimenLabelByIdMock).toHaveBeenCalledWith(102, "Liver lesion biopsy", "en");
    resolvePrint({ success: true, printerName: "Label Queue", jobName: "test" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Print specimen label" })).toBeNull());
  });

  it("localizes the IR specimen label workflow in Arabic", async () => {
    languageState.language = "ar";
    const user = userEvent.setup();
    renderPage([appointment({ id: 104, modalityId: 2, modalityCode: "IR", modalityNameEn: "Interventional Radiology", accessionNumber: "V2-000104", englishFullName: "IR Patient" })], "/modality", [], { modalities: [{ id: 2, nameAr: "IR", nameEn: "Interventional Radiology", code: "IR", isActive: true }] });
    await screen.findByRole("option", { name: "IR" });
    await user.selectOptions(screen.getByRole("combobox"), "2");

    const row = await screen.findByTestId("modality-board-row-104");
    await user.click(within(row).getByRole("button", { name: "إجراءات إضافية" }));
    const menuItem = screen.getByRole("menuitem", { name: "طباعة ملصق العينة" });
    expect(menuItem).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Print specimen label" })).toBeNull();
    await user.click(menuItem);

    const firstDialog = screen.getByRole("heading", { name: "طباعة ملصق العينة" }).parentElement?.parentElement?.parentElement ?? document.body;
    expect(within(firstDialog).getByText("يتم تسجيل وقت الطباعة تلقائياً عند طباعة الملصق.")).toBeTruthy();
    expect(within(firstDialog).getByText("المريض")).toBeTruthy();
    expect(within(firstDialog).getByText("رقم الوصول")).toBeTruthy();
    expect(within(firstDialog).getByLabelText("العينة / الموقع")).toBeTruthy();
    expect(within(firstDialog).getByRole("button", { name: "إلغاء" })).toBeTruthy();
    expect(within(firstDialog).getByRole("button", { name: "طباعة" })).toBeTruthy();
    expect(screen.queryByText("Print specimen label")).toBeNull();
    expect(within(firstDialog).queryByText("Specimen / Site")).toBeNull();
    await user.click(within(firstDialog).getByRole("button", { name: "إلغاء" }));

    await user.click(row);
    const drawer = screen.getByTestId("selected-appointment-drawer");
    const clinicalPrint = within(drawer).getByRole("button", { name: "طباعة ملصق العينة" });
    expect(clinicalPrint).toBeTruthy();
    await user.click(clinicalPrint);

    let resolvePrint!: (result: { success: true; printerName: string; jobName: string }) => void;
    printIrSpecimenLabelByIdMock.mockReturnValue(new Promise<{ success: true; printerName: string; jobName: string }>((resolve) => { resolvePrint = resolve; }));
    const dialog = screen.getByRole("heading", { name: "طباعة ملصق العينة" }).parentElement?.parentElement?.parentElement ?? document.body;
    const text = within(dialog).getByLabelText("العينة / الموقع");
    await user.type(text, "خزعة الكبد");
    await user.click(within(dialog).getByRole("button", { name: "طباعة" }));
    expect(within(dialog).getByRole("button", { name: "جارٍ الطباعة..." })).toBeTruthy();
    expect(printIrSpecimenLabelByIdMock).toHaveBeenCalledWith(104, "خزعة الكبد", "ar");
    resolvePrint({ success: true, printerName: "Label Queue", jobName: "test" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "طباعة ملصق العينة" })).toBeNull());
  });

  it("keeps the IR specimen dialog and exact text open after a print failure", async () => {
    printIrSpecimenLabelByIdMock.mockResolvedValue({ success: false, errorCode: "PRINTER_NOT_CONFIGURED", message: "No label printer." });
    const user = userEvent.setup();
    renderPage([appointment({ id: 103, modalityId: 2, modalityCode: "IR", modalityNameEn: "Interventional Radiology", accessionNumber: "V2-000103", englishFullName: "IR Patient" })], "/modality", [], { modalities: [{ id: 2, nameAr: "IR", nameEn: "Interventional Radiology", code: "IR", isActive: true }] });
    await screen.findByRole("option", { name: "Interventional Radiology" });
    await user.selectOptions(screen.getByRole("combobox"), "2");
    await user.click(await screen.findByTestId("modality-board-row-103"));
    await user.click(within(screen.getByTestId("selected-appointment-drawer")).getByRole("button", { name: "Print specimen label" }));
    const dialog = screen.getByRole("heading", { name: "Print specimen label" }).parentElement?.parentElement?.parentElement ?? document.body;
    const text = within(dialog).getByLabelText("Specimen / Site") as HTMLInputElement;
    await user.type(text, "Liver lesion biopsy");
    await user.click(within(dialog).getByRole("button", { name: "Print" }));
    await waitFor(() => expect(printIrSpecimenLabelByIdMock).toHaveBeenCalledWith(103, "Liver lesion biopsy", "en"));
    expect(screen.getByRole("heading", { name: "Print specimen label" })).toBeTruthy();
    expect(text.value).toBe("Liver lesion biopsy");
  });

  it("restores a selected active modality from the worklist URL and rejects an unknown one", async () => {
    const active = renderPage([], "/modality?modalityId=1");
    await screen.findByRole("option", { name: "CT" });
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("1"));
    expect((screen.getByRole("button", { name: "Scan Documents" }) as HTMLButtonElement).disabled).toBe(false);
    active.unmount();
    renderPage([], "/modality?modalityId=999");
    await waitFor(() => expect((screen.getByRole("button", { name: "Scan Documents" }) as HTMLButtonElement).disabled).toBe(true));
  });

  it("sorts arrived rows by arrivedAt ascending after in-progress rows", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-LATE", dailySequence: 2, modalitySlotNumber: 2, status: "arrived", arrivedAt: "2026-06-18T08:30:00Z", englishFullName: "Late Arrival" }),
      appointment({ id: 2, accessionNumber: "ACC-PROGRESS", dailySequence: 3, modalitySlotNumber: 3, status: "in-progress", englishFullName: "In Progress" }),
      appointment({ id: 3, accessionNumber: "ACC-EARLY", dailySequence: 1, modalitySlotNumber: 1, status: "arrived", arrivedAt: "2026-06-18T08:05:00Z", englishFullName: "Early Arrival" }),
    ]);

    expect(boardAccessions()).toEqual(["ACC-PROGRESS", "ACC-EARLY", "ACC-LATE"]);
  });

  it("removes the unavailable Arrival # column and preserves useful arrival time semantics", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-LATE", dailySequence: 2, modalitySlotNumber: 2, status: "arrived", arrivedAt: "2026-06-18T08:30:00Z", englishFullName: "Late Arrival" }),
      appointment({ id: 2, accessionNumber: "ACC-SCHEDULED", dailySequence: 1, modalitySlotNumber: 1, status: "scheduled", bookingTime: "09:00", englishFullName: "Scheduled Patient" }),
      appointment({ id: 3, accessionNumber: "ACC-EARLY", dailySequence: 3, modalitySlotNumber: 3, status: "arrived", arrivedAt: "2026-06-18T08:05:00Z", englishFullName: "Early Arrival" }),
      appointment({ id: 4, accessionNumber: "ACC-WAIT", dailySequence: 4, modalitySlotNumber: 4, status: "waiting", arrivedAt: "2026-06-18T08:20:00Z", englishFullName: "Waiting Arrival" }),
    ]);

    expect(within(screen.getByTestId("modality-board-row-3")).getByText("10:05")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-4")).getByText("10:20")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-1")).getByText("10:30")).toBeTruthy();
    expect(screen.queryByText("Arrival #")).toBeNull();
    expect(screen.queryByText("رقم الوصول")).toBeNull();
    expect(screen.getByText("Arrival time")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-2")).getByText("Not arrived")).toBeTruthy();
  });

  it("keeps scheduled not-arrived patients visible in the board", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", englishFullName: "Waiting Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-SCHEDULED", status: "scheduled", englishFullName: "Scheduled Patient", bookingTime: "10:00" }),
    ]);

    const scheduledRow = screen.getByTestId("modality-board-row-2");
    expect(within(scheduledRow).getByText("Scheduled Patient")).toBeTruthy();
    expect(within(scheduledRow).getByText("Scheduled")).toBeTruthy();
    const markArrived = within(scheduledRow).getByRole("button", { name: "Mark arrived" });
    expect(markArrived.textContent).toContain("Mark arrived");
    expect(markArrived.querySelector("svg")).toBeTruthy();
    expect(within(scheduledRow).queryByRole("button", { name: "Print" })).toBeNull();
    expect(within(scheduledRow).getByRole("button", { name: "More actions" })).toBeTruthy();
  });

  it("shows same-day sibling appointments as compact patient metadata", async () => {
    await openBoard([
      appointment({
        id: 1,
        accessionNumber: "ACC-CT",
        status: "waiting",
        englishFullName: "Multi Patient",
        sameDayAppointmentCount: 2,
        hasMultipleAppointments: true,
        relatedAppointments: [
          {
            appointmentId: 1,
            accessionNumber: "ACC-CT",
            appointmentStatus: "waiting",
            modalityNameAr: "CT",
            modalityNameEn: "CT",
            examNameAr: "CT Brain",
            examNameEn: "CT Brain",
          },
          {
            appointmentId: 2,
            accessionNumber: "ACC-MRI",
            appointmentStatus: "scheduled",
            modalityNameAr: "MRI",
            modalityNameEn: "MRI",
            examNameAr: "MRI Brain",
            examNameEn: "MRI Brain",
          },
        ],
      }),
    ]);

    const row = screen.getByTestId("modality-board-row-1");
    expect(within(row).getByText(/1 related/)).toBeTruthy();
    expect(within(row).queryByText("MRI")).toBeNull();
  });

  it("shows Mark Arrived instead of Complete as the scheduled row action", async () => {
    const user = await openBoard([
      appointment({ id: 12, accessionNumber: "ACC-SCHEDULED", status: "scheduled", bookingTime: "10:00", englishFullName: "Scheduled Patient" }),
    ]);

    const row = screen.getByTestId("modality-board-row-12");
    expect(within(row).queryByRole("button", { name: /Complete/i })).toBeNull();

    await user.click(within(row).getByRole("button", { name: /Mark arrived/i }));
    await waitFor(() => {
      expect(updateAppointmentStatusMock).toHaveBeenCalledWith(12, "arrived", null);
    });
  });

  it("shows completed rows under the completed filter", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-WAIT", status: "waiting", englishFullName: "Waiting Patient" }),
    ]);

    expect(boardAccessions()).toEqual(["ACC-WAIT"]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(boardAccessions()).toEqual(["ACC-DONE"]);

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(boardAccessions()).toEqual(["ACC-WAIT", "ACC-DONE"]);
  });

  it("shows exact document counts with accessible success and neutral states", async () => {
    await openBoard([
      appointment({ id: 21, accessionNumber: "ACC-NONE", documentCount: 0 }),
      appointment({ id: 22, accessionNumber: "ACC-ONE", documentCount: 1 }),
      appointment({ id: 23, accessionNumber: "ACC-TWO", documentCount: 2 }),
    ]);

    const noDocuments = within(screen.getByTestId("modality-board-row-21")).getByTestId("modality-document-status");
    const oneDocument = within(screen.getByTestId("modality-board-row-22")).getByTestId("modality-document-status");
    const twoDocuments = within(screen.getByTestId("modality-board-row-23")).getByTestId("modality-document-status");
    expect(noDocuments.textContent).toContain("No docs");
    expect(noDocuments.className).toContain("state-chip--neutral");
    expect(oneDocument.textContent).toContain("1 doc");
    expect(oneDocument.className).toContain("state-chip--success");
    expect(oneDocument.querySelector("svg")).toBeTruthy();
    expect(twoDocuments.textContent).toContain("2 docs");
    expect(within(screen.getByTestId("modality-board-row-22")).getByRole("button", { name: "1 doc. Open documents for ACC-ONE" })).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-23")).getByRole("button", { name: "2 docs. Open documents for ACC-TWO" })).toBeTruthy();
  });

  it("lazily opens exact-appointment documents without leaving the board", async () => {
    const user = await openBoard([appointment({ id: 24, accessionNumber: "V2-000024", documentCount: 1 })]);
    expect(listAppointmentDocumentsMock).not.toHaveBeenCalled();
    listAppointmentDocumentsMock.mockResolvedValue([{
      id: 51,
      patientId: 10,
      appointmentId: null,
      v2BookingId: 24,
      documentType: "appointment_request",
      originalFilename: "Referral.pdf",
      storedPath: "documents/referral.pdf",
      mimeType: "application/pdf",
      fileSize: 128,
      storageLocationType: "local_fallback",
      source: "manual_upload",
      pageCount: 5,
      lastMoveAttemptAt: null,
      lastMoveError: null,
      createdAt: "2026-06-18T08:29:00.000Z",
    }]);

    await user.click(screen.getByRole("button", { name: "1 doc. Open documents for V2-000024" }));

    expect(await screen.findByText("Documents — V2-000024")).toBeTruthy();
    expect(await screen.findByText("Referral.pdf")).toBeTruthy();
    expect(screen.getByText(/5 pages/)).toBeTruthy();
    expect(listAppointmentDocumentsMock).toHaveBeenCalledWith(24, "v2_booking");
    expect(screen.getByTestId("location").textContent).toContain("/modality");
    expect(screen.queryByTestId("selected-appointment-drawer")).toBeNull();
    expect(modalityPageSource).toMatch(/<RequestDocumentsPanel[\s\S]*?newDocumentType="clinical_document"[\s\S]*?onDocumentsChanged=/);
  });

  it("lets modality staff create clinical documents from the board dialog", async () => {
    const user = await openBoard(
      [appointment({ id: 25, accessionNumber: "V2-000025", documentCount: 1 })],
      [],
      {
        role: "modality_staff",
        scanner: {
          referralUploadEnabled: true,
          allowedFileTypes: ["pdf", "jpg", "png"],
          documentLinkScope: "patient_and_appointment",
          scannerBridgeMode: "manual_browser_upload",
          scannerProfileName: "default",
          scannerSource: "feeder",
          scanDpi: "200",
          scanColorMode: "grayscale",
          scanFileFormat: "pdf",
          bridgeReady: true,
          naps2WebScanEnabled: false,
          naps2WebScanEndpoint: "",
          scannerAppEnabled: true,
          scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi",
          scanSessionExpiryMinutes: "15",
        },
      },
    );

    await user.click(screen.getByRole("button", { name: "1 doc. Open documents for V2-000025" }));
    const fileInput = await screen.findByTestId("document-file-input") as HTMLInputElement;
    expect(screen.getByText("Upload Clinical Document")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    await user.upload(fileInput, new File(["clinical"], "clinical.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Attach Clinical Document" }));
    await waitFor(() => expect(uploadAppointmentDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 25,
      appointmentRefType: "v2_booking",
      documentType: "clinical_document",
      source: "manual_upload",
    })));

    await user.click(screen.getByRole("button", { name: "Scan Paper" }));
    await waitFor(() => expect(createScanSessionMock).toHaveBeenCalledWith({
      appointmentId: 25,
      patientId: 10,
      documentType: "clinical_document",
      appointmentRefType: "v2_booking",
    }));
  });

  it("combines Missing and Uploaded document filters with board status filters", async () => {
    const user = await openBoard([
      appointment({ id: 31, accessionNumber: "ACC-WAIT-MISSING", status: "waiting", documentCount: 0 }),
      appointment({ id: 32, accessionNumber: "ACC-WAIT-UPLOADED", status: "waiting", documentCount: 2 }),
      appointment({ id: 33, accessionNumber: "ACC-DONE-UPLOADED", status: "completed", documentCount: 1 }),
    ]);

    expect(within(screen.getByTestId("modality-board-row-31")).getByRole("button", { name: "Mark arrived" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Missing Documents" }));
    expect(boardAccessions()).toEqual(["ACC-WAIT-MISSING"]);
    await user.click(screen.getByRole("button", { name: "Uploaded Documents" }));
    expect(boardAccessions()).toEqual(["ACC-WAIT-UPLOADED"]);
    await user.click(screen.getByRole("button", { name: "Completed" }));
    expect(boardAccessions()).toEqual(["ACC-DONE-UPLOADED"]);
  });

  it("status filter chips show and hide operational groups", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-ARRIVED", status: "arrived", arrivedAt: "2026-06-18T08:05:00Z", englishFullName: "Arrived Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-SCHEDULED", status: "scheduled", bookingTime: "09:00", englishFullName: "Scheduled Patient" }),
      appointment({ id: 3, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
      appointment({ id: 4, accessionNumber: "ACC-CANCEL", status: "cancelled", englishFullName: "Cancelled Patient" }),
    ]);

    expect(screen.getByRole("button", { name: "Operational" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Arrived/Ready" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not arrived" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Completed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Problem" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();

    expect(boardAccessions()).toEqual(["ACC-ARRIVED", "ACC-SCHEDULED"]);
    await user.click(screen.getByRole("button", { name: "Arrived/Ready" }));
    expect(boardAccessions()).toEqual(["ACC-ARRIVED"]);
    await user.click(screen.getByRole("button", { name: "Not arrived" }));
    expect(boardAccessions()).toEqual(["ACC-SCHEDULED"]);
    await user.click(screen.getByRole("button", { name: "Problem" }));
    expect(boardAccessions()).toEqual(["ACC-CANCEL"]);
  });

  it("uses LTR direction for the English modality board section", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-LTR", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z" }),
    ]);

    expect(screen.getByTestId("modality-page-root").getAttribute("dir")).toBe("ltr");
    expect(screen.getByTestId("modality-board-section").getAttribute("dir")).toBe("ltr");
    expect(screen.getByTestId("modality-board").getAttribute("dir")).toBe("ltr");
  });

  it("uses RTL direction for the Arabic modality board section and table", async () => {
    languageState.language = "ar";
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-RTL", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z" }),
    ]);

    expect(screen.getByTestId("modality-page-root").getAttribute("dir")).toBe("rtl");
    expect(screen.getByTestId("modality-board-section").getAttribute("dir")).toBe("rtl");
    expect(screen.getByTestId("modality-board-table-wrap").getAttribute("dir")).toBe("rtl");
    expect(screen.getByTestId("modality-board").getAttribute("dir")).toBe("rtl");
    expect(screen.getByTestId("modality-board").className).toContain("text-start");
  });

  it("keeps the worklist table horizontal-only without a vertical inner scroll container", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-SCROLL", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z" }),
    ]);

    const wrapper = screen.getByTestId("modality-board-table-wrap");
    expect(wrapper.className).toContain("overflow-x-auto");
    expect(wrapper.className).not.toContain("overflow-auto");
    expect(wrapper.className).not.toContain("overflow-y-auto");
    expect(wrapper.className).not.toContain("max-h-");
    expect(modalityPageSource).not.toContain("max-h-[calc(100vh-290px)] overflow-auto");
  });

  it("compact counter chips render in the board header and apply exact filters", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-ARRIVED", status: "arrived", arrivedAt: "2026-06-18T08:05:00Z", englishFullName: "Arrived Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
      appointment({ id: 3, accessionNumber: "ACC-PROGRESS", status: "in-progress", arrivedAt: "2026-06-18T08:15:00Z", englishFullName: "In Progress Patient" }),
      appointment({ id: 4, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
    ]);

    const header = screen.getByTestId("modality-board-header");
    const waitingChip = within(header).getByRole("button", { name: /^Waiting\s+1$/i });
    expect(waitingChip).toBeTruthy();
    expect(within(header).getByRole("button", { name: /^Arrived\s+1$/i })).toBeTruthy();
    expect(within(header).getByRole("button", { name: /^In Progress\s+1$/i })).toBeTruthy();
    expect(within(header).getByRole("button", { name: /^Completed\s+1$/i })).toBeTruthy();

    await user.click(waitingChip);
    expect(waitingChip.getAttribute("aria-pressed")).toBe("true");
    expect(boardAccessions()).toEqual(["ACC-WAIT"]);

    await user.click(within(header).getByRole("button", { name: /^Arrived\s+1$/i }));
    expect(boardAccessions()).toEqual(["ACC-ARRIVED"]);

    await user.click(within(header).getByRole("button", { name: /^In Progress\s+1$/i }));
    expect(boardAccessions()).toEqual(["ACC-PROGRESS"]);

    await user.click(within(header).getByRole("button", { name: /^Completed\s+1$/i }));
    expect(boardAccessions()).toEqual(["ACC-DONE"]);
  });

  it("does not render the old standalone metric card row", () => {
    expect(modalityPageSource).not.toContain("<MetricCard");
  });

  it("keeps status filtering in the compact toolbar without a redundant active-filter row", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
    ]);

    await user.click(screen.getByRole("button", { name: /^Completed\s+1$/i }));

    expect(boardAccessions()).toEqual(["ACC-DONE"]);
    expect(screen.queryByTestId("modality-active-filters")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Operational" }));

    expect(boardAccessions()).toEqual(["ACC-WAIT"]);
  });

  it("reset view returns to operational today scope while preserving selected modality", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
    ]);

    await user.click(screen.getByRole("button", { name: "All Dates" }));
    await user.click(screen.getByRole("button", { name: /^Completed\s+1$/i }));
    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(screen.getByRole("combobox")).toHaveProperty("value", "1");
    expect(screen.getByLabelText("Date")).toHaveProperty("value", "18/06/2026");
    expect(boardAccessions()).toEqual(["ACC-WAIT"]);
  });

  it("keeps existing table visible during a refetch", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
    ]);

    fetchModalityWorklistMock.mockImplementation(() => new Promise(() => undefined));
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(boardAccessions()).toEqual(["ACC-WAIT"]);
    expect(screen.queryByText("Loading modality worklist...")).toBeNull();
  });

  it("shows last refreshed time after fetch and manual refresh", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
    ]);

    expect(screen.getByText(/Last refreshed \d{2}:\d{2}:\d{2}/)).toBeTruthy();

    fetchModalityWorklistMock.mockResolvedValue([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(fetchModalityWorklistMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Last refreshed \d{2}:\d{2}:\d{2}/)).toBeTruthy();
  });

  it("keeps row print, complete, and status actions wired", async () => {
    const user = await openBoard([
      appointment({ id: 7, accessionNumber: "ACC-ACTION", status: "waiting", englishFullName: "Action Patient" }),
    ]);
    const row = screen.getByTestId("modality-board-row-7");

    expect(within(row).queryByRole("button", { name: "Print" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    await user.click(screen.getByRole("menuitem", { name: "Print" }));
    expect(printAppointmentSlipByIdMock).toHaveBeenCalledWith(7, "en");

    await user.click(within(row).getByRole("button", { name: /Complete/i }));
    await screen.findByRole("heading", { name: /Confirm completion/i });
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /Confirm completion/i }));
    await waitFor(() => expect(completeAppointmentMock.mock.calls[0]?.[0]).toBe(7));

    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    expect(screen.queryByRole("menuitem", { name: /Cancel/i })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /Stop/i }));
    await screen.findByRole("heading", { name: /Confirm discontinuation/i });
    await user.type(screen.getByPlaceholderText(/Enter a reason/i), "Scanner problem");
    await user.click(screen.getByRole("button", { name: /Confirm discontinuation/i }));
    await waitFor(() => {
      expect(updateAppointmentStatusMock).toHaveBeenCalledWith(7, "discontinued", "Scanner problem");
    });
  });

  it("keeps primary row actions visible and secondary actions in More", async () => {
    await openBoard([
      appointment({ id: 8, accessionNumber: "ACC-LABELS", status: "arrived", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Label Patient" }),
    ]);

    const row = screen.getByTestId("modality-board-row-8");
    const moreButton = within(row).getByRole("button", { name: /More actions/i });
    expect(within(row).queryByRole("button", { name: "Print" })).toBeNull();
    expect(moreButton.querySelector("svg")).toBeNull();
    expect(moreButton.textContent?.trim()).toBe("…");
    expect(within(row).getAllByRole("button").every((button) => Boolean(button.textContent?.trim() || button.querySelector("svg")))).toBe(true);
    expect(within(row).getByRole("button", { name: /Complete/i })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /Discontinue/i })).toBeNull();
    expect(within(row).queryByRole("button", { name: /Cancel/i })).toBeNull();
    expect(within(row).queryByRole("button", { name: /Back to waiting/i })).toBeNull();
  });

  it("shows operational Stop and Wait in More for arrived rows without Cancel", async () => {
    const user = await openBoard([
      appointment({ id: 8, accessionNumber: "ACC-LABELS", status: "arrived", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Label Patient" }),
    ]);

    const row = screen.getByTestId("modality-board-row-8");
    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    expect(screen.getByRole("menuitem", { name: /Stop/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Cancel/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Wait/i })).toBeTruthy();

    await user.click(screen.getByRole("menuitem", { name: /Stop/i }));
    await screen.findByRole("heading", { name: /Confirm discontinuation/i });
  });

  it("closes the More menu on outside click and Escape", async () => {
    const user = await openBoard([
      appointment({ id: 8, accessionNumber: "ACC-LABELS", status: "arrived", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Label Patient" }),
    ]);

    const row = screen.getByTestId("modality-board-row-8");
    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    expect(screen.getByRole("menu")).toBeTruthy();

    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("uses RTL alignment for the More menu in Arabic", async () => {
    languageState.language = "ar";
    const user = userEvent.setup();
    renderPage([
      appointment({ id: 8, accessionNumber: "ACC-LABELS", status: "arrived", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Label Patient" }),
    ]);
    await screen.findByRole("option", { name: "CT" });
    await user.selectOptions(screen.getByRole("combobox"), "1");
    const row = await screen.findByTestId("modality-board-row-8");

    await user.click(within(row).getByRole("button", { name: /إجراءات|More actions/i }));

    const menu = screen.getByRole("menu");
    expect(menu.getAttribute("dir")).toBe("rtl");
    expect(menu.className).toContain("text-end");
  });

  it("shows elapsed waiting duration from arrivedAt and a visible reason when missing", async () => {
    const arrivedAt = new Date(Date.now() - 70 * 60_000).toISOString();
    await openBoard([
      appointment({ id: 10, accessionNumber: "ACC-ELAPSED", status: "arrived", arrivedAt, englishFullName: "Elapsed Patient" }),
      appointment({ id: 11, accessionNumber: "ACC-MISSING", status: "waiting", arrivedAt: null, englishFullName: "Missing Timestamp" }),
    ]);

    expect(within(screen.getByTestId("modality-board-row-10")).getByText(/1h (9|10)m/)).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-11")).getByText("Arrival time not recorded")).toBeTruthy();
  });

  it("marks active waiting rows over 30 minutes with mild warning", async () => {
    const arrivedAt = new Date(Date.now() - 40 * 60_000).toISOString();
    await openBoard([
      appointment({ id: 12, accessionNumber: "ACC-MILD", status: "waiting", arrivedAt, englishFullName: "Mild Delay" }),
    ]);

    const row = screen.getByTestId("modality-board-row-12");
    expect(row.getAttribute("data-waiting-warning")).toBe("mild");
    expect(row.getAttribute("title")).toContain("Waiting more than 30 minutes");
  });

  it("marks active waiting rows over 60 minutes with strong warning", async () => {
    const arrivedAt = new Date(Date.now() - 75 * 60_000).toISOString();
    await openBoard([
      appointment({ id: 13, accessionNumber: "ACC-STRONG", status: "arrived", arrivedAt, englishFullName: "Strong Delay" }),
    ]);

    const row = screen.getByTestId("modality-board-row-13");
    expect(row.getAttribute("data-waiting-warning")).toBe("strong");
    expect(row.getAttribute("title")).toContain("Waiting more than 60 minutes");
  });

  it("does not mark active waiting rows under the warning threshold", async () => {
    const arrivedAt = new Date(Date.now() - 20 * 60_000).toISOString();
    await openBoard([
      appointment({ id: 14, accessionNumber: "ACC-OK", status: "waiting", arrivedAt, englishFullName: "Normal Wait" }),
    ]);

    expect(screen.getByTestId("modality-board-row-14").getAttribute("data-waiting-warning")).toBeNull();
  });

  it("does not mark completed rows as active overdue even when frozen wait was long", async () => {
    const user = await openBoard([
      appointment({
        id: 15,
        accessionNumber: "ACC-COMPLETE-LONG",
        status: "completed",
        arrivedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T10:30:00Z",
        pacsAutoCompletionEnabled: false,
        englishFullName: "Long Completed",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-15");
    expect(row.getAttribute("data-waiting-warning")).toBeNull();
    expect(within(row).getByText("Waited 2h 30m")).toBeTruthy();
  });

  it("shows frozen PACS study-start waiting duration for completed auto-completion rows", async () => {
    const user = await openBoard([
      appointment({
        id: 20,
        accessionNumber: "ACC-PACS-START",
        status: "completed",
        arrivedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T09:30:00Z",
        pacsAutoCompletionEnabled: true,
        pacsStudyStartedAt: "2026-06-18T08:45:00Z",
        pacsFirstSeenAt: "2026-06-18T08:50:00Z",
        englishFullName: "PACS Started",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-20");
    expect(within(row).getByText("Waited 45m")).toBeTruthy();
    expect(within(row).getByText("PACS study start")).toBeTruthy();
  });

  it("shows PACS first seen as approximate duration provenance", async () => {
    const user = await openBoard([
      appointment({
        id: 21,
        accessionNumber: "ACC-PACS-SEEN",
        status: "completed",
        arrivedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T09:30:00Z",
        pacsAutoCompletionEnabled: true,
        pacsFirstSeenAt: "2026-06-18T08:35:00Z",
        englishFullName: "PACS Seen",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-21");
    expect(within(row).getByText("Waited 35m")).toBeTruthy();
    expect(within(row).getByText("PACS first seen / approximate")).toBeTruthy();
    expect(within(row).queryByText("Approx")).toBeNull();
  });

  it("falls back to autoCompletedAt before completedAt for auto-completion rows without PACS timing", async () => {
    const user = await openBoard([
      appointment({
        id: 22,
        accessionNumber: "ACC-PACS-FALLBACK",
        status: "completed",
        arrivedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T09:10:00Z",
        autoCompletedAt: "2026-06-18T09:00:00Z",
        pacsAutoCompletionEnabled: true,
        englishFullName: "PACS Fallback",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-22");
    expect(within(row).getByText("Waited 1h 0m")).toBeTruthy();
    expect(within(row).getByText("Estimated from completion")).toBeTruthy();
    expect(within(row).queryByText("Auto-completion fallback")).toBeNull();
    expect(within(row).queryByText("Timing missing")).toBeNull();
  });

  it("uses completedAt as the manual fallback when autoCompletedAt is absent", async () => {
    const user = await openBoard([
      appointment({
        id: 28,
        accessionNumber: "ACC-PACS-MANUAL-FALLBACK",
        status: "completed",
        arrivedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T09:10:00Z",
        pacsAutoCompletionEnabled: true,
        englishFullName: "PACS Manual Fallback",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-28");
    expect(within(row).getByText("Waited 1h 10m")).toBeTruthy();
    expect(within(row).getByText("Estimated from completion")).toBeTruthy();
  });

  it("shows a visible missing-duration reason when PACS completion timing is absent", async () => {
    const user = await openBoard([
      appointment({
        id: 29,
        accessionNumber: "ACC-PACS-MISSING",
        status: "completed",
        arrivedAt: "2026-06-18T08:00:00Z",
        completedAt: null,
        pacsAutoCompletionEnabled: true,
        englishFullName: "PACS Missing",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-29");
    expect(within(row).getByTestId("modality-board-waiting-duration").textContent).toContain("Not recorded");
    expect(within(row).getByText("PACS completion timing unavailable")).toBeTruthy();
  });

  it("uses manual completed_at for completed non-auto-completion rows", async () => {
    const user = await openBoard([
      appointment({
        id: 23,
        accessionNumber: "ACC-MANUAL",
        status: "completed",
        arrivedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T08:25:00Z",
        pacsAutoCompletionEnabled: false,
        englishFullName: "Manual Complete",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-23");
    expect(within(row).getByText("Waited 25m")).toBeTruthy();
    expect(within(row).getByText("Manual complete")).toBeTruthy();
  });

  it("does not render a negative completed waiting duration", async () => {
    const user = await openBoard([
      appointment({
        id: 30,
        accessionNumber: "ACC-EARLY-ENDPOINT",
        status: "completed",
        arrivedAt: "2026-06-18T08:00:00Z",
        autoCompletedAt: "2026-06-18T07:50:00Z",
        pacsAutoCompletionEnabled: true,
        englishFullName: "Early Endpoint",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-30");
    expect(within(row).queryByText(/-\d+m/)).toBeNull();
  });

  it("shows live waiting source and visible missing-arrival duration reason", async () => {
    const arrivedAt = new Date(Date.now() - 70 * 60_000).toISOString();
    await openBoard([
      appointment({ id: 24, accessionNumber: "ACC-LIVE", status: "waiting", arrivedAt, englishFullName: "Live Waiting" }),
      appointment({ id: 25, accessionNumber: "ACC-NO-ARRIVAL", status: "waiting", arrivedAt: null, englishFullName: "No Arrival" }),
    ]);

    const liveRow = screen.getByTestId("modality-board-row-24");
    expect(within(liveRow).getByText(/Waiting 1h (9|10)m/)).toBeTruthy();
    expect(within(liveRow).getByText("Live waiting")).toBeTruthy();

    const missingRow = screen.getByTestId("modality-board-row-25");
    expect(within(missingRow).queryByText("Live waiting")).toBeNull();
    expect(within(missingRow).getByTestId("modality-board-waiting-duration").textContent).toContain("Not recorded");
    expect(within(missingRow).getByText("Arrival time not recorded")).toBeTruthy();
  });

  it("renders both Arabic and English patient names in the board row", async () => {
    await openBoard([
      appointment({
        id: 26,
        accessionNumber: "ACC-NAMES",
        status: "waiting",
        arabicFullName: "أحمد علي",
        englishFullName: "Ahmed Ali",
      }),
    ]);

    const row = screen.getByTestId("modality-board-row-26");
    expect(within(row).getByText("أحمد علي")).toBeTruthy();
    expect(within(row).getByText("Ahmed Ali")).toBeTruthy();
  });

  it("keeps one non-wrapping workflow badge separate from case metadata and duration provenance", async () => {
    const user = await openBoard([
      appointment({
        id: 32,
        accessionNumber: "ACC-STATUS-SEPARATION",
        status: "completed",
        caseCategory: "non_oncology",
        arrivedAt: "2026-06-18T08:00:00Z",
        autoCompletedAt: "2026-06-18T09:00:00Z",
        pacsAutoCompletionEnabled: true,
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-32");
    const status = within(row).getByTestId("modality-board-status");
    expect(status.textContent).toContain("Completed");
    expect(status.textContent).not.toContain("Non-Oncology");
    expect(status.textContent).not.toContain("Estimated from completion");
    expect(status.querySelector(".state-chip")?.className).toContain("whitespace-nowrap");
    expect(within(row).getByTestId("modality-board-case-category").textContent).toContain("Non-Oncology");
    expect(within(row).getByTestId("modality-board-case-category").getAttribute("aria-label")).toBe("Case category: Non-Oncology");
    expect(within(row).getByTestId("modality-board-case-category").querySelector(".bg-blue-700")).toBeTruthy();
    expect(within(row).getByTestId("modality-board-waiting-duration").textContent).toContain("Estimated from completion");
  });

  it("renders oncology as a visible rose category marker outside workflow status", async () => {
    await openBoard([
      appointment({ id: 34, accessionNumber: "ACC-ONC", status: "waiting", caseCategory: "oncology", englishFullName: "Oncology Patient" }),
    ]);

    const row = screen.getByTestId("modality-board-row-34");
    const category = within(row).getByTestId("modality-board-case-category");
    expect(category.textContent).toContain("Oncology");
    expect(category.getAttribute("aria-label")).toBe("Case category: Oncology");
    expect(category.querySelector(".bg-rose-600")).toBeTruthy();
    expect(within(row).getByTestId("modality-board-status").textContent).not.toContain("Oncology");
  });

  it("renders a compact complete MR screening indicator in the patient status area", async () => {
    await openBoard([
      appointment({
        id: 35,
        modalitySafetyWorkflowType: "mri_primary_implant_screening",
        mriPrimaryScreening: { result: "no_known_implant_reported", implantSite: null, implantDescription: null, previousReviewerNameReported: null, screenedByUserId: 1, screenedAt: "2026-06-18T08:00:00Z" },
      }),
    ]);

    const complete = within(screen.getByTestId("modality-board-row-35")).getByLabelText("Primary MRI screening complete — no known implant/device reported.");
    expect(complete.textContent).toBe("MR");
    expect(complete.getAttribute("title")).toBe("Primary MRI screening complete — no known implant/device reported.");
    expect(within(screen.getByTestId("modality-board-row-35")).queryByText("MRI primary screening complete — no implant reported")).toBeNull();
  });

  it("renders compact MR review and missing-screening indicators", async () => {
    await openBoard([
      appointment({ id: 36, modalitySafetyWorkflowType: "mri_primary_implant_screening", mriPrimaryScreening: { result: "implant_reported_review_required", implantSite: "head", implantDescription: "Clip", previousReviewerNameReported: null, screenedByUserId: 1, screenedAt: "2026-06-18T08:00:00Z" } }),
      appointment({ id: 37, modalitySafetyWorkflowType: "mri_primary_implant_screening", mriPrimaryScreening: null }),
    ]);

    const review = within(screen.getByTestId("modality-board-row-36")).getByLabelText("MR safety review required — implant/device reported during primary screening. Verify device MR status before scanning.");
    expect(review.textContent).toBe("MR");
    expect(review.getAttribute("title")).toBe("MR safety review required — implant/device reported during primary screening. Verify device MR status before scanning.");
    const missing = within(screen.getByTestId("modality-board-row-37")).getByLabelText("Primary MRI screening not recorded — complete screening before MRI examination.");
    expect(missing.textContent).toBe("MR?");
    expect(missing.getAttribute("title")).toBe("Primary MRI screening not recorded — complete screening before MRI examination.");
    expect(mriPrimaryScreeningBadgesSource).not.toContain('aria-label="Primary MRI screening');
  });

  it("localizes compact MR screening labels in Arabic", async () => {
    languageState.language = "ar";
    await openBoard([
      appointment({ id: 38, modalitySafetyWorkflowType: "mri_primary_implant_screening", mriPrimaryScreening: null }),
    ]);

    const tooltip = translate("ar", "appointments.create.safety.compactMissingTooltip");
    const indicator = within(screen.getByTestId("modality-board-row-38")).getByLabelText(tooltip);
    expect(indicator.getAttribute("title")).toBe(tooltip);
  });

  it("uses language-specific direction spans for Arabic, English, identifiers, and duration", async () => {
    languageState.language = "ar";
    await openBoard([
      appointment({
        id: 33,
        accessionNumber: "ACC-BIDI-33",
        status: "completed",
        arabicFullName: "أحمد علي",
        englishFullName: "Ahmed Ali",
        examNameAr: "تصوير الدماغ",
        examNameEn: "CT Brain",
        arrivedAt: "2026-06-18T08:00:00Z",
        completedAt: "2026-06-18T09:00:00Z",
        caseCategory: "oncology",
      }),
    ]);

    await userEvent.setup().click(screen.getByRole("button", { name: "مكتمل" }));
    const row = screen.getByTestId("modality-board-row-33");
    expect(within(row).getByText("أحمد علي").getAttribute("dir")).toBe("rtl");
    expect(within(row).getByText("Ahmed Ali").getAttribute("dir")).toBe("ltr");
    expect(within(row).getByTestId("modality-board-accession").getAttribute("dir")).toBe("ltr");
    expect(within(row).getByTestId("modality-board-waiting-duration").querySelector("[dir=rtl]")).toBeTruthy();
    expect(within(row).getByTestId("modality-board-case-category").getAttribute("aria-label")).toBe("فئة الحالة: أورام");
    expect(within(row).getByTestId("modality-board-case-category").querySelector(".bg-rose-600")).toBeTruthy();
  });

  it("shows Primary ID and renders passport identifier instead of MRN or National ID", async () => {
    await openBoard([
      appointment({
        id: 27,
        accessionNumber: "ACC-PASSPORT",
        status: "waiting",
        patientPrimaryIdentifierType: "passport",
        patientPrimaryIdentifierLabelEn: "Passport",
        patientPrimaryIdentifierLabelAr: "جواز السفر",
        patientPrimaryIdentifierValue: "P123456",
        mrn: "MRN-SHOULD-NOT-SHOW",
        nationalId: "NAT-SHOULD-NOT-SHOW",
      }),
    ]);

    expect(screen.getByText("Primary ID")).toBeTruthy();
    const row = screen.getByTestId("modality-board-row-27");
    expect(within(row).getByText("Passport: P123456")).toBeTruthy();
    expect(within(row).queryByText("MRN-SHOULD-NOT-SHOW")).toBeNull();
    expect(within(row).queryByText("NAT-SHOULD-NOT-SHOW")).toBeNull();
  });

  it("shows compact No primary ID flag when primary identifier is missing", async () => {
    await openBoard([
      appointment({ id: 31, accessionNumber: "ACC-NO-ID", status: "waiting", englishFullName: "Missing ID" }),
    ]);

    const row = screen.getByTestId("modality-board-row-31");
    expect(within(row).getByText("No primary ID")).toBeTruthy();
    expect(within(row).getByText("No primary ID").getAttribute("title")).toContain("Primary identifier is missing");
  });

  it("renders Routine when priority names are missing", async () => {
    await openBoard([
      appointment({
        id: 28,
        accessionNumber: "ACC-ROUTINE",
        status: "waiting",
        priorityNameAr: null,
        priorityNameEn: null,
      }),
    ]);

    expect(within(screen.getByTestId("modality-board-row-28")).getByText("Routine")).toBeTruthy();
  });

  it("reopens completed rows only after a required reason is entered", async () => {
    const user = await openBoard([
      appointment({ id: 9, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-9");
    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /Reopen/i }));
    await screen.findByRole("heading", { name: /Confirm reopen/i });
    expect((screen.getByRole("button", { name: /Confirm reopen/i }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByPlaceholderText(/Enter a reason/i), "Scanner workflow correction");
    await user.click(screen.getByRole("button", { name: /Confirm reopen/i }));
    await waitFor(() => {
      expect(updateAppointmentStatusMock).toHaveBeenCalledWith(9, "arrived", "Scanner workflow correction");
    });
  });

  it("uses the CD button on completed rows and keeps Print in More", async () => {
    const user = await openBoard([
      appointment({ id: 31, status: "completed", completedAt: "2026-06-18T10:00:00Z" }),
    ], [{ key: "robot-a", name: "Robot A" }]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-31");
    expect(within(row).queryByRole("button", { name: "Print" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Send CD" }));
    await waitFor(() => expect(createCdRobotDeliveryMock).toHaveBeenCalledWith(31, { destinationKey: "robot-a", resendReasonCode: undefined, resendReasonText: undefined }));

    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    await user.click(screen.getByRole("menuitem", { name: "Print" }));
    expect(printAppointmentSlipByIdMock).toHaveBeenCalledWith(31, "en");
  });

  it("shows CD sending and patient-active states as disabled", async () => {
    const user = await openBoard([
      appointment({ id: 32, status: "completed", cdActiveStatus: "sending", cdPatientActive: true }),
      appointment({ id: 33, status: "completed", cdPatientActive: true }),
    ], [{ key: "robot-a", name: "Robot A" }]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const sending = within(screen.getByTestId("modality-board-row-32")).getByRole("button", { name: "Sending" });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    expect(sending.querySelector(".animate-spin")).toBeTruthy();
    const patientActive = within(screen.getByTestId("modality-board-row-33")).getByRole("button", { name: "CD unavailable" });
    expect((patientActive as HTMLButtonElement).disabled).toBe(true);
    expect(patientActive.getAttribute("title")).toContain("Another CD for this patient");
  });

  it("shows latest CD failure over prior success and opens delivery history for retry", async () => {
    const user = await openBoard([
      appointment({ id: 34, status: "completed", cdSuccessfulCount: 2, cdLatestFailed: true }),
    ], [{ key: "robot-a", name: "Robot A" }]);
    fetchCdRobotDeliveriesMock.mockResolvedValue({ deliveries: [{ id: 44, destination_key: "robot-a", status: "failed", attempt_count: 1, resend_reason_code: null, resend_reason_text: null, requested_at: "2026-06-18T10:00:00Z", completed_at: "2026-06-18T10:01:00Z", last_error: "C-ECHO failed", requested_by: "modality" }] });

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const row = screen.getByTestId("modality-board-row-34");
    const failedButton = within(row).getByRole("button", { name: "Failed" });
    expect(failedButton.className).toContain("bg-red-50");
    expect((failedButton as HTMLButtonElement).style.backgroundColor).toBe("rgb(254, 242, 242)");
    await user.click(failedButton);
    await screen.findByRole("heading", { name: "CD delivery history" });
    await screen.findByText(/C-ECHO failed/);
    fetchModalityWorklistMock.mockResolvedValue([appointment({ id: 34, status: "completed", cdSuccessfulCount: 3, cdLatestFailed: false })]);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryCdRobotDeliveryMock.mock.calls[0]?.[0]).toBe(44));
    await waitFor(() => expect(within(row).getByRole("button", { name: "Sent" }).textContent).toContain("×3"));
  });

  it("keeps successful CD resend available with the successful-copy count", async () => {
    const user = await openBoard([
      appointment({ id: 35, status: "completed", cdSuccessfulCount: 2 }),
    ], [{ key: "robot-a", name: "Robot A" }]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const button = within(screen.getByTestId("modality-board-row-35")).getByRole("button", { name: "Sent" });
    expect(button.textContent).toContain("×2");
    expect(button.className).toContain("bg-emerald-50");
    expect((button as HTMLButtonElement).style.backgroundColor).toBe("rgb(236, 253, 245)");
    await user.click(button);
    await screen.findByRole("heading", { name: "Send additional CD" });
    expect(screen.getByRole("combobox", { name: "Reason" })).toBeTruthy();
  });

  it("localizes the CD resend modal for Arabic and uses RTL content", async () => {
    languageState.language = "ar";
    const user = await openBoard([
      appointment({ id: 36, status: "completed", cdSuccessfulCount: 1 }),
      appointment({ id: 38, status: "completed", cdPatientActive: true }),
    ], [{ key: "robot-a", name: "RIS" }]);

    await user.click(screen.getByRole("button", { name: translate("ar", "modality.completed") }));
    const patientActive = within(screen.getByTestId("modality-board-row-38")).getByRole("button", { name: translate("ar", "modality.cd.unavailable") });
    expect((patientActive as HTMLButtonElement).disabled).toBe(true);
    expect(patientActive.getAttribute("title")).toContain(translate("ar", "modality.cd.patientActiveTooltip"));
    await user.click(within(screen.getByTestId("modality-board-row-36")).getByRole("button", { name: translate("ar", "modality.cd.sent") }));
    await screen.findByRole("heading", { name: translate("ar", "modality.cd.sendAdditional") });
    expect(screen.getByRole("combobox", { name: translate("ar", "modality.cd.reason") })).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector('[dir="rtl"]')).toBeTruthy();
  });

  it("localizes known CD errors in Arabic and retains unknown backend details", async () => {
    languageState.language = "ar";
    const user = await openBoard([
      appointment({ id: 37, status: "completed" }),
    ], [{ key: "robot-a", name: "RIS" }]);
    createCdRobotDeliveryMock.mockRejectedValueOnce(new Error("Study not found in Authoritative Orthanc."));

    await user.click(screen.getByRole("button", { name: translate("ar", "modality.completed") }));
    const row = screen.getByTestId("modality-board-row-37");
    await user.click(within(row).getByRole("button", { name: translate("ar", "modality.cd.send") }));
    expect((await screen.findByRole("alert")).textContent).toContain(translate("ar", "modality.cd.error.studyNotFound"));

    createCdRobotDeliveryMock.mockRejectedValueOnce(new Error("Transport diagnostic 97"));
    await user.click(within(row).getByRole("button", { name: translate("ar", "modality.cd.send") }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Transport diagnostic 97"));
  });

  it("shows full patient and appointment details in the selected row drawer", async () => {
    const user = await openBoard([
      appointment({
        id: 5,
        accessionNumber: "ACC-DETAIL",
        englishFullName: "Detail Patient",
        mrn: "MRN-DETAIL",
        nationalId: "NAT-DETAIL",
        ageYears: 63,
        sex: "M",
        modalityNameEn: "MRI",
        examNameEn: "MRI Abdomen",
        priorityNameEn: "Urgent",
        notes: "Needs interpreter",
      }),
    ]);

    await user.click(screen.getByTestId("modality-board-row-5"));

    const drawer = screen.getByTestId("selected-appointment-drawer");
    expect(within(drawer).getByText("Detail Patient")).toBeTruthy();
    expect(within(drawer).getByText("MRN-DETAIL")).toBeTruthy();
    expect(within(drawer).getByText("NAT-DETAIL")).toBeTruthy();
    expect(within(drawer).getByText(/63 years.*Male/)).toBeTruthy();
    expect(within(drawer).getByText("ACC-DETAIL")).toBeTruthy();
    expect(within(drawer).getByTitle("MRI Abdomen")).toBeTruthy();
    expect(within(drawer).getByTitle("MRI")).toBeTruthy();
    expect(within(drawer).getByText("Urgent")).toBeTruthy();
    expect(within(drawer).getByTestId("clinical-appointment-notes").textContent).toContain("Needs interpreter");
  });

  it("lets modality staff ingest clinical documents from the selected appointment workspace", async () => {
    const user = await openBoard(
      [appointment({ id: 6, accessionNumber: "ACC-WORKSPACE" })],
      [],
      {
        role: "modality_staff",
        scanner: {
          naps2WebScanEnabled: true,
          naps2WebScanEndpoint: "http://127.0.0.1:18622",
          scannerAppEnabled: true,
        },
      },
    );
    listAppointmentDocumentsMock.mockResolvedValue([{
      id: 41,
      patientId: 10,
      appointmentId: null,
      v2BookingId: 6,
      documentType: "appointment_request",
      originalFilename: "referral.png",
      storedPath: "documents/referral.png",
      mimeType: "image/png",
      fileSize: 64,
      storageLocationType: "local_fallback",
      source: "manual_upload",
      lastMoveAttemptAt: null,
      lastMoveError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }]);

    await user.click(screen.getByTestId("modality-board-row-6"));

    const workspace = await screen.findByTestId("clinical-workspace");
    expect(workspace).toBeTruthy();
    expect(within(workspace).getByTestId("clinical-protocol")).toBeTruthy();
    expect(within(workspace).getByTestId("clinical-request-documents")).toBeTruthy();
    expect(await within(workspace).findByText("referral.png")).toBeTruthy();
    expect(within(workspace).getAllByRole("img", { name: "referral.png" }).length).toBeGreaterThan(0);
    const fileInput = within(workspace).getByTestId("document-file-input") as HTMLInputElement;
    expect(within(workspace).getByText("Upload Clinical Document")).toBeTruthy();
    expect(within(workspace).getByRole("button", { name: "Scan Paper" })).toBeTruthy();

    await user.upload(fileInput, new File(["clinical"], "clinical.pdf", { type: "application/pdf" }));
    await user.click(within(workspace).getByRole("button", { name: "Attach Clinical Document" }));
    await waitFor(() => expect(uploadAppointmentDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 6,
      appointmentRefType: "v2_booking",
      documentType: "clinical_document",
      source: "manual_upload",
    })));

    expect(screen.getByTestId("clinical-workspace")).toBeTruthy();
    expect(within(workspace).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(workspace.className).toContain("lg:grid-cols-1");
  });

  it("contains the clinical workspace while preserving protocol-first mobile order", async () => {
    const user = await openBoard([appointment({ id: 6, accessionNumber: "ACC-MOBILE" })]);

    await user.click(screen.getByTestId("modality-board-row-6"));

    const workspace = await screen.findByTestId("clinical-workspace");
    expect(workspace.firstElementChild).toBe(screen.getByTestId("clinical-protocol"));
    expect(workspace.lastElementChild).toBe(screen.getByTestId("clinical-request-documents"));
    const workspaceRegion = screen.getByTestId("clinical-workspace-region");
    expect(workspaceRegion.className).toContain("overflow-hidden");
    expect(workspaceRegion.className).not.toContain("overflow-y-auto");
    expect(workspace.className).toContain("h-full");
    expect(workspace.className).toContain("min-h-0");
    expect(screen.getByTestId("clinical-request-documents").className).toContain("h-full");
    expect(screen.getByTestId("clinical-request-documents").className).toContain("min-h-0");
  });

  it("keeps the appointment header and operational actions outside the contained document workspace", async () => {
    const user = await openBoard([appointment({ id: 61, status: "arrived", accessionNumber: "ACC-CONTAINED" })]);

    await user.click(screen.getByTestId("modality-board-row-61"));

    const drawer = screen.getByTestId("selected-appointment-drawer");
    const dialogContent = drawer.parentElement;
    const header = within(drawer).getByTestId("clinical-patient-banner").parentElement?.parentElement;
    const workspaceRegion = screen.getByTestId("clinical-workspace-region");
    const footer = screen.getByTestId("clinical-operational-footer");
    expect(header?.parentElement).toBe(workspaceRegion.parentElement);
    expect(footer.parentElement).toBe(workspaceRegion.parentElement);
    expect(dialogContent?.className).toContain("h-[94dvh]");
    expect(dialogContent?.className).toContain("max-h-[94dvh]");
    expect(dialogContent?.className).not.toContain("h-screen");
    expect(within(footer).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "Back to waiting" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "Complete" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "Discontinue" })).toBeTruthy();
  });

  it("renders an attached request document in the clinical document workspace", async () => {
    const user = await openBoard([appointment({ id: 16, accessionNumber: "ACC-DOCUMENT" })], [], { role: "modality_staff" });
    listAppointmentDocumentsMock.mockResolvedValue([{
      id: 41,
      patientId: 10,
      appointmentId: null,
      v2BookingId: 16,
      documentType: "appointment_request",
      originalFilename: "referral.png",
      storedPath: "documents/referral.png",
      mimeType: "image/png",
      fileSize: 64,
      storageLocationType: "local_fallback",
      lastMoveAttemptAt: null,
      lastMoveError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }]);

    await user.click(screen.getByTestId("modality-board-row-16"));

    const requestSection = await screen.findByTestId("clinical-request-documents");
    expect(await within(requestSection).findByText("referral.png")).toBeTruthy();
    expect(within(requestSection).getAllByRole("img", { name: "referral.png" }).length).toBeGreaterThan(0);
    const fileInput = within(requestSection).getByTestId("document-file-input");
    expect(fileInput).toBeTruthy();
    expect(within(requestSection).getByText("Upload Clinical Document")).toBeTruthy();
    expect(within(requestSection).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(requestSection).queryByRole("toolbar", { name: "Document annotation controls" })).toBeNull();
  });

  it("shows assigned protocol in the Protocol column without a Patient-cell badge", async () => {
    await openBoard([
      appointment({
        id: 7,
        accessionNumber: "ACC-PROTOCOL",
        protocolAssignmentSummary: {
          assignmentId: 90,
          protocolName: "MRI Rectum Primary Staging",
          versionNumber: "1.2",
          freeTextProtocol: null,
          scannerName: "Philips Ingenia Elition 3T",
          assignedBy: "Dr. Protocol",
          assignedAt: "2026-06-29T08:00:00Z",
          protocolNotes: "Rectum protocol",
          contrastNotes: null,
        },
      }),
    ]);

    const row = screen.getByTestId("modality-board-row-7");
    expect(within(row).getByText("MRI Rectum Primary Staging v1.2")).toBeTruthy();
    expect(within(row).queryByText("Protocol assigned")).toBeNull();
    expect(within(row).queryByText("Scanner: Philips Ingenia Elition 3T")).toBeNull();
    expect(within(row).queryByText("Notes available")).toBeNull();
  });

  it("does not render the redundant protocol-assigned label in Arabic", async () => {
    languageState.language = "ar";
    await openBoard([
      appointment({
        id: 19,
        accessionNumber: "ACC-PROTOCOL-AR",
        protocolAssignmentSummary: {
          assignmentId: 91,
          protocolName: "CT Abdomen",
          versionNumber: "1.0",
          freeTextProtocol: null,
          scannerName: null,
          assignedBy: "Dr. Protocol",
          assignedAt: "2026-06-29T08:00:00Z",
          protocolNotes: null,
          contrastNotes: null,
        },
      }),
    ]);

    const row = screen.getByTestId("modality-board-row-19");
    expect(within(row).getByText("CT Abdomen v1.0")).toBeTruthy();
    expect(within(row).queryByText(translate("ar", "modality.protocolAssigned"))).toBeNull();
  });

  it("renders Assigned CT Protocol with CT phase terminology", async () => {
    const user = await openBoard([appointment({ id: 7, accessionNumber: "ACC-CT-PROTOCOL" })]);
    fetchModalityProtocolAssignmentMock.mockResolvedValue(ctAssignment());

    await user.click(screen.getByTestId("modality-board-row-7"));

    const drawer = await screen.findByTestId("selected-appointment-drawer");
    await within(drawer).findByText("Assigned protocol");
    expect(within(drawer).getByText("CT Abdomen v1.2")).toBeTruthy();
    expect(within(drawer).getByText("Phase")).toBeTruthy();
    expect(within(drawer).queryByText("Sequence")).toBeNull();
    expect(within(drawer).getByText("Liver to symphysis")).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: /Patient instructions/ }).getAttribute("aria-expanded")).toBe("false");
    expect(within(drawer).queryByText("Renal protocol")).toBeNull();
    expect(within(drawer).queryByText("This protocol was assigned by the doctor. Changes to scanner execution should be documented separately.")).toBeNull();
    expect(fetchModalityProtocolAssignmentMock).toHaveBeenCalledWith(7);
  });

  it("keeps the protocol card LTR, collapses Arabic instructions, and hides empty metadata", async () => {
    const arabicInstructions = "الصيام 6 ساعات\nإحضار التقارير السابقة";
    const user = await openBoard([
      appointment({
        id: 17,
        accessionNumber: "ACC-LTR",
        modalityGeneralInstructionAr: arabicInstructions,
        modalityGeneralInstructionEn: null,
      }),
    ]);
    fetchModalityProtocolAssignmentMock.mockResolvedValue(ctAssignment({
      assignmentId: 17,
      appointmentId: 17,
      protocolName: null,
      versionNumber: null,
      freeTextProtocol: "Upper Abdomen 35s\nCAP 65s",
      scannerName: null,
      scannerVendor: null,
      assignedBy: null,
      protocolNotes: null,
      contrastNotes: null,
      ctPhases: [],
    }));

    await user.click(screen.getByTestId("modality-board-row-17"));
    const drawer = await screen.findByTestId("selected-appointment-drawer");
    const panel = within(drawer).getByTestId("modality-protocol-section");
    expect(panel.getAttribute("dir")).toBe("ltr");
    expect(within(panel).getByTestId("clinical-protocol-content").textContent).toContain("Upper Abdomen 35s\nCAP 65s");
    expect(within(panel).queryByText("Scanner")).toBeNull();
    expect(within(panel).queryByText("Contrast/preparation instructions")).toBeNull();
    expect(within(panel).queryByText("Protocol notes")).toBeNull();
    expect(within(panel).queryByTestId("clinical-acquisition-table")).toBeNull();

    const disclosure = within(panel).getByRole("button", { name: /Patient instructions/ });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(within(panel).queryByText(arabicInstructions)).toBeNull();
    await user.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    const instruction = within(panel).getByText((text) => text.includes("الصيام 6 ساعات"));
    expect(instruction.getAttribute("dir")).toBe("auto");
  });

  it("renders CT acquisition columns in scanner order only when rows exist", async () => {
    const user = await openBoard([appointment({ id: 18, accessionNumber: "ACC-ORDER" })]);
    fetchModalityProtocolAssignmentMock.mockResolvedValue(ctAssignment({ assignmentId: 18, appointmentId: 18 }));

    await user.click(screen.getByTestId("modality-board-row-18"));
    const drawer = await screen.findByTestId("selected-appointment-drawer");
    const table = within(drawer).getByTestId("clinical-acquisition-table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Order",
      "Phase",
      "Timing",
      "Coverage",
      "Reconstruction",
      "Required",
      "Instructions",
    ]);
  });

  it("prints assigned protocol separately from the appointment slip", async () => {
    const user = await openBoard([appointment({ id: 7, accessionNumber: "ACC-CT-PROTOCOL" })]);
    fetchModalityProtocolAssignmentMock.mockResolvedValue(ctAssignment());

    await user.click(screen.getByTestId("modality-board-row-7"));

    const drawer = await screen.findByTestId("selected-appointment-drawer");
    await user.click(await within(drawer).findByRole("button", { name: "Print protocol" }));
    expect(printProtocolSheetMock).toHaveBeenCalledWith(expect.objectContaining({
      patientName: "Patient One",
      accession: "ACC-CT-PROTOCOL",
      protocolName: "CT Abdomen",
      modality: "CT",
    }));

    await user.click(within(drawer).getByLabelText("Print"));
    expect(printAppointmentSlipByIdMock).toHaveBeenCalledWith(7, "en");
  });

  it("renders Assigned MRI Protocol with MRI sequence terminology", async () => {
    const user = await openBoard([appointment({ id: 8, modalityCode: "MRI", modalityNameEn: "MRI", examNameEn: "MRI Pelvis" })]);
    fetchModalityProtocolAssignmentMock.mockResolvedValue(mriAssignment());

    await user.click(screen.getByTestId("modality-board-row-8"));

    const drawer = await screen.findByTestId("selected-appointment-drawer");
    await within(drawer).findByText("Assigned protocol");
    expect(within(drawer).getByText("MRI Rectum Primary Staging v1.2")).toBeTruthy();
    expect(within(drawer).getAllByText("Philips Ingenia Elition 3T - Philips").length).toBeGreaterThan(0);
    expect(within(drawer).getByRole("button", { name: "Print protocol" })).toBeTruthy();
    expect(within(drawer).getByText("Sequence")).toBeTruthy();
    expect(within(drawer).queryByText("Phase")).toBeNull();
    expect(within(drawer).getByText("rectum-centered")).toBeTruthy();
    expect(within(drawer).getByText("oblique axial")).toBeTruthy();
  });

  it("treats MR as MRI, showing the assigned protocol and fetching its detail", async () => {
    const assigned = mriAssignment({ appointmentId: 20, protocolId: null, protocolVersionId: null, freeTextProtocol: "MRI brain with contrast", protocolName: null, versionNumber: null, mriSequences: [] });
    const user = await openBoard([appointment({
      id: 20,
      modalityCode: "MR",
      modalityNameEn: "MRI",
      examNameEn: "MRI Brain",
      protocolAssignmentSummary: {
        assignmentId: 96,
        protocolName: null,
        versionNumber: null,
        freeTextProtocol: "MRI brain with contrast",
        scannerName: null,
        assignedBy: null,
        assignedAt: null,
        protocolNotes: null,
        contrastNotes: null,
      },
    })]);
    fetchModalityProtocolAssignmentMock.mockResolvedValue(assigned);

    const row = screen.getByTestId("modality-board-row-20");
    expect(within(row).getByText("Free-text protocol")).toBeTruthy();
    expect(within(row).queryByText("Protocol assigned")).toBeNull();
    await user.click(row);

    const drawer = await screen.findByTestId("selected-appointment-drawer");
    expect(await within(drawer).findByText("Assigned protocol")).toBeTruthy();
    expect(within(drawer).getByText("MRI brain with contrast")).toBeTruthy();
    expect(within(drawer).queryByText("No protocol assigned")).toBeNull();
    expect(fetchModalityProtocolAssignmentMock).toHaveBeenCalledWith(20);
  });

  it("renders no assignment state cleanly for CT and exposes no protocol edit controls", async () => {
    fetchModalityProtocolAssignmentMock.mockResolvedValue(null);
    const user = await openBoard([appointment({ id: 9, accessionNumber: "ACC-NO-PROTOCOL" })]);

    expect(within(screen.getByTestId("modality-board-row-9")).getByText("No protocol assigned")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-9")).queryByText("Protocol assigned")).toBeNull();
    await user.click(screen.getByTestId("modality-board-row-9"));

    const drawer = await screen.findByTestId("selected-appointment-drawer");
    expect(await within(drawer).findByText("No protocol assigned")).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: /protocol/i })).toBeNull();
    expect(within(drawer).queryByText(/Change protocol/i)).toBeNull();
    expect(within(drawer).queryByText(/Assign protocol/i)).toBeNull();
  });

  it("uses a neutral Arabic close action and no cancellation action in the selected drawer", async () => {
    languageState.language = "ar";
    const user = userEvent.setup();
    renderPage([
      appointment({ id: 12, accessionNumber: "ACC-AR", status: "arrived", englishFullName: "Arabic Action Patient" }),
    ]);
    await screen.findByRole("option", { name: "CT" });
    await user.selectOptions(screen.getByRole("combobox"), "1");

    await user.click(await screen.findByTestId("modality-board-row-12"));

    const drawer = screen.getByTestId("selected-appointment-drawer");
    expect(within(drawer).getByRole("button", { name: "إغلاق" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "إيقاف الحالة" })).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "إلغاء الموعد" })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: /^إلغاء$/ })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: /^إيقاف$/ })).toBeNull();

    await user.click(within(drawer).getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByTestId("selected-appointment-drawer")).toBeNull();
    expect(updateAppointmentStatusMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("modality-board-row-12"));
    await user.click(within(screen.getByTestId("selected-appointment-drawer")).getByRole("button", { name: "إيقاف الحالة" }));
    await screen.findByRole("heading", { name: "تأكيد إيقاف الحالة" });
    expect(screen.getByRole("button", { name: "تأكيد إيقاف الحالة" })).toBeTruthy();
  });

  it("does not leave modality-board cancellation action wiring in legacy or menu surfaces", () => {
    expect(modalityPageSource).not.toContain('status: "cancelled" | "discontinued"');
    expect(modalityPageSource).not.toContain('status: "cancelled", reasonRequired: true');
    expect(modalityPageSource).not.toContain("Confirm cancellation");
    expect(modalityPageSource).not.toContain("إلغاء الموعد");
  });

  it("does not render ambiguous حي or سجل labels on the Arabic modality board", async () => {
    languageState.language = "ar";
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-AR-LIVE", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Arabic Live" }),
    ]);

    expect(screen.queryByText("حي")).toBeNull();
    expect(screen.queryByText("سجل")).toBeNull();
    expect(screen.queryByText("الحالات الحية أولاً، السجل في الأسفل")).toBeNull();
    expect(screen.getByRole("button", { name: "نشط" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "جاهز" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "لم يصل" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "مكتمل" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "مشكلة" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "الكل" })).toBeTruthy();
  });

  it("renders English modality board without broken live/history labels", async () => {
    languageState.language = "en";
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-EN-LIVE", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "English Live" }),
    ]);

    expect(screen.queryByText("Live cases first, history below")).toBeNull();
    expect(screen.getByRole("button", { name: "Operational" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Arrived/Ready" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not arrived" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Completed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Problem" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
  });

  it("loads previous studies only from its tab and opens History in the same modal", async () => {
    languageState.language = "en";
    fetchModalityPreviousStudiesMock.mockClear();
    await openBoard([appointment({ id: 31 })]);
    expect(fetchModalityPreviousStudiesMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Patient One"));
    expect(screen.getByRole("button", { name: "Appointment" }).getAttribute("data-state")).toBe("active");
    expect(fetchModalityPreviousStudiesMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Previous studies" }));
    await waitFor(() => expect(fetchModalityPreviousStudiesMock).toHaveBeenCalledWith(31));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(fetchModalityPreviousStudiesMock).toHaveBeenCalledWith(31));
    expect(screen.getByRole("button", { name: "Previous studies" }).getAttribute("data-state")).toBe("active");
  });

  it("renders localized previous-study evidence, visibility, and attestation changes", async () => {
    languageState.language = "en";
    const candidate = { historicalPatientId: "OLD-77", patientName: "Historical Patient", patientBirthDate: "19801231", patientSex: "F", classification: "strong_demographic", reasons: ["exact_normalized_name", "exact_dob", "compatible_sex"], authoritative: false, matchRank: 1, nameSimilarity: 1, phoneticMatchCount: 0, studyCount: 4, studies: [
      { orthancStudyId: "visible", studyInstanceUid: "1.2.visible", accessionNumber: "OLD-ACC", patientId: "OLD-77", patientName: "Historical Patient", patientBirthDate: "19801231", patientSex: "F", studyDate: "20240102", studyDescription: "Visible study", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 1 },
      { orthancStudyId: "hidden-forward", studyInstanceUid: "1.2.hidden.forward", accessionNumber: null, patientId: null, patientName: null, patientBirthDate: null, patientSex: null, studyDate: "20240102", studyDescription: "Hidden forward", modalitiesInStudy: [], seriesCount: 0, instanceCount: 0, reconciliation: { id: 1, operationType: "reconcile", status: "completed", oldPatientId: "OLD-77", failureCode: null } },
      { orthancStudyId: "hidden-reverse", studyInstanceUid: "1.2.hidden.reverse", accessionNumber: null, patientId: null, patientName: null, patientBirthDate: null, patientSex: null, studyDate: "20240102", studyDescription: "Hidden reverse", modalitiesInStudy: [], seriesCount: 0, instanceCount: 0, reconciliation: { id: 2, operationType: "reverse", status: "queued", oldPatientId: "OLD-77", failureCode: null } },
      { orthancStudyId: "denied", studyInstanceUid: "1.2.denied", accessionNumber: null, patientId: null, patientName: null, patientBirthDate: null, patientSex: null, studyDate: "20240102", studyDescription: "Denied remains visible", modalitiesInStudy: ["MR"], seriesCount: 1, instanceCount: 2, attestation: { studyInstanceUid: "1.2.denied", status: "denied", recordedByUserId: 4, recordedByName: "Reviewer", recordedAt: "2026-06-18T08:00:00Z" } },
    ] };
    fetchModalityPreviousStudiesMock.mockResolvedValue({ history: { items: [{ appointmentId: 1, orthancStudyId: null, studyInstanceUid: null, accessionNumber: null, date: "2024-01-01", time: null, modalities: ["CT"], description: "RISpro PACS", appointmentStatus: "completed", reportAvailable: false, source: "rispro_pacs", identityDiscrepancy: "patient_id_mismatch" }, { appointmentId: 2, orthancStudyId: null, studyInstanceUid: null, accessionNumber: null, date: "2024-01-01", time: null, modalities: ["CT"], description: "RISpro only", appointmentStatus: null, reportAvailable: false, source: "rispro_only", identityDiscrepancy: null }, { appointmentId: 3, orthancStudyId: null, studyInstanceUid: null, accessionNumber: null, date: "2024-01-01", time: null, modalities: ["CT"], description: "PACS only", appointmentStatus: null, reportAvailable: false, source: "pacs_only", identityDiscrepancy: null }], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null }, historicalCandidates: [candidate], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, historicalCandidatesError: false });
    await openBoard([appointment({ id: 1 })]);
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("In PACS")).toBeTruthy(); expect(screen.getByText("Not in PACS")).toBeTruthy(); expect(screen.getByText("PACS only")).toBeTruthy();
    expect(screen.getByText("Study UID matches, but the PACS Patient ID differs from this RISpro patient.")).toBeTruthy();
    expect(screen.getByText("Strong demographic match")).toBeTruthy(); expect(screen.getByText(/31\/12\/1980/)).toBeTruthy(); expect(screen.getAllByText(/Female/).length).toBeGreaterThan(3);
    await userEvent.click(screen.getByText("Why this matched"));
    expect(screen.getByText(/Exact normalized name, Exact date of birth, Compatible sex/)).toBeTruthy();
    expect(screen.queryByText(/Hidden forward/)).toBeNull(); expect(screen.queryByText(/Hidden reverse/)).toBeNull(); expect(screen.getByText(/Denied remains visible/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Patient confirms" })[0]);
    await waitFor(() => expect(recordModalityHistoricalPacsAttestationMock).toHaveBeenCalledWith(1, "1.2.visible", "confirmed"));
    await userEvent.click(screen.getAllByRole("button", { name: "Patient denies" })[0]);
    expect(recordModalityHistoricalPacsAttestationMock).toHaveBeenCalledTimes(1); expect(screen.getByText("Confirm changing the patient ownership attestation.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("reports a failed patient confirmation without changing the persisted attestation state", async () => {
    fetchModalityPreviousStudiesMock.mockResolvedValue({
      history: { items: [], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null },
      historicalCandidates: [{
        historicalPatientId: "OLD-77", patientName: "Historical Patient", patientBirthDate: "19801231", patientSex: "F", classification: "strong_demographic", reasons: ["exact_normalized_name"], authoritative: false, matchRank: 1, nameSimilarity: 1, phoneticMatchCount: 0, studyCount: 1,
        studies: [{ orthancStudyId: "historical", studyInstanceUid: "1.2.3.4", accessionNumber: "OLD-ACC", patientId: "OLD-77", patientName: "Historical Patient", patientBirthDate: "19801231", patientSex: "F", studyDate: "20240102", studyDescription: "Historical CT", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 10 }],
      }],
      historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, historicalCandidatesError: false,
    });

    const user = await openBoard([appointment({ id: 1 })]);
    recordModalityHistoricalPacsAttestationMock.mockRejectedValue(new Error("save failed"));
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("Unreviewed")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Patient confirms" }));
    await waitFor(() => expect(recordModalityHistoricalPacsAttestationMock).toHaveBeenCalledWith(1, "1.2.3.4", "confirmed"));
    await waitFor(() => expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
    expect(screen.queryByText("Patient confirmed")).toBeNull();
    expect(screen.getByText("Unreviewed")).toBeTruthy();
  });

  it("renders Previous Studies evidence in Arabic without raw PACS values", async () => {
    languageState.language = "ar";
    fetchModalityPreviousStudiesMock.mockResolvedValue({
      history: {
        items: [{ appointmentId: 1, orthancStudyId: null, studyInstanceUid: null, accessionNumber: null, date: "2024-01-01", time: null, modalities: ["CT"], description: "Previous CT", appointmentStatus: "voided", reportAvailable: false, source: "rispro_pacs", identityDiscrepancy: "patient_id_mismatch" }],
        pacsStatus: "available",
        historicalPacsIndexStatus: "ready",
        historicalPacsLastSuccessAt: null,
      },
      historicalCandidates: [{
        historicalPatientId: "OLD-77", patientName: "Historical Patient", patientBirthDate: "19801231", patientSex: "F", classification: "strong_demographic", reasons: ["exact_normalized_name", "exact_dob", "compatible_sex"], authoritative: false, matchRank: 1, nameSimilarity: 1, phoneticMatchCount: 0, studyCount: 1,
        studies: [{ orthancStudyId: "historical", studyInstanceUid: "1.2.3.4", accessionNumber: "OLD-ACC", patientId: "OLD-77", patientName: "Historical Patient", patientBirthDate: "19801231", patientSex: "F", studyDate: "20240102", studyDescription: "Historical CT", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 10 }],
      }],
      historicalPacsIndexStatus: "ready",
      historicalPacsLastSuccessAt: null,
      historicalCandidatesError: false,
    });

    await openBoard([appointment({ id: 1 })]);
    await userEvent.click(screen.getByRole("button", { name: "الدراسات السابقة" }));
    await screen.findByText("الدراسات السابقة");
    await userEvent.click(screen.getByText("سبب المطابقة"));
    const previousStudies = screen.getByRole("dialog");

    for (const text of ["سجل المريض في RISpro", "مطابقات PACS التاريخية", "موجودة في PACS", "مطابقة ديموغرافية قوية", "لم يتم التحقق", "المريض يؤكد", "المريض ينفي"]) {
      expect(within(previousStudies).getByText(text)).toBeTruthy();
    }
    for (const text of [/مبطل/, /رقم المريض القديم/, /^تاريخ الميلاد:/, /^الجنس: أنثى$/, /تطابق تام في الاسم بعد التوحيد/, /تطابق تام في تاريخ الميلاد/, /الجنس متوافق/]) expect(within(previousStudies).getByText(text)).toBeTruthy();
    expect(within(previousStudies).getByText("معرف الدراسة مطابق لكن معرف PACS للمريض مختلف.")).toBeTruthy();
    for (const rawValue of ["Historical PACS matches", "RISpro patient history", "Patient confirms", "Patient denies", "Unreviewed", "strong_demographic", "exact_normalized_name", "exact_dob", "compatible_sex", "voided", "Female", "19801231", "20240102"]) {
      expect(within(previousStudies).queryByText(rawValue)).toBeNull();
    }
  });

  it("keeps RISpro patient history visible when Historical PACS candidates fail", async () => {
    fetchModalityPreviousStudiesMock.mockResolvedValue({
      history: { items: [{ appointmentId: 1, orthancStudyId: null, studyInstanceUid: null, accessionNumber: "RISpro-ACC", date: "2024-01-01", time: null, modalities: ["CT"], description: "RISpro study remains", appointmentStatus: "completed", reportAvailable: false, source: "rispro_pacs", identityDiscrepancy: null }], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null },
      historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null, historicalCandidatesError: true,
    });

    await openBoard([appointment({ id: 1 })]);
    await userEvent.click(screen.getByRole("button", { name: "History" }));

    expect(await screen.findByText("RISpro patient history")).toBeTruthy();
    expect(await screen.findByText(/RISpro study remains/)).toBeTruthy();
    expect(screen.getByText("Historical PACS search failed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry historical search" })).toBeTruthy();
  });

  it.each([
    ["stale", /Historical PACS index is not current/i, true],
    ["unavailable", /unavailable/i, false],
    ["uninitialized", /not ready/i, false],
    ["ready", null, true],
  ] as const)("renders the %s Historical PACS index state without a false empty result", async (historicalPacsIndexStatus, stateMessage, candidateMayRender) => {
    fetchModalityPreviousStudiesMock.mockResolvedValue({
      history: { items: [], pacsStatus: "available", historicalPacsIndexStatus, historicalPacsLastSuccessAt: historicalPacsIndexStatus === "stale" ? "2026-06-17T08:00:00Z" : null },
      historicalCandidates: historicalPacsIndexStatus === "stale" ? [{ historicalPatientId: "OLD-77", patientName: "Historical Patient", patientBirthDate: "19801231", patientSex: "F", classification: "strong_demographic", reasons: ["exact_normalized_name"], authoritative: false, matchRank: 1, nameSimilarity: 1, phoneticMatchCount: 0, studyCount: 1, studies: [{ orthancStudyId: "historical", studyInstanceUid: "1.2.3.4", accessionNumber: "OLD-ACC", patientId: "OLD-77", patientName: "Historical Patient", patientBirthDate: "19801231", patientSex: "F", studyDate: "20240102", studyDescription: "Historical CT", modalitiesInStudy: ["CT"], seriesCount: 2, instanceCount: 10 }] }] : [],
      historicalPacsIndexStatus,
      historicalPacsLastSuccessAt: historicalPacsIndexStatus === "stale" ? "2026-06-17T08:00:00Z" : null,
      historicalCandidatesError: false,
    });

    await openBoard([appointment({ id: 1 })]);
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    if (stateMessage) expect(await screen.findByText(stateMessage)).toBeTruthy();
    if (candidateMayRender && historicalPacsIndexStatus === "stale") expect(screen.getByText("Historical Patient")).toBeTruthy();
    if (historicalPacsIndexStatus === "ready") expect(await screen.findByText(/No possible matches found/)).toBeTruthy();
    else expect(screen.queryByText(/No possible matches found/)).toBeNull();
  });

  it("opens Previous studies from a cold History entry", async () => {
    languageState.language = "en";
    fetchModalityPreviousStudiesMock.mockClear();
    await openBoard([appointment({ id: 52 })]);
    expect(fetchModalityPreviousStudiesMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("button", { name: "Previous studies" }).getAttribute("data-state")).toBe("active");
    expect(screen.getByRole("button", { name: "Appointment" }).getAttribute("data-state")).toBe("inactive");
    await waitFor(() => expect(fetchModalityPreviousStudiesMock).toHaveBeenCalledWith(52));
  });
});
