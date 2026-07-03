import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { pool } from "../../db/pool.js";
import { buildSonicDicomStaffViewerUrl, checkSonicDicomReportStatus, type SonicDicomReportState } from "../../services/sonicdicom-report-service.js";
import { readSonicDicomReportSettings } from "../../services/sonicdicom-report-settings.js";
import { updateBookingStatusManual } from "../appointments-v2/booking/services/status-booking.service.js";
import { assignComparisonRequest, listComparisonReportingBoardRows, listComparisonReportingBoardStatsRows, unassignComparisonRequest } from "../../services/comparison-request-service.js";
import { requireRosterDoctor, requireRosterManager } from "./roster-service.js";
import { assignDoctorCase } from "./cases-service.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import {
  bulkAssignReportingCases,
  bulkUnassignReportingCases,
  cancelReportingBoardBulkAssignmentJob,
  claimReportingBoardBulkAssignmentJobForRunNow,
  claimDueReportingBoardBulkAssignmentJobs,
  completeReportingBoardBulkAssignmentJob,
  createAssignedToMeNotifications,
  createReportingBoardBulkAssignmentJob,
  createSavedView,
  doctorCanReportAllModalities,
  dismissReportingBoardNotification,
  failReportingBoardBulkAssignmentJob,
  findActiveSavedViewByToken,
  findReportingBoardBulkAssignmentJobById,
  findAssignableDoctorForReporting,
  findSavedViewById,
  findSavedViewByToken,
  listReportingBoardBulkAssignmentJobs,
  listReportingBoardCasesByAppointmentIds,
  listReportingBoardCaseCandidates,
  listReportingBoardNotifications,
  listReportingBoardStatsRows,
  listSavedViews,
  markAllReportingBoardNotificationsRead,
  markReportingBoardNotificationRead,
  readReportingBoardSettings,
  readReportingBoardPushConfig,
  sendReportingBoardSavedViewTestPush,
  unassignReportingCase,
  updateSavedView,
  updateReportingBoardSettings,
  upsertReportingBoardPushSubscription,
} from "./reporting-board-repository.js";
import type {
  BrowserPushSubscriptionInput,
  BulkAssignNextCasesInput,
  BulkAssignNextCasesResult,
  CreateReportingBoardBulkAssignmentJobInput,
  CreateReportingBoardBulkAssignmentJobsInput,
  BulkReassignSelectedCasesInput,
  BulkUnassignSelectedCasesInput,
  BulkUnassignSelectedCasesResult,
  ReportingBoardBulkAssignmentJob,
  ReportingBoardCaseRow,
  ReportingBoardFilters,
  ReportingBoardDoctorStatsRow,
  ReportingBoardModalityStatsRow,
  ReportingBoardNotificationSettings,
  ReportingBoardPriorityStatsRow,
  ReportingBoardStatsBaseRow,
  ReportingBoardStatsResponse,
  ReportingBoardStatsSummary,
} from "./reporting-board-types.js";
import type { ClaimedReportingBoardBulkAssignmentJob } from "./reporting-board-repository.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

const MAX_CASE_LIST_LIMIT = 300;
const MAX_UNIFIED_CANDIDATE_FETCH = 3000;
const MAX_BULK_ASSIGN_COUNT = 100;
const MAX_SELECTED_REASSIGN_COUNT = 100;
const MAX_SCHEDULED_BULK_ASSIGN_JOBS = 5;
const REPORTING_BOARD_SORT_BY = new Set([
  "priority_study_date",
  "study_date",
  "accession",
  "patient_name",
  "mrn",
  "exam_type",
  "modality",
  "assigned_doctor",
  "longest_unassigned",
  "longest_assigned_not_final",
  "oldest_completed",
]);
const REPORTING_BOARD_SORT_DIRECTIONS = new Set(["asc", "desc"]);
let reportStatusChecker = checkSonicDicomReportStatus;
const reportStatusSnapshot = new Map<number, ReportingBoardCaseRow["reportStatus"]>();
type EffectiveReportingBoardFilters = Omit<ReportingBoardFilters, "limit" | "offset"> & { limit: number; offset: number };

export function __setReportingBoardReportStatusCheckerForTest(checker: typeof checkSonicDicomReportStatus | null) {
  reportStatusChecker = checker ?? checkSonicDicomReportStatus;
  reportStatusSnapshot.clear();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeReportState(state: SonicDicomReportState): ReportingBoardCaseRow["reportStatus"] {
  if (state === "final" || state === "draft" || state === "no_report" || state === "study_not_found" || state === "unavailable") {
    return state;
  }
  return "unavailable";
}

function normalizeLimit(limit?: number | null): number {
  const value = limit ?? 100;
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, "limit must be a positive integer.");
  if (value > MAX_CASE_LIST_LIMIT) throw new HttpError(400, `limit must be ${MAX_CASE_LIST_LIMIT} or less.`);
  return value;
}

function normalizeOffset(offset?: number | null): number {
  const value = offset ?? 0;
  if (!Number.isInteger(value) || value < 0) throw new HttpError(400, "offset must be zero or a positive integer.");
  return value;
}

function normalizeSortBy(sortBy?: ReportingBoardFilters["sortBy"] | null): NonNullable<ReportingBoardFilters["sortBy"]> {
  const value = sortBy ?? "priority_study_date";
  if (!REPORTING_BOARD_SORT_BY.has(value)) throw new HttpError(400, "sortBy is not supported.");
  return value;
}

function normalizeSortDirection(sortDirection?: ReportingBoardFilters["sortDirection"] | null): NonNullable<ReportingBoardFilters["sortDirection"]> {
  const value = sortDirection ?? "asc";
  if (!REPORTING_BOARD_SORT_DIRECTIONS.has(value)) throw new HttpError(400, "sortDirection must be asc or desc.");
  return value;
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 60000);
}

