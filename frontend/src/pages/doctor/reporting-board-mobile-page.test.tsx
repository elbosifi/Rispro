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
const fetchReportingBoardMobilePushStatusMock = vi.fn();

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
  fetchReportingBoardMobilePushStatus: (...args: unknown[]) => fetchReportingBoardMobilePushStatusMock(...args),
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
      sonicDicomStudyNote: "Compare with prior CT from May before finalizing.",
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
      sonicDicomStudyNote: "Long PACS note for the second patient. ".repeat(8),
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

const doctorWorklistResponse: ReportingBoardMobileResponse = {
  ...mobileResponse,
  savedView: { id: 9, name: "Salma", token: "tok-9", linkKind: "doctor_worklist", targetDoctorId: 5 },
  lockedFilters: { systemManaged: true, targetDoctorId: 5 },
  currentDoctorId: 9,
  counters: { ...mobileResponse.counters, assignedToMe: 1 },
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
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024, writable: true });
    fetchReportingBoardMobileViewMock.mockResolvedValue(mobileResponse);
    fetchRosterDoctorsMock.mockResolvedValue([{ id: 5, displayName: "Dr Target" }]);
    assignReportingBoardMobileCaseToMeMock.mockResolvedValue({ assignmentId: 1 });
    reassignReportingBoardMobileCaseMock.mockResolvedValue({ assignmentId: 2 });
    unassignReportingBoardMobileCaseMock.mockResolvedValue({ unassigned: true, appointmentId: 42, assignmentId: 2 });
    fetchReportingBoardMobilePushConfigMock.mockResolvedValue({ enabled: true, publicKey: "AAAA" });
    subscribeReportingBoardMobilePushMock.mockResolvedValue({ subscriptionId: 7 });
    fetchReportingBoardMobilePushStatusMock.mockResolvedValue({ enabled: false, lastSuccessAt: null });
  });

  it("renders a mobile read-only saved view without desktop navigation", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Reporting Board" })).toBeTruthy();
    expect(screen.getByText("Dr. Seraj")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh reporting board" })).toBeTruthy();
    expect(screen.getByTestId("reporting-board-kpi-cards").className).toContain("hidden");
    expect(screen.getByText("Mohammed Bashir Meftah")).toBeTruthy();
    expect(screen.getByText("Comparison Patient")).toBeTruthy();
    expect(screen.getByText("Comparison request")).toBeTruthy();
    expect(screen.getByText(/Prior V2-000620/)).toBeTruthy();
    expect(screen.getByText(/V2-001579/)).toBeTruthy();
    expect(screen.queryByText("Reporting Assignment Board")).toBeNull();
    expect(screen.queryByText("Saved views")).toBeNull();
    expect(screen.queryByText("Board settings")).toBeNull();
    expect(screen.queryByText("Read-only saved view.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    expect(screen.queryByAltText(/QR code/i)).toBeNull();
  });

  it("renders the shared worklist data as a dense desktop table at desktop width", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440, writable: true });
    renderPage();

    expect(await screen.findByTestId("doctor-worklist-desktop-table")).toBeTruthy();
    expect(screen.getByText("Mohammed Bashir Meftah")).toBeTruthy();
    expect(screen.queryByAltText(/QR code/i)).toBeNull();
    expect(screen.getByTestId("reporting-board-kpi-cards").className).toContain("min-[1200px]:flex");
  });

  it("shows the cached PACS note only on its matching patient card and expands notes independently", async () => {
    renderPage();

    const firstCard = (await screen.findByText("Mohammed Bashir Meftah")).closest("article")!;
    const secondCard = screen.getByText("Abeer Farhat Salem Al-Sadeq").closest("article")!;
    expect(within(firstCard).getByText("PACS note")).toBeTruthy();
    expect(within(firstCard).getByText(/Compare with prior CT/)).toBeTruthy();
    expect(within(secondCard).getByRole("button", { name: "Show more" }).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(within(secondCard).getByRole("button", { name: "Show more" }));
    expect(within(secondCard).getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
    expect(within(firstCard).queryByRole("button", { name: "Show less" })).toBeNull();
  });

  it("renders no PACS-note placeholder when a case has no cached note", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      cases: mobileResponse.cases.map((row) => ({ ...row, sonicDicomStudyNote: null })),
    });
    renderPage();

    await screen.findByText("Mohammed Bashir Meftah");
    expect(screen.queryByText("PACS note")).toBeNull();
    expect(screen.queryByText("No PACS note.")).toBeNull();
  });

  it("shows a compact active-filter count on the filter button", async () => {
    renderPage();

    fireEvent.change(await screen.findByPlaceholderText("Search patient, MRN, accession, exam..."), { target: { value: "005279" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Search patient, MRN, accession, exam..."), { key: "Enter" });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenCalledWith("tok-9", expect.objectContaining({ q: "005279" })));
    expect((await screen.findByTestId("reporting-board-filter-button")).textContent).toContain("Filters 1");
    expect(screen.queryByText("Temporary filters active")).toBeNull();
  });

  it("keeps the patient card usable when a cached PACS note is absent after a retrieval failure", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      cases: [{ ...mobileResponse.cases[0], sonicDicomStudyNote: null }],
    });
    renderPage();

    fireEvent.click(await screen.findByText("Mohammed Bashir Meftah"));
    expect(screen.getAllByText("CT Chest").length).toBeGreaterThan(0);
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

    const heading = await screen.findByRole("heading", { name: "Reporting Board" });
    const page = heading.closest("main");
    expect(page?.getAttribute("lang")).toBe("en");
    expect(page?.getAttribute("dir")).toBe("ltr");
  });

  it("defaults a doctor worklist to the target doctor's Assigned cases, not the authenticated viewer", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue(doctorWorklistResponse);
    renderPage();

    await screen.findByRole("button", { name: /^Assigned 1$/i });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith(
      "tok-9",
      expect.objectContaining({ assignedDoctorId: 5, assignmentStatus: "assigned", reportStatus: null })
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Assigned 1$/i }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByRole("button", { name: /^Assigned 1$/i }).getAttribute("class")).toContain("ring-2");

    const all = screen.getByRole("button", { name: /^All 2$/i });
    fireEvent.click(all);

    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", { limit: 40, offset: 0 }));
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Assigned 1$/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("defaults an anonymous doctor worklist to the target doctor's Assigned cases", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({ ...doctorWorklistResponse, currentDoctorId: null });
    renderPage();

    await screen.findByRole("button", { name: /^Assigned 1$/i });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith(
      "tok-9",
      expect.objectContaining({ assignedDoctorId: 5, assignmentStatus: "assigned" })
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Assigned 1$/i }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("uses the opened worklist target when the target doctor is the authenticated viewer", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...doctorWorklistResponse,
      savedView: { ...doctorWorklistResponse.savedView, name: "Seraj", targetDoctorId: 9 },
      currentDoctorId: 5,
    });
    renderPage();

    await screen.findByRole("button", { name: /^Assigned 1$/i });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith(
      "tok-9",
      expect.objectContaining({ assignedDoctorId: 9, assignmentStatus: "assigned" })
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Assigned 1$/i }).getAttribute("aria-pressed")).toBe("true"));
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

  it("omits notification controls when the browser does not support them", async () => {
    renderPage();

    await screen.findByText("Mohammed Bashir Meftah");
    expect(screen.queryByText(/Receive alerts for newly assigned/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Enable$/i })).toBeNull();
  });

  it("does not show read-only copy when authenticated actions are available", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      allowedActions: { ...mobileResponse.allowedActions, authenticated: true, accessLevel: "supervisor", readOnly: false, readOnlyReason: null, assignToMe: true },
    });

    renderPage();

    expect(screen.queryByText("Read-only saved view.")).toBeNull();
    expect(await screen.findByText("Mohammed Bashir Meftah")).toBeTruthy();
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
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register, getRegistration: vi.fn().mockResolvedValue(null) } });

    renderPage();

    expect(await screen.findByText("Receive alerts for newly assigned and urgent cases.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Enable$/i }));

    await waitFor(() => expect(fetchReportingBoardMobilePushConfigMock).toHaveBeenCalledWith("tok-9"));
    await waitFor(() => expect(subscribeReportingBoardMobilePushMock).toHaveBeenCalledWith("tok-9", expect.objectContaining({ endpoint: "https://push.example/sub" })));
    expect(await screen.findByText("Notifications enabled for this saved view.")).toBeTruthy();
  });

  it("shows an active quick tab and disables a tab that conflicts with locked saved-view criteria", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      lockedFilters: { assignmentStatus: "assigned" },
    });
    renderPage();

    const unassigned = await screen.findByRole("button", { name: /Unassigned/i });
    expect((unassigned as HTMLButtonElement).disabled).toBe(true);
    expect(unassigned.getAttribute("title")).toMatch(/locked to assigned cases/i);
    const all = screen.getByRole("button", { name: /^All 2$/i });
    expect(all.getAttribute("class")).toContain("ring-2");
  });

  it("refreshes every retained page after load more", async () => {
    const pageOne = { ...mobileResponse, pagination: { limit: 40, offset: 0, hasMore: true, nextOffset: 40 }, totalCount: 4, cases: [mobileResponse.cases[0]] };
    const pageTwo = { ...mobileResponse, pagination: { limit: 40, offset: 40, hasMore: false, nextOffset: null }, totalCount: 4, cases: [mobileResponse.cases[1]] };
    fetchReportingBoardMobileViewMock.mockImplementation((_token: string, filters: { offset?: number }) => Promise.resolve(filters.offset === 40 ? pageTwo : pageOne));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText("Abeer Farhat Salem Al-Sadeq");

    const updatedPageOne = { ...pageOne, cases: [{ ...mobileResponse.cases[0], patientName: "Updated first page patient" }] };
    fetchReportingBoardMobileViewMock.mockImplementation((_token: string, filters: { offset?: number }) => Promise.resolve(filters.offset === 40 ? pageTwo : updatedPageOne));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    expect(await screen.findByText("Updated first page patient")).toBeTruthy();
  });
});
