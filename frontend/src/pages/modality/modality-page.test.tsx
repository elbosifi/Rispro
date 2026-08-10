import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const listAppointmentDocumentsMock = vi.fn();
const fetchCurrentSessionMock = vi.fn();
const fetchIntegrationStatusMock = vi.fn();
const completeAppointmentMock = vi.fn();
const fetchCdRobotDestinationsMock = vi.fn();
const fetchCdRobotDeliveriesMock = vi.fn();
const createCdRobotDeliveryMock = vi.fn();
const retryCdRobotDeliveryMock = vi.fn();
const updateAppointmentStatusMock = vi.fn();
const printAppointmentSlipByIdMock = vi.fn();
const printProtocolSheetMock = vi.fn();
const languageState = vi.hoisted(() => ({ language: "en" as "en" | "ar" }));
const modalityPageSource = readFileSync(join(process.cwd(), "src/pages/modality/modality-page.tsx"), "utf8");
function LocationProbe() { const location = useLocation(); return <span data-testid="location">{location.pathname}{location.search}</span>; }

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchModalityWorklist: (...args: unknown[]) => fetchModalityWorklistMock(...args),
  fetchModalityProtocolAssignment: (...args: unknown[]) => fetchModalityProtocolAssignmentMock(...args),
  fetchStatistics: (...args: unknown[]) => fetchStatisticsMock(...args),
  listAppointmentDocuments: (...args: unknown[]) => listAppointmentDocumentsMock(...args),
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

function renderPage(rows: AppointmentWithDetails[], initialEntry = "/modality", cdDestinations: Array<{ key: string; name: string }> = []) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  fetchAppointmentLookupsMock.mockResolvedValue({
    modalities: [{ id: 1, nameAr: "CT", nameEn: "CT", code: "CT", isActive: true }],
    examTypes: [],
    priorities: [],
    specialReasons: [],
  });
  fetchModalityWorklistMock.mockResolvedValue(rows);
  fetchModalityProtocolAssignmentMock.mockResolvedValue(null);
  listAppointmentDocumentsMock.mockResolvedValue([]);
  fetchCurrentSessionMock.mockResolvedValue({ id: 1, role: "super_admin", username: "modality", fullName: "Modality Staff" });
  fetchIntegrationStatusMock.mockResolvedValue({ scanner: null });
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

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <ModalityPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