function minutesSince(start: string | null | undefined, nowMs: number): number | null {
  const startMs = timestampMs(start);
  if (startMs === null || nowMs < startMs) return null;
  return Math.floor((nowMs - startMs) / 60000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function withTimelineMetrics(row: ReportingBoardCaseRow, nowMs = Date.now()): ReportingBoardCaseRow {
  const completedToAssignedMinutes = minutesBetween(row.completedAt, row.firstAssignedAt);
  const assignedToFinalMinutes = row.reportFinalAt ? minutesBetween(row.currentAssignedAt, row.reportFinalAt) : null;
  const completedToFinalMinutes = row.reportFinalAt ? minutesBetween(row.completedAt, row.reportFinalAt) : null;
  const activeNonFinal = row.assignmentStatus === "assigned" && row.reportStatus !== "final";
  const completedUnassigned = row.appointmentStatus === "completed" && row.assignmentStatus === "unassigned" && !row.reportFinalAt;
  return {
    ...row,
    dueAt: null,
    completedToAssignedMinutes,
    assignedToFinalMinutes,
    completedToFinalMinutes,
    currentAssignmentAgeMinutes: activeNonFinal ? minutesSince(row.currentAssignedAt, nowMs) : null,
    completedUnassignedAgeMinutes: completedUnassigned ? minutesSince(row.completedAt, nowMs) : null,
  };
}

async function effectiveFilters(input: ReportingBoardFilters = {}): Promise<EffectiveReportingBoardFilters> {
  const settings = await readReportingBoardSettings();
  const cutoffDate =
    input.dateFrom ??
    input.cutoffDate ??
    (settings.cutoffMode === "fixed_date" && settings.defaultCutoffDate
      ? settings.defaultCutoffDate
      : addDays(todayIso(), -settings.daysBack));
  return {
    ...input,
    dateFrom: input.dateFrom ?? cutoffDate,
    cutoffDate,
    modalityCode: input.modalityCode ?? null,
    requiresReport: input.requiresReport ?? settings.defaultRequiresReport,
    reportStatus: input.reportStatus ?? settings.defaultReportStatusFilter,
    limit: normalizeLimit(input.limit),
    offset: normalizeOffset(input.offset),
    assignmentStatus: input.assignmentStatus ?? "all",
    caseCategory: input.caseCategory ?? null,
    priorityCode: input.priorityCode ?? null,
    q: input.q?.trim() || null,
    caseSource: input.caseSource ?? "all",
    assignedDoctorId: input.assignedDoctorId ?? null,
    modalityId: input.modalityId ?? null,
    modalityCodes: input.modalityCodes ?? null,
    sortBy: normalizeSortBy(input.sortBy),
    sortDirection: normalizeSortDirection(input.sortDirection),
    pinUrgentToTop: input.pinUrgentToTop ?? true,
  };
}

export function narrowSavedViewFilters(savedViewFilters: ReportingBoardFilters, input: ReportingBoardFilters = {}): ReportingBoardFilters {
  const narrowed: ReportingBoardFilters = { ...savedViewFilters };
  const keys: Array<keyof ReportingBoardFilters> = [
    "assignedDoctorId",
    "caseCategory",
    "reportStatus",
    "priorityCode",
    "modalityId",
    "modalityCode",
    "assignmentStatus",
    "sortBy",
    "sortDirection",
    "pinUrgentToTop",
    "caseSource",
  ];
  for (const key of keys) {
    if (savedViewFilters[key] === null || savedViewFilters[key] === undefined || savedViewFilters[key] === "") {
      const value = input[key];
      if (value !== null && value !== undefined && value !== "") {
        narrowed[key] = value as never;
      }
    }
  }
  if (input.q?.trim()) narrowed.q = input.q.trim();
  narrowed.limit = input.limit ?? savedViewFilters.limit ?? 100;
  narrowed.offset = input.offset ?? 0;
  return narrowed;
}

async function applyReportStatuses(rows: ReportingBoardCaseRow[], reportStatus: ReportingBoardFilters["reportStatus"]) {
  const checkedAt = new Date().toISOString();
  const resolved: ReportingBoardCaseRow[] = [];
  for (const row of rows) {
    if (row.caseType === "comparison") {
      const canAssign = row.canAssign && row.reportStatus !== "final";
      resolved.push(withTimelineMetrics({
        ...row,
        reportStatusCheckedAt: checkedAt,
        canAssign,
        exclusionReason: canAssign ? null : row.exclusionReason ?? (row.reportStatus === "final" ? "report_final" : null),
      }));
      continue;
    }
    let status: ReportingBoardCaseRow["reportStatus"] = "unavailable";
    try {
      const result = await reportStatusChecker(
        {
          bookingId: row.appointmentId,
          accessionNumber: row.accessionNumber,
          studyInstanceUid: row.studyInstanceUid,
          requiresReport: row.requiresReport,
          status: row.appointmentStatus,
        },
        { useCache: true }
      );
      status = normalizeReportState(result.state);
      row.reportFinalAt = status === "final" ? result.reportFinalAt ?? null : null;
    } catch {
      status = "unavailable";
      row.reportFinalAt = null;
    }
    reportStatusSnapshot.set(row.appointmentId, status);
    const canAssign = row.canAssign && status !== "final";
    resolved.push(withTimelineMetrics({
      ...row,
      reportStatus: status,
      reportStatusCheckedAt: checkedAt,
      canAssign,
      exclusionReason: canAssign ? null : row.exclusionReason ?? (status === "final" ? "report_final" : null),
    }));
  }

  if (!reportStatus || reportStatus === "all") return resolved;
  if (reportStatus === "required_not_final") {
    return resolved.filter((row) => row.requiresReport && row.reportStatus !== "final");
  }
  return resolved.filter((row) => row.reportStatus === reportStatus);
}

function fetchLimitForUnifiedCandidates(filters: EffectiveReportingBoardFilters): number {
  const requestedWindow = filters.limit + filters.offset;
  const needsPostFilter = Boolean(filters.reportStatus && filters.reportStatus !== "all");
  const multiplier = needsPostFilter ? 5 : 2;
  return Math.min(MAX_UNIFIED_CANDIDATE_FETCH, Math.max(100, requestedWindow * multiplier));
}

function sourceAllowsAppointments(caseSource: ReportingBoardFilters["caseSource"]): boolean {
  return !caseSource || caseSource === "all" || caseSource === "appointments";
}

function sourceAllowsComparisons(caseSource: ReportingBoardFilters["caseSource"]): boolean {
  return !caseSource || caseSource === "all" || caseSource === "comparisons";
}

function tieBreakCase(left: ReportingBoardCaseRow, right: ReportingBoardCaseRow): number {
  const leftType = left.caseType === "appointment" ? 0 : 1;
  const rightType = right.caseType === "appointment" ? 0 : 1;
  return leftType - rightType || left.appointmentId - right.appointmentId || (left.comparisonRequestId ?? 0) - (right.comparisonRequestId ?? 0);
}

function compareText(left: string | null | undefined, right: string | null | undefined, direction: ReportingBoardFilters["sortDirection"]): number {
  const result = String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
  return direction === "desc" ? -result : result;
}

function compareNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: ReportingBoardFilters["sortDirection"],
  nulls: "first" | "last" = "last"
): number {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing === (nulls === "first") ? -1 : 1;
  }
  const result = left - right;
  return direction === "desc" ? -result : result;
}

function compareTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: ReportingBoardFilters["sortDirection"],
  nulls: "first" | "last" = "last"
): number {
  const leftMs = left ? Date.parse(left) : NaN;
  const rightMs = right ? Date.parse(right) : NaN;
  const leftMissing = Number.isNaN(leftMs);
  const rightMissing = Number.isNaN(rightMs);
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing === (nulls === "first") ? -1 : 1;
  }
  const result = leftMs - rightMs;
  return direction === "desc" ? -result : result;
}

function priorityPinRank(row: ReportingBoardCaseRow): number {
  const priority = String(row.reportingPriorityCode || "").toLowerCase();
  if (priority === "stat") return 0;
  if (priority === "urgent") return 1;
  return 2;
}

function compareReportingBoardRows(filters: EffectiveReportingBoardFilters) {
  const direction = filters.sortDirection ?? "asc";
  const sortBy = filters.sortBy ?? "priority_study_date";
  return (left: ReportingBoardCaseRow, right: ReportingBoardCaseRow): number => {
    if (filters.pinUrgentToTop !== false) {
      const pinned = priorityPinRank(left) - priorityPinRank(right);
      if (pinned !== 0) return pinned;
    }

    switch (sortBy) {
      case "priority_study_date":
        return (
          compareNumber(left.reportingPrioritySortOrder, right.reportingPrioritySortOrder, "asc", "last") ||
          compareTimestamp(left.bookingDate, right.bookingDate, direction) ||
          compareText(left.bookingTime, right.bookingTime, direction) ||
          tieBreakCase(left, right)
        );
      case "study_date":
        return compareTimestamp(left.bookingDate, right.bookingDate, direction) || compareText(left.bookingTime, right.bookingTime, direction) || tieBreakCase(left, right);
      case "accession":
        return compareText(left.accessionNumber, right.accessionNumber, direction) || tieBreakCase(left, right);
      case "patient_name":
        return compareText(left.patientEnglishName ?? left.patientArabicName ?? left.patientMrn, right.patientEnglishName ?? right.patientArabicName ?? right.patientMrn, direction) || tieBreakCase(left, right);
      case "mrn":
        return compareText(left.patientMrn, right.patientMrn, direction) || tieBreakCase(left, right);
      case "exam_type":
        return compareText(left.examTypeName, right.examTypeName, direction) || tieBreakCase(left, right);
      case "modality":
        return compareText(left.modalityCode, right.modalityCode, direction) || tieBreakCase(left, right);
      case "assigned_doctor":
        return compareText(left.assignedDoctorName, right.assignedDoctorName, direction) || tieBreakCase(left, right);
      case "longest_unassigned":
        return compareNumber(left.completedUnassignedAgeMinutes, right.completedUnassignedAgeMinutes, "desc", "last") || tieBreakCase(left, right);
      case "longest_assigned_not_final":
        return compareNumber(left.currentAssignmentAgeMinutes, right.currentAssignmentAgeMinutes, "desc", "last") || tieBreakCase(left, right);
      case "oldest_completed":
        return compareTimestamp(left.completedAt, right.completedAt, direction, "last") || tieBreakCase(left, right);
      default:
        return tieBreakCase(left, right);
    }
  };
}

