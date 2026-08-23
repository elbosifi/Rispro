import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DoctorReportingBoardPage } from "./doctor-reporting-board-page";
import { buildReportingBoardPrintUrl } from "./doctor-reporting-board-page.helpers";
import type { DoctorMe, ReportingBoardCaseRow } from "@/types/api";

const fetchReportingBoardSettingsMock = vi.fn();
const updateReportingBoardSettingsMock = vi.fn();
const fetchReportingBoardCasesMock = vi.fn();
const fetchReportingBoardStatsMock = vi.fn();
const refreshReportingBoardSonicDicomMock = vi.fn();
const refreshReportingBoardCaseSonicDicomStatusMock = vi.fn();
const queueFullReportingBoardSonicDicomResyncMock = vi.fn();
const fetchFullReportingBoardSonicDicomResyncStatusMock = vi.fn();
const fetchReportingBoardSavedViewsMock = vi.fn();
const createReportingBoardSavedViewMock = vi.fn();
const updateReportingBoardSavedViewMock = vi.fn();
const fetchReportingBoardSavedViewByTokenMock = vi.fn();
const fetchReportingBoardPushConfigMock = vi.fn();
const subscribeReportingBoardSavedViewPushMock = vi.fn();
const sendReportingBoardSavedViewTestPushMock = vi.fn();
const fetchReportingBoardBulkAssignmentJobsMock = vi.fn();
const createReportingBoardBulkAssignmentJobMock = vi.fn();
const createReportingBoardBulkAssignmentJobsMock = vi.fn();
const cancelReportingBoardBulkAssignmentJobMock = vi.fn();
const runReportingBoardBulkAssignmentJobNowMock = vi.fn();
const resumeReportingBoardBulkAssignmentJobMock = vi.fn();
const undoReportingBoardBulkAssignmentJobMock = vi.fn();
const bulkAssignNextReportingCasesMock = vi.fn();
const bulkReassignSelectedReportingCasesMock = vi.fn();
const bulkUnassignSelectedReportingCasesMock = vi.fn();
const fetchRosterDoctorsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const assignReportingBoardCaseMock = vi.fn();
const unassignReportingBoardCaseMock = vi.fn();
const assignComparisonRequestMock = vi.fn();
const unassignComparisonRequestMock = vi.fn();
const finalizeComparisonRequestMock = vi.fn();
const markReportingBoardCaseDiscontinuedMock = vi.fn();
const markReportingBoardCaseManualFinalMock = vi.fn();
const clearReportingBoardCaseManualFinalMock = vi.fn();
const fetchOhifViewerAvailabilityMock = vi.fn();
const launchReportingBoardCaseInOhifMock = vi.fn();
const fetchOhifRetrievalJobMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchReportingBoardSettings: (...args: unknown[]) => fetchReportingBoardSettingsMock(...args),
  updateReportingBoardSettings: (...args: unknown[]) => updateReportingBoardSettingsMock(...args),
  fetchReportingBoardCases: (...args: unknown[]) => fetchReportingBoardCasesMock(...args),
  fetchReportingBoardStats: (...args: unknown[]) => fetchReportingBoardStatsMock(...args),
  refreshReportingBoardSonicDicom: (...args: unknown[]) => refreshReportingBoardSonicDicomMock(...args),
  refreshReportingBoardCaseSonicDicomStatus: (...args: unknown[]) => refreshReportingBoardCaseSonicDicomStatusMock(...args),
  queueFullReportingBoardSonicDicomResync: (...args: unknown[]) => queueFullReportingBoardSonicDicomResyncMock(...args),
  fetchFullReportingBoardSonicDicomResyncStatus: (...args: unknown[]) => fetchFullReportingBoardSonicDicomResyncStatusMock(...args),
  fetchReportingBoardSavedViews: (...args: unknown[]) => fetchReportingBoardSavedViewsMock(...args),
  createReportingBoardSavedView: (...args: unknown[]) => createReportingBoardSavedViewMock(...args),
  updateReportingBoardSavedView: (...args: unknown[]) => updateReportingBoardSavedViewMock(...args),
  fetchReportingBoardSavedViewByToken: (...args: unknown[]) => fetchReportingBoardSavedViewByTokenMock(...args),
  fetchReportingBoardPushConfig: (...args: unknown[]) => fetchReportingBoardPushConfigMock(...args),
  subscribeReportingBoardSavedViewPush: (...args: unknown[]) => subscribeReportingBoardSavedViewPushMock(...args),
  sendReportingBoardSavedViewTestPush: (...args: unknown[]) => sendReportingBoardSavedViewTestPushMock(...args),
  fetchReportingBoardBulkAssignmentJobs: (...args: unknown[]) => fetchReportingBoardBulkAssignmentJobsMock(...args),
  createReportingBoardBulkAssignmentJob: (...args: unknown[]) => createReportingBoardBulkAssignmentJobMock(...args),
  createReportingBoardBulkAssignmentJobs: (...args: unknown[]) => createReportingBoardBulkAssignmentJobsMock(...args),
  cancelReportingBoardBulkAssignmentJob: (...args: unknown[]) => cancelReportingBoardBulkAssignmentJobMock(...args),
  runReportingBoardBulkAssignmentJobNow: (...args: unknown[]) => runReportingBoardBulkAssignmentJobNowMock(...args),
  resumeReportingBoardBulkAssignmentJob: (...args: unknown[]) => resumeReportingBoardBulkAssignmentJobMock(...args),
  undoReportingBoardBulkAssignmentJob: (...args: unknown[]) => undoReportingBoardBulkAssignmentJobMock(...args),
  bulkAssignNextReportingCases: (...args: unknown[]) => bulkAssignNextReportingCasesMock(...args),
  bulkReassignSelectedReportingCases: (...args: unknown[]) => bulkReassignSelectedReportingCasesMock(...args),
  bulkUnassignSelectedReportingCases: (...args: unknown[]) => bulkUnassignSelectedReportingCasesMock(...args),
  fetchRosterDoctors: (...args: unknown[]) => fetchRosterDoctorsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  assignReportingBoardCase: (...args: unknown[]) => assignReportingBoardCaseMock(...args),
  unassignReportingBoardCase: (...args: unknown[]) => unassignReportingBoardCaseMock(...args),
  assignComparisonRequest: (...args: unknown[]) => assignComparisonRequestMock(...args),
  unassignComparisonRequest: (...args: unknown[]) => unassignComparisonRequestMock(...args),
  finalizeComparisonRequest: (...args: unknown[]) => finalizeComparisonRequestMock(...args),
  markReportingBoardCaseDiscontinued: (...args: unknown[]) => markReportingBoardCaseDiscontinuedMock(...args),
  markReportingBoardCaseManualFinal: (...args: unknown[]) => markReportingBoardCaseManualFinalMock(...args),
  clearReportingBoardCaseManualFinal: (...args: unknown[]) => clearReportingBoardCaseManualFinalMock(...args),
  fetchOhifViewerAvailability: (...args: unknown[]) => fetchOhifViewerAvailabilityMock(...args),
  launchReportingBoardCaseInOhif: (...args: unknown[]) => launchReportingBoardCaseInOhifMock(...args),
  fetchOhifRetrievalJob: (...args: unknown[]) => fetchOhifRetrievalJobMock(...args),
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

