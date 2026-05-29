import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportingBoardPrintPage from "./reporting-board-print-page";

const fetchReportingBoardCasesMock = vi.fn();
const fetchReportingBoardSavedViewByTokenMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchReportingBoardCases: (...args: unknown[]) => fetchReportingBoardCasesMock(...args),
  fetchReportingBoardSavedViewByToken: (...args: unknown[]) => fetchReportingBoardSavedViewByTokenMock(...args),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { fullName: "Dr Manager", username: "manager" } }),
}));

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/print/reporting-board" element={<ReportingBoardPrintPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("ReportingBoardPrintPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "print").mockImplementation(() => undefined);
    fetchReportingBoardSavedViewByTokenMock.mockResolvedValue({
      id: 1,
      name: "Urgent CT",
      token: "tok",
      filters: { priorityCode: "urgent" },
      notificationSettings: {},
      active: true,
    });
    fetchReportingBoardCasesMock.mockResolvedValue({
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15" },
      cases: [{
        appointmentId: 42,
        patientId: 7,
        patientMrn: "MRN-7",
        patientEnglishName: "Alpha Patient",
        patientArabicName: null,
        accessionNumber: "V2-000042",
        studyInstanceUid: null,
        bookingDate: "2026-05-25",
        bookingTime: "08:30",
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 2,
        examTypeName: "CT Brain",
        caseCategory: "oncology",
        appointmentStatus: "scheduled",
        requiresReport: true,
        reportingPriorityId: 3,
        reportingPriorityCode: "urgent",
        reportingPriorityName: "Urgent",
        reportingPrioritySortOrder: 1,
        assignedDoctorId: 5,
        assignedDoctorName: "Dr Target",
        assignmentStatus: "assigned",
        reportStatus: "draft",
        reportStatusCheckedAt: null,
        canAssign: true,
        exclusionReason: null,
      }],
    });
  });

  it("prints reporting board handoff data from a saved view token", async () => {
    renderPage("/print/reporting-board?savedViewToken=tok&autoprint=1");

    expect(await screen.findByText("RISpro Reporting Assignment List")).toBeTruthy();
    expect(await screen.findByText("V2-000042")).toBeTruthy();
    expect(screen.getAllByText("Urgent CT").length).toBeGreaterThan(0);
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ priorityCode: "urgent" })));
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });
});
