import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DayListPrintPage from "./day-list-print-page";

const fetchAppointmentsMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/print/day-list" element={<DayListPrintPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("DayListPrintPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    fetchAppointmentsMock.mockResolvedValue([
      {
        id: 42,
        dailySequence: 1,
        appointmentDate: "2026-05-02",
        bookingTime: "08:00",
        accessionNumber: "V2-000042",
        arabicFullName: "Alpha One",
        englishFullName: "Alpha One",
        modalityNameAr: "CT",
        modalityNameEn: "CT",
        examNameAr: "Brain",
        examNameEn: "Brain",
        caseCategory: "oncology",
        priorityNameAr: "Urgent",
        priorityNameEn: "Urgent",
        status: "scheduled",
      },
    ]);
  });

  it("renders day-list data from the route filters and autoprints after load", async () => {
    renderPage("/print/day-list?date=2026-05-02&modalityId=1&status=scheduled&caseCategory=oncology&q=Alpha&autoprint=1");

    expect(await screen.findByText("Daily Appointment List")).toBeTruthy();
    expect(await screen.findByText("V2-000042")).toBeTruthy();
    expect(fetchAppointmentsMock).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-05-02",
      modalityId: "1",
      status: "scheduled",
      caseCategory: "oncology",
      q: "Alpha",
      sort: "time-asc",
    }));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });
});