const ordinaryDoctorMe: DoctorMe = {
  ...managerMe,
  profile: { ...managerMe.profile!, canSupervise: false },
  canSupervise: false,
  moduleCapabilities: ["doctor"],
};

const caseRow: ReportingBoardCaseRow = {
  caseType: "appointment",
  caseKey: "appointment:42",
  appointmentId: 42,
  comparisonRequestId: null,
  patientId: 7,
  patientMrn: "MRN-7",
  patientDicomId: "DICOM-PRIMARY-7",
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
  linkedPreviousBookingId: null,
  linkedPreviousStudyDate: null,
  linkedPreviousAccessionNumber: null,
  caseCategory: "oncology",
  appointmentStatus: "scheduled",
  requiresReport: true,
  reportingPriorityId: 3,
  reportingPriorityCode: "stat",
  reportingPriorityName: "STAT",
  reportingPrioritySortOrder: 0,
  assignedDoctorId: null,
  assignedDoctorName: null,
  finalizedByDoctorId: null,
  finalizedByDoctorName: null,
  sonicDicomFinalizedByAccount: null,
  sonicDicomLatestDocumentId: null,
  sonicDicomCorrelationMethod: null,
  assignmentStatus: "unassigned",
  completedAt: "2026-05-29T08:00:00.000Z",
  currentAssignedAt: null,
  firstAssignedAt: null,
  reportFinalAt: null,
  reportStatusCheckedAt: "2026-05-29T08:05:00.000Z",
  reportStatusSource: "sonicdicom",
  sonicDicomStudyNote: null,
  sonicDicomStudyNoteCheckedAt: null,
  sonicDicomStudyNoteSource: null,
  manualFinalOverrideId: null,
  manualFinalAt: null,
  manualFinalByName: null,
  manualFinalReason: null,
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

const comparisonRow: ReportingBoardCaseRow = {
  ...caseRow,
  caseType: "comparison",
  caseKey: "comparison:77",
  appointmentId: 620,
  comparisonRequestId: 77,
  accessionNumber: "CMP-000077",
  bookingDate: "2026-06-22",
  bookingTime: null,
  examTypeName: "Comparison report",
  linkedPreviousBookingId: 620,
  linkedPreviousStudyDate: "2026-05-20",
  linkedPreviousAccessionNumber: "V2-000620",
  appointmentStatus: "ready_for_reporting",
  assignedDoctorId: null,
  assignedDoctorName: null,
  assignmentStatus: "unassigned",
  reportStatus: "draft",
};

function renderPage(path = "/doctor/reporting-board", me: DoctorMe = managerMe) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/doctor/reporting-board" element={<DoctorReportingBoardPage me={me} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function setNavigatorPlatform(platform: string) {
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: platform });
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: platform });
}

async function openSavedViews() {
  fireEvent.click(await screen.findByRole("button", { name: "Open saved views" }));
}

function expectNoPriorityTint(row: Element) {
  expect(row.className).not.toContain("bg-red");
  expect(row.className).not.toContain("bg-orange");
  expect(row.className).not.toContain("bg-amber");
  expect(row.className).not.toContain("bg-yellow");
  expect(row.className).not.toContain("bg-teal");
}

