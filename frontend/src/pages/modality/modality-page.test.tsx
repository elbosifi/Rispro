import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModalityPage from "./modality-page";
import type { AppointmentWithDetails } from "@/lib/mappers";

const fetchAppointmentLookupsMock = vi.fn();
const fetchModalityWorklistMock = vi.fn();
const fetchStatisticsMock = vi.fn();
const completeAppointmentMock = vi.fn();
const updateAppointmentStatusMock = vi.fn();
const printAppointmentSlipByIdMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchModalityWorklist: (...args: unknown[]) => fetchModalityWorklistMock(...args),
  fetchStatistics: (...args: unknown[]) => fetchStatisticsMock(...args),
  completeAppointment: (...args: unknown[]) => completeAppointmentMock(...args),
  updateAppointmentStatus: (...args: unknown[]) => updateAppointmentStatusMock(...args),
}));

vi.mock("@/lib/appointment-printing", () => ({
  printAppointmentSlipById: (...args: unknown[]) => printAppointmentSlipByIdMock(...args),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en", isArabic: false }),
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
  await screen.findByTestId("modality-board");
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
  });

  it("sorts arrived rows by arrivedAt ascending after in-progress rows", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-LATE", dailySequence: 2, modalitySlotNumber: 2, status: "arrived", arrivedAt: "2026-06-18T08:30:00Z", englishFullName: "Late Arrival" }),
      appointment({ id: 2, accessionNumber: "ACC-PROGRESS", dailySequence: 3, modalitySlotNumber: 3, status: "in-progress", englishFullName: "In Progress" }),
      appointment({ id: 3, accessionNumber: "ACC-EARLY", dailySequence: 1, modalitySlotNumber: 1, status: "arrived", arrivedAt: "2026-06-18T08:05:00Z", englishFullName: "Early Arrival" }),
    ]);

    expect(boardAccessions()).toEqual(["ACC-PROGRESS", "ACC-EARLY", "ACC-LATE"]);
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

  it("places completed rows below active rows", async () => {
    await openBoard([
      appointment({ id: 1, accessionNumber: "ACC-DONE", status: "completed", completedAt: "2026-06-18T10:00:00Z", englishFullName: "Done Patient" }),
      appointment({ id: 2, accessionNumber: "ACC-WAIT", status: "waiting", englishFullName: "Waiting Patient" }),
    ]);

    expect(boardAccessions()).toEqual(["ACC-WAIT", "ACC-DONE"]);
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

    await user.click(within(row).getByRole("button", { name: /Cancel/i }));
    await screen.findByRole("heading", { name: /Confirm cancellation/i });
    await user.type(screen.getByPlaceholderText(/Enter a reason/i), "Patient left");
    await user.click(screen.getByRole("button", { name: /^Confirm$/i }));
    await waitFor(() => {
      expect(updateAppointmentStatusMock).toHaveBeenCalledWith(7, "cancelled", "Patient left");
    });

    expect(within(row).getByRole("button", { name: /Discontinue/i })).toBeTruthy();
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
});