async function listUnifiedReportingBoardCases(filters: EffectiveReportingBoardFilters): Promise<ReportingBoardCaseRow[]> {
  const fetchLimit = fetchLimitForUnifiedCandidates(filters);
  const sourceFilters = { ...filters, limit: fetchLimit, offset: 0 };
  const [appointmentRows, comparisonRows] = await Promise.all([
    sourceAllowsAppointments(filters.caseSource) ? listReportingBoardCaseCandidates(sourceFilters) : Promise.resolve([]),
    sourceAllowsComparisons(filters.caseSource) ? listComparisonReportingBoardRows(sourceFilters) : Promise.resolve([]),
  ]);
  const resolved = await applyReportStatuses([...appointmentRows, ...comparisonRows], filters.reportStatus);
  return resolved
    .sort(compareReportingBoardRows(filters))
    .slice(filters.offset, filters.offset + filters.limit);
}

type ReportingBoardStatsInputRow = ReportingBoardStatsBaseRow & Partial<Pick<ReportingBoardCaseRow, "reportStatus">>;

function statsReportStatus(row: ReportingBoardStatsInputRow): ReportingBoardCaseRow["reportStatus"] {
  if (row.reportStatus) return row.reportStatus;
  if (!row.requiresReport) return "no_report";
  // Report status is not persisted locally. Statistics use statuses recently
  // resolved by case listing; uncached required cases stay unavailable to avoid
  // a SonicDICOM status check loop on every stats request.
  return reportStatusSnapshot.get(row.appointmentId) ?? "unavailable";
}

function statsRequiredNotFinal(row: ReportingBoardStatsInputRow): boolean {
  return row.requiresReport && statsReportStatus(row) !== "final";
}

function matchesStatsReportStatus(row: ReportingBoardStatsInputRow, reportStatus: ReportingBoardFilters["reportStatus"]): boolean {
  if (!reportStatus || reportStatus === "all") return true;
  if (reportStatus === "required_not_final") return statsRequiredNotFinal(row);
  return statsReportStatus(row) === reportStatus;
}

function emptyStatsSummary(): ReportingBoardStatsSummary {
  return {
    total: 0,
    comparisonRequests: 0,
    unassigned: 0,
    assigned: 0,
    stat: 0,
    urgent: 0,
    statOrUrgent: 0,
    requiredNotFinal: 0,
    final: 0,
    draft: 0,
    noReport: 0,
    studyNotFound: 0,
    unavailable: 0,
    overdue: 0,
    ct: 0,
    mr: 0,
    medianCompletedToAssignedMinutes: null,
    medianAssignedToFinalMinutes: null,
    p90AssignedToFinalMinutes: null,
    longestActiveAssignmentAgeMinutes: null,
    completedUnassigned: 0,
  };
}

function doctorStatsRow(row: ReportingBoardStatsBaseRow): ReportingBoardDoctorStatsRow {
  return {
    doctorId: row.assignedDoctorId,
    doctorName: row.assignedDoctorName ?? "Unassigned",
    total: 0,
    requiredNotFinal: 0,
    statOrUrgent: 0,
    oldestStudyDate: null,
    ct: 0,
    mr: 0,
  };
}

function aggregateReportingBoardStats(rows: ReportingBoardStatsInputRow[]): Omit<ReportingBoardStatsResponse, "filters"> {
  const today = todayIso();
  const summary = emptyStatsSummary();
  const byDoctor = new Map<string, ReportingBoardDoctorStatsRow>();
  const byModality = new Map<string, ReportingBoardModalityStatsRow>();
  const byPriority = new Map<string, ReportingBoardPriorityStatsRow>();
  const nowMs = Date.now();
  const completedToAssignedValues: number[] = [];
  const assignedToFinalValues: number[] = [];
  const activeAssignmentAges: number[] = [];

  for (const row of rows) {
    const priorityCode = row.reportingPriorityCode?.toLowerCase() ?? null;
    const modalityCode = String(row.modalityCode || "").toUpperCase();
    const status = statsReportStatus(row);
    const requiredNotFinal = row.requiresReport && status !== "final";
    const statOrUrgent = priorityCode === "stat" || priorityCode === "urgent";

    summary.total += 1;
    if (row.caseType === "comparison") summary.comparisonRequests += 1;
    if (row.assignmentStatus === "assigned") summary.assigned += 1;
    else summary.unassigned += 1;
    if (priorityCode === "stat") summary.stat += 1;
    if (priorityCode === "urgent") summary.urgent += 1;
    if (statOrUrgent) summary.statOrUrgent += 1;
    if (requiredNotFinal) summary.requiredNotFinal += 1;
    if (requiredNotFinal && row.bookingDate < today) summary.overdue += 1;
    if (modalityCode === "CT") summary.ct += 1;
    if (modalityCode === "MR") summary.mr += 1;
    if (status === "final") summary.final += 1;
    else if (status === "draft") summary.draft += 1;
    else if (status === "no_report") summary.noReport += 1;
    else if (status === "study_not_found") summary.studyNotFound += 1;
    else if (status === "unavailable") summary.unavailable += 1;

    const completedToAssignedMinutes = minutesBetween(row.completedAt, row.firstAssignedAt);
    if (completedToAssignedMinutes !== null) completedToAssignedValues.push(completedToAssignedMinutes);
    const assignedToFinalMinutes = row.reportFinalAt ? minutesBetween(row.currentAssignedAt, row.reportFinalAt) : null;
    if (assignedToFinalMinutes !== null) assignedToFinalValues.push(assignedToFinalMinutes);
    const activeAssignmentAge = row.assignmentStatus === "assigned" && status !== "final" ? minutesSince(row.currentAssignedAt, nowMs) : null;
    if (activeAssignmentAge !== null) activeAssignmentAges.push(activeAssignmentAge);
    if (row.appointmentStatus === "completed" && row.assignmentStatus === "unassigned" && row.completedAt) summary.completedUnassigned += 1;

    const doctorKey = row.assignedDoctorId === null ? "unassigned" : String(row.assignedDoctorId);
    const doctor = byDoctor.get(doctorKey) ?? doctorStatsRow(row);
    doctor.total += 1;
    if (requiredNotFinal) doctor.requiredNotFinal += 1;
    if (statOrUrgent) doctor.statOrUrgent += 1;
    if (!doctor.oldestStudyDate || row.bookingDate < doctor.oldestStudyDate) doctor.oldestStudyDate = row.bookingDate;
    if (modalityCode === "CT") doctor.ct += 1;
    if (modalityCode === "MR") doctor.mr += 1;
    byDoctor.set(doctorKey, doctor);

    const modality = byModality.get(modalityCode) ?? { modalityCode, total: 0, requiredNotFinal: 0, statOrUrgent: 0 };
    modality.total += 1;
    if (requiredNotFinal) modality.requiredNotFinal += 1;
    if (statOrUrgent) modality.statOrUrgent += 1;
    byModality.set(modalityCode, modality);

    const priorityKey = priorityCode ?? "none";
    const priority = byPriority.get(priorityKey) ?? { priorityCode, priorityName: row.reportingPriorityName, total: 0 };
    priority.total += 1;
    byPriority.set(priorityKey, priority);
  }

  summary.medianCompletedToAssignedMinutes = median(completedToAssignedValues);
  summary.medianAssignedToFinalMinutes = median(assignedToFinalValues);
  summary.p90AssignedToFinalMinutes = percentile(assignedToFinalValues, 90);
  summary.longestActiveAssignmentAgeMinutes = activeAssignmentAges.length ? Math.max(...activeAssignmentAges) : null;

  return {
    summary,
    byDoctor: [...byDoctor.values()].sort((a, b) => {
      if (a.doctorId === null) return -1;
      if (b.doctorId === null) return 1;
      return b.requiredNotFinal - a.requiredNotFinal || b.total - a.total || a.doctorName.localeCompare(b.doctorName);
    }),
    byModality: [...byModality.values()].sort((a, b) => a.modalityCode.localeCompare(b.modalityCode)),
    byPriority: [...byPriority.values()].sort((a, b) => (a.priorityCode ?? "\uffff").localeCompare(b.priorityCode ?? "\uffff")),
  };
}

