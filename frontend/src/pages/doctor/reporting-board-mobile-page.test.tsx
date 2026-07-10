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
const unassignReportingBoardMobileCaseMock = vi.fn();
const fetchReportingBoardMobilePushConfigMock = vi.fn();
const subscribeReportingBoardMobilePushMock = vi.fn();
const unsubscribeReportingBoardMobilePushMock = vi.fn();
const sendReportingBoardMobileTestPushMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchReportingBoardMobileView: (...args: unknown[]) => fetchReportingBoardMobileViewMock(...args),
  fetchRosterDoctors: (...args: unknown[]) => fetchRosterDoctorsMock(...args),
  assignReportingBoardMobileCaseToMe: (...args: unknown[]) => assignReportingBoardMobileCaseToMeMock(...args),
  reassignReportingBoardMobileCase: (...args: unknown[]) => reassignReportingBoardMobileCaseMock(...args),
  unassignReportingBoardMobileCase: (...args: unknown[]) => unassignReportingBoardMobileCaseMock(...args),
  fetchReportingBoardMobilePushConfig: (...args: unknown[]) => fetchReportingBoardMobilePushConfigMock(...args),
  subscribeReportingBoardMobilePush: (...args: unknown[]) => subscribeReportingBoardMobilePushMock(...args),
  unsubscribeReportingBoardMobilePush: (...args: unknown[]) => unsubscribeReportingBoardMobilePushMock(...args),
  sendReportingBoardMobileTestPush: (...args: unknown[]) => sendReportingBoardMobileTestPushMock(...args),
}));

