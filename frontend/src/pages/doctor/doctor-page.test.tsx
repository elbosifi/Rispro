import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DoctorPage from "./doctor-page";
import { LanguageProvider } from "@/providers/language-provider";
import type { DoctorMe } from "@/types/api";

const fetchDoctorMeMock = vi.fn();
const fetchMyDoctorRosterMock = vi.fn();
const fetchDoctorRosterWeekMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchRosterDoctorsMock = vi.fn();
const fetchRosterDutyTypesMock = vi.fn();
const saveRosterDutyTypeMock = vi.fn();
const fetchRosterShiftImportMappingsMock = vi.fn();
const saveRosterShiftImportMappingMock = vi.fn();
const previewRosterXmlImportMock = vi.fn();
const confirmRosterXmlImportMock = vi.fn();
const fetchMyDoctorCasesMock = vi.fn();
const fetchTeamDoctorCasesMock = vi.fn();
const fetchUnassignedDoctorCasesMock = vi.fn();
const runDoctorCaseAssignmentMock = vi.fn();
const assignDoctorCaseMock = vi.fn();
const reassignDoctorCaseMock = vi.fn();
const fetchProtocolTasksMock = vi.fn();
const fetchProtocolDetailsMock = vi.fn();
const fetchProtocolAuditMock = vi.fn();
const saveProtocolDraftMock = vi.fn();
const assignProtocolMock = vi.fn();
const requestProtocolClarificationMock = vi.fn();
const cancelProtocolMock = vi.fn();
const fetchTeamWorkloadSummaryMock = vi.fn();
const runWorkloadCalculationMock = vi.fn();
const fetchWorkloadCatalogMock = vi.fn();
const createWorkloadCatalogRuleMock = vi.fn();
const updateWorkloadCatalogRuleMock = vi.fn();
const deactivateWorkloadCatalogRuleMock = vi.fn();
const fetchRosterWeekConflictsMock = vi.fn();
const fetchMyDoctorAvailabilityMock = vi.fn();
const fetchTeamDoctorAvailabilityMock = vi.fn();
const createMyDoctorAvailabilityMock = vi.fn();
const createTeamDoctorAvailabilityMock = vi.fn();
const fetchMyDoctorLeaveMock = vi.fn();
const fetchTeamDoctorLeaveMock = vi.fn();
const createMyDoctorLeaveMock = vi.fn();
const updateDoctorLeaveStatusMock = vi.fn();
const fetchRosterTemplatesMock = vi.fn();
const createRosterTemplateMock = vi.fn();
const applyRosterTemplateMock = vi.fn();
const generateDoctorRosterDraftMock = vi.fn();
const notifyDoctorRosterWeekMock = vi.fn();
const fetchDoctorProfilesForAdminMock = vi.fn();
const fetchUsersMock = vi.fn();
const fetchDoctorProfileModalitiesMock = vi.fn();
const createDoctorWithUserForAdminMock = vi.fn();
const createDoctorProfileForAdminMock = vi.fn();
const updateDoctorProfileForAdminMock = vi.fn();
const updateDoctorProfileModalitiesMock = vi.fn();
const resetDoctorUserTemporaryPasswordMock = vi.fn();
const forceDoctorUserPasswordChangeMock = vi.fn();
const setDoctorUserActiveMock = vi.fn();
const inspectDoctorImportMock = vi.fn();
const previewDoctorImportMock = vi.fn();
const confirmDoctorImportMock = vi.fn();
const fetchReportingBoardSettingsMock = vi.fn();
const updateReportingBoardSettingsMock = vi.fn();
const fetchReportingBoardCasesMock = vi.fn();
const fetchReportingBoardSavedViewsMock = vi.fn();
const createReportingBoardSavedViewMock = vi.fn();
const updateReportingBoardSavedViewMock = vi.fn();
const fetchReportingBoardSavedViewByTokenMock = vi.fn();
const fetchReportingBoardPushConfigMock = vi.fn();
const subscribeReportingBoardSavedViewPushMock = vi.fn();
const bulkAssignNextReportingCasesMock = vi.fn();
const fetchReportingBoardNotificationsMock = vi.fn();
const markReportingBoardNotificationReadMock = vi.fn();
const dismissReportingBoardNotificationMock = vi.fn();
const markAllReportingBoardNotificationsReadMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorMe: () => fetchDoctorMeMock(),
  fetchMyDoctorRoster: (...args: unknown[]) => fetchMyDoctorRosterMock(...args),
  fetchDoctorRosterWeek: (...args: unknown[]) => fetchDoctorRosterWeekMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchRosterDoctors: (...args: unknown[]) => fetchRosterDoctorsMock(...args),
  fetchRosterDutyTypes: (...args: unknown[]) => fetchRosterDutyTypesMock(...args),
  saveRosterDutyType: (...args: unknown[]) => saveRosterDutyTypeMock(...args),
  fetchRosterShiftImportMappings: (...args: unknown[]) => fetchRosterShiftImportMappingsMock(...args),
  saveRosterShiftImportMapping: (...args: unknown[]) => saveRosterShiftImportMappingMock(...args),
  previewRosterXmlImport: (...args: unknown[]) => previewRosterXmlImportMock(...args),
  confirmRosterXmlImport: (...args: unknown[]) => confirmRosterXmlImportMock(...args),
  fetchMyDoctorCases: (...args: unknown[]) => fetchMyDoctorCasesMock(...args),
  fetchTeamDoctorCases: (...args: unknown[]) => fetchTeamDoctorCasesMock(...args),
  fetchUnassignedDoctorCases: (...args: unknown[]) => fetchUnassignedDoctorCasesMock(...args),
  runDoctorCaseAssignment: (...args: unknown[]) => runDoctorCaseAssignmentMock(...args),
  assignDoctorCase: (...args: unknown[]) => assignDoctorCaseMock(...args),
  reassignDoctorCase: (...args: unknown[]) => reassignDoctorCaseMock(...args),
  fetchProtocolTasks: (...args: unknown[]) => fetchProtocolTasksMock(...args),
  fetchProtocolDetails: (...args: unknown[]) => fetchProtocolDetailsMock(...args),
  fetchProtocolAudit: (...args: unknown[]) => fetchProtocolAuditMock(...args),
  saveProtocolDraft: (...args: unknown[]) => saveProtocolDraftMock(...args),
  assignProtocol: (...args: unknown[]) => assignProtocolMock(...args),
  requestProtocolClarification: (...args: unknown[]) => requestProtocolClarificationMock(...args),
  cancelProtocol: (...args: unknown[]) => cancelProtocolMock(...args),
  fetchTeamWorkloadSummary: (...args: unknown[]) => fetchTeamWorkloadSummaryMock(...args),
  runWorkloadCalculation: (...args: unknown[]) => runWorkloadCalculationMock(...args),
  fetchWorkloadCatalog: (...args: unknown[]) => fetchWorkloadCatalogMock(...args),
  createWorkloadCatalogRule: (...args: unknown[]) => createWorkloadCatalogRuleMock(...args),
  updateWorkloadCatalogRule: (...args: unknown[]) => updateWorkloadCatalogRuleMock(...args),
  deactivateWorkloadCatalogRule: (...args: unknown[]) => deactivateWorkloadCatalogRuleMock(...args),
  fetchRosterWeekConflicts: (...args: unknown[]) => fetchRosterWeekConflictsMock(...args),
  fetchMyDoctorAvailability: (...args: unknown[]) => fetchMyDoctorAvailabilityMock(...args),
  fetchTeamDoctorAvailability: (...args: unknown[]) => fetchTeamDoctorAvailabilityMock(...args),
  createMyDoctorAvailability: (...args: unknown[]) => createMyDoctorAvailabilityMock(...args),
  createTeamDoctorAvailability: (...args: unknown[]) => createTeamDoctorAvailabilityMock(...args),
  fetchMyDoctorLeave: (...args: unknown[]) => fetchMyDoctorLeaveMock(...args),
  fetchTeamDoctorLeave: (...args: unknown[]) => fetchTeamDoctorLeaveMock(...args),
  createMyDoctorLeave: (...args: unknown[]) => createMyDoctorLeaveMock(...args),
  updateDoctorLeaveStatus: (...args: unknown[]) => updateDoctorLeaveStatusMock(...args),
  fetchRosterTemplates: (...args: unknown[]) => fetchRosterTemplatesMock(...args),
  createRosterTemplate: (...args: unknown[]) => createRosterTemplateMock(...args),
  applyRosterTemplate: (...args: unknown[]) => applyRosterTemplateMock(...args),
  generateDoctorRosterDraft: (...args: unknown[]) => generateDoctorRosterDraftMock(...args),
  notifyDoctorRosterWeek: (...args: unknown[]) => notifyDoctorRosterWeekMock(...args),
  fetchDoctorProfilesForAdmin: (...args: unknown[]) => fetchDoctorProfilesForAdminMock(...args),
  fetchUsers: (...args: unknown[]) => fetchUsersMock(...args),
  fetchDoctorProfileModalities: (...args: unknown[]) => fetchDoctorProfileModalitiesMock(...args),
  createDoctorWithUserForAdmin: (...args: unknown[]) => createDoctorWithUserForAdminMock(...args),
  createDoctorProfileForAdmin: (...args: unknown[]) => createDoctorProfileForAdminMock(...args),
  updateDoctorProfileForAdmin: (...args: unknown[]) => updateDoctorProfileForAdminMock(...args),
  updateDoctorProfileModalities: (...args: unknown[]) => updateDoctorProfileModalitiesMock(...args),
  resetDoctorUserTemporaryPassword: (...args: unknown[]) => resetDoctorUserTemporaryPasswordMock(...args),
  forceDoctorUserPasswordChange: (...args: unknown[]) => forceDoctorUserPasswordChangeMock(...args),
  setDoctorUserActive: (...args: unknown[]) => setDoctorUserActiveMock(...args),
  inspectDoctorImport: (...args: unknown[]) => inspectDoctorImportMock(...args),
  previewDoctorImport: (...args: unknown[]) => previewDoctorImportMock(...args),
  confirmDoctorImport: (...args: unknown[]) => confirmDoctorImportMock(...args),
  fetchReportingBoardSettings: (...args: unknown[]) => fetchReportingBoardSettingsMock(...args),
  updateReportingBoardSettings: (...args: unknown[]) => updateReportingBoardSettingsMock(...args),
  fetchReportingBoardCases: (...args: unknown[]) => fetchReportingBoardCasesMock(...args),
  fetchReportingBoardSavedViews: (...args: unknown[]) => fetchReportingBoardSavedViewsMock(...args),
  createReportingBoardSavedView: (...args: unknown[]) => createReportingBoardSavedViewMock(...args),
  updateReportingBoardSavedView: (...args: unknown[]) => updateReportingBoardSavedViewMock(...args),
  fetchReportingBoardSavedViewByToken: (...args: unknown[]) => fetchReportingBoardSavedViewByTokenMock(...args),
  fetchReportingBoardPushConfig: (...args: unknown[]) => fetchReportingBoardPushConfigMock(...args),
  subscribeReportingBoardSavedViewPush: (...args: unknown[]) => subscribeReportingBoardSavedViewPushMock(...args),
  bulkAssignNextReportingCases: (...args: unknown[]) => bulkAssignNextReportingCasesMock(...args),
  fetchReportingBoardNotifications: (...args: unknown[]) => fetchReportingBoardNotificationsMock(...args),
  markReportingBoardNotificationRead: (...args: unknown[]) => markReportingBoardNotificationReadMock(...args),
  dismissReportingBoardNotification: (...args: unknown[]) => dismissReportingBoardNotificationMock(...args),
  markAllReportingBoardNotificationsRead: (...args: unknown[]) => markAllReportingBoardNotificationsReadMock(...args),
  createDoctorRosterWeek: vi.fn(),
  copyPreviousDoctorRosterWeek: vi.fn(),
  publishDoctorRosterWeek: vi.fn(),
  createDoctorRosterAssignment: vi.fn(),
  deleteDoctorRosterAssignment: vi.fn(),
  addDoctorRosterMember: vi.fn(),
  deleteDoctorRosterMember: vi.fn(),
}));

