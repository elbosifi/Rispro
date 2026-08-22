import { api } from "@/lib/api-client";
import { mapUser } from "@/lib/mappers";
import { rawArray, rawBool, rawNumber, rawString, type RawRecord } from "./raw";
import type {
  User, DoctorMe, DoctorModalityPermission, DoctorProfile, DoctorProfileRole, DoctorRosterResponse,
  DoctorRosterAssignment, DoctorRosterMember, DoctorAvailability, DoctorLeaveRequest, RosterConflict,
  RosterTemplate, ApplyRosterTemplateResult, GenerateDraftRosterResult, RosterBalanceStrategy, RosterNotification,
  RosterNotificationSummary, RosterTemplateCopyMode, RosterTemplateType, DoctorCase, DoctorCaseAssignmentSummary,
  DoctorCaseFilters, CreateReportingBoardBulkAssignmentJobPayload, ReportingBoardBulkAssignResult,
  ReportingBoardBulkAssignmentJob, ReportingBoardBulkReassignSelectedPayload, ReportingBoardBulkUnassignResult,
  ReportingBoardBulkUnassignSelectedPayload, ReportingBoardCaseRow, OhifViewerAvailability, OhifViewerLaunchResponse,
  ReportingBoardFilters, ReportingBoardNotificationSettings, ReportingBoardNotificationEvent, ReportingBoardMobileResponse,
  ReportingBoardPushConfig, ReportingBoardSavedView, DoctorReportingWorklistSummary, ReportingBoardSettings,
  ReportingBoardStatsResponse, ComparisonRequest, PreviousCompletedStudy, RosterDutyTypeConfig, RosterShiftImportMapping,
  RosterXmlImportPreview, RosterXmlImportResult, AppointmentProtocol, ProtocolAuditTimelineEvent, ProtocolAnatomyRegion,
  ProtocolLibraryProtocol, ProtocolLibraryVersion, ProtocolLibraryVersionDetail, ProtocolLibraryCtPhaseRow,
  ProtocolLibraryMriSequenceRow, ProtocolDetails, ProtocolFilters, ProtocolPayload, DoctorProtocolingAppointment,
  DoctorProtocolingAppointmentDetail, DoctorProtocolingFilters, ProtocolAssignmentPayload, ProtocolTask, ImagingScanner, CtPhasePreset,
  MriSequencePreset, TeamWorkloadSummaryRow, WorkloadCalculationSummary, WorkloadCatalogRule, WorkloadFilters,
  AvailabilityStatus, LeaveType, RosterDutyType, RosterTeamRole, ModalityProtocolAssignment,
  ProtocolDocumentAnnotation, ProtocolDocumentAnnotationType, ProtocolingPatientHistoryResponse, ProtocolingHistoricalPacsCandidatesResponse, HistoricalPacsCandidate,
} from "@/types/api";

const MRI_SEQUENCE_IMPORT_TIMEOUT_MS = 180_000;

function mapModalityProtocolAssignment(raw: RawRecord): ModalityProtocolAssignment {
  return {
    assignmentId: Number(raw.assignment_id), appointmentId: Number(raw.appointment_id),
    protocolId: rawNumber(raw.protocol_id), protocolVersionId: rawNumber(raw.protocol_version_id),
    protocolName: rawString(raw.protocol_name), versionNumber: rawString(raw.version_number),
    freeTextProtocol: rawString(raw.free_text_protocol), modality: String(raw.modality).toUpperCase() as "CT" | "MRI",
    scannerId: rawNumber(raw.scanner_id), scannerName: rawString(raw.scanner_name), scannerVendor: rawString(raw.scanner_vendor),
    protocolNotes: rawString(raw.protocol_notes), contrastNotes: rawString(raw.contrast_notes),
    assignedBy: rawString(raw.assigned_by), assignedAt: rawString(raw.assigned_at), status: String(raw.status) as "ASSIGNED" | "MODIFIED",
    ctPhases: rawArray(raw.ct_phases).map((phase) => ({
      orderIndex: Number(phase.order_index), phasePresetName: rawString(phase.phase_preset_name), customPhaseName: rawString(phase.custom_phase_name),
      contrastStatus: rawString(phase.contrast_status), timingType: rawString(phase.timing_type), delaySeconds: rawNumber(phase.delay_seconds),
      timingOverride: rawString(phase.timing_override), coverage: rawString(phase.coverage), coverageOverride: rawString(phase.coverage_override),
      reconstructionNotes: rawString(phase.reconstruction_notes), reconstructionOverride: rawString(phase.reconstruction_override),
      instructions: rawString(phase.instructions), instructionsOverride: rawString(phase.instructions_override), isRequired: rawBool(phase.is_required),
    })),
    mriSequences: rawArray(raw.mri_sequences).map((sequence) => ({
      orderIndex: Number(sequence.order_index), scannerId: rawNumber(sequence.scanner_id), scannerName: rawString(sequence.scanner_name),
      sequencePresetName: rawString(sequence.sequence_preset_name), vendorSequenceName: rawString(sequence.vendor_sequence_name),
      genericFamily: rawString(sequence.generic_family), weighting: rawString(sequence.weighting), defaultPlane: rawString(sequence.default_plane),
      planeOverride: rawString(sequence.plane_override), defaultCoverage: rawString(sequence.default_coverage), coverageOverride: rawString(sequence.coverage_override),
      defaultBValues: rawString(sequence.default_b_values), bValuesOverride: rawString(sequence.b_values_override),
      defaultDynamicTiming: rawString(sequence.default_dynamic_timing), timingOverride: rawString(sequence.timing_override),
      notes: rawString(sequence.notes), notesOverride: rawString(sequence.notes_override), isRequired: rawBool(sequence.is_required),
    })),
  };
}

export async function fetchDoctorMe(): Promise<DoctorMe> {
  return api<DoctorMe>("/doctor/me");
}

export async function fetchDoctorProfilesForAdmin(): Promise<DoctorProfile[]> {
  const raw = await api<{ profiles: DoctorProfile[] }>("/doctor/profiles");
  return raw.profiles;
}

export async function createDoctorProfileForAdmin(payload: {
  userId: number;
  displayName: string;
  doctorRole: DoctorProfileRole;
  active: boolean;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
}): Promise<DoctorProfile> {
  const raw = await api<{ profile: DoctorProfile }>("/doctor/profiles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.profile;
}

export async function createDoctorWithUserForAdmin(payload: {
  username: string;
  fullName: string;
  temporaryPassword: string;
  coreRole: "doctor" | "supervisor";
  userActive: boolean;
  doctorDisplayName: string;
  doctorRole: DoctorProfileRole;
  doctorProfileActive: boolean;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
  modalityPermissions: Array<{
    modalityId: number;
    canProtocol: boolean;
    canReport: boolean;
    canSupervise: boolean;
    active: boolean;
  }>;
}): Promise<{ user: User; profile: DoctorProfile; modalities: DoctorModalityPermission[] }> {
  const raw = await api<{ user: RawRecord; profile: DoctorProfile; modalities: DoctorModalityPermission[] }>("/doctor/admin/doctors", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { user: mapUser(raw.user), profile: raw.profile, modalities: raw.modalities };
}

export async function updateDoctorProfileForAdmin(
  profileId: number,
  payload: {
    displayName?: string;
    doctorRole?: DoctorProfileRole;
    active?: boolean;
    canFinalizeReports?: boolean;
    canAssignProtocols?: boolean;
    canSupervise?: boolean;
  }
): Promise<DoctorProfile> {
  const raw = await api<{ profile: DoctorProfile }>(`/doctor/profiles/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.profile;
}

export async function fetchDoctorProfileModalities(profileId: number): Promise<DoctorModalityPermission[]> {
  const raw = await api<{ modalities: DoctorModalityPermission[] }>(`/doctor/profiles/${profileId}/modalities`);
  return raw.modalities;
}

export async function updateDoctorProfileModalities(
  profileId: number,
  permissions: Array<{
    modalityId: number;
    canProtocol: boolean;
    canReport: boolean;
    canSupervise: boolean;
    active: boolean;
  }>
): Promise<DoctorModalityPermission[]> {
  const raw = await api<{ modalities: DoctorModalityPermission[] }>(`/doctor/profiles/${profileId}/modalities`, {
    method: "PUT",
    body: JSON.stringify({ permissions })
  });
  return raw.modalities;
}

export async function resetDoctorUserTemporaryPassword(userId: number, temporaryPassword: string): Promise<User> {
  const raw = await api<{ user: RawRecord }>(`/doctor/admin/doctors/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ temporaryPassword }),
  });
  return mapUser(raw.user);
}

