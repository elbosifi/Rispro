import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { pool } from "../../db/pool.js";
import {
  buildSonicDicomStaffViewerUrl,
  checkSonicDicomReportStatusesBatch,
  type ReportLookupContext,
} from "../../services/sonicdicom-report-service.js";
import { readSonicDicomReportSettings } from "../../services/sonicdicom-report-settings.js";
import { enqueueReportingBoardSonicDicomCacheRows, getFullReportingBoardSonicDicomResyncStatus, persistReportingBoardSonicDicomCacheResults, queueFullReportingBoardSonicDicomResync } from "../../services/reporting-board-sonicdicom-cache-service.js";
import { updateBookingStatusManual } from "../appointments-v2/booking/services/status-booking.service.js";
import { assignComparisonRequest, findComparisonRequestById, listComparisonReportingBoardRows, listComparisonReportingBoardStatsRows, unassignComparisonRequest } from "../../services/comparison-request-service.js";
import { requireRosterDoctor, requireRosterManager } from "./roster-service.js";
import { assignDoctorCase } from "./cases-service.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import {
  bulkAssignReportingCases,
  bulkUnassignReportingCases,
  cancelReportingBoardBulkAssignmentJob,
  claimReportingBoardBulkAssignmentJobForRunNow,
  claimDueReportingBoardBulkAssignmentJobs,
  createAssignedToMeNotifications,
  clearReportingBoardCaseManualFinal as clearReportingBoardCaseManualFinalRecord,
  createReportingBoardBulkAssignmentJob,
  createSavedView,
  disableReportingBoardPushSubscription,
  doctorCanReportAllModalities,
  listDoctorReportableModalityIds,
  dismissReportingBoardNotification,
  failReportingBoardBulkAssignmentJob,
  finishReportingBoardBulkAssignmentJob,
  findActiveSavedViewByToken,
  findReportingBoardBulkAssignmentJobById,
  findAssignableDoctorForReporting,
  findSavedViewById,
  findSavedViewByToken,
  getReportingBoardPushSubscriptionStatus,
  listReportingBoardBulkAssignmentJobs,
  listReportingBoardCasesByAppointmentIds,
  listReportingBoardCaseCandidates,
  listReportingBoardNotifications,
  listReportingBoardStatsRows,
  markReportingBoardCaseManualFinal as markReportingBoardCaseManualFinalRecord,
  listSavedViews,
  markAllReportingBoardNotificationsRead,
  markReportingBoardNotificationRead,
  readReportingBoardSettings,
  readReportingBoardPushConfig,
  reconcileReportingAssignmentToSonicFinalizer,
  revokeSavedView,
  rotateSavedViewToken,
  sendReportingBoardSavedViewTestPush,
  touchSavedViewLastAccessed,
  unassignReportingCase,
  updateSavedView,
  updateReportingBoardSettings,
  undoReportingBoardBulkAssignmentJobAssignments,
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
  DoctorReportingWorklistSummary,
} from "./reporting-board-types.js";
import type { ClaimedReportingBoardBulkAssignmentJob } from "./reporting-board-repository.js";
import type { ReportingBoardManualFinalOverride } from "./reporting-board-repository.js";
import {
  claimAppointmentToDoctor,
  claimComparisonToDoctor,
  findDoctorWorklistByDoctorId,
  findDoctorWorklistById,
  listDoctorWorklistBaseRows,
  listEffectiveDoctorModalityCodes,
  listEffectiveDoctorModalityCodesGrouped,
  updateDoctorWorklistLifecycle,
} from "./doctor-worklist-repository.js";
import { reconcileDoctorWorklists, syncDoctorWorklistLifecycle } from "./doctor-worklist-provisioning.js";
import { median, minutesBetween, minutesSince, percentile, withTimelineMetrics } from "./reporting-board-metrics.js";
import { getProtocolingHistoricalPacsCandidates, getProtocolingHistorySonicDicomRedirect, getProtocolingPatientHistory } from "./protocoling-repository.js";

export interface Actor {
  userId: UserId;
  appRole: Role;
}

const MAX_CASE_LIST_LIMIT = 300;
const MAX_SONICDICOM_BATCH_SIZE = 200;
const MAX_BULK_ASSIGN_COUNT = 100;
const MAX_SELECTED_REASSIGN_COUNT = 100;
const MOBILE_FULL_SCOPE_WARNING_MS = 2_000;
const DOCTOR_DIRECTORY_WARNING_MS = 2_000;
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
let assignmentBatchChecker = checkSonicDicomReportStatusesBatch;
type EffectiveReportingBoardFilters = Omit<ReportingBoardFilters, "limit" | "offset"> & { limit: number; offset: number };

export function __setReportingBoardAssignmentBatchCheckerForTest(checker: typeof checkSonicDicomReportStatusesBatch | null): void {
  assignmentBatchChecker = checker ?? checkSonicDicomReportStatusesBatch;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isPersonalDeskOverdue(row: ReportingBoardCaseRow, doctorId: number): boolean {
  return Boolean(
    row.caseType === "appointment" &&
    row.assignmentStatus === "assigned" &&
    row.assignedDoctorId === doctorId &&
    row.requiresReport &&
    row.reportStatus !== "final" &&
    row.dueAt &&
    row.dueAt < todayIso()
  );
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
    caseSource: input.caseSource ?? (
      settings.includedCaseSources.length === 1 ? settings.includedCaseSources[0] : "all"
    ),
    assignedDoctorId: input.assignedDoctorId ?? null,
    finalizedByDoctorId: input.finalizedByDoctorId ?? null,
    assignmentMatch: input.assignmentMatch ?? "all",
    modalityId: input.modalityId ?? null,
    modalityCodes: input.modalityCodes ?? null,
    sortBy: normalizeSortBy(input.sortBy ?? settings.defaultSortBy),
    sortDirection: normalizeSortDirection(input.sortDirection ?? settings.defaultSortDirection),
    pinUrgentToTop: input.pinUrgentToTop ?? settings.pinUrgentToTop,
  };
}