function CorePlaceholder() {
  const location = useLocation();
  return <div data-testid="core-page">{location.pathname}</div>;
}

const normalDoctor: DoctorMe = {
  hasActiveDoctorProfile: true,
  canAccessClinicalDoctorPortal: true,
  profile: {
    id: 1,
    userId: 10,
    displayName: "Dr Normal",
    doctorRole: "specialist",
    active: true,
    canFinalizeReports: false,
    canAssignProtocols: true,
    canSupervise: false,
  },
  doctorRole: "specialist",
  canFinalizeReports: false,
  canAssignProtocols: true,
  canSupervise: false,
  allowedModalities: [],
  moduleCapabilities: ["doctor"],
  canAccessCoreWorkspace: true,
};

function renderDoctorPortal(initialPath = "/doctor") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<CorePlaceholder />} />
            <Route path="/dashboard" element={<CorePlaceholder />} />
            <Route path="/doctor/*" element={<DoctorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("Doctor Portal shell", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    fetchDoctorMeMock.mockReset();
    fetchMyDoctorRosterMock.mockReset();
    fetchDoctorRosterWeekMock.mockReset();
    fetchAppointmentLookupsMock.mockReset();
    fetchRosterDoctorsMock.mockReset();
    fetchRosterDutyTypesMock.mockReset();
    saveRosterDutyTypeMock.mockReset();
    fetchRosterShiftImportMappingsMock.mockReset();
    saveRosterShiftImportMappingMock.mockReset();
    previewRosterXmlImportMock.mockReset();
    confirmRosterXmlImportMock.mockReset();
    fetchMyDoctorCasesMock.mockReset();
    fetchTeamDoctorCasesMock.mockReset();
    fetchUnassignedDoctorCasesMock.mockReset();
    runDoctorCaseAssignmentMock.mockReset();
    assignDoctorCaseMock.mockReset();
    reassignDoctorCaseMock.mockReset();
    fetchProtocolTasksMock.mockReset();
    fetchProtocolDetailsMock.mockReset();
    fetchProtocolAuditMock.mockReset();
    saveProtocolDraftMock.mockReset();
    assignProtocolMock.mockReset();
    requestProtocolClarificationMock.mockReset();
    cancelProtocolMock.mockReset();
    fetchTeamWorkloadSummaryMock.mockReset();
    runWorkloadCalculationMock.mockReset();
    fetchWorkloadCatalogMock.mockReset();
    createWorkloadCatalogRuleMock.mockReset();
    updateWorkloadCatalogRuleMock.mockReset();
    deactivateWorkloadCatalogRuleMock.mockReset();
    fetchRosterWeekConflictsMock.mockReset();
    fetchMyDoctorAvailabilityMock.mockReset();
    fetchTeamDoctorAvailabilityMock.mockReset();
    createMyDoctorAvailabilityMock.mockReset();
    createTeamDoctorAvailabilityMock.mockReset();
    fetchMyDoctorLeaveMock.mockReset();
    fetchTeamDoctorLeaveMock.mockReset();
    createMyDoctorLeaveMock.mockReset();
    updateDoctorLeaveStatusMock.mockReset();
    fetchRosterTemplatesMock.mockReset();
    createRosterTemplateMock.mockReset();
    applyRosterTemplateMock.mockReset();
    generateDoctorRosterDraftMock.mockReset();
    notifyDoctorRosterWeekMock.mockReset();
    fetchDoctorProfilesForAdminMock.mockReset();
    fetchUsersMock.mockReset();
    fetchDoctorProfileModalitiesMock.mockReset();
    createDoctorWithUserForAdminMock.mockReset();
    createDoctorProfileForAdminMock.mockReset();
    updateDoctorProfileForAdminMock.mockReset();
    updateDoctorProfileModalitiesMock.mockReset();
    resetDoctorUserTemporaryPasswordMock.mockReset();
    forceDoctorUserPasswordChangeMock.mockReset();
    setDoctorUserActiveMock.mockReset();
    inspectDoctorImportMock.mockReset();
    previewDoctorImportMock.mockReset();
    confirmDoctorImportMock.mockReset();
    fetchReportingBoardSettingsMock.mockReset();
    updateReportingBoardSettingsMock.mockReset();
    fetchReportingBoardCasesMock.mockReset();
    fetchReportingBoardSavedViewsMock.mockReset();
    createReportingBoardSavedViewMock.mockReset();
    updateReportingBoardSavedViewMock.mockReset();
    fetchReportingBoardSavedViewByTokenMock.mockReset();
    fetchReportingBoardPushConfigMock.mockReset();
    subscribeReportingBoardSavedViewPushMock.mockReset();
    bulkAssignNextReportingCasesMock.mockReset();
    fetchReportingBoardNotificationsMock.mockReset();
    markReportingBoardNotificationReadMock.mockReset();
    dismissReportingBoardNotificationMock.mockReset();
    markAllReportingBoardNotificationsReadMock.mockReset();
    fetchMyDoctorRosterMock.mockResolvedValue({ week: null, assignments: [] });
    fetchDoctorRosterWeekMock.mockResolvedValue({ week: null, assignments: [] });
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [], examTypes: [] });
    fetchRosterDoctorsMock.mockResolvedValue([]);
    fetchRosterDutyTypesMock.mockResolvedValue([{ code: "configured_reporting_duty", label: "Configured reporting duty", active: true, requiresSpecialist: false, sortOrder: 0 }]);
    saveRosterDutyTypeMock.mockResolvedValue({ code: "configured_reporting_duty", label: "Configured reporting duty", active: true, requiresSpecialist: false, sortOrder: 0 });
    fetchRosterShiftImportMappingsMock.mockResolvedValue([]);
    saveRosterShiftImportMappingMock.mockResolvedValue({ id: 1, sourceSystem: "abc", sourceShiftName: "Day", sourceShiftType: null, sourceShiftAbbreviation: null, dutyTypeCode: "configured_reporting_duty", modalityId: null, modalityName: null, teamName: null, active: true });
    previewRosterXmlImportMock.mockResolvedValue({ doctorsMatched: [], doctorsToCreate: [], dutySlotsToCreate: [], unmappedShiftTypes: [], warnings: [], canConfirm: true });
    confirmRosterXmlImportMock.mockResolvedValue({ createdDoctors: [], importedDutySlotCount: 0, message: "Imported" });
    fetchMyDoctorCasesMock.mockResolvedValue([]);
    fetchTeamDoctorCasesMock.mockResolvedValue([]);
    fetchUnassignedDoctorCasesMock.mockResolvedValue([]);
    runDoctorCaseAssignmentMock.mockResolvedValue({
      assignedCount: 0,
      alreadyAssignedCount: 0,
      unassignedNoRosterCount: 0,
      skippedCancelledCount: 0,
      errors: [],
    });
    assignDoctorCaseMock.mockResolvedValue({ assignmentId: 100 });
    reassignDoctorCaseMock.mockResolvedValue({ assignmentId: 99 });
    fetchProtocolTasksMock.mockResolvedValue([]);
    fetchProtocolAuditMock.mockResolvedValue([]);
    fetchProtocolDetailsMock.mockResolvedValue({
      appointment: {
        appointmentId: 77,
        patientId: 5,
        patientMrn: "MRN-5",
        patientNationalId: "NID-5",
        patientArabicName: "Arabic Name",
        patientEnglishName: "Protocol Patient",
        ageYears: 42,
        sex: "F",
        appointmentDate: "2027-01-04",
        appointmentTime: "09:00",
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 2,
        examTypeName: "CT Brain",
        caseCategory: "oncology",
        requiresReport: true,
        clinicalIndication: "Headache",
        appointmentStatus: "scheduled",
        rosterAssignmentId: 9,
        teamName: "CT Team",
        protocolStatus: null,
        assignedByDoctorName: null,
        updatedAt: null,
      },
      protocol: null,
    });
    saveProtocolDraftMock.mockResolvedValue({});
    assignProtocolMock.mockResolvedValue({});
    requestProtocolClarificationMock.mockResolvedValue({});
    cancelProtocolMock.mockResolvedValue({});
    fetchTeamWorkloadSummaryMock.mockResolvedValue([]);
    runWorkloadCalculationMock.mockResolvedValue({
      calculatedCount: 0,
      alreadyCurrentCount: 0,
      defaultedNoCatalogRuleCount: 0,
      skippedCount: 0,
      errors: [],
    });
    fetchWorkloadCatalogMock.mockResolvedValue([]);
    createWorkloadCatalogRuleMock.mockResolvedValue({});
    updateWorkloadCatalogRuleMock.mockResolvedValue({});
    deactivateWorkloadCatalogRuleMock.mockResolvedValue({});
    fetchRosterWeekConflictsMock.mockResolvedValue([]);
    fetchMyDoctorAvailabilityMock.mockResolvedValue([]);
    fetchTeamDoctorAvailabilityMock.mockResolvedValue([]);
    createMyDoctorAvailabilityMock.mockResolvedValue({});
    createTeamDoctorAvailabilityMock.mockResolvedValue({});
    fetchMyDoctorLeaveMock.mockResolvedValue([]);
    fetchTeamDoctorLeaveMock.mockResolvedValue([]);
    createMyDoctorLeaveMock.mockResolvedValue({});
    updateDoctorLeaveStatusMock.mockResolvedValue({});
    fetchRosterTemplatesMock.mockResolvedValue([]);
    createRosterTemplateMock.mockResolvedValue({});
    applyRosterTemplateMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      createdAssignmentCount: 1,
      copiedMemberCount: 0,
      skippedCount: 0,
      conflicts: [],
    });
    generateDoctorRosterDraftMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignmentsCreated: 1,
      membersAssigned: 0,
      conflicts: [],
      unfilledRequirements: [],
      warnings: [],
    });
    notifyDoctorRosterWeekMock.mockResolvedValue({ createdCount: 1, alreadyExistingCount: 0, notifications: [] });
    fetchDoctorProfilesForAdminMock.mockResolvedValue([]);
    fetchUsersMock.mockResolvedValue({ users: [] });
    fetchDoctorProfileModalitiesMock.mockResolvedValue([]);
    createDoctorWithUserForAdminMock.mockResolvedValue({ user: {}, profile: {}, modalities: [] });
    createDoctorProfileForAdminMock.mockResolvedValue({});
    updateDoctorProfileForAdminMock.mockResolvedValue({});
    updateDoctorProfileModalitiesMock.mockResolvedValue([]);
    resetDoctorUserTemporaryPasswordMock.mockResolvedValue({});
    forceDoctorUserPasswordChangeMock.mockResolvedValue({});
    setDoctorUserActiveMock.mockResolvedValue({});
    inspectDoctorImportMock.mockResolvedValue({ workbook: { format: "csv", columns: [], requiredColumns: [], rowCount: 0, missingColumns: [] } });
    previewDoctorImportMock.mockResolvedValue({ rows: [], canConfirm: false });
    confirmDoctorImportMock.mockResolvedValue({
      createdUsers: 0,
      updatedUsers: 0,
      createdProfiles: 0,
      updatedProfiles: 0,
      disabledProfiles: 0,
      modalityPermissionsUpdated: 0,
      skippedRows: 0,
      failedRows: [],
    });
    fetchReportingBoardSettingsMock.mockResolvedValue({
      cutoffMode: "days_back",
      defaultCutoffDate: null,
      daysBack: 14,
      enabledModalityCodes: ["CT", "MR"],
      defaultRequiresReport: true,
      defaultReportStatusFilter: "required_not_final",
    });
    updateReportingBoardSettingsMock.mockResolvedValue({});
    fetchReportingBoardCasesMock.mockResolvedValue({ cases: [], filters: { dateFrom: "2026-05-15", cutoffDate: "2026-05-15", reportStatus: "required_not_final" } });
    fetchReportingBoardSavedViewsMock.mockResolvedValue([]);
    createReportingBoardSavedViewMock.mockResolvedValue({ id: 1, name: "CT urgent", token: "tok", filters: {}, notificationSettings: {}, active: true });
    updateReportingBoardSavedViewMock.mockResolvedValue({ id: 1, name: "CT urgent", token: "tok", filters: {}, notificationSettings: {}, active: true });
    fetchReportingBoardSavedViewByTokenMock.mockResolvedValue({ id: 1, name: "CT urgent", token: "tok", filters: { priorityCode: "urgent" }, notificationSettings: {}, active: true });
    fetchReportingBoardPushConfigMock.mockResolvedValue({ enabled: false, publicKey: null });
    subscribeReportingBoardSavedViewPushMock.mockResolvedValue({ subscriptionId: 1 });
    bulkAssignNextReportingCasesMock.mockResolvedValue({ requestedCount: 2, assignedCount: 2, skippedCount: 0, assignedAppointmentIds: [1, 2], skipped: [] });
    fetchReportingBoardNotificationsMock.mockResolvedValue([]);
    markReportingBoardNotificationReadMock.mockResolvedValue({});
    dismissReportingBoardNotificationMock.mockResolvedValue({});
    markAllReportingBoardNotificationsReadMock.mockResolvedValue({ count: 0 });
  });

  it("allows an active doctor to access /doctor", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal();

    expect(await screen.findByRole("heading", { name: "Doctor Portal" })).toBeTruthy();
    expect(await screen.findByText("Dr Normal")).toBeTruthy();
    expect(screen.getByRole("button", { name: /My Work/i })).toBeTruthy();
  });

  it("redirects a non-doctor away from /doctor", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      hasActiveDoctorProfile: false,
      profile: null,
      doctorRole: null,
      moduleCapabilities: [],
    });

    renderDoctorPortal();

    await waitFor(() => {
      expect(screen.getByTestId("core-page").textContent).toBe("/");
    });
  });

  it("shows management menu items to doctor supervisors", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      canAccessDoctorAdmin: true,
      canManageDoctorProfiles: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });

    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByRole("button", { name: /Roster Planner/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Today’s Cases/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Doctors Directory/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Advanced Setup/i })).toBeTruthy();
  });

  it("does not show management menu items to normal doctors", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByRole("button", { name: /My Work/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Today’s Cases/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Doctors Directory/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Advanced Setup/i })).toBeNull();
  });

  it("My Work shows Availability and Protocols shortcuts for clinical doctors", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/my-work");

    expect((await screen.findByRole("link", { name: /Availability/i })).getAttribute("href")).toBe("/doctor/availability");
    expect(screen.getByRole("link", { name: /Protocols/i }).getAttribute("href")).toBe("/doctor/protocols");
    expect(screen.getByRole("link", { name: /My Roster/i }).getAttribute("href")).toBe("/doctor/roster");
    expect(screen.getByRole("link", { name: /My Cases/i }).getAttribute("href")).toBe("/doctor/today-cases");
  });

  it("Advanced Setup landing shows setup cards for supervisors and admins", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      canAccessDoctorAdmin: true,
      canManageDoctorProfiles: true,
      moduleCapabilities: ["doctor", "doctor_supervisor", "doctor_admin"],
    });
    renderDoctorPortal("/doctor/advanced-setup");

    expect(await screen.findByRole("heading", { name: "Advanced Setup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Roster setup/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Doctor import\/export/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Workload setup/i }).getAttribute("href")).toBe("/doctor/team-workload");
    expect(screen.queryByText("Doctor CSV/XLSX import and export")).toBeNull();
  });

  it("Advanced Setup exposes doctor import/export after selecting Doctor import/export", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      canAccessDoctorAdmin: true,
      canManageDoctorProfiles: true,
      moduleCapabilities: ["doctor", "doctor_supervisor", "doctor_admin"],
    });
    renderDoctorPortal("/doctor/advanced-setup");

    fireEvent.click(await screen.findByRole("button", { name: /Doctor import\/export/i }));
    expect(await screen.findByText("Doctor CSV/XLSX import and export")).toBeTruthy();
    expect(screen.getByText("Download CSV template")).toBeTruthy();
    expect(screen.getByText("Download XLSX template")).toBeTruthy();
    expect(screen.getByText("Export CSV")).toBeTruthy();
    expect(screen.getByText("Export XLSX")).toBeTruthy();
    expect(screen.getByText("Import CSV/XLSX")).toBeTruthy();
  });

  it("normal doctors do not see admin-only Advanced Setup cards", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/advanced-setup");

    expect(await screen.findByText("Dr Normal")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Workload setup/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Roster setup/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Doctor import\/export/i })).toBeNull();
  });

  it("lets profileless admins manage doctors without clinical navigation", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      hasActiveDoctorProfile: false,
      canAccessClinicalDoctorPortal: false,
      canAccessDoctorPortal: true,
      canAccessDoctorAdmin: true,
      canManageDoctorProfiles: true,
      profile: null,
      doctorRole: null,
      canFinalizeReports: false,
      canAssignProtocols: false,
      canSupervise: false,
      allowedModalities: [],
      moduleCapabilities: [],
    });
    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByText("Doctor Portal admin")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Doctors Directory/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Advanced Setup/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Roster Planner/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Today’s Cases/i })).toBeNull();
  });

  it("redirects profileless admins away from clinical routes", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      hasActiveDoctorProfile: false,
      canAccessClinicalDoctorPortal: false,
      canAccessDoctorPortal: true,
      canAccessDoctorAdmin: true,
      canManageDoctorProfiles: true,
      profile: null,
      doctorRole: null,
      canFinalizeReports: false,
      canAssignProtocols: false,
      canSupervise: false,
      allowedModalities: [],
      moduleCapabilities: [],
    });
    renderDoctorPortal("/doctor/roster");

    expect(await screen.findByText("Doctor Portal admin")).toBeTruthy();
    expect(screen.queryByText("No roster assignments for this week.")).toBeNull();
  });

  it("does not render appointment editing or rescheduling controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByText("Dr Normal")).toBeTruthy();
    expect(screen.queryByTestId("appointment-editor")).toBeNull();
    expect(screen.queryByRole("button", { name: /Print/i })).toBeNull();
    expect(screen.queryByText(/reschedule/i)).toBeNull();
  });

  it("normal doctor sees My Roster empty state without management controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/roster");

    expect((await screen.findAllByText("My Roster")).length).toBeGreaterThan(0);
    expect(await screen.findByText("No roster assignments for this week.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create draft week/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish week/i })).toBeNull();
  });

  it("doctor supervisor sees roster management controls", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/admin/roster");

    expect((await screen.findAllByText("Roster Management")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Create draft week/i }).length).toBeGreaterThan(0);
    expect(screen.getByText("No roster week exists for selected week.")).toBeTruthy();
  });

  it("draft empty roster shows empty-state guidance and create assignment path", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/roster-planner");

    expect(await screen.findAllByText("No assignments yet")).toHaveLength(2);
    expect(screen.getAllByText("Create an assignment, then drag doctors into it.").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Copy previous week/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open Advanced Setup/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Create assignment/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText("No roster assignments for this week.")).toBeNull();
  });

  it("create assignment panel opens clearly and keeps date inside selected week", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/roster-planner");

    const weekInput = (await screen.findByLabelText("Week start")) as HTMLInputElement;
    const expectedNextWeek = new Date(`${weekInput.value}T00:00:00Z`);
    expectedNextWeek.setUTCDate(expectedNextWeek.getUTCDate() + 7);
    fireEvent.click((await screen.findAllByRole("button", { name: /Create assignment/i }))[0]);
    expect(screen.getByRole("heading", { name: /Create assignment/i })).toBeTruthy();
    expect(screen.getByText("This creates the card doctors can be dragged into.")).toBeTruthy();
    expect((screen.getByLabelText("Assignment date") as HTMLInputElement).value).toBe(weekInput.value);

    fireEvent.click(screen.getByRole("button", { name: /Next week/i }));
    expect(((await screen.findByLabelText("Assignment date")) as HTMLInputElement).value).toBe(expectedNextWeek.toISOString().slice(0, 10));
  });

  it("published empty roster explains that the week is read-only", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "published",
        createdBy: 1,
        publishedBy: 1,
        publishedAt: "2027-01-01",
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/roster-planner");

    expect(await screen.findByText("This roster week is published but has no assignments. Published weeks are read-only.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Advanced Setup/i })).toBeTruthy();
    expect(screen.queryByText("Create assignment")).toBeNull();
    expect(screen.queryByText("Add team member")).toBeNull();
  });

  it("publish action is visible only for supervisor draft roster", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/admin/roster");

    expect(await screen.findByRole("button", { name: /Publish week/i })).toBeTruthy();
  });

  it("availability page renders and doctor can add unavailable day", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/availability");

    expect(await screen.findByRole("heading", { name: /Doctor availability and leave/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add unavailable day/i }));

    await waitFor(() => {
      expect(createMyDoctorAvailabilityMock).toHaveBeenCalled();
    });
  });

  it("supervisor sees team availability", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    fetchTeamDoctorAvailabilityMock.mockResolvedValue([
      { id: 1, doctorId: 2, doctorName: "Dr Team", date: "2027-01-04", startTime: null, endTime: null, availabilityStatus: "unavailable", note: null },
    ]);
    renderDoctorPortal("/doctor/availability");

    expect(await screen.findByText("Team availability")).toBeTruthy();
    expect(await screen.findByText(/Dr Team/)).toBeTruthy();
  });

  it("supervisor Roster Planner keeps daily roster controls and hides advanced tools by default", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [
        {
          id: 44,
          rosterWeekId: 99,
          date: "2027-01-04",
          modalityId: 1,
          modalityCode: "CT",
          modalityNameEn: "CT",
          modalityNameAr: "CT",
          dutyType: "ct_protocol_day",
          sessionName: "day",
          startTime: "08:00",
          endTime: "14:00",
          teamName: "CT Team",
          status: "active",
          members: [],
        },
      ],
    });
    fetchRosterDoctorsMock.mockResolvedValue([{ ...normalDoctor.profile!, id: 7, displayName: "Dr Conflict" }]);
    fetchRosterWeekConflictsMock.mockResolvedValue([
      { assignmentId: 44, memberId: null, doctorId: 7, severity: "error", code: "required_team_empty", message: "Published roster has an empty required team slot." },
    ]);
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/roster-planner");

    expect(await screen.findByRole("button", { name: /Copy previous week/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Publish week/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Create assignment$/i })).toBeTruthy();
    expect(screen.getByText("Assignments")).toBeTruthy();
    expect(screen.getByText("Drag a doctor onto an assignment card.")).toBeTruthy();
    expect(await screen.findByText("Drop doctor here")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Delete/i })).toBeTruthy();
    expect((await screen.findAllByText(/This assignment needs a specialist before publishing/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Published roster has an empty required team slot/)).toBeNull();
    expect(screen.getByRole("button", { name: /Manual add/i })).toBeTruthy();
    expect(screen.queryByText("No roster assignments for this week.")).toBeNull();
    expect(screen.queryByText("Add team member")).toBeNull();
    expect(screen.queryByText("Roster duty types")).toBeNull();
    expect(screen.queryByText("Import roster from ABC export")).toBeNull();
    expect(screen.queryByText("Roster templates")).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate draft roster/i })).toBeNull();
    expect(screen.queryByText("Export HTML")).toBeNull();
    expect(screen.queryByText("Export CSV")).toBeNull();
  });

  it("normal doctor does not see template management", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/roster");

    expect(await screen.findByText("No roster assignments for this week.")).toBeTruthy();
    expect(screen.queryByText("Roster templates")).toBeNull();
  });

  it("supervisor Roster Planner does not show notify or export for published roster by default", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "published",
        createdBy: 1,
        publishedBy: 1,
        publishedAt: "2027-01-01",
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/roster-planner");

    expect(await screen.findByText("Published")).toBeTruthy();
    expect(screen.getByText("This roster week is published but has no assignments. Published weeks are read-only.")).toBeTruthy();
    expect(screen.queryByText("Create assignment")).toBeNull();
    expect(screen.queryByText("Add team member")).toBeNull();
    expect(screen.queryByRole("button", { name: /Notify assigned doctors/i })).toBeNull();
    expect(screen.queryByText("Export HTML")).toBeNull();
    expect(screen.queryByText("Export CSV")).toBeNull();
  });

  it("published roster with assignments shows read-only cards", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "published",
        createdBy: 1,
        publishedBy: 1,
        publishedAt: "2027-01-01",
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [
        {
          id: 44,
          rosterWeekId: 99,
          date: "2027-01-04",
          modalityId: 1,
          modalityCode: "CT",
          modalityNameEn: "CT",
          modalityNameAr: "CT",
          dutyType: "configured_reporting_duty",
          sessionName: "day",
          startTime: "08:00",
          endTime: "14:00",
          teamName: "CT Team",
          status: "active",
          members: [{ id: 55, assignmentId: 44, doctorId: 7, displayName: "Dr Readonly", teamRole: "specialist" }],
        },
      ],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/roster-planner");

    expect(await screen.findByText("Published roster is read-only.")).toBeTruthy();
    expect(screen.getByText("CT Team")).toBeTruthy();
    expect(screen.getByText(/Dr Readonly/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create assignment/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/i })).toBeNull();
    expect(screen.queryByText("Drop doctor here")).toBeNull();
  });

  it("Previous and Next week buttons update selected week", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/roster-planner");

    const weekInput = (await screen.findByLabelText("Week start")) as HTMLInputElement;
    const initialWeek = weekInput.value;
    const previousWeek = new Date(`${initialWeek}T00:00:00Z`);
    previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
    fireEvent.click(screen.getByRole("button", { name: /Previous week/i }));
    expect(weekInput.value).toBe(previousWeek.toISOString().slice(0, 10));
    fireEvent.click(screen.getByRole("button", { name: /Next week/i }));
    expect(weekInput.value).toBe(initialWeek);
  });

  it("Advanced Setup exposes supervisor roster advanced tools", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/advanced-setup");

    fireEvent.click(await screen.findByRole("button", { name: /Roster setup/i }));
    expect(await screen.findByText("Roster templates")).toBeTruthy();
    expect(await screen.findByText("No roster templates yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Apply template/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate draft roster/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create template/i })).toBeNull();
    expect(screen.queryByText("Roster duty types")).toBeNull();
    expect(screen.queryByText("Import roster from ABC export")).toBeNull();
  });

  it("admin can create and apply a template with conflict result", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor", "doctor_admin"],
    });
    fetchRosterTemplatesMock.mockImplementation(() => Promise.resolve([
      { id: 7, name: "CT Weekly", description: null, modalityId: null, modalityCode: null, modalityNameEn: null, modalityNameAr: null, templateType: "ct_weekly", active: true, assignments: [] },
    ]));
    applyRosterTemplateMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      createdAssignmentCount: 2,
      copiedMemberCount: 1,
      skippedCount: 0,
      conflicts: [{ assignmentId: 44, memberId: null, doctorId: null, severity: "error", code: "required_team_empty", message: "Published roster has an empty required team slot." }],
    });
    renderDoctorPortal("/doctor/advanced-setup");

    fireEvent.click(await screen.findByRole("button", { name: /Roster setup/i }));
    expect(await screen.findByRole("button", { name: /Create template/i })).toBeTruthy();
    expect(screen.getByText("Roster duty types")).toBeTruthy();
    expect(screen.getByText("ABC shift mappings")).toBeTruthy();
    expect(screen.getByText("Import roster from ABC export")).toBeTruthy();
    await waitFor(() => {
      expect(fetchRosterTemplatesMock).toHaveBeenCalled();
    });
    expect(await screen.findByDisplayValue("CT Weekly")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Apply template/i }));

    await waitFor(() => {
      expect(applyRosterTemplateMock).toHaveBeenCalled();
    });
    expect(await screen.findByText(/Template applied: 2 duties, 1 doctors, 0 skipped/)).toBeTruthy();
    expect(await screen.findByText(/This assignment needs a specialist before publishing/)).toBeTruthy();
  });

  it("supervisor can generate draft roster and export roster", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/advanced-setup");

    fireEvent.click(await screen.findByRole("button", { name: /Roster setup/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Generate draft roster/i }));

    await waitFor(() => {
      expect(generateDoctorRosterDraftMock).toHaveBeenCalled();
    });
    expect(await screen.findByText(/Generated: 1 duties, 0 doctors assigned/)).toBeTruthy();
  });

  it("published roster shows notify and export controls", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "published",
        createdBy: 1,
        publishedBy: 1,
        publishedAt: "2027-01-01",
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/advanced-setup");

    fireEvent.click(await screen.findByRole("button", { name: /Roster setup/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Notify assigned doctors/i }));

    await waitFor(() => {
      expect(notifyDoctorRosterWeekMock.mock.calls[0]?.[0]).toBe(99);
    });
    expect(screen.getByText("Export HTML")).toBeTruthy();
    expect(screen.getByText("Export CSV")).toBeTruthy();
  });

  it("normal doctor My Cases page renders empty state without assignment controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/cases");

    expect(await screen.findByText("No report-required cases match these filters.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run assignment/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Unassigned cases/i })).toBeNull();
  });

  it("doctor supervisor sees case assignment controls and unassigned view", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/cases");

    expect(await screen.findByText("Today’s Cases")).toBeTruthy();
    await waitFor(() => {
      expect(fetchUnassignedDoctorCasesMock).toHaveBeenCalledWith(expect.objectContaining({ requiresReport: true }));
    });
    expect(screen.queryByRole("button", { name: /Run assignment/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Team cases/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unassigned cases/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Detailed view/i })).toBeTruthy();
    expect(screen.queryByText("Roster assignment targets")).toBeNull();
  });

  it("supervisor can assign an unassigned report case to a doctor", async () => {
    fetchRosterDoctorsMock.mockResolvedValue([{ id: 5, userId: 50, displayName: "Dr Target", doctorRole: "specialist", active: true, canFinalizeReports: true, canAssignProtocols: true, canSupervise: false }]);
    fetchUnassignedDoctorCasesMock.mockResolvedValue([
      {
        appointmentId: 77,
        appointmentDate: "2027-01-04",
        appointmentTime: "09:00",
        patientId: 5,
        patientMrn: "MRN-5",
        patientNationalId: "NID-5",
        patientArabicName: "Arabic Name",
        patientEnglishName: "Case Patient",
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 2,
        examTypeName: "CT Brain",
        caseCategory: "oncology",
        requiresReport: true,
        appointmentStatus: "scheduled",
        rosterAssignmentId: null,
        assignedDoctorId: null,
        assignedDoctorName: null,
        teamName: null,
        dutyType: null,
        expectedReportingDate: null,
        assignmentType: null,
        assignmentStatus: null,
        workloadPoints: 1,
        workloadDefaulted: false,
        protocolStatus: null,
        reportStatus: null,
      },
    ]);
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: null,
      assignments: [{
        id: 9,
        rosterWeekId: 1,
        date: "2027-01-04",
        modalityId: 1,
        modalityCode: "CT",
        modalityNameEn: "CT",
        modalityNameAr: "CT",
        dutyType: "configured_reporting_duty",
        sessionName: "day",
        startTime: "08:00",
        endTime: "14:00",
        teamName: "CT Team",
        status: "active",
        members: [],
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      }],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/cases");

    expect(await screen.findByText("Case Patient")).toBeTruthy();
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects.at(-2)!, { target: { value: "5" } });
    fireEvent.change(selects.at(-1)!, { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => {
      expect(assignDoctorCaseMock).toHaveBeenCalledWith(77, { doctorId: 5, rosterAssignmentId: 9, reason: "" });
    });
  });

  it("simplified reassignment requires a reason", async () => {
    fetchRosterDoctorsMock.mockResolvedValue([{ id: 5, userId: 50, displayName: "Dr Target", doctorRole: "specialist", active: true, canFinalizeReports: true, canAssignProtocols: true, canSupervise: false }]);
    fetchTeamDoctorCasesMock.mockResolvedValue([
      {
        appointmentId: 78,
        appointmentDate: "2027-01-04",
        appointmentTime: "10:00",
        patientId: 6,
        patientMrn: "MRN-6",
        patientNationalId: "NID-6",
        patientArabicName: null,
        patientEnglishName: "Assigned Patient",
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 2,
        examTypeName: "CT Chest",
        caseCategory: "non_oncology",
        requiresReport: true,
        appointmentStatus: "scheduled",
        rosterAssignmentId: null,
        assignedDoctorId: 4,
        assignedDoctorName: "Dr Current",
        teamName: null,
        dutyType: null,
        expectedReportingDate: null,
        assignmentType: "reporting",
        assignmentStatus: "active",
        workloadPoints: 2,
        workloadDefaulted: false,
        protocolStatus: null,
        reportStatus: null,
      },
    ]);
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/cases");

    fireEvent.click(await screen.findByRole("button", { name: /Team cases/i }));
    expect(await screen.findByText("Assigned Patient")).toBeTruthy();
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects.at(-2)!, { target: { value: "5" } });
    expect((screen.getByRole("button", { name: "Reassign" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Reassignment reason"), { target: { value: "coverage correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await waitFor(() => {
      expect(assignDoctorCaseMock).toHaveBeenCalledWith(78, { doctorId: 5, rosterAssignmentId: null, reason: "coverage correction" });
    });
  });

  it("detailed view still exposes roster targets and detailed table behavior", async () => {
    fetchRosterDoctorsMock.mockResolvedValue([{ id: 5, userId: 50, displayName: "Dr Target", doctorRole: "specialist", active: true, canFinalizeReports: true, canAssignProtocols: true, canSupervise: false }]);
    fetchUnassignedDoctorCasesMock.mockResolvedValue([
      {
        appointmentId: 77,
        appointmentDate: "2027-01-04",
        appointmentTime: "09:00",
        patientId: 5,
        patientMrn: "MRN-5",
        patientNationalId: "NID-5",
        patientArabicName: "Arabic Name",
        patientEnglishName: "Case Patient",
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 2,
        examTypeName: "CT Brain",
        caseCategory: "oncology",
        requiresReport: true,
        appointmentStatus: "scheduled",
        rosterAssignmentId: null,
        assignedDoctorId: null,
        assignedDoctorName: null,
        teamName: null,
        dutyType: null,
        expectedReportingDate: null,
        assignmentType: null,
        assignmentStatus: null,
        workloadPoints: 1,
        workloadDefaulted: false,
        protocolStatus: null,
        reportStatus: null,
      },
    ]);
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: null,
      assignments: [{
        id: 9,
        rosterWeekId: 1,
        date: "2027-01-04",
        modalityId: 1,
        modalityCode: "CT",
        modalityNameEn: "CT",
        modalityNameAr: "CT",
        dutyType: "configured_reporting_duty",
        sessionName: "day",
        startTime: "08:00",
        endTime: "14:00",
        teamName: "CT Team",
        status: "active",
        members: [],
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      }],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/cases");

    fireEvent.click(await screen.findByRole("button", { name: /Detailed view/i }));
    expect(await screen.findByText("Roster assignment targets")).toBeTruthy();
    expect(await screen.findByText(/Roster target #9/)).toBeTruthy();
    expect(screen.getByText("Expected report")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Assign" }));
    expect(screen.getByPlaceholderText("Assignment reason")).toBeTruthy();
  });

  it("normal doctor does not see drag/drop assignment controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/cases");

    expect(await screen.findByText("No report-required cases match these filters.")).toBeTruthy();
    expect(screen.queryByText("Roster assignment targets")).toBeNull();
  });

  it("does not expose automatic case assignment from the worklist", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/cases");

    expect(await screen.findByText("Today’s Cases")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run assignment/i })).toBeNull();
  });

  it("supervisor can open the Reporting Assignment Board route", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/reporting-board");

    expect(await screen.findByText("Reporting Assignment Board")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bulk assign next cases/i })).toBeTruthy();
    expect(screen.getByText("Saved views")).toBeTruthy();
  });

  it("normal doctor cannot open the Reporting Assignment Board route or assignment controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/reporting-board");

    expect(await screen.findByText("Clinical coordination workspace")).toBeTruthy();
    expect(screen.queryByText("Reporting Assignment Board")).toBeNull();
    expect(screen.queryByRole("button", { name: /Bulk assign next cases/i })).toBeNull();
  });

  it("shows Reporting Board notification badge, marks read, and navigates to action URL", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    fetchReportingBoardNotificationsMock.mockResolvedValue([{
      id: 22,
      eventType: "reporting_case_assigned_to_me",
      title: "New reporting case assigned",
      body: "A reporting case has been assigned to you. Open RISpro to review your reporting board.",
      actionUrl: "/doctor/reporting-board/saved/tok",
      status: "delivered",
      createdAt: "2026-05-29T08:00:00.000Z",
      deliveredAt: "2026-05-29T08:00:00.000Z",
      readAt: null,
      dismissedAt: null,
    }]);
    renderDoctorPortal("/doctor/my-work");

    const notificationsButton = await screen.findByRole("button", { name: /Notifications/i });
    await waitFor(() => expect(notificationsButton.textContent).toContain("1"));
    fireEvent.click(notificationsButton);
    expect(await screen.findByText("New reporting case assigned")).toBeTruthy();
    expect(screen.queryByText(/V2-/)).toBeNull();
    fireEvent.click(screen.getByText("New reporting case assigned"));
    await waitFor(() => expect(markReportingBoardNotificationReadMock.mock.calls[0]?.[0]).toBe(22));
    await waitFor(() => expect(fetchReportingBoardSavedViewByTokenMock).toHaveBeenCalledWith("tok"));
  });

  it("dismisses Reporting Board notifications for the current user", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    fetchReportingBoardNotificationsMock.mockResolvedValue([{
      id: 23,
      eventType: "reporting_case_assigned_to_me",
      title: "New reporting case assigned",
      body: "A reporting case has been assigned to you. Open RISpro to review your reporting board.",
      actionUrl: "/doctor/reporting-board/saved/tok",
      status: "delivered",
      createdAt: "2026-05-29T08:00:00.000Z",
      deliveredAt: "2026-05-29T08:00:00.000Z",
      readAt: null,
      dismissedAt: null,
    }]);
    renderDoctorPortal("/doctor/my-work");

    fireEvent.click(await screen.findByRole("button", { name: /Notifications/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(dismissReportingBoardNotificationMock.mock.calls[0]?.[0]).toBe(23));
  });

  it("normal doctor sees Protocols page empty state", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/protocols");

    expect(await screen.findByText("No protocol tasks found.")).toBeTruthy();
    expect(screen.queryByText(/reschedule/i)).toBeNull();
  });

  it("protocol form renders appointment summary and actions", async () => {
    fetchProtocolTasksMock.mockResolvedValue([
      {
        appointmentId: 77,
        patientId: 5,
        patientMrn: "MRN-5",
        patientNationalId: "NID-5",
        patientArabicName: "Arabic Name",
        patientEnglishName: "Protocol Patient",
        ageYears: 42,
        sex: "F",
        appointmentDate: "2027-01-04",
        appointmentTime: "09:00",
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 2,
        examTypeName: "CT Brain",
        caseCategory: "oncology",
        requiresReport: true,
        clinicalIndication: "Headache",
        appointmentStatus: "scheduled",
        rosterAssignmentId: 9,
        teamName: "CT Team",
        protocolStatus: null,
        assignedByDoctorName: null,
        updatedAt: null,
      },
    ]);
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    fetchProtocolAuditMock.mockResolvedValue([
      {
        eventType: "protocol_assigned",
        changedByDoctorId: 1,
        changedByDoctorName: "Dr Normal",
        createdAt: "2027-01-04T10:00:00.000Z",
        reason: "corrected request",
        oldSummary: "status draft, version 1",
        newSummary: "status assigned, version 2, protocol text present",
        version: 2,
        protocolStatus: "assigned",
      },
    ]);
    renderDoctorPortal("/doctor/protocols");

    fireEvent.click(await screen.findByText("Protocol Patient"));

    expect(await screen.findByText(/Clinical indication:/)).toBeTruthy();
    expect(screen.getByText("Save draft")).toBeTruthy();
    expect(screen.getByText("Assign protocol")).toBeTruthy();
    expect(screen.getByText("Clarification requires a note.")).toBeTruthy();
    expect(await screen.findByText("Protocol history")).toBeTruthy();
    expect(screen.getByText(/corrected request/)).toBeTruthy();
    expect(screen.queryByText(/reschedule/i)).toBeNull();
  });

  it("supervisor sees team protocol task controls", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/protocols");

    expect(await screen.findByText("Supervisor/admin team and unassigned protocol tasks are visible here.")).toBeTruthy();
  });

  it("normal doctor sees team workload empty state without calculation controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/team-workload");

    expect(await screen.findByText("My team workload")).toBeTruthy();
    expect(screen.getByText("No workload summary for this filter.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Calculate workload/i })).toBeNull();
    expect(screen.queryByText(/ranking|salary|payment/i)).toBeNull();
  });

  it("supervisor sees workload calculation controls", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/team-workload");

    expect(await screen.findByText("Department team workload")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Calculate workload/i })).toBeTruthy();
  });

  it("admin can manage workload catalog and normal doctor cannot", async () => {
    fetchAppointmentLookupsMock.mockResolvedValue({
      modalities: [{ id: 1, code: "CT", nameEn: "CT", nameAr: "CT" }],
      examTypes: [{ id: 2, modalityId: 1, nameEn: "CT Brain", nameAr: "CT Brain" }],
    });
    fetchWorkloadCatalogMock.mockResolvedValue([
      { id: 8, modalityId: 1, examTypeId: null, caseCategory: null, assignmentType: "reporting", baseUnits: 1, reportRequiredMultiplier: 1, noReportUnits: 0, active: true, effectiveFrom: "2027-01-01", effectiveTo: null },
    ]);
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor", "doctor_admin"],
    });
    renderDoctorPortal("/doctor/team-workload");

    expect(await screen.findByText("Workload scoring rules")).toBeTruthy();
    const catalogSection = screen.getByText("Workload scoring rules").closest("section");
    expect(catalogSection).toBeTruthy();
    await waitFor(() => expect(within(catalogSection as HTMLElement).getByRole("option", { name: "CT" })).toBeTruthy());
    fireEvent.change(within(catalogSection as HTMLElement).getAllByRole("combobox")[0], { target: { value: "1" } });
    fireEvent.change(within(catalogSection as HTMLElement).getByPlaceholderText("Points"), { target: { value: "1" } });
    const createRuleButton = within(catalogSection as HTMLElement).getByRole("button", { name: /Create rule/i }) as HTMLButtonElement;
    await waitFor(() => expect(createRuleButton.disabled).toBe(false));
    fireEvent.click(createRuleButton);
    await waitFor(() => expect(createWorkloadCatalogRuleMock).toHaveBeenCalled());
    fireEvent.click(within(catalogSection as HTMLElement).getByRole("button", { name: /Edit/i }));
    fireEvent.click(within(catalogSection as HTMLElement).getByRole("button", { name: /Save rule/i }));
    await waitFor(() => expect(updateWorkloadCatalogRuleMock).toHaveBeenCalled());
    fireEvent.click(within(catalogSection as HTMLElement).getByRole("button", { name: /Deactivate/i }));
    await waitFor(() => expect(deactivateWorkloadCatalogRuleMock.mock.calls[0]?.[0]).toBe(8));
    expect(screen.queryByText(/salary|payment|ranking/i)).toBeNull();
  });

  it("supervisor can view workload catalog without edit controls", async () => {
    fetchWorkloadCatalogMock.mockResolvedValue([
      { id: 8, modalityId: 1, examTypeId: null, caseCategory: null, assignmentType: "reporting", baseUnits: 1, reportRequiredMultiplier: 1, noReportUnits: 0, active: true, effectiveFrom: "2027-01-01", effectiveTo: null },
    ]);
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/team-workload");

    expect(await screen.findByText("Workload scoring rules")).toBeTruthy();
    expect(screen.getByText("Read-only for this Doctor Portal role.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create rule/i })).toBeNull();
  });

  it("renders workload summary rows and calculation summary", async () => {
    fetchTeamWorkloadSummaryMock.mockResolvedValue([
      {
        rosterAssignmentId: 44,
        teamName: "CT Team",
        dutyType: "ct_protocol_day",
        date: "2027-01-04",
        modalityId: 1,
        modalityName: "CT",
        caseCategory: "oncology",
        caseCount: 3,
        totalWorkloadUnits: 5,
        reportRequiredCount: 2,
        noReportCount: 1,
        pendingCount: 1,
        finalizedCount: 1,
        overdueCount: 0,
      },
    ]);
    runWorkloadCalculationMock.mockResolvedValue({
      calculatedCount: 2,
      alreadyCurrentCount: 1,
      defaultedNoCatalogRuleCount: 1,
      skippedCount: 0,
      errors: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/team-workload");

    expect(await screen.findByText("CT Team")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Calculate workload/i }));
    expect(await screen.findByText("Calculated")).toBeTruthy();
    expect(screen.getByText("Defaulted")).toBeTruthy();
  });
});
