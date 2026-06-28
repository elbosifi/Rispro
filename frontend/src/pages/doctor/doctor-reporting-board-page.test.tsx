import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DoctorReportingBoardPage, buildReportingBoardPrintUrl } from "./doctor-reporting-board-page";
import type { DoctorMe, ReportingBoardCaseRow } from "@/types/api";

const fetchReportingBoardSettingsMock = vi.fn();
const updateReportingBoardSettingsMock = vi.fn();
const fetchReportingBoardCasesMock = vi.fn();
const fetchReportingBoardStatsMock = vi.fn();
const fetchReportingBoardSavedViewsMock = vi.fn();
const createReportingBoardSavedViewMock = vi.fn();
const updateReportingBoardSavedViewMock = vi.fn();
const fetchReportingBoardSavedViewByTokenMock = vi.fn();
const fetchReportingBoardPushConfigMock = vi.fn();
const subscribeReportingBoardSavedViewPushMock = vi.fn();
const sendReportingBoardSavedViewTestPushMock = vi.fn();
const bulkAssignNextReportingCasesMock = vi.fn();
const bulkReassignSelectedReportingCasesMock = vi.fn();
const bulkUnassignSelectedReportingCasesMock = vi.fn();
const fetchRosterDoctorsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const assignReportingBoardCaseMock = vi.fn();
const unassignReportingBoardCaseMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchReportingBoardSettings: (...args: unknown[]) => fetchReportingBoardSettingsMock(...args),
  updateReportingBoardSettings: (...args: unknown[]) => updateReportingBoardSettingsMock(...args),
  fetchReportingBoardCases: (...args: unknown[]) => fetchReportingBoardCasesMock(...args),
  fetchReportingBoardStats: (...args: unknown[]) => fetchReportingBoardStatsMock(...args),
  fetchReportingBoardSavedViews: (...args: unknown[]) => fetchReportingBoardSavedViewsMock(...args),
  createReportingBoardSavedView: (...args: unknown[]) => createReportingBoardSavedViewMock(...args),
  updateReportingBoardSavedView: (...args: unknown[]) => updateReportingBoardSavedViewMock(...args),
  fetchReportingBoardSavedViewByToken: (...args: unknown[]) => fetchReportingBoardSavedViewByTokenMock(...args),
  fetchReportingBoardPushConfig: (...args: unknown[]) => fetchReportingBoardPushConfigMock(...args),
  subscribeReportingBoardSavedViewPush: (...args: unknown[]) => subscribeReportingBoardSavedViewPushMock(...args),
  sendReportingBoardSavedViewTestPush: (...args: unknown[]) => sendReportingBoardSavedViewTestPushMock(...args),
  bulkAssignNextReportingCases: (...args: unknown[]) => bulkAssignNextReportingCasesMock(...args),
  bulkReassignSelectedReportingCases: (...args: unknown[]) => bulkReassignSelectedReportingCasesMock(...args),
  bulkUnassignSelectedReportingCases: (...args: unknown[]) => bulkUnassignSelectedReportingCasesMock(...args),
  fetchRosterDoctors: (...args: unknown[]) => fetchRosterDoctorsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  assignReportingBoardCase: (...args: unknown[]) => assignReportingBoardCaseMock(...args),
  unassignReportingBoardCase: (...args: unknown[]) => unassignReportingBoardCaseMock(...args),
}));

const managerMe: DoctorMe = {
  hasActiveDoctorProfile: true,
  canAccessClinicalDoctorPortal: true,
  profile: {
    id: 1,
    userId: 10,
    displayName: "Dr Manager",
    doctorRole: "specialist",
    active: true,
    canFinalizeReports: true,
    canAssignProtocols: true,
    canSupervise: true,
  },
  doctorRole: "specialist",
  canFinalizeReports: true,
  canAssignProtocols: true,
  canSupervise: true,
  allowedModalities: [],
  moduleCapabilities: ["doctor", "doctor_supervisor"],
  canAccessCoreWorkspace: true,
};

const caseRow: ReportingBoardCaseRow = {
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
  reportingPriorityCode: "stat",
  reportingPriorityName: "STAT",
  reportingPrioritySortOrder: 0,
  assignedDoctorId: null,
  assignedDoctorName: null,
  assignmentStatus: "unassigned",
  completedAt: "2026-05-29T08:00:00.000Z",
  currentAssignedAt: null,
  firstAssignedAt: null,
  reportFinalAt: null,
  reportStatusCheckedAt: "2026-05-29T08:05:00.000Z",
  dueAt: null,
  completedToAssignedMinutes: null,
  assignedToFinalMinutes: null,
  completedToFinalMinutes: null,
  currentAssignmentAgeMinutes: null,
  completedUnassignedAgeMinutes: 180,
  reportStatus: "draft",
  canAssign: true,
  exclusionReason: null,
};

