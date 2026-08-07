import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import StatisticsPage from "./statistics-page";
import { todayIsoDateLy } from "@/lib/date-format";
import type { AppointmentStatistics } from "@/types/api";

const fetchStatisticsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const recordReportOutputMock = vi.fn();
const directPrintStatisticsMock = vi.fn();
let mockLanguage: "en" | "ar" = "en";

vi.mock("@/lib/api-hooks", () => ({
  fetchStatistics: (...args: unknown[]) => fetchStatisticsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  recordReportOutput: (...args: unknown[]) => recordReportOutputMock(...args),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: mockLanguage }),
}));
vi.mock("@/services/printing/direct-print-service", () => ({ directPrintStatistics: (...args: unknown[]) => directPrintStatisticsMock(...args) }));
vi.mock("@/services/printing/direct-print-failure-action", () => ({ resolveDirectPrintFailureAction: (code: string) => code === "PRINT_STATUS_UNKNOWN" ? "NONE" : "BROWSER_PRINT" }));
vi.mock("@/services/printing/workstation-printer-settings", () => ({ loadQzPrinterSettings: () => ({ browserPrintFallbackEnabled: true }) }));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));

const baseStats: AppointmentStatistics = {
  metadata: {
    dateFrom: "2026-06-30",
    dateTo: "2026-06-30",
    modalityId: null,
    generatedAt: "2026-06-30T09:00:00.000Z",
  },
  summary: {
    totalRegisteredPatients: 150,
    oncologyPatients: 90,
    nonOncologyPatients: 50,
    uncategorizedPatients: 10,
    totalAppointments: 12,
    oncologyAppointments: 7,
    nonOncologyAppointments: 5,
    uniquePatients: 11,
    uniqueModalities: 1,
    scheduledCount: 2,
    inQueueCount: 3,
    completedCount: 4,
    discontinuedCount: 1,
    noShowCount: 1,
    cancelledCount: 1,
    walkInCount: 2,
  },
  statusBreakdown: [
    { status: "completed", count: 4 },
    { status: "scheduled", count: 2 },
    { status: "waiting", count: 1 },
  ],
  modalityBreakdown: [
    {
      modalityId: 1,
      modalityCode: "CT",
      modalityNameEn: "CT",
      modalityNameAr: "CT",
      totalCount: 12,
      scheduledCount: 2,
      inQueueCount: 3,
      completedCount: 4,
      discontinuedCount: 1,
      noShowCount: 1,
      cancelledCount: 1,
    },
  ],
  dailyBreakdown: [
    {
      appointmentDate: "2026-06-30",
      totalCount: 12,
      completedCount: 4,
      discontinuedCount: 1,
      cancelledCount: 1,
      noShowCount: 1,
    },
  ],
};

const emptyStats: AppointmentStatistics = {
  ...baseStats,
  summary: {
    ...baseStats.summary,
    totalAppointments: 0,
    oncologyAppointments: 0,
    nonOncologyAppointments: 0,
    uniquePatients: 0,
    uniqueModalities: 0,
    scheduledCount: 0,
    inQueueCount: 0,
    completedCount: 0,
    discontinuedCount: 0,
    noShowCount: 0,
    cancelledCount: 0,
    walkInCount: 0,
  },
  statusBreakdown: [],
  modalityBreakdown: [],
  dailyBreakdown: [],
};