export async function forceDoctorUserPasswordChange(userId: number): Promise<User> {
  const raw = await api<{ user: RawRecord }>(`/doctor/admin/doctors/${userId}/force-password-change`, {
    method: "POST",
  });
  return mapUser(raw.user);
}

export async function setDoctorUserActive(userId: number, active: boolean): Promise<User> {
  const action = active ? "activate" : "deactivate";
  const raw = await api<{ user: RawRecord }>(`/doctor/admin/doctors/${userId}/${action}`, {
    method: "POST",
  });
  return mapUser(raw.user);
}

export async function updateDoctorLinkedUserForAdmin(userId: number, payload: { username: string; fullName: string; coreRole: "doctor" | "supervisor"; active: boolean }): Promise<{ user: User; profile: DoctorProfile }> {
  const raw = await api<{ user: RawRecord; profile: DoctorProfile }>(`/doctor/admin/doctors/${userId}/account`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return { user: mapUser(raw.user), profile: raw.profile };
}

export async function setDoctorIdentityActive(userId: number, active: boolean): Promise<{ user: User; profile: DoctorProfile }> {
  const action = active ? "activate" : "deactivate";
  const raw = await api<{ user: RawRecord; profile: DoctorProfile }>(`/doctor/admin/doctors/${userId}/${action}`, { method: "POST" });
  return { user: mapUser(raw.user), profile: raw.profile };
}

export interface DoctorImportPreview {
  rows: Array<{ rowNumber: number; values: Record<string, string>; action: "create" | "update" | "invalid"; errors: string[] }>;
  canConfirm: boolean;
}

export interface DoctorImportPayload {
  fileContentBase64: string;
  format?: "csv" | "xlsx";
  fileName?: string;
}

export interface DoctorImportResult {
  createdUsers: number;
  updatedUsers: number;
  createdProfiles: number;
  updatedProfiles: number;
  disabledProfiles: number;
  modalityPermissionsUpdated: number;
  skippedRows: number;
  failedRows: Array<{ rowNumber: number; reason: string }>;
}

export async function inspectDoctorImport(payload: DoctorImportPayload) {
  return api<{ workbook: { format: "csv" | "xlsx"; columns: string[]; requiredColumns: string[]; rowCount: number; missingColumns: string[] } }>("/doctor/admin/doctors/import/inspect", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function previewDoctorImport(payload: DoctorImportPayload): Promise<DoctorImportPreview> {
  const raw = await api<{ preview: DoctorImportPreview }>("/doctor/admin/doctors/import/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return raw.preview;
}

export async function confirmDoctorImport(payload: DoctorImportPayload): Promise<DoctorImportResult> {
  const raw = await api<{ result: DoctorImportResult }>("/doctor/admin/doctors/import/confirm", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return raw.result;
}

export async function fetchDoctorRosterWeek(weekStart: string): Promise<DoctorRosterResponse> {
  const params = new URLSearchParams({ weekStart });
  return api<DoctorRosterResponse>(`/doctor/roster/weeks?${params.toString()}`);
}

export async function fetchMyDoctorRoster(weekStart: string): Promise<DoctorRosterResponse> {
  const params = new URLSearchParams({ weekStart });
  return api<DoctorRosterResponse>(`/doctor/roster/my?${params.toString()}`);
}

export async function fetchRosterDoctors(): Promise<DoctorProfile[]> {
  const raw = await api<{ profiles: DoctorProfile[] }>("/doctor/roster/doctors");
  return raw.profiles;
}

export async function createDoctorRosterWeek(payload: { weekStartDate: string; weekEndDate: string }) {
  return api<{ week: DoctorRosterResponse["week"] }>("/doctor/roster/weeks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function copyPreviousDoctorRosterWeek(weekId: number): Promise<DoctorRosterResponse> {
  return api<DoctorRosterResponse>(`/doctor/roster/weeks/${weekId}/copy-previous`, { method: "POST" });
}

export async function publishDoctorRosterWeek(weekId: number) {
  return api<{ week: DoctorRosterResponse["week"] }>(`/doctor/roster/weeks/${weekId}/publish`, { method: "POST" });
}

export async function createDoctorRosterAssignment(payload: {
  rosterWeekId: number;
  date: string;
  modalityId: number | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
  startTime: string | null;
  endTime: string | null;
  teamName: string;
}): Promise<DoctorRosterAssignment> {
  const raw = await api<{ assignment: DoctorRosterAssignment }>("/doctor/roster/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.assignment;
}

export async function deleteDoctorRosterAssignment(assignmentId: number): Promise<void> {
  await api(`/doctor/roster/assignments/${assignmentId}`, { method: "DELETE" });
}

export async function addDoctorRosterMember(assignmentId: number, payload: { doctorId: number; teamRole: RosterTeamRole }): Promise<DoctorRosterMember> {
  const raw = await api<{ member: DoctorRosterMember }>(`/doctor/roster/assignments/${assignmentId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.member;
}

export async function deleteDoctorRosterMember(assignmentId: number, memberId: number): Promise<void> {
  await api(`/doctor/roster/assignments/${assignmentId}/members/${memberId}`, { method: "DELETE" });
}

export async function fetchRosterWeekConflicts(weekId: number): Promise<RosterConflict[]> {
  const raw = await api<{ conflicts: RosterConflict[] }>(`/doctor/roster/weeks/${weekId}/conflicts`);
  return raw.conflicts;
}

export async function validateDoctorRosterAssignment(assignmentId: number): Promise<RosterConflict[]> {
  const raw = await api<{ conflicts: RosterConflict[] }>(`/doctor/roster/assignments/${assignmentId}/validate`, { method: "POST" });
  return raw.conflicts;
}

export async function fetchRosterTemplates(): Promise<RosterTemplate[]> {
  const raw = await api<{ templates: RosterTemplate[] }>("/doctor/roster/templates");
  return raw.templates;
}

export async function createRosterTemplate(payload: {
  name: string;
  description: string | null;
  modalityId: number | null;
  templateType: RosterTemplateType;
  assignments: Array<{
    dayOfWeek: number;
    modalityId: number | null;
    dutyType: RosterDutyType;
    sessionName: string | null;
    startTime: string | null;
    endTime: string | null;
    teamName: string;
    sortOrder: number;
    members: Array<{ doctorId: number | null; teamRole: RosterTeamRole; placeholderLabel: string | null; requiredRole: string | null }>;
  }>;
}): Promise<RosterTemplate> {
  const raw = await api<{ template: RosterTemplate }>("/doctor/roster/templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.template;
}

export async function applyRosterTemplate(templateId: number, payload: {
  targetWeekStartDate: string;
  copyMode: RosterTemplateCopyMode;
  overwriteExisting: boolean;
  modalityId: number | null;
}): Promise<ApplyRosterTemplateResult> {
  return api<ApplyRosterTemplateResult>(`/doctor/roster/templates/${templateId}/apply`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateDoctorRosterDraft(payload: {
  weekStartDate: string;
  templateId: number | null;
  modalityId: number | null;
  includeDoctors: boolean;
  balanceStrategy: RosterBalanceStrategy;
}): Promise<GenerateDraftRosterResult> {
  return api<GenerateDraftRosterResult>("/doctor/roster/generate-draft", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function notifyDoctorRosterWeek(weekId: number): Promise<RosterNotificationSummary> {
  return api<RosterNotificationSummary>(`/doctor/roster/weeks/${weekId}/notify`, {
    method: "POST",
  });
}

export async function fetchRosterDutyTypes(includeInactive = false): Promise<RosterDutyTypeConfig[]> {
  const params = new URLSearchParams();
  if (includeInactive) params.set("includeInactive", "true");
  const raw = await api<{ dutyTypes: RosterDutyTypeConfig[] }>(`/doctor/roster/duty-types?${params.toString()}`);
  return raw.dutyTypes;
}

export async function saveRosterDutyType(payload: {
  code: string;
  label: string;
  active: boolean;
  requiresSpecialist: boolean;
  sortOrder: number;
}): Promise<RosterDutyTypeConfig> {
  const raw = await api<{ dutyType: RosterDutyTypeConfig }>("/doctor/roster/duty-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.dutyType;
}

export async function fetchRosterShiftImportMappings(includeInactive = false): Promise<RosterShiftImportMapping[]> {
  const params = new URLSearchParams();
  if (includeInactive) params.set("includeInactive", "true");
  const raw = await api<{ mappings: RosterShiftImportMapping[] }>(`/doctor/roster/shift-import-mappings?${params.toString()}`);
  return raw.mappings;
}

export async function saveRosterShiftImportMapping(payload: {
  id?: number | null;
  sourceSystem: string;
  sourceShiftName: string | null;
  sourceShiftType: string | null;
  sourceShiftAbbreviation: string | null;
  dutyTypeCode: string;
  modalityId: number | null;
  teamName: string | null;
  active: boolean;
}): Promise<RosterShiftImportMapping> {
  const raw = await api<{ mapping: RosterShiftImportMapping }>("/doctor/roster/shift-import-mappings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.mapping;
}

export async function previewRosterXmlImport(payload: { fileContentBase64: string }): Promise<RosterXmlImportPreview> {
  const raw = await api<{ preview: RosterXmlImportPreview }>("/doctor/roster/import/abc/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.preview;
}

export async function confirmRosterXmlImport(payload: {
  fileContentBase64: string;
  createMissingDoctors: boolean;
  temporaryPassword: string;
  defaultDoctorRole: string;
  defaultCoreRole: "doctor" | "supervisor";
  defaultTeamRole: string;
}): Promise<RosterXmlImportResult> {
  const raw = await api<{ result: RosterXmlImportResult }>("/doctor/roster/import/abc/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.result;
}

export async function fetchDoctorRosterNotifications(weekId: number): Promise<RosterNotification[]> {
  const raw = await api<{ notifications: RosterNotification[] }>(`/doctor/roster/weeks/${weekId}/notifications`);
  return raw.notifications;
}

export async function fetchMyDoctorAvailability(dateFrom: string, dateTo: string): Promise<DoctorAvailability[]> {
  const params = new URLSearchParams({ dateFrom, dateTo });
  const raw = await api<{ availability: DoctorAvailability[] }>(`/doctor/availability/my?${params.toString()}`);
  return raw.availability;
}

export async function fetchTeamDoctorAvailability(dateFrom: string, dateTo: string): Promise<DoctorAvailability[]> {
  const params = new URLSearchParams({ dateFrom, dateTo });
  const raw = await api<{ availability: DoctorAvailability[] }>(`/doctor/availability/team?${params.toString()}`);
  return raw.availability;
}

export async function createMyDoctorAvailability(payload: {
  date: string;
  startTime: string | null;
  endTime: string | null;
  availabilityStatus: AvailabilityStatus;
  note: string | null;
}): Promise<DoctorAvailability> {
  const raw = await api<{ availability: DoctorAvailability }>("/doctor/availability/my", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.availability;
}

export async function createTeamDoctorAvailability(payload: {
  doctorId: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  availabilityStatus: AvailabilityStatus;
  note: string | null;
}): Promise<DoctorAvailability> {
  const raw = await api<{ availability: DoctorAvailability }>("/doctor/availability", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.availability;
}

export async function fetchMyDoctorLeave(dateFrom: string, dateTo: string): Promise<DoctorLeaveRequest[]> {
  const params = new URLSearchParams({ dateFrom, dateTo });
  const raw = await api<{ leave: DoctorLeaveRequest[] }>(`/doctor/leave/my?${params.toString()}`);
  return raw.leave;
}

export async function fetchTeamDoctorLeave(dateFrom: string, dateTo: string): Promise<DoctorLeaveRequest[]> {
  const params = new URLSearchParams({ dateFrom, dateTo });
  const raw = await api<{ leave: DoctorLeaveRequest[] }>(`/doctor/leave/team?${params.toString()}`);
  return raw.leave;
}

export async function createMyDoctorLeave(payload: {
  startDate: string;
  endDate: string;
  leaveType: LeaveType;
  reason: string | null;
}): Promise<DoctorLeaveRequest> {
  const raw = await api<{ leave: DoctorLeaveRequest }>("/doctor/leave/my", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.leave;
}

export async function updateDoctorLeaveStatus(leaveId: number, status: "approved" | "rejected" | "cancelled"): Promise<DoctorLeaveRequest> {
  const raw = await api<{ leave: DoctorLeaveRequest }>(`/doctor/leave/${leaveId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return raw.leave;
}

function doctorCaseParams(filters: DoctorCaseFilters): URLSearchParams {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.modalityId) params.set("modalityId", String(filters.modalityId));
  if (filters.status) params.set("status", filters.status);
  if (filters.requiresReport !== null && filters.requiresReport !== undefined) {
    params.set("requiresReport", String(filters.requiresReport));
  }
  if (filters.caseCategory) params.set("caseCategory", filters.caseCategory);
  if (filters.rosterAssignmentId) params.set("rosterAssignmentId", String(filters.rosterAssignmentId));
  return params;
}

export async function fetchMyDoctorCases(filters: DoctorCaseFilters): Promise<DoctorCase[]> {
  const raw = await api<{ cases: DoctorCase[] }>(`/doctor/cases/my?${doctorCaseParams(filters).toString()}`);
  return raw.cases;
}

export async function fetchTeamDoctorCases(filters: DoctorCaseFilters): Promise<DoctorCase[]> {
  const raw = await api<{ cases: DoctorCase[] }>(`/doctor/cases/team?${doctorCaseParams(filters).toString()}`);
  return raw.cases;
}

export async function fetchUnassignedDoctorCases(filters: DoctorCaseFilters): Promise<DoctorCase[]> {
  const raw = await api<{ cases: DoctorCase[] }>(`/doctor/cases/unassigned?${doctorCaseParams(filters).toString()}`);
  return raw.cases;
}

export async function runDoctorCaseAssignment(payload: { dateFrom: string; dateTo: string; modalityId?: number | null }): Promise<DoctorCaseAssignmentSummary> {
  const raw = await api<{ summary: DoctorCaseAssignmentSummary }>("/doctor/cases/assign", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.summary;
}

export async function reassignDoctorCase(appointmentId: number, payload: { rosterAssignmentId: number; reason: string }): Promise<{ assignmentId: number }> {
  return api<{ assignmentId: number }>(`/doctor/cases/${appointmentId}/reassign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function assignDoctorCase(
  appointmentId: number,
  payload: { doctorId: number; rosterAssignmentId?: number | null; reason?: string | null }
): Promise<{ assignmentId: number }> {
  return api<{ assignmentId: number }>(`/doctor/cases/${appointmentId}/assign-doctor`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function reportingBoardParams(filters: ReportingBoardFilters): URLSearchParams {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    params.set(key, String(value));
  });
  return params;
}

export async function fetchReportingBoardSettings(): Promise<ReportingBoardSettings> {
  const raw = await api<{ settings: ReportingBoardSettings }>("/doctor/reporting-board/settings");
  return raw.settings;
}

export async function updateReportingBoardSettings(payload: ReportingBoardSettings): Promise<ReportingBoardSettings> {
  const raw = await api<{ settings: ReportingBoardSettings }>("/doctor/reporting-board/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return raw.settings;
}

export async function fetchReportingBoardCases(filters: ReportingBoardFilters): Promise<{ cases: ReportingBoardCaseRow[]; filters: ReportingBoardFilters }> {
  return api<{ cases: ReportingBoardCaseRow[]; filters: ReportingBoardFilters }>(`/doctor/reporting-board/cases?${reportingBoardParams(filters).toString()}`);
}

export async function fetchOhifViewerAvailability(): Promise<OhifViewerAvailability> {
  return api<OhifViewerAvailability>("/ohif/availability");
}

export async function launchReportingBoardCaseInOhif(appointmentId: number, includePriors = true): Promise<OhifViewerLaunchResponse> {
  return api<OhifViewerLaunchResponse>(`/doctor/reporting-board/cases/${appointmentId}/viewer-launch`, {
    method: "POST",
    body: JSON.stringify({ includePriors }),
  });
}

export async function fetchOhifRetrievalJob(jobId: number): Promise<{ status: string; retrievalJobId: number; message: string }> {
  return api<{ status: string; retrievalJobId: number; message: string }>(`/ohif/retrieval-jobs/${jobId}`);
}

export async function fetchReportingBoardStats(filters: ReportingBoardFilters): Promise<ReportingBoardStatsResponse> {
  return api<ReportingBoardStatsResponse>(`/doctor/reporting-board/stats?${reportingBoardParams(filters).toString()}`);
}

export async function refreshReportingBoardSonicDicom(filters: ReportingBoardFilters): Promise<{ ok: true; checked: number; successful: number; failed: number; checkedAt: string }> {
  return api("/doctor/reporting-board/refresh-sonicdicom", {
    method: "POST",
    body: JSON.stringify({ filters }),
  });
}

export async function queueFullReportingBoardSonicDicomResync(): Promise<{ ok: true; queued: number; requestedAt: string }> {
  return api("/doctor/reporting-board/resync-sonicdicom", { method: "POST" });
}

export async function fetchFullReportingBoardSonicDicomResyncStatus(requestedAt: string): Promise<{ ok: true; remaining: number; failed: number }> {
  return api(`/doctor/reporting-board/resync-sonicdicom/status?requestedAt=${encodeURIComponent(requestedAt)}`);
}

export async function fetchReportingBoardMobileView(token: string, filters: ReportingBoardFilters = {}): Promise<ReportingBoardMobileResponse> {
  const params = reportingBoardParams(filters);
  const query = params.toString();
  return api<ReportingBoardMobileResponse>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile${query ? `?${query}` : ""}`);
}

export async function fetchReportingBoardMobileCase(token: string, appointmentId: number, filters: ReportingBoardFilters = {}): Promise<{ case: ReportingBoardMobileResponse["cases"][number]; savedView: ReportingBoardMobileResponse["savedView"]; allowedActions: ReportingBoardMobileResponse["allowedActions"]; refreshedAt: string }> {
  const params = reportingBoardParams(filters);
  const query = params.toString();
  return api<{ case: ReportingBoardMobileResponse["cases"][number]; savedView: ReportingBoardMobileResponse["savedView"]; allowedActions: ReportingBoardMobileResponse["allowedActions"]; refreshedAt: string }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/cases/${appointmentId}${query ? `?${query}` : ""}`);
}

export async function fetchReportingBoardMobilePushConfig(token: string): Promise<ReportingBoardPushConfig> {
  const raw = await api<{ config: ReportingBoardPushConfig }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/push-config`);
  return raw.config;
}

export async function subscribeReportingBoardMobilePush(token: string, subscription: PushSubscriptionJSON): Promise<{ subscriptionId: number }> {
  return api<{ subscriptionId: number }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/push-subscribe`, {
    method: "POST",
    body: JSON.stringify({ subscription }),
  });
}

export async function unsubscribeReportingBoardMobilePush(token: string, subscription: PushSubscriptionJSON): Promise<{ disabled: boolean }> {
  return api<{ disabled: boolean }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/push-unsubscribe`, {
    method: "POST",
    body: JSON.stringify({ subscription }),
  });
}

export async function fetchReportingBoardMobilePushStatus(token: string, subscription: PushSubscriptionJSON): Promise<{ enabled: boolean; lastSuccessAt: string | null }> {
  return api<{ enabled: boolean; lastSuccessAt: string | null }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/push-status`, {
    method: "POST",
    body: JSON.stringify({ subscription }),
  });
}

export async function sendReportingBoardMobileTestPush(token: string, subscription: PushSubscriptionJSON): Promise<{ attempted: number; sent: number; failed: number }> {
  return api<{ attempted: number; sent: number; failed: number }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/test-push`, { method: "POST", body: JSON.stringify({ subscription }) });
}

type ReportingBoardMobileCaseIdentity =
  | { caseType: "appointment"; appointmentId: number }
  | { caseType: "comparison"; comparisonRequestId: number };

export async function assignReportingBoardMobileCaseToMe(token: string, identity: ReportingBoardMobileCaseIdentity): Promise<{ assignmentId: number }> {
  return api<{ assignmentId: number }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/assign-to-me`, {
    method: "POST",
    body: JSON.stringify(identity),
  });
}

export async function reassignReportingBoardMobileCase(token: string, identity: ReportingBoardMobileCaseIdentity, doctorId: number, reason: string): Promise<{ assignmentId: number }> {
  return api<{ assignmentId: number }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/reassign`, {
    method: "POST",
    body: JSON.stringify({ ...identity, doctorId, reason }),
  });
}

export async function unassignReportingBoardMobileCase(token: string, identity: ReportingBoardMobileCaseIdentity, reason: string): Promise<{ unassigned: true; appointmentId?: number; comparisonRequestId?: number; assignmentId: number }> {
  return api<{ unassigned: true; appointmentId?: number; comparisonRequestId?: number; assignmentId: number }>(`/reporting/saved-views/public/${encodeURIComponent(token)}/mobile/unassign`, {
    method: "POST",
    body: JSON.stringify({ ...identity, reason }),
  });
}

export async function fetchReportingBoardSavedViews(): Promise<ReportingBoardSavedView[]> {
  const raw = await api<{ savedViews: ReportingBoardSavedView[] }>("/doctor/reporting-board/saved-views");
  return raw.savedViews;
}

export async function fetchMyDoctorReportingWorklist(): Promise<DoctorReportingWorklistSummary> {
  const raw = await api<{ worklist: DoctorReportingWorklistSummary }>("/doctor/reporting-board/doctor-worklists/me");
  return raw.worklist;
}

export async function fetchDoctorReportingWorklists(): Promise<DoctorReportingWorklistSummary[]> {
  const raw = await api<{ worklists: DoctorReportingWorklistSummary[] }>("/doctor/reporting-board/doctor-worklists");
  return raw.worklists;
}

export async function updateDoctorReportingWorklist(
  id: number,
  payload: { active?: boolean; expiresAt?: string | null; rotate?: boolean }
): Promise<DoctorReportingWorklistSummary> {
  const raw = await api<{ worklist: DoctorReportingWorklistSummary }>(`/doctor/reporting-board/doctor-worklists/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.worklist;
}

export async function createReportingBoardSavedView(payload: {
  name: string;
  filters: ReportingBoardFilters;
  notificationSettings: ReportingBoardNotificationSettings;
}): Promise<ReportingBoardSavedView> {
  const raw = await api<{ savedView: ReportingBoardSavedView }>("/doctor/reporting-board/saved-views", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.savedView;
}

export async function updateReportingBoardSavedView(
  id: number,
  payload: {
    name?: string;
    filters?: ReportingBoardFilters;
    notificationSettings?: ReportingBoardNotificationSettings;
    active?: boolean;
    expiresAt?: string | null;
  }
): Promise<ReportingBoardSavedView> {
  const raw = await api<{ savedView: ReportingBoardSavedView }>(`/doctor/reporting-board/saved-views/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.savedView;
}

export async function fetchReportingBoardSavedViewByToken(token: string): Promise<ReportingBoardSavedView> {
  const raw = await api<{ savedView: ReportingBoardSavedView }>(`/doctor/reporting-board/saved-views/token/${encodeURIComponent(token)}`);
  return raw.savedView;
}

export async function bulkAssignNextReportingCases(payload: {
  doctorId: number;
  count: number;
  filters?: ReportingBoardFilters | null;
  savedViewId?: number | null;
  token?: string | null;
  unassignedOnly?: boolean | null;
  reason?: string | null;
}): Promise<ReportingBoardBulkAssignResult> {
  return api<ReportingBoardBulkAssignResult>("/doctor/reporting-board/bulk-assign-next", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchReportingBoardBulkAssignmentJobs(): Promise<ReportingBoardBulkAssignmentJob[]> {
  const raw = await api<{ jobs: ReportingBoardBulkAssignmentJob[] }>("/doctor/reporting-board/bulk-assignment-jobs");
  return raw.jobs;
}

export async function createReportingBoardBulkAssignmentJob(payload: CreateReportingBoardBulkAssignmentJobPayload): Promise<ReportingBoardBulkAssignmentJob> {
  const raw = await api<{ job: ReportingBoardBulkAssignmentJob }>("/doctor/reporting-board/bulk-assignment-jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.job;
}

export async function createReportingBoardBulkAssignmentJobs(payload: { jobs: CreateReportingBoardBulkAssignmentJobPayload[] }): Promise<ReportingBoardBulkAssignmentJob[]> {
  const raw = await api<{ jobs: ReportingBoardBulkAssignmentJob[] }>("/doctor/reporting-board/bulk-assignment-jobs/batch", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.jobs;
}

export async function cancelReportingBoardBulkAssignmentJob(id: number): Promise<ReportingBoardBulkAssignmentJob> {
  const raw = await api<{ job: ReportingBoardBulkAssignmentJob }>(`/doctor/reporting-board/bulk-assignment-jobs/${id}/cancel`, { method: "POST" });
  return raw.job;
}

export async function runReportingBoardBulkAssignmentJobNow(id: number): Promise<ReportingBoardBulkAssignmentJob> {
  const raw = await api<{ job: ReportingBoardBulkAssignmentJob }>(`/doctor/reporting-board/bulk-assignment-jobs/${id}/run-now`, { method: "POST" });
  return raw.job;
}

export async function resumeReportingBoardBulkAssignmentJob(id: number): Promise<{ job: ReportingBoardBulkAssignmentJob; jobs: ReportingBoardBulkAssignmentJob[] }> {
  return api<{ job: ReportingBoardBulkAssignmentJob; jobs: ReportingBoardBulkAssignmentJob[] }>(`/doctor/reporting-board/bulk-assignment-jobs/${id}/resume`, { method: "POST" });
}

export async function undoReportingBoardBulkAssignmentJob(id: number): Promise<{ job: ReportingBoardBulkAssignmentJob; result: ReportingBoardBulkUnassignResult }> {
  return api<{ job: ReportingBoardBulkAssignmentJob; result: ReportingBoardBulkUnassignResult }>(`/doctor/reporting-board/bulk-assignment-jobs/${id}/undo`, { method: "POST" });
}

export async function bulkReassignSelectedReportingCases(payload: ReportingBoardBulkReassignSelectedPayload): Promise<ReportingBoardBulkAssignResult> {
  return api<ReportingBoardBulkAssignResult>("/doctor/reporting-board/bulk-reassign-selected", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function bulkUnassignSelectedReportingCases(payload: ReportingBoardBulkUnassignSelectedPayload): Promise<ReportingBoardBulkUnassignResult> {
  return api<ReportingBoardBulkUnassignResult>("/doctor/reporting-board/bulk-unassign-selected", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function assignReportingBoardCase(
  appointmentId: number,
  payload: { doctorId: number; reason?: string | null }
): Promise<{ assignmentId: number }> {
  return api<{ assignmentId: number }>(`/doctor/reporting-board/${appointmentId}/assign-doctor`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function unassignReportingBoardCase(
  appointmentId: number,
  payload: { reason: string }
): Promise<{ unassigned: true; appointmentId: number; assignmentId: number }> {
  return api<{ unassigned: true; appointmentId: number; assignmentId: number }>(`/doctor/reporting-board/${appointmentId}/unassign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function markReportingBoardCaseDiscontinued(
  appointmentId: number,
  payload: { reason: string }
): Promise<{ ok: true; status: string; autoCompletionDisabledMessage?: string }> {
  return api<{ ok: true; status: string; autoCompletionDisabledMessage?: string }>(`/doctor/reporting-board/cases/${appointmentId}/discontinue`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function markReportingBoardCaseManualFinal(
  appointmentId: number,
  payload: { reason: string }
): Promise<{ ok: true; appointmentId: number; status: "manual_final" }> {
  return api<{ ok: true; appointmentId: number; status: "manual_final" }>(`/doctor/reporting-board/cases/${appointmentId}/mark-final`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function clearReportingBoardCaseManualFinal(
  appointmentId: number,
  payload: { reason: string }
): Promise<{ ok: true; appointmentId: number; status: "manual_final_cleared" }> {
  return api<{ ok: true; appointmentId: number; status: "manual_final_cleared" }>(`/doctor/reporting-board/cases/${appointmentId}/clear-manual-final`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function mapComparisonRequest(raw: RawRecord): ComparisonRequest {
  return {
    id: Number(raw.id ?? 0),
    patientId: Number(raw.patientId ?? 0),
    patientMrn: rawString(raw.patientMrn),
    patientEnglishName: rawString(raw.patientEnglishName),
    patientArabicName: rawString(raw.patientArabicName),
    linkedPreviousBookingId: Number(raw.linkedPreviousBookingId ?? 0),
    linkedPreviousStudyUid: rawString(raw.linkedPreviousStudyUid),
    linkedPreviousAccessionNumber: rawString(raw.linkedPreviousAccessionNumber),
    linkedModalityId: rawNumber(raw.linkedModalityId),
    linkedModalityCode: rawString(raw.linkedModalityCode),
    linkedModalityName: rawString(raw.linkedModalityName),
    linkedExamTypeId: rawNumber(raw.linkedExamTypeId),
    linkedExamName: rawString(raw.linkedExamName),
    linkedStudyDate: rawString(raw.linkedStudyDate),
    reason: String(raw.reason ?? ""),
    status: String(raw.status ?? "pending_upload_confirmation") as ComparisonRequest["status"],
    materialsConfirmed: Boolean(raw.materialsConfirmed),
    materialsConfirmedBy: rawNumber(raw.materialsConfirmedBy),
    materialsConfirmedByName: rawString(raw.materialsConfirmedByName),
    materialsConfirmedAt: rawString(raw.materialsConfirmedAt),
    materialsConfirmationNote: rawString(raw.materialsConfirmationNote),
    imageAvailabilityConfirmed: Boolean(raw.imageAvailabilityConfirmed),
    documentsAvailabilityConfirmed: Boolean(raw.documentsAvailabilityConfirmed),
    selectedPriorConfirmed: Boolean(raw.selectedPriorConfirmed),
    assignedDoctorId: rawNumber(raw.assignedDoctorId),
    assignedDoctorName: rawString(raw.assignedDoctorName),
    finalizedBy: rawNumber(raw.finalizedBy),
    finalizedByName: rawString(raw.finalizedByName),
    finalizedAt: rawString(raw.finalizedAt),
    finalText: rawString(raw.finalText),
    createdBy: rawNumber(raw.createdBy),
    createdByName: rawString(raw.createdByName),
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    cancelledBy: rawNumber(raw.cancelledBy),
    cancelledAt: rawString(raw.cancelledAt),
    cancellationReason: rawString(raw.cancellationReason),
    documentCount: Number(raw.documentCount ?? 0),
    remapJobId: rawNumber(raw.remapJobId),
    remapJobStatus: rawString(raw.remapJobStatus),
    remapProcessingStage: rawString(raw.remapProcessingStage),
    remapSendErrorCode: rawString(raw.remapSendErrorCode),
    remapErrorMessage: rawString(raw.remapErrorMessage),
    remapUpdatedAt: rawString(raw.remapUpdatedAt),
  };
}

export async function fetchPreviousCompletedStudies(patientId: number): Promise<PreviousCompletedStudy[]> {
  const raw = await api<{ studies: RawRecord[] }>(`/comparisons/patients/${patientId}/previous-studies`);
  return (raw.studies ?? []).map((study) => ({
    bookingId: Number(study.bookingId ?? 0),
    patientId: Number(study.patientId ?? 0),
    date: String(study.date ?? ""),
    time: rawString(study.time),
    modalityId: Number(study.modalityId ?? 0),
    modalityCode: String(study.modalityCode ?? ""),
    modalityName: String(study.modalityName ?? study.modalityCode ?? ""),
    examTypeId: rawNumber(study.examTypeId),
    examName: rawString(study.examName),
    accessionNumber: String(study.accessionNumber ?? ""),
    studyInstanceUid: rawString(study.studyInstanceUid),
    reportStatus: "unknown",
  }));
}

export async function createComparisonRequest(payload: {
  patientId: number;
  linkedPreviousBookingId: number;
  reason: string;
}): Promise<ComparisonRequest> {
  const raw = await api<{ comparisonRequest: RawRecord }>("/comparisons", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return mapComparisonRequest(raw.comparisonRequest);
}

export async function fetchComparisonRequests(filters: { status?: string | null; q?: string | null } = {}): Promise<ComparisonRequest[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const query = params.size ? `?${params.toString()}` : "";
  const raw = await api<{ comparisonRequests: RawRecord[] }>(`/comparisons${query}`);
  return (raw.comparisonRequests ?? []).map(mapComparisonRequest);
}

export async function fetchComparisonRequest(id: number): Promise<ComparisonRequest> {
  const raw = await api<{ comparisonRequest: RawRecord }>(`/comparisons/${id}`);
  return mapComparisonRequest(raw.comparisonRequest);
}

export async function confirmComparisonMaterials(
  id: number,
  payload: {
    imageAvailabilityConfirmed: boolean;
    documentsAvailabilityConfirmed: boolean;
    selectedPriorConfirmed: boolean;
    materialsConfirmationNote?: string | null;
  }
): Promise<ComparisonRequest> {
  const raw = await api<{ comparisonRequest: RawRecord }>(`/comparisons/${id}/confirm-materials`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return mapComparisonRequest(raw.comparisonRequest);
}

export async function assignComparisonRequest(
  id: number,
  payload: { doctorId: number; reason?: string | null }
): Promise<{ assignmentId: number; comparisonRequestId: number }> {
  return api<{ assignmentId: number; comparisonRequestId: number }>(`/comparisons/${id}/assign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function unassignComparisonRequest(
  id: number,
  payload: { reason: string }
): Promise<{ unassigned: true; comparisonRequestId: number; assignmentId: number }> {
  return api<{ unassigned: true; comparisonRequestId: number; assignmentId: number }>(`/comparisons/${id}/unassign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function finalizeComparisonRequest(id: number, payload: { finalText: string }): Promise<ComparisonRequest> {
  const raw = await api<{ comparisonRequest: RawRecord }>(`/comparisons/${id}/finalize`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return mapComparisonRequest(raw.comparisonRequest);
}

export async function cancelComparisonRequest(id: number, payload: { reason: string }): Promise<ComparisonRequest> {
  const raw = await api<{ comparisonRequest: RawRecord }>(`/comparisons/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return mapComparisonRequest(raw.comparisonRequest);
}

export async function fetchReportingBoardNotifications(): Promise<ReportingBoardNotificationEvent[]> {
  const raw = await api<{ notifications: ReportingBoardNotificationEvent[] }>("/doctor/reporting-board/notifications");
  return raw.notifications;
}

export async function markReportingBoardNotificationRead(id: number): Promise<ReportingBoardNotificationEvent> {
  const raw = await api<{ notification: ReportingBoardNotificationEvent }>(`/doctor/reporting-board/notifications/${id}/read`, {
    method: "POST",
  });
  return raw.notification;
}

export async function dismissReportingBoardNotification(id: number): Promise<ReportingBoardNotificationEvent> {
  const raw = await api<{ notification: ReportingBoardNotificationEvent }>(`/doctor/reporting-board/notifications/${id}/dismiss`, {
    method: "POST",
  });
  return raw.notification;
}

export async function markAllReportingBoardNotificationsRead(): Promise<{ count: number }> {
  return api<{ count: number }>("/doctor/reporting-board/notifications/read-all", { method: "POST" });
}

export async function fetchReportingBoardPushConfig(): Promise<ReportingBoardPushConfig> {
  const raw = await api<{ config: ReportingBoardPushConfig }>("/doctor/reporting-board/push-config");
  return raw.config;
}

export async function subscribeReportingBoardSavedViewPush(savedViewId: number, subscription: PushSubscriptionJSON): Promise<{ subscriptionId: number }> {
  return api<{ subscriptionId: number }>(`/doctor/reporting-board/saved-views/${savedViewId}/push-subscribe`, {
    method: "POST",
    body: JSON.stringify({ subscription }),
  });
}

export async function sendReportingBoardSavedViewTestPush(savedViewId: number): Promise<{ attempted: number; sent: number; failed: number }> {
  return api<{ attempted: number; sent: number; failed: number }>(`/doctor/reporting-board/saved-views/${savedViewId}/test-push`, {
    method: "POST",
  });
}

function protocolParams(filters: ProtocolFilters): URLSearchParams {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.modalityId) params.set("modalityId", String(filters.modalityId));
  if (filters.protocolStatus) params.set("protocolStatus", filters.protocolStatus);
  if (filters.unprotocolledOnly) params.set("unprotocolledOnly", "true");
  if (filters.requiresReport !== null && filters.requiresReport !== undefined) params.set("requiresReport", String(filters.requiresReport));
  if (filters.caseCategory) params.set("caseCategory", filters.caseCategory);
  return params;
}

export async function fetchProtocolTasks(filters: ProtocolFilters): Promise<ProtocolTask[]> {
  const raw = await api<{ tasks: ProtocolTask[] }>(`/doctor/protocols/tasks?${protocolParams(filters).toString()}`);
  return raw.tasks;
}

export async function fetchProtocolDetails(appointmentId: number): Promise<ProtocolDetails> {
  return api<ProtocolDetails>(`/doctor/protocols/${appointmentId}`);
}

export async function saveProtocolDraft(appointmentId: number, payload: ProtocolPayload): Promise<AppointmentProtocol> {
  const raw = await api<{ protocol: AppointmentProtocol }>(`/doctor/protocols/${appointmentId}`, {
    method: "POST",
    body: JSON.stringify({ ...payload, protocolStatus: payload.protocolStatus ?? "draft" }),
  });
  return raw.protocol;
}

export async function assignProtocol(appointmentId: number, payload: ProtocolPayload): Promise<AppointmentProtocol> {
  const raw = await api<{ protocol: AppointmentProtocol }>(`/doctor/protocols/${appointmentId}/assign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.protocol;
}

export async function requestProtocolClarification(appointmentId: number, payload: ProtocolPayload): Promise<AppointmentProtocol> {
  const raw = await api<{ protocol: AppointmentProtocol }>(`/doctor/protocols/${appointmentId}/clarification`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.protocol;
}

export async function cancelProtocol(appointmentId: number, payload: ProtocolPayload): Promise<AppointmentProtocol> {
  const raw = await api<{ protocol: AppointmentProtocol }>(`/doctor/protocols/${appointmentId}/cancel`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.protocol;
}

export async function fetchProtocolAudit(appointmentId: number): Promise<ProtocolAuditTimelineEvent[]> {
  const raw = await api<{ audit: ProtocolAuditTimelineEvent[] }>(`/doctor/protocols/${appointmentId}/audit`);
  return raw.audit;
}

function protocolingParams(filters: DoctorProtocolingFilters): URLSearchParams {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.modality) params.set("modality", filters.modality);
  if (filters.protocolStatus && filters.protocolStatus !== "ALL") params.set("protocolStatus", filters.protocolStatus);
  if (filters.search) params.set("search", filters.search);
  return params;
}

export async function fetchDoctorProtocolingAppointments(filters: DoctorProtocolingFilters): Promise<DoctorProtocolingAppointment[]> {
  const raw = await api<{ appointments: DoctorProtocolingAppointment[] }>(`/doctor/protocoling/appointments?${protocolingParams(filters).toString()}`);
  return raw.appointments;
}

export async function fetchDoctorProtocolingAppointmentDetail(appointmentId: number): Promise<DoctorProtocolingAppointmentDetail> {
  const raw = await api<{ detail: DoctorProtocolingAppointmentDetail }>(`/doctor/protocoling/appointments/${appointmentId}`);
  return raw.detail;
}

export async function createDoctorProtocolAssignment(appointmentId: number, payload: ProtocolAssignmentPayload): Promise<DoctorProtocolingAppointmentDetail> {
  const raw = await api<{ detail: DoctorProtocolingAppointmentDetail }>(`/doctor/protocoling/appointments/${appointmentId}/assignment`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.detail;
}

export async function updateDoctorProtocolAssignment(appointmentId: number, payload: ProtocolAssignmentPayload): Promise<DoctorProtocolingAppointmentDetail> {
  const raw = await api<{ detail: DoctorProtocolingAppointmentDetail }>(`/doctor/protocoling/appointments/${appointmentId}/assignment`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.detail;
}

export async function updateDoctorProtocolReportRequirement(
  appointmentId: number,
  requiresReport: boolean
): Promise<{ booking: { requiresReport: boolean } }> {
  return api<{ booking: { requiresReport: boolean } }>(`/doctor/protocoling/appointments/${appointmentId}/report-requirement`, {
    method: "PATCH",
    body: JSON.stringify({ requiresReport }),
  });
}

export async function cancelDoctorProtocolAssignment(appointmentId: number): Promise<DoctorProtocolingAppointmentDetail> {
  const raw = await api<{ detail: DoctorProtocolingAppointmentDetail }>(`/doctor/protocoling/appointments/${appointmentId}/assignment`, {
    method: "DELETE",
  });
  return raw.detail;
}

export async function fetchProtocolLibraryAnatomyRegions(): Promise<ProtocolAnatomyRegion[]> {
  const raw = await api<{ anatomyRegions: ProtocolAnatomyRegion[] }>("/doctor/protocol-library/anatomy-regions");
  return raw.anatomyRegions;
}

export async function fetchProtocolLibraryScanners(): Promise<ImagingScanner[]> {
  const raw = await api<{ scanners: ImagingScanner[] }>("/doctor/protocol-library/scanners");
  return raw.scanners;
}

export async function fetchProtocolLibraryCtPhasePresets(): Promise<CtPhasePreset[]> {
  const raw = await api<{ ctPhasePresets: CtPhasePreset[] }>("/doctor/protocol-library/ct-phase-presets");
  return raw.ctPhasePresets;
}

export async function fetchProtocolLibraryMriSequencePresets(): Promise<MriSequencePreset[]> {
  const raw = await api<{ mriSequencePresets: MriSequencePreset[] }>("/doctor/protocol-library/mri-sequence-presets");
  return raw.mriSequencePresets;
}

export type MriSequenceImportInspect = {
  format: "xlsx";
  sheets: Array<{ sheetName: string; columns: string[]; requiredColumns: string[]; missingRequiredColumns: string[]; rowCount: number }>;
};

export type MriSequenceImportPreview = {
  sequenceRows: Array<{ rowNumber: number; sequenceKey: string; sequenceName: string; action: "create_sequence" | "update_sequence" | "unchanged" | "invalid"; errors: string[] }>;
  aliasRows: Array<{ rowNumber: number; sequenceKey: string; scannerDisplayName: string; vendorSequenceName: string; action: "create_alias" | "update_alias" | "unchanged" | "invalid"; errors: string[] }>;
  canConfirm: boolean;
};

export type MriSequenceImportSummary = {
  createdSequences: number;
  updatedSequences: number;
  unchangedSequences: number;
  createdAliases: number;
  updatedAliases: number;
  unchangedAliases: number;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function downloadProtocolLibraryWorkbook(path: string, fallbackFilename: string) {
  const response = await fetch(`/api/doctor/protocol-library/${path}`, { credentials: "include" });
  if (!response.ok) throw new Error("Workbook download failed");
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="?([^"]+)"?/i)?.[1] || fallbackFilename;
  downloadBlob(await response.blob(), filename);
}

export function downloadMriSequenceImportTemplate() {
  return downloadProtocolLibraryWorkbook("mri-sequence-presets/import-template.xlsx", "rispro-mri-sequence-import-template.xlsx");
}

export function exportMriSequencePresetsWorkbook() {
  return downloadProtocolLibraryWorkbook("mri-sequence-presets/export.xlsx", "rispro-mri-sequences.xlsx");
}

export async function inspectMriSequenceImport(payload: { fileContentBase64: string; fileName?: string | null }): Promise<MriSequenceImportInspect> {
  return api<MriSequenceImportInspect>("/doctor/protocol-library/mri-sequence-presets/import/inspect", {
    method: "POST",
    body: JSON.stringify(payload),
  }, MRI_SEQUENCE_IMPORT_TIMEOUT_MS);
}

export async function previewMriSequenceImport(payload: { fileContentBase64: string; fileName?: string | null }): Promise<MriSequenceImportPreview> {
  return api<MriSequenceImportPreview>("/doctor/protocol-library/mri-sequence-presets/import/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  }, MRI_SEQUENCE_IMPORT_TIMEOUT_MS);
}

export async function confirmMriSequenceImport(payload: { fileContentBase64: string; fileName?: string | null }): Promise<MriSequenceImportSummary> {
  const raw = await api<{ summary: MriSequenceImportSummary }>("/doctor/protocol-library/mri-sequence-presets/import/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  }, MRI_SEQUENCE_IMPORT_TIMEOUT_MS);
  return raw.summary;
}

export async function fetchProtocolLibraryProtocols(): Promise<ProtocolLibraryProtocol[]> {
  const raw = await api<{ protocols: ProtocolLibraryProtocol[] }>("/doctor/protocol-library/protocols");
  return raw.protocols;
}

export async function fetchProtocolLibraryProtocolDetail(id: number): Promise<ProtocolLibraryProtocol> {
  const raw = await api<{ detail: ProtocolLibraryProtocol }>(`/doctor/protocol-library/protocols/${id}`);
  return raw.detail;
}

export async function fetchProtocolLibraryVersionDetail(versionId: number): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}`);
  return raw.detail;
}

export type ProtocolAnatomyRegionPayload = Pick<ProtocolAnatomyRegion, "name" | "bodySystem" | "modalityScope" | "defaultCoverageNote" | "isActive">;
export type ImagingScannerPayload = Pick<ImagingScanner, "name" | "modality" | "vendor" | "model" | "fieldStrength" | "ctSliceDetectorSpecification" | "location" | "notes" | "isActive">;
export type CtPhasePresetPayload = Pick<CtPhasePreset, "name" | "contrastStatus" | "timingType" | "delaySeconds" | "bolusTrackingSite" | "triggerHu" | "defaultCoverage" | "reconstructionNotes" | "instructions" | "isActive">;
export type MriSequencePresetPayload = Pick<MriSequencePreset, "scannerId" | "vendor" | "name" | "vendorSequenceName" | "genericFamily" | "weighting" | "defaultPlane" | "fatSuppression" | "acquisitionType" | "contrastRelation" | "defaultCoverage" | "defaultBValues" | "defaultDynamicTiming" | "estimatedScanTimeMinutes" | "notes" | "isActive"> & {
  scannerAliases?: Array<Pick<NonNullable<MriSequencePreset["scannerAliases"]>[number], "scannerId" | "vendorSequenceName" | "notes">>;
};
export type ProtocolLibraryProtocolPayload = Pick<ProtocolLibraryProtocol, "name" | "modality" | "anatomyRegionId" | "category" | "indication" | "contrastPolicy" | "oralContrastPolicy" | "bowelPreparation" | "preparationNotes"> & { changeSummary?: string | null };
export type ProtocolLibraryProtocolPatch = Partial<Pick<ProtocolLibraryProtocol, "name" | "anatomyRegionId" | "category" | "indication" | "contrastPolicy" | "oralContrastPolicy" | "bowelPreparation" | "preparationNotes" | "isActive">>;
export type ProtocolLibraryCtPhaseRowPayload = Pick<ProtocolLibraryCtPhaseRow, "ctPhasePresetId" | "customPhaseName" | "timingOverride" | "coverageOverride" | "reconstructionOverride" | "instructionsOverride" | "isRequired">;
export type ProtocolLibraryMriSequenceRowPayload = Pick<ProtocolLibraryMriSequenceRow, "scannerId" | "mriSequencePresetId" | "planeOverride" | "coverageOverride" | "bValuesOverride" | "timingOverride" | "notesOverride" | "isRequired">;

export async function createProtocolLibraryProtocol(
  payload: ProtocolLibraryProtocolPayload
): Promise<{ protocol: ProtocolLibraryProtocol; version: ProtocolLibraryVersion }> {
  return api<{ protocol: ProtocolLibraryProtocol; version: ProtocolLibraryVersion }>("/doctor/protocol-library/protocols", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProtocolLibraryProtocol(id: number, payload: ProtocolLibraryProtocolPatch): Promise<ProtocolLibraryProtocol> {
  const raw = await api<{ protocol: ProtocolLibraryProtocol }>(`/doctor/protocol-library/protocols/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.protocol;
}

export async function updateProtocolLibraryVersion(versionId: number, payload: { changeSummary?: string | null }): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.detail;
}

export async function activateProtocolLibraryVersion(versionId: number): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/activate`, {
    method: "POST",
  });
  return raw.detail;
}

export async function createProtocolLibraryDraftFromActive(protocolId: number): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocols/${protocolId}/draft-from-active`, {
    method: "POST",
  });
  return raw.detail;
}

export async function createProtocolLibraryCtPhaseRow(versionId: number, payload: ProtocolLibraryCtPhaseRowPayload): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/ct-phases`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.detail;
}

export async function updateProtocolLibraryCtPhaseRow(versionId: number, rowId: number, payload: Partial<ProtocolLibraryCtPhaseRowPayload>): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/ct-phases/${rowId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.detail;
}

export async function deleteProtocolLibraryCtPhaseRow(versionId: number, rowId: number): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/ct-phases/${rowId}`, {
    method: "DELETE",
  });
  return raw.detail;
}

export async function reorderProtocolLibraryCtPhaseRows(versionId: number, rowIds: number[]): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/ct-phases/reorder`, {
    method: "POST",
    body: JSON.stringify({ rowIds }),
  });
  return raw.detail;
}

export async function createProtocolLibraryMriSequenceRow(versionId: number, payload: ProtocolLibraryMriSequenceRowPayload): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/mri-sequences`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.detail;
}

export async function updateProtocolLibraryMriSequenceRow(versionId: number, rowId: number, payload: Partial<ProtocolLibraryMriSequenceRowPayload>): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/mri-sequences/${rowId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.detail;
}

export async function deleteProtocolLibraryMriSequenceRow(versionId: number, rowId: number): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/mri-sequences/${rowId}`, {
    method: "DELETE",
  });
  return raw.detail;
}

export async function reorderProtocolLibraryMriSequenceRows(versionId: number, rowIds: number[]): Promise<ProtocolLibraryVersionDetail> {
  const raw = await api<{ detail: ProtocolLibraryVersionDetail }>(`/doctor/protocol-library/protocol-versions/${versionId}/mri-sequences/reorder`, {
    method: "POST",
    body: JSON.stringify({ rowIds }),
  });
  return raw.detail;
}

export async function createProtocolLibraryAnatomyRegion(payload: ProtocolAnatomyRegionPayload): Promise<ProtocolAnatomyRegion> {
  const raw = await api<{ anatomyRegion: ProtocolAnatomyRegion }>("/doctor/protocol-library/anatomy-regions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.anatomyRegion;
}

export async function updateProtocolLibraryAnatomyRegion(id: number, payload: Partial<ProtocolAnatomyRegionPayload>): Promise<ProtocolAnatomyRegion> {
  const raw = await api<{ anatomyRegion: ProtocolAnatomyRegion }>(`/doctor/protocol-library/anatomy-regions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.anatomyRegion;
}

export async function createProtocolLibraryScanner(payload: ImagingScannerPayload): Promise<ImagingScanner> {
  const raw = await api<{ scanner: ImagingScanner }>("/doctor/protocol-library/scanners", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.scanner;
}

export async function updateProtocolLibraryScanner(id: number, payload: Partial<ImagingScannerPayload>): Promise<ImagingScanner> {
  const raw = await api<{ scanner: ImagingScanner }>(`/doctor/protocol-library/scanners/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.scanner;
}

export async function createProtocolLibraryCtPhasePreset(payload: CtPhasePresetPayload): Promise<CtPhasePreset> {
  const raw = await api<{ ctPhasePreset: CtPhasePreset }>("/doctor/protocol-library/ct-phase-presets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.ctPhasePreset;
}

export async function updateProtocolLibraryCtPhasePreset(id: number, payload: Partial<CtPhasePresetPayload>): Promise<CtPhasePreset> {
  const raw = await api<{ ctPhasePreset: CtPhasePreset }>(`/doctor/protocol-library/ct-phase-presets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.ctPhasePreset;
}

export async function createProtocolLibraryMriSequencePreset(payload: MriSequencePresetPayload): Promise<MriSequencePreset> {
  const raw = await api<{ mriSequencePreset: MriSequencePreset }>("/doctor/protocol-library/mri-sequence-presets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.mriSequencePreset;
}

export async function updateProtocolLibraryMriSequencePreset(id: number, payload: Partial<MriSequencePresetPayload>): Promise<MriSequencePreset> {
  const raw = await api<{ mriSequencePreset: MriSequencePreset }>(`/doctor/protocol-library/mri-sequence-presets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.mriSequencePreset;
}

function workloadParams(filters: WorkloadFilters): URLSearchParams {
  const params = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate });
  if (filters.modalityId) params.set("modalityId", String(filters.modalityId));
  if (filters.rosterAssignmentId) params.set("rosterAssignmentId", String(filters.rosterAssignmentId));
  if (filters.teamName) params.set("teamName", filters.teamName);
  if (filters.caseCategory) params.set("caseCategory", filters.caseCategory);
  if (filters.requiresReport !== null && filters.requiresReport !== undefined) params.set("requiresReport", String(filters.requiresReport));
  return params;
}

export async function fetchTeamWorkloadSummary(filters: WorkloadFilters): Promise<TeamWorkloadSummaryRow[]> {
  const raw = await api<{ summary: TeamWorkloadSummaryRow[] }>(`/doctor/workload/summary?${workloadParams(filters).toString()}`);
  return raw.summary;
}

export async function runWorkloadCalculation(payload: { startDate: string; endDate: string; modalityId?: number | null }): Promise<WorkloadCalculationSummary> {
  const raw = await api<{ summary: WorkloadCalculationSummary }>("/doctor/workload/calculate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.summary;
}

export async function fetchWorkloadCatalog(): Promise<WorkloadCatalogRule[]> {
  const raw = await api<{ catalog: WorkloadCatalogRule[] }>("/doctor/workload/catalog");
  return raw.catalog;
}

export async function createWorkloadCatalogRule(payload: Omit<WorkloadCatalogRule, "id" | "active"> & { active?: boolean }): Promise<WorkloadCatalogRule> {
  const raw = await api<{ rule: WorkloadCatalogRule }>("/doctor/workload/catalog", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.rule;
}

export async function updateWorkloadCatalogRule(id: number, payload: Partial<Omit<WorkloadCatalogRule, "id">>): Promise<WorkloadCatalogRule> {
  const raw = await api<{ rule: WorkloadCatalogRule }>(`/doctor/workload/catalog/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return raw.rule;
}

export async function deactivateWorkloadCatalogRule(id: number): Promise<WorkloadCatalogRule> {
  const raw = await api<{ rule: WorkloadCatalogRule }>(`/doctor/workload/catalog/${id}/deactivate`, { method: "POST" });
  return raw.rule;
}

export async function fetchRegistrationProtocolAssignment(appointmentId: number): Promise<ModalityProtocolAssignment | null> {
  const raw = await api<{ assignment: RawRecord | null }>(`/v2/read/registrations/appointments/${appointmentId}/protocol-assignment`);
  return raw.assignment ? mapModalityProtocolAssignment(raw.assignment) : null;
}

export async function fetchProtocolingPatientHistory(appointmentId: number): Promise<ProtocolingPatientHistoryResponse> {
  return api<ProtocolingPatientHistoryResponse>(`/doctor/protocoling/appointments/${appointmentId}/history`);
}
export async function requestProtocolingPatientIdentityReconciliation(appointmentId:number,studyInstanceUid:string,accessionNumber:string|null){return api<{job:{id:number;status:string}}>(`/doctor/protocoling/appointments/${appointmentId}/history/patient-identity-reconciliation`,{method:"POST",body:JSON.stringify({studyInstanceUid,accessionNumber})});}

export async function fetchProtocolingHistoricalPacsCandidates(appointmentId: number): Promise<ProtocolingHistoricalPacsCandidatesResponse> {
  return api<ProtocolingHistoricalPacsCandidatesResponse>(`/doctor/protocoling/appointments/${appointmentId}/history/historical-candidates`);
}

export async function searchProtocolingHistoricalPacsPatientId(appointmentId: number, patientId: string): Promise<HistoricalPacsCandidate[]> {
  const raw = await api<{ candidates: HistoricalPacsCandidate[] }>(`/doctor/protocoling/appointments/${appointmentId}/history/old-patient-id`, {
    method: "POST",
    body: JSON.stringify({ patientId: patientId.trim() }),
  });
  return raw.candidates;
}

export async function openProtocolingSonicDicom(appointmentId: number, scope: "study" | "patient"): Promise<void> {
  window.open(`/api/doctor/protocoling/appointments/${appointmentId}/open-sonicdicom?scope=${scope}`, "_blank", "noopener,noreferrer");
}

export async function openProtocolingReport(appointmentId: number): Promise<void> {
  window.open(`/api/doctor/protocoling/appointments/${appointmentId}/open-report`, "_blank", "noopener,noreferrer");
}

export async function listProtocolDocumentAnnotations(documentId: number): Promise<ProtocolDocumentAnnotation[]> {
  const raw = await api<{ annotations: ProtocolDocumentAnnotation[] }>(`/doctor/protocoling/documents/${documentId}/annotations`);
  return raw.annotations;
}

export async function createProtocolDocumentAnnotation(documentId: number, payload: {
  pageNumber: number;
  annotationType: ProtocolDocumentAnnotationType;
  geometry: Record<string, unknown>;
  textContent?: string | null;
  style?: Record<string, unknown> | null;
}): Promise<ProtocolDocumentAnnotation> {
  const raw = await api<{ annotation: ProtocolDocumentAnnotation }>(`/doctor/protocoling/documents/${documentId}/annotations`, { method: "POST", body: JSON.stringify(payload) });
  return raw.annotation;
}

export async function updateProtocolDocumentAnnotation(documentId: number, annotationId: number, payload: {
  pageNumber: number;
  annotationType: ProtocolDocumentAnnotationType;
  geometry: Record<string, unknown>;
  textContent?: string | null;
  style?: Record<string, unknown> | null;
}): Promise<ProtocolDocumentAnnotation> {
  const raw = await api<{ annotation: ProtocolDocumentAnnotation }>(`/doctor/protocoling/documents/${documentId}/annotations/${annotationId}`, { method: "PATCH", body: JSON.stringify(payload) });
  return raw.annotation;
}

export async function deleteProtocolDocumentAnnotation(documentId: number, annotationId: number): Promise<void> {
  await api(`/doctor/protocoling/documents/${documentId}/annotations/${annotationId}`, { method: "DELETE" });
}
