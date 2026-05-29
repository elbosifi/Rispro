import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { checkSonicDicomReportStatus, type SonicDicomReportState } from "../../services/sonicdicom-report-service.js";
import { requireRosterDoctor, requireRosterManager } from "./roster-service.js";
import { assignDoctorCase } from "./cases-service.js";
import {
  bulkAssignReportingCases,
  createAssignedToMeNotifications,
  createSavedView,
  doctorCanReportAllModalities,
  dismissReportingBoardNotification,
  findActiveSavedViewByToken,
  findAssignableDoctorForReporting,
  findSavedViewById,
  findSavedViewByToken,
  listReportingBoardCaseCandidates,
  listReportingBoardNotifications,
  listSavedViews,
  markAllReportingBoardNotificationsRead,
  markReportingBoardNotificationRead,
  readReportingBoardSettings,
  updateSavedView,
  updateReportingBoardSettings,
} from "./reporting-board-repository.js";
import type {
  BulkAssignNextCasesInput,
  ReportingBoardCaseRow,
  ReportingBoardFilters,
  ReportingBoardNotificationSettings,
} from "./reporting-board-types.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

const MAX_CASE_LIST_LIMIT = 100;
const MAX_BULK_ASSIGN_COUNT = 100;
let reportStatusChecker = checkSonicDicomReportStatus;

export function __setReportingBoardReportStatusCheckerForTest(checker: typeof checkSonicDicomReportStatus | null) {
  reportStatusChecker = checker ?? checkSonicDicomReportStatus;
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
  const value = limit ?? 50;
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, "limit must be a positive integer.");
  if (value > MAX_CASE_LIST_LIMIT) throw new HttpError(400, `limit must be ${MAX_CASE_LIST_LIMIT} or less.`);
  return value;
}

function normalizeOffset(offset?: number | null): number {
  const value = offset ?? 0;
  if (!Number.isInteger(value) || value < 0) throw new HttpError(400, "offset must be zero or a positive integer.");
  return value;
}

async function effectiveFilters(input: ReportingBoardFilters = {}): Promise<Required<Pick<ReportingBoardFilters, "limit" | "offset">> & ReportingBoardFilters> {
  const settings = await readReportingBoardSettings();
  const cutoffDate =
    input.cutoffDate ??
    input.dateFrom ??
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
    assignedDoctorId: input.assignedDoctorId ?? null,
    modalityId: input.modalityId ?? null,
    modalityCodes: input.modalityCodes ?? null,
  };
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
    } catch {
      status = "unavailable";
    }
    const canAssign = row.canAssign && status !== "final";
    resolved.push({
      ...row,
      reportStatus: status,
      reportStatusCheckedAt: checkedAt,
      canAssign,
      exclusionReason: canAssign ? null : row.exclusionReason ?? (status === "final" ? "report_final" : null),
    });
  }

  if (!reportStatus || reportStatus === "all") return resolved;
  if (reportStatus === "required_not_final") {
    return resolved.filter((row) => row.requiresReport && row.reportStatus !== "final");
  }
  return resolved.filter((row) => row.reportStatus === reportStatus);
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
  if (!input.reason.trim()) throw new HttpError(400, "reason is required.");
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
    reason: input.reason,
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
