import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModalityPage from "./modality-page";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { ModalityProtocolAssignment } from "@/types/api";

const fetchAppointmentLookupsMock = vi.fn();
const fetchModalityWorklistMock = vi.fn();
const fetchModalityProtocolAssignmentMock = vi.fn();
const fetchStatisticsMock = vi.fn();
const completeAppointmentMock = vi.fn();
const updateAppointmentStatusMock = vi.fn();
const printAppointmentSlipByIdMock = vi.fn();
const languageState = vi.hoisted(() => ({ language: "en" as "en" | "ar" }));
const modalityPageSource = readFileSync(join(process.cwd(), "src/pages/modality/modality-page.tsx"), "utf8");

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchModalityWorklist: (...args: unknown[]) => fetchModalityWorklistMock(...args),
  fetchModalityProtocolAssignment: (...args: unknown[]) => fetchModalityProtocolAssignmentMock(...args),
  fetchStatistics: (...args: unknown[]) => fetchStatisticsMock(...args),
  completeAppointment: (...args: unknown[]) => completeAppointmentMock(...args),
  updateAppointmentStatus: (...args: unknown[]) => updateAppointmentStatusMock(...args),
}));

vi.mock("@/lib/appointment-printing", () => ({
  printAppointmentSlipById: (...args: unknown[]) => printAppointmentSlipByIdMock(...args),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: languageState.language, isArabic: languageState.language === "ar" }),
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

function renderPage(rows: AppointmentWithDetails[]) {
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
  fetchStatisticsMock.mockResolvedValue({
    statusBreakdown: [
      { status: "waiting", count: rows.filter((row) => row.status === "waiting").length },
      { status: "arrived", count: rows.filter((row) => row.status === "arrived").length },
      { status: "in-progress", count: rows.filter((row) => row.status === "in-progress").length },
      { status: "completed", count: rows.filter((row) => row.status === "completed").length },
    ],
  });
  completeAppointmentMock.mockResolvedValue({ ok: true });
  updateAppointmentStatusMock.mockResolvedValue({ ok: true });

  return render(
    <QueryClientProvider client={queryClient}>
      <ModalityPage />
    </QueryClientProvider>
  );
}

async function openBoard(rows: AppointmentWithDetails[]) {
  const user = userEvent.setup();
  renderPage(rows);
  await screen.findByRole("option", { name: "CT" });
  await user.selectOptions(screen.getByRole("combobox"), "1");
  await screen.findByRole("button", { name: "Operational" });
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

  it("sorts arrived rows by arrivedAt ascending after in-progress rows", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-LATE", dailySequence: 2, modalitySlotNumber: 2, status: "arrived", arrivedAt: "2026-06-18T08:30:00Z", englishFullName: "Late Arrival" }),
      appointment({ id: 2, accessionNumber: "ACC-PROGRESS", dailySequence: 3, modalitySlotNumber: 3, status: "in-progress", englishFullName: "In Progress" }),
      appointment({ id: 3, accessionNumber: "ACC-EARLY", dailySequence: 1, modalitySlotNumber: 1, status: "arrived", arrivedAt: "2026-06-18T08:05:00Z", englishFullName: "Early Arrival" }),
    ]);

    expect(boardAccessions()).toEqual(["ACC-PROGRESS", "ACC-EARLY", "ACC-LATE"]);
  });

  it("numbers arrived and waiting rows by arrivedAt order and leaves scheduled rows unnumbered", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-LATE", dailySequence: 2, modalitySlotNumber: 2, status: "arrived", arrivedAt: "2026-06-18T08:30:00Z", englishFullName: "Late Arrival" }),
      appointment({ id: 2, accessionNumber: "ACC-SCHEDULED", dailySequence: 1, modalitySlotNumber: 1, status: "scheduled", bookingTime: "09:00", englishFullName: "Scheduled Patient" }),
      appointment({ id: 3, accessionNumber: "ACC-EARLY", dailySequence: 3, modalitySlotNumber: 3, status: "arrived", arrivedAt: "2026-06-18T08:05:00Z", englishFullName: "Early Arrival" }),
      appointment({ id: 4, accessionNumber: "ACC-WAIT", dailySequence: 4, modalitySlotNumber: 4, status: "waiting", arrivedAt: "2026-06-18T08:20:00Z", englishFullName: "Waiting Arrival" }),
    ]);

    expect(within(screen.getByTestId("modality-board-row-3")).getByText("#1")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-3")).getByText("10:05")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-4")).getByText("#2")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-4")).getByText("10:20")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-1")).getByText("#3")).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-1")).getByText("10:30")).toBeTruthy();
    expect(screen.getByTestId("modality-board-row-2").querySelector("td")?.textContent?.trim()).toBe("—");
  });

  it("keeps scheduled not-arrived patients visible in the board", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-WAIT", status: "waiting", englishFullName: "Waiting Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-SCHEDULED", status: "scheduled", englishFullName: "Scheduled Patient", bookingTime: "10:00" }),
    ]);

    const scheduledRow = screen.getByTestId("modality-board-row-2");
    expect(within(scheduledRow).getByText("Scheduled Patient")).toBeTruthy();
    expect(within(scheduledRow).getByText("Scheduled")).toBeTruthy();
  });

  it("shows same-day sibling appointment modality badges with hover details", async () => {
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
    const badge = within(row).getByText("MRI");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("title")).toContain("MRI Brain");
    expect(badge.getAttribute("title")).toContain("ACC-MRI");
    expect(badge.getAttribute("title")).toContain("Scheduled");
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

  it("summary metric cards apply exact board filters", async () => {
    const user = await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-ARRIVED", status: "arrived", arrivedAt: "2026-06-18T08:05:00Z", englishFullName: "Arrived Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-WAIT", status: "waiting", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Waiting Patient" }),
      appointment({ id: 3, accessionNumber: "ACC-PROGRESS", status: "in-progress", arrivedAt: "2026-06-18T08:15:00Z", englishFullName: "In Progress Patient" }),
      appointment({ id: 4, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
    ]);

    const waitingCard = screen.getByRole("button", { name: /^Waiting\s+1$/i });
    await user.click(waitingCard);
    expect(waitingCard.getAttribute("aria-pressed")).toBe("true");
    expect(boardAccessions()).toEqual(["ACC-WAIT"]);

    await user.click(screen.getByRole("button", { name: /^Arrived\s+1$/i }));
    expect(boardAccessions()).toEqual(["ACC-ARRIVED"]);

    await user.click(screen.getByRole("button", { name: /^In Progress\s+1$/i }));
    expect(boardAccessions()).toEqual(["ACC-PROGRESS"]);

    await user.click(screen.getByRole("button", { name: /^Completed\s+1$/i }));
    expect(boardAccessions()).toEqual(["ACC-DONE"]);
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
    expect(within(row).getByRole("button", { name: /Print/i })).toBeTruthy();
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
    expect(menu.className).toContain("text-right");
  });

  it("shows elapsed waiting duration from arrivedAt and fallback when missing", async () => {
    const arrivedAt = new Date(Date.now() - 70 * 60_000).toISOString();
    await openBoard([
      appointment({ id: 10, accessionNumber: "ACC-ELAPSED", status: "arrived", arrivedAt, englishFullName: "Elapsed Patient" }),
      appointment({ id: 11, accessionNumber: "ACC-MISSING", status: "waiting", arrivedAt: null, englishFullName: "Missing Timestamp" }),
    ]);

    expect(within(screen.getByTestId("modality-board-row-10")).getByText(/1h (9|10)m/)).toBeTruthy();
    expect(within(screen.getByTestId("modality-board-row-11")).getAllByText("—").length).toBeGreaterThan(0);
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
    expect(within(drawer).getByText("MRI")).toBeTruthy();
    expect(within(drawer).getByText("MRI Abdomen")).toBeTruthy();
    expect(within(drawer).getByText("Urgent")).toBeTruthy();
    expect(within(drawer).getByText("Needs interpreter")).toBeTruthy();
  });

  it("shows assigned protocol summary on the board row", async () => {
    await openBoard([
      appointment({
        id: 7,
        accessionNumber: "ACC-PROTOCOL",
        protocolAssignmentSummary: {
          assignmentId: 90,
          protocolName: "MRI Rectum Primary Staging",
          versionNumber: "1.2",
          scannerName: "Philips Ingenia Elition 3T",
          assignedBy: "Dr. Protocol",
          assignedAt: "2026-06-29T08:00:00Z",
          protocolNotes: "Rectum protocol",
          contrastNotes: null,
        },
      }),
    ]);

    const row = screen.getByTestId("modality-board-row-7");
    expect(within(row).getByText("Protocol: MRI Rectum Primary Staging v1.2")).toBeTruthy();
    expect(within(row).getByText("Scanner: Philips Ingenia Elition 3T")).toBeTruthy();
    expect(within(row).getByText("Notes available")).toBeTruthy();
  });

  it("renders Assigned CT Protocol with CT phase terminology", async () => {
    const user = await openBoard([appointment({ id: 7, accessionNumber: "ACC-CT-PROTOCOL" })]);
    fetchModalityProtocolAssignmentMock.mockResolvedValue(ctAssignment());

    await user.click(screen.getByTestId("modality-board-row-7"));

    const drawer = await screen.findByTestId("selected-appointment-drawer");
    await within(drawer).findByText("Assigned CT Protocol");
    expect(within(drawer).getByText("CT Abdomen v1.2")).toBeTruthy();
    expect(within(drawer).getByText("Phase")).toBeTruthy();
    expect(within(drawer).queryByText("Sequence")).toBeNull();
    expect(within(drawer).getByText("Liver to symphysis")).toBeTruthy();
    expect(within(drawer).getByText("This protocol was assigned by the doctor. Changes to scanner execution should be documented separately.")).toBeTruthy();
    expect(fetchModalityProtocolAssignmentMock).toHaveBeenCalledWith(7);
  });

  it("renders Assigned MRI Protocol with MRI sequence terminology", async () => {
    const user = await openBoard([appointment({ id: 8, modalityCode: "MRI", modalityNameEn: "MRI", examNameEn: "MRI Pelvis" })]);
    fetchModalityProtocolAssignmentMock.mockResolvedValue(mriAssignment());

    await user.click(screen.getByTestId("modality-board-row-8"));

    const drawer = await screen.findByTestId("selected-appointment-drawer");
    await within(drawer).findByText("Assigned MRI Protocol");
    expect(within(drawer).getByText("MRI Rectum Primary Staging v1.2")).toBeTruthy();
    expect(within(drawer).getByText("Sequence")).toBeTruthy();
    expect(within(drawer).queryByText("Phase")).toBeNull();
    expect(within(drawer).getByText("rectum-centered")).toBeTruthy();
    expect(within(drawer).getByText("oblique axial")).toBeTruthy();
  });

  it("renders no assignment state cleanly for CT and exposes no protocol edit controls", async () => {
    fetchModalityProtocolAssignmentMock.mockResolvedValue(null);
    const user = await openBoard([appointment({ id: 9, accessionNumber: "ACC-NO-PROTOCOL" })]);

    expect(within(screen.getByTestId("modality-board-row-9")).getByText("No protocol assigned")).toBeTruthy();
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
});
