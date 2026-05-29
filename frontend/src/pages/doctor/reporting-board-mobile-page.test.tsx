import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportingBoardMobilePage } from "./reporting-board-mobile-page";
import type { ReportingBoardMobileResponse } from "@/types/api";

const fetchReportingBoardMobileViewMock = vi.fn();
const fetchRosterDoctorsMock = vi.fn();
const assignReportingBoardMobileCaseToMeMock = vi.fn();
const reassignReportingBoardMobileCaseMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchReportingBoardMobileView: (...args: unknown[]) => fetchReportingBoardMobileViewMock(...args),
  fetchRosterDoctors: (...args: unknown[]) => fetchRosterDoctorsMock(...args),
  assignReportingBoardMobileCaseToMe: (...args: unknown[]) => assignReportingBoardMobileCaseToMeMock(...args),
  reassignReportingBoardMobileCase: (...args: unknown[]) => reassignReportingBoardMobileCaseMock(...args),
}));

const mobileResponse: ReportingBoardMobileResponse = {
  savedView: { id: 9, name: "Seraj", token: "tok-9" },
  filters: { reportStatus: "required_not_final", modalityCodes: ["CT", "MR"] },
  filterSummary: ["required not final", "CT/MR"],
  counters: { total: 2, assignedToMe: null, unassigned: 1, urgent: 1, requiredNotFinal: 2, overdue: 0 },
  allowedActions: { readOnly: true, assignToMe: false, reassign: false, batchReassign: false, copyAccession: false },
  refreshedAt: "2026-05-29T12:32:00.000Z",
  cases: [
    {
      appointmentId: 42,
      patientName: "Mohammed Bashir Meftah",
      mrn: "005279",
      accessionNumber: "V2-001579",
      date: "2026-05-25",
      time: "10:24",
      modality: "CT",
      exam: "CT Chest",
      category: "oncology",
      assignedDoctor: "Dr. Seraj Alsaifi",
      priority: "Urgent",
      priorityCode: "urgent",
      reportStatus: "draft",
      appointmentStatus: "completed",
      assignmentStatus: "assigned",
      canAssign: true,
      exclusionReason: null,
    },
    {
      appointmentId: 43,
      patientName: "Abeer Farhat Salem Al-Sadeq",
      mrn: "001628",
      accessionNumber: "V2-001586",
      date: "2026-05-25",
      time: "12:18",
      modality: "CT",
      exam: "CT Chest",
      category: "oncology",
      assignedDoctor: null,
      priority: "Normal",
      priorityCode: null,
      reportStatus: "draft",
      appointmentStatus: "completed",
      assignmentStatus: "unassigned",
      canAssign: true,
      exclusionReason: null,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/mobile/reporting-view/tok-9"]}>
        <Routes>
          <Route path="/mobile/reporting-view/:token" element={<ReportingBoardMobilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ReportingBoardMobilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchReportingBoardMobileViewMock.mockResolvedValue(mobileResponse);
    fetchRosterDoctorsMock.mockResolvedValue([{ id: 5, displayName: "Dr Target" }]);
    assignReportingBoardMobileCaseToMeMock.mockResolvedValue({ assignmentId: 1 });
    reassignReportingBoardMobileCaseMock.mockResolvedValue({ assignmentId: 2 });
  });

  it("renders a mobile read-only saved view without desktop navigation", async () => {
    renderPage();

    expect(await screen.findByText("Seraj - Reporting Board")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("Mohammed Bashir Meftah")).toBeTruthy();
    expect(screen.getByText(/V2-001579/)).toBeTruthy();
    expect(screen.queryByText("Reporting Assignment Board")).toBeNull();
    expect(screen.queryByText("Saved views")).toBeNull();
    expect(screen.queryByText("Board settings")).toBeNull();
    expect(screen.getByText("Read-only via QR.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
  });

  it("opens a mobile case detail sheet", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Mohammed Bashir Meftah"));
    const dialog = screen.getByText("MRN 005279 · V2-001579").closest("section")!;

    expect(within(dialog).getByText("CT Chest")).toBeTruthy();
    expect(within(dialog).getByText("Dr. Seraj Alsaifi")).toBeTruthy();
    expect(within(dialog).getByText("completed")).toBeTruthy();
  });

  it("refreshes and applies search within the mobile saved-view scope", async () => {
    renderPage();

    fireEvent.change(await screen.findByPlaceholderText("Search patient, MRN, accession, exam..."), { target: { value: "005279" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply mobile filters" }));

    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenCalledWith("tok-9", expect.objectContaining({ q: "005279" })));
    fireEvent.click(await screen.findByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenCalledTimes(3));
  });
});