export function narrowSavedViewFilters(savedViewFilters: ReportingBoardFilters, input: ReportingBoardFilters = {}): ReportingBoardFilters {
  const narrowed: ReportingBoardFilters = { ...savedViewFilters };
  const keys: Array<keyof ReportingBoardFilters> = [
    "assignedDoctorId",
    "finalizedByDoctorId",
    "assignmentMatch",
    "caseCategory",
    "reportStatus",
    "priorityCode",
    "urgentOrStat",
    "modalityId",
    "modalityCode",
    "assignmentStatus",
    "sortBy",
    "sortDirection",
    "pinUrgentToTop",
    "overdue",
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

function derivedAssignmentMatch(row: ReportingBoardCaseRow): ReportingBoardCaseRow["assignmentMatch"] {
  if (row.finalizedByDoctorId && row.assignedDoctorId) return row.finalizedByDoctorId === row.assignedDoctorId ? "matched" : "mismatch";
  if (row.finalizedByDoctorId && !row.assignedDoctorId) return "finalized_unassigned";
  if (row.sonicDicomFinalizedByAccount && !row.finalizedByDoctorId) return "unmapped_finalizer";
  return "not_applicable";
}

function withProtectedTimelineMetrics(row: ReportingBoardCaseRow): ReportingBoardCaseRow {
  const resolved = withTimelineMetrics({ ...row, assignmentMatch: derivedAssignmentMatch(row) });
  if (resolved.assignmentOrigin === "sonic_auto" || resolved.assignmentOrigin === "sonic_reconciled") {
    return { ...resolved, completedToAssignedMinutes: null, assignedToFinalMinutes: null };
  }
  return resolved;
}

function matchesAssignmentFilters(row: ReportingBoardCaseRow, filters: ReportingBoardFilters): boolean {
  if (filters.finalizedByDoctorId && row.finalizedByDoctorId !== filters.finalizedByDoctorId) return false;
  if (filters.assignmentMatch && filters.assignmentMatch !== "all" && row.assignmentMatch !== filters.assignmentMatch) return false;
  return true;
}

async function applyReportStatuses(rows: ReportingBoardCaseRow[], reportStatus: ReportingBoardFilters["reportStatus"]) {
  const resolved: ReportingBoardCaseRow[] = [];
  for (const row of rows) {
    if (row.caseType === "comparison") {
      const canAssign = row.canAssign && row.appointmentStatus !== "finalized";
      resolved.push(withProtectedTimelineMetrics({
        ...row,
        canAssign,
        exclusionReason: canAssign ? null : row.exclusionReason ?? (row.appointmentStatus === "finalized" ? "report_final" : null),
      }));
      continue;
    }
    if (row.manualFinalOverrideId) {
      resolved.push(withProtectedTimelineMetrics({
        ...row,
        reportStatus: "final",
        reportStatusSource: "manual",
        reportFinalAt: row.manualFinalAt ?? null,
        canAssign: false,
        exclusionReason: "manual_final",
      }));
      continue;
    }
    const status = row.reportStatus ?? "unavailable";
    const canAssign = row.canAssign;
    resolved.push(withProtectedTimelineMetrics({
      ...row,
      reportStatus: status,
      canAssign,
      exclusionReason: canAssign ? null : row.exclusionReason ?? (status === "final" ? "report_final" : null),
    }));
  }

  if (!reportStatus || reportStatus === "all") return resolved;
  if (reportStatus === "required_not_final") {
    return resolved.filter((row) => row.requiresReport && (row.caseType === "comparison" ? row.appointmentStatus !== "finalized" : row.reportStatus !== "final"));
  }
  return resolved.filter((row) => row.reportStatus === reportStatus);
}

function needsResolvedPostFiltering(filters: ReportingBoardFilters): boolean {
  return Boolean(
    (filters.reportStatus && filters.reportStatus !== "all") ||
    filters.finalizedByDoctorId ||
    (filters.assignmentMatch && filters.assignmentMatch !== "all") ||
    filters.overdue ||
    filters.urgentOrStat
  );
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

/** Automatic assignment deliberately does not reuse the visible board sorter. */
export function compareAutomaticAssignmentCandidates(pinUrgentToTop: boolean | null | undefined) {
  // Do not construct a Date from booking_date/booking_time: they are local
  // scheduling fields. Their ISO tuple is already safe and deterministic.
  const effectiveAge = (row: ReportingBoardCaseRow): string => row.completedAt ?? `${row.bookingDate}T${row.bookingTime ?? "00:00:00"}`;
  return (left: ReportingBoardCaseRow, right: ReportingBoardCaseRow): number => {
    if (pinUrgentToTop !== false) {
      const priority = priorityPinRank(left) - priorityPinRank(right);
      if (priority !== 0) return priority;
    }
    return effectiveAge(left).localeCompare(effectiveAge(right)) || left.appointmentId - right.appointmentId;
  };
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

async function listUnifiedReportingBoardCases(
  filters: EffectiveReportingBoardFilters,
  options: { includeSonicDicomStudyNotes?: boolean; fullScope?: boolean } = {}
): Promise<ReportingBoardCaseRow[]> {
  if (options.fullScope) {
    const fetchAll = async (fetcher: typeof listReportingBoardCaseCandidates | typeof listComparisonReportingBoardRows) => {
      const rows: ReportingBoardCaseRow[] = [];
      for (let offset = 0; ; offset += MAX_CASE_LIST_LIMIT) {
        const page = await fetcher({ ...filters, limit: MAX_CASE_LIST_LIMIT, offset });
        rows.push(...page);
        if (page.length < MAX_CASE_LIST_LIMIT) return rows;
      }
    };
    const [appointmentRows, comparisonRows] = await Promise.all([
      sourceAllowsAppointments(filters.caseSource) ? fetchAll(listReportingBoardCaseCandidates) : Promise.resolve([]),
      sourceAllowsComparisons(filters.caseSource) ? fetchAll(listComparisonReportingBoardRows) : Promise.resolve([]),
    ]);
    const resolved = await applyReportStatuses([...appointmentRows, ...comparisonRows], filters.reportStatus);
    return resolved
      .filter((row) => matchesAssignmentFilters(row, filters))
      .filter((row) => !filters.overdue || (row.requiresReport && row.reportStatus !== "final" && row.bookingDate < todayIso()))
      .filter((row) => !filters.urgentOrStat || ["urgent", "stat"].includes(String(row.reportingPriorityCode || "").toLowerCase()))
      .sort(compareReportingBoardRows(filters));
  }
  // Each source is already sorted. The first offset + limit rows from each
  // source are sufficient to construct the exact merged page.
  const fetchLimit = filters.offset + filters.limit;
  const sourceFilters = { ...filters, limit: fetchLimit, offset: 0 };
  const [appointmentRows, comparisonRows] = await Promise.all([
    sourceAllowsAppointments(filters.caseSource) ? listReportingBoardCaseCandidates(sourceFilters) : Promise.resolve([]),
    sourceAllowsComparisons(filters.caseSource) ? listComparisonReportingBoardRows(sourceFilters) : Promise.resolve([]),
  ]);
  const resolved = (await applyReportStatuses([...appointmentRows, ...comparisonRows], filters.reportStatus))
    .filter((row) => matchesAssignmentFilters(row, filters))
    .filter((row) => !filters.overdue || (row.requiresReport && row.reportStatus !== "final" && row.bookingDate < todayIso()))
    .filter((row) => !filters.urgentOrStat || ["urgent", "stat"].includes(String(row.reportingPriorityCode || "").toLowerCase()));
  const visibleRows = resolved
    .sort(compareReportingBoardRows(filters))
    .slice(filters.offset, filters.offset + filters.limit);
  // Board reads are cache-only. Enqueue visible appointment rows in one local
  // PostgreSQL operation so out-of-lookback saved views refresh soon.
  void enqueueReportingBoardSonicDicomCacheRows(visibleRows.filter((row) => row.caseType === "appointment").map((row) => row.appointmentId)).catch(() => null);
  return visibleRows;
}

type ReportingBoardStatsInputRow = ReportingBoardStatsBaseRow & Partial<Pick<ReportingBoardCaseRow, "reportStatus">>;

function statsReportStatus(row: ReportingBoardStatsInputRow): ReportingBoardCaseRow["reportStatus"] {
  if (row.reportStatus) return row.reportStatus;
  if (!row.requiresReport) return "no_report";
  return "unavailable";
}

function statsRequiredNotFinal(row: ReportingBoardStatsInputRow): boolean {
  if (row.caseType === "comparison") return row.appointmentStatus !== "finalized";
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

    const postHocAssignment = row.assignmentOrigin === "sonic_auto" || row.assignmentOrigin === "sonic_reconciled";
    const completedToAssignedMinutes = postHocAssignment ? null : minutesBetween(row.completedAt, row.firstAssignedAt);
    if (completedToAssignedMinutes !== null) completedToAssignedValues.push(completedToAssignedMinutes);
    const assignedToFinalMinutes = postHocAssignment || !row.reportFinalAt ? null : minutesBetween(row.currentAssignedAt, row.reportFinalAt);
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
  await requireRosterManager(actor);
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
  let cases: ReportingBoardCaseRow[];
  let totalCount: number;
  if (needsResolvedPostFiltering(scopedFilters)) {
    const allCases = await listUnifiedReportingBoardCases(scopedFilters, { includeSonicDicomStudyNotes: true, fullScope: true });
    totalCount = allCases.length;
    cases = allCases.slice(filters.offset, filters.offset + filters.limit);
    void enqueueReportingBoardSonicDicomCacheRows(cases.filter((row) => row.caseType === "appointment").map((row) => row.appointmentId)).catch(() => null);
  } else {
    cases = await listUnifiedReportingBoardCases(scopedFilters, { includeSonicDicomStudyNotes: true });
    const [appointmentRows, comparisonRows] = await Promise.all([
      sourceAllowsAppointments(scopedFilters.caseSource) ? listReportingBoardStatsRows(scopedFilters) : Promise.resolve([]),
      sourceAllowsComparisons(scopedFilters.caseSource)
        ? listUnifiedReportingBoardCases({ ...scopedFilters, caseSource: "comparisons" }, { fullScope: true })
        : Promise.resolve([]),
    ]);
    totalCount = appointmentRows.length + comparisonRows.filter((row) => row.caseType === "comparison").length;
  }
  const hasMore = filters.offset + cases.length < totalCount;
  return {
    cases,
    filters,
    totalCount,
    pagination: {
      limit: filters.limit,
      offset: filters.offset,
      hasMore,
      nextOffset: hasMore ? filters.offset + filters.limit : null,
    },
  };
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
  if (needsResolvedPostFiltering(scopedFilters)) {
    const cases = await listUnifiedReportingBoardCases(scopedFilters, { fullScope: true });
    return { filters, ...aggregateReportingBoardStats(cases) };
  }
  const rows = [
    ...(sourceAllowsAppointments(filters.caseSource) ? await listReportingBoardStatsRows(scopedFilters) : []),
    ...(sourceAllowsComparisons(filters.caseSource) ? await listComparisonReportingBoardStatsRows(scopedFilters) : []),
  ].filter((row) => matchesStatsReportStatus(row, filters.reportStatus));
  return { filters, ...aggregateReportingBoardStats(rows) };
}

export async function refreshReportingBoardSonicDicomStatuses(actor: Actor, input: ReportingBoardFilters): Promise<{
  ok: true;
  checked: number;
  successful: number;
  failed: number;
  checkedAt: string;
}> {
  const { cases } = await getReportingBoardCases(actor, input);
  const contexts: ReportLookupContext[] = cases
    .filter((row) => row.caseType === "appointment" && row.appointmentStatus === "completed" && row.requiresReport && !row.manualFinalOverrideId)
    .map((row) => ({
      bookingId: row.appointmentId,
      accessionNumber: row.accessionNumber,
      studyInstanceUid: row.studyInstanceUid,
      requiresReport: row.requiresReport,
      status: row.appointmentStatus,
    }));
  const settings = await readSonicDicomReportSettings();
  let successful = 0;
  let failed = 0;

  for (let start = 0; start < contexts.length; start += MAX_SONICDICOM_BATCH_SIZE) {
    const batch = contexts.slice(start, start + MAX_SONICDICOM_BATCH_SIZE);
    let statuses = new Map<number, Awaited<ReturnType<typeof checkSonicDicomReportStatusesBatch>> extends Map<number, infer T> ? T : never>();
    let failure: unknown = null;
    try {
      statuses = await assignmentBatchChecker(batch, { audit: false });
    } catch (error) {
      failure = error;
    }
    await persistReportingBoardSonicDicomCacheResults(batch.map((context) => {
      const result = statuses.get(context.bookingId) ?? null;
      const unavailable = !result || result.state === "unavailable";
      return {
        context,
        result,
        error: failure ?? (unavailable ? "SonicDICOM unavailable during manual Reporting Board refresh" : null),
      };
    }), settings);
    for (const context of batch) {
      const state = statuses.get(context.bookingId)?.state;
      if (state === "final" || state === "draft" || state === "no_report" || state === "study_not_found") successful += 1;
      else failed += 1;
    }
  }

  return { ok: true, checked: contexts.length, successful, failed, checkedAt: new Date().toISOString() };
}

export async function refreshReportingBoardCaseSonicDicomStatus(actor: Actor, appointmentId: number): Promise<{
  ok: true;
  appointmentId: number;
  successful: boolean;
  previousStatus: string;
  reportStatus: string;
  changed: boolean;
  cachedStatusRetained: boolean;
  checkedAt: string;
}> {
  const { row } = await getAuthorizedReportingBoardAppointment(
    actor,
    appointmentId,
    "You are not allowed to refresh this Reporting Board case."
  );
  if (row.caseType !== "appointment" || row.appointmentStatus !== "completed" || !row.requiresReport) {
    throw new HttpError(409, "Only completed Reporting Board appointments that require reports can be refreshed.");
  }
  if (row.manualFinalOverrideId) throw new HttpError(409, "This Reporting Board case has an active manual final override.");

  const context: ReportLookupContext = {
    bookingId: row.appointmentId,
    accessionNumber: row.accessionNumber,
    studyInstanceUid: row.studyInstanceUid,
    requiresReport: row.requiresReport,
    status: row.appointmentStatus,
  };
  const previousStatus = row.reportStatus ?? "unavailable";
  let statuses = new Map<number, Awaited<ReturnType<typeof checkSonicDicomReportStatusesBatch>> extends Map<number, infer T> ? T : never>();
  let failure: unknown = null;
  try {
    statuses = await assignmentBatchChecker([context], { audit: false });
  } catch (error) {
    failure = error;
  }
  const result = statuses.get(appointmentId) ?? null;
  const successful = Boolean(result && ["final", "draft", "no_report", "study_not_found"].includes(result.state));
  const settings = await readSonicDicomReportSettings();
  const persisted = await persistReportingBoardSonicDicomCacheResults([{
    context,
    result,
    error: failure ?? (!successful ? "SonicDICOM unavailable during single Reporting Board refresh" : null),
  }], settings);
  const cache = persisted[0] ?? { changed: false, status: previousStatus };
  return {
    ok: true,
    appointmentId,
    successful,
    previousStatus,
    reportStatus: cache.status,
    changed: cache.changed,
    cachedStatusRetained: !successful,
    checkedAt: new Date().toISOString(),
  };
}

export async function queueFullReportingBoardSonicDicomResyncForManager(actor: Actor): Promise<{ ok: true; queued: number; requestedAt: string }> {
  const manager = await requireRosterManager(actor);
  const requestedAt = new Date().toISOString();
  const queued = await queueFullReportingBoardSonicDicomResync(requestedAt);
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: manager.profile!.id,
    eventType: "reporting_board_sonicdicom_full_resync_queued",
    targetType: "reporting_board",
    targetId: null,
    metadata: { queued, requestedAt },
    reason: null,
  });
  return { ok: true, queued, requestedAt };
}

export async function getFullReportingBoardSonicDicomResyncStatusForManager(actor: Actor, requestedAtInput: string | null | undefined): Promise<{ ok: true; remaining: number; failed: number }> {
  await requireRosterManager(actor);
  const requestedAt = String(requestedAtInput ?? "");
  const parsed = new Date(requestedAt);
  if (!requestedAt || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== requestedAt) {
    throw new HttpError(400, "requestedAt must be an ISO timestamp.");
  }
  return { ok: true, ...await getFullReportingBoardSonicDicomResyncStatus(requestedAt) };
}

type SonicDicomOpenScope = "study" | "patient";

function normalizeSonicDicomOpenScope(scope?: string | null): SonicDicomOpenScope {
  if (!scope || scope === "study") return "study";
  if (scope === "patient") return "patient";
  throw new HttpError(400, "SonicDICOM open scope must be study or patient.");
}

export async function getReportingBoardSonicDicomStudyRedirect(actor: Actor, appointmentId: number, scopeInput: string | null | undefined, requestHostname: string): Promise<{ redirectUrl: string }> {
  const { me, row } = await getAuthorizedReportingBoardAppointmentRead(
    actor,
    appointmentId,
    "You are not allowed to open this Reporting Board case in SonicDICOM."
  );
  const scope = normalizeSonicDicomOpenScope(scopeInput);

  const accessionNumber = String(row.accessionNumber || "").trim();
  const patientMrn = String(row.patientMrn || "").trim();
  const patientDicomId = String(row.patientDicomId || "").trim();
  if (scope === "study" && !accessionNumber) throw new HttpError(400, "Accession number is required to open the SonicDICOM study.");
  if (scope === "patient" && !patientDicomId) throw new HttpError(400, "DICOM Patient ID is required to open the patient list in SonicDICOM.");
  const sonicSettings = await readSonicDicomReportSettings();
  const redirectUrl = buildSonicDicomStaffViewerUrl({
    settings: sonicSettings,
    requestHostname,
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

export async function getAuthorizedReportingBoardAppointment(
  actor: Actor,
  appointmentId: number,
  forbiddenMessage = "You are not allowed to open this Reporting Board case."
) {
  const me = await requireRosterDoctor(actor);
  return getAuthorizedReportingBoardAppointmentWithScope(actor, appointmentId, forbiddenMessage, requirePersonalReportingBoardAppointment).then((row) => ({ me, row }));
}

export async function getAuthorizedReportingBoardAppointmentRead(
  actor: Actor,
  appointmentId: number,
  forbiddenMessage = "You are not allowed to open this Reporting Board case."
) {
  const me = await requireRosterDoctor(actor);
  return getAuthorizedReportingBoardAppointmentWithScope(actor, appointmentId, forbiddenMessage, requirePersonalReportingBoardAppointmentRead).then((row) => ({ me, row }));
}

async function getAuthorizedReportingBoardAppointmentWithScope(
  actor: Actor,
  appointmentId: number,
  forbiddenMessage: string,
  authorize: (actor: Actor, appointmentId: number) => Promise<ReportingBoardCaseRow>,
): Promise<ReportingBoardCaseRow> {
  let row: ReportingBoardCaseRow;
  try {
    row = await authorize(actor, appointmentId);
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 403) throw new HttpError(403, forbiddenMessage);
    throw error;
  }
  return row;
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

async function requireVisibleReportingBoardAppointment(appointmentId: number) {
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
  return row;
}

/** Active personal-desk boundary retained for active-scope writes such as recalls. */
export async function requirePersonalReportingBoardAppointment(actor: Actor, appointmentId: number): Promise<ReportingBoardCaseRow> {
  const doctor = await requireRosterDoctor(actor);
  const canManage = doctor.moduleCapabilities.includes("doctor_supervisor") || doctor.moduleCapabilities.includes("doctor_admin");
  if (canManage) return requireVisibleReportingBoardAppointment(appointmentId);
  const doctorId = doctor.profile?.id;
  if (!doctorId) throw new HttpError(403, "An active doctor profile is required.");
  const scope = await doctorWorklistScope(doctorId, { appointmentId, reportStatus: "all", limit: 1, offset: 0 }, true);
  const row = scope.cases.find((candidate) => candidate.caseType === "appointment" && candidate.appointmentId === appointmentId);
  if (!row) throw new HttpError(403, "This case is not in your personal reporting scope.");
  return row;
}

/** Active additional-imaging boundary: only the current doctor's assigned appointment. */
export async function requireOwnAssignedPersonalReportingBoardAppointment(actor: Actor, appointmentId: number): Promise<ReportingBoardCaseRow> {
  const doctor = await requireRosterDoctor(actor);
  const doctorId = doctor.profile?.id == null ? null : Number(doctor.profile.id);
  if (!doctorId) throw new HttpError(403, "An active doctor profile is required.");
  const scope = await doctorWorklistScope(doctorId, { appointmentId, reportStatus: "all", limit: 1, offset: 0 }, true);
  const row = scope.cases.find((candidate) => candidate.caseType === "appointment" && candidate.appointmentId === appointmentId);
  if (!row || row.assignmentStatus !== "assigned" || row.assignedDoctorId !== doctorId) {
    throw new HttpError(403, "Additional imaging is limited to appointments assigned to you.");
  }
  return row;
}

/** Read-only personal-desk boundary for current and own-finalized appointments. */
export async function requirePersonalReportingBoardAppointmentRead(actor: Actor, appointmentId: number): Promise<ReportingBoardCaseRow> {
  const doctor = await requireRosterDoctor(actor);
  const canManage = doctor.moduleCapabilities.includes("doctor_supervisor") || doctor.moduleCapabilities.includes("doctor_admin");
  if (canManage) return requireVisibleReportingBoardAppointment(appointmentId);
  const doctorId = doctor.profile?.id == null ? null : Number(doctor.profile.id);
  if (!doctorId) throw new HttpError(403, "An active doctor profile is required.");

  const activeScope = await doctorWorklistScope(doctorId, { appointmentId, reportStatus: "all", limit: 1, offset: 0 }, true);
  const activeRow = activeScope.cases.find((candidate) => candidate.caseType === "appointment" && candidate.appointmentId === appointmentId);
  if (activeRow) return activeRow;

  const finalizedScope = await doctorWorklistScope(doctorId, { appointmentId, reportStatus: "final", limit: 1, offset: 0 }, true);
  const finalizedRow = finalizedScope.cases.find((candidate) => candidate.caseType === "appointment" && candidate.appointmentId === appointmentId);
  if (finalizedRow) return finalizedRow;
  throw new HttpError(403, "This case is not in your personal reporting scope.");
}

/** Read-only personal-desk boundary for comparison history and prior-study viewers. */
export async function requirePersonalReportingBoardComparison(actor: Actor, comparisonRequestId: number): Promise<ReportingBoardCaseRow> {
  const doctor = await requireRosterDoctor(actor);
  const canManage = doctor.moduleCapabilities.includes("doctor_supervisor") || doctor.moduleCapabilities.includes("doctor_admin");
  if (canManage) {
    const rows = await listComparisonReportingBoardRows({ comparisonRequestId, reportStatus: "all", limit: 1, offset: 0 });
    if (rows[0]) return rows[0];
    if (!(await findComparisonRequestById(comparisonRequestId))) throw new HttpError(404, "Comparison request not found.");
    throw new HttpError(403, "This comparison is not visible on the Reporting Board.");
  }

  const doctorId = doctor.profile?.id == null ? null : Number(doctor.profile.id);
  if (!doctorId) throw new HttpError(403, "An active doctor profile is required.");
  const activeScope = await doctorWorklistScope(doctorId, {
    comparisonRequestId,
    caseSource: "comparisons",
    reportStatus: "required_not_final",
    limit: 1,
    offset: 0,
  }, true);
  const activeRow = activeScope.cases.find((candidate) => candidate.caseType === "comparison" && candidate.comparisonRequestId === comparisonRequestId);
  if (activeRow) return activeRow;

  const finalizedScope = await doctorWorklistScope(doctorId, {
    comparisonRequestId,
    caseSource: "comparisons",
    reportStatus: "final",
    limit: 1,
    offset: 0,
  }, true);
  const finalizedRow = finalizedScope.cases.find((candidate) => candidate.caseType === "comparison" && candidate.comparisonRequestId === comparisonRequestId);
  if (finalizedRow) return finalizedRow;
  if (!(await findComparisonRequestById(comparisonRequestId))) throw new HttpError(404, "Comparison request not found.");
  throw new HttpError(403, "This comparison is not in your personal reporting scope.");
}

async function resolvePersonalReportingBoardComparisonHistoryAnchor(actor: Actor, comparisonRequestId: number) {
  const row = await requirePersonalReportingBoardComparison(actor, comparisonRequestId);
  const request = await findComparisonRequestById(comparisonRequestId);
  if (!request) throw new HttpError(404, "Comparison request not found.");
  const booking = await pool.query<{ patient_id: number }>(
    `select patient_id from appointments_v2.bookings where id = $1 limit 1`,
    [request.linkedPreviousBookingId],
  );
  const linkedPatientId = booking.rows[0]?.patient_id == null ? null : Number(booking.rows[0].patient_id);
  if (linkedPatientId == null) throw new HttpError(409, "The linked comparison prior study is unavailable.");
  if (linkedPatientId !== request.patientId) throw new HttpError(409, "The linked comparison prior study belongs to a different patient.");
  return { row, request, appointmentId: request.linkedPreviousBookingId };
}

export async function getPersonalReportingBoardComparisonHistory(actor: Actor, comparisonRequestId: number) {
  const { appointmentId } = await resolvePersonalReportingBoardComparisonHistoryAnchor(actor, comparisonRequestId);
  return { ...await getProtocolingPatientHistory(appointmentId), canReconcilePatientIdentity: false };
}

export async function getPersonalReportingBoardComparisonHistoricalPacsCandidates(actor: Actor, comparisonRequestId: number) {
  const { appointmentId } = await resolvePersonalReportingBoardComparisonHistoryAnchor(actor, comparisonRequestId);
  return getProtocolingHistoricalPacsCandidates(appointmentId);
}

type PersonalReportingHistoryAnchor =
  | { caseType: "appointment"; appointmentId: number }
  | { caseType: "comparison"; comparisonRequestId: number };

async function getAuthorizedPersonalReportingHistorySources(actor: Actor, anchor: PersonalReportingHistoryAnchor) {
  const appointmentId = anchor.caseType === "appointment"
    ? (await requirePersonalReportingBoardAppointmentRead(actor, anchor.appointmentId), anchor.appointmentId)
    : (await resolvePersonalReportingBoardComparisonHistoryAnchor(actor, anchor.comparisonRequestId)).appointmentId;
  const currentHistory = await getProtocolingPatientHistory(appointmentId);
  const historicalCandidates = await getProtocolingHistoricalPacsCandidates(appointmentId).catch(() => null);
  return { currentHistory, historicalCandidates };
}

function historyContainsAccession(
  accession: string,
  currentHistory: Awaited<ReturnType<typeof getProtocolingPatientHistory>>,
  historicalCandidates: Awaited<ReturnType<typeof getProtocolingHistoricalPacsCandidates>> | null,
): boolean {
  if (currentHistory.items.some((item) => item.accessionNumber?.trim() === accession)) return true;
  return Boolean(historicalCandidates?.historicalCandidates.some((candidate) =>
    candidate.studies.some((study) => study.accessionNumber?.trim() === accession)
  ));
}

export async function getReportingBoardHistorySonicDicomRedirect(
  actor: Actor,
  anchor: PersonalReportingHistoryAnchor,
  accessionInput: string | null | undefined,
  requestHostname: string,
): Promise<{ redirectUrl: string }> {
  const accession = String(accessionInput ?? "").trim();
  if (!accession) throw new HttpError(400, "Accession number is required.");
  const sources = await getAuthorizedPersonalReportingHistorySources(actor, anchor);
  if (!historyContainsAccession(accession, sources.currentHistory, sources.historicalCandidates)) {
    throw new HttpError(404, "This accession is not in the authorized patient history.");
  }
  return { redirectUrl: await getProtocolingHistorySonicDicomRedirect(accession, requestHostname) };
}

export async function markReportingBoardCaseManualFinal(
  actor: Actor,
  appointmentId: number,
  reasonInput: string
): Promise<{ ok: true; appointmentId: number; status: "manual_final"; override: ReportingBoardManualFinalOverride }> {
  const reason = String(reasonInput || "").trim();
  if (!reason) throw new HttpError(400, "A reason is required to mark this case final in RISpro.");
  const row = await requireVisibleReportingBoardAppointment(appointmentId);
  let actorDoctorId: number | null = null;
  try {
    const manager = await requireRosterManager(actor);
    actorDoctorId = manager.profile?.id == null ? null : Number(manager.profile.id);
  } catch {
    const doctor = await requireRosterDoctor(actor);
    actorDoctorId = doctor.profile?.id == null ? null : Number(doctor.profile.id);
    if (!doctor.profile?.canFinalizeReports || actorDoctorId !== row.assignedDoctorId) {
      throw new HttpError(403, "Only the assigned doctor with report-finalization permission may manually finalize this case.");
    }
  }
  if (row.appointmentStatus !== "completed" || !row.requiresReport) {
    throw new HttpError(409, "Only completed Reporting Board cases can be manually marked final; the case must require a report.");
  }
  if (row.reportStatus === "final" || row.manualFinalOverrideId) {
    throw new HttpError(409, "This Reporting Board case is already final.");
  }
  const override = await markReportingBoardCaseManualFinalRecord({
    appointmentId,
    reason,
    actor: { userId: actor.userId, doctorId: actorDoctorId },
  });
  return { ok: true, appointmentId, status: "manual_final", override };
}

export async function clearReportingBoardCaseManualFinal(
  actor: Actor,
  appointmentId: number,
  reasonInput: string
): Promise<{ ok: true; appointmentId: number; status: "manual_final_cleared"; override: ReportingBoardManualFinalOverride }> {
  const manager = await requireRosterManager(actor);
  const reason = String(reasonInput || "").trim();
  if (!reason) throw new HttpError(400, "A reason is required to clear the manual final override.");
  await requireVisibleReportingBoardAppointment(appointmentId);
  const override = await clearReportingBoardCaseManualFinalRecord({
    appointmentId,
    reason,
    actor: { userId: actor.userId, doctorId: manager.profile?.id ?? null },
  });
  await enqueueReportingBoardSonicDicomCacheRows([appointmentId], pool, { force: true });
  return { ok: true, appointmentId, status: "manual_final_cleared", override };
}

function mobileCase(row: ReportingBoardCaseRow, includePacsNote: boolean, personalDeskDoctorId: number | null = null) {
  const overdue = personalDeskDoctorId === null
    ? row.requiresReport && row.reportStatus !== "final" && row.bookingDate < todayIso()
    : isPersonalDeskOverdue(row, personalDeskDoctorId);
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
    assignedDoctorId: row.assignedDoctorId,
    assignmentOrigin: row.assignmentOrigin,
    finalizedByDoctorId: row.finalizedByDoctorId,
    finalizedByDoctorName: row.finalizedByDoctorName,
    sonicDicomFinalizedByAccount: row.sonicDicomFinalizedByAccount,
    sonicDicomLatestDocumentId: row.sonicDicomLatestDocumentId,
    sonicDicomDocumentRemoved: row.sonicDicomDocumentRemoved ?? false,
    assignmentMatch: row.assignmentMatch,
    priority: row.reportingPriorityName || row.reportingPriorityCode,
    priorityCode: row.reportingPriorityCode,
    reportStatus: row.reportStatus,
    requiresReport: row.requiresReport,
    activeComplementaryRecallStatus: row.caseType === "appointment" ? row.activeComplementaryRecallStatus ?? null : null,
    latestComplementaryRecallStatus: row.caseType === "appointment" ? row.latestComplementaryRecallStatus ?? null : null,
    reportStatusSource: row.reportStatusSource ?? null,
    manualFinalOverrideId: row.manualFinalOverrideId ?? null,
    manualFinalByDoctorId: row.manualFinalByDoctorId ?? null,
    appointmentStatus: row.appointmentStatus,
    assignmentStatus: row.assignmentStatus,
    canAssign: row.canAssign,
    exclusionReason: row.exclusionReason,
    completedAt: row.completedAt,
    firstAssignedAt: row.firstAssignedAt,
    currentAssignedAt: row.currentAssignedAt,
    reportFinalAt: row.reportFinalAt,
    completedToAssignedMinutes: row.completedToAssignedMinutes,
    currentAssignmentAgeMinutes: row.currentAssignmentAgeMinutes,
    completedUnassignedAgeMinutes: row.completedUnassignedAgeMinutes,
    completedAgeMinutes: minutesSince(row.completedAt, Date.now()),
    overdue,
    linkedPreviousStudyDate: row.linkedPreviousStudyDate,
    linkedPreviousAccessionNumber: row.linkedPreviousAccessionNumber,
    comparisonReason: row.comparisonReason ?? null,
    comparisonPreparationNote: row.comparisonPreparationNote ?? null,
    sonicDicomStudyNote: includePacsNote ? row.sonicDicomStudyNote : null,
    sonicDicomStudyNoteCheckedAt: includePacsNote ? row.sonicDicomStudyNoteCheckedAt : null,
    sonicDicomStudyNoteSource: includePacsNote ? row.sonicDicomStudyNoteSource ?? null : null,
  };
}

function mobileCaseActions(row: ReportingBoardCaseRow, canManage: boolean, canClaimToSelf = false) {
  const isFinal = row.reportStatus === "final";
  const actionDisabledReason = !canManage && !canClaimToSelf
    ? "Sign in with the doctor profile linked to this worklist to claim eligible cases."
    : !canManage && canClaimToSelf && isFinal && !row.manualFinalOverrideId
      ? "Report is final; self-claim is closed."
    : !row.canAssign
      ? row.exclusionReason ?? "This case is not eligible for assignment changes."
      : null;
  return {
    canAssignToMe: canClaimToSelf && row.canAssign && !isFinal && row.assignmentStatus === "unassigned",
    canReassign: canManage && row.canAssign,
    canUnassign: canManage && row.canAssign && !isFinal && row.assignmentStatus === "assigned",
    actionDisabledReason,
  };
}

function mobileCounters(
  cases: ReportingBoardCaseRow[],
  assignedDoctorId?: number | null,
  finalizedHistory = false,
  personalDeskDoctorId: number | null = null
) {
  if (finalizedHistory) {
    return {
      total: cases.length,
      assignedToMe: assignedDoctorId ? cases.length : null,
      unassigned: 0,
      urgent: 0,
      requiredNotFinal: 0,
      overdue: 0,
    };
  }
  const today = todayIso();
  const mine = assignedDoctorId ? cases.filter((row) => row.assignedDoctorId === assignedDoctorId) : [];
  const isUrgent = (row: ReportingBoardCaseRow) => ["urgent", "stat"].includes(String(row.reportingPriorityCode || "").toLowerCase());
  const isActive = (row: ReportingBoardCaseRow) => row.requiresReport && row.reportStatus !== "final";
  return {
    total: cases.length,
    assignedToMe: assignedDoctorId ? mine.filter(isActive).length : null,
    unassigned: cases.filter((row) => row.assignmentStatus === "unassigned").length,
    urgent: cases.filter((row) => isActive(row) && isUrgent(row)).length,
    requiredNotFinal: cases.filter((row) => row.requiresReport && row.reportStatus !== "final").length,
    overdue: personalDeskDoctorId === null
      ? mine.filter((row) => isActive(row) && row.bookingDate < today).length
      : cases.filter((row) => isPersonalDeskOverdue(row, personalDeskDoctorId)).length,
  };
}

function withoutMobileQuickTabFilters(input: ReportingBoardFilters): ReportingBoardFilters {
  switch (input.mobileQuickTab) {
    case "my_cases":
    case "available":
      return { ...input, assignedDoctorId: null, assignmentStatus: null, mobileQuickTab: null };
    case "urgent":
      return { ...input, priorityCode: null, urgentOrStat: null, mobileQuickTab: null };
    case "overdue":
      return {
        ...input,
        overdue: null,
        // The mobile Overdue tab alone supplies this value; explicit drawer report-state filters do not carry this marker.
        reportStatus: input.reportStatus === "required_not_final" ? null : input.reportStatus,
        mobileQuickTab: null,
      };
    default:
      return input;
  }
}

function applyMobileQuickTab(
  cases: ReportingBoardCaseRow[],
  input: ReportingBoardFilters,
  personalDeskDoctorId: number | null = null
): ReportingBoardCaseRow[] {
  if (input.reportStatus === "final") {
    // Finalized history is an owner-attributed personal view, not an active
    // assignment queue. Only My Cases has a meaningful finalized equivalent.
    return input.mobileQuickTab && input.mobileQuickTab !== "my_cases" ? [] : cases;
  }
  switch (input.mobileQuickTab) {
    case "my_cases":
      return cases.filter((row) => row.assignmentStatus === "assigned" && row.assignedDoctorId === input.assignedDoctorId);
    case "available":
      return cases.filter((row) => row.assignmentStatus === "unassigned");
    case "urgent":
      return cases.filter((row) => ["urgent", "stat"].includes(String(row.reportingPriorityCode || "").toLowerCase()));
    case "overdue":
      return personalDeskDoctorId === null
        ? cases.filter((row) => row.assignedDoctorId === input.assignedDoctorId && row.requiresReport && row.reportStatus !== "final" && row.bookingDate < todayIso())
        : cases.filter((row) => isPersonalDeskOverdue(row, personalDeskDoctorId));
    default:
      return cases;
  }
}

function mobileResultFilters(
  counterFilters: EffectiveReportingBoardFilters,
  input: ReportingBoardFilters,
  limit: number,
  offset: number
): EffectiveReportingBoardFilters {
  const resultFilters: EffectiveReportingBoardFilters = { ...counterFilters, limit, offset, mobileQuickTab: input.mobileQuickTab ?? null };
  if (input.mobileQuickTab === "my_cases" || input.mobileQuickTab === "available") {
    resultFilters.assignedDoctorId = input.assignedDoctorId ?? null;
    resultFilters.assignmentStatus = input.assignmentStatus ?? null;
  }
  if (input.mobileQuickTab === "urgent") {
    resultFilters.priorityCode = input.priorityCode ?? null;
    resultFilters.urgentOrStat = input.urgentOrStat ?? null;
  }
  if (input.mobileQuickTab === "overdue") {
    resultFilters.overdue = input.overdue ?? null;
    resultFilters.reportStatus = input.reportStatus ?? counterFilters.reportStatus;
  }
  return resultFilters;
}

function filterSummary(filters: ReportingBoardFilters): string[] {
  return [
    filters.reportStatus ? String(filters.reportStatus).replaceAll("_", " ") : null,
    filters.modalityCode ?? (filters.modalityCodes?.length ? filters.modalityCodes.join("/") : null),
    filters.dateFrom && filters.dateTo ? `${filters.dateFrom} to ${filters.dateTo}` : filters.dateFrom ?? null,
    filters.priorityCode ? `priority ${filters.priorityCode}` : null,
    filters.assignmentStatus && filters.assignmentStatus !== "all" ? filters.assignmentStatus : null,
    filters.finalizedByDoctorId ? `finalized doctor ${filters.finalizedByDoctorId}` : null,
    filters.assignmentMatch && filters.assignmentMatch !== "all" ? filters.assignmentMatch.replaceAll("_", " ") : null,
  ].filter(Boolean) as string[];
}

async function doctorWorklistScope(
  doctorId: number,
  input: ReportingBoardFilters = {},
  fullScope = false
): Promise<{
  cases: ReportingBoardCaseRow[];
  filters: EffectiveReportingBoardFilters;
  effectiveModalityCodes: string[];
  scopeMessage: string | null;
}> {
  const settings = await readReportingBoardSettings();
  const permanentCutoff = settings.cutoffMode === "fixed_date" && settings.defaultCutoffDate
    ? settings.defaultCutoffDate
    : addDays(todayIso(), -settings.daysBack);
  const narrowedDateFrom = input.dateFrom && input.dateFrom > permanentCutoff ? input.dateFrom : permanentCutoff;
  const effectiveModalityCodes = await listEffectiveDoctorModalityCodes(doctorId, settings.enabledModalityCodes);
  const allowedSources = settings.includedCaseSources;
  const requestedSource = input.caseSource && input.caseSource !== "all" ? input.caseSource : null;
  const caseSource = requestedSource && allowedSources.includes(requestedSource)
    ? requestedSource
    : allowedSources.length === 1 ? allowedSources[0] : "all";
  // The personal desk always starts with actionable work. Finalized is a
  // deliberate, actor-aware view below rather than a departmental archive.
  const compatibleReportStatus = input.reportStatus && input.reportStatus !== "all"
    ? input.reportStatus
    : "required_not_final";
  const base = await effectiveFilters({
    ...input,
    dateFrom: narrowedDateFrom,
    cutoffDate: permanentCutoff,
    // Personal Reporting Desk is a report worklist. Keep this invariant
    // independent of the configurable administrative board default.
    requiresReport: true,
    reportStatus: compatibleReportStatus,
    caseSource,
    modalityId: null,
    modalityCode: null,
    modalityCodes: effectiveModalityCodes,
    limit: MAX_CASE_LIST_LIMIT,
    offset: 0,
  });
  if (input.modalityCode) {
    const requested = input.modalityCode.toUpperCase();
    base.modalityCodes = effectiveModalityCodes.includes(requested) ? [requested] : [];
  }
  if (effectiveModalityCodes.length === 0 || base.modalityCodes?.length === 0) {
    return {
      cases: [],
      filters: { ...base, limit: normalizeLimit(input.limit), offset: normalizeOffset(input.offset) },
      effectiveModalityCodes,
      scopeMessage: "No Reporting Board modalities are both globally enabled and permitted for this doctor.",
    };
  }

  if (input.reportStatus === "final") {
    const finalizedCases = await listUnifiedReportingBoardCases({
      ...base,
      assignedDoctorId: null,
      assignmentStatus: "all",
      finalizedByDoctorId: null,
      assignmentMatch: "all",
      overdue: null,
      urgentOrStat: null,
    }, { fullScope: true });
    const attributedCases = finalizedCases.filter((row) =>
      row.finalizedByDoctorId === doctorId || row.manualFinalByDoctorId === doctorId
    );
    const offset = normalizeOffset(input.offset);
    const limit = normalizeLimit(input.limit);
    return {
      cases: fullScope ? attributedCases : attributedCases.slice(offset, offset + limit),
      filters: { ...base, limit, offset },
      effectiveModalityCodes,
      scopeMessage: null,
    };
  }

  const requestedAssignmentStatus = input.assignedDoctorId === doctorId ? "assigned" : input.assignmentStatus;
  const includeAssigned = requestedAssignmentStatus !== "unassigned";
  const includeUnassigned = requestedAssignmentStatus !== "assigned";
  const [assigned, unassigned] = await Promise.all([
    includeAssigned
      ? listUnifiedReportingBoardCases({ ...base, assignedDoctorId: doctorId, assignmentStatus: "assigned" }, { fullScope: true })
      : Promise.resolve([]),
    includeUnassigned
      ? listUnifiedReportingBoardCases({ ...base, assignedDoctorId: null, assignmentStatus: "unassigned" }, { fullScope: true })
      : Promise.resolve([]),
  ]);
  const allCases = [...new Map([...assigned, ...unassigned].map((row) => [row.caseKey, row])).values()]
    .sort(compareReportingBoardRows(base));
  const offset = normalizeOffset(input.offset);
  const limit = normalizeLimit(input.limit);
  return {
    cases: fullScope ? allCases : allCases.slice(offset, offset + limit),
    filters: { ...base, limit, offset },
    effectiveModalityCodes,
    scopeMessage: null,
  };
}

async function getMobileIdentity(actor?: Actor | null) {
  if (!actor) return null;
  try {
    return await requireRosterDoctor(actor);
  } catch {
    return null;
  }
}

export async function getPublicReportingBoardMobileView(actor: Actor | null, token: string, input: ReportingBoardFilters = {}, mobileIdentity: MobileCaseIdentity | null = null) {
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Saved view not found.");
  const identity = await getMobileIdentity(actor);
  const finalizedDoctorWorklist = view.linkKind === "doctor_worklist" && Boolean(view.targetDoctorId) && input.reportStatus === "final";
  if (finalizedDoctorWorklist) {
    if (!actor) throw new HttpError(401, "Authentication required to view finalized reporting history.");
    const canManage = Boolean(identity?.moduleCapabilities.includes("doctor_supervisor") || identity?.moduleCapabilities.includes("doctor_admin"));
    if (!identity?.profile?.id || (!canManage && Number(identity.profile.id) !== view.targetDoctorId)) {
      throw new HttpError(403, "You are not allowed to view this doctor's finalized reporting history.");
    }
  }
  const globalSettings = await readReportingBoardSettings();
  const requestedLimit = normalizeLimit(input.limit ?? 100);
  const requestedOffset = normalizeOffset(input.offset);
  let filters: EffectiveReportingBoardFilters;
  let allCases: ReportingBoardCaseRow[];
  let effectiveModalityCodes: string[] | null = null;
  let scopeMessage: string | null = null;
  const counterInput = withoutMobileQuickTabFilters(input);
  const fullScopeStartedAt = Date.now();
  if (view.linkKind === "doctor_worklist" && view.targetDoctorId) {
    const scope = await doctorWorklistScope(view.targetDoctorId, { ...counterInput, limit: MAX_CASE_LIST_LIMIT, offset: 0 }, true);
    filters = mobileResultFilters(scope.filters, input, requestedLimit, requestedOffset);
    allCases = scope.cases;
    effectiveModalityCodes = scope.effectiveModalityCodes;
    scopeMessage = scope.scopeMessage;
  } else {
    const narrowed = narrowSavedViewFilters(view.filters, { ...counterInput, limit: input.limit ?? 100 });
    const counterFilters = await effectiveFilters(mobileIdentity ? withMobileCaseIdentity(narrowed, mobileIdentity) : narrowed);
    filters = mobileResultFilters(counterFilters, input, requestedLimit, requestedOffset);
    const scopedFilters = counterFilters.modalityCode || counterFilters.modalityId ? counterFilters : { ...counterFilters, modalityCodes: counterFilters.modalityCodes ?? globalSettings.enabledModalityCodes };
    allCases = await listUnifiedReportingBoardCases(scopedFilters, { fullScope: true });
  }
  const fullScopeListingDurationMs = Date.now() - fullScopeStartedAt;
  const timing = {
    type: "reporting_board_mobile_full_scope_timing",
    fullScopeRowsProcessed: allCases.length,
    fullScopeListingDurationMs,
  };
  console.info(JSON.stringify(timing));
  if (fullScopeListingDurationMs > MOBILE_FULL_SCOPE_WARNING_MS) {
    console.warn(JSON.stringify({ ...timing, type: "reporting_board_mobile_full_scope_slow", warningThresholdMs: MOBILE_FULL_SCOPE_WARNING_MS }));
  }
  const personalDeskDoctorId = view.linkKind === "doctor_worklist" ? view.targetDoctorId : null;
  const personalDoctorId = personalDeskDoctorId ?? identity?.profile?.id ?? null;
  const finalizedByPersonalDoctor = finalizedDoctorWorklist && personalDoctorId
    ? allCases.filter((row) => row.finalizedByDoctorId === personalDoctorId || row.manualFinalByDoctorId === personalDoctorId)
    : allCases;
  const resultCases = applyMobileQuickTab(
    finalizedByPersonalDoctor,
    { ...input, assignedDoctorId: input.assignedDoctorId ?? personalDoctorId },
    personalDeskDoctorId
  );
  const cases = resultCases.slice(requestedOffset, requestedOffset + requestedLimit);
  const canManage = Boolean(identity?.moduleCapabilities.includes("doctor_supervisor") || identity?.moduleCapabilities.includes("doctor_admin"));
  const canClaimToSelf = Boolean(
    actor && identity?.profile?.id && view.linkKind === "doctor_worklist" &&
    Number(identity.profile.id) === view.targetDoctorId
  );
  const finalizeOwnReports = Boolean(
    actor && identity?.profile?.id && view.linkKind === "doctor_worklist" &&
    Number(identity.profile.id) === view.targetDoctorId && identity.profile.canFinalizeReports === true
  );
  const accessLevel = !actor ? "public" : !identity ? "public" : identity.moduleCapabilities.includes("doctor_admin") ? "admin" : identity.moduleCapabilities.includes("doctor_supervisor") ? "supervisor" : "doctor";

  await insertDoctorAuditEvent(pool, {
    actorUserId: actor?.userId ?? null,
    actorDoctorId: identity?.profile?.id ?? null,
    eventType: "reporting_board_mobile_saved_view_opened",
    targetType: "reporting_board_saved_view",
    targetId: view.id,
    metadata: { tokenScoped: true },
    reason: null,
  }).catch(() => undefined);
  await touchSavedViewLastAccessed(view.id).catch(() => undefined);

  return {
    savedView: { id: view.id, name: view.name, token: view.token, linkKind: view.linkKind, targetDoctorId: view.targetDoctorId },
    lockedFilters: view.linkKind === "doctor_worklist" ? { systemManaged: true, targetDoctorId: view.targetDoctorId } : view.filters,
    effectiveModalityCodes,
    scopeMessage,
    currentDoctorId: identity?.profile?.id == null ? null : Number(identity.profile.id),
    filters,
    filterSummary: filterSummary(filters),
    counters: mobileCounters(
      finalizedByPersonalDoctor,
      view.linkKind === "doctor_worklist" ? view.targetDoctorId : identity?.profile?.id ?? null,
      finalizedDoctorWorklist,
      personalDeskDoctorId
    ),
    totalCount: resultCases.length,
    pagination: {
      limit: filters.limit,
      offset: filters.offset,
      hasMore: filters.offset + cases.length < resultCases.length,
      nextOffset: filters.offset + cases.length < resultCases.length ? filters.offset + cases.length : null,
    },
    cases: cases.map((row) => ({ ...mobileCase(row, Boolean(identity), personalDeskDoctorId), ...mobileCaseActions(row, canManage, canClaimToSelf) })),
    allowedActions: {
      authenticated: Boolean(actor),
      accessLevel,
      readOnly: !canManage && !canClaimToSelf,
      readOnlyReason: canManage || canClaimToSelf ? null : actor ? "This worklist does not belong to your doctor profile." : "Sign in to claim eligible cases.",
      assignToMe: canClaimToSelf,
      reassign: canManage,
      unassign: canManage,
      batchReassign: false,
      finalizeOwnReports,
      copyAccession: true,
      copyMrn: true,
    },
    refreshIntervalSeconds: globalSettings.refreshIntervalSeconds,
    refreshedAt: new Date().toISOString(),
  };
}

type MobileCaseIdentity =
  | { caseType: "appointment"; appointmentId: number }
  | { caseType: "comparison"; comparisonRequestId: number };

function withMobileCaseIdentity(filters: ReportingBoardFilters, identity: MobileCaseIdentity): ReportingBoardFilters {
  const caseSource = !filters.caseSource || filters.caseSource === "all"
    ? identity.caseType === "appointment" ? "appointments" : "comparisons"
    : filters.caseSource;
  return identity.caseType === "appointment"
    ? { ...filters, caseSource, appointmentId: identity.appointmentId, comparisonRequestId: null }
    : { ...filters, caseSource, appointmentId: null, comparisonRequestId: identity.comparisonRequestId };
}

export async function getPublicReportingBoardMobileCase(actor: Actor | null, token: string, identity: MobileCaseIdentity, input: ReportingBoardFilters = {}) {
  const view = await getPublicReportingBoardMobileView(actor, token, {
    ...withMobileCaseIdentity(input, identity),
    limit: 1,
    offset: 0,
  }, identity);
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
  const filters = await effectiveFilters(withMobileCaseIdentity(narrowSavedViewFilters(view.filters, {
    limit: 1,
    offset: 0,
  }), identity));
  const sourceAllowsIdentity = identity.caseType === "appointment"
    ? sourceAllowsAppointments(filters.caseSource)
    : sourceAllowsComparisons(filters.caseSource);
  if (!sourceAllowsIdentity) throw new HttpError(404, "Case not found.");
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
  const me = await requireRosterDoctor(actor);
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Worklist not found.");
  if (view.linkKind !== "doctor_worklist") {
    await requireRosterManager(actor);
    await ensureCaseInSavedViewScope(token, identity);
    return identity.caseType === "appointment"
      ? assignReportingBoardCaseToDoctor(actor, { appointmentId: identity.appointmentId, doctorId: me.profile!.id, reason: reason ?? "mobile saved-view assign to me" })
      : assignComparisonRequest(actor, identity.comparisonRequestId, { doctorId: me.profile!.id, reason: reason ?? "mobile saved-view assign to me" });
  }
  if (Number(me.profile!.id) !== view.targetDoctorId) {
    throw new HttpError(403, "Cases can be claimed only through your own Personal Reporting Desk.");
  }
  const scope = await doctorWorklistScope(view.targetDoctorId!, {
    appointmentId: identity.caseType === "appointment" ? identity.appointmentId : null,
    comparisonRequestId: identity.caseType === "comparison" ? identity.comparisonRequestId : null,
    caseSource: identity.caseType === "appointment" ? "appointments" : "comparisons",
    assignmentStatus: "unassigned",
    limit: 1,
    offset: 0,
  });
  const eligible = scope.cases.find((row) => identity.caseType === "appointment"
    ? row.caseType === "appointment" && row.appointmentId === identity.appointmentId
    : row.caseType === "comparison" && row.comparisonRequestId === identity.comparisonRequestId);
  if (!eligible || !eligible.canAssign || eligible.assignmentStatus !== "unassigned" || eligible.reportStatus === "final") {
    throw new HttpError(409, "Case is no longer eligible to claim.");
  }
  const claimSettings = await readReportingBoardSettings();
  const actorModalityCodes = await listEffectiveDoctorModalityCodes(me.profile!.id, claimSettings.enabledModalityCodes);
  if (!actorModalityCodes.includes(eligible.modalityCode.toUpperCase())) {
    throw new HttpError(403, "This modality is not enabled for the claiming doctor.");
  }
  if (identity.caseType === "appointment") {
    const rows = await listReportingBoardCasesByAppointmentIds([identity.appointmentId]);
    const verification = await directlyRevalidateReportingAssignmentCandidates(rows);
    if (verification.finalIds.has(identity.appointmentId)) throw new HttpError(409, "Case is already final in SonicDICOM and cannot be assigned.");
    if (verification.unavailableIds.has(identity.appointmentId)) throw new HttpError(503, "Report finality could not be verified. Please try again.");
  }
  const result = identity.caseType === "appointment"
    ? await claimAppointmentToDoctor({
      appointmentId: identity.appointmentId,
      doctorId: me.profile!.id,
      actorUserId: actor.userId,
      allowedModalityCodes: actorModalityCodes,
      reason,
    })
    : await claimComparisonToDoctor({
      comparisonRequestId: identity.comparisonRequestId,
      doctorId: me.profile!.id,
      actorUserId: actor.userId,
      allowedModalityCodes: actorModalityCodes,
      reason,
    });
  if (!result) throw new HttpError(409, "Another doctor claimed this case first.");
  await createAssignedToMeNotifications({
    doctorId: me.profile!.id,
    appointmentIds: identity.caseType === "appointment" ? [identity.appointmentId] : [],
    comparisonRequestIds: identity.caseType === "comparison" ? [identity.comparisonRequestId] : [],
    appointmentNotes: identity.caseType === "appointment" ? { [identity.appointmentId]: reason } : undefined,
  });
  return result;
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
  const me = await requireRosterManager(actor);
  const views = await listSavedViews(actor.userId, me.profile!.id);
  const settings = await readReportingBoardSettings();
  return Promise.all(views.map(async (view) => {
    const startedAt = Date.now();
    const filters = await effectiveFilters(narrowSavedViewFilters(view.filters, { limit: 1, offset: 0 }));
    const scopedFilters = filters.modalityCode || filters.modalityId ? filters : { ...filters, modalityCodes: filters.modalityCodes ?? settings.enabledModalityCodes };
    const matchingCaseCount = (await listUnifiedReportingBoardCases(scopedFilters, { fullScope: true })).length;
    console.info(JSON.stringify({
      type: "reporting_board_saved_view_matching_count_timing",
      savedViewId: view.id,
      matchingCaseCount,
      matchingCountDurationMs: Date.now() - startedAt,
    }));
    return { ...view, matchingCaseCount };
  }));
}

export async function createReportingBoardSavedView(
  actor: Actor,
  input: { name: string; filters: ReportingBoardFilters; notificationSettings: ReportingBoardNotificationSettings }
) {
  const me = await requireRosterManager(actor);
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
    expiresAt?: string | null;
  }
) {
  const me = await requireRosterManager(actor);
  const expiresAt = normalizeSavedViewExpiresAt(input.expiresAt);
  const view = await updateSavedView({
    id: input.id,
    ownerUserId: actor.userId,
    ownerDoctorId: me.profile!.id,
    name: input.name?.trim(),
    filters: input.filters,
    notificationSettings: input.notificationSettings,
    active: input.active,
    expiresAt,
  });
  if (!view) throw new HttpError(404, "Saved view not found.");
  return view;
}

function normalizeSavedViewExpiresAt(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new HttpError(400, "expiresAt must be a valid ISO timestamp.");
  if (timestamp <= Date.now()) throw new HttpError(400, "expiresAt must be in the future.");
  return new Date(timestamp).toISOString();
}

export async function rotateReportingBoardSavedViewToken(actor: Actor, id: number) {
  const me = await requireRosterManager(actor);
  const current = await findSavedViewById(id, actor.userId);
  if (!current) throw new HttpError(404, "Saved view not found.");
  if (!current.active || current.revokedAt) throw new HttpError(409, "Inactive or revoked saved views cannot be rotated.");
  const view = await rotateSavedViewToken({ id, ownerUserId: actor.userId, ownerDoctorId: me.profile!.id });
  if (!view) throw new HttpError(404, "Saved view not found.");
  return view;
}

export async function revokeReportingBoardSavedView(actor: Actor, id: number) {
  const me = await requireRosterManager(actor);
  const view = await revokeSavedView({ id, ownerUserId: actor.userId, ownerDoctorId: me.profile!.id });
  if (!view) throw new HttpError(404, "Saved view not found.");
  return view;
}

export async function loadReportingBoardSavedViewByToken(actor: Actor, token: string) {
  const me = await requireRosterDoctor(actor);
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Saved view not found.");
  const canManage = me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
  if (!canManage && (view.linkKind !== "doctor_worklist" || view.targetDoctorId !== Number(me.profile!.id))) {
    throw new HttpError(403, "This worklist does not belong to your doctor profile.");
  }
  return view;
}

async function summarizeDoctorWorklist(
  view: NonNullable<Awaited<ReturnType<typeof findDoctorWorklistByDoctorId>>>
): Promise<DoctorReportingWorklistSummary> {
  const scope = await doctorWorklistScope(view.targetDoctorId!, { limit: MAX_CASE_LIST_LIMIT, offset: 0 }, true);
  return {
    ...view,
    effectiveModalityCodes: scope.effectiveModalityCodes,
    assignedPendingCount: scope.cases.filter((row) => row.assignedDoctorId === view.targetDoctorId).length,
    eligibleUnassignedCount: scope.cases.filter((row) => row.assignmentStatus === "unassigned").length,
    scopeMessage: scope.scopeMessage,
  };
}

export async function listDoctorReportingWorklists(actor: Actor): Promise<DoctorReportingWorklistSummary[]> {
  await requireRosterManager(actor);
  const startedAt = Date.now();
  await reconcileDoctorWorklists();
  const views = await listDoctorWorklistBaseRows();
  const settings = await readReportingBoardSettings();
  const modalities = await listEffectiveDoctorModalityCodesGrouped(settings.enabledModalityCodes);
  const cutoff = settings.cutoffMode === "fixed_date" && settings.defaultCutoffDate
    ? settings.defaultCutoffDate
    : addDays(todayIso(), -settings.daysBack);
  const base = await effectiveFilters({
    dateFrom: cutoff,
    cutoffDate: cutoff,
    requiresReport: settings.defaultRequiresReport,
    reportStatus: settings.defaultReportStatusFilter,
    caseSource: settings.includedCaseSources.length === 1 ? settings.includedCaseSources[0] : "all",
    modalityCodes: settings.enabledModalityCodes,
    limit: MAX_CASE_LIST_LIMIT,
    offset: 0,
  });
  const assignedStartedAt = Date.now();
  const assigned = await listUnifiedReportingBoardCases({ ...base, assignmentStatus: "assigned" }, { fullScope: true });
  const assignedDurationMs = Date.now() - assignedStartedAt;
  const unassignedStartedAt = Date.now();
  const unassigned = await listUnifiedReportingBoardCases({ ...base, assignedDoctorId: null, assignmentStatus: "unassigned" }, { fullScope: true });
  const unassignedDurationMs = Date.now() - unassignedStartedAt;
  const assignedCounts = new Map<number, number>();
  for (const row of assigned) {
    if (row.assignedDoctorId) assignedCounts.set(row.assignedDoctorId, (assignedCounts.get(row.assignedDoctorId) ?? 0) + 1);
  }
  const unassignedByModality = new Map<string, number>();
  for (const row of unassigned) {
    const code = row.modalityCode.toUpperCase();
    unassignedByModality.set(code, (unassignedByModality.get(code) ?? 0) + 1);
  }
  const summaries = views.map((view) => {
    const effectiveModalityCodes = modalities.get(view.targetDoctorId!) ?? [];
    return {
      ...view,
      effectiveModalityCodes,
      assignedPendingCount: assignedCounts.get(view.targetDoctorId!) ?? 0,
      eligibleUnassignedCount: effectiveModalityCodes.reduce((sum, code) => sum + (unassignedByModality.get(code) ?? 0), 0),
      scopeMessage: effectiveModalityCodes.length === 0
        ? "No Reporting Board modalities are both globally enabled and permitted for this doctor."
        : null,
    };
  });
  const totalDurationMs = Date.now() - startedAt;
  const timing = {
    type: "doctor_worklist_directory_timing",
    doctorCount: views.length,
    worklistRowCount: summaries.length,
    assignedCountDurationMs: assignedDurationMs,
    sharedUnassignedCountDurationMs: unassignedDurationMs,
    totalDirectoryDurationMs: totalDurationMs,
  };
  console.info(JSON.stringify(timing));
  if (totalDurationMs > DOCTOR_DIRECTORY_WARNING_MS) {
    console.warn(JSON.stringify({ ...timing, type: "doctor_worklist_directory_slow", warningThresholdMs: DOCTOR_DIRECTORY_WARNING_MS }));
  }
  return summaries;
}

export async function getMyDoctorReportingWorklist(actor: Actor): Promise<DoctorReportingWorklistSummary> {
  const me = await requireRosterDoctor(actor);
  await syncDoctorWorklistLifecycle(me.profile!.id);
  const view = await findDoctorWorklistByDoctorId(me.profile!.id);
  if (!view) throw new HttpError(404, "Doctor worklist not found.");
  return summarizeDoctorWorklist(view);
}

export async function updateDoctorReportingWorklist(
  actor: Actor,
  id: number,
  input: { active?: boolean; expiresAt?: string | null; rotate?: boolean }
): Promise<DoctorReportingWorklistSummary> {
  await requireRosterManager(actor);
  const current = await findDoctorWorklistById(id);
  if (!current) throw new HttpError(404, "Doctor worklist not found.");
  const expiresAt = normalizeSavedViewExpiresAt(input.expiresAt);
  await updateDoctorWorklistLifecycle({
    id,
    actorUserId: actor.userId,
    active: input.active,
    expiresAt,
    rotate: input.rotate,
  });
  await syncDoctorWorklistLifecycle(current.targetDoctorId!);
  const updated = await findDoctorWorklistById(id);
  if (!updated) throw new HttpError(404, "Doctor worklist not found.");
  return summarizeDoctorWorklist(updated);
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

interface AssignmentRevalidation { eligibleIds: Set<number>; finalIds: Set<number>; unavailableIds: Set<number>; }

async function directlyRevalidateReportingAssignmentCandidates(rows: ReportingBoardCaseRow[]): Promise<AssignmentRevalidation> {
  const appointments = rows.filter((row) => row.caseType === "appointment");
  if (!appointments.length) return { eligibleIds: new Set(), finalIds: new Set(), unavailableIds: new Set() };
  const contexts = appointments.map((row) => ({ bookingId: row.appointmentId, accessionNumber: row.accessionNumber, studyInstanceUid: row.studyInstanceUid, requiresReport: row.requiresReport, status: row.appointmentStatus }));
  let statuses = new Map<number, Awaited<ReturnType<typeof checkSonicDicomReportStatusesBatch>> extends Map<number, infer T> ? T : never>();
  let failure: unknown = null;
  try { statuses = await assignmentBatchChecker(contexts, { audit: false }); } catch (error) { failure = error; }
  const settings = await readSonicDicomReportSettings();
  await persistReportingBoardSonicDicomCacheResults(contexts.map((context) => ({ context, result: statuses.get(context.bookingId) ?? null, error: failure ?? "SonicDICOM unavailable during assignment revalidation" })), settings);
  const eligibleIds = new Set<number>(); const finalIds = new Set<number>(); const unavailableIds = new Set<number>();
  for (const context of contexts) {
    const state = statuses.get(context.bookingId)?.state;
    if (state === "final") finalIds.add(context.bookingId);
    else if (state === "draft" || state === "no_report" || state === "study_not_found") eligibleIds.add(context.bookingId);
    else unavailableIds.add(context.bookingId);
  }
  return { eligibleIds, finalIds, unavailableIds };
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
  // Constrain the SQL candidate query before its page limit. An empty set is
  // intentional: PostgreSQL's ANY('{}') returns no candidates.
  const reportableModalityIds = await listDoctorReportableModalityIds(input.doctorId);
  const filters = await effectiveFilters({
    ...rawFilters,
    caseSource: "appointments",
    assignmentStatus: "unassigned",
    requiresReport: true,
    reportableModalityIds,
    reportStatus: rawFilters.reportStatus === "all" ? "required_not_final" : rawFilters.reportStatus,
    limit: MAX_CASE_LIST_LIMIT,
    offset: 0,
  });
  // Fetch the complete filtered appointment scope before applying the dedicated
  // automatic ordering; no visible table sort or pagination may choose cases.
  const cases = await listUnifiedReportingBoardCases(filters, { fullScope: true });
  const eligible = cases
    .filter((row) => row.caseType === "appointment" && row.canAssign && row.assignmentStatus === "unassigned" && row.requiresReport && row.appointmentStatus === "completed" && row.reportStatus !== "final")
    .sort(compareAutomaticAssignmentCandidates(filters.pinUrgentToTop));
  // Revalidate a bounded window before the assignment transaction. This lets
  // stale cache finals be skipped while later eligible cases fill the request.
  const candidateWindow = eligible.slice(0, Math.min(eligible.length, Math.max(input.count * 3, input.count)));
  const verification = await directlyRevalidateReportingAssignmentCandidates(candidateWindow);
  const selected = candidateWindow.filter((row) => verification.eligibleIds.has(row.appointmentId)).slice(0, input.count);

  const result = await bulkAssignReportingCases({
    doctorId: input.doctorId,
    candidateAppointmentIds: selected.map((row) => row.appointmentId),
    reason: input.reason?.trim() || null,
    unassignedOnly: true,
    restrictToDoctorReportPermissions: true,
    actor: { userId: actor.userId, doctorId: me.profile!.id },
  });
  await createAssignedToMeNotifications({
    doctorId: input.doctorId,
    appointmentIds: result.assignedAppointmentIds,
    appointmentNotes: Object.fromEntries(result.assignedAppointmentIds.map((id) => [id, input.reason ?? null])),
  });
  const selectedIds = new Set(selected.map((row) => row.appointmentId));
  const preSkipped = cases
    .filter((row) => !selectedIds.has(row.appointmentId))
    .slice(0, Math.max(0, input.count - result.assignedCount))
    .map((row) => ({ appointmentId: row.appointmentId, reason: verification.finalIds.has(row.appointmentId) ? "report_final" : verification.unavailableIds.has(row.appointmentId) ? "report_status_unavailable" : row.exclusionReason ?? "not_selected" }));
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
    await finishReportingBoardBulkAssignmentJob({ id: job.id, result });
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
}): Promise<{ checked: number; completed: number; partial: number; failed: number }> {
  const claimed = await claimDueReportingBoardBulkAssignmentJobs({ limit: options.limit ?? 5, lockedBy: options.lockedBy });
  let completed = 0;
  let partial = 0;
  let failed = 0;
  for (const job of claimed) {
    const result = await executeClaimedReportingBoardBulkAssignmentJob(job);
    if (result.status === "completed") completed += 1;
    if (result.status === "partial") partial += 1;
    if (result.status === "failed") failed += 1;
  }
  return { checked: claimed.length, completed, partial, failed };
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

export async function resumeScheduledReportingBoardBulkAssignmentJob(
  actor: Actor,
  id: number,
  lockedBy: string
): Promise<{ job: ReportingBoardBulkAssignmentJob; jobs: ReportingBoardBulkAssignmentJob[] }> {
  const me = await requireRosterManager(actor);
  const parent = await findReportingBoardBulkAssignmentJobById(id);
  if (!parent) throw new HttpError(404, "Scheduled bulk assignment job not found.");
  if (parent.status !== "partial") throw new HttpError(409, "Only partial jobs can be resumed.");
  const requestedCount = parent.result?.requestedCount ?? parent.caseCount;
  const assignedCount = parent.result?.assignedCount ?? 0;
  const remainingCount = Math.max(0, requestedCount - assignedCount);
  if (remainingCount <= 0) throw new HttpError(409, "Partial job has no remaining cases to resume.");

  const child = await createReportingBoardBulkAssignmentJob(
    {
      scheduledFor: new Date().toISOString(),
      doctorId: parent.targetDoctorId,
      count: remainingCount,
      filters: frozenScheduledFilters(parent.filters),
      savedViewId: parent.savedViewId,
      savedViewName: parent.savedViewName,
      resumedFromJobId: parent.id,
      reason: parent.reason ? `Resume of scheduled job #${parent.id}: ${parent.reason}` : `Resume of scheduled job #${parent.id}`,
    },
    { userId: actor.userId, doctorId: me.profile!.id }
  );
  const job = await runScheduledReportingBoardBulkAssignmentJobNow(actor, child.id, lockedBy);
  return { job, jobs: await listReportingBoardBulkAssignmentJobs() };
}

export async function undoScheduledReportingBoardBulkAssignmentJob(
  actor: Actor,
  id: number
): Promise<{ job: ReportingBoardBulkAssignmentJob; result: BulkUnassignSelectedCasesResult }> {
  const me = await requireRosterManager(actor);
  const job = await findReportingBoardBulkAssignmentJobById(id);
  if (!job) throw new HttpError(404, "Scheduled bulk assignment job not found.");
  if (job.status !== "completed" && job.status !== "partial") {
    throw new HttpError(409, "Only completed or partial jobs can be undone.");
  }
  const assignedAppointmentIds = job.result?.assignedAppointmentIds ?? [];
  if (assignedAppointmentIds.length === 0 || (job.result?.assignedCount ?? 0) <= 0) {
    throw new HttpError(409, "This job did not assign any cases.");
  }

  const rows = await applyReportStatuses(await listReportingBoardCasesByAppointmentIds(assignedAppointmentIds), "all");
  const finalAppointmentIds = rows.filter((row) => row.reportStatus === "final").map((row) => row.appointmentId);
  const result = await undoReportingBoardBulkAssignmentJobAssignments({
    jobId: job.id,
    targetDoctorId: job.targetDoctorId,
    assignedAppointmentIds,
    finalAppointmentIds,
    completedAt: job.runCompletedAt,
    actor: { userId: actor.userId, doctorId: me.profile!.id },
  });
  const refreshed = await findReportingBoardBulkAssignmentJobById(id);
  if (!refreshed) throw new HttpError(404, "Scheduled bulk assignment job not found.");
  return { job: refreshed, result };
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
  const verification = await directlyRevalidateReportingAssignmentCandidates(rows);
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
    if (verification.unavailableIds.has(appointmentId)) {
      skipped.push({ appointmentId, reason: "report_status_unavailable" });
      continue;
    }
    if (verification.finalIds.has(appointmentId)) {
      skipped.push({ appointmentId, reason: "report_final" });
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
    appointmentNotes: Object.fromEntries(result.assignedAppointmentIds.map((id) => [id, input.reason ?? null])),
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
  const rows = await listReportingBoardCasesByAppointmentIds([input.appointmentId]);
  const verification = await directlyRevalidateReportingAssignmentCandidates(rows);
  if (verification.unavailableIds.has(input.appointmentId)) throw new HttpError(503, "Report finality could not be verified. Please try again.");
  const result = await assignDoctorCase(actor, {
    appointmentId: input.appointmentId,
    doctorId: input.doctorId,
    reason: input.reason ?? null,
  });
  await createAssignedToMeNotifications({
    doctorId: input.doctorId,
    appointmentIds: [input.appointmentId],
    appointmentNotes: { [input.appointmentId]: input.reason ?? null },
  });
  return result;
}

export async function reconcileReportingBoardAssignmentToSonicFinalizer(
  actor: Actor,
  input: { appointmentId: number; expectedAssignedDoctorId: number; expectedSonicDicomLatestDocumentId: string }
) {
  const manager = await requireRosterManager(actor);
  return reconcileReportingAssignmentToSonicFinalizer({
    ...input,
    actor: { userId: actor.userId, doctorId: manager.profile!.id },
  });
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
  const me = await requireRosterManager(actor);
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

async function authorizeWorklistNotificationActor(actor: Actor, token: string) {
  const me = await requireRosterDoctor(actor);
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Saved view not found.");
  const canManage = me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
  if (!canManage && (view.linkKind !== "doctor_worklist" || view.targetDoctorId !== Number(me.profile!.id))) {
    throw new HttpError(403, "This worklist does not belong to your doctor profile.");
  }
  return { me, view };
}

export async function subscribePublicReportingBoardMobilePush(
  actor: Actor,
  token: string,
  input: { subscription: BrowserPushSubscriptionInput; userAgent?: string | null }
) {
  const { me, view } = await authorizeWorklistNotificationActor(actor, token);
  return upsertReportingBoardPushSubscription({
    savedViewId: view.id,
    userId: actor.userId,
    doctorId: me.profile!.id,
    subscription: input.subscription,
    userAgent: input.userAgent,
  });
}

export async function unsubscribePublicReportingBoardMobilePush(actor: Actor, token: string, subscription: BrowserPushSubscriptionInput) {
  const { view } = await authorizeWorklistNotificationActor(actor, token);
  return disableReportingBoardPushSubscription({ savedViewId: view.id, subscription });
}

export async function getPublicReportingBoardMobilePushStatus(actor: Actor, token: string, subscription: BrowserPushSubscriptionInput) {
  const { view } = await authorizeWorklistNotificationActor(actor, token);
  return getReportingBoardPushSubscriptionStatus({ savedViewId: view.id, subscription });
}

export async function sendPublicReportingBoardMobileTestPush(actor: Actor, token: string, subscription: BrowserPushSubscriptionInput) {
  const { view } = await authorizeWorklistNotificationActor(actor, token);
  return sendReportingBoardSavedViewTestPush({
    savedViewId: view.id,
    actionUrl: `/reporting/worklist/${view.token}`,
    subscription,
  });
}

export async function sendReportingBoardSavedViewTestNotification(actor: Actor, savedViewId: number) {
  await requireRosterManager(actor);
  const view = await findSavedViewById(savedViewId, actor.userId);
  if (!view) throw new HttpError(404, "Saved view not found.");
  const { cases } = await getReportingBoardCases(actor, { ...view.filters, limit: 1, offset: 0 });
  return sendReportingBoardSavedViewTestPush({
    savedViewId: view.id,
    actionUrl: `/mobile/reporting-view/${view.token}`,
    caseRow: cases[0] ?? null,
  });
}
