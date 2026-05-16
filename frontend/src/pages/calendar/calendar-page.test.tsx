import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "./calendar-page";

const fetchAppointmentsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchPatientDirectorySummaryMock = vi.fn();
const printAppointmentSlipByIdMock = vi.fn();
const printDayListFromRouteMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchPatientDirectorySummary: (...args: unknown[]) => fetchPatientDirectorySummaryMock(...args),
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

describe("CalendarPage registration drilldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows modality registration summaries for the selected day and opens a filtered modal", async () => {
    renderPage();

    await screen.findByText("2 total registrations");
    expect(getSidebarSummaryButton(/CT/i)).toBeTruthy();
    expect(getSidebarSummaryButton(/MRI/i)).toBeTruthy();
    expect(screen.getAllByText("Total").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Oncology").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Non-oncology").length).toBeGreaterThan(0);
    expect(screen.getByText("2 total registrations")).toBeTruthy();
    expect(screen.getByText("1 total registrations")).toBeTruthy();

    fireEvent.click(getSidebarSummaryButton(/CT/i));
    await screen.findByText("Alpha One");
    expect(screen.getByText("ACC-1")).toBeTruthy();
    expect(screen.getByText("ACC-2")).toBeTruthy();
    expect(screen.queryByText("ACC-3")).toBeNull();
  });

  it("opens registrations for the selected appointment from the modal", async () => {
    renderPage();

    await screen.findByText("2 total registrations");
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
    await screen.findByText("2 total registrations");

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
      expect(summaryContainer.textContent || "").not.toContain("CT2 total registrations");
      expect(screen.getByTestId("modality-summary-modality:2")).toBeTruthy();
      expect(screen.queryByTestId("modality-summary-modality:1")).toBeNull();
      expect(screen.getByText("1 total registrations")).toBeTruthy();
    });
  });

  it("counts unknown category in total only", async () => {
    renderPage();

    await screen.findByText("1 total registrations");
    fireEvent.click(getSidebarSummaryButton(/MRI/i));
    await screen.findByText("Gamma Three");
    expect(screen.getByText("1 total registrations")).toBeTruthy();
    expect(screen.getAllByText("Oncology").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Non-oncology").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("keeps print day list available when registrations exist", async () => {
    renderPage();
    await screen.findByText("2 total registrations");
    expect((screen.getByRole("button", { name: "Print day list" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("prints the selected day directly without navigating to the print tab", async () => {
    renderPage();
    await screen.findByText("2 total registrations");

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
});