export async function getReportingBoardSettings(actor: Actor) {
  if (actor.appRole !== "super_admin") {
    await requireRosterDoctor(actor);
  }
  return readReportingBoardSettings();
}

export async function putReportingBoardSettings(actor: Actor, input: unknown) {
  if (actor.appRole !== "super_admin") throw new HttpError(403, "Only super_admin can update Reporting Board settings.");
  return updateReportingBoardSettings(input, actor.userId);
}

export async function getReportingBoardCases(actor: Actor, input: ReportingBoardFilters) {
  const me = await requireRosterDoctor(actor);
  const canManage =
    me.moduleCapabilities.includes("doctor_supervisor") ||
    me.moduleCapabilities.includes("doctor_admin");
  const filters = await effectiveFilters(canManage ? input : { ...input, assignedDoctorId: me.profile!.id, assignmentStatus: "assigned" });
  const settings = await readReportingBoardSettings();
  const scopedFilters =
    filters.modalityCode || filters.modalityId ? filters : { ...filters, modalityCodes: settings.enabledModalityCodes };
  const cases = await listUnifiedReportingBoardCases(scopedFilters);
  return { cases, filters };
}

export async function getReportingBoardStats(actor: Actor, input: ReportingBoardFilters): Promise<ReportingBoardStatsResponse> {
  const me = await requireRosterDoctor(actor);
  const canManage =
    me.moduleCapabilities.includes("doctor_supervisor") ||
    me.moduleCapabilities.includes("doctor_admin");
  const filters = await effectiveFilters(canManage ? input : { ...input, assignedDoctorId: me.profile!.id, assignmentStatus: "assigned" });
  const settings = await readReportingBoardSettings();
  const scopedFilters =
    filters.modalityCode || filters.modalityId ? filters : { ...filters, modalityCodes: settings.enabledModalityCodes };
  if (filters.reportStatus && filters.reportStatus !== "all") {
    const cases = await listUnifiedReportingBoardCases({ ...scopedFilters, limit: MAX_UNIFIED_CANDIDATE_FETCH, offset: 0 });
    return { filters, ...aggregateReportingBoardStats(cases) };
  }
  const rows = [
    ...(sourceAllowsAppointments(filters.caseSource) ? await listReportingBoardStatsRows(scopedFilters) : []),
    ...(sourceAllowsComparisons(filters.caseSource) ? await listComparisonReportingBoardStatsRows(scopedFilters) : []),
  ].filter((row) => matchesStatsReportStatus(row, filters.reportStatus));
  return { filters, ...aggregateReportingBoardStats(rows) };
}

type SonicDicomOpenScope = "study" | "patient";

function normalizeSonicDicomOpenScope(scope?: string | null): SonicDicomOpenScope {
  if (!scope || scope === "study") return "study";
  if (scope === "patient") return "patient";
  throw new HttpError(400, "SonicDICOM open scope must be study or patient.");
}

export async function getReportingBoardSonicDicomStudyRedirect(actor: Actor, appointmentId: number, scopeInput?: string | null): Promise<{ redirectUrl: string }> {
  const me = await requireRosterDoctor(actor);
  const scope = normalizeSonicDicomOpenScope(scopeInput);
  const canManage =
    me.moduleCapabilities.includes("doctor_supervisor") ||
    me.moduleCapabilities.includes("doctor_admin");
  const filters = await effectiveFilters(
    canManage
      ? { appointmentId, reportStatus: "all", limit: 1, offset: 0 }
      : { appointmentId, assignedDoctorId: me.profile!.id, assignmentStatus: "assigned", reportStatus: "all", limit: 1, offset: 0 }
  );
  const settings = await readReportingBoardSettings();
  const scopedFilters =
    filters.modalityCode || filters.modalityId ? filters : { ...filters, modalityCodes: settings.enabledModalityCodes };
  const rows = await listReportingBoardCaseCandidates(scopedFilters);
  const row = rows[0] ?? null;
  if (!row) {
    const existing = await listReportingBoardCasesByAppointmentIds([appointmentId]);
    if (existing.length === 0) throw new HttpError(404, "Case not found.");
    throw new HttpError(403, "You are not allowed to open this Reporting Board case in SonicDICOM.");
  }

  const accessionNumber = String(row.accessionNumber || "").trim();
  const patientMrn = String(row.patientMrn || "").trim();
  const patientDicomId = String(row.patientDicomId || "").trim();
  if (scope === "study" && !accessionNumber) throw new HttpError(400, "Accession number is required to open the SonicDICOM study.");
  if (scope === "patient" && !patientDicomId) throw new HttpError(400, "DICOM Patient ID is required to open the patient list in SonicDICOM.");
  const sonicSettings = await readSonicDicomReportSettings();
  const redirectUrl = buildSonicDicomStaffViewerUrl({
    settings: sonicSettings,
    target: scope === "study" ? "studyViewer" : "patientList",
    value: scope === "study" ? accessionNumber : patientDicomId,
  });

  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: me.profile?.id ?? null,
    eventType: "reporting_board_sonicdicom_study_opened",
    targetType: "appointment",
    targetId: appointmentId,
    metadata: {
      appointmentId,
      accessionNumber,
      patientDicomId,
      patientMrn,
      patientId: row.patientId,
      studyInstanceUid: row.studyInstanceUid,
      actorUserId: actor.userId,
      actorDoctorId: me.profile?.id ?? null,
      scope,
      source: "reporting_board",
    },
    reason: null,
  });

  return { redirectUrl };
}

export async function markReportingBoardCaseDiscontinued(actor: Actor, appointmentId: number, reasonInput: string): Promise<{ ok: true; status: string; autoCompletionDisabledMessage?: string }> {
  await requireRosterManager(actor);
  const reason = String(reasonInput || "").trim();
  if (!reason) throw new HttpError(400, "A reason is required to mark a study as discontinued.");

  const settings = await readReportingBoardSettings();
  const filters = await effectiveFilters({ appointmentId, reportStatus: "all", limit: 1, offset: 0 });
  const scopedFilters =
    filters.modalityCode || filters.modalityId ? filters : { ...filters, modalityCodes: settings.enabledModalityCodes };
  const rows = await listReportingBoardCaseCandidates(scopedFilters);
  const row = rows[0] ?? null;
  if (!row) {
    const existing = await listReportingBoardCasesByAppointmentIds([appointmentId]);
    if (existing.length === 0) throw new HttpError(404, "Case not found.");
    throw new HttpError(403, "This case is not visible on the Reporting Board.");
  }
  if (row.appointmentStatus !== "completed") {
    throw new HttpError(409, "Only completed Reporting Board cases can be marked discontinued.");
  }

  const result = await updateBookingStatusManual(
    appointmentId,
    "discontinued",
    reason,
    Number(actor.userId),
    actor.appRole
  );
  return {
    ok: true,
    status: result.status,
    autoCompletionDisabledMessage: result.autoCompletionDisabledMessage,
  };
}

function mobileCase(row: ReportingBoardCaseRow) {
  return {
    caseType: row.caseType,
    caseKey: row.caseKey,
    appointmentId: row.appointmentId,
    comparisonRequestId: row.comparisonRequestId,
    patientName: row.patientEnglishName || row.patientArabicName || row.patientMrn || `Patient ${row.patientId}`,
    mrn: row.patientMrn,
    accessionNumber: row.accessionNumber,
    date: row.bookingDate,
    time: row.bookingTime,
    modality: row.modalityCode,
    exam: row.examTypeName,
    category: row.caseCategory,
    assignedDoctor: row.assignedDoctorName,
    priority: row.reportingPriorityName || row.reportingPriorityCode,
    priorityCode: row.reportingPriorityCode,
    reportStatus: row.reportStatus,
    appointmentStatus: row.appointmentStatus,
    assignmentStatus: row.assignmentStatus,
    canAssign: row.canAssign,
    exclusionReason: row.exclusionReason,
    linkedPreviousStudyDate: row.linkedPreviousStudyDate,
    linkedPreviousAccessionNumber: row.linkedPreviousAccessionNumber,
  };
}