function renderPage(initialEntries = ["/statistics"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <StatisticsPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function drilldownUrlForRow(text: string): URL {
  const row = screen
    .getAllByRole("row")
    .find((entry) => within(entry).queryByText(text));
  expect(row).toBeTruthy();
  const link = within(row as HTMLElement).getByRole("link", { name: /View appointments/i });
  return new URL(link.getAttribute("href") ?? "", "http://rispro.test");
}

describe("StatisticsPage", () => {
  beforeEach(() => {
    mockLanguage = "en";
    fetchStatisticsMock.mockReset();
    fetchAppointmentLookupsMock.mockReset();
    recordReportOutputMock.mockReset();
    directPrintStatisticsMock.mockReset();
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [{ id: 1, nameEn: "CT", nameAr: "CT" }] });
    recordReportOutputMock.mockResolvedValue(undefined);
    directPrintStatisticsMock.mockResolvedValue({ success: true, printerName: "A4 Landscape", jobName: "statistics" });
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:statistics");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not show zero KPI values while loading", () => {
    fetchStatisticsMock.mockReturnValue(new Promise(() => undefined));

    renderPage();

    const registryCard = screen.getByText("Patient registry totals (all-time)").closest("div");
    expect(registryCard).toBeTruthy();
    expect(within(registryCard as HTMLElement).getByText("—")).toBeTruthy();
    expect(within(registryCard as HTMLElement).queryByText("0")).toBeNull();
    expect(screen.getByText("Loading statistics...")).toBeTruthy();
  });

  it("renders translated statistics KPI labels", async () => {
    mockLanguage = "ar";
    fetchStatisticsMock.mockResolvedValue(baseStats);

    renderPage();

    expect(await screen.findByText("إجمالي سجل المرضى (جميعا)")).toBeTruthy();
    expect(screen.getByText("مواعيد الفترة المحددة")).toBeTruthy();
    expect(screen.getByText("مرضى الأورام (جميعا)")).toBeTruthy();
    expect(screen.getByText("إجمالي سجل المرضى لجميعا. أعداد المواعيد تستخدم الفترة المحددة.")).toBeTruthy();
  });

  it("shows an error state on initial query failure", async () => {
    fetchStatisticsMock.mockRejectedValue(new Error("failed"));

    renderPage();

    expect(await screen.findByText("Could not load statistics.")).toBeTruthy();
    expect(screen.queryByText(/^0$/)).toBeNull();
  });

  it("shows stale data warning when refresh fails after data loaded", async () => {
    fetchStatisticsMock.mockResolvedValueOnce(baseStats).mockRejectedValueOnce(new Error("failed"));
    const user = userEvent.setup();

    renderPage();

    await waitFor(() => expect(screen.getAllByText("CT").length).toBeGreaterThan(1));
    await user.click(screen.getByRole("button", { name: /Refresh/i }));

    expect(await screen.findByText("Showing the last loaded statistics because refresh failed.")).toBeTruthy();
    expect(screen.getAllByText("CT").length).toBeGreaterThan(1);
  });

  it("renders rich modality columns", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);

    renderPage();

    expect(await screen.findByText("In queue")).toBeTruthy();
    expect(screen.getAllByText("No-show").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Discontinued").length).toBeGreaterThan(0);
  });

  it("shows range validation and prevents invalid range refetch", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);
    const user = userEvent.setup();

    renderPage([
      `/statistics?date=${baseStats.metadata.dateFrom}`,
    ]);

    await waitFor(() => expect(screen.getAllByText("CT").length).toBeGreaterThan(1));
    const fromInput = screen.getByLabelText("From");
    await user.clear(fromInput);
    await user.type(fromInput, "01072026");
    fireEvent.blur(fromInput);

    await waitFor(() => expect(screen.getAllByText("Start date must be on or before end date.").length).toBeGreaterThan(1));
    expect(fetchStatisticsMock).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: /Refresh/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders CSV and print controls and guards them when no aggregate data exists", async () => {
    fetchStatisticsMock.mockResolvedValue(emptyStats);

    renderPage();

    expect(await screen.findByText("No statistics found for this range.")).toBeTruthy();
    const csvButton = screen.getByRole("button", { name: /Export CSV/i });
    const printButton = screen.getByRole("button", { name: /Print/i });

    expect((csvButton as HTMLButtonElement).disabled).toBe(true);
    expect((printButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("routes the normal Statistics Print action through Chromium and QZ without browser printing", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);
    renderPage(["/statistics?date=2026-06-30&modalityId=1"]);
    await userEvent.click(await screen.findByRole("button", { name: /Print/i }));
    await waitFor(() => expect(directPrintStatisticsMock).toHaveBeenCalledTimes(1));
    expect(directPrintStatisticsMock).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: "2026-06-30", dateTo: "2026-06-30", modalityLabel: "CT",
      summary: expect.any(Array), operational: expect.any(Array), statusBreakdown: expect.any(Array), modalityBreakdown: expect.any(Array), dailyBreakdown: expect.any(Array),
    }));
    expect(window.print).not.toHaveBeenCalled();
    expect(recordReportOutputMock).toHaveBeenCalledWith(expect.objectContaining({ reportTemplate: "statistics", outputType: "print" }));
  });

  it("initializes range and modality from URL params", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);

    renderPage(["/statistics?dateFrom=2026-06-10&dateTo=2026-06-20&modalityId=1"]);

    await waitFor(() => {
      expect(fetchStatisticsMock).toHaveBeenCalledWith(
        { dateFrom: "2026-06-10", dateTo: "2026-06-20" },
        "1"
      );
    });
    expect((screen.getByRole("button", { name: "Custom range" }) as HTMLButtonElement).className).toContain("btn-primary");
  });

  it("initializes same-day range from date URL param", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);

    renderPage(["/statistics?date=2026-06-29"]);

    await waitFor(() => {
      expect(fetchStatisticsMock).toHaveBeenCalledWith(
        { dateFrom: "2026-06-29", dateTo: "2026-06-29" },
        ""
      );
    });
  });

  it("falls back safely for invalid URL date and modality params", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);
    const today = todayIsoDateLy();

    renderPage(["/statistics?dateFrom=not-a-date&dateTo=2026-06-20&modalityId=bad"]);

    await waitFor(() => {
      expect(fetchStatisticsMock).toHaveBeenCalledWith(
        { dateFrom: today, dateTo: today },
        ""
      );
    });
  });

  it("renders selected-period operational exception metrics", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);

    renderPage();

    expect(await screen.findByText("Operational exceptions")).toBeTruthy();
    expect(screen.getByText("Completion rate (selected period)")).toBeTruthy();
    expect(await screen.findByText("33.3%")).toBeTruthy();
    expect(screen.getByText("No-show rate (selected period)")).toBeTruthy();
    expect(screen.getAllByText("8.3%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Walk-ins (selected period)")).toBeTruthy();
    expect(screen.getByText("Active workload (selected period)")).toBeTruthy();
    expect(screen.getByText("Scheduled + in queue + in-progress")).toBeTruthy();
    const noShowOperationalLink = screen
      .getAllByRole("link", { name: /View appointments/i })
      .map((link) => new URL(link.getAttribute("href") ?? "", "http://rispro.test"))
      .find((url) => url.searchParams.getAll("status").includes("no-show"));
    expect(noShowOperationalLink?.pathname).toBe("/registrations");
    expect(noShowOperationalLink?.searchParams.get("source")).toBe("statistics");
  });

  it("links status rows to registrations with selected range, status, and modality", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);
    const user = userEvent.setup();

    renderPage([
      `/statistics?date=${baseStats.metadata.dateFrom}`,
    ]);

    await waitFor(() => expect(screen.getAllByText("CT").length).toBeGreaterThan(1));
    await user.selectOptions(screen.getByRole("combobox"), "1");

    const url = drilldownUrlForRow("Scheduled");
    expect(url.pathname).toBe("/registrations");
    expect(url.searchParams.get("source")).toBe("statistics");
    expect(url.searchParams.get("dateMode")).toBe("range");
    expect(url.searchParams.get("dateFrom")).toBe("2026-06-30");
    expect(url.searchParams.get("dateTo")).toBe("2026-06-30");
    expect(url.searchParams.getAll("status")).toEqual(["scheduled"]);
    expect(url.searchParams.get("modalityId")).toBe("1");
  });

  it("links modality rows with row modality and explicit workflow statuses", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);

    renderPage();

    await waitFor(() => expect(screen.getAllByText("CT").length).toBeGreaterThan(1));
    const url = drilldownUrlForRow("CT");

    expect(url.pathname).toBe("/registrations");
    expect(url.searchParams.get("source")).toBe("statistics");
    expect(url.searchParams.get("dateMode")).toBe("range");
    expect(url.searchParams.get("modalityId")).toBe("1");
    expect(url.searchParams.getAll("status")).toEqual([
      "scheduled",
      "arrived",
      "waiting",
      "in-progress",
      "completed",
      "no-show",
      "cancelled",
      "discontinued",
      "voided",
    ]);
  });

  it("links daily rows with a single selected day", async () => {
    fetchStatisticsMock.mockResolvedValue(baseStats);

    renderPage();

    await screen.findByText("30/06/2026");
    const url = drilldownUrlForRow("30/06/2026");

    expect(url.pathname).toBe("/registrations");
    expect(url.searchParams.get("source")).toBe("statistics");
    expect(url.searchParams.get("dateMode")).toBe("single");
    expect(url.searchParams.get("date")).toBe("2026-06-30");
    expect(url.searchParams.getAll("status")).toContain("completed");
  });
});
