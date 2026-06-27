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
const languageState = vi.hoisted(() => ({ language: "en" as "en" | "ar" }));

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
    await user.click(screen.getByRole("menuitem", { name: /Cancel/i }));
    await screen.findByRole("heading", { name: /Confirm cancellation/i });
    await user.type(screen.getByPlaceholderText(/Enter a reason/i), "Patient left");
    await user.click(screen.getByRole("button", { name: /Confirm cancellation/i }));
    await waitFor(() => {
      expect(updateAppointmentStatusMock).toHaveBeenCalledWith(7, "cancelled", "Patient left");
    });

    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    expect(screen.getByRole("menuitem", { name: /Stop/i })).toBeTruthy();
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

  it("shows Stop Cancel and Wait in More for arrived rows", async () => {
    const user = await openBoard([
      appointment({ id: 8, accessionNumber: "ACC-LABELS", status: "arrived", arrivedAt: "2026-06-18T08:10:00Z", englishFullName: "Label Patient" }),
    ]);

    const row = screen.getByTestId("modality-board-row-8");
    await user.click(within(row).getByRole("button", { name: /More actions/i }));
    expect(screen.getByRole("menuitem", { name: /Stop/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Cancel/i })).toBeTruthy();
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

  it("uses specific Arabic destructive labels and a neutral close action in the selected drawer", async () => {
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
    expect(within(drawer).getByRole("button", { name: "إلغاء الموعد" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "إيقاف الحالة" })).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: /^إلغاء$/ })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: /^إيقاف$/ })).toBeNull();

    await user.click(within(drawer).getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByTestId("selected-appointment-drawer")).toBeNull();
    expect(updateAppointmentStatusMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("modality-board-row-12"));
    await user.click(within(screen.getByTestId("selected-appointment-drawer")).getByRole("button", { name: "إلغاء الموعد" }));
    await screen.findByRole("heading", { name: "تأكيد إلغاء الموعد" });
    expect(screen.getByRole("button", { name: "تأكيد إلغاء الموعد" })).toBeTruthy();
  });
});