describe("DoctorReportingBoardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    setNavigatorPlatform("MacIntel");
    fetchReportingBoardSettingsMock.mockResolvedValue({
      cutoffMode: "days_back",
      defaultCutoffDate: null,
      daysBack: 14,
      enabledModalityCodes: ["CT", "MR"],
      defaultRequiresReport: true,
      defaultReportStatusFilter: "required_not_final",
    });
    updateReportingBoardSettingsMock.mockResolvedValue({});
    refreshReportingBoardSonicDicomMock.mockResolvedValue({ ok: true, checked: 1, successful: 1, failed: 0, checkedAt: "2026-08-19T10:00:00.000Z" });
    refreshReportingBoardCaseSonicDicomStatusMock.mockResolvedValue({ ok: true, appointmentId: 42, successful: true, previousStatus: "final", reportStatus: "final", changed: false, cachedStatusRetained: false, checkedAt: "2026-08-23T10:00:00.000Z" });
    queueFullReportingBoardSonicDicomResyncMock.mockResolvedValue({ ok: true, queued: 1234, requestedAt: "2026-08-22T10:00:00.000Z" });
    fetchFullReportingBoardSonicDicomResyncStatusMock.mockResolvedValue({ ok: true, remaining: 0, failed: 0 });
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [caseRow],
      filters: {
        dateFrom: "2026-05-15",
        dateTo: null,
        cutoffDate: "2026-05-15",
        assignmentStatus: "all",
        reportStatus: "required_not_final",
        requiresReport: true,
        caseSource: "all",
        sortBy: "priority_study_date",
        sortDirection: "asc",
        pinUrgentToTop: true,
        limit: 100,
        offset: 0,
      },
    });
    fetchReportingBoardStatsMock.mockResolvedValue({
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final", requiresReport: true, caseSource: "all", limit: 100, offset: 0 },
      summary: {
        total: 12,
        comparisonRequests: 0,
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
      { id: 9, ownerUserId: 10, ownerDoctorId: 1, name: "Urgent CT", token: "tok-9", filters: { priorityCode: "urgent", offset: 50 }, notificationSettings: { notifyUnassignedUrgent: true }, active: true, createdAt: "", updatedAt: "" },
    ]);
    fetchReportingBoardSavedViewByTokenMock.mockResolvedValue({ id: 9, ownerUserId: 10, ownerDoctorId: 1, name: "Urgent CT", token: "tok-9", filters: { priorityCode: "urgent" }, notificationSettings: { notifyUnassignedUrgent: true }, active: true, createdAt: "", updatedAt: "" });
    createReportingBoardSavedViewMock.mockResolvedValue({ id: 10, name: "Saved", token: "tok-10", filters: {}, notificationSettings: {}, active: true });
    updateReportingBoardSavedViewMock.mockResolvedValue({ id: 9, name: "Urgent CT", token: "tok-9", filters: {}, notificationSettings: {}, active: true });
    fetchReportingBoardPushConfigMock.mockResolvedValue({ enabled: false, publicKey: null });
    subscribeReportingBoardSavedViewPushMock.mockResolvedValue({ subscriptionId: 1 });
    sendReportingBoardSavedViewTestPushMock.mockResolvedValue({ attempted: 1, sent: 1, failed: 0 });
    fetchReportingBoardBulkAssignmentJobsMock.mockResolvedValue([]);
    createReportingBoardBulkAssignmentJobMock.mockResolvedValue({ id: 1 });
    createReportingBoardBulkAssignmentJobsMock.mockResolvedValue([]);
    cancelReportingBoardBulkAssignmentJobMock.mockResolvedValue({ id: 1 });
    runReportingBoardBulkAssignmentJobNowMock.mockResolvedValue({ id: 1 });
    resumeReportingBoardBulkAssignmentJobMock.mockResolvedValue({ job: { id: 1 }, jobs: [] });
    undoReportingBoardBulkAssignmentJobMock.mockResolvedValue({ job: { id: 1 }, result: { requestedCount: 0, unassignedCount: 0, skippedCount: 0, unassignedAppointmentIds: [], skipped: [] } });
    bulkAssignNextReportingCasesMock.mockResolvedValue({ requestedCount: 2, assignedCount: 2, skippedCount: 0, assignedAppointmentIds: [42, 43], skipped: [] });
    bulkReassignSelectedReportingCasesMock.mockResolvedValue({ requestedCount: 1, assignedCount: 1, skippedCount: 0, assignedAppointmentIds: [42], assignedComparisonRequestIds: [], skipped: [] });
    bulkUnassignSelectedReportingCasesMock.mockResolvedValue({ requestedCount: 1, unassignedCount: 1, skippedCount: 0, unassignedAppointmentIds: [42], unassignedComparisonRequestIds: [], skipped: [] });
    fetchRosterDoctorsMock.mockResolvedValue([{ id: 5, userId: 50, displayName: "Dr Target", doctorRole: "specialist", active: true, canFinalizeReports: true, canAssignProtocols: true, canSupervise: false }]);
    fetchAppointmentLookupsMock.mockResolvedValue({
      modalities: [{ id: 1, code: "CT", nameEn: "CT", nameAr: "CT" }],
      examTypes: [],
      priorities: [{ id: 3, code: "stat", nameEn: "STAT", nameAr: "STAT", sortOrder: 0 }],
    });
    assignReportingBoardCaseMock.mockResolvedValue({ assignmentId: 100 });
    unassignReportingBoardCaseMock.mockResolvedValue({ unassigned: true, appointmentId: 42, assignmentId: 100 });
    assignComparisonRequestMock.mockResolvedValue({ assignmentId: 101, comparisonRequestId: 77 });
    unassignComparisonRequestMock.mockResolvedValue({ unassigned: true, comparisonRequestId: 77, assignmentId: 101 });
    finalizeComparisonRequestMock.mockResolvedValue({});
    markReportingBoardCaseDiscontinuedMock.mockResolvedValue({ ok: true, status: "discontinued" });
    markReportingBoardCaseManualFinalMock.mockResolvedValue({ ok: true, appointmentId: 42, status: "manual_final" });
    clearReportingBoardCaseManualFinalMock.mockResolvedValue({ ok: true, appointmentId: 42, status: "manual_final_cleared" });
    fetchOhifViewerAvailabilityMock.mockResolvedValue({ enabled: false, configured: false, openMode: "new_tab" });
    launchReportingBoardCaseInOhifMock.mockResolvedValue({
      status: "ready", launchUrl: "/api/ohif/launch/test-token", openMode: "new_tab",
      currentStudy: { studyInstanceUid: "1.2.840.42" }, priorStudies: [], priorStudyCount: 0,
    });
    fetchOhifRetrievalJobMock.mockResolvedValue({ status: "ready", retrievalJobId: 1, message: "The study is ready." });
  });

  it("opens an authorized appointment in a placeholder OHIF tab and hides the action when disabled", async () => {
    const placeholder = { opener: window, location: { href: "about:blank" }, close: vi.fn() } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(placeholder);
    fetchOhifViewerAvailabilityMock.mockResolvedValue({ enabled: true, configured: true, openMode: "new_tab" });
    renderPage();

    const row = (await screen.findByText("V2-000042")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open Images" }));

    await waitFor(() => expect(launchReportingBoardCaseInOhifMock).toHaveBeenCalledWith(42, true));
    expect(openSpy).toHaveBeenCalledWith("about:blank", "_blank");
    expect(placeholder.location.href).toBe("/api/ohif/launch/test-token");
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

  it("shows assigned and actual SonicDICOM finalizer as separate desktop facts", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, reportStatus: "final", assignedDoctorId: 5, assignedDoctorName: "Assigned Doctor", assignmentStatus: "assigned", finalizedByDoctorId: 8, finalizedByDoctorName: "Final Doctor", sonicDicomFinalizedByAccount: "final.doctor@nccb.ly", sonicDicomLatestDocumentId: "900", sonicDicomCorrelationMethod: "study_instance_uid" }],
      filters: { reportStatus: "all", limit: 100, offset: 0 },
    });
    renderPage();

    const row = (await screen.findByText("Alpha Patient")).closest("tr")!;
    expect(within(row).getByText("Assigned Doctor")).toBeTruthy();
    expect(within(row).getByText("Finalized by: Dr Final Doctor")).toBeTruthy();
    expect(within(row).getByText("Different reporter")).toBeTruthy();
  });

  it("does not tint draft, overdue, or unassigned routine rows", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, reportingPriorityCode: null, reportingPriorityName: null, reportStatus: "draft", assignmentStatus: "unassigned", assignedDoctorId: null, assignedDoctorName: null }],
      filters: { reportStatus: "required_not_final", limit: 100, offset: 0 },
    });
    renderPage();

    const row = (await screen.findByText("Alpha Patient")).closest("tr")!;
    expect(row.getAttribute("aria-label")).toContain("Overdue");
    expectNoPriorityTint(row);
  });

  it("uses priority-only row tinting for urgent and STAT cases", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [
        { ...caseRow, caseKey: "appointment:43", appointmentId: 43, accessionNumber: "V2-000043", patientEnglishName: "Urgent Patient", reportingPriorityCode: "urgent", reportingPriorityName: "Urgent" },
        { ...caseRow, caseKey: "appointment:44", appointmentId: 44, accessionNumber: "V2-000044", patientEnglishName: "Stat Patient", reportingPriorityCode: "stat", reportingPriorityName: "STAT urgent" },
        { ...comparisonRow, reportingPriorityCode: null, reportingPriorityName: null, patientEnglishName: "Comparison Patient" },
      ],
      filters: { reportStatus: "required_not_final", limit: 100, offset: 0 },
    });
    renderPage();

    const urgentRow = (await screen.findByText("Urgent Patient")).closest("tr")!;
    expect(urgentRow.className).toContain("bg-orange");
    expect(urgentRow.className).not.toContain("bg-red");

    const statRow = (await screen.findByText("Stat Patient")).closest("tr")!;
    expect(statRow.className).toContain("bg-red");
    expect(statRow.className).not.toContain("bg-orange");

    const comparisonRoutineRow = (await screen.findByText("Comparison Patient")).closest("tr")!;
    expectNoPriorityTint(comparisonRoutineRow);
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

  it("distinguishes a required case with no report yet", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, appointmentStatus: "completed", reportStatus: "no_report" }],
      filters: { reportStatus: "all" },
    });
    renderPage();

    const row = (await screen.findByText("Alpha Patient")).closest("tr")!;
    expect(within(row).getByLabelText("No report yet").getAttribute("title")).toBe("No report yet");
    expect(within(row).getByText("No report")).toBeTruthy();
    expect(within(row).queryByText("No report required")).toBeNull();
    expect(row.getAttribute("aria-label")).toContain("No report yet");
    expect(row.getAttribute("title")).toContain("Report: No report yet");
  });

  it("distinguishes a case where a report is not required", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, requiresReport: false, appointmentStatus: "completed", reportStatus: "no_report" }],
      filters: { reportStatus: "all", requiresReport: false },
    });
    renderPage();

    const row = (await screen.findByText("Alpha Patient")).closest("tr")!;
    expect(within(row).getByLabelText("Report not required").getAttribute("title")).toBe("Report not required");
    expect(within(row).getByText("Report not required")).toBeTruthy();
    expect(row.getAttribute("aria-label")).toContain("Report not required");
    expect(row.getAttribute("title")).toContain("Report: Report not required");
  });

  it("marks appointment rows final in RISpro with a required reason", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, appointmentStatus: "completed", reportStatus: "draft", canAssign: true, exclusionReason: null }],
      filters: { reportStatus: "required_not_final" },
    });
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark final in RISpro" }));

    expect(await screen.findByText("This only marks the case final inside RISpro. It does not finalize or create a SonicDICOM report.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Imported final already reviewed" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark final in RISpro" }));

    await waitFor(() => expect(markReportingBoardCaseManualFinalMock).toHaveBeenCalledWith(42, { reason: "Imported final already reviewed" }));
  });

  it("shows manual final status and clear action only for manual appointment overrides", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{
        ...caseRow,
        appointmentStatus: "completed",
        reportStatus: "final",
        reportStatusSource: "manual",
        manualFinalOverrideId: 9,
        manualFinalAt: "2026-05-29T09:00:00.000Z",
        manualFinalByName: "Dr Manager",
        manualFinalReason: "Imported final already reviewed",
        canAssign: false,
        exclusionReason: "manual_final",
      }],
      filters: { reportStatus: "final" },
    });
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    expect(within(row).getByText("Final · manual")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));
    expect(screen.getByText("Manual final override")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear manual final override" }));

    expect(await screen.findByText("This clears only the RISpro manual final override. SonicDICOM status will be used again on next refresh.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "SonicDICOM final is now available" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear manual final" }));

    await waitFor(() => expect(clearReportingBoardCaseManualFinalMock).toHaveBeenCalledWith(42, { reason: "SonicDICOM final is now available" }));
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

  it("keeps the Assigned tile, filter chip, and Assigned doctor selector synchronized", async () => {
    renderPage();

    await screen.findByText("Reporting Assignment Board");
    const assignedTile = await screen.findByRole("button", { name: /^Assigned-/i });
    fireEvent.click(assignedTile);

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ assignmentStatus: "assigned", assignedDoctorId: null })));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledWith(expect.objectContaining({ assignmentStatus: "assigned", assignedDoctorId: null })));
    expect((screen.getByLabelText("Assigned doctor") as HTMLSelectElement).value).toBe("assigned");
    expect(screen.getByText("Assigned:").parentElement?.textContent).toContain("Assigned:Assigned");
  });

  it("maps every Assigned doctor selector option to the existing assignment filters", async () => {
    renderPage();

    const selector = await screen.findByLabelText("Assigned doctor");
    fireEvent.change(selector, { target: { value: "unassigned" } });
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ assignmentStatus: "unassigned", assignedDoctorId: null, offset: 0 })));

    fireEvent.change(selector, { target: { value: "assigned" } });
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ assignmentStatus: "assigned", assignedDoctorId: null, offset: 0 })));

    fireEvent.change(selector, { target: { value: "doctor:5" } });
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ assignmentStatus: "assigned", assignedDoctorId: 5, offset: 0 })));

    fireEvent.change(selector, { target: { value: "all" } });
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ assignmentStatus: "all", assignedDoctorId: null, offset: 0 })));
  });

  it("allows manager assignment controls for final cases but hides return to waiting pool", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [
        { ...caseRow, reportStatus: "final", assignedDoctorId: null, assignedDoctorName: null, assignmentStatus: "unassigned", canAssign: true, manualFinalOverrideId: null },
        { ...caseRow, appointmentId: 43, accessionNumber: "V2-000043", reportStatus: "final", assignedDoctorId: 5, assignedDoctorName: "Dr Target", assignmentStatus: "assigned", canAssign: true, manualFinalOverrideId: null },
      ],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "all" },
    });
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const unassignedRow = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(unassignedRow).getByRole("button", { name: "Open actions for V2-000042" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    let menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("combobox")).toBeTruthy();
    expect(within(menu).getByRole("option", { name: "Dr Target" })).toBeTruthy();
    expect(within(menu).queryByText(/report final/i)).toBeNull();

    const assignedRow = screen.getByText("V2-000043").closest("tr")!;
    fireEvent.click(within(assignedRow).getByRole("button", { name: "Open actions for V2-000043" }));
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    menu = screen.getAllByRole("menu").at(-1)!;
    expect(within(menu).getByRole("combobox")).toBeTruthy();
    expect(within(menu).getByRole("option", { name: "Dr Target" })).toBeTruthy();
    expect(within(menu).queryByRole("option", { name: "Return to waiting pool" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByRole("combobox")).toBeTruthy());
    fireEvent.change(within(menu).getByRole("combobox"), { target: { value: "5" } });
    fireEvent.change(screen.getByPlaceholderText("Notes for doctor"), { target: { value: "normal reassignment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(assignReportingBoardCaseMock).toHaveBeenCalledWith(42, { doctorId: 5, reason: "normal reassignment" }));
  });

  it("shows SonicDICOM study and patient list actions as backend redirect links and copies accession", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));

    const openStudy = screen.getByRole("menuitem", { name: "Open this study in SonicDICOM" }) as HTMLAnchorElement;
    expect(openStudy.getAttribute("href")).toBe("/api/doctor/reporting-board/cases/42/open-sonicdicom?scope=study");
    expect(openStudy.getAttribute("target")).toBe("_blank");
    expect(openStudy.getAttribute("rel")).toBe("noopener noreferrer");
    expect(openStudy.getAttribute("href")).not.toMatch(/username|password|https?:/i);
    const openPatient = screen.getByRole("menuitem", { name: "Open patient list in SonicDICOM" }) as HTMLAnchorElement;
    expect(openPatient.getAttribute("href")).toBe("/api/doctor/reporting-board/cases/42/open-sonicdicom?scope=patient");
    expect(openPatient.getAttribute("href")).not.toMatch(/username|password|DICOM-PRIMARY-7|MRN-7|7$/i);
    expect(screen.queryByRole("menuitem", { name: "Open patient studies in SonicDICOM" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Open this study in RadiAnt" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy accession number" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("V2-000042"));
    expect(await screen.findByText("Accession copied.")).toBeTruthy();
    expect(screen.getByText("View appointment")).toBeTruthy();
  });

  it("refreshes one report status and distinguishes changed, unchanged, and unavailable results", async () => {
    refreshReportingBoardCaseSonicDicomStatusMock
      .mockResolvedValueOnce({ ok: true, appointmentId: 42, successful: true, previousStatus: "final", reportStatus: "no_report", changed: true, cachedStatusRetained: false, checkedAt: "2026-08-23T10:00:00.000Z" })
      .mockResolvedValueOnce({ ok: true, appointmentId: 42, successful: true, previousStatus: "final", reportStatus: "final", changed: false, cachedStatusRetained: false, checkedAt: "2026-08-23T10:00:00.000Z" })
      .mockResolvedValueOnce({ ok: true, appointmentId: 42, successful: false, previousStatus: "final", reportStatus: "final", changed: false, cachedStatusRetained: true, checkedAt: "2026-08-23T10:00:00.000Z" });
    renderPage();
    await screen.findByText("V2-000042");
    const row = screen.getByText("V2-000042").closest("tr")!;

    for (const message of ["Report status refreshed: Final → No report.", "Report status refreshed. SonicDICOM still reports Final.", "Could not refresh this report status. SonicDICOM is unavailable; cached Final status was retained."]) {
      fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Refresh report status" }));
      await waitFor(() => expect(refreshReportingBoardCaseSonicDicomStatusMock).toHaveBeenCalledTimes(["Report status refreshed: Final → No report.", "Report status refreshed. SonicDICOM still reports Final.", "Could not refresh this report status. SonicDICOM is unavailable; cached Final status was retained."].indexOf(message) + 1));
      expect(await screen.findByText(message)).toBeTruthy();
    }
    expect(refreshReportingBoardCaseSonicDicomStatusMock).toHaveBeenCalledWith(42);
  });

  it("shows RadiAnt actions only on Windows and builds tag search URLs", async () => {
    setNavigatorPlatform("Win32");
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));

    const openStudy = screen.getByRole("menuitem", { name: "Open this study in RadiAnt" }) as HTMLAnchorElement;
    expect(openStudy.getAttribute("href")).toBe("radiant:///?n=pstv&v=00080050&v=%22V2-000042%22");
    const openPatient = screen.getByRole("menuitem", { name: "Open patient studies in RadiAnt" }) as HTMLAnchorElement;
    expect(openPatient.getAttribute("href")).toBe("radiant:///?n=pstv&v=00100020&v=%22DICOM-PRIMARY-7%22");
    expect(openPatient.getAttribute("href")).not.toMatch(/MRN-7|%227%22/);
  });

  it("does not fall back to MRN or internal patient ID for patient viewer links", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, patientId: 7, patientMrn: "MRN-7", patientDicomId: null }],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" },
    });
    setNavigatorPlatform("Win32");
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));

    expect(screen.getByRole("menuitem", { name: "Open patient list in SonicDICOM" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Open patient studies in RadiAnt" }).hasAttribute("disabled")).toBe(true);
  });

  it("disables viewer actions when accession and patient identifiers are missing", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [{ ...caseRow, appointmentId: 43, accessionNumber: "", patientMrn: null, patientDicomId: null }],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" },
    });
    setNavigatorPlatform("Win32");
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("Alpha Patient").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /Open actions for/ }));

    expect(screen.getByRole("menuitem", { name: "Open this study in SonicDICOM" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Open patient list in SonicDICOM" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Open this study in RadiAnt" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Open patient studies in RadiAnt" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Copy accession number" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows discontinued action only to managers and requires a reason before submitting", async () => {
    renderPage();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark study as discontinued" }));

    expect(screen.getByRole("heading", { name: "Mark study as discontinued?" })).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Mark discontinued" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Reason for discontinuing this study"), { target: { value: "Completed by mistake" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(markReportingBoardCaseDiscontinuedMock).toHaveBeenCalledWith(42, { reason: "Completed by mistake" }));
    expect(await screen.findByText("Study marked as discontinued and removed from reporting pool.")).toBeTruthy();
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(2));
    await waitFor(() => expect(fetchReportingBoardStatsMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("does not show discontinued action to ordinary doctors", async () => {
    renderPage("/doctor/reporting-board", ordinaryDoctorMe);
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));

    const row = screen.getByText("V2-000042").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Open actions for V2-000042" }));

    expect(screen.queryByRole("menuitem", { name: "Mark study as discontinued" })).toBeNull();
    expect(screen.getByText("View appointment")).toBeTruthy();
  });

  it("uses a default board limit of 100", async () => {
    renderPage();

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 })));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 })));
  });

  it("renders board scope and omits noisy default active filters", async () => {
    renderPage();

    await screen.findByText("Board scope");
    expect(screen.getAllByText("Configured CT/MR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Required not final").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Yes").length).toBeGreaterThan(0);
    expect(screen.getByText("No additional user filters")).toBeTruthy();
    expect(screen.queryByText("Category:")).toBeNull();
    expect(screen.queryByText("Priority:")).toBeNull();
    expect(screen.queryByText("Search:")).toBeNull();
    expect(screen.queryByText("Case type:")).toBeNull();
    expect(screen.queryByText("Date to:")).toBeNull();
    expect(screen.queryByText("Assigned:")).toBeNull();
  });

  it("clears a removable chip and resets offset to zero", async () => {
    renderPage();

    await openSavedViews();
    fireEvent.click(await screen.findByRole("button", { name: "Urgent CT" }));
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ priorityCode: "urgent", offset: 50 })));
    fireEvent.click(await screen.findByRole("button", { name: "Clear filter: Priority" }));

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ priorityCode: null, offset: 0 })));
  });

  it("resets filters to the default CT/MR reporting board", async () => {
    renderPage();

    await screen.findByText("Reporting Assignment Board");
    fireEvent.change(screen.getByLabelText("Case type"), { target: { value: "comparisons" } });
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ caseSource: "comparisons" })));

    fireEvent.click(screen.getByRole("button", { name: "Reset to default board" }));

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({
      assignmentStatus: "all",
      reportStatus: "required_not_final",
      requiresReport: true,
      caseSource: "all",
      sortBy: "priority_study_date",
      sortDirection: "asc",
      pinUrgentToTop: true,
      limit: 100,
      offset: 0,
    })));
  });

  it("saves and loads caseSource through saved views", async () => {
    fetchReportingBoardSavedViewsMock.mockResolvedValue([
      { id: 12, ownerUserId: 10, ownerDoctorId: 1, name: "Comparisons only", token: "tok-12", filters: { caseSource: "comparisons" }, notificationSettings: {}, active: true, createdAt: "", updatedAt: "" },
    ]);
    renderPage();

    await openSavedViews();
    fireEvent.click(await screen.findByRole("button", { name: "Comparisons only" }));

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ caseSource: "comparisons" })));
  });

  it("includes caseSource when saving a new view", async () => {
    renderPage();
    await screen.findByText("Reporting Assignment Board");

    await openSavedViews();
    fireEvent.change(screen.getByLabelText("Case type"), { target: { value: "comparisons" } });
    fireEvent.change(screen.getByPlaceholderText("Saved view name"), { target: { value: "Comparison pool" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new view" }));

    await waitFor(() => expect(createReportingBoardSavedViewMock).toHaveBeenCalledWith(expect.objectContaining({
      name: "Comparison pool",
      filters: expect.objectContaining({ caseSource: "comparisons" }),
    })));
  });

  it("keeps previous rows visible while refresh is fetching", async () => {
    renderPage();
    expect(await screen.findByText("V2-000042")).toBeTruthy();

    fetchReportingBoardCasesMock.mockReturnValue(new Promise(() => undefined));
    fetchReportingBoardStatsMock.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByText("V2-000042")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/Refreshing/).length).toBeGreaterThan(0));
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

    await waitFor(() => {
      expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ priorityCode: "urgent" }));
    });
  });

  it("sends a test web push notification for the loaded saved view", async () => {
    fetchReportingBoardPushConfigMock.mockResolvedValue({ enabled: true, publicKey: "public-key" });
    renderPage();

    await openSavedViews();
    fireEvent.click(await screen.findByRole("button", { name: "Urgent CT" }));
    fireEvent.click(await screen.findByRole("button", { name: /Send test notification/i }));

    await waitFor(() => expect(sendReportingBoardSavedViewTestPushMock).toHaveBeenCalledWith(9));
    expect(await screen.findByText("Test notification sent.")).toBeTruthy();
  });

  it("generates QR links for the mobile read-only saved view route", async () => {
    renderPage();

    await openSavedViews();
    fireEvent.click(await screen.findByRole("button", { name: "Urgent CT" }));
    fireEvent.click(await screen.findByRole("button", { name: /Show mobile QR/i }));

    expect(await screen.findByText("Mobile read-only saved view")).toBeTruthy();
    expect(await screen.findByText(/\/reporting\/worklist\/tok-9/)).toBeTruthy();
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

  it("live-refreshes SonicDICOM before refetching the board without changing filters", async () => {
    renderPage();

    const search = await screen.findByPlaceholderText("Search MRN / accession / patient / exam");
    fireEvent.change(search, { target: { value: "MRN-7" } });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledWith(expect.objectContaining({ q: "MRN-7", offset: 0 })));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledWith(expect.objectContaining({ q: "MRN-7", offset: 0 })));

    const caseCallCount = fetchReportingBoardCasesMock.mock.calls.length;
    const statsCallCount = fetchReportingBoardStatsMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Refresh/i }));

    await waitFor(() => expect(refreshReportingBoardSonicDicomMock).toHaveBeenCalledWith(expect.objectContaining({ q: "MRN-7", offset: 0 })));
    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledTimes(caseCallCount + 1));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledTimes(statsCallCount + 1));
    expect((screen.getByPlaceholderText("Search MRN / accession / patient / exam") as HTMLInputElement).value).toBe("MRN-7");
    expect(screen.getByText(/Board refreshed:/)).toBeTruthy();
    expect(screen.queryByText(/Last refreshed:/)).toBeNull();
  });

  it("keeps Refresh unchanged and lets managers confirm one full report resync request", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    expect(await screen.findByRole("button", { name: "Refresh" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resync all reports" }));
    expect(confirm).toHaveBeenCalledWith("Recheck all completed cases requiring reports against SonicDICOM. This runs in the background and may take time.");
    expect(queueFullReportingBoardSonicDicomResyncMock).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Resync all reports" }));
    await waitFor(() => expect(queueFullReportingBoardSonicDicomResyncMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Full SonicDICOM resync queued for 1/)).toBeTruthy();
  });

  it("polls full resync progress through completion while keeping Refresh available", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    queueFullReportingBoardSonicDicomResyncMock.mockResolvedValue({ ok: true, queued: 10, requestedAt: "2026-08-23T10:00:00.000Z" });
    fetchFullReportingBoardSonicDicomResyncStatusMock
      .mockResolvedValueOnce({ ok: true, remaining: 7, failed: 1 })
      .mockRejectedValueOnce(new Error("status temporarily unavailable"))
      .mockResolvedValueOnce({ ok: true, remaining: 0, failed: 2 });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Resync all reports" }));
    await waitFor(() => expect(fetchFullReportingBoardSonicDicomResyncStatusMock).toHaveBeenCalledWith("2026-08-23T10:00:00.000Z"));
    expect(await screen.findByText("3 / 10")).toBeTruthy();
    expect(screen.getByText("7 remaining · 1 failed")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Resync all reports" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(false);

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_100)); });
    expect(await screen.findByText("Progress temporarily unavailable. Resync continues in the background.")).toBeTruthy();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_100)); });
    expect(await screen.findByText("SonicDICOM resync complete")).toBeTruthy();
    expect(screen.getByText("8 processed successfully · 2 failed")).toBeTruthy();
    const callsAtCompletion = fetchFullReportingBoardSonicDicomResyncStatusMock.mock.calls.length;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_100)); });
    expect(fetchFullReportingBoardSonicDicomResyncStatusMock).toHaveBeenCalledTimes(callsAtCompletion);
  }, 10_000);

  it("resumes stored full resync tracking after reload and clears it on completion", async () => {
    window.sessionStorage.setItem("rispro.reporting-board.sonicdicom-resync", JSON.stringify({ queued: 10, requestedAt: "2026-08-23T10:00:00.000Z" }));
    fetchFullReportingBoardSonicDicomResyncStatusMock.mockResolvedValue({ ok: true, remaining: 0, failed: 2 });
    renderPage();

    await waitFor(() => expect(fetchFullReportingBoardSonicDicomResyncStatusMock).toHaveBeenCalledWith("2026-08-23T10:00:00.000Z"));
    expect(await screen.findByText("SonicDICOM resync complete")).toBeTruthy();
    expect(screen.getByText("8 processed successfully · 2 failed")).toBeTruthy();
    expect(window.sessionStorage.getItem("rispro.reporting-board.sonicdicom-resync")).toBeNull();
  });

  it("does not show full report resync to non-managers", async () => {
    renderPage("/doctor/reporting-board", ordinaryDoctorMe);
    await screen.findByRole("button", { name: "Refresh" });
    expect(screen.queryByRole("button", { name: "Resync all reports" })).toBeNull();
  });

  it("clears an incomplete SonicDICOM refresh warning after a successful retry", async () => {
    refreshReportingBoardSonicDicomMock.mockRejectedValue(new Error("SonicDICOM unavailable"));
    renderPage();
    await screen.findByText("V2-000042");
    const caseCallCount = fetchReportingBoardCasesMock.mock.calls.length;
    const statsCallCount = fetchReportingBoardStatsMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(fetchReportingBoardCasesMock).toHaveBeenCalledTimes(caseCallCount + 1));
    await waitFor(() => expect(fetchReportingBoardStatsMock).toHaveBeenCalledTimes(statsCallCount + 1));
    expect(await screen.findByText("SonicDICOM refresh was incomplete; cached statuses are being shown.")).toBeTruthy();

    refreshReportingBoardSonicDicomMock.mockResolvedValue({ ok: true, checked: 1, successful: 1, failed: 0, checkedAt: "2026-08-19T10:00:00.000Z" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(refreshReportingBoardSonicDicomMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("SonicDICOM refresh was incomplete; cached statuses are being shown.")).toBeNull());
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
    fireEvent.click(screen.getByRole("button", { name: "Show metric details" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    let menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByRole("option", { name: "Return to waiting pool" })).toBeTruthy());

    const unassignedRow = screen.getByText("V2-000043").closest("tr")!;
    fireEvent.click(within(unassignedRow).getByRole("button", { name: "Open actions for V2-000043" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(screen.getAllByRole("menu").length).toBeGreaterThan(1));
    menu = screen.getAllByRole("menu").at(-1)!;
    expect(within(menu).queryByRole("option", { name: "Return to waiting pool" })).toBeNull();

    menu = screen.getAllByRole("menu")[0];
    fireEvent.change(within(menu).getByRole("combobox"), { target: { value: "__UNASSIGN__" } });
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
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByRole("combobox")).toBeTruthy());
    const combobox = within(menu).getByRole("combobox");
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

    await waitFor(() => expect(bulkUnassignSelectedReportingCasesMock).toHaveBeenCalledWith({ appointmentIds: [42], comparisonRequestIds: [], reason: "rebalance workload" }));
    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
    await waitFor(() => expect(fetchReportingBoardCasesMock.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(fetchReportingBoardStatsMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("selects comparison rows and sends comparison IDs to selected bulk actions", async () => {
    fetchReportingBoardCasesMock.mockResolvedValue({
      cases: [caseRow, comparisonRow],
      filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" },
    });
    bulkReassignSelectedReportingCasesMock.mockResolvedValue({
      requestedCount: 2,
      assignedCount: 2,
      skippedCount: 0,
      assignedAppointmentIds: [42],
      assignedComparisonRequestIds: [77],
      skipped: [],
    });
    renderPage();

    await screen.findByText("V2-000042");
    await screen.findByText("CMP-000077");
    fireEvent.click(screen.getByLabelText("Select case V2-000042"));
    fireEvent.click(screen.getByLabelText("Select case CMP-000077"));
    expect(await screen.findByText("2 selected")).toBeTruthy();
    expect((screen.getByLabelText("Select case CMP-000077") as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByLabelText("Reassign to"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Reason/note"), { target: { value: "mixed reporting queue" } });
    fireEvent.click(screen.getByRole("button", { name: "Reassign selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm reassignment" }));

    await waitFor(() => expect(bulkReassignSelectedReportingCasesMock).toHaveBeenCalledWith({
      appointmentIds: [42],
      comparisonRequestIds: [77],
      doctorId: 5,
      reason: "mixed reporting queue",
    }));
  });

  it("allows doctor supervisors to edit centrally managed Reporting Board defaults", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Board settings" }));
    expect(await screen.findByRole("button", { name: "Save settings" })).toBeTruthy();
    expect(screen.getByLabelText("Pin STAT/urgent first")).toBeTruthy();
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