function mobileCounters(cases: ReportingBoardCaseRow[], actorDoctorId?: number | null) {
  const today = todayIso();
  return {
    total: cases.length,
    assignedToMe: actorDoctorId ? cases.filter((row) => row.assignedDoctorId === actorDoctorId).length : null,
    unassigned: cases.filter((row) => row.assignmentStatus === "unassigned").length,
    urgent: cases.filter((row) => ["urgent", "stat"].includes(String(row.reportingPriorityCode || "").toLowerCase())).length,
    requiredNotFinal: cases.filter((row) => row.requiresReport && row.reportStatus !== "final").length,
    overdue: cases.filter((row) => row.requiresReport && row.reportStatus !== "final" && row.bookingDate < today).length,
  };
}

function filterSummary(filters: ReportingBoardFilters): string[] {
  return [
    filters.reportStatus ? String(filters.reportStatus).replaceAll("_", " ") : null,
    filters.modalityCode ?? (filters.modalityCodes?.length ? filters.modalityCodes.join("/") : null),
    filters.dateFrom && filters.dateTo ? `${filters.dateFrom} to ${filters.dateTo}` : filters.dateFrom ?? null,
    filters.priorityCode ? `priority ${filters.priorityCode}` : null,
    filters.assignmentStatus && filters.assignmentStatus !== "all" ? filters.assignmentStatus : null,
  ].filter(Boolean) as string[];
}

async function getMobileIdentity(actor?: Actor | null) {
  if (!actor) return null;
  try {
    return await requireRosterDoctor(actor);
  } catch {
    return null;
  }
}

export async function getPublicReportingBoardMobileView(actor: Actor | null, token: string, input: ReportingBoardFilters = {}) {
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Saved view not found.");
  const identity = await getMobileIdentity(actor);
  const filters = await effectiveFilters(narrowSavedViewFilters(view.filters, { ...input, limit: input.limit ?? 100 }));
  const settings = await readReportingBoardSettings();
  const scopedFilters = filters.modalityCode || filters.modalityId ? filters : { ...filters, modalityCodes: filters.modalityCodes ?? settings.enabledModalityCodes };
  const cases = await listUnifiedReportingBoardCases(scopedFilters);
  const canManage = Boolean(identity?.moduleCapabilities.includes("doctor_supervisor") || identity?.moduleCapabilities.includes("doctor_admin"));

  await insertDoctorAuditEvent(pool, {
    actorUserId: actor?.userId ?? null,
    actorDoctorId: identity?.profile?.id ?? null,
    eventType: "reporting_board_mobile_saved_view_opened",
    targetType: "reporting_board_saved_view",
    targetId: view.id,
    metadata: { tokenScoped: true },
    reason: null,
  }).catch(() => undefined);

  return {
    savedView: { id: view.id, name: view.name, token: view.token },
    filters,
    filterSummary: filterSummary(filters),
    counters: mobileCounters(cases, identity?.profile?.id ?? null),
    cases: cases.map(mobileCase),
    allowedActions: {
      readOnly: !canManage,
      assignToMe: canManage,
      reassign: canManage,
      batchReassign: canManage,
      copyAccession: Boolean(identity),
    },
    refreshedAt: new Date().toISOString(),
  };
}

type MobileCaseIdentity =
  | { caseType: "appointment"; appointmentId: number }
  | { caseType: "comparison"; comparisonRequestId: number };

export async function getPublicReportingBoardMobileCase(actor: Actor | null, token: string, identity: MobileCaseIdentity, input: ReportingBoardFilters = {}) {
  const view = await getPublicReportingBoardMobileView(actor, token, {
    ...input,
    appointmentId: identity.caseType === "appointment" ? identity.appointmentId : null,
    comparisonRequestId: identity.caseType === "comparison" ? identity.comparisonRequestId : null,
    limit: 1,
    offset: 0,
  });
  const found = view.cases.find((row) =>
    identity.caseType === "appointment"
      ? row.caseType === "appointment" && row.appointmentId === identity.appointmentId
      : row.caseType === "comparison" && row.comparisonRequestId === identity.comparisonRequestId
  );
  if (!found) throw new HttpError(404, "Case not found.");
  return { savedView: view.savedView, case: found, allowedActions: view.allowedActions, refreshedAt: view.refreshedAt };
}

async function ensureCaseInSavedViewScope(token: string, identity: MobileCaseIdentity): Promise<void> {
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Saved view not found.");
  const filters = await effectiveFilters(narrowSavedViewFilters(view.filters, {
    appointmentId: identity.caseType === "appointment" ? identity.appointmentId : null,
    comparisonRequestId: identity.caseType === "comparison" ? identity.comparisonRequestId : null,
    limit: 1,
    offset: 0,
  }));
  const rows = identity.caseType === "appointment"
    ? await listReportingBoardCaseCandidates(filters)
    : await listComparisonReportingBoardRows(filters);
  const found = rows.some((row) =>
    identity.caseType === "appointment"
      ? row.caseType === "appointment" && row.appointmentId === identity.appointmentId
      : row.caseType === "comparison" && row.comparisonRequestId === identity.comparisonRequestId
  );
  if (!found) throw new HttpError(404, "Case not found.");
}

export async function assignReportingBoardMobileCaseToMe(actor: Actor, token: string, identity: MobileCaseIdentity, reason?: string | null) {
  const me = await requireRosterManager(actor);
  await ensureCaseInSavedViewScope(token, identity);
  return identity.caseType === "appointment"
    ? assignReportingBoardCaseToDoctor(actor, { appointmentId: identity.appointmentId, doctorId: me.profile!.id, reason: reason ?? "mobile saved-view assign to me" })
    : assignComparisonRequest(actor, identity.comparisonRequestId, { doctorId: me.profile!.id, reason: reason ?? "mobile saved-view assign to me" });
}

export async function reassignReportingBoardMobileCase(actor: Actor, token: string, identity: MobileCaseIdentity, doctorId: number, reason?: string | null) {
  await requireRosterManager(actor);
  await ensureCaseInSavedViewScope(token, identity);
  return identity.caseType === "appointment"
    ? assignReportingBoardCaseToDoctor(actor, { appointmentId: identity.appointmentId, doctorId, reason: reason ?? "mobile saved-view reassignment" })
    : assignComparisonRequest(actor, identity.comparisonRequestId, { doctorId, reason: reason ?? "mobile saved-view reassignment" });
}

export async function unassignReportingBoardMobileCase(actor: Actor, token: string, identity: MobileCaseIdentity, reason?: string | null) {
  await requireRosterManager(actor);
  await ensureCaseInSavedViewScope(token, identity);
  return identity.caseType === "appointment"
    ? unassignReportingBoardCase(actor, { appointmentId: identity.appointmentId, reason })
    : unassignComparisonRequest(actor, identity.comparisonRequestId, reason);
}

export async function listMyReportingBoardSavedViews(actor: Actor) {
  const me = await requireRosterDoctor(actor);
  return listSavedViews(actor.userId, me.profile!.id);
}

export async function createReportingBoardSavedView(
  actor: Actor,
  input: { name: string; filters: ReportingBoardFilters; notificationSettings: ReportingBoardNotificationSettings }
) {
  const me = await requireRosterDoctor(actor);
  const name = input.name.trim();
  if (!name) throw new HttpError(400, "name is required.");
  return createSavedView({
    ownerUserId: actor.userId,
    ownerDoctorId: me.profile!.id,
    name,
    filters: input.filters,
    notificationSettings: input.notificationSettings,
  });
}