const mobileResponse: ReportingBoardMobileResponse = {
  savedView: { id: 9, name: "Seraj", token: "tok-9" },
  lockedFilters: { reportStatus: "required_not_final", modalityCodes: ["CT", "MR"] },
  currentDoctorId: null,
  filters: { reportStatus: "required_not_final", modalityCodes: ["CT", "MR"] },
  filterSummary: ["required not final", "CT/MR"],
  counters: { total: 2, assignedToMe: null, unassigned: 1, urgent: 1, requiredNotFinal: 2, overdue: 0 },
  totalCount: 3,
  pagination: { limit: 40, offset: 0, hasMore: false, nextOffset: null },
  allowedActions: { authenticated: false, accessLevel: "public", readOnly: true, readOnlyReason: "Open RISpro in this browser to manage assignments.", assignToMe: false, reassign: false, unassign: false, batchReassign: false, copyAccession: true, copyMrn: true },
  refreshedAt: "2026-05-29T12:32:00.000Z",
  cases: [
    {
      caseType: "appointment",
      caseKey: "appointment:42",
      appointmentId: 42,
      comparisonRequestId: null,
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
      completedAt: "2026-05-25T10:24:00.000Z", firstAssignedAt: null, currentAssignedAt: "2026-05-25T11:00:00.000Z", reportFinalAt: null,
      completedToAssignedMinutes: null, currentAssignmentAgeMinutes: 20, completedUnassignedAgeMinutes: null, completedAgeMinutes: 30, overdue: false,
      canAssignToMe: false, canReassign: false, canUnassign: false, actionDisabledReason: "Open RISpro in this browser with supervisor access to manage assignments.",
    },
    {
      caseType: "appointment",
      caseKey: "appointment:43",
      appointmentId: 43,
      comparisonRequestId: null,
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
      completedAt: "2026-05-25T12:18:00.000Z", firstAssignedAt: null, currentAssignedAt: null, reportFinalAt: null,
      completedToAssignedMinutes: null, currentAssignmentAgeMinutes: null, completedUnassignedAgeMinutes: 20, completedAgeMinutes: 30, overdue: false,
      canAssignToMe: false, canReassign: false, canUnassign: false, actionDisabledReason: "Open RISpro in this browser with supervisor access to manage assignments.",
    },
    {
      caseType: "comparison",
      caseKey: "comparison:77",
      appointmentId: 620,
      comparisonRequestId: 77,
      patientName: "Comparison Patient",
      mrn: "009977",
      accessionNumber: "CMP-000077",
      date: "2026-06-22",
      time: null,
      modality: "CT",
      exam: "Comparison report",
      category: "comparison",
      assignedDoctor: null,
      priority: "Normal",
      priorityCode: null,
      reportStatus: "draft",
      appointmentStatus: "ready_for_reporting",
      assignmentStatus: "unassigned",
      canAssign: true,
      exclusionReason: null,
      completedAt: "2026-06-22T12:18:00.000Z", firstAssignedAt: null, currentAssignedAt: null, reportFinalAt: null,
      completedToAssignedMinutes: null, currentAssignmentAgeMinutes: null, completedUnassignedAgeMinutes: 20, completedAgeMinutes: 30, overdue: false,
      canAssignToMe: false, canReassign: false, canUnassign: false, actionDisabledReason: "Open RISpro in this browser with supervisor access to manage assignments.",
      linkedPreviousStudyDate: "2026-05-20",
      linkedPreviousAccessionNumber: "V2-000620",
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
    unassignReportingBoardMobileCaseMock.mockResolvedValue({ unassigned: true, appointmentId: 42, assignmentId: 2 });
    fetchReportingBoardMobilePushConfigMock.mockResolvedValue({ enabled: true, publicKey: "AAAA" });
    subscribeReportingBoardMobilePushMock.mockResolvedValue({ subscriptionId: 7 });
  });

  it("renders a mobile read-only saved view without desktop navigation", async () => {
    renderPage();

    expect(await screen.findByText("Seraj - Reporting Board")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("Mohammed Bashir Meftah")).toBeTruthy();
    expect(screen.getByText("Comparison Patient")).toBeTruthy();
    expect(screen.getByText("Comparison request")).toBeTruthy();
    expect(screen.getByText(/Prior V2-000620/)).toBeTruthy();
    expect(screen.getByText(/V2-001579/)).toBeTruthy();
    expect(screen.queryByText("Reporting Assignment Board")).toBeNull();
    expect(screen.queryByText("Saved views")).toBeNull();
    expect(screen.queryByText("Board settings")).toBeNull();
    expect(screen.getByText("Read-only saved view.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
  });

  it("uses comparison identity for mobile saved-view actions", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      allowedActions: { ...mobileResponse.allowedActions, authenticated: true, accessLevel: "supervisor", readOnly: false, readOnlyReason: null, assignToMe: true, reassign: true, unassign: true },
      cases: mobileResponse.cases.map((row) => ({ ...row, canAssignToMe: true, canReassign: true, canUnassign: row.assignmentStatus === "assigned", actionDisabledReason: null })),
    });
    renderPage();

    fireEvent.click(await screen.findByText("Comparison Patient"));
    fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));

    await waitFor(() => expect(assignReportingBoardMobileCaseToMeMock).toHaveBeenCalledWith(
      "tok-9",
      expect.objectContaining({ caseType: "comparison", comparisonRequestId: 77 })
    ));
  });

  it("renders the QR reporting view as English LTR", async () => {
    renderPage();

    const heading = await screen.findByRole("heading", { name: "Seraj - Reporting Board" });
    const page = heading.closest("main");
    expect(page?.getAttribute("lang")).toBe("en");
    expect(page?.getAttribute("dir")).toBe("ltr");
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
    fireEvent.keyDown(screen.getByPlaceholderText("Search patient, MRN, accession, exam..."), { key: "Enter" });

    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenCalledWith("tok-9", expect.objectContaining({ q: "005279" })));
    fireEvent.click(await screen.findByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenCalledTimes(3));
  });

  it("does not pin the notification controls over the case list", async () => {
    renderPage();

    const button = await screen.findByRole("button", { name: /Enable notifications/i });
    expect(button.closest("footer")).toBeNull();
    const container = button.closest("section");
    const className = container?.getAttribute("class") ?? "";
    expect(className).not.toContain("fixed");
    expect(className).not.toContain("bottom-0");
  });

  it("does not show read-only copy when authenticated actions are available", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      allowedActions: { ...mobileResponse.allowedActions, authenticated: true, accessLevel: "supervisor", readOnly: false, readOnlyReason: null, assignToMe: true },
    });

    renderPage();

    expect(await screen.findByRole("button", { name: /Enable notifications/i })).toBeTruthy();
    expect(screen.queryByText("Read-only saved view.")).toBeNull();
    expect(screen.getByText("Assignment actions are available for your account.")).toBeTruthy();
  });

  it("returns an assigned mobile case to the waiting pool only for authenticated actions", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      allowedActions: { ...mobileResponse.allowedActions, authenticated: true, accessLevel: "supervisor", readOnly: false, readOnlyReason: null, assignToMe: true, reassign: true, unassign: true },
      cases: mobileResponse.cases.map((row) => ({ ...row, canAssignToMe: true, canReassign: true, canUnassign: row.assignmentStatus === "assigned", actionDisabledReason: null })),
    });
    renderPage();

    fireEvent.click(await screen.findByText("Mohammed Bashir Meftah"));
    expect(await screen.findByRole("button", { name: "Return to waiting pool" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Return to waiting pool" }));
    expect(screen.getByText(/removes the assigned doctor and returns the case to the unassigned pool/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm return to waiting pool" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Reason for returning to waiting pool"), { target: { value: "mobile workload rebalance" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm return to waiting pool" }));

    await waitFor(() => expect(unassignReportingBoardMobileCaseMock).toHaveBeenCalledWith(
      "tok-9",
      { caseType: "appointment", appointmentId: 42 },
      "mobile workload rebalance"
    ));
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenCalledTimes(2));
  });

  it("does not expose mobile return-to-pool action for unassigned or read-only cases", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Mohammed Bashir Meftah"));
    expect(screen.queryByRole("button", { name: "Return to waiting pool" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      allowedActions: { ...mobileResponse.allowedActions, authenticated: true, accessLevel: "supervisor", readOnly: false, readOnlyReason: null, assignToMe: true, reassign: true, unassign: true },
      cases: mobileResponse.cases.map((row) => ({ ...row, canAssignToMe: true, canReassign: true, canUnassign: row.assignmentStatus === "assigned", actionDisabledReason: null })),
    });
    renderPage();
    fireEvent.click(await screen.findByText("Abeer Farhat Salem Al-Sadeq"));
    expect(screen.queryByRole("button", { name: "Return to waiting pool" })).toBeNull();
  });

  it("subscribes to saved-view notifications from the public QR page", async () => {
    const subscribe = vi.fn().mockResolvedValue({ endpoint: "https://push.example/sub", toJSON: () => ({ endpoint: "https://push.example/sub", keys: { p256dh: "p", auth: "a" } }) });
    const register = vi.fn().mockResolvedValue({ pushManager: { subscribe } });
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted", requestPermission: vi.fn() } });
    Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register } });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Enable notifications/i }));

    await waitFor(() => expect(fetchReportingBoardMobilePushConfigMock).toHaveBeenCalledWith("tok-9"));
    await waitFor(() => expect(subscribeReportingBoardMobilePushMock).toHaveBeenCalledWith("tok-9", expect.objectContaining({ endpoint: "https://push.example/sub" })));
    expect(await screen.findByText("Notifications enabled for this saved view.")).toBeTruthy();
  });
});
