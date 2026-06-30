import type { SonicDicomReportState } from "../../services/sonicdicom-report-service.js";

export type ReportingBoardAssignmentStatus = "all" | "unassigned" | "assigned";
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
  appointmentId?: number | null;
  sortBy?: ReportingBoardSortBy | null;
  sortDirection?: ReportingBoardSortDirection | null;
  pinUrgentToTop?: boolean | null;
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
  assignmentStatus: "assigned" | "unassigned";
  completedAt: string | null;
  currentAssignedAt: string | null;
  firstAssignedAt: string | null;
  reportFinalAt?: string | null;
  reportStatus?: Exclude<SonicDicomReportState, "not_required" | "not_completed" | "disabled">;
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
  doctorId: number;
  reason?: string | null;
  allowFinal?: boolean | null;
}

export interface BulkAssignNextCasesResult {
  requestedCount: number;
  assignedCount: number;
  skippedCount: number;
  assignedAppointmentIds: number[];
  skipped: Array<{ appointmentId: number; reason: string }>;
}

export interface BulkUnassignSelectedCasesInput {
  appointmentIds: number[];
  reason?: string | null;
  allowFinal?: boolean | null;
}

export interface BulkUnassignSelectedCasesResult {
  requestedCount: number;
  unassignedCount: number;
  skippedCount: number;
  unassignedAppointmentIds: number[];
  skipped: Array<{ appointmentId: number; reason: string }>;
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

export interface BrowserPushSubscriptionInput {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
}
