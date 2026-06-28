import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { pool } from "../../db/pool.js";
import { buildSonicDicomStaffViewerUrl, checkSonicDicomReportStatus, type SonicDicomReportState } from "../../services/sonicdicom-report-service.js";
import { readSonicDicomReportSettings } from "../../services/sonicdicom-report-settings.js";
import { updateBookingStatusManual } from "../appointments-v2/booking/services/status-booking.service.js";
import { requireRosterDoctor, requireRosterManager } from "./roster-service.js";
import { assignDoctorCase } from "./cases-service.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import {
  bulkAssignReportingCases,
  bulkUnassignReportingCases,
  createAssignedToMeNotifications,
  createSavedView,
  doctorCanReportAllModalities,
  dismissReportingBoardNotification,
  findActiveSavedViewByToken,
  findAssignableDoctorForReporting,
  findSavedViewById,
  findSavedViewByToken,
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
  BulkReassignSelectedCasesInput,
  BulkUnassignSelectedCasesInput,
  BulkUnassignSelectedCasesResult,
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

interface Actor {
  userId: UserId;
  appRole: Role;
}

const MAX_CASE_LIST_LIMIT = 300;
const MAX_BULK_ASSIGN_COUNT = 100;
const MAX_SELECTED_REASSIGN_COUNT = 100;
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

async function effectiveFilters(input: ReportingBoardFilters = {}): Promise<Required<Pick<ReportingBoardFilters, "limit" | "offset">> & ReportingBoardFilters> {
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
  const rows = await listReportingBoardCaseCandidates(scopedFilters);
  const cases = await applyReportStatuses(rows, filters.reportStatus);
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
    const rows = await listReportingBoardCaseCandidates(scopedFilters);
    const cases = await applyReportStatuses(rows, filters.reportStatus);
    return { filters, ...aggregateReportingBoardStats(cases) };
  }
  const rows = (await listReportingBoardStatsRows(scopedFilters)).filter((row) => matchesStatsReportStatus(row, filters.reportStatus));
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
  const patientIdentifier = String(row.patientId || patientMrn || "").trim();
  if (scope === "study" && !accessionNumber) throw new HttpError(400, "Accession number is required to open the SonicDICOM study.");
  if (scope === "patient" && !patientIdentifier) throw new HttpError(400, "Patient ID/MRN is required to open the patient list in SonicDICOM.");
  const sonicSettings = await readSonicDicomReportSettings();
  const redirectUrl = buildSonicDicomStaffViewerUrl({
    settings: sonicSettings,
    target: scope === "study" ? "studyViewer" : "patientList",
    value: scope === "study" ? accessionNumber : patientIdentifier,
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
    appointmentId: row.appointmentId,
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
  const rows = await listReportingBoardCaseCandidates(scopedFilters);
  const cases = await applyReportStatuses(rows, filters.reportStatus);
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

export async function getPublicReportingBoardMobileCase(actor: Actor | null, token: string, appointmentId: number, input: ReportingBoardFilters = {}) {
  const view = await getPublicReportingBoardMobileView(actor, token, { ...input, appointmentId, limit: 1, offset: 0 });
  const found = view.cases.find((row) => row.appointmentId === appointmentId);
  if (!found) throw new HttpError(404, "Case not found.");
  return { savedView: view.savedView, case: found, allowedActions: view.allowedActions, refreshedAt: view.refreshedAt };
}

async function ensureCaseInSavedViewScope(token: string, appointmentId: number): Promise<void> {
  const view = await findActiveSavedViewByToken(token);
  if (!view) throw new HttpError(404, "Saved view not found.");
  const filters = await effectiveFilters(narrowSavedViewFilters(view.filters, { appointmentId, limit: 1, offset: 0 }));
  const rows = await listReportingBoardCaseCandidates(filters);
  if (!rows.some((row) => row.appointmentId === appointmentId)) throw new HttpError(404, "Case not found.");
}

export async function assignReportingBoardMobileCaseToMe(actor: Actor, token: string, appointmentId: number, reason?: string | null) {
  const me = await requireRosterManager(actor);
  await ensureCaseInSavedViewScope(token, appointmentId);
  return assignReportingBoardCaseToDoctor(actor, { appointmentId, doctorId: me.profile!.id, reason: reason ?? "mobile saved-view assign to me" });
}

export async function reassignReportingBoardMobileCase(actor: Actor, token: string, appointmentId: number, doctorId: number, reason?: string | null) {
  await requireRosterManager(actor);
  await ensureCaseInSavedViewScope(token, appointmentId);
  return assignReportingBoardCaseToDoctor(actor, { appointmentId, doctorId, reason: reason ?? "mobile saved-view reassignment" });
}

export async function unassignReportingBoardMobileCase(actor: Actor, token: string, appointmentId: number, reason?: string | null) {
  await requireRosterManager(actor);
  await ensureCaseInSavedViewScope(token, appointmentId);
  return unassignReportingBoardCase(actor, { appointmentId, reason });
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

function uniquePositiveAppointmentIds(appointmentIds: number[]): number[] {
  if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
    throw new HttpError(400, "appointmentIds must be a non-empty array.");
  }
  const uniqueIds: number[] = [];
  const seen = new Set<number>();
  for (const appointmentId of appointmentIds) {
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      throw new HttpError(400, "appointmentIds must contain only positive integers.");
    }
    if (!seen.has(appointmentId)) {
      seen.add(appointmentId);
      uniqueIds.push(appointmentId);
    }
  }
  if (uniqueIds.length > MAX_SELECTED_REASSIGN_COUNT) {
    throw new HttpError(400, `appointmentIds must contain ${MAX_SELECTED_REASSIGN_COUNT} or fewer cases.`);
  }
  return uniqueIds;
}

export async function bulkReassignSelectedReportingBoardCases(actor: Actor, input: BulkReassignSelectedCasesInput): Promise<BulkAssignNextCasesResult> {
  const me = await requireRosterManager(actor);
  const appointmentIds = uniquePositiveAppointmentIds(input.appointmentIds);
  const doctor = await findAssignableDoctorForReporting(input.doctorId);
  if (!doctor) throw new HttpError(404, "Active doctor profile not found.");
  if (!doctor.canFinalizeReports) throw new HttpError(400, "Doctor must be allowed to finalize reports.");

  const rows = await applyReportStatuses(await listReportingBoardCasesByAppointmentIds(appointmentIds), "all");
  const rowsById = new Map(rows.map((row) => [row.appointmentId, row]));
  const selectedModalities = [...new Set(rows.map((row) => row.modalityId))];
  const hasModalityPermission = await doctorCanReportAllModalities(input.doctorId, selectedModalities);
  if (!hasModalityPermission) throw new HttpError(400, "Doctor does not have report permission for the selected modalities.");

  const skipped: Array<{ appointmentId: number; reason: string }> = [];
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
    requestedCount: appointmentIds.length,
    assignedCount: result.assignedCount,
    skippedCount: skipped.length + result.skippedCount,
    assignedAppointmentIds: result.assignedAppointmentIds,
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
  const appointmentIds = uniquePositiveAppointmentIds(input.appointmentIds);
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

  return bulkUnassignReportingCases({
    candidateAppointmentIds: eligibleIds,
    reason,
    actor: { userId: actor.userId, doctorId: me.profile!.id },
    skipped,
  });
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