async function openBoard(rows: AppointmentWithDetails[], cdDestinations: Array<{ key: string; name: string }> = []) {
  const user = userEvent.setup();
  renderPage(rows, "/modality", cdDestinations);
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
    vi.clearAllMocks();
    languageState.language = "en";
  });

  it("disables document ingestion until a modality is selected", async () => {
    renderPage([]);
    expect((await screen.findByRole("button", { name: "Scan Documents" }) as HTMLButtonElement).disabled).toBe(true);
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

  it("shows active filter strip for completed status and can clear only status", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
    ]);

    await user.click(screen.getByRole("button", { name: /^Completed\s+1$/i }));

    expect(screen.getByTestId("modality-active-filters").textContent).toContain("Completed");
    expect(boardAccessions()).toEqual(["ACC-DONE"]);

    await user.click(screen.getByRole("button", { name: "Clear status" }));

    expect(screen.queryByTestId("modality-active-filters")).toBeNull();
    expect(boardAccessions()).toEqual(["ACC-WAIT"]);
  });

  it("does not repeat the selected date in the compact status-filter strip", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
    ]);

    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "17/06/2026");
    await user.tab();

    expect(screen.queryByTestId("modality-active-filters")).toBeNull();
  });

  it("does not repeat all-dates scope in the compact status-filter strip", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
    ]);

    await user.click(screen.getByRole("button", { name: "All Dates" }));

    expect(screen.queryByTestId("modality-active-filters")).toBeNull();
  });

  it("reset view returns to operational today scope while preserving selected modality", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
    ]);

    await user.click(screen.getByRole("button", { name: "All Dates" }));
    await user.click(screen.getByRole("button", { name: /^Completed\s+1$/i }));
    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(screen.queryByTestId("modality-active-filters")).toBeNull();
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

    await user.click(within(row).getByRole("button", { name: /Print/i }));
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
    const printButton = within(row).getByRole("button", { name: /Print/i });
    const moreButton = within(row).getByRole("button", { name: /More actions/i });
    expect(printButton.textContent).toContain("Print");
    expect(printButton.querySelector("svg") || printButton.textContent?.trim()).toBeTruthy();
    expect(moreButton.textContent).toContain("More");
    expect(moreButton.querySelector("svg") || moreButton.textContent?.trim()).toBeTruthy();
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

  it("renders the MRI primary-screening badge in the patient status area", async () => {
    await openBoard([
      appointment({
        id: 35,
        modalitySafetyWorkflowType: "mri_primary_implant_screening",
        mriPrimaryScreening: { result: "no_known_implant_reported", implantSite: null, implantDescription: null, previousReviewerNameReported: null, screenedByUserId: 1, screenedAt: "2026-06-18T08:00:00Z" },
      }),
    ]);

    expect(within(screen.getByTestId("modality-board-row-35")).getByText("MRI primary screening complete — no implant reported")).toBeTruthy();
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
    const sending = within(screen.getByTestId("modality-board-row-32")).getByRole("button", { name: "CD sending" });
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
    await user.click(within(row).getByRole("button", { name: "CD send failed" }));
    await screen.findByRole("heading", { name: "CD delivery history" });
    await screen.findByText(/C-ECHO failed/);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryCdRobotDeliveryMock.mock.calls[0]?.[0]).toBe(44));
  });

  it("keeps successful CD resend available with the successful-copy count", async () => {
    const user = await openBoard([
      appointment({ id: 35, status: "completed", cdSuccessfulCount: 2 }),
    ], [{ key: "robot-a", name: "Robot A" }]);

    await user.click(screen.getByRole("button", { name: "Completed" }));
    const button = within(screen.getByTestId("modality-board-row-35")).getByRole("button", { name: "CD sent successfully" });
    expect(button.textContent).toContain("×2");
    await user.click(button);
    await screen.findByRole("heading", { name: "Send additional CD" });
    expect(screen.getByRole("combobox", { name: "Reason" })).toBeTruthy();
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
    expect(within(drawer).getByTitle("MRI Abdomen · MRI")).toBeTruthy();
    expect(within(drawer).getByText("Urgent")).toBeTruthy();
    expect(within(drawer).getByTestId("clinical-appointment-notes").textContent).toContain("Needs interpreter");
  });

  it("opens the read-only clinical workspace with an empty request-document state", async () => {
    const user = await openBoard([appointment({ id: 6, accessionNumber: "ACC-WORKSPACE" })]);

    await user.click(screen.getByTestId("modality-board-row-6"));

    const workspace = await screen.findByTestId("clinical-workspace");
    expect(workspace).toBeTruthy();
    expect(within(workspace).getByTestId("clinical-protocol")).toBeTruthy();
    expect(within(workspace).getByTestId("clinical-request-documents")).toBeTruthy();
    expect(within(workspace).getByText("No request documents yet.")).toBeTruthy();
    expect(within(workspace).queryByTestId("document-file-input")).toBeNull();
    expect(within(workspace).queryByRole("button", { name: "Attach Request" })).toBeNull();
    expect(within(workspace).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("places protocol before request documents in the mobile workspace order", async () => {
    const user = await openBoard([appointment({ id: 6, accessionNumber: "ACC-MOBILE" })]);

    await user.click(screen.getByTestId("modality-board-row-6"));

    const workspace = await screen.findByTestId("clinical-workspace");
    expect(workspace.firstElementChild).toBe(screen.getByTestId("clinical-protocol"));
    expect(workspace.lastElementChild).toBe(screen.getByTestId("clinical-request-documents"));
    const workspaceMain = workspace.closest("main");
    expect(workspaceMain?.className).toContain("overflow-y-auto");
    expect(workspaceMain?.className).toContain("overscroll-contain");
  });

  it("renders an attached request document in the read-only clinical workspace", async () => {
    const user = await openBoard([appointment({ id: 16, accessionNumber: "ACC-DOCUMENT" })]);
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
    expect(within(requestSection).queryByTestId("document-file-input")).toBeNull();
    expect(within(requestSection).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(requestSection).queryByRole("toolbar", { name: "Document annotation controls" })).toBeNull();
  });

  it("shows assigned protocol as one compact board-row line", async () => {
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
    expect(within(row).getByText("Protocol assigned")).toBeTruthy();
    expect(within(row).queryByText("Scanner: Philips Ingenia Elition 3T")).toBeNull();
    expect(within(row).queryByText("Notes available")).toBeNull();
  });

  it("renders the protocol badge through the Arabic localization", async () => {
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
    expect(within(row).getByText(translate("ar", "modality.protocolAssigned"))).toBeTruthy();
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
});
