import type { SonicDicomReportState } from "../../services/sonicdicom-report-service.js";

export type ReportingBoardAssignmentStatus = "all" | "unassigned" | "assigned";
export type ReportingBoardAssignmentOrigin = "rispro" | "sonic_auto" | "sonic_reconciled";
export type ReportingBoardAssignmentMatch = "all" | "matched" | "mismatch" | "finalized_unassigned" | "unmapped_finalizer";
export type ReportingBoardCaseAssignmentMatch = Exclude<ReportingBoardAssignmentMatch, "all"> | "not_applicable";
export type ReportingBoardCaseSource = "all" | "appointments" | "comparisons";
export type ReportingBoardReportStatus =
  | "required_not_final"
  | "final"
  | "draft"
  | "no_report"
  | "study_not_found"
  | "unavailable"
  | "all";
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
/** Personal Reporting Desk workflow scopes.  These are deliberately distinct
 * from the assignment filters used by the administrative Reporting Board. */
export type ReportingBoardMobileQuickTab = "my_cases" | "available" | "urgent" | "overdue";

export interface ReportingBoardFilters {
  dateFrom?: string | null;
  dateTo?: string | null;
  cutoffDate?: string | null;
  modalityId?: number | null;
  /** Internal automatic-assignment scope; never accepted from the HTTP API. */
  reportableModalityIds?: number[] | null;
  modalityCode?: string | null;
  modalityCodes?: string[] | null;
  assignedDoctorId?: number | null;
  finalizedByDoctorId?: number | null;
  assignmentStatus?: ReportingBoardAssignmentStatus | null;
  assignmentMatch?: ReportingBoardAssignmentMatch | null;
  caseCategory?: string | null;
  requiresReport?: boolean | null;
  reportStatus?: ReportingBoardReportStatus | null;
  priorityCode?: string | null;
  urgentOrStat?: boolean | null;
  q?: string | null;
  caseSource?: ReportingBoardCaseSource | null;
  appointmentId?: number | null;
  comparisonRequestId?: number | null;
  sortBy?: ReportingBoardSortBy | null;
  sortDirection?: ReportingBoardSortDirection | null;
  pinUrgentToTop?: boolean | null;
  overdue?: boolean | null;
  /** Mobile-only request marker used to separate a quick-tab predicate from explicit drawer filters. */
  mobileQuickTab?: ReportingBoardMobileQuickTab | null;
  limit?: number | null;
  offset?: number | null;
}

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
  defaultSortBy: ReportingBoardSortBy;
  defaultSortDirection: ReportingBoardSortDirection;
  pinUrgentToTop: boolean;
  includedCaseSources: Array<Exclude<ReportingBoardCaseSource, "all">>;
  refreshIntervalSeconds: number;
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
  lastAccessedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  accessMode: "public_readonly";
  linkKind: "admin_saved_view" | "doctor_worklist";
  systemManaged: boolean;
  targetDoctorId: number | null;
  adminDisabledAt: string | null;
  matchingCaseCount?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DoctorReportingWorklistSummary extends ReportingBoardSavedView {
  doctorDisplayName: string;
  username: string;
  doctorUserId: number;
  doctorEmail: string | null;
  doctorRole: string;
  userActive: boolean;
  doctorActive: boolean;
  effectiveModalityCodes: string[];
  assignedPendingCount: number;
  eligibleUnassignedCount: number;
  subscriptionCount: number;
  scopeMessage: string | null;
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
  comparisonReason?: string | null;
  comparisonPreparationNote?: string | null;
  caseCategory: string;
  appointmentStatus: string;
  activeComplementaryRecallStatus?: "pending_scheduling" | "scheduled" | null;
  latestComplementaryRecallStatus?: "pending_scheduling" | "scheduled" | "completed" | "cancelled" | null;
  workflowHold?: "waiting_for_additional_imaging" | "waiting_for_additional_report" | "additional_imaging_ready_for_supplement" | null;
  requiresReport: boolean;
  reportingPriorityId: number | null;
  reportingPriorityCode: string | null;
  reportingPriorityName: string | null;
  reportingPrioritySortOrder: number | null;
  assignedDoctorId: number | null;
  assignedDoctorName: string | null;
  assignmentOrigin: ReportingBoardAssignmentOrigin;
  finalizedByDoctorId: number | null;
  finalizedByDoctorName: string | null;
  sonicDicomFinalizedByAccount: string | null;
  sonicDicomLatestDocumentId: string | null;
  sonicDicomDocumentRemoved?: boolean;
  sonicDicomCorrelationMethod: "study_instance_uid" | "accession_fallback" | null;
  assignmentMatch: ReportingBoardCaseAssignmentMatch;
  assignmentStatus: "assigned" | "unassigned";
  completedAt: string | null;
  currentAssignedAt: string | null;
  firstAssignedAt: string | null;
  reportFinalAt: string | null;
  reportStatusCheckedAt: string | null;
  reportStatusSource?: "sonicdicom" | "manual" | "rispro" | null;
  sonicDicomStudyNote: string | null;
  sonicDicomStudyNoteCheckedAt: string | null;
  sonicDicomStudyNoteSource?: "sonicdicom" | null;
  manualFinalOverrideId?: number | null;
  manualFinalAt?: string | null;
  manualFinalByDoctorId?: number | null;
  manualFinalByName?: string | null;
  manualFinalReason?: string | null;
  dueAt: string | null;
  completedToAssignedMinutes: number | null;
  assignedToFinalMinutes: number | null;
  completedToFinalMinutes: number | null;
  currentAssignmentAgeMinutes: number | null;
  completedUnassignedAgeMinutes: number | null;
  reportStatus: Exclude<SonicDicomReportState, "not_required" | "not_completed" | "disabled">;
  canAssign: boolean;
  exclusionReason: string | null;
}