export async function updateReportingBoardSavedView(
  actor: Actor,
  input: {
    id: number;
    name?: string;
    filters?: ReportingBoardFilters;
    notificationSettings?: ReportingBoardNotificationSettings;
    active?: boolean;
  }
) {
  const me = await requireRosterDoctor(actor);
  const view = await updateSavedView({
    id: input.id,
    ownerUserId: actor.userId,
    ownerDoctorId: me.profile!.id,
    name: input.name?.trim(),
    filters: input.filters,
    notificationSettings: input.notificationSettings,
    active: input.active,
  });
  if (!view) throw new HttpError(404, "Saved view not found.");
  return view;
}

export async function loadReportingBoardSavedViewByToken(actor: Actor, token: string) {
  const me = await requireRosterDoctor(actor);
  let view = await findSavedViewByToken(token, actor.userId);
  if (!view && (me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin"))) {
    view = await findActiveSavedViewByToken(token);
  }
  if (!view) throw new HttpError(404, "Saved view not found.");
  return view;
}

async function filtersFromBulkInput(actor: Actor, input: BulkAssignNextCasesInput): Promise<ReportingBoardFilters> {
  if (input.savedViewId) {
    const view = await findSavedViewById(input.savedViewId, actor.userId);
    if (!view) throw new HttpError(404, "Saved view not found.");
    return view.filters;
  }
  if (input.token) {
    let view = await findSavedViewByToken(input.token, actor.userId);
    if (!view) {
      await requireRosterManager(actor);
      view = await findActiveSavedViewByToken(input.token);
    }
    if (!view) throw new HttpError(404, "Saved view not found.");
    return view.filters;
  }
  return input.filters ?? {};
}

export async function bulkAssignNextReportingBoardCases(actor: Actor, input: BulkAssignNextCasesInput) {
  const me = await requireRosterManager(actor);
  if (!Number.isInteger(input.count) || input.count <= 0 || input.count > MAX_BULK_ASSIGN_COUNT) {
    throw new HttpError(400, `count must be between 1 and ${MAX_BULK_ASSIGN_COUNT}.`);
  }

  const doctor = await findAssignableDoctorForReporting(input.doctorId);
  if (!doctor) throw new HttpError(404, "Active doctor profile not found.");
  if (!doctor.canFinalizeReports) throw new HttpError(400, "Doctor must be allowed to finalize reports.");

  const rawFilters = await filtersFromBulkInput(actor, input);
  const filters = await effectiveFilters({
    ...rawFilters,
    assignmentStatus: input.unassignedOnly === false ? rawFilters.assignmentStatus : "unassigned",
    limit: Math.min(MAX_CASE_LIST_LIMIT, input.count * 3),
    offset: 0,
  });
  const { cases } = await getReportingBoardCases(actor, filters);
  const explicitlyAllowsFinal = filters.reportStatus === "final" || filters.reportStatus === "all";
  const eligible = cases.filter((row) => {
    if (row.caseType !== "appointment") return false;
    if (!row.canAssign) return false;
    if (input.unassignedOnly !== false && row.assignmentStatus !== "unassigned") return false;
    if (row.reportStatus === "final" && !explicitlyAllowsFinal) return false;
    return true;
  });
  const selected = eligible.slice(0, input.count);
  const hasModalityPermission = await doctorCanReportAllModalities(
    input.doctorId,
    [...new Set(selected.map((row) => row.modalityId))]
  );
  if (!hasModalityPermission) throw new HttpError(400, "Doctor does not have report permission for the selected modalities.");

  const result = await bulkAssignReportingCases({
    doctorId: input.doctorId,
    candidateAppointmentIds: selected.map((row) => row.appointmentId),
    reason: input.reason?.trim() || null,
    unassignedOnly: input.unassignedOnly !== false,
    actor: { userId: actor.userId, doctorId: me.profile!.id },
  });
  await createAssignedToMeNotifications({
    doctorId: input.doctorId,
    appointmentIds: result.assignedAppointmentIds,
  });
  const selectedIds = new Set(selected.map((row) => row.appointmentId));
  const preSkipped = cases
    .filter((row) => !selectedIds.has(row.appointmentId))
    .slice(0, Math.max(0, input.count - result.assignedCount))
    .map((row) => ({ appointmentId: row.appointmentId, reason: row.exclusionReason ?? "not_selected" }));
  return {
    ...result,
    requestedCount: input.count,
    skippedCount: result.skippedCount + preSkipped.length,
    skipped: [...result.skipped, ...preSkipped],
  };
}

function scheduledForIso(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new HttpError(400, "scheduledFor must be a valid date/time.");
  }
  return date.toISOString();
}

function compactReportingBoardFilters(input: ReportingBoardFilters): ReportingBoardFilters {
  const output: ReportingBoardFilters = {};
  for (const [key, value] of Object.entries(input) as Array<[keyof ReportingBoardFilters, ReportingBoardFilters[keyof ReportingBoardFilters]]>) {
    if (value !== null && value !== undefined && value !== "") output[key] = value as never;
  }
  return output;
}

function frozenScheduledFilters(input: ReportingBoardFilters): ReportingBoardFilters {
  return compactReportingBoardFilters({
    ...input,
    caseSource: "appointments",
    assignmentStatus: "unassigned",
    limit: null,
    offset: null,
    appointmentId: null,
    comparisonRequestId: null,
    assignedDoctorId: null,
  });
}

function normalizeScheduledJobInput(input: CreateReportingBoardBulkAssignmentJobInput): CreateReportingBoardBulkAssignmentJobInput {
  if (!Number.isInteger(input.doctorId) || input.doctorId <= 0) throw new HttpError(400, "doctorId must be a positive integer.");
  if (!Number.isInteger(input.count) || input.count <= 0 || input.count > MAX_BULK_ASSIGN_COUNT) {
    throw new HttpError(400, `count must be between 1 and ${MAX_BULK_ASSIGN_COUNT}.`);
  }
  return {
    scheduledFor: scheduledForIso(input.scheduledFor),
    doctorId: input.doctorId,
    count: input.count,
    filters: frozenScheduledFilters(input.filters ?? {}),
    savedViewId: input.savedViewId ?? null,
    savedViewName: input.savedViewName?.trim() || null,
    reason: input.reason?.trim() || null,
  };
}

async function withSavedViewName(actor: Actor, input: CreateReportingBoardBulkAssignmentJobInput): Promise<CreateReportingBoardBulkAssignmentJobInput> {
  if (!input.savedViewId) return input;
  const view = await findSavedViewById(input.savedViewId, actor.userId);
  if (!view) throw new HttpError(404, "Saved view not found.");
  return { ...input, savedViewName: view.name };
}

export async function createScheduledReportingBoardBulkAssignmentJob(
  actor: Actor,
  input: CreateReportingBoardBulkAssignmentJobInput
): Promise<ReportingBoardBulkAssignmentJob> {
  const me = await requireRosterManager(actor);
  const normalized = normalizeScheduledJobInput(await withSavedViewName(actor, input));
  return createReportingBoardBulkAssignmentJob(normalized, { userId: actor.userId, doctorId: me.profile!.id });
}

export async function createScheduledReportingBoardBulkAssignmentJobs(
  actor: Actor,
  input: CreateReportingBoardBulkAssignmentJobsInput
): Promise<ReportingBoardBulkAssignmentJob[]> {
  if (!Array.isArray(input.jobs) || input.jobs.length === 0) throw new HttpError(400, "jobs must be a non-empty array.");
  if (input.jobs.length > MAX_SCHEDULED_BULK_ASSIGN_JOBS) throw new HttpError(400, `jobs must contain ${MAX_SCHEDULED_BULK_ASSIGN_JOBS} or fewer items.`);
  const jobs: ReportingBoardBulkAssignmentJob[] = [];
  for (const job of input.jobs) {
    jobs.push(await createScheduledReportingBoardBulkAssignmentJob(actor, job));
  }
  return jobs;
}

export async function getScheduledReportingBoardBulkAssignmentJobs(actor: Actor): Promise<ReportingBoardBulkAssignmentJob[]> {
  await requireRosterManager(actor);
  return listReportingBoardBulkAssignmentJobs();
}

