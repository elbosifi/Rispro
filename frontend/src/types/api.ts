/* Re-export backend types so the frontend has a single source of truth */
export type Role =
  | "receptionist"
  | "supervisor"
  | "super_admin"
  | "modality_staff"
  | "doctor"
  | "administrative";

export type AppointmentStatus =
  | "scheduled"
  | "arrived"
  | "waiting"
  | "in-progress"
  | "completed"
  | "discontinued"
  | "no-show"
  | "cancelled"
  | "voided";

export type QueueStatus = "waiting" | "called" | "in-progress" | "removed";

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  recentSupervisorReauth?: boolean;
  mustChangePassword?: boolean;
  canRequestSchedulingOverride?: boolean;
}

export interface AuthSession {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  recentSupervisorReauth?: boolean;
  mustChangePassword?: boolean;
}

export type DoctorProfileRole = "consultant" | "specialist" | "senior_house_officer" | "resident";
export type DoctorModuleCapability = "doctor" | "doctor_supervisor" | "doctor_admin";

export interface DoctorProfile {
  id: number;
  userId: number;
  username?: string | null;
  fullName?: string | null;
  coreRole?: Role | string | null;
  userActive?: boolean | null;
  displayName: string;
  doctorRole: DoctorProfileRole;
  active: boolean;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DoctorModalityPermission {
  id: number;
  doctorId: number;
  modalityId: number;
  modalityCode: string | null;
  modalityNameEn: string | null;
  modalityNameAr: string | null;
  canProtocol: boolean;
  canReport: boolean;
  canSupervise: boolean;
  active: boolean;
}

export interface DoctorMe {
  hasActiveDoctorProfile: boolean;
  profile: DoctorProfile | null;
  isSuperAdmin?: boolean;
  canAccessDoctorPortal?: boolean;
  canAccessClinicalDoctorPortal?: boolean;
  canAccessDoctorAdmin?: boolean;
  canManageDoctorProfiles?: boolean;
  doctorPortalAutoRedirect?: boolean;
  doctorRole: DoctorProfileRole | null;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
  allowedModalities: DoctorModalityPermission[];
  moduleCapabilities: DoctorModuleCapability[];
  canAccessCoreWorkspace: boolean;
}

export type RosterWeekStatus = "draft" | "published" | "archived";
export type RosterDutyType = string;
export type RosterTeamRole = "lead" | "specialist" | "sho" | "supervisor" | "observer";

export interface DoctorRosterWeek {
  id: number;
  weekStartDate: string;
  weekEndDate: string;
  status: RosterWeekStatus;
  createdBy: number | null;
  publishedBy: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DoctorRosterMember {
  id: number;
  rosterAssignmentId: number;
  doctorId: number;
  displayName: string;
  doctorRole: string;
  teamRole: RosterTeamRole;
}

export type AvailabilityStatus =
  | "available"
  | "unavailable"
  | "preferred"
  | "not_preferred"
  | "leave"
  | "conference"
  | "admin"
  | "teaching"
  | "on_call";

export type LeaveType =
  | "annual_leave"
  | "sick_leave"
  | "conference"
  | "study_leave"
  | "admin_leave"
  | "emergency_absence";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface DoctorAvailability {
  id: number;
  doctorId: number;
  doctorName: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  availabilityStatus: AvailabilityStatus;
  note: string | null;
}

export interface DoctorLeaveRequest {
  id: number;
  doctorId: number;
  doctorName: string | null;
  startDate: string;
  endDate: string;
  leaveType: LeaveType;
  status: LeaveStatus;
  reason: string | null;
}

export type RosterConflictSeverity = "error" | "warning" | "info";

export interface RosterConflict {
  assignmentId: number | null;
  memberId: number | null;
  doctorId: number | null;
  severity: RosterConflictSeverity;
  code: string;
  message: string;
}

export type RosterTemplateType = "ct_weekly" | "mri_weekly" | "ultrasound_weekly" | "mammography_weekly" | "mixed_weekly" | "custom";
export type RosterTemplateCopyMode = "structure_only" | "structure_with_named_doctors";

export interface RosterTemplateMember {
  id: number;
  templateAssignmentId: number;
  doctorId: number | null;
  doctorName: string | null;
  teamRole: RosterTeamRole;
  placeholderLabel: string | null;
  requiredRole: string | null;
}

export interface RosterTemplateAssignment {
  id: number;
  templateId: number;
  dayOfWeek: number;
  modalityId: number | null;
  modalityCode: string | null;
  modalityNameEn: string | null;
  modalityNameAr: string | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
  startTime: string | null;
  endTime: string | null;
  teamName: string;
  sortOrder: number;
  members: RosterTemplateMember[];
}

export interface RosterTemplate {
  id: number;
  name: string;
  description: string | null;
  modalityId: number | null;
  modalityCode: string | null;
  modalityNameEn: string | null;
  modalityNameAr: string | null;
  templateType: RosterTemplateType;
  active: boolean;
  assignments: RosterTemplateAssignment[];
}

export interface ApplyRosterTemplateResult {
  week: DoctorRosterWeek;
  createdAssignmentCount: number;
  copiedMemberCount: number;
  skippedCount: number;
  conflicts: RosterConflict[];
}

export type RosterBalanceStrategy = "simple" | "preserve_previous" | "least_assigned";

export interface GenerateDraftRosterResult {
  week: DoctorRosterWeek;
  assignmentsCreated: number;
  membersAssigned: number;
  conflicts: RosterConflict[];
  unfilledRequirements: string[];
  warnings: string[];
}

export interface RosterNotification {
  id: number;
  rosterWeekId: number;
  doctorId: number;
  doctorName: string;
  notificationType: "roster_published";
  status: "created" | "sent" | "failed";
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface RosterNotificationSummary {
  createdCount: number;
  alreadyExistingCount: number;
  notifications: RosterNotification[];
}

export interface DoctorRosterAssignment {
  id: number;
  rosterWeekId: number;
  date: string;
  modalityId: number | null;
  modalityCode: string | null;
  modalityNameEn: string | null;
  modalityNameAr: string | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
  startTime: string | null;
  endTime: string | null;
  teamName: string;
  status: "active" | "cancelled";
  members: DoctorRosterMember[];
}

export interface DoctorRosterResponse {
  week: DoctorRosterWeek | null;
  assignments: DoctorRosterAssignment[];
}

export type CaseAssignmentStatus = "active" | "superseded" | "corrected" | "cancelled";
export type CaseAssignmentType = "imaging" | "protocol" | "reporting" | "ultrasound_operator" | "mammography_episode";

export interface RosterDutyTypeConfig {
  code: string;
  label: string;
  active: boolean;
  requiresSpecialist: boolean;
  sortOrder: number;
}

export interface RosterShiftImportMapping {
  id: number;
  sourceSystem: string;
  sourceShiftName: string | null;
  sourceShiftType: string | null;
  sourceShiftAbbreviation: string | null;
  dutyTypeCode: string;
  modalityId: number | null;
  modalityName: string | null;
  teamName: string | null;
  active: boolean;
}

export interface RosterXmlImportPreview {
  doctorsMatched: string[];
  doctorsToCreate: string[];
  dutySlotsToCreate: Array<{
    doctorName: string | null;
    date: string | null;
    shiftName: string | null;
    shiftType: string | null;
    abbreviation: string | null;
    dutyTypeCode: string | null;
    modalityId: number | null;
    teamName: string | null;
  }>;
  unmappedShiftTypes: string[];
  warnings: string[];
  canConfirm: boolean;
}

export interface RosterXmlImportResult {
  createdDoctors: string[];
  importedDutySlotCount: number;
  message: string;
}

export interface DoctorCase {
  appointmentId: number;
  appointmentDate: string;
  appointmentTime: string | null;
  patientId: number;
  patientMrn: string | null;
  patientNationalId: string | null;
  patientArabicName: string | null;
  patientEnglishName: string | null;
  modalityId: number;
  modalityCode: string | null;
  modalityName: string | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  requiresReport: boolean;
  appointmentStatus: string;
  rosterAssignmentId: number | null;
  assignedDoctorId: number | null;
  assignedDoctorName: string | null;
  teamName: string | null;
  dutyType: RosterDutyType | null;
  expectedReportingDate: string | null;
  assignmentType: CaseAssignmentType | null;
  assignmentStatus: CaseAssignmentStatus | null;
  workloadPoints: number | null;
  workloadDefaulted: boolean;
  protocolStatus: null;
  reportStatus: null;
}

export interface DoctorCaseFilters {
  dateFrom: string;
  dateTo: string;
  modalityId?: number | null;
  status?: string | null;
  requiresReport?: boolean | null;
  caseCategory?: string | null;
  rosterAssignmentId?: number | null;
}

export interface DoctorCaseAssignmentSummary {
  assignedCount: number;
  alreadyAssignedCount: number;
  unassignedNoRosterCount: number;
  skippedCancelledCount: number;
  errors: Array<{ appointmentId: number; reason: string }>;
}

export type ReportingBoardAssignmentStatus = "all" | "unassigned" | "assigned";
export type ReportingBoardCaseSource = "all" | "appointments" | "comparisons";
export type ReportingBoardReportStatus = "required_not_final" | "final" | "draft" | "no_report" | "study_not_found" | "unavailable" | "all";

export interface ReportingBoardFilters {
  dateFrom?: string | null;
  dateTo?: string | null;
  cutoffDate?: string | null;
  modalityId?: number | null;
  modalityCode?: string | null;
  modalityCodes?: string[] | null;
  assignedDoctorId?: number | null;
  assignmentStatus?: ReportingBoardAssignmentStatus | null;
  caseCategory?: string | null;
  requiresReport?: boolean | null;
  reportStatus?: ReportingBoardReportStatus | null;
  priorityCode?: string | null;
  q?: string | null;
  caseSource?: ReportingBoardCaseSource | null;
  appointmentId?: number | null;
  sortBy?: ReportingBoardSortBy | null;
  sortDirection?: ReportingBoardSortDirection | null;
  pinUrgentToTop?: boolean | null;
  limit?: number | null;
  offset?: number | null;
}

export type ReportingBoardSortBy =
  | "priority_study_date"
  | "study_date"
  | "accession"
  | "patient_name"
  | "mrn"
  | "exam_type"
  | "modality"
  | "assigned_doctor"
  | "longest_unassigned"
  | "longest_assigned_not_final"
  | "oldest_completed";
export type ReportingBoardSortDirection = "asc" | "desc";

export interface ReportingBoardNotificationSettings {
  notifyNewMatchingCases?: boolean;
  notifyAssignedToMe?: boolean;
  notifyReportFinal?: boolean;
  notifyUnassignedUrgent?: boolean;
  notifyOlderThanCutoff?: boolean;
}

export interface ReportingBoardSettings {
  cutoffMode: "fixed_date" | "days_back";
  defaultCutoffDate: string | null;
  daysBack: number;
  enabledModalityCodes: string[];
  defaultRequiresReport: boolean;
  defaultReportStatusFilter: ReportingBoardReportStatus;
}

export interface ReportingBoardSavedView {
  id: number;
  ownerUserId: number | null;
  ownerDoctorId: number | null;
  name: string;
  token: string;
  filters: ReportingBoardFilters;
  notificationSettings: ReportingBoardNotificationSettings;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportingBoardCaseRow {
  caseType: "appointment" | "comparison";
  caseKey: string;
  appointmentId: number;
  comparisonRequestId: number | null;
  patientId: number;
  patientMrn: string | null;
  patientDicomId: string | null;
  patientEnglishName: string | null;
  patientArabicName: string | null;
  accessionNumber: string;
  studyInstanceUid: string | null;
  bookingDate: string;
  bookingTime: string | null;
  modalityId: number;
  modalityCode: string;
  modalityName: string;
  examTypeId: number | null;
  examTypeName: string | null;
  linkedPreviousBookingId: number | null;
  linkedPreviousStudyDate: string | null;
  linkedPreviousAccessionNumber: string | null;
  caseCategory: string;
  appointmentStatus: string;
  requiresReport: boolean;
  reportingPriorityId: number | null;
  reportingPriorityCode: string | null;
  reportingPriorityName: string | null;
  reportingPrioritySortOrder: number | null;
  assignedDoctorId: number | null;
  assignedDoctorName: string | null;
  assignmentStatus: "assigned" | "unassigned";
  completedAt: string | null;
  currentAssignedAt: string | null;
  firstAssignedAt: string | null;
  reportFinalAt: string | null;
  reportStatusCheckedAt: string | null;
  dueAt: string | null;
  completedToAssignedMinutes: number | null;
  assignedToFinalMinutes: number | null;
  completedToFinalMinutes: number | null;
  currentAssignmentAgeMinutes: number | null;
  completedUnassignedAgeMinutes: number | null;
  reportStatus: "final" | "draft" | "no_report" | "study_not_found" | "unavailable";
  canAssign: boolean;
  exclusionReason: string | null;
}

export interface ReportingBoardStatsSummary {
  total: number;
  comparisonRequests: number;
  unassigned: number;
  assigned: number;
  stat: number;
  urgent: number;
  statOrUrgent: number;
  requiredNotFinal: number;
  final: number;
  draft: number;
  noReport: number;
  studyNotFound: number;
  unavailable: number;
  overdue: number;
  ct: number;
  mr: number;
  medianCompletedToAssignedMinutes: number | null;
  medianAssignedToFinalMinutes: number | null;
  p90AssignedToFinalMinutes: number | null;
  longestActiveAssignmentAgeMinutes: number | null;
  completedUnassigned: number;
}

export interface PreviousCompletedStudy {
  bookingId: number;
  patientId: number;
  date: string;
  time: string | null;
  modalityId: number;
  modalityCode: string;
  modalityName: string;
  examTypeId: number | null;
  examName: string | null;
  accessionNumber: string;
  studyInstanceUid: string | null;
  reportStatus: "unknown";
}

export type ComparisonRequestStatus =
  | "pending_upload_confirmation"
  | "ready_for_reporting"
  | "assigned"
  | "finalized"
  | "cancelled";

export interface ComparisonRequest {
  id: number;
  patientId: number;
  patientMrn: string | null;
  patientEnglishName: string | null;
  patientArabicName: string | null;
  linkedPreviousBookingId: number;
  linkedPreviousStudyUid: string | null;
  linkedPreviousAccessionNumber: string | null;
  linkedModalityId: number | null;
  linkedModalityCode: string | null;
  linkedModalityName: string | null;
  linkedExamTypeId: number | null;
  linkedExamName: string | null;
  linkedStudyDate: string | null;
  reason: string;
  status: ComparisonRequestStatus;
  materialsConfirmed: boolean;
  materialsConfirmedBy: number | null;
  materialsConfirmedByName: string | null;
  materialsConfirmedAt: string | null;
  materialsConfirmationNote: string | null;
  imageAvailabilityConfirmed: boolean;
  documentsAvailabilityConfirmed: boolean;
  selectedPriorConfirmed: boolean;
  assignedDoctorId: number | null;
  assignedDoctorName: string | null;
  finalizedBy: number | null;
  finalizedByName: string | null;
  finalizedAt: string | null;
  finalText: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledBy: number | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export interface ReportingBoardDoctorStatsRow {
  doctorId: number | null;
  doctorName: string;
  total: number;
  requiredNotFinal: number;
  statOrUrgent: number;
  oldestStudyDate: string | null;
  ct: number;
  mr: number;
}

export interface ReportingBoardModalityStatsRow {
  modalityCode: string;
  total: number;
  requiredNotFinal: number;
  statOrUrgent: number;
}

export interface ReportingBoardPriorityStatsRow {
  priorityCode: string | null;
  priorityName: string | null;
  total: number;
}

export interface ReportingBoardStatsResponse {
  filters: ReportingBoardFilters;
  summary: ReportingBoardStatsSummary;
  byDoctor: ReportingBoardDoctorStatsRow[];
  byModality: ReportingBoardModalityStatsRow[];
  byPriority: ReportingBoardPriorityStatsRow[];
}

export interface ReportingBoardBulkAssignResult {
  requestedCount: number;
  assignedCount: number;
  skippedCount: number;
  remainingCount?: number;
  assignedAppointmentIds: number[];
  assignedComparisonRequestIds?: number[];
  skipped: Array<{ appointmentId?: number; comparisonRequestId?: number; reason: string }>;
}

export type ReportingBoardBulkAssignmentJobStatus = "scheduled" | "running" | "completed" | "partial" | "failed" | "cancelled";

export interface ReportingBoardBulkAssignmentJob {
  id: number;
  status: ReportingBoardBulkAssignmentJobStatus;
  scheduledFor: string;
  runStartedAt: string | null;
  runCompletedAt: string | null;
  cancelledAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  resumedFromJobId: number | null;
  targetDoctorId: number;
  targetDoctorName: string | null;
  caseCount: number;
  filters: ReportingBoardFilters;
  savedViewId: number | null;
  savedViewName: string | null;
  unassignedOnly: true;
  reason: string | null;
  result: ReportingBoardBulkAssignResult | null;
  lastError: string | null;
  attemptCount: number;
  createdByUserId: number | null;
  createdByDoctorId: number | null;
  createdByName: string | null;
  creatorUserActive: boolean | null;
  creatorAppRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportingBoardBulkAssignmentJobPayload {
  scheduledFor: string;
  doctorId: number;
  count: number;
  filters: ReportingBoardFilters;
  savedViewId?: number | null;
  savedViewName?: string | null;
  resumedFromJobId?: number | null;
  reason?: string | null;
}

export interface ReportingBoardBulkUnassignResult {
  requestedCount: number;
  unassignedCount: number;
  skippedCount: number;
  unassignedAppointmentIds: number[];
  unassignedComparisonRequestIds?: number[];
  skipped: Array<{ appointmentId?: number; comparisonRequestId?: number; reason: string }>;
}

export interface ReportingBoardBulkReassignSelectedPayload {
  appointmentIds: number[];
  comparisonRequestIds?: number[];
  doctorId: number;
  reason?: string | null;
  allowFinal?: boolean;
}

export interface ReportingBoardBulkUnassignSelectedPayload {
  appointmentIds: number[];
  comparisonRequestIds?: number[];
  reason: string;
  allowFinal?: boolean;
}

export interface ReportingBoardNotificationEvent {
  id: number;
  eventType: "reporting_case_assigned_to_me";
  title: string;
  body: string;
  actionUrl: string | null;
  status: "pending" | "delivered" | "read" | "dismissed" | "failed";
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
}

export interface ReportingBoardPushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface ReportingBoardMobileCase {
  caseType: "appointment" | "comparison";
  caseKey: string;
  appointmentId: number;
  comparisonRequestId: number | null;
  patientName: string;
  mrn: string | null;
  accessionNumber: string;
  date: string;
  time: string | null;
  modality: string;
  exam: string | null;
  category: string;
  assignedDoctor: string | null;
  priority: string | null;
  priorityCode: string | null;
  reportStatus: string;
  appointmentStatus: string;
  assignmentStatus: "assigned" | "unassigned";
  canAssign: boolean;
  exclusionReason: string | null;
  linkedPreviousStudyDate?: string | null;
  linkedPreviousAccessionNumber?: string | null;
}

export interface ReportingBoardMobileResponse {
  savedView: { id: number; name: string; token: string };
  filters: ReportingBoardFilters;
  filterSummary: string[];
  counters: {
    total: number;
    assignedToMe: number | null;
    unassigned: number;
    urgent: number;
    requiredNotFinal: number;
    overdue: number;
  };
  cases: ReportingBoardMobileCase[];
  allowedActions: {
    readOnly: boolean;
    assignToMe: boolean;
    reassign: boolean;
    batchReassign: boolean;
    copyAccession: boolean;
  };
  refreshedAt: string;
}

export type ProtocolStatus = "draft" | "assigned" | "clarification_needed" | "cancelled";

export interface ProtocolTask {
  appointmentId: number;
  patientId: number;
  patientMrn: string | null;
  patientNationalId: string | null;
  patientArabicName: string | null;
  patientEnglishName: string | null;
  ageYears: number | null;
  sex: string | null;
  appointmentDate: string;
  appointmentTime: string | null;
  modalityId: number;
  modalityCode: string | null;
  modalityName: string | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  requiresReport: boolean;
  clinicalIndication: string | null;
  appointmentStatus: string;
  rosterAssignmentId: number | null;
  teamName: string | null;
  protocolStatus: ProtocolStatus | null;
  assignedByDoctorName: string | null;
  updatedAt: string | null;
}

export interface AppointmentProtocol {
  id: number;
  appointmentId: number;
  protocolText: string | null;
  contrastRequired: boolean | null;
  contrastPhaseOrProtocol: string | null;
  specialPreparation: string | null;
  technologistNotes: string | null;
  protocolStatus: ProtocolStatus;
  assignedByDoctorId: number | null;
  assignedByDoctorName: string | null;
  assignedAt: string | null;
  updatedByDoctorId: number | null;
  updatedByDoctorName: string | null;
  updatedAt: string;
  version: number;
  createdAt: string;
}

export interface ProtocolDetails {
  appointment: ProtocolTask;
  protocol: AppointmentProtocol | null;
}

export interface ProtocolAuditTimelineEvent {
  eventType: "protocol_created" | "protocol_updated" | "protocol_assigned" | "clarification_requested" | "protocol_cancelled" | "protocol_corrected";
  changedByDoctorId: number | null;
  changedByDoctorName: string | null;
  createdAt: string;
  reason: string | null;
  oldSummary: string | null;
  newSummary: string | null;
  version: number | null;
  protocolStatus: ProtocolStatus | null;
}

export interface ProtocolFilters {
  dateFrom: string;
  dateTo: string;
  modalityId?: number | null;
  protocolStatus?: string | null;
  unprotocolledOnly?: boolean;
  requiresReport?: boolean | null;
  caseCategory?: string | null;
}

export interface ProtocolPayload {
  protocolText: string | null;
  contrastRequired: boolean | null;
  contrastPhaseOrProtocol: string | null;
  specialPreparation: string | null;
  technologistNotes: string | null;
  protocolStatus?: ProtocolStatus;
  reason?: string | null;
}

export type ProtocolAssignmentStatus = "ASSIGNED" | "MODIFIED" | "CANCELLED";
export type DoctorProtocolingStatus = "NOT_PROTOCOLLED" | ProtocolAssignmentStatus;

export interface ProtocolAssignment {
  assignmentId: number;
  protocolId: number;
  protocolVersionId: number;
  protocolName: string;
  versionNumber: string;
  scannerId: number | null;
  scannerName: string | null;
  protocolNotes: string | null;
  contrastNotes: string | null;
  status: ProtocolAssignmentStatus;
  assignedBy: number | null;
  assignedAt: string | null;
}

export interface DoctorProtocolingAppointment {
  appointmentId: number;
  accessionNumber: string;
  patientId: number;
  patientMrn: string | null;
  patientNationalId: string | null;
  patientArabicName: string | null;
  patientEnglishName: string | null;
  ageYears: number | null;
  sex: string | null;
  appointmentDate: string;
  appointmentTime: string | null;
  modalityId: number;
  modalityCode: "CT" | "MRI";
  modalityName: string | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  clinicalNotes: string | null;
  appointmentStatus: string;
  protocolStatus: DoctorProtocolingStatus;
  assignment: ProtocolAssignment | null;
}

export interface ProtocolingCtPhase {
  id: number;
  orderIndex: number;
  ctPhasePresetId: number | null;
  ctPhasePresetName: string | null;
  customPhaseName: string | null;
  timingOverride: string | null;
  coverageOverride: string | null;
  reconstructionOverride: string | null;
  instructionsOverride: string | null;
  isRequired: boolean;
}

export interface ProtocolingMriSequence {
  id: number;
  orderIndex: number;
  scannerId: number | null;
  scannerName: string | null;
  mriSequencePresetId: number | null;
  mriSequencePresetName: string | null;
  planeOverride: string | null;
  coverageOverride: string | null;
  bValuesOverride: string | null;
  timingOverride: string | null;
  notesOverride: string | null;
  isRequired: boolean;
}

export interface ProtocolAssignmentDetail {
  assignment: ProtocolAssignment;
  ctPhases: ProtocolingCtPhase[];
  mriSequences: ProtocolingMriSequence[];
}

export interface DoctorProtocolingAppointmentDetail {
  appointment: DoctorProtocolingAppointment;
  assignmentDetail: ProtocolAssignmentDetail | null;
}

export interface DoctorProtocolingFilters {
  dateFrom: string;
  dateTo: string;
  modality?: "CT" | "MRI" | null;
  protocolStatus?: "NOT_PROTOCOLLED" | "ASSIGNED" | "ALL" | null;
  search?: string | null;
}

export interface ProtocolAssignmentPayload {
  protocolId: number;
  scannerId: number | null;
  protocolNotes: string | null;
  contrastNotes: string | null;
  status: ProtocolAssignmentStatus;
}

export interface ModalityCtProtocolPhase {
  orderIndex: number;
  phasePresetName: string | null;
  customPhaseName: string | null;
  contrastStatus: string | null;
  timingType: string | null;
  delaySeconds: number | null;
  timingOverride: string | null;
  coverage: string | null;
  coverageOverride: string | null;
  reconstructionNotes: string | null;
  reconstructionOverride: string | null;
  instructions: string | null;
  instructionsOverride: string | null;
  isRequired: boolean;
}

export interface ModalityMriProtocolSequence {
  orderIndex: number;
  scannerId: number | null;
  scannerName: string | null;
  sequencePresetName: string | null;
  vendorSequenceName: string | null;
  genericFamily: string | null;
  weighting: string | null;
  defaultPlane: string | null;
  planeOverride: string | null;
  defaultCoverage: string | null;
  coverageOverride: string | null;
  defaultBValues: string | null;
  bValuesOverride: string | null;
  defaultDynamicTiming: string | null;
  timingOverride: string | null;
  notes: string | null;
  notesOverride: string | null;
  isRequired: boolean;
}

export interface ModalityProtocolAssignment {
  assignmentId: number;
  appointmentId: number;
  protocolId: number;
  protocolVersionId: number;
  protocolName: string;
  versionNumber: string;
  modality: "CT" | "MRI";
  scannerId: number | null;
  scannerName: string | null;
  scannerVendor: string | null;
  protocolNotes: string | null;
  contrastNotes: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  status: "ASSIGNED" | "MODIFIED";
  ctPhases: ModalityCtProtocolPhase[];
  mriSequences: ModalityMriProtocolSequence[];
}

export interface ProtocolAnatomyRegion {
  id: number;
  name: string;
  bodySystem: string | null;
  modalityScope: "CT" | "MRI" | "BOTH";
  defaultCoverageNote: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImagingScanner {
  id: number;
  name: string;
  modality: "CT" | "MRI";
  vendor: string | null;
  model: string | null;
  fieldStrength: string | null;
  location: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CtPhasePreset {
  id: number;
  name: string;
  contrastStatus: "NON_CONTRAST" | "POST_CONTRAST" | "DELAYED" | "OTHER";
  timingType: "NONE" | "FIXED_DELAY" | "BOLUS_TRACKING" | "MANUAL";
  delaySeconds: number | null;
  bolusTrackingSite: string | null;
  triggerHu: number | null;
  defaultCoverage: string | null;
  reconstructionNotes: string | null;
  instructions: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MriSequencePreset {
  id: number;
  scannerId: number | null;
  scannerName: string | null;
  vendor: string | null;
  name: string;
  vendorSequenceName: string | null;
  genericFamily: string | null;
  weighting: string | null;
  defaultPlane: string | null;
  contrastRelation: string | null;
  defaultCoverage: string | null;
  defaultBValues: string | null;
  defaultDynamicTiming: string | null;
  estimatedScanTimeMinutes: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolLibraryProtocol {
  id: number;
  name: string;
  modality: "CT" | "MRI";
  anatomyRegionId: number | null;
  anatomyRegionName: string | null;
  category: string | null;
  indication: string | null;
  contrastPolicy: string | null;
  activeVersionId: number | null;
  activeVersionNumber: string | null;
  activeVersionStatus: ProtocolLibraryVersionStatus | null;
  latestDraftVersionId: number | null;
  latestDraftVersionNumber: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProtocolLibraryVersionStatus = "DRAFT" | "ACTIVE" | "RETIRED";

export interface ProtocolLibraryVersion {
  id: number;
  protocolId: number;
  versionNumber: string;
  status: ProtocolLibraryVersionStatus;
  changeSummary: string | null;
  createdBy: number | null;
  approvedBy: number | null;
  approvedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolLibraryCtPhaseRow {
  id: number;
  protocolVersionId: number;
  orderIndex: number;
  ctPhasePresetId: number | null;
  ctPhasePresetName: string | null;
  customPhaseName: string | null;
  timingOverride: string | null;
  coverageOverride: string | null;
  reconstructionOverride: string | null;
  instructionsOverride: string | null;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolLibraryMriSequenceRow {
  id: number;
  protocolVersionId: number;
  scannerId: number | null;
  scannerName: string | null;
  orderIndex: number;
  mriSequencePresetId: number | null;
  mriSequencePresetName: string | null;
  planeOverride: string | null;
  coverageOverride: string | null;
  bValuesOverride: string | null;
  timingOverride: string | null;
  notesOverride: string | null;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolLibraryVersionDetail {
  protocol: ProtocolLibraryProtocol;
  version: ProtocolLibraryVersion;
  ctPhases: ProtocolLibraryCtPhaseRow[];
  mriSequences: ProtocolLibraryMriSequenceRow[];
}

export interface TeamWorkloadSummaryRow {
  rosterAssignmentId: number;
  teamName: string;
  dutyType: string;
  date: string;
  modalityId: number;
  modalityName: string | null;
  caseCategory: string | null;
  caseCount: number;
  totalWorkloadUnits: number;
  reportRequiredCount: number;
  noReportCount: number;
  pendingCount: number;
  finalizedCount: number;
  overdueCount: number;
}

export interface WorkloadFilters {
  startDate: string;
  endDate: string;
  modalityId?: number | null;
  rosterAssignmentId?: number | null;
  teamName?: string | null;
  caseCategory?: string | null;
  requiresReport?: boolean | null;
}

export interface WorkloadCalculationSummary {
  calculatedCount: number;
  alreadyCurrentCount: number;
  defaultedNoCatalogRuleCount: number;
  skippedCount: number;
  errors: Array<{ appointmentId: number; reason: string }>;
}

export interface WorkloadCatalogRule {
  id: number;
  modalityId: number;
  examTypeId: number | null;
  caseCategory: string | null;
  assignmentType: CaseAssignmentType;
  baseUnits: number;
  reportRequiredMultiplier: number;
  noReportUnits: number;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type IdentifierType = string;

export interface PatientIdentifier {
  id?: number;
  typeId?: number;
  typeCode: IdentifierType;
  value: string;
  normalizedValue?: string;
  isPrimary: boolean;
}

export interface Patient {
  id: number;
  mrn?: string | null;
  nationalId?: string | null;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
  category?: "oncology" | "non_oncology" | null;
  identifiers?: PatientIdentifier[];
  arabicFullName: string;
  englishFullName?: string | null;
  ageYears: number;
  demographicsEstimated?: boolean;
  estimatedDateOfBirth?: string | null;
  sex: string;
  phone1: string;
  phone2?: string | null;
  address?: string | null;
}

export interface PatientDirectoryRow {
  id: number;
  mrn: string | null;
  arabicFullName: string;
  englishFullName: string | null;
  sex: string | null;
  ageYears: number;
  demographicsEstimated: boolean;
  phone1: string | null;
  category: "oncology" | "non_oncology" | null;
  lastAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
  } | null;
  nextAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
  } | null;
  warnings: {
    missingPhone: boolean;
    missingDob: boolean;
    missingSex: boolean;
    missingName: boolean;
    noAppointment: boolean;
    possibleDuplicate: boolean;
    duplicateReasons: string[];
  };
}

export interface PatientDirectoryResponse {
  patients: PatientDirectoryRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PatientDirectorySummary {
  demographics: {
    id: number;
    mrn: string | null;
    arabicFullName: string;
    englishFullName: string | null;
    sex: string | null;
    ageYears: number;
    demographicsEstimated: boolean;
    dateOfBirth: string | null;
  };
  identifiers: {
    nationalId: string | null;
    identifierType: string | null;
    identifierValue: string | null;
    items: PatientIdentifier[];
  };
  contact: {
    phone1: string | null;
    phone2: string | null;
    address: string | null;
  };
  category: "oncology" | "non_oncology" | null;
  registration: {
    createdAt: string | null;
    createdByUserId: number | null;
    createdByName: string | null;
    createdByUsername: string | null;
  };
  warnings: {
    missingPhone: boolean;
    missingDob: boolean;
    missingSex: boolean;
    missingName: boolean;
    incompleteData: boolean;
    possibleDuplicate: boolean;
    duplicateReasons: string[];
  };
  lastAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  } | null;
  nextAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  } | null;
  recentAppointments: Array<{
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  }>;
  noShow: {
    noShowCount: number;
    bookingRestricted: boolean;
    lastNoShowAppointment: {
      id: number;
      date: string;
      status: string;
      modalityName: string;
      examTypeName: string;
    } | null;
    lastAuthorizationUser: {
      id: number;
      fullName: string | null;
      username: string | null;
    } | null;
    lastAuthorizationDate: string | null;
    lastAuthorizationReason: string | null;
  };
}

export interface PatientDuplicateSummary {
  id: number;
  mrn: string | null;
  nationalId: string | null;
  identifierType: string | null;
  identifierValue: string | null;
  arabicFullName: string;
  englishFullName: string | null;
  ageYears: number;
  dateOfBirth: string | null;
  sex: string | null;
  phone1: string | null;
  phone2: string | null;
  category: "oncology" | "non_oncology" | null;
}

export interface PatientDuplicateBlockers {
  legacyAppointments: number;
  v2Bookings: number;
  documents: number;
  scanSessions: number;
  patientImportRows: number;
  dicomRemapJobs: number;
  webPushRows: number;
  total: number;
}

export interface PatientDuplicateCandidate {
  patientA: PatientDuplicateSummary;
  patientB: PatientDuplicateSummary;
  score: number;
  reasons: string[];
  signals: Array<{
    field: string;
    label: string;
    status: "match" | "similar" | "mismatch" | "info";
    score?: number;
  }>;
  conflicts: Array<{
    field: string;
    patientAValue: string | null;
    patientBValue: string | null;
  }>;
  canSafeDeleteA: boolean;
  canSafeDeleteB: boolean;
  blockersA: PatientDuplicateBlockers;
  blockersB: PatientDuplicateBlockers;
}

export interface PatientDuplicateListResponse {
  candidates: PatientDuplicateCandidate[];
  threshold: number;
  mode?: "strict" | "balanced" | "broad";
  candidateCount?: number;
}

export interface PatientDuplicateDetailResponse {
  candidate: PatientDuplicateCandidate;
  summaryA: PatientDirectorySummary;
  summaryB: PatientDirectorySummary;
}

export interface PatientIdentifierTypeOption {
  code: string;
  labelAr: string;
  labelEn: string;
}

export interface Modality {
  id: number;
  code?: string;
  nameAr: string;
  nameEn: string;
  dailyCapacity?: number;
  generalInstructionAr?: string;
  generalInstructionEn?: string;
  safetyWarningAr?: string | null;
  safetyWarningEn?: string | null;
  safetyWarningEnabled?: boolean;
  isActive?: boolean;
}

export interface ExamType {
  id: number;
  modalityId?: number | null;
  nameAr: string;
  nameEn: string;
  specificInstructionAr?: string;
  specificInstructionEn?: string;
  isActive?: boolean;
}

export interface ReportingPriority {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
}

export interface Appointment {
  id: number;
  patientId: number;
  modalityId: number;
  examTypeId?: number | null;
  reportingPriorityId?: number | null;
  accessionNumber: string;
  requiresReport?: boolean;
  studyInstanceUid?: string | null;
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  appointmentDate: string;
  bookingTime?: string | null;
  dailySequence: number;
  status: AppointmentStatus;
  isWalkIn?: boolean;
  isOverbooked?: boolean;
  overbookingReason?: string | null;
  approvedByName?: string | null;
  demographicsEstimated?: boolean;
  notes?: string | null;
  modalityGeneralInstructionAr?: string | null;
  modalityGeneralInstructionEn?: string | null;
  noShowReason?: string | null;
  cancelReason?: string | null;
  arrivedAt?: string | null;
  waitingStartedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  sameDayAppointmentCount?: number;
  hasMultipleAppointments?: boolean;
  relatedAppointments?: QueueRelatedAppointment[];
}

export interface AppointmentLookups {
  modalities: Modality[];
  examTypes: ExamType[];
  priorities: ReportingPriority[];
  specialReasons?: SchedulingSpecialReason[];
}

export interface QueueSummary {
  total_appointments: number;
  scheduled_count: number;
  waiting_count: number;
  no_show_count: number;
  arrived_count: number;
}

export interface QueueRelatedAppointment {
  appointmentId: number;
  accessionNumber: string;
  appointmentStatus: AppointmentStatus;
  modalityNameAr: string;
  modalityNameEn: string;
  examNameAr?: string | null;
  examNameEn?: string | null;
}

export interface QueueScanResponse {
  ok: true;
  bookingId: number;
  patientId: number;
  bookingDate: string;
  updatedBookingIds: number[];
  alreadyArrivedBookingIds: number[];
  relatedBookingIds: number[];
  sameDayAppointmentCount: number;
  hasMultipleAppointments: boolean;
}

export interface QueueEntry {
  id: number;
  queueDate: string;
  queueNumber: number;
  queueStatus: QueueStatus;
  scannedAt?: string | null;
  arrivedAt?: string | null;
  waitingStartedAt?: string | null;
  completedAt?: string | null;
  appointmentId: number;
  accessionNumber: string;
  appointmentStatus: AppointmentStatus;
  isWalkIn: boolean;
  notes?: string | null;
  patientId: number;
  arabicFullName: string;
  englishFullName?: string | null;
  phone1?: string | null;
  nationalId?: string | null;
  modalityNameAr: string;
  modalityNameEn: string;
  examNameAr?: string | null;
  examNameEn?: string | null;
  sameDayAppointmentCount?: number;
  hasMultipleAppointments?: boolean;
  relatedAppointments?: QueueRelatedAppointment[];
}

export interface QueueSnapshot {
  queueDate: string;
  reviewTime: string;
  reviewActive: boolean;
  autoNoShowEnabled?: boolean;
  noShowConfirmationRequired?: boolean;
  autoNoShowCount?: number;
  autoNoShowCleanupDays?: number;
  summary: QueueSummary;
  queueEntries: QueueEntry[];
  noShowCandidates: {
    appointmentId: number;
    accessionNumber: string;
    appointmentDate: string;
    notes?: string | null;
    patientId: number;
    arabicFullName: string;
    englishFullName?: string | null;
    phone1?: string | null;
    modalityNameAr: string;
    modalityNameEn: string;
  }[];
  oldNoShowCandidates: {
    appointmentId: number;
    accessionNumber: string;
    appointmentDate: string;
    notes?: string | null;
    patientId: number;
    arabicFullName: string;
    englishFullName?: string | null;
    phone1?: string | null;
    modalityNameAr: string;
    modalityNameEn: string;
  }[];
}

export interface AppointmentStatisticsSummary {
  totalRegisteredPatients: number;
  oncologyPatients: number;
  nonOncologyPatients: number;
  uncategorizedPatients: number;
  totalAppointments: number;
  oncologyAppointments: number;
  nonOncologyAppointments: number;
  uniquePatients: number;
  uniqueModalities: number;
  scheduledCount: number;
  inQueueCount: number;
  completedCount: number;
  discontinuedCount: number;
  noShowCount: number;
  cancelledCount: number;
  walkInCount: number;
}

export interface AppointmentStatisticsStatusRow {
  status: AppointmentStatus | string;
  count: number;
}

export interface AppointmentStatisticsModalityRow {
  modalityId: number;
  modalityCode: string;
  modalityNameEn: string;
  modalityNameAr: string;
  totalCount: number;
  scheduledCount: number;
  inQueueCount: number;
  completedCount: number;
  discontinuedCount: number;
  noShowCount: number;
  cancelledCount: number;
}

export interface AppointmentStatisticsDailyRow {
  appointmentDate: string;
  totalCount: number;
  completedCount: number;
  discontinuedCount: number;
  cancelledCount: number;
  noShowCount: number;
}

export interface AppointmentStatisticsMetadata {
  dateFrom: string;
  dateTo: string;
  modalityId: number | null;
  generatedAt: string;
}

export interface AppointmentStatistics {
  metadata: AppointmentStatisticsMetadata;
  summary: AppointmentStatisticsSummary;
  statusBreakdown: AppointmentStatisticsStatusRow[];
  modalityBreakdown: AppointmentStatisticsModalityRow[];
  dailyBreakdown: AppointmentStatisticsDailyRow[];
}

export interface AuditEntry {
  id: number;
  entityType: string;
  entityId?: number | string | null;
  actionType: string;
  oldValues?: unknown;
  newValues?: unknown;
  changedByUserId?: number | string | null;
  createdAt?: string;
}

export interface DicomDevice {
  id: number;
  modalityId: number;
  modalityCode: string;
  modalityNameAr: string;
  modalityNameEn: string;
  deviceName: string;
  modalityAeTitle: string;
  scheduledStationAeTitle: string;
  stationName: string;
  stationLocation: string;
  sourceIp?: string | null;
  mwlEnabled: boolean;
  isActive: boolean;
}

export interface ApiResponse<T> {
  data?: T;
  error?: {
    message: string;
    details?: unknown;
  };
}

export interface SchedulingCategoryLimit {
  id?: number;
  modality_id?: number;
  modalityId?: number;
  case_category?: "oncology" | "non_oncology";
  caseCategory?: "oncology" | "non_oncology";
  daily_limit?: number;
  dailyLimit?: number;
  is_active?: boolean;
  isActive?: boolean;
}

export interface SchedulingBlockedRule {
  id?: number;
  modality_id?: number;
  modalityId?: number;
  rule_type?: "specific_date" | "date_range" | "yearly_recurrence";
  ruleType?: "specific_date" | "date_range" | "yearly_recurrence";
  specific_date?: string | null;
  specificDate?: string | null;
  start_date?: string | null;
  startDate?: string | null;
  end_date?: string | null;
  endDate?: string | null;
  recur_start_month?: number | null;
  recurStartMonth?: number | null;
  recur_start_day?: number | null;
  recurStartDay?: number | null;
  recur_end_month?: number | null;
  recurEndMonth?: number | null;
  recur_end_day?: number | null;
  recurEndDay?: number | null;
  is_overridable?: boolean;
  isOverridable?: boolean;
  is_active?: boolean;
  isActive?: boolean;
  title?: string;
  notes?: string;
}

export interface SchedulingExamRule {
  id?: number;
  modality_id?: number;
  modalityId?: number;
  rule_type?: "specific_date" | "date_range" | "weekly_recurrence";
  ruleType?: "specific_date" | "date_range" | "weekly_recurrence";
  effect_mode?: "hard_restriction" | "restriction_overridable";
  effectMode?: "hard_restriction" | "restriction_overridable";
  specific_date?: string | null;
  specificDate?: string | null;
  start_date?: string | null;
  startDate?: string | null;
  end_date?: string | null;
  endDate?: string | null;
  weekday?: number | null;
  alternate_weeks?: boolean;
  alternateWeeks?: boolean;
  recurrence_anchor_date?: string | null;
  recurrenceAnchorDate?: string | null;
  exam_type_ids?: number[];
  examTypeIds?: number[];
  is_active?: boolean;
  isActive?: boolean;
  title?: string;
  notes?: string;
}

export interface SchedulingSpecialQuota {
  id?: number;
  exam_type_id?: number;
  examTypeId?: number;
  daily_extra_slots?: number;
  dailyExtraSlots?: number;
  is_active?: boolean;
  isActive?: boolean;
}

export interface SchedulingSpecialReason {
  code: string;
  label_en?: string;
  labelEn?: string;
  label_ar?: string;
  labelAr?: string;
  is_active?: boolean;
  isActive?: boolean;
}

export interface SchedulingIdentifierType {
  id?: number;
  code: string;
  label_en?: string;
  labelEn?: string;
  label_ar?: string;
  labelAr?: string;
  is_active?: boolean;
  isActive?: boolean;
}

export interface SchedulingEngineConfig {
  categoryLimits: SchedulingCategoryLimit[];
  blockedRules: SchedulingBlockedRule[];
  examRules: SchedulingExamRule[];
  specialQuotas: SchedulingSpecialQuota[];
  specialReasons: SchedulingSpecialReason[];
  identifierTypes: SchedulingIdentifierType[];
}

export interface PatientImportBatch {
  id: number;
  source_filename: string;
  source_sheet_name?: string | null;
  patient_category?: "oncology" | "non_oncology" | null;
  imported_by_user_id?: number | null;
  imported_at: string;
  status: "uploaded" | "staged" | "reviewed" | "migrated" | "failed";
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  migrated_rows: number;
  created_at: string;
  updated_at: string;
}

export interface PatientImportStagingRow {
  id: number;
  batch_id: number;
  row_number: number;
  arabic_full_name?: string | null;
  english_full_name?: string | null;
  national_id?: string | null;
  phone?: string | null;
  derived_birth_date?: string | null;
  derived_age_years?: number | null;
  derived_sex?: string | null;
  validation_status: "valid" | "invalid" | "duplicate" | "migrated" | "skipped";
  validation_message?: string | null;
  matched_existing_patient_id?: number | null;
  is_selected_for_migration: boolean;
  migrated_patient_id?: number | null;
  raw_row_json?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
