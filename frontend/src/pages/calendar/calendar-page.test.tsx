import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "./calendar-page";
import type { AvailabilityDayDto, AvailabilityResponse } from "@/v2/appointments/types";

const fetchAppointmentsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchPatientDirectorySummaryMock = vi.fn();
const printAppointmentSlipByIdMock = vi.fn();
const printDayListFromRouteMock = vi.fn();
const navigateMock = vi.fn();
const useV2AvailabilityMock = vi.fn();

type AvailabilityParams = {
  modalityId: number;
  days: number;
  offset: number;
  examTypeId: null;
  caseCategory: "oncology" | "non_oncology";
  capacityResolutionMode: "standard";
  useSpecialQuota: false;
  specialReasonCode: null;
  includeOverrideCandidates: false;
};

let availabilityResponses: Record<AvailabilityParams["caseCategory"], AvailabilityResponse>;
let availabilityIsLoading = false;
let availabilityErrorByCategory: Record<AvailabilityParams["caseCategory"], boolean>;

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchPatientDirectorySummary: (...args: unknown[]) => fetchPatientDirectorySummaryMock(...args),
}));

vi.mock("@/v2/appointments/api", () => ({
  useV2Availability: (params: AvailabilityParams | undefined) => useV2AvailabilityMock(params),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/lib/appointment-printing", () => ({
  printAppointmentSlipById: (...args: unknown[]) => printAppointmentSlipByIdMock(...args),
}));

vi.mock("@/lib/day-list-printing", () => ({
  printDayListFromRoute: (...args: unknown[]) => printDayListFromRouteMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CalendarPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function getSidebarSummaryButton(label: RegExp) {
  return screen.getAllByRole("button", { name: label }).at(-1)!;
}

function getSelectedDaySummaryContainer() {
  return screen.getByTestId("selected-day-summary-list");
}

function makeAvailabilityDay(
  overrides: Partial<AvailabilityDayDto> = {},
  decisionOverrides: Partial<AvailabilityDayDto["decision"]> = {}
): AvailabilityDayDto {
  const { decision: dayDecision, ...dayOverrides } = overrides;
  return {
    date: "2026-05-20",
    bucketMode: "partitioned",
    modalityTotalCapacity: 20,
    bookedTotal: 16,
    oncology: { reserved: 10, filled: 8, remaining: 2 },
    nonOncology: { reserved: 10, filled: 8, remaining: 2 },
    specialQuotaSummary: null,
    examMixQuotaSummaries: [],
    dailyCapacity: 20,
    bookedCount: 16,
    remainingCapacity: 4,
    isFull: false,
    rowDisplayStatus: "available",
    decision: {
      isAllowed: true,
      requiresSupervisorOverride: false,
      displayStatus: "available",
      suggestedBookingMode: "standard",
      consumedCapacityMode: "standard",
      remainingStandardCapacity: 4,
      remainingSpecialQuota: null,
      matchedRuleIds: [],
      reasons: [],
      policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "test" },
      decisionTrace: { evaluatedAt: "2026-05-15T00:00:00.000Z", input: {} },
      ...dayDecision,
      ...decisionOverrides,
    },
    ...dayOverrides,
  };
}

function enabledAvailabilityParams(caseCategory: AvailabilityParams["caseCategory"]): AvailabilityParams {
  return {
    modalityId: 1,
    days: 17,
    offset: 0,
    examTypeId: null,
    caseCategory,
    capacityResolutionMode: "standard",
    useSpecialQuota: false,
    specialReasonCode: null,
    includeOverrideCandidates: false,
  };
}

function setAvailability(
  oncology: AvailabilityResponse = { items: [] },
  nonOncology: AvailabilityResponse = { items: [] }
) {
  availabilityResponses = { oncology, non_oncology: nonOncology };
}

function getEnabledAvailabilityCalls() {
  return useV2AvailabilityMock.mock.calls
    .map(([params]) => params as AvailabilityParams | undefined)
    .filter((params): params is AvailabilityParams => params != null);
}

function selectModality(value = "1") {
  fireEvent.change(screen.getByRole("combobox", { name: "Modality" }), { target: { value } });
}

function selectCategory(value: "oncology" | "non_oncology") {
  fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value } });
}

function findCalendarDayButton(dateLabel: string) {
  return screen.getAllByRole("button").find((button) => (button.getAttribute("aria-label") || "").includes(dateLabel));
}