export async function cancelScheduledReportingBoardBulkAssignmentJob(actor: Actor, id: number): Promise<ReportingBoardBulkAssignmentJob> {
  await requireRosterManager(actor);
  const job = await cancelReportingBoardBulkAssignmentJob({ id, actorUserId: actor.userId });
  if (!job) {
    const existing = await findReportingBoardBulkAssignmentJobById(id);
    if (!existing) throw new HttpError(404, "Scheduled bulk assignment job not found.");
    throw new HttpError(409, "Only scheduled jobs can be cancelled.");
  }
  return job;
}

export async function executeClaimedReportingBoardBulkAssignmentJob(
  job: ClaimedReportingBoardBulkAssignmentJob
): Promise<ReportingBoardBulkAssignmentJob> {
  try {
    if (!job.createdByUserId || !job.creatorUserActive || !job.creatorAppRole) {
      throw new HttpError(403, "Creator user is no longer active.");
    }
    await requireRosterManager({ userId: job.createdByUserId, appRole: job.creatorAppRole as Role });
    const result = await bulkAssignNextReportingBoardCases(
      { userId: job.createdByUserId, appRole: job.creatorAppRole as Role },
      {
        doctorId: job.targetDoctorId,
        count: job.caseCount,
        filters: frozenScheduledFilters(job.filters),
        savedViewId: null,
        token: null,
        unassignedOnly: true,
        reason: job.reason,
      }
    );
    await completeReportingBoardBulkAssignmentJob({ id: job.id, result });
  } catch (error) {
    await failReportingBoardBulkAssignmentJob({ id: job.id, error: error instanceof Error ? error.message : String(error) });
  }
  const refreshed = await findReportingBoardBulkAssignmentJobById(job.id);
  if (!refreshed) throw new HttpError(404, "Scheduled bulk assignment job not found.");
  return refreshed;
}

export async function runDueScheduledReportingBoardBulkAssignmentJobs(options: {
  limit?: number;
  lockedBy: string;
}): Promise<{ checked: number; completed: number; failed: number }> {
  const claimed = await claimDueReportingBoardBulkAssignmentJobs({ limit: options.limit ?? 5, lockedBy: options.lockedBy });
  let completed = 0;
  let failed = 0;
  for (const job of claimed) {
    const result = await executeClaimedReportingBoardBulkAssignmentJob(job);
    if (result.status === "completed") completed += 1;
    if (result.status === "failed") failed += 1;
  }
  return { checked: claimed.length, completed, failed };
}

export async function runScheduledReportingBoardBulkAssignmentJobNow(
  actor: Actor,
  id: number,
  lockedBy: string
): Promise<ReportingBoardBulkAssignmentJob> {
  await requireRosterManager(actor);
  const claimed = await claimReportingBoardBulkAssignmentJobForRunNow({ id, lockedBy });
  if (!claimed) {
    const existing = await findReportingBoardBulkAssignmentJobById(id);
    if (!existing) throw new HttpError(404, "Scheduled bulk assignment job not found.");
    throw new HttpError(409, "Only scheduled or failed jobs can be run now.");
  }
  return executeClaimedReportingBoardBulkAssignmentJob(claimed);
}

function uniquePositiveAppointmentIds(appointmentIds: number[]): number[] {
  if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
    throw new HttpError(400, "appointmentIds must be a non-empty array.");
  }
  return uniquePositiveIds(appointmentIds, "appointmentIds");
}

function uniquePositiveIds(ids: number[], field: string): number[] {
  const uniqueIds: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, `${field} must contain only positive integers.`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }
  if (uniqueIds.length > MAX_SELECTED_REASSIGN_COUNT) {
    throw new HttpError(400, `${field} must contain ${MAX_SELECTED_REASSIGN_COUNT} or fewer cases.`);
  }
  return uniqueIds;
}

export async function bulkReassignSelectedReportingBoardCases(actor: Actor, input: BulkReassignSelectedCasesInput): Promise<BulkAssignNextCasesResult> {
  const me = await requireRosterManager(actor);
  const appointmentIds = input.appointmentIds.length ? uniquePositiveIds(input.appointmentIds, "appointmentIds") : [];
  const comparisonRequestIds = input.comparisonRequestIds?.length ? uniquePositiveIds(input.comparisonRequestIds, "comparisonRequestIds") : [];
  if (appointmentIds.length === 0 && comparisonRequestIds.length === 0) throw new HttpError(400, "At least one selected case is required.");
  const doctor = await findAssignableDoctorForReporting(input.doctorId);
  if (!doctor) throw new HttpError(404, "Active doctor profile not found.");
  if (!doctor.canFinalizeReports) throw new HttpError(400, "Doctor must be allowed to finalize reports.");

  const rows = await applyReportStatuses(await listReportingBoardCasesByAppointmentIds(appointmentIds), "all");
  const comparisonRows = await applyReportStatuses(
    (await Promise.all(comparisonRequestIds.map((id) => listComparisonReportingBoardRows({ comparisonRequestId: id, reportStatus: "all", limit: 1, offset: 0 })))).flat(),
    "all"
  );
  const rowsById = new Map(rows.map((row) => [row.appointmentId, row]));
  const comparisonRowsById = new Map(comparisonRows.map((row) => [row.comparisonRequestId, row]));
  const selectedModalities = [...new Set(rows.map((row) => row.modalityId))];
  for (const row of comparisonRows) selectedModalities.push(row.modalityId);
  const hasModalityPermission = await doctorCanReportAllModalities(input.doctorId, selectedModalities);
  if (!hasModalityPermission) throw new HttpError(400, "Doctor does not have report permission for the selected modalities.");

  const skipped: Array<{ appointmentId?: number; comparisonRequestId?: number; reason: string }> = [];
  const eligibleIds: number[] = [];
  for (const appointmentId of appointmentIds) {
    const row = rowsById.get(appointmentId);
    if (!row) {
      skipped.push({ appointmentId, reason: "appointment_not_found" });
      continue;
    }
    if (!row.requiresReport || row.appointmentStatus !== "completed") {
      skipped.push({ appointmentId, reason: row.exclusionReason ?? "case_not_assignable" });
      continue;
    }
    if (row.reportStatus === "final" && input.allowFinal !== true) {
      skipped.push({ appointmentId, reason: "report_final" });
      continue;
    }
    eligibleIds.push(appointmentId);
  }
  const assignedComparisonRequestIds: number[] = [];
  for (const comparisonRequestId of comparisonRequestIds) {
    const row = comparisonRowsById.get(comparisonRequestId);
    if (!row) {
      skipped.push({ comparisonRequestId, reason: "comparison_not_found" });
      continue;
    }
    if (row.reportStatus === "final" && input.allowFinal !== true) {
      skipped.push({ comparisonRequestId, reason: "report_final" });
      continue;
    }
    await assignComparisonRequest(actor, comparisonRequestId, { doctorId: input.doctorId, reason: input.reason?.trim() || null });
    assignedComparisonRequestIds.push(comparisonRequestId);
  }

  const result = await bulkAssignReportingCases({
    doctorId: input.doctorId,
    candidateAppointmentIds: eligibleIds,
    reason: input.reason?.trim() || null,
    unassignedOnly: false,
    actor: { userId: actor.userId, doctorId: me.profile!.id },
    caseAuditEventType: "reporting_board_bulk_selected_case_reassigned",
    summaryAuditEventType: "reporting_board_bulk_selected_reassign_completed",
  });
  await createAssignedToMeNotifications({
    doctorId: input.doctorId,
    appointmentIds: result.assignedAppointmentIds,
  });
  return {
    requestedCount: appointmentIds.length + comparisonRequestIds.length,
    assignedCount: result.assignedCount + assignedComparisonRequestIds.length,
    skippedCount: skipped.length + result.skippedCount,
    assignedAppointmentIds: result.assignedAppointmentIds,
    assignedComparisonRequestIds,
    skipped: [...skipped, ...result.skipped],
  };
}

