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
const reconcileReportingBoardAssignmentToSonicFinalizerMock = vi.fn();
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
  reconcileReportingBoardAssignmentToSonicFinalizer: (...args: unknown[]) => reconcileReportingBoardAssignmentToSonicFinalizerMock(...args),
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
      assignedDoctorId: 5,
      assignmentOrigin: "rispro",
      finalizedByDoctorId: null,
      finalizedByDoctorName: null,
      sonicDicomFinalizedByAccount: null,
      assignmentMatch: "not_applicable",
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
      assignedDoctorId: null,
      assignmentOrigin: "rispro",
      finalizedByDoctorId: null,
      finalizedByDoctorName: null,
      sonicDicomFinalizedByAccount: null,
      assignmentMatch: "not_applicable",
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
      assignedDoctorId: null,
      assignmentOrigin: "rispro",
      finalizedByDoctorId: null,
      finalizedByDoctorName: null,
      sonicDicomFinalizedByAccount: null,
      assignmentMatch: "not_applicable",
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
    reconcileReportingBoardAssignmentToSonicFinalizerMock.mockResolvedValue({ previousAssignmentId: 1, newAssignmentId: 2, finalizedDoctorId: 9 });
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

  it("shows assigned and mapped SonicDICOM finalizer separately on mobile", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      cases: [{ ...mobileResponse.cases[0], reportStatus: "final", assignedDoctor: "Dr Assigned", assignedDoctorId: 5, finalizedByDoctorId: 9, finalizedByDoctorName: "Final Doctor", sonicDicomFinalizedByAccount: "final.doctor@nccb.ly" }],
    });
    renderPage();

    const card = (await screen.findByText("Mohammed Bashir Meftah")).closest("article")!;
    expect(within(card).getByText("Assigned")).toBeTruthy();
    expect(within(card).getByText("Dr Assigned")).toBeTruthy();
    expect(within(card).getByText("Finalized by")).toBeTruthy();
    expect(within(card).getByText("Dr Final Doctor · Different reporter")).toBeTruthy();
  });

  it("renders an unmapped SonicDICOM finalizer account safely on mobile", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      cases: [{ ...mobileResponse.cases[0], reportStatus: "final", finalizedByDoctorId: null, finalizedByDoctorName: null, sonicDicomFinalizedByAccount: "legacy.account@nccb.ly" }],
    });
    renderPage();

    const card = (await screen.findByText("Mohammed Bashir Meftah")).closest("article")!;
    expect(within(card).getByText("legacy.account@nccb.ly · Unmapped SonicDICOM account")).toBeTruthy();
  });

  it("filters mobile cases by finalized doctor and assignment mismatch", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("reporting-board-filter-button"));
    const finalized = await screen.findByLabelText("Finalized Doctor");
    await waitFor(() => expect(within(finalized).getByRole("option", { name: "Dr Target" })).toBeTruthy());
    fireEvent.change(finalized, { target: { value: "5" } });
    fireEvent.change(await screen.findByLabelText("Assignment Match"), { target: { value: "mismatch" } });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenCalledWith("tok-9", expect.objectContaining({ finalizedByDoctorId: 5, assignmentMatch: "mismatch" })));
  });

  it("renders compact SonicDICOM auto-assignment provenance on mobile", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      cases: [{ ...mobileResponse.cases[0], assignmentOrigin: "sonic_auto" }],
    });
    renderPage();
    expect(await screen.findByLabelText("Assignment inferred from SonicDICOM finalizer")).toBeTruthy();
  });

  it("offers mobile reconciliation only for a mapped SonicDICOM mismatch", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue({
      ...mobileResponse,
      allowedActions: { ...mobileResponse.allowedActions, authenticated: true, accessLevel: "supervisor", readOnly: false, readOnlyReason: null, reassign: true },
      cases: [{ ...mobileResponse.cases[0], reportStatus: "final", reportStatusSource: "sonicdicom", assignedDoctor: "Dr Assigned", assignedDoctorId: 5, finalizedByDoctorId: 9, finalizedByDoctorName: "Dr Finalized", sonicDicomLatestDocumentId: "901", assignmentMatch: "mismatch", canReassign: true, actionDisabledReason: null }],
    });
    renderPage();
    fireEvent.click(await screen.findByText("Mohammed Bashir Meftah"));
    fireEvent.click(await screen.findByRole("button", { name: "Reconcile assignment to finalized doctor" }));
    expect(screen.getByText(/This preserves the previous assignment/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    await waitFor(() => expect(reconcileReportingBoardAssignmentToSonicFinalizerMock).toHaveBeenCalledWith(42, { expectedAssignedDoctorId: 5, expectedSonicDicomLatestDocumentId: "901" }));
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

  it("preserves explicit filters when leaving a doctor worklist's Assigned tab", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue(doctorWorklistResponse);
    renderPage();

    await screen.findByRole("button", { name: /^Assigned 1$/i });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith(
      "tok-9",
      expect.objectContaining({ assignedDoctorId: 5, assignmentStatus: "assigned", reportStatus: null })
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Assigned 1$/i }).getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByRole("button", { name: /^Assigned 1$/i }).getAttribute("class")).toContain("ring-2");
    expect(screen.getByTestId("reporting-board-filter-button").textContent).toContain("Filters");
    expect(screen.getByTestId("reporting-board-filter-button").textContent).not.toContain("Filters 1");

    fireEvent.change(screen.getByPlaceholderText("Search patient, MRN, accession, exam..."), { target: { value: "005279" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Search patient, MRN, accession, exam..."), { key: "Enter" });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", expect.objectContaining({ q: "005279" })));
    expect((await screen.findByTestId("reporting-board-filter-button")).textContent).toContain("Filters 1");

    const changeDrawerFilter = async (label: string, value: string, expected: Record<string, unknown>) => {
      fireEvent.click(await screen.findByTestId("reporting-board-filter-button"));
      await screen.findByRole("button", { name: "Close" });
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", expect.objectContaining(expected)));
    };
    await changeDrawerFilter("Modality code", "MR", { q: "005279", modalityCode: "MR" });
    await changeDrawerFilter("Category", "neurology", { q: "005279", modalityCode: "MR", caseCategory: "neurology" });
    await changeDrawerFilter("Case source", "comparisons", { q: "005279", modalityCode: "MR", caseCategory: "neurology", caseSource: "comparisons" });
    await changeDrawerFilter("Sort", "study_date", { q: "005279", modalityCode: "MR", caseCategory: "neurology", caseSource: "comparisons", sortBy: "study_date" });
    fireEvent.click(await screen.findByRole("button", { name: /^Assigned 1$/i }));
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", expect.objectContaining({
      mobileQuickTab: "assigned",
      assignedDoctorId: 5,
      assignmentStatus: "assigned",
      q: "005279",
      modalityCode: "MR",
      caseCategory: "neurology",
      caseSource: "comparisons",
      sortBy: "study_date",
    })));

    const all = await screen.findByRole("button", { name: /^All 2$/i });
    fireEvent.click(all);

    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", expect.objectContaining({
      limit: 40,
      offset: 0,
      q: "005279",
      modalityCode: "MR",
      caseCategory: "neurology",
      caseSource: "comparisons",
      sortBy: "study_date",
    })));
    const allFilters = fetchReportingBoardMobileViewMock.mock.calls[fetchReportingBoardMobileViewMock.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(allFilters).not.toHaveProperty("mobileQuickTab");
    expect(allFilters).not.toHaveProperty("assignedDoctorId");
    expect(allFilters).not.toHaveProperty("assignmentStatus");
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Assigned 1$/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clears the active quick-tab predicates before applying a drawer edit", async () => {
    fetchReportingBoardMobileViewMock.mockResolvedValue(doctorWorklistResponse);
    renderPage();

    await screen.findByRole("button", { name: /^Assigned 1$/i });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", expect.objectContaining({
      mobileQuickTab: "assigned",
      assignedDoctorId: 5,
      assignmentStatus: "assigned",
    })));
    const transitions = [
      { tab: /^Assigned 1$/i, quickTab: "assigned", value: "assigned-drawer", stale: ["assignedDoctorId", "assignmentStatus"] },
      { tab: /^Unassigned 1$/i, quickTab: "unassigned", value: "unassigned-drawer", stale: ["assignedDoctorId", "assignmentStatus"] },
      { tab: /^Urgent 1$/i, quickTab: "urgent", value: "urgent-drawer", stale: ["priorityCode", "urgentOrStat"] },
      { tab: /^Overdue 0$/i, quickTab: "overdue", value: "overdue-drawer", stale: ["overdue", "reportStatus"] },
    ] as const;

    for (const transition of transitions) {
      fireEvent.click(await screen.findByRole("button", { name: transition.tab }));
      await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", expect.objectContaining({
        mobileQuickTab: transition.quickTab,
      })));
      fireEvent.click(await screen.findByTestId("reporting-board-filter-button"));
      await screen.findByRole("button", { name: "Close" });
      fireEvent.change(screen.getByLabelText("Category"), { target: { value: transition.value } });
      await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", expect.objectContaining({ caseCategory: transition.value })));
      const drawerFilters = fetchReportingBoardMobileViewMock.mock.calls[fetchReportingBoardMobileViewMock.mock.calls.length - 1][1] as Record<string, unknown>;
      expect(drawerFilters).not.toHaveProperty("mobileQuickTab");
      for (const staleKey of transition.stale) expect(drawerFilters).not.toHaveProperty(staleKey);
    }
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

  it("keeps server-provided quick-tab counters stable while rendering each tab's filtered result total", async () => {
    const counters = { total: 5, assignedToMe: 2, unassigned: 3, urgent: 2, requiredNotFinal: 5, overdue: 1 };
    const assigned = { ...doctorWorklistResponse, counters, totalCount: 2, cases: [doctorWorklistResponse.cases[0]] };
    const unassigned = { ...doctorWorklistResponse, counters, totalCount: 3, cases: [doctorWorklistResponse.cases[1]] };
    const urgent = { ...doctorWorklistResponse, counters, totalCount: 2, cases: [doctorWorklistResponse.cases[0]] };
    const overdue = { ...doctorWorklistResponse, counters, totalCount: 1, cases: [doctorWorklistResponse.cases[1]] };
    const all = { ...doctorWorklistResponse, counters, totalCount: 5, cases: doctorWorklistResponse.cases };
    fetchReportingBoardMobileViewMock.mockImplementation((_token, filters: { mobileQuickTab?: string; assignedDoctorId?: number | null }) => {
      if (filters.mobileQuickTab === "unassigned") return Promise.resolve(unassigned);
      if (filters.mobileQuickTab === "urgent") return Promise.resolve(urgent);
      if (filters.mobileQuickTab === "overdue") return Promise.resolve(overdue);
      if (filters.mobileQuickTab === "all") return Promise.resolve(all);
      if (!filters.assignedDoctorId) return Promise.resolve(all);
      return Promise.resolve(assigned);
    });
    renderPage();

    await screen.findByRole("button", { name: /^Assigned 2$/i });
    await waitFor(() => expect(fetchReportingBoardMobileViewMock).toHaveBeenLastCalledWith("tok-9", expect.objectContaining({ mobileQuickTab: "assigned", assignedDoctorId: 5, assignmentStatus: "assigned" })));
    expect(await screen.findByText("Loaded 1 of 2 cases")).toBeTruthy();

    for (const [tab, patient, total] of [["Unassigned 3", "Abeer Farhat Salem Al-Sadeq", 3], ["Urgent 2", "Mohammed Bashir Meftah", 2], ["Overdue 1", "Abeer Farhat Salem Al-Sadeq", 1], ["All 5", "Comparison Patient", 5]] as const) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${tab}$`, "i") }));
      await screen.findByText(patient);
      expect(await screen.findByText(`Loaded ${tab === "All 5" ? 3 : 1} of ${total} cases`)).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Assigned 2$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Unassigned 3$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Urgent 2$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Overdue 1$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^All 5$/i })).toBeTruthy();
    }
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

  it("omits the enable banner when Web Push is disabled server-side", async () => {
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: vi.fn() } });
    Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: vi.fn().mockResolvedValue(null) } });
    fetchReportingBoardMobilePushConfigMock.mockResolvedValue({ enabled: false, publicKey: null });
    renderPage();

    await screen.findByText("Mohammed Bashir Meftah");
    await waitFor(() => expect(fetchReportingBoardMobilePushConfigMock).toHaveBeenCalledWith("tok-9"));
    expect(screen.queryByText(/Receive alerts for newly assigned/i)).toBeNull();
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