describe("CalendarPage registration drilldown", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
    vi.clearAllMocks();
    availabilityIsLoading = false;
    availabilityErrorByCategory = { oncology: false, non_oncology: false };
    setAvailability();
    useV2AvailabilityMock.mockImplementation((params: AvailabilityParams | undefined) => ({
      data: params ? availabilityResponses[params.caseCategory] : undefined,
      isLoading: params != null && availabilityIsLoading,
      isError: params != null && availabilityErrorByCategory[params.caseCategory],
    }));
    fetchPatientDirectorySummaryMock.mockResolvedValue({
      demographics: {
        id: 11,
        mrn: "MRN1",
        arabicFullName: "Alpha One",
        englishFullName: "Alpha One",
        sex: "M",
        ageYears: 30,
        demographicsEstimated: false,
        dateOfBirth: "1996-01-01",
      },
      identifiers: { nationalId: "N1", identifierType: null, identifierValue: null },
      contact: { phone1: null, phone2: null, address: null },
      category: "oncology",
      warnings: {
        missingPhone: false,
        missingDob: false,
        missingSex: false,
        missingName: false,
        incompleteData: false,
        possibleDuplicate: false,
        duplicateReasons: [],
      },
      lastAppointment: null,
      nextAppointment: null,
      recentAppointments: [],
    });
    const baseAppointments = [
      {
        id: 1,
        patientId: 11,
        modalityId: 1,
        accessionNumber: "ACC-1",
        appointmentDate: "2026-05-02",
        bookingTime: "08:00",
        status: "scheduled",
        caseCategory: "oncology",
        arabicFullName: "Alpha One",
        englishFullName: "Alpha One",
        nationalId: "N1",
        mrn: "MRN1",
        ageYears: 30,
        sex: "M",
        phone1: null,
        modalityNameAr: "أشعة مقطعية",
        modalityNameEn: "CT",
        modalityCode: "CT",
        examNameAr: "مخ",
        examNameEn: "Brain",
        priorityNameEn: "Normal",
        dailySequence: 1,
      },
      {
        id: 2,
        patientId: 12,
        modalityId: 1,
        accessionNumber: "ACC-2",
        appointmentDate: "2026-05-02",
        bookingTime: "09:00",
        status: "arrived",
        caseCategory: "non_oncology",
        arabicFullName: "Beta Two",
        englishFullName: "Beta Two",
        nationalId: "N2",
        mrn: "MRN2",
        ageYears: 42,
        sex: "F",
        phone1: null,
        modalityNameAr: "أشعة مقطعية",
        modalityNameEn: "CT",
        modalityCode: "CT",
        examNameAr: "صدر",
        examNameEn: "Chest",
        priorityNameEn: "Urgent",
        dailySequence: 2,
      },
      {
        id: 3,
        patientId: 13,
        modalityId: 2,
        accessionNumber: "ACC-3",
        appointmentDate: "2026-05-02",
        bookingTime: "10:00",
        status: "waiting",
        caseCategory: null,
        arabicFullName: "Gamma Three",
        englishFullName: "Gamma Three",
        nationalId: "N3",
        mrn: "MRN3",
        ageYears: 50,
        sex: "M",
        phone1: null,
        modalityNameAr: "رنين",
        modalityNameEn: "MRI",
        modalityCode: "MRI",
        examNameAr: "ركبة",
        examNameEn: "Knee",
        priorityNameEn: "Normal",
        dailySequence: 3,
      },
    ];
    fetchAppointmentLookupsMock.mockResolvedValue({
      modalities: [
        { id: 1, nameEn: "CT", nameAr: "أشعة مقطعية" },
        { id: 2, nameEn: "MRI", nameAr: "رنين" },
      ],
    });
    fetchAppointmentsMock.mockImplementation(async (params?: { modalityId?: string }) => {
      if (!params?.modalityId) return baseAppointments;
      return baseAppointments.filter((appointment) => String(appointment.modalityId) === params.modalityId);
      });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows modality registration summaries for the selected day and opens a filtered modal", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    expect(getSidebarSummaryButton(/CT, 2 registrations/i)).toBeTruthy();
    expect(getSidebarSummaryButton(/MRI, 1 registration/i)).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getAllByText("Oncology").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Non-oncology").length).toBeGreaterThan(0);

    fireEvent.click(getSidebarSummaryButton(/CT/i));
    await screen.findByText("Alpha One");
    expect(screen.getByText(/2 total registrations/)).toBeTruthy();
    expect(screen.getByText("ACC-1")).toBeTruthy();
    expect(screen.getByText("ACC-2")).toBeTruthy();
    expect(screen.queryByText("ACC-3")).toBeNull();
  });

  it("renders the selected registration count once", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    fireEvent.change(screen.getByRole("combobox", { name: "Modality" }), { target: { value: "1" } });
    await waitFor(() => {
      expect(screen.getByTestId("selected-day-summary").textContent || "").toContain("2 registrations");
    });
    const selectedDaySummary = screen.getByTestId("selected-day-summary").textContent || "";

    expect(selectedDaySummary).toContain("2 registrations");
    expect(selectedDaySummary).not.toContain("2 2 registrations");
  });

  it("updates the selected-date inspector when another calendar date is selected", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    const otherDateButton = screen
      .getAllByRole("button")
      .find((button) => /\b2026\b/.test(button.getAttribute("aria-label") || ""));
    expect(otherDateButton).toBeTruthy();
    const expectedDate = (otherDateButton?.getAttribute("aria-label") || "").match(/^[^,]+, [^,]+ \d+, \d{4}/)?.[0];
    expect(expectedDate).toBeTruthy();

    fireEvent.click(otherDateButton!);

    const selectedDaySummary = screen.getByTestId("selected-day-summary").textContent || "";
    expect(selectedDaySummary).toContain("Selected date");
    expect(selectedDaySummary).toContain(expectedDate!);
    expect(selectedDaySummary).toContain("0 registrations");
  });

  it("opens registrations for the effective selected date", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    fireEvent.click(screen.getByRole("button", { name: "Open day registrations" }));

    expect(navigateMock).toHaveBeenCalledWith("/registrations?date=2026-05-02");
  });

  it("opens registrations for the selected appointment from the modal", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    fireEvent.click(getSidebarSummaryButton(/CT/i));
    await screen.findByText("Alpha One");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);

    expect(navigateMock).toHaveBeenCalledWith("/registrations?appointmentId=1&patientId=11");
  });

  it("shows empty registration state when selected day has no visible registrations", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([]);
    renderPage();

    expect(await screen.findByText("No registrations found for this day")).toBeTruthy();
  });

  it("respects the top-level modality filter in the selected-day summaries", async () => {
    renderPage();
    await screen.findByTestId("modality-summary-modality:1");

    fireEvent.change(screen.getByRole("combobox", { name: "Modality" }), { target: { value: "2" } });

    await waitFor(() => {
      expect(
        fetchAppointmentsMock.mock.calls.some(
          ([arg]) => typeof arg === "object" && arg != null && "modalityId" in (arg as object) && (arg as { modalityId?: string }).modalityId === "2"
        )
      ).toBe(true);
    });

    await waitFor(() => {
      const summaryContainer = getSelectedDaySummaryContainer();
      expect(summaryContainer.textContent || "").toContain("MRI");
      expect(summaryContainer.textContent || "").not.toContain("CT");
      expect(screen.getByTestId("modality-summary-modality:2")).toBeTruthy();
      expect(screen.queryByTestId("modality-summary-modality:1")).toBeNull();
      expect(screen.getByTestId("selected-day-summary").textContent || "").toContain("1 registration");
    });
  });

  it("counts unknown category in total only", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    fireEvent.click(getSidebarSummaryButton(/MRI/i));
    await screen.findByText("Gamma Three");
    expect(screen.getByText(/1 total registrations/)).toBeTruthy();
    expect(screen.getAllByText("Oncology").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Non-oncology").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("keeps print day list available when registrations exist", async () => {
    renderPage();
    await screen.findByTestId("modality-summary-modality:1");
    expect((screen.getByRole("button", { name: "Print day list" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("prints the selected day directly without navigating to the print tab", async () => {
    renderPage();
    await screen.findByTestId("modality-summary-modality:1");

    fireEvent.change(screen.getByRole("combobox", { name: "Modality" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "oncology" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "scheduled" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Print day list" }));

    expect(printDayListFromRouteMock).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-05-02",
      modalityId: "1",
      caseCategory: "oncology",
      status: "scheduled",
      q: "Alpha",
      sort: "time-asc",
    }));
    expect(navigateMock).not.toHaveBeenCalledWith(expect.stringContaining("/print"));
  });

  it("does not enable availability for All Modalities and explains the inspector", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    expect(useV2AvailabilityMock.mock.calls.every(([params]) => params === undefined)).toBe(true);
    expect(screen.getByText("Select a modality to view capacity availability.")).toBeTruthy();
    expect(screen.getByTestId("modality-summary-modality:1")).toBeTruthy();
  });

  it("queries both categories for a selected modality with All Categories", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectModality();

    await waitFor(() => {
      const categories = Array.from(new Set(getEnabledAvailabilityCalls().map((params) => params.caseCategory)));
      expect(categories).toEqual(["oncology", "non_oncology"]);
    });

    expect(getEnabledAvailabilityCalls().find((params) => params.caseCategory === "oncology")).toEqual(enabledAvailabilityParams("oncology"));
    expect(getEnabledAvailabilityCalls().find((params) => params.caseCategory === "non_oncology")).toEqual(enabledAvailabilityParams("non_oncology"));
  });

  it("queries only oncology for a selected modality with the Oncology category", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectCategory("oncology");
    selectModality();

    await waitFor(() => {
      expect(getEnabledAvailabilityCalls().some((params) => params.caseCategory === "oncology")).toBe(true);
      expect(getEnabledAvailabilityCalls().some((params) => params.caseCategory === "non_oncology")).toBe(false);
    });
  });

  it("shows available capacity in the day cell and selected-date inspector", async () => {
    setAvailability({ items: [makeAvailabilityDay({ date: "2026-05-20", bucketMode: "total_only" })] });
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectCategory("oncology");
    selectModality();

    const dayButton = await waitFor(() => {
      const button = findCalendarDayButton("May 20, 2026");
      expect(button).toBeTruthy();
      return button;
    });
    fireEvent.click(dayButton!);

    expect(screen.getAllByText("Available 4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 of 20 remaining").length).toBeGreaterThan(0);
    expect(dayButton!.getAttribute("aria-label")).toContain("Capacity availability: Available, 4 of 20 remaining");
  });

  it("uses the oncology reserved capacity for partitioned denominators", async () => {
    setAvailability({ items: [makeAvailabilityDay(
      {
        date: "2026-05-20",
        bucketMode: "partitioned",
        modalityTotalCapacity: 20,
        remainingCapacity: 12,
        oncology: { reserved: 10, filled: 8, remaining: 2 },
      },
      { remainingStandardCapacity: 2 }
    )] });
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectCategory("oncology");
    selectModality();
    const dayButton = await waitFor(() => findCalendarDayButton("May 20, 2026"));
    fireEvent.click(dayButton!);

    expect(screen.getAllByText("Available 2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 of 10 remaining").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("calendar-capacity-details-2026-05-20")).getByTestId("calendar-capacity-badge").textContent).toContain("Available 2");
    expect(screen.queryByText("2 of 20 remaining")).toBeNull();
    expect(dayButton!.getAttribute("aria-label")).toContain("Available, 2 of 10 remaining");
  });

  it("uses the non-oncology reserved capacity for partitioned denominators", async () => {
    setAvailability({ items: [] }, { items: [makeAvailabilityDay(
      {
        date: "2026-05-20",
        bucketMode: "partitioned",
        modalityTotalCapacity: 20,
        remainingCapacity: 12,
        nonOncology: { reserved: 7, filled: 4, remaining: 3 },
      },
      { remainingStandardCapacity: 3 }
    )] });
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectCategory("non_oncology");
    selectModality();
    const dayButton = await waitFor(() => findCalendarDayButton("May 20, 2026"));
    fireEvent.click(dayButton!);

    expect(screen.getAllByText("Available 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 of 7 remaining").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("calendar-capacity-details-2026-05-20")).getByTestId("calendar-capacity-badge").textContent).toContain("Available 3");
    expect(screen.queryByText("3 of 20 remaining")).toBeNull();
    expect(dayButton!.getAttribute("aria-label")).toContain("Available, 3 of 7 remaining");
  });

  it("shows Restricted for category exhaustion", async () => {
    setAvailability({ items: [makeAvailabilityDay(
      { date: "2026-05-20", rowDisplayStatus: undefined },
      {
        displayStatus: "blocked",
        reasons: [{ code: "category_capacity_exhausted", severity: "error", message: "Category capacity exhausted" }],
      }
    )] });
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectCategory("oncology");
    selectModality();
    const dayButton = await waitFor(() => findCalendarDayButton("May 20, 2026"));
    fireEvent.click(dayButton!);

    expect(screen.getAllByText("Restricted").length).toBeGreaterThan(0);
    expect(screen.queryByText("Needs Approval")).toBeNull();
  });

  it("shows Full for total modality exhaustion", async () => {
    setAvailability({ items: [makeAvailabilityDay(
      { date: "2026-05-20", rowDisplayStatus: undefined, remainingCapacity: 0, isFull: true },
      {
        displayStatus: "blocked",
        remainingStandardCapacity: 0,
        reasons: [{ code: "modality_daily_capacity_exhausted", severity: "error", message: "Modality capacity exhausted" }],
      }
    )] });
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectCategory("oncology");
    selectModality();
    const dayButton = await waitFor(() => findCalendarDayButton("May 20, 2026"));
    fireEvent.click(dayButton!);

    expect(screen.getAllByText("Full").length).toBeGreaterThan(0);
  });

  it("shows Blocked for a blocked date", async () => {
    setAvailability({ items: [makeAvailabilityDay(
      { date: "2026-05-20", rowDisplayStatus: undefined },
      {
        displayStatus: "blocked",
        reasons: [{ code: "weekday_appointments_disabled", severity: "error", message: "Appointments disabled" }],
      }
    )] });
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectCategory("oncology");
    selectModality();
    const dayButton = await waitFor(() => findCalendarDayButton("May 20, 2026"));
    fireEvent.click(dayButton!);

    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });

  it("keeps capacity visible when the date has zero visible registrations", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([]);
    setAvailability({ items: [makeAvailabilityDay({ date: "2026-05-15", bucketMode: "total_only" })] });
    renderPage();

    expect(await screen.findByText("No registrations found for this day")).toBeTruthy();
    selectCategory("oncology");
    selectModality();

    expect(await screen.findByText("4 of 20 remaining")).toBeTruthy();
  });

  it("does not include registration search or status filters in availability params", async () => {
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectModality();
    await waitFor(() => expect(getEnabledAvailabilityCalls().length).toBeGreaterThan(0));

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "Alpha" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "scheduled" } });

    await waitFor(() => {
      const latestByCategory = new Map(getEnabledAvailabilityCalls().map((params) => [params.caseCategory, params]));
      expect(latestByCategory.get("oncology")).toEqual(enabledAvailabilityParams("oncology"));
      expect(latestByCategory.get("non_oncology")).toEqual(enabledAvailabilityParams("non_oncology"));
    });
  });

  it("shows the no-policy message without hiding registration actions", async () => {
    setAvailability(
      { items: [], meta: { noPublishedPolicy: true } },
      { items: [], meta: { noPublishedPolicy: true } }
    );
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectModality();

    expect(await screen.findByText("No published scheduling policy is active.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Open day registrations" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows an availability error without disabling registration actions", async () => {
    availabilityErrorByCategory = { oncology: true, non_oncology: true };
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectModality();

    expect(await screen.findByText("Capacity availability could not be loaded.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Open day registrations" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Open day registrations" }));
    expect(navigateMock).toHaveBeenCalledWith("/registrations?date=2026-05-02");
  });

  it("hides successful partial capacity when All Categories has an error", async () => {
    setAvailability(
      { items: [makeAvailabilityDay({ date: "2026-05-20", bucketMode: "total_only" })] },
      { items: [] }
    );
    availabilityErrorByCategory = { oncology: false, non_oncology: true };
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectModality();

    expect(await screen.findByText("Capacity availability could not be loaded.")).toBeTruthy();
    expect(screen.queryByTestId("calendar-capacity-cell")).toBeNull();
    const dayButton = findCalendarDayButton("May 20, 2026");
    expect(dayButton?.getAttribute("aria-label")).not.toContain("Capacity availability");
    expect((screen.getByRole("button", { name: "Open day registrations" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides stale capacity when the selected category query errors", async () => {
    setAvailability({ items: [makeAvailabilityDay({ date: "2026-05-20", bucketMode: "total_only" })] });
    availabilityErrorByCategory = { oncology: true, non_oncology: false };
    renderPage();

    await screen.findByTestId("modality-summary-modality:1");
    selectCategory("oncology");
    selectModality();

    expect(await screen.findByText("Capacity availability could not be loaded.")).toBeTruthy();
    expect(screen.queryByTestId("calendar-capacity-cell")).toBeNull();
    expect((screen.getByRole("button", { name: "Open day registrations" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