export async function unassignReportingBoardCase(
  actor: Actor,
  input: { appointmentId: number; reason?: string | null }
) {
  const me = await requireRosterManager(actor);
  const reason = input.reason?.trim();
  if (!reason) throw new HttpError(400, "Reason is required.");

  const rows = await applyReportStatuses(await listReportingBoardCasesByAppointmentIds([input.appointmentId]), "all");
  const row = rows[0];
  if (!row) throw new HttpError(404, "Appointment not found.");
  if (!row.requiresReport) throw new HttpError(400, "Report is not required for this case.");
  if (row.appointmentStatus !== "completed") throw new HttpError(400, "Study is not completed.");
  if (row.reportStatus === "final") throw new HttpError(409, "Final reports cannot be returned to the waiting pool.");
  if (row.assignmentStatus !== "assigned") throw new HttpError(409, "No active reporting assignment found.");

  try {
    return await unassignReportingCase({
      appointmentId: input.appointmentId,
      reason,
      actor: { userId: actor.userId, doctorId: me.profile!.id },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "appointment_not_found") {
      throw new HttpError(404, "Appointment not found.");
    }
    if (error instanceof Error && error.message === "active_assignment_not_found") {
      throw new HttpError(409, "No active reporting assignment found.");
    }
    throw error;
  }
}

export async function bulkUnassignSelectedReportingBoardCases(actor: Actor, input: BulkUnassignSelectedCasesInput): Promise<BulkUnassignSelectedCasesResult> {
  const me = await requireRosterManager(actor);
  const appointmentIds = input.appointmentIds.length ? uniquePositiveIds(input.appointmentIds, "appointmentIds") : [];
  const comparisonRequestIds = input.comparisonRequestIds?.length ? uniquePositiveIds(input.comparisonRequestIds, "comparisonRequestIds") : [];
  if (appointmentIds.length === 0 && comparisonRequestIds.length === 0) throw new HttpError(400, "At least one selected case is required.");
  const reason = input.reason?.trim();
  if (!reason) throw new HttpError(400, "Reason is required.");

  const rows = await applyReportStatuses(await listReportingBoardCasesByAppointmentIds(appointmentIds), "all");
  const rowsById = new Map(rows.map((row) => [row.appointmentId, row]));
  const skipped: Array<{ appointmentId: number; reason: string }> = [];
  const eligibleIds: number[] = [];
  for (const appointmentId of appointmentIds) {
    const row = rowsById.get(appointmentId);
    if (!row) {
      skipped.push({ appointmentId, reason: "appointment_not_found" });
      continue;
    }
    if (row.assignmentStatus !== "assigned") {
      skipped.push({ appointmentId, reason: "no_active_assignment" });
      continue;
    }
    if (!row.requiresReport) {
      skipped.push({ appointmentId, reason: "report_not_required" });
      continue;
    }
    if (row.appointmentStatus !== "completed") {
      skipped.push({ appointmentId, reason: row.exclusionReason ?? "study_not_completed" });
      continue;
    }
    if (row.reportStatus === "final" && input.allowFinal !== true) {
      skipped.push({ appointmentId, reason: "report_final" });
      continue;
    }
    eligibleIds.push(appointmentId);
  }
  const comparisonRows = await applyReportStatuses(
    (await Promise.all(comparisonRequestIds.map((id) => listComparisonReportingBoardRows({ comparisonRequestId: id, reportStatus: "all", limit: 1, offset: 0 })))).flat(),
    "all"
  );
  const comparisonRowsById = new Map(comparisonRows.map((row) => [row.comparisonRequestId, row]));
  const unassignedComparisonRequestIds: number[] = [];
  const comparisonSkipped: Array<{ comparisonRequestId: number; reason: string }> = [];
  for (const comparisonRequestId of comparisonRequestIds) {
    const row = comparisonRowsById.get(comparisonRequestId);
    if (!row) {
      comparisonSkipped.push({ comparisonRequestId, reason: "comparison_not_found" });
      continue;
    }
    if (row.assignmentStatus !== "assigned") {
      comparisonSkipped.push({ comparisonRequestId, reason: "no_active_assignment" });
      continue;
    }
    if (row.reportStatus === "final" && input.allowFinal !== true) {
      comparisonSkipped.push({ comparisonRequestId, reason: "report_final" });
      continue;
    }
    await unassignComparisonRequest(actor, comparisonRequestId, reason);
    unassignedComparisonRequestIds.push(comparisonRequestId);
  }

  const result = await bulkUnassignReportingCases({
    candidateAppointmentIds: eligibleIds,
    reason,
    actor: { userId: actor.userId, doctorId: me.profile!.id },
    skipped,
  });
  return {
    ...result,
    requestedCount: appointmentIds.length + comparisonRequestIds.length,
    unassignedCount: result.unassignedCount + unassignedComparisonRequestIds.length,
    skippedCount: result.skippedCount + comparisonSkipped.length,
    unassignedComparisonRequestIds,
    skipped: [...result.skipped, ...comparisonSkipped],
  };
}

export async function assignReportingBoardCaseToDoctor(
  actor: Actor,
  input: { appointmentId: number; doctorId: number; reason?: string | null }
) {
  await requireRosterManager(actor);
  const result = await assignDoctorCase(actor, {
    appointmentId: input.appointmentId,
    doctorId: input.doctorId,
    reason: input.reason ?? null,
  });
  await createAssignedToMeNotifications({
    doctorId: input.doctorId,
    appointmentIds: [input.appointmentId],
  });
  return result;
}

export async function getMyReportingBoardNotifications(actor: Actor) {
  await requireRosterDoctor(actor);
  return listReportingBoardNotifications(actor.userId);
}

export async function readMyReportingBoardNotification(actor: Actor, id: number) {
  await requireRosterDoctor(actor);
  const notification = await markReportingBoardNotificationRead(actor.userId, id);
  if (!notification) throw new HttpError(404, "Notification not found.");
  return notification;
}

export async function dismissMyReportingBoardNotification(actor: Actor, id: number) {
  await requireRosterDoctor(actor);
  const notification = await dismissReportingBoardNotification(actor.userId, id);
  if (!notification) throw new HttpError(404, "Notification not found.");
  return notification;
}

export async function readAllMyReportingBoardNotifications(actor: Actor) {
  await requireRosterDoctor(actor);
  return markAllReportingBoardNotificationsRead(actor.userId);
}

export async function getReportingBoardPushConfig(actor: Actor) {
  await requireRosterDoctor(actor);
  return readReportingBoardPushConfig();
}

export async function getPublicReportingBoardMobilePushConfig(token: string) {
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Saved view not found.");
  return readReportingBoardPushConfig();
}

export async function subscribeReportingBoardSavedViewPush(
  actor: Actor,
  input: { savedViewId: number; subscription: BrowserPushSubscriptionInput; userAgent?: string | null }
) {
  const me = await requireRosterDoctor(actor);
  const view = await findSavedViewById(input.savedViewId, actor.userId);
  if (!view) throw new HttpError(404, "Saved view not found.");
  return upsertReportingBoardPushSubscription({
    savedViewId: view.id,
    userId: actor.userId,
    doctorId: me.profile!.id,
    subscription: input.subscription,
    userAgent: input.userAgent,
  });
}

export async function subscribePublicReportingBoardMobilePush(
  token: string,
  input: { subscription: BrowserPushSubscriptionInput; userAgent?: string | null }
) {
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Saved view not found.");
  return upsertReportingBoardPushSubscription({
    savedViewId: view.id,
    userId: null,
    doctorId: null,
    subscription: input.subscription,
    userAgent: input.userAgent,
  });
}

export async function sendReportingBoardSavedViewTestNotification(actor: Actor, savedViewId: number) {
  await requireRosterDoctor(actor);
  const view = await findSavedViewById(savedViewId, actor.userId);
  if (!view) throw new HttpError(404, "Saved view not found.");
  const { cases } = await getReportingBoardCases(actor, { ...view.filters, limit: 1, offset: 0 });
  return sendReportingBoardSavedViewTestPush({
    savedViewId: view.id,
    actionUrl: `/mobile/reporting-view/${view.token}`,
    caseRow: cases[0] ?? null,
  });
}