function renderPage(path = "/doctor/reporting-board") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/doctor/reporting-board" element={<DoctorReportingBoardPage me={managerMe} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("DoctorReportingBoardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchReportingBoardSettingsMock.mockResolvedValue({
      cutoffMode: "days_back",
      defaultCutoffDate: null,
      daysBack: 14,
      enabledModalityCodes: ["CT", "MR"],
      defaultRequiresReport: true,
      defaultReportStatusFilter: "required_not_final",
    });
    updateReportingBoardSettingsMock.mockResolvedValue({});
    fetchReportingBoardCasesMock.mockResolvedValue({ cases: [caseRow], filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" } });
    fetchReportingBoardStatsMock.mockResolvedValue({
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" },
      summary: {
        total: 12,
        unassigned: 5,
        assigned: 7,
        stat: 2,
        urgent: 3,
        statOrUrgent: 5,
        requiredNotFinal: 9,
        final: 1,
        draft: 4,
        noReport: 1,
        studyNotFound: 0,
        unavailable: 6,
        overdue: 2,
        ct: 8,
        mr: 4,
        medianCompletedToAssignedMinutes: 90,
        medianAssignedToFinalMinutes: null,
        p90AssignedToFinalMinutes: null,
        longestActiveAssignmentAgeMinutes: 420,
        completedUnassigned: 5,
      },
      byDoctor: [
        { doctorId: null, doctorName: "Unassigned", total: 5, requiredNotFinal: 5, statOrUrgent: 3, oldestStudyDate: "2026-05-20", ct: 4, mr: 1 },
        { doctorId: 5, doctorName: "Dr Target", total: 7, requiredNotFinal: 4, statOrUrgent: 2, oldestStudyDate: "2026-05-18", ct: 4, mr: 3 },
      ],
      byModality: [
        { modalityCode: "CT", total: 8, requiredNotFinal: 6, statOrUrgent: 3 },
        { modalityCode: "MR", total: 4, requiredNotFinal: 3, statOrUrgent: 2 },
      ],
      byPriority: [
        { priorityCode: "stat", priorityName: "STAT", total: 2 },
        { priorityCode: "urgent", priorityName: "Urgent", total: 3 },
      ],
    });
    fetchReportingBoardSavedViewsMock.mockResolvedValue([
      { id: 9, ownerUserId: 10, ownerDoctorId: 1, name: "Urgent CT", token: "tok-9", filters: { priorityCode: "urgent" }, notificationSettings: { notifyUnassignedUrgent: true }, active: true, createdAt: "", updatedAt: "" },
    ]);
    fetchReportingBoardSavedViewByTokenMock.mockResolvedValue({ id: 9, ownerUserId: 10, ownerDoctorId: 1, name: "Urgent CT", token: "tok-9", filters: { priorityCode: "urgent" }, notificationSettings: { notifyUnassignedUrgent: true }, active: true, createdAt: "", updatedAt: "" });
    createReportingBoardSavedViewMock.mockResolvedValue({ id: 10, name: "Saved", token: "tok-10", filters: {}, notificationSettings: {}, active: true });
    updateReportingBoardSavedViewMock.mockResolvedValue({ id: 9, name: "Urgent CT", token: "tok-9", filters: {}, notificationSettings: {}, active: true });
    fetchReportingBoardPushConfigMock.mockResolvedValue({ enabled: false, publicKey: null });
    subscribeReportingBoardSavedViewPushMock.mockResolvedValue({ subscriptionId: 1 });
    sendReportingBoardSavedViewTestPushMock.mockResolvedValue({ attempted: 1, sent: 1, failed: 0 });
    bulkAssignNextReportingCasesMock.mockResolvedValue({ requestedCount: 2, assignedCount: 2, skippedCount: 0, assignedAppointmentIds: [42, 43], skipped: [] });
    bulkReassignSelectedReportingCasesMock.mockResolvedValue({ requestedCount: 1, assignedCount: 1, skippedCount: 0, assignedAppointmentIds: [42], skipped: [] });
    bulkUnassignSelectedReportingCasesMock.mockResolvedValue({ requestedCount: 1, unassignedCount: 1, skippedCount: 0, unassignedAppointmentIds: [42], skipped: [] });
    fetchRosterDoctorsMock.mockResolvedValue([{ id: 5, userId: 50, displayName: "Dr Target", doctorRole: "specialist", active: true, canFinalizeReports: true, canAssignProtocols: true, canSupervise: false }]);
    fetchAppointmentLookupsMock.mockResolvedValue({
      modalities: [{ id: 1, code: "CT", nameEn: "CT", nameAr: "CT" }],
      examTypes: [],
      priorities: [{ id: 3, code: "stat", nameEn: "STAT", nameAr: "STAT", sortOrder: 0 }],
    });
    assignReportingBoardCaseMock.mockResolvedValue({ assignmentId: 100 });
    unassignReportingBoardCaseMock.mockResolvedValue({ unassigned: true, appointmentId: 42, assignmentId: 100 });
  });

  it("renders compact board columns and row status without a visible priority column", async () => {
    renderPage();

    expect(await screen.findByText("Reporting Assignment Board")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Priority" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "IDs" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Study" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Aging/TAT" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "MRN" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Accession" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Modality" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Exam" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Category" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Report" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Appointment" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(await screen.findByText("V2-000042")).toBeTruthy();
    expect(await screen.findByText("MRN-7")).toBeTruthy();
    expect(await screen.findByText("CT · CT Brain")).toBeTruthy();
    expect(screen.queryByText("No priority")).toBeNull();
    const row = screen.getByText("Alpha Patient").closest("tr");
    expect(row).toBeTruthy();
    expect(row!.getAttribute("aria-label")).toContain("STAT");
    expect(row!.className).toContain("bg-red-50");
    expect(within(row!).getByText("STAT")).toBeTruthy();
    expect(within(row!).getByLabelText("Draft report")).toBeTruthy();
    expect(within(row!).getByText("Unassigned 3h")).toBeTruthy();
  });

  it("renders assigned aging and final TAT without inventing missing final time", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [
        {
          ...caseRow,
          appointmentId: 43,
          accessionNumber: "V2-000043",
          assignedDoctorId: 5,
          assignedDoctorName: "Dr Target",
          assignmentStatus: "assigned",
          currentAssignedAt: "2026-05-29T09:00:00.000Z",
          firstAssignedAt: "2026-05-29T09:00:00.000Z",
          completedToAssignedMinutes: 60,
          currentAssignmentAgeMinutes: 4320,
          completedUnassignedAgeMinutes: null,
          reportFinalAt: null,
          assignedToFinalMinutes: null,
          completedToFinalMinutes: null,
        },
        {
          ...caseRow,
          appointmentId: 44,
          accessionNumber: "V2-000044",
          assignedDoctorId: 5,
          assignedDoctorName: "Dr Target",
          assignmentStatus: "assigned",
          reportStatus: "final",
          currentAssignedAt: "2026-05-29T09:00:00.000Z",
          firstAssignedAt: "2026-05-29T08:30:00.000Z",
          reportFinalAt: "2026-05-31T09:00:00.000Z",
          completedToAssignedMinutes: 30,
          assignedToFinalMinutes: 2880,
          completedToFinalMinutes: 2940,
          currentAssignmentAgeMinutes: null,
          completedUnassignedAgeMinutes: null,
        },
      ],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "all" },
    });
    renderPage();

    expect(await screen.findByText("Assigned 3d")).toBeTruthy();
    expect(await screen.findByText("A→F 2d")).toBeTruthy();
  });

  it("uses a compact final report indicator without full-row green status", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, reportingPriorityCode: null, reportingPriorityName: null, appointmentStatus: "completed", reportStatus: "final", canAssign: false, exclusionReason: "report_final" }],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "final" },
    });
    renderPage();

    const row = (await screen.findByText("Alpha Patient")).closest("tr");
    expect(row).toBeTruthy();
    expect(within(row!).getByLabelText("Final report")).toBeTruthy();
    expect(within(row!).queryByText(/^final$/i)).toBeNull();
    expect(row!.className).not.toContain("bg-emerald");
  });

  it("hides assigned doctor when filtered to one doctor", async () => {
    renderPage();

    await screen.findByText("Reporting Assignment Board");
    await screen.findByRole("option", { name: "Dr Target" });
    expect(screen.getByRole("columnheader", { name: "Assigned doctor" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Assigned doctor"), { target: { value: "doctor:5" } });

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ assignedDoctorId: 5, assignmentStatus: "assigned" })));
    expect(screen.queryByRole("columnheader", { name: "Assigned doctor" })).toBeNull();
  });

  it("keeps row reassignment available from the compact action menu", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, assignedDoctorId: 5, assignedDoctorName: "Dr Target", assignmentStatus: "assigned" }],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" },
    });
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));
    fireEvent.click(within(row).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(within(row).getByRole("combobox")).toBeTruthy());
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "5" } });
    fireEvent.change(screen.getByPlaceholderText("Notes for doctor"), { target: { value: "normal reassignment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(assignReportingBoardCaseMock).toHaveBeenCalledWith(42, { doctorId: 5, reason: "normal reassignment" }));
  });

  it("shows SonicDICOM study action as backend redirect link and copies accession", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));

    const openStudy = within(row).getByRole("menuitem", { name: "Open study in SonicDICOM" }) as HTMLAnchorElement;
    expect(openStudy.getAttribute("href")).toBe("/api/doctor/reporting-board/cases/42/open-sonicdicom");
    expect(openStudy.getAttribute("target")).toBe("_blank");
    expect(openStudy.getAttribute("rel")).toBe("noopener noreferrer");
    expect(openStudy.getAttribute("href")).not.toMatch(/username|password|https?:/i);

    fireEvent.click(within(row).getByRole("menuitem", { name: "Copy accession number" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("V2-000042"));
    expect(await within(row).findByText("Accession copied.")).toBeTruthy();
    expect(within(row).getByText("View appointment")).toBeTruthy();
  });

  it("uses a default board limit of 100", async () => {
    renderPage();

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 })));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 })));
  });

  it("allows a reporting board limit up to 300", async () => {
    renderPage();

    await screen.findByText("Reporting Assignment Board");
    fireEvent.click(screen.getByRole("button", { name: /Advanced filters/i }));
    await screen.findByLabelText("Priority");
    const limitLabel = screen.getByText("Limit").closest("label");
    expect(limitLabel).toBeTruthy();
    const limit = limitLabel!.querySelector("input") as HTMLInputElement;
    expect(limit.max).toBe("300");
    expect(screen.getByText("Shows up to 300 cases. Use filters for larger lists.")).toBeTruthy();

    fireEvent.change(limit, { target: { value: "300" } });

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 300, offset: 0 })));
  });

  it("shows case query errors instead of the empty state", async () => {
    fetchReportingBoardCasesMock.mockRejectedValue(new Error("Could not load reporting cases."));
    renderPage();

    expect(await screen.findByText("Could not load reporting cases.")).toBeTruthy();
    expect(screen.queryByText("No cases match these filters.")).toBeNull();
  });

  it("shows the empty state for a successful empty case result", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({ cases: [], filters: { reportStatus: "required_not_final", limit: 100, offset: 0 } });
    renderPage();

    expect(await screen.findByText("No cases match these filters.")).toBeTruthy();
    expect(screen.queryByText("Could not load reporting cases.")).toBeNull();
  });

  it("opens and applies a saved view token", async () => {
    renderPage("/doctor/reporting-board?savedViewToken=tok-9");

    expect(await screen.findByText("Urgent CT")).toBeTruthy();
    await waitFor(() => {
      expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ priorityCode: "urgent" }));
    });
  });

  it("sends a test web push notification for the loaded saved view", async () => {
    fetchReportingBoardPushConfigMock.mockResolvedValue({ enabled: true, publicKey: "public-key" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Urgent CT" }));
    fireEvent.click(await screen.findByRole("button", { name: /Send test notification/i }));

    await waitFor(() => expect(sendReportingBoardSavedViewTestPushMock).toHaveBeenCalledWith(9));
    expect(await screen.findByText("Test notification sent.")).toBeTruthy();
  });

  it("generates QR links for the mobile read-only saved view route", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Urgent CT" }));
    fireEvent.click(await screen.findByRole("button", { name: /Show mobile QR/i }));

    expect(await screen.findByText("Mobile read-only saved view")).toBeTruthy();
    expect(await screen.findByText(/\/mobile\/reporting-view\/tok-9/)).toBeTruthy();
  });

  it("validates and submits the bulk assignment modal", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Auto-assign next cases/i }));
    expect(await screen.findByText("Assignment order: STAT/urgent first, then priority + oldest study.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Auto-assign next cases" })).toBeTruthy();
    expect(screen.getByText(/The system will choose the next eligible cases using the current filters and assignment order/i)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Assign next cases" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Doctor"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "2" } });
    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getAllByLabelText("Modality").at(-1)!, { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Notes for assigned doctor"), { target: { value: "daily distribution" } });
    fireEvent.click(submit);

    await waitFor(() => expect(bulkAssignNextReportingCasesMock).toHaveBeenCalledWith(expect.objectContaining({
      doctorId: 5,
      count: 2,
      unassignedOnly: true,
      reason: "daily distribution",
      filters: expect.objectContaining({ modalityId: 1 }),
    })));
    expect(await screen.findByText(/2\/2 assigned/)).toBeTruthy();
  });

  it("applies search to reporting board filters on Enter and clears it", async () => {
    renderPage();

    const search = await screen.findByPlaceholderText("Search MRN / accession / patient / exam");
    fireEvent.change(search, { target: { value: "MRN-7" } });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ q: "MRN-7", offset: 0 })));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledWith(expect.objectContaining({ q: "MRN-7", offset: 0 })));

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ q: null, offset: 0 })));
  });

  it("refreshes reporting cases and board statistics without changing filters", async () => {
    renderPage();

    const search = await screen.findByPlaceholderText("Search MRN / accession / patient / exam");
    fireEvent.change(search, { target: { value: "MRN-7" } });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ q: "MRN-7", offset: 0 })));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledWith(expect.objectContaining({ q: "MRN-7", offset: 0 })));

    const caseCallCount = fetchReportingBoardCasesMock.mock.calls.length;
    const statsCallCount = fetchReportingBoardStatsMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledTimes(caseCallCount + 1));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledTimes(statsCallCount + 1));
    expect((screen.getByPlaceholderText("Search MRN / accession / patient / exam") as HTMLInputElement).value).toBe("MRN-7");
  });

  it("keeps advanced filters collapsed until opened", async () => {
    renderPage();

    await screen.findByText("Reporting Assignment Board");
    expect(screen.queryByLabelText("Priority")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Advanced filters/i }));
    expect(screen.getByLabelText("Priority")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "desc" } });
    expect(screen.getByRole("button", { name: /Advanced filters 1/i })).toBeTruthy();
  });

  it("sends sort controls to the reporting board API", async () => {
    renderPage();

    await screen.findByText("Reporting Assignment Board");
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "accession" } });
    fireEvent.click(screen.getByRole("button", { name: /Advanced filters/i }));
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "desc" } });
    fireEvent.click(screen.getByLabelText("Keep STAT/urgent on top"));

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({
      sortBy: "accession",
      sortDirection: "desc",
      pinUrgentToTop: false,
      offset: 0,
    })));
  });

  it("renders reporting statistics and applies stat filter shortcuts", async () => {
    renderPage();

    expect((await screen.findAllByText("Total")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("12")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("STAT/Urgent")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /STAT\/Urgent/i }));
    fireEvent.click(await screen.findByRole("button", { name: "STAT" }));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledWith(expect.objectContaining({ priorityCode: "stat", offset: 0 })));
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ priorityCode: "stat", offset: 0 })));
  });

  it("collapses doctor workload by default and expands it", async () => {
    renderPage();

    expect(await screen.findByText(/Doctor workload: Unassigned 5 \| Highest assigned: Dr Target 7/)).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Oldest study" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Doctor workload/i }));
    expect(await screen.findByRole("columnheader", { name: "Oldest study" })).toBeTruthy();
  });

  it("shows selected-case reassignment controls only after selection", async () => {
    renderPage();

    expect(await screen.findByLabelText("Select all visible cases")).toBeTruthy();
    const selectAll = await screen.findByLabelText("Select all visible cases");
    await screen.findByLabelText("Select case V2-000042");
    expect(screen.getByText("Select cases to reassign.")).toBeTruthy();
    expect(screen.queryByText("0 selected")).toBeNull();
    expect(screen.queryByLabelText("Reassign to")).toBeNull();
    expect(screen.getByRole("link", { name: "Print handoff" })).toBeTruthy();

    fireEvent.click(selectAll);
    expect(await screen.findByText("1 selected")).toBeTruthy();
    expect(screen.getByLabelText("Reassign to")).toBeTruthy();
    expect(screen.getByLabelText("Reason/note")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Reassign selected" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Auto-assign next cases/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Print handoff (1 selected)" })).toBeTruthy();
  });

  it("shows return-to-pool only for assigned row editors and requires confirmation reason", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [
        { ...caseRow, assignedDoctorId: 5, assignedDoctorName: "Dr Target", assignmentStatus: "assigned" },
        { ...caseRow, appointmentId: 43, accessionNumber: "V2-000043", assignedDoctorId: null, assignedDoctorName: null, assignmentStatus: "unassigned" },
      ],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" },
    });
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const assignedRow = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(assignedRow).getByRole("button", { name: "Open actions for V2-000042" }));
    fireEvent.click(within(assignedRow).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(within(screen.getByText("V2-000042").closest("tr")!).getByRole("option", { name: "Return to waiting pool" })).toBeTruthy());

    const unassignedRow = screen.getByText("V2-000043").closest("tr")!;
    fireEvent.click(within(unassignedRow).getByRole("button", { name: "Open actions for V2-000043" }));
    fireEvent.click(within(unassignedRow).getByRole("button", { name: "Assign" }));
    const assignedSelect = within(screen.getByText("V2-000042").closest("tr")!).getByRole("combobox");
    const unassignedSelect = within(screen.getByText("V2-000043").closest("tr")!).getByRole("combobox");
    expect(within(unassignedSelect).queryByRole("option", { name: "Return to waiting pool" })).toBeNull();

    fireEvent.change(assignedSelect, { target: { value: "__UNASSIGN__" } });
    expect(await screen.findByText(/removes the assigned doctor and returns the case to the unassigned pool/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm return to waiting pool" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Reason for returning to waiting pool"), { target: { value: "radiologist unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm return to waiting pool" }));

    await waitFor(() => expect(unassignReportingBoardCaseMock).toHaveBeenCalledWith(42, { reason: "radiologist unavailable" }));
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(fetchReportingBoardStatsMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("keeps normal row reassignment behavior when selecting a doctor", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, assignedDoctorId: 5, assignedDoctorName: "Dr Target", assignmentStatus: "assigned" }],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" },
    });
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));
    fireEvent.click(within(row).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(within(screen.getByText("V2-000042").closest("tr")!).getByRole("combobox")).toBeTruthy());
    const combobox = within(screen.getByText("V2-000042").closest("tr")!).getByRole("combobox");
    fireEvent.change(combobox, { target: { value: "5" } });
    fireEvent.change(screen.getByPlaceholderText("Notes for doctor"), { target: { value: "normal reassignment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(assignReportingBoardCaseMock).toHaveBeenCalledWith(42, { doctorId: 5, reason: "normal reassignment" }));
    expect(unassignReportingBoardCaseMock).not.toHaveBeenCalled();
  });

  it("bulk returns selected cases to waiting pool only after reason confirmation", async () => {
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    fireEvent.click(screen.getByLabelText("Select case V2-000042"));
    await screen.findByText("1 selected");
    const button = await screen.findByRole("button", { name: "Return selected to waiting pool" });
    fireEvent.click(button);

    expect(await screen.findByText(/removes assigned doctors and returns selected cases to the unassigned waiting pool/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm return selected to waiting pool" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Reason for returning selected cases"), { target: { value: "rebalance workload" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm return selected to waiting pool" }));

    await waitFor(() => expect(bulkUnassignSelectedReportingCasesMock).toHaveBeenCalledWith({ appointmentIds: [42], reason: "rebalance workload" }));
    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(fetchReportingBoardStatsMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("does not expose editable settings for non-superadmin managers", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Board settings" }));
    expect(await screen.findByText("Read-only. Only superadmin can update cutoff settings.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
  });

  it("opens board settings modal with existing controls", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Board settings" }));
    expect(await screen.findByRole("heading", { name: /Board settings/i })).toBeTruthy();
    expect(screen.getByLabelText("Cutoff mode")).toBeTruthy();
    expect(screen.getByLabelText("Default report status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: /Board settings/i })).toBeNull();
  });

  it("builds print URLs with reporting board parameters", () => {
    const url = buildReportingBoardPrintUrl({
      filters: { reportStatus: "required_not_final", assignedDoctorId: 5 },
      savedViewToken: "tok",
      selectedAppointmentIds: [42],
      autoprint: true,
    });

    expect(url).toContain("/print/reporting-board?");
    expect(url).toContain("savedViewToken=tok");
    expect(url).toContain("assignedDoctorId=5");
    expect(url).toContain("appointmentIds=42");
    expect(url).toContain("autoprint=1");
  });
});