export interface ReportingBoardStatsBaseRow {
  caseType: "appointment" | "comparison";
  appointmentId: number;
  comparisonRequestId: number | null;
  bookingDate: string;
  appointmentStatus: string;
  modalityCode: string;
  requiresReport: boolean;
  reportingPriorityCode: string | null;
  reportingPriorityName: string | null;
  assignedDoctorId: number | null;
  assignedDoctorName: string | null;
  assignmentOrigin: ReportingBoardAssignmentOrigin;
  assignmentStatus: "assigned" | "unassigned";
  completedAt: string | null;
  currentAssignedAt: string | null;
  firstAssignedAt: string | null;
  reportFinalAt?: string | null;
  reportStatus?: Exclude<SonicDicomReportState, "not_required" | "not_completed" | "disabled">;
  reportStatusSource?: "sonicdicom" | "manual" | "rispro" | null;
  manualFinalOverrideId?: number | null;
  workflowHold?: "waiting_for_additional_imaging" | "waiting_for_additional_report" | "additional_imaging_ready_for_supplement" | null;
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

export interface BulkAssignNextCasesInput {
  doctorId: number;
  count: number;
  filters?: ReportingBoardFilters | null;
  savedViewId?: number | null;
  token?: string | null;
  unassignedOnly?: boolean | null;
  reason?: string | null;
}

export interface BulkReassignSelectedCasesInput {
  appointmentIds: number[];
  comparisonRequestIds?: number[];
  doctorId: number;
  reason?: string | null;
  allowFinal?: boolean | null;
}

export interface BulkAssignNextCasesResult {
  requestedCount: number;
  assignedCount: number;
  skippedCount: number;
  remainingCount?: number;
  assignedAppointmentIds: number[];
  assignedComparisonRequestIds?: number[];
  skipped: Array<{ appointmentId?: number; comparisonRequestId?: number; reason: string }>;
}

export type ReportingBoardBulkAssignmentJobStatus = "scheduled" | "running" | "completed" | "partial" | "failed" | "cancelled" | "undone" | "partially_undone";

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
  result: BulkAssignNextCasesResult | null;
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

export interface CreateReportingBoardBulkAssignmentJobInput {
  scheduledFor: string;
  doctorId: number;
  count: number;
  filters: ReportingBoardFilters;
  savedViewId?: number | null;
  savedViewName?: string | null;
  resumedFromJobId?: number | null;
  reason?: string | null;
}

export interface CreateReportingBoardBulkAssignmentJobsInput {
  jobs: CreateReportingBoardBulkAssignmentJobInput[];
}

export interface BulkUnassignSelectedCasesInput {
  appointmentIds: number[];
  comparisonRequestIds?: number[];
  reason?: string | null;
  allowFinal?: boolean | null;
}

export interface BulkUnassignSelectedCasesResult {
  requestedCount: number;
  unassignedCount: number;
  skippedCount: number;
  unassignedAppointmentIds: number[];
  unassignedComparisonRequestIds?: number[];
  skipped: Array<{ appointmentId?: number; comparisonRequestId?: number; reason: string }>;
}

export interface ReportingBoardNotificationEvent {
  id: number;
  eventType: "reporting_case_assigned_to_me" | "additional_imaging_patient_arrived" | "additional_imaging_completed" | "additional_imaging_report_finalized";
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

export interface BrowserPushSubscriptionInput {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
}
