import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import webPush, { type PushSubscription } from "web-push";
import { pool } from "../../db/pool.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { HttpError } from "../../utils/http-error.js";
import { configurePatientWebPushVapid, getPatientWebPushSharedConfig } from "../../services/patient-web-push-service.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import type {
  BrowserPushSubscriptionInput,
  BulkAssignNextCasesResult,
  CreateReportingBoardBulkAssignmentJobInput,
  BulkUnassignSelectedCasesResult,
  ReportingBoardBulkAssignmentJob,
  ReportingBoardCaseRow,
  ReportingBoardFilters,
  ReportingBoardStatsBaseRow,
  ReportingBoardNotificationSettings,
  ReportingBoardNotificationEvent,
  ReportingBoardPushConfig,
  ReportingBoardSavedView,
  ReportingBoardSettings,
} from "./reporting-board-types.js";

const SETTINGS_CATEGORY = "doctor_portal_reporting_board";
const SETTINGS_KEY = "config";
let reportingBoardPushVapidConfigurer = configurePatientWebPushVapid;
let reportingBoardPushSender: (subscription: PushSubscription, payload: string) => Promise<unknown> = (subscription, payload) => webPush.sendNotification(subscription, payload);
const REPORTING_BOARD_SORT_KEYS = new Set([
  "priority_study_date", "study_date", "accession", "patient_name", "mrn", "exam_type",
  "modality", "assigned_doctor", "longest_unassigned", "longest_assigned_not_final", "oldest_completed",
]);

export function __setReportingBoardPushDeliveryForTest(options: {
  configure?: typeof configurePatientWebPushVapid;
  send?: (subscription: PushSubscription, payload: string) => Promise<unknown>;
} | null): void {
  reportingBoardPushVapidConfigurer = options?.configure ?? configurePatientWebPushVapid;
  reportingBoardPushSender = options?.send ?? ((subscription, payload) => webPush.sendNotification(subscription, payload));
}

export const DEFAULT_REPORTING_BOARD_SETTINGS: ReportingBoardSettings = {
  cutoffMode: "days_back",
  defaultCutoffDate: null,
  daysBack: 30,
  enabledModalityCodes: ["CT", "MR"],
  defaultRequiresReport: true,
  defaultReportStatusFilter: "required_not_final",
  defaultSortBy: "priority_study_date",
  defaultSortDirection: "asc",
  pinUrgentToTop: true,
  includedCaseSources: ["appointments", "comparisons"],
  refreshIntervalSeconds: 50,
};

interface AssignmentActor {
  userId: UserId;
  doctorId: number | null;
}

export interface ClaimedReportingBoardBulkAssignmentJob extends ReportingBoardBulkAssignmentJob {
  creatorUserActive: boolean;
  creatorAppRole: Role;
}

interface CaseQueryOptions {
  forUpdate?: boolean;
  limitOverride?: number;
  offsetOverride?: number;
  includeReportStatusFilter?: boolean;
  db?: Pick<PoolClient, "query"> | typeof pool;
}

interface CandidateAssignment {
  id: number | null;
  appointmentId: number;
}

export interface ReportingBoardManualFinalOverride {
  id: number;
  appointmentId: number;
  reason: string;
  createdByUserId: number | null;
  createdByDoctorId: number | null;
  createdAt: string;
  clearedByUserId: number | null;
  clearedByDoctorId: number | null;
  clearedAt: string | null;
  clearReason: string | null;
}

interface NotificationTargetRow {
  savedViewId: number;
  token: string;
  recipientUserId: number;
  recipientDoctorId: number;
}

interface CreatedNotificationRow {
  id: number;
  savedViewId: number;
  title: string;
  body: string;
  actionUrl: string | null;
}

interface PushDeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

function manualFinalOverride(row: ReportingBoardManualFinalOverride): ReportingBoardManualFinalOverride {
  return {
    id: Number(row.id),
    appointmentId: Number(row.appointmentId),
    reason: row.reason,
    createdByUserId: nullableNumber(row.createdByUserId),
    createdByDoctorId: nullableNumber(row.createdByDoctorId),
    createdAt: nullableIsoString(row.createdAt)!,
    clearedByUserId: nullableNumber(row.clearedByUserId),
    clearedByDoctorId: nullableNumber(row.clearedByDoctorId),
    clearedAt: nullableIsoString(row.clearedAt),
    clearReason: row.clearReason ?? null,
  };
}

function normalizePushSubscription(input: BrowserPushSubscriptionInput): { endpoint: string; p256dh: string; auth: string } {
  const endpoint = String(input.endpoint || "").trim();
  const p256dh = String(input.keys?.p256dh || "").trim();
  const auth = String(input.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) {
    throw new HttpError(400, "Push subscription endpoint and keys are required.");
  }
  return { endpoint, p256dh, auth };
}

function hashPushSubscription(input: { endpoint: string; p256dh: string }): string {
  return createHash("sha256").update(`${input.endpoint}|${input.p256dh}`).digest("hex");
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  return values.length > 0 ? values : fallback;
}

export function normalizeReportingBoardSettings(input: unknown): ReportingBoardSettings {
  const record = cleanRecord(input);
  const cutoffMode = record.cutoffMode === "fixed_date" ? "fixed_date" : "days_back";
  const daysBack = Number.isInteger(record.daysBack) && Number(record.daysBack) >= 0 ? Number(record.daysBack) : 30;
  const defaultReportStatusFilter =
    record.defaultReportStatusFilter === "all" ||
    record.defaultReportStatusFilter === "final" ||
    record.defaultReportStatusFilter === "draft" ||
    record.defaultReportStatusFilter === "no_report" ||
    record.defaultReportStatusFilter === "study_not_found" ||
    record.defaultReportStatusFilter === "unavailable"
      ? record.defaultReportStatusFilter
      : "required_not_final";

  return {
    cutoffMode,
    defaultCutoffDate: typeof record.defaultCutoffDate === "string" && record.defaultCutoffDate ? record.defaultCutoffDate : null,
    daysBack,
    enabledModalityCodes: normalizeStringArray(record.enabledModalityCodes, DEFAULT_REPORTING_BOARD_SETTINGS.enabledModalityCodes),
    defaultRequiresReport: typeof record.defaultRequiresReport === "boolean" ? record.defaultRequiresReport : true,
    defaultReportStatusFilter,
    defaultSortBy: REPORTING_BOARD_SORT_KEYS.has(String(record.defaultSortBy))
      ? record.defaultSortBy as ReportingBoardSettings["defaultSortBy"]
      : "priority_study_date",
    defaultSortDirection: record.defaultSortDirection === "desc" ? "desc" : "asc",
    pinUrgentToTop: typeof record.pinUrgentToTop === "boolean" ? record.pinUrgentToTop : true,
    includedCaseSources: Array.isArray(record.includedCaseSources)
      ? record.includedCaseSources.filter((value): value is "appointments" | "comparisons" => value === "appointments" || value === "comparisons")
      : ["appointments", "comparisons"],
    refreshIntervalSeconds: Number.isInteger(record.refreshIntervalSeconds) && Number(record.refreshIntervalSeconds) >= 15
      ? Number(record.refreshIntervalSeconds)
      : 50,
  };
}

function savedView(row: {
  id: number;
  ownerUserId: number | null;
  ownerDoctorId: number | null;
  name: string;
  token: string;
  filters: unknown;
  notificationSettings: unknown;
  active: boolean;
  lastAccessedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  accessMode: string | null;
  linkKind?: "admin_saved_view" | "doctor_worklist";
  systemManaged?: boolean;
  targetDoctorId?: number | null;
  adminDisabledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}): ReportingBoardSavedView {
  return {
    ...row,
    lastAccessedAt: nullableIsoString(row.lastAccessedAt),
    expiresAt: nullableIsoString(row.expiresAt),
    revokedAt: nullableIsoString(row.revokedAt),
    accessMode: "public_readonly",
    linkKind: row.linkKind ?? "admin_saved_view",
    systemManaged: Boolean(row.systemManaged),
    targetDoctorId: nullableNumber(row.targetDoctorId),
    adminDisabledAt: nullableIsoString(row.adminDisabledAt),
    filters: cleanRecord(row.filters) as ReportingBoardFilters,
    notificationSettings: cleanRecord(row.notificationSettings) as ReportingBoardNotificationSettings,
  };
}

function bulkAssignmentJob(row: {
  id: number;
  status: ReportingBoardBulkAssignmentJob["status"];
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
  filters: unknown;
  savedViewId: number | null;
  savedViewName: string | null;
  unassignedOnly: boolean;
  reason: string | null;
  result: unknown;
  lastError: string | null;
  attemptCount: number;
  createdByUserId: number | null;
  createdByDoctorId: number | null;
  createdByName: string | null;
  creatorUserActive: boolean | null;
  creatorAppRole: string | null;
  createdAt: string;
  updatedAt: string;
}): ReportingBoardBulkAssignmentJob {
  return {
    ...row,
    id: Number(row.id),
    targetDoctorId: Number(row.targetDoctorId),
    caseCount: Number(row.caseCount),
    savedViewId: nullableNumber(row.savedViewId),
    resumedFromJobId: nullableNumber(row.resumedFromJobId),
    unassignedOnly: true,
    filters: cleanRecord(row.filters) as ReportingBoardFilters,
    result: row.result ? (cleanRecord(row.result) as unknown as BulkAssignNextCasesResult) : null,
    attemptCount: Number(row.attemptCount),
    createdByUserId: nullableNumber(row.createdByUserId),
    createdByDoctorId: nullableNumber(row.createdByDoctorId),
    creatorUserActive: nullableBoolean(row.creatorUserActive),
  };
}

const BULK_ASSIGNMENT_JOB_SELECT = `
  select
    j.id,
    j.status,
    j.scheduled_for as "scheduledFor",
    j.run_started_at as "runStartedAt",
    j.run_completed_at as "runCompletedAt",
    j.cancelled_at as "cancelledAt",
    j.locked_at as "lockedAt",
    j.locked_by as "lockedBy",
    j.resumed_from_job_id as "resumedFromJobId",
    j.target_doctor_id as "targetDoctorId",
    target_doctor.display_name as "targetDoctorName",
    j.case_count as "caseCount",
    j.filters_json as filters,
    j.saved_view_id as "savedViewId",
    j.saved_view_name as "savedViewName",
    j.unassigned_only as "unassignedOnly",
    j.reason,
    j.result_json as result,
    j.last_error as "lastError",
    j.attempt_count as "attemptCount",
    j.created_by_user_id as "createdByUserId",
    j.created_by_doctor_id as "createdByDoctorId",
    creator_doctor.display_name as "createdByName",
    creator_user.is_active as "creatorUserActive",
    creator_user.role as "creatorAppRole",
    j.created_at as "createdAt",
    j.updated_at as "updatedAt"
  from doctor_portal.reporting_board_bulk_assignment_jobs j
  left join doctor_portal.doctor_profiles target_doctor on target_doctor.id = j.target_doctor_id
  left join doctor_portal.doctor_profiles creator_doctor on creator_doctor.id = j.created_by_doctor_id
  left join users creator_user on creator_user.id = j.created_by_user_id
`;

export async function readReportingBoardSettings(): Promise<ReportingBoardSettings> {
  const result = await pool.query<{ setting_value: { value?: unknown } }>(
    `
      select setting_value
      from system_settings
      where category = $1 and setting_key = $2
      limit 1
    `,
    [SETTINGS_CATEGORY, SETTINGS_KEY]
  );
  return normalizeReportingBoardSettings(result.rows[0]?.setting_value?.value);
}

export async function updateReportingBoardSettings(input: unknown, actorUserId: UserId): Promise<ReportingBoardSettings> {
  const normalized = normalizeReportingBoardSettings(input);
  await pool.query(
    `
      insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
      values ($1, $2, $3::jsonb, $4)
      on conflict (category, setting_key)
      do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    `,
    [SETTINGS_CATEGORY, SETTINGS_KEY, JSON.stringify({ value: normalized }), actorUserId]
  );
  return normalized;
}

export async function listSavedViews(_ownerUserId: UserId, _ownerDoctorId: number | null): Promise<ReportingBoardSavedView[]> {
  const result = await pool.query(
    `
      select
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        last_accessed_at as "lastAccessedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        access_mode as "accessMode",
        link_kind as "linkKind",
        system_managed as "systemManaged",
        target_doctor_id as "targetDoctorId",
        admin_disabled_at as "adminDisabledAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from doctor_portal.reporting_board_saved_views
      where link_kind = 'admin_saved_view'
        and system_managed = false
      order by created_at desc, id desc
    `,
    []
  );
  return result.rows.map(savedView);
}

export async function createSavedView(input: {
  ownerUserId: UserId;
  ownerDoctorId: number | null;
  name: string;
  filters: ReportingBoardFilters;
  notificationSettings: ReportingBoardNotificationSettings;
}): Promise<ReportingBoardSavedView> {
  const result = await pool.query(
    `
      insert into doctor_portal.reporting_board_saved_views (
        owner_user_id, owner_doctor_id, name, token, filters_json, notification_settings_json,
        link_kind, system_managed, created_by_user_id, updated_by_user_id
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'admin_saved_view', false, $1, $1)
      returning
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        last_accessed_at as "lastAccessedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        access_mode as "accessMode",
        link_kind as "linkKind",
        system_managed as "systemManaged",
        target_doctor_id as "targetDoctorId",
        admin_disabled_at as "adminDisabledAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      input.ownerUserId,
      input.ownerDoctorId,
      input.name,
      randomBytes(24).toString("base64url"),
      JSON.stringify(input.filters),
      JSON.stringify(input.notificationSettings),
    ]
  );
  return savedView(result.rows[0]);
}

export async function updateSavedView(input: {
  id: number;
  ownerUserId: UserId;
  ownerDoctorId: number | null;
  name?: string;
  filters?: ReportingBoardFilters;
  notificationSettings?: ReportingBoardNotificationSettings;
  active?: boolean;
  expiresAt?: string | null;
}): Promise<ReportingBoardSavedView | null> {
  const result = await pool.query(
    `
      update doctor_portal.reporting_board_saved_views
      set
        name = coalesce($3, name),
        filters_json = coalesce($4::jsonb, filters_json),
        notification_settings_json = coalesce($5::jsonb, notification_settings_json),
        active = coalesce($6, active),
        expires_at = case when $7::boolean then $8::timestamptz else expires_at end,
        updated_by_user_id = $2,
        updated_at = now()
      where id = $1
        and link_kind = 'admin_saved_view'
        and system_managed = false
      returning
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        last_accessed_at as "lastAccessedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        access_mode as "accessMode",
        link_kind as "linkKind",
        system_managed as "systemManaged",
        target_doctor_id as "targetDoctorId",
        admin_disabled_at as "adminDisabledAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      input.id,
      input.ownerUserId,
      input.name ?? null,
      input.filters ? JSON.stringify(input.filters) : null,
      input.notificationSettings ? JSON.stringify(input.notificationSettings) : null,
      input.active ?? null,
      input.expiresAt !== undefined,
      input.expiresAt ?? null,
    ]
  );
  return result.rows[0] ? savedView(result.rows[0]) : null;
}

export async function findSavedViewByToken(token: string, ownerUserId: UserId): Promise<ReportingBoardSavedView | null> {
  const result = await pool.query(
    `
      select
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        last_accessed_at as "lastAccessedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        access_mode as "accessMode",
        link_kind as "linkKind",
        system_managed as "systemManaged",
        target_doctor_id as "targetDoctorId",
        admin_disabled_at as "adminDisabledAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from doctor_portal.reporting_board_saved_views
      where token = $1 and owner_user_id = $2 and active = true
      limit 1
    `,
    [token, ownerUserId]
  );
  return result.rows[0] ? savedView(result.rows[0]) : null;
}

export async function findActiveSavedViewByToken(token: string): Promise<ReportingBoardSavedView | null> {
  const result = await pool.query(
    `
      select
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        last_accessed_at as "lastAccessedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        access_mode as "accessMode",
        link_kind as "linkKind",
        system_managed as "systemManaged",
        target_doctor_id as "targetDoctorId",
        admin_disabled_at as "adminDisabledAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from doctor_portal.reporting_board_saved_views
      where token = $1
        and active = true
        and revoked_at is null
        and (expires_at is null or expires_at > now())
        and (
          link_kind = 'admin_saved_view'
          or exists (
            select 1
            from doctor_portal.doctor_profiles target_dp
            join users target_user on target_user.id = target_dp.user_id
            where target_dp.id = target_doctor_id
              and target_dp.active = true
              and target_user.is_active = true
          )
        )
      limit 1
    `,
    [token]
  );
  return result.rows[0] ? savedView(result.rows[0]) : null;
}

export async function findSavedViewById(id: number, ownerUserId: UserId): Promise<ReportingBoardSavedView | null> {
  const result = await pool.query(
    `
      select
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        last_accessed_at as "lastAccessedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        access_mode as "accessMode",
        link_kind as "linkKind",
        system_managed as "systemManaged",
        target_doctor_id as "targetDoctorId",
        admin_disabled_at as "adminDisabledAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from doctor_portal.reporting_board_saved_views
      where id = $1
        and link_kind = 'admin_saved_view'
        and system_managed = false
      limit 1
    `,
    [id]
  );
  return result.rows[0] ? savedView(result.rows[0]) : null;
}

export async function touchSavedViewLastAccessed(id: number): Promise<void> {
  await pool.query(
    `update doctor_portal.reporting_board_saved_views set last_accessed_at = now() where id = $1`,
    [id]
  );
}

export async function rotateSavedViewToken(input: { id: number; ownerUserId: UserId; ownerDoctorId: number | null }): Promise<ReportingBoardSavedView | null> {
  const result = await pool.query(
    `
      update doctor_portal.reporting_board_saved_views
      set token = $3, updated_by_user_id = $2, updated_at = now()
      where id = $1
        and link_kind = 'admin_saved_view'
        and system_managed = false
        and active = true and revoked_at is null
      returning
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        last_accessed_at as "lastAccessedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        access_mode as "accessMode",
        link_kind as "linkKind",
        system_managed as "systemManaged",
        target_doctor_id as "targetDoctorId",
        admin_disabled_at as "adminDisabledAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [input.id, input.ownerUserId, randomBytes(32).toString("base64url")]
  );
  return result.rows[0] ? savedView(result.rows[0]) : null;
}

export async function revokeSavedView(input: { id: number; ownerUserId: UserId; ownerDoctorId: number | null }): Promise<ReportingBoardSavedView | null> {
  const result = await pool.query(
    `
      update doctor_portal.reporting_board_saved_views
      set active = false, revoked_at = now(), updated_by_user_id = $2, updated_at = now()
      where id = $1
        and link_kind = 'admin_saved_view'
        and system_managed = false
      returning
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        last_accessed_at as "lastAccessedAt",
        expires_at as "expiresAt",
        revoked_at as "revokedAt",
        access_mode as "accessMode",
        link_kind as "linkKind",
        system_managed as "systemManaged",
        target_doctor_id as "targetDoctorId",
        admin_disabled_at as "adminDisabledAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [input.id, input.ownerUserId]
  );
  return result.rows[0] ? savedView(result.rows[0]) : null;
}

export async function createReportingBoardBulkAssignmentJob(
  input: CreateReportingBoardBulkAssignmentJobInput,
  actor: { userId: UserId; doctorId: number | null }
): Promise<ReportingBoardBulkAssignmentJob> {
  const result = await pool.query(
    `
      insert into doctor_portal.reporting_board_bulk_assignment_jobs (
        scheduled_for,
        target_doctor_id,
        case_count,
        filters_json,
        saved_view_id,
        saved_view_name,
        unassigned_only,
        reason,
        created_by_user_id,
        created_by_doctor_id,
        resumed_from_job_id
      )
      values ($1::timestamptz, $2, $3, $4::jsonb, $5, $6, true, $7, $8, $9, $10)
      returning id
    `,
    [
      input.scheduledFor,
      input.doctorId,
      input.count,
      JSON.stringify(input.filters ?? {}),
      input.savedViewId ?? null,
      input.savedViewName?.trim() || null,
      input.reason?.trim() || null,
      actor.userId,
      actor.doctorId,
      input.resumedFromJobId ?? null,
    ]
  );
  const job = await findReportingBoardBulkAssignmentJobById(Number(result.rows[0].id));
  if (!job) throw new HttpError(500, "Scheduled bulk assignment job was not created.");
  return job;
}

export async function listReportingBoardBulkAssignmentJobs(limit = 25): Promise<ReportingBoardBulkAssignmentJob[]> {
  const result = await pool.query(
    `
      ${BULK_ASSIGNMENT_JOB_SELECT}
      order by
        case j.status when 'scheduled' then 0 when 'running' then 1 when 'failed' then 2 else 3 end,
        j.scheduled_for asc,
        j.id asc
      limit $1
    `,
    [Math.max(1, Math.min(limit, 100))]
  );
  return result.rows.map(bulkAssignmentJob);
}

export async function findReportingBoardBulkAssignmentJobById(id: number): Promise<ReportingBoardBulkAssignmentJob | null> {
  const result = await pool.query(
    `
      ${BULK_ASSIGNMENT_JOB_SELECT}
      where j.id = $1
      limit 1
    `,
    [id]
  );
  return result.rows[0] ? bulkAssignmentJob(result.rows[0]) : null;
}

export async function cancelReportingBoardBulkAssignmentJob(input: {
  id: number;
  actorUserId: UserId;
}): Promise<ReportingBoardBulkAssignmentJob | null> {
  const result = await pool.query(
    `
      update doctor_portal.reporting_board_bulk_assignment_jobs
      set
        status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_user_id = $2,
        locked_at = null,
        locked_by = null
      where id = $1
        and status = 'scheduled'
      returning id
    `,
    [input.id, input.actorUserId]
  );
  if (!result.rows[0]) return null;
  return findReportingBoardBulkAssignmentJobById(input.id);
}

export async function claimDueReportingBoardBulkAssignmentJobs(input: {
  limit: number;
  lockedBy: string;
}): Promise<ClaimedReportingBoardBulkAssignmentJob[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const claimed = await client.query<{ id: number }>(
      `
        select id
        from doctor_portal.reporting_board_bulk_assignment_jobs
        where status = 'scheduled'
          and scheduled_for <= now()
        order by scheduled_for asc, id asc
        limit $1
        for update skip locked
      `,
      [Math.max(1, Math.min(input.limit, 25))]
    );
    const ids = claimed.rows.map((row) => Number(row.id));
    if (ids.length === 0) {
      await client.query("commit");
      return [];
    }
    await client.query(
      `
        update doctor_portal.reporting_board_bulk_assignment_jobs
        set
          status = 'running',
          run_started_at = now(),
          run_completed_at = null,
          locked_at = now(),
          locked_by = $2,
          attempt_count = attempt_count + 1,
          last_error = null
        where id = any($1::bigint[])
      `,
      [ids, input.lockedBy]
    );
    const result = await client.query(
      `
        ${BULK_ASSIGNMENT_JOB_SELECT}
        where j.id = any($1::bigint[])
        order by j.scheduled_for asc, j.id asc
      `,
      [ids]
    );
    await client.query("commit");
    return result.rows.map(bulkAssignmentJob) as ClaimedReportingBoardBulkAssignmentJob[];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimReportingBoardBulkAssignmentJobForRunNow(input: {
  id: number;
  lockedBy: string;
}): Promise<ClaimedReportingBoardBulkAssignmentJob | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const claimed = await client.query<{ id: number }>(
      `
        select id
        from doctor_portal.reporting_board_bulk_assignment_jobs
        where id = $1
          and status in ('scheduled', 'failed')
        for update skip locked
      `,
      [input.id]
    );
    if (!claimed.rows[0]) {
      await client.query("commit");
      return null;
    }
    await client.query(
      `
        update doctor_portal.reporting_board_bulk_assignment_jobs
        set
          status = 'running',
          run_started_at = now(),
          run_completed_at = null,
          locked_at = now(),
          locked_by = $2,
          attempt_count = attempt_count + 1,
          last_error = null
        where id = $1
      `,
      [input.id, input.lockedBy]
    );
    const result = await client.query(
      `
        ${BULK_ASSIGNMENT_JOB_SELECT}
        where j.id = $1
        limit 1
      `,
      [input.id]
    );
    await client.query("commit");
    return result.rows[0] ? (bulkAssignmentJob(result.rows[0]) as ClaimedReportingBoardBulkAssignmentJob) : null;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function finishReportingBoardBulkAssignmentJob(input: {
  id: number;
  result: BulkAssignNextCasesResult;
}): Promise<void> {
  const remainingCount = Math.max(0, input.result.requestedCount - input.result.assignedCount);
  const status = input.result.assignedCount >= input.result.requestedCount ? "completed" : "partial";
  const result = { ...input.result, remainingCount };
  await pool.query(
    `
      update doctor_portal.reporting_board_bulk_assignment_jobs
      set
        status = $2,
        run_completed_at = now(),
        locked_at = null,
        locked_by = null,
        result_json = $3::jsonb,
        last_error = null
      where id = $1
        and status = 'running'
    `,
    [input.id, status, JSON.stringify(result)]
  );
}

export async function failReportingBoardBulkAssignmentJob(input: {
  id: number;
  error: string;
}): Promise<void> {
  await pool.query(
    `
      update doctor_portal.reporting_board_bulk_assignment_jobs
      set
        status = 'failed',
        run_completed_at = now(),
        locked_at = null,
        locked_by = null,
        last_error = $2
      where id = $1
        and status = 'running'
    `,
    [input.id, input.error.slice(0, 2000)]
  );
}

function addCaseFilters(input: Required<Pick<ReportingBoardFilters, "limit" | "offset">> & ReportingBoardFilters, values: unknown[]) {
  const where: string[] = ["b.status = 'completed'"];
  if (input.dateFrom) {
    values.push(input.dateFrom);
    where.push(`b.booking_date >= $${values.length}::date`);
  }
  const dateTo = input.dateTo;
  if (dateTo) {
    values.push(dateTo);
    where.push(`b.booking_date <= $${values.length}::date`);
  }
  if (input.modalityId) {
    values.push(input.modalityId);
    where.push(`b.modality_id = $${values.length}`);
  }
  if (input.reportableModalityIds !== null && input.reportableModalityIds !== undefined) {
    values.push(input.reportableModalityIds);
    where.push(`b.modality_id = any($${values.length}::bigint[])`);
  }
  if (input.modalityCode) {
    values.push(input.modalityCode.toUpperCase());
    where.push(`upper(m.code) = $${values.length}`);
  }
  if (input.modalityCodes?.length) {
    values.push(input.modalityCodes.map((code) => code.toUpperCase()));
    where.push(`upper(m.code) = any($${values.length}::text[])`);
  }
  if (input.assignedDoctorId) {
    values.push(input.assignedDoctorId);
    where.push(`cta.assigned_doctor_id = $${values.length}`);
  }
  if (input.assignmentStatus === "unassigned") where.push(`cta.id is null`);
  if (input.assignmentStatus === "assigned") where.push(`cta.id is not null`);
  if (input.caseCategory) {
    values.push(input.caseCategory);
    where.push(`b.case_category = $${values.length}`);
  }
  if (input.requiresReport !== null && input.requiresReport !== undefined) {
    values.push(input.requiresReport);
    where.push(`b.requires_report = $${values.length}`);
  }
  if (input.priorityCode) {
    values.push(input.priorityCode);
    where.push(`rp.code = $${values.length}`);
  }
  if (input.q) {
    values.push(`%${input.q.trim().toLowerCase()}%`);
    where.push(`(
      lower(coalesce(p.english_full_name, '')) like $${values.length}
      or lower(coalesce(p.arabic_full_name, '')) like $${values.length}
      or lower(coalesce(p.mrn, '')) like $${values.length}
      or lower('V2-' || lpad(b.id::text, 6, '0')) like $${values.length}
      or lower(coalesce(et.name_en, '')) like $${values.length}
    )`);
  }
  if (input.appointmentId) {
    values.push(input.appointmentId);
    where.push(`b.id = $${values.length}`);
  }
  return where;
}

function caseSortDirection(direction: ReportingBoardFilters["sortDirection"] | undefined | null): "asc" | "desc" {
  if (!direction || direction === "asc") return "asc";
  if (direction === "desc") return "desc";
  throw new HttpError(400, "sortDirection must be asc or desc.");
}

function caseSortOrder(filters: ReportingBoardFilters): string {
  const direction = caseSortDirection(filters.sortDirection);
  const timeNulls = direction === "asc" ? "nulls first" : "nulls last";
  const priorityPin = "case lower(coalesce(rp.code, '')) when 'stat' then 0 when 'urgent' then 1 else 2 end asc";
  const sortBy = filters.sortBy ?? "priority_study_date";
  let selectedOrder: string[];

  switch (sortBy) {
    case "priority_study_date":
      selectedOrder = [
        "rp.sort_order asc nulls last",
        `b.booking_date ${direction}`,
        `b.booking_time ${direction} ${timeNulls}`,
        `b.id ${direction}`,
      ];
      break;
    case "study_date":
      selectedOrder = [`b.booking_date ${direction}`, `b.booking_time ${direction} ${timeNulls}`, `b.id ${direction}`];
      break;
    case "accession":
      selectedOrder = [`b.id ${direction}`];
      break;
    case "patient_name":
      selectedOrder = [`lower(coalesce(p.english_full_name, p.arabic_full_name, p.mrn, '')) ${direction}`, "b.id asc"];
      break;
    case "mrn":
      selectedOrder = [`lower(coalesce(p.mrn, '')) ${direction}`, "b.id asc"];
      break;
    case "exam_type":
      selectedOrder = [`lower(coalesce(et.name_en, '')) ${direction}`, "b.id asc"];
      break;
    case "modality":
      selectedOrder = [`upper(coalesce(m.code, '')) ${direction}`, "b.id asc"];
      break;
    case "assigned_doctor":
      selectedOrder = [`lower(coalesce(assigned_doctor.display_name, '')) ${direction}`, "b.id asc"];
      break;
    case "longest_unassigned":
      selectedOrder = [
        `case when cta.id is null and b.completed_at is not null then 0 else 1 end asc`,
        `b.completed_at ${direction === "asc" ? "asc" : "desc"} nulls last`,
        "b.id asc",
      ];
      break;
    case "longest_assigned_not_final":
      selectedOrder = [
        `case when cta.id is not null then 0 else 1 end asc`,
        `cta.assigned_at ${direction === "asc" ? "asc" : "desc"} nulls last`,
        "b.id asc",
      ];
      break;
    case "oldest_completed":
      selectedOrder = [`b.completed_at ${direction} nulls last`, "b.id asc"];
      break;
    default:
      throw new HttpError(400, "sortBy is not supported.");
  }

  return [filters.pinUrgentToTop === false ? null : priorityPin, ...selectedOrder].filter(Boolean).join(", ");
}

export async function listReportingBoardCaseCandidates(
  filters: Required<Pick<ReportingBoardFilters, "limit" | "offset">> & ReportingBoardFilters,
  options: CaseQueryOptions = {}
): Promise<ReportingBoardCaseRow[]> {
  const db = options.db ?? pool;
  const values: unknown[] = [];
  const where = addCaseFilters(filters, values);
  const orderBy = caseSortOrder(filters);
  const limit = options.limitOverride ?? filters.limit ?? 100;
  const offset = options.offsetOverride ?? filters.offset ?? 0;
  values.push(limit);
  const limitParam = values.length;
  values.push(offset);
  const offsetParam = values.length;

  const result = await db.query<ReportingBoardCaseRow>(
    `
      select
        'appointment'::text as "caseType",
        ('appointment:' || b.id::text) as "caseKey",
        b.id as "appointmentId",
        null::bigint as "comparisonRequestId",
        b.patient_id as "patientId",
        p.mrn as "patientMrn",
        coalesce(
          nullif(trim(primary_identifier.value), ''),
          nullif(trim(p.identifier_value), ''),
          nullif(trim(p.national_id), '')
        ) as "patientDicomId",
        p.english_full_name as "patientEnglishName",
        p.arabic_full_name as "patientArabicName",
        ('V2-' || lpad(b.id::text, 6, '0')) as "accessionNumber",
        b.study_instance_uid as "studyInstanceUid",
        b.booking_date::text as "bookingDate",
        b.booking_time::text as "bookingTime",
        b.modality_id as "modalityId",
        m.code as "modalityCode",
        m.name_en as "modalityName",
        b.exam_type_id as "examTypeId",
        et.name_en as "examTypeName",
        null::bigint as "linkedPreviousBookingId",
        null::text as "linkedPreviousStudyDate",
        null::text as "linkedPreviousAccessionNumber",
        b.case_category as "caseCategory",
        b.status as "appointmentStatus",
        b.requires_report as "requiresReport",
        b.reporting_priority_id as "reportingPriorityId",
        rp.code as "reportingPriorityCode",
        rp.name_en as "reportingPriorityName",
        rp.sort_order as "reportingPrioritySortOrder",
        cta.assigned_doctor_id as "assignedDoctorId",
        assigned_doctor.display_name as "assignedDoctorName",
        case when cta.id is null then 'unassigned' else 'assigned' end as "assignmentStatus",
        b.completed_at as "completedAt",
        cta.assigned_at as "currentAssignedAt",
        first_assignment.first_assigned_at as "firstAssignedAt",
        case when manual_final.id is not null then manual_final.created_at else cache.report_final_at end as "reportFinalAt",
        null::text as "dueAt",
        null::int as "completedToAssignedMinutes",
        null::int as "assignedToFinalMinutes",
        null::int as "completedToFinalMinutes",
        null::int as "currentAssignmentAgeMinutes",
        null::int as "completedUnassignedAgeMinutes",
        case when manual_final.id is not null then 'final' else coalesce(cache.report_status, 'unavailable') end as "reportStatus",
        cache.last_success_at as "reportStatusCheckedAt",
        cache.sonicdicom_study_note as "sonicDicomStudyNote",
        cache.last_success_at as "sonicDicomStudyNoteCheckedAt",
        case when cache.last_success_at is not null and cache.sonicdicom_study_note is not null then 'sonicdicom' else null end as "sonicDicomStudyNoteSource",
        manual_final.id as "manualFinalOverrideId",
        manual_final.created_at as "manualFinalAt",
        manual_final_doctor.display_name as "manualFinalByName",
        manual_final.reason as "manualFinalReason",
        case when manual_final.id is not null then 'manual' when cache.appointment_id is not null then 'sonicdicom' else null end as "reportStatusSource",
        (b.requires_report = true and b.status = 'completed') as "canAssign",
        case
          when b.requires_report = false then 'report_not_required'
          when b.status <> 'completed' then 'study_not_completed'
          when manual_final.id is not null then 'manual_final'
          else null
        end as "exclusionReason"
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      left join reporting_priorities rp on rp.id = b.reporting_priority_id
      left join lateral (
        select pi.value
        from patient_identifiers pi
        where pi.patient_id = p.id
          and pi.is_primary = true
        order by pi.id asc
        limit 1
      ) primary_identifier on true
      left join doctor_portal.case_team_assignments cta on cta.appointment_id = b.id and cta.assignment_type = 'reporting' and cta.status = 'active'
      left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cta.assigned_doctor_id
      left join doctor_portal.reporting_board_manual_final_overrides manual_final on manual_final.appointment_id = b.id and manual_final.cleared_at is null
      left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id = b.id
      left join doctor_portal.doctor_profiles manual_final_doctor on manual_final_doctor.id = manual_final.created_by_doctor_id
      left join lateral (
        select min(history.assigned_at) as first_assigned_at
        from doctor_portal.case_team_assignments history
        where history.appointment_id = b.id
          and history.assignment_type = 'reporting'
      ) first_assignment on true
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      order by ${orderBy}
      limit $${limitParam} offset $${offsetParam}
      ${options.forUpdate ? "for update of b skip locked" : ""}
    `,
    values
  );
  return result.rows.map(reportingBoardCaseRow);
}

function reportingBoardCaseRow(row: ReportingBoardCaseRow): ReportingBoardCaseRow {
  return {
    ...row,
    caseType: row.caseType ?? "appointment",
    caseKey: row.caseKey ?? `appointment:${row.appointmentId}`,
    appointmentId: Number(row.appointmentId),
    comparisonRequestId: nullableNumber(row.comparisonRequestId),
    patientId: Number(row.patientId),
    modalityId: Number(row.modalityId),
    examTypeId: nullableNumber(row.examTypeId),
    linkedPreviousBookingId: nullableNumber(row.linkedPreviousBookingId),
    reportingPriorityId: nullableNumber(row.reportingPriorityId),
    reportingPrioritySortOrder: nullableNumber(row.reportingPrioritySortOrder),
    assignedDoctorId: nullableNumber(row.assignedDoctorId),
    completedAt: nullableIsoString(row.completedAt),
    currentAssignedAt: nullableIsoString(row.currentAssignedAt),
    firstAssignedAt: nullableIsoString(row.firstAssignedAt),
    reportFinalAt: nullableIsoString(row.reportFinalAt),
    reportStatusCheckedAt: nullableIsoString(row.reportStatusCheckedAt),
    sonicDicomStudyNote: row.sonicDicomStudyNote ?? null,
    sonicDicomStudyNoteCheckedAt: nullableIsoString(row.sonicDicomStudyNoteCheckedAt),
    sonicDicomStudyNoteSource: row.sonicDicomStudyNoteSource ?? null,
    manualFinalOverrideId: nullableNumber(row.manualFinalOverrideId),
    manualFinalAt: nullableIsoString(row.manualFinalAt),
    manualFinalByName: row.manualFinalByName ?? null,
    manualFinalReason: row.manualFinalReason ?? null,
    reportStatusSource: row.reportStatusSource ?? null,
    dueAt: nullableIsoString(row.dueAt),
    completedToAssignedMinutes: nullableNumber(row.completedToAssignedMinutes),
    assignedToFinalMinutes: nullableNumber(row.assignedToFinalMinutes),
    completedToFinalMinutes: nullableNumber(row.completedToFinalMinutes),
    currentAssignmentAgeMinutes: nullableNumber(row.currentAssignmentAgeMinutes),
    completedUnassignedAgeMinutes: nullableNumber(row.completedUnassignedAgeMinutes),
  };
}

function reportingBoardStatsRow(row: ReportingBoardStatsBaseRow): ReportingBoardStatsBaseRow {
  return {
    ...row,
    caseType: row.caseType ?? "appointment",
    appointmentId: Number(row.appointmentId),
    comparisonRequestId: nullableNumber(row.comparisonRequestId),
    assignedDoctorId: nullableNumber(row.assignedDoctorId),
    completedAt: nullableIsoString(row.completedAt),
    currentAssignedAt: nullableIsoString(row.currentAssignedAt),
    firstAssignedAt: nullableIsoString(row.firstAssignedAt),
    reportFinalAt: nullableIsoString(row.reportFinalAt),
    reportStatusSource: row.reportStatusSource ?? null,
    manualFinalOverrideId: nullableNumber(row.manualFinalOverrideId),
  };
}

export async function listReportingBoardStatsRows(
  filters: Required<Pick<ReportingBoardFilters, "limit" | "offset">> & ReportingBoardFilters
): Promise<ReportingBoardStatsBaseRow[]> {
  const values: unknown[] = [];
  const where = addCaseFilters(filters, values);
  const result = await pool.query<ReportingBoardStatsBaseRow>(
    `
      select
        'appointment'::text as "caseType",
        b.id as "appointmentId",
        null::bigint as "comparisonRequestId",
        b.booking_date::text as "bookingDate",
        b.status as "appointmentStatus",
        m.code as "modalityCode",
        b.requires_report as "requiresReport",
        rp.code as "reportingPriorityCode",
        rp.name_en as "reportingPriorityName",
        cta.assigned_doctor_id as "assignedDoctorId",
        assigned_doctor.display_name as "assignedDoctorName",
        case when cta.id is null then 'unassigned' else 'assigned' end as "assignmentStatus",
        b.completed_at as "completedAt",
        cta.assigned_at as "currentAssignedAt",
        first_assignment.first_assigned_at as "firstAssignedAt",
        case when manual_final.id is not null then manual_final.created_at else cache.report_final_at end as "reportFinalAt",
        case when manual_final.id is not null then 'final' else coalesce(cache.report_status, 'unavailable') end as "reportStatus",
        case when manual_final.id is not null then 'manual' when cache.appointment_id is not null then 'sonicdicom' else null end as "reportStatusSource",
        manual_final.id as "manualFinalOverrideId"
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      left join reporting_priorities rp on rp.id = b.reporting_priority_id
      left join doctor_portal.case_team_assignments cta on cta.appointment_id = b.id and cta.assignment_type = 'reporting' and cta.status = 'active'
      left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cta.assigned_doctor_id
      left join doctor_portal.reporting_board_manual_final_overrides manual_final on manual_final.appointment_id = b.id and manual_final.cleared_at is null
      left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id = b.id
      left join lateral (
        select min(history.assigned_at) as first_assigned_at
        from doctor_portal.case_team_assignments history
        where history.appointment_id = b.id
          and history.assignment_type = 'reporting'
      ) first_assignment on true
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      order by b.id asc
    `,
    values
  );
  return result.rows.map(reportingBoardStatsRow);
}

export async function listReportingBoardCasesByAppointmentIds(appointmentIds: number[]): Promise<ReportingBoardCaseRow[]> {
  if (appointmentIds.length === 0) return [];
  const result = await pool.query<ReportingBoardCaseRow>(
    `
      select
        'appointment'::text as "caseType",
        ('appointment:' || b.id::text) as "caseKey",
        b.id as "appointmentId",
        null::bigint as "comparisonRequestId",
        b.patient_id as "patientId",
        p.mrn as "patientMrn",
        coalesce(
          nullif(trim(primary_identifier.value), ''),
          nullif(trim(p.identifier_value), ''),
          nullif(trim(p.national_id), '')
        ) as "patientDicomId",
        p.english_full_name as "patientEnglishName",
        p.arabic_full_name as "patientArabicName",
        ('V2-' || lpad(b.id::text, 6, '0')) as "accessionNumber",
        b.study_instance_uid as "studyInstanceUid",
        b.booking_date::text as "bookingDate",
        b.booking_time::text as "bookingTime",
        b.modality_id as "modalityId",
        m.code as "modalityCode",
        m.name_en as "modalityName",
        b.exam_type_id as "examTypeId",
        et.name_en as "examTypeName",
        null::bigint as "linkedPreviousBookingId",
        null::text as "linkedPreviousStudyDate",
        null::text as "linkedPreviousAccessionNumber",
        b.case_category as "caseCategory",
        b.status as "appointmentStatus",
        b.requires_report as "requiresReport",
        b.reporting_priority_id as "reportingPriorityId",
        rp.code as "reportingPriorityCode",
        rp.name_en as "reportingPriorityName",
        rp.sort_order as "reportingPrioritySortOrder",
        cta.assigned_doctor_id as "assignedDoctorId",
        assigned_doctor.display_name as "assignedDoctorName",
        case when cta.id is null then 'unassigned' else 'assigned' end as "assignmentStatus",
        b.completed_at as "completedAt",
        cta.assigned_at as "currentAssignedAt",
        first_assignment.first_assigned_at as "firstAssignedAt",
        null::text as "reportFinalAt",
        null::text as "dueAt",
        null::int as "completedToAssignedMinutes",
        null::int as "assignedToFinalMinutes",
        null::int as "completedToFinalMinutes",
        null::int as "currentAssignmentAgeMinutes",
        null::int as "completedUnassignedAgeMinutes",
        'unavailable'::text as "reportStatus",
        null::text as "reportStatusCheckedAt",
        manual_final.id as "manualFinalOverrideId",
        manual_final.created_at as "manualFinalAt",
        manual_final_doctor.display_name as "manualFinalByName",
        manual_final.reason as "manualFinalReason",
        case when manual_final.id is null then null else 'manual' end as "reportStatusSource",
        (b.requires_report = true and b.status = 'completed') as "canAssign",
        case
          when b.requires_report = false then 'report_not_required'
          when b.status <> 'completed' then 'study_not_completed'
          when manual_final.id is not null then 'manual_final'
          else null
        end as "exclusionReason"
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      left join reporting_priorities rp on rp.id = b.reporting_priority_id
      left join lateral (
        select pi.value
        from patient_identifiers pi
        where pi.patient_id = p.id
          and pi.is_primary = true
        order by pi.id asc
        limit 1
      ) primary_identifier on true
      left join doctor_portal.case_team_assignments cta on cta.appointment_id = b.id and cta.assignment_type = 'reporting' and cta.status = 'active'
      left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cta.assigned_doctor_id
      left join doctor_portal.reporting_board_manual_final_overrides manual_final on manual_final.appointment_id = b.id and manual_final.cleared_at is null
      left join doctor_portal.doctor_profiles manual_final_doctor on manual_final_doctor.id = manual_final.created_by_doctor_id
      left join lateral (
        select min(history.assigned_at) as first_assigned_at
        from doctor_portal.case_team_assignments history
        where history.appointment_id = b.id
          and history.assignment_type = 'reporting'
      ) first_assignment on true
      where b.id = any($1::bigint[])
      order by array_position($1::bigint[], b.id)
    `,
    [appointmentIds]
  );
  return result.rows.map(reportingBoardCaseRow);
}

export async function findActiveManualFinalOverride(appointmentId: number): Promise<ReportingBoardManualFinalOverride | null> {
  const result = await pool.query<ReportingBoardManualFinalOverride>(
    `
      select
        id,
        appointment_id as "appointmentId",
        reason,
        created_by_user_id as "createdByUserId",
        created_by_doctor_id as "createdByDoctorId",
        created_at as "createdAt",
        cleared_by_user_id as "clearedByUserId",
        cleared_by_doctor_id as "clearedByDoctorId",
        cleared_at as "clearedAt",
        clear_reason as "clearReason"
      from doctor_portal.reporting_board_manual_final_overrides
      where appointment_id = $1 and cleared_at is null
      limit 1
    `,
    [appointmentId]
  );
  return result.rows[0] ? manualFinalOverride(result.rows[0]) : null;
}

export async function listActiveManualFinalOverridesByAppointmentIds(appointmentIds: number[]): Promise<ReportingBoardManualFinalOverride[]> {
  if (appointmentIds.length === 0) return [];
  const result = await pool.query<ReportingBoardManualFinalOverride>(
    `
      select
        id,
        appointment_id as "appointmentId",
        reason,
        created_by_user_id as "createdByUserId",
        created_by_doctor_id as "createdByDoctorId",
        created_at as "createdAt",
        cleared_by_user_id as "clearedByUserId",
        cleared_by_doctor_id as "clearedByDoctorId",
        cleared_at as "clearedAt",
        clear_reason as "clearReason"
      from doctor_portal.reporting_board_manual_final_overrides
      where appointment_id = any($1::bigint[]) and cleared_at is null
      order by appointment_id asc
    `,
    [appointmentIds]
  );
  return result.rows.map(manualFinalOverride);
}

export async function markReportingBoardCaseManualFinal(input: {
  appointmentId: number;
  reason: string;
  actor: AssignmentActor;
}): Promise<ReportingBoardManualFinalOverride> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const booking = await client.query<{ id: number; status: string; accessionNumber: string }>(
      `
        select id, status, ('V2-' || lpad(id::text, 6, '0')) as "accessionNumber"
        from appointments_v2.bookings
        where id = $1
        for update
      `,
      [input.appointmentId]
    );
    const row = booking.rows[0];
    if (!row) throw new HttpError(404, "Case not found.");
    if (row.status !== "completed") throw new HttpError(409, "Only completed Reporting Board cases can be manually marked final.");

    const existing = await client.query<{ id: number }>(
      `
        select id
        from doctor_portal.reporting_board_manual_final_overrides
        where appointment_id = $1 and cleared_at is null
        limit 1
        for update
      `,
      [input.appointmentId]
    );
    if (existing.rows[0]) throw new HttpError(409, "This Reporting Board case already has an active manual final override.");

    const inserted = await client.query<ReportingBoardManualFinalOverride>(
      `
        insert into doctor_portal.reporting_board_manual_final_overrides (
          appointment_id, reason, created_by_user_id, created_by_doctor_id
        )
        values ($1, $2, $3, $4)
        returning
          id,
          appointment_id as "appointmentId",
          reason,
          created_by_user_id as "createdByUserId",
          created_by_doctor_id as "createdByDoctorId",
          created_at as "createdAt",
          cleared_by_user_id as "clearedByUserId",
          cleared_by_doctor_id as "clearedByDoctorId",
          cleared_at as "clearedAt",
          clear_reason as "clearReason"
      `,
      [input.appointmentId, input.reason, input.actor.userId, input.actor.doctorId]
    );
    const override = manualFinalOverride(inserted.rows[0]);
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actor.userId,
      actorDoctorId: input.actor.doctorId,
      eventType: "reporting_board_case_manual_final_marked",
      targetType: "appointment",
      targetId: input.appointmentId,
      metadata: {
        overrideId: override.id,
        appointmentId: input.appointmentId,
        accessionNumber: row.accessionNumber,
        source: "rispro_manual_final",
      },
      reason: input.reason,
    });
    await client.query("commit");
    return override;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function clearReportingBoardCaseManualFinal(input: {
  appointmentId: number;
  reason: string;
  actor: AssignmentActor;
}): Promise<ReportingBoardManualFinalOverride> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<ReportingBoardManualFinalOverride>(
      `
        select
          id,
          appointment_id as "appointmentId",
          reason,
          created_by_user_id as "createdByUserId",
          created_by_doctor_id as "createdByDoctorId",
          created_at as "createdAt",
          cleared_by_user_id as "clearedByUserId",
          cleared_by_doctor_id as "clearedByDoctorId",
          cleared_at as "clearedAt",
          clear_reason as "clearReason"
        from doctor_portal.reporting_board_manual_final_overrides
        where appointment_id = $1 and cleared_at is null
        limit 1
        for update
      `,
      [input.appointmentId]
    );
    const current = existing.rows[0] ? manualFinalOverride(existing.rows[0]) : null;
    if (!current) throw new HttpError(404, "No active manual final override was found for this Reporting Board case.");

    const updated = await client.query<ReportingBoardManualFinalOverride>(
      `
        update doctor_portal.reporting_board_manual_final_overrides
        set
          cleared_by_user_id = $2,
          cleared_by_doctor_id = $3,
          cleared_at = now(),
          clear_reason = $4
        where id = $1
        returning
          id,
          appointment_id as "appointmentId",
          reason,
          created_by_user_id as "createdByUserId",
          created_by_doctor_id as "createdByDoctorId",
          created_at as "createdAt",
          cleared_by_user_id as "clearedByUserId",
          cleared_by_doctor_id as "clearedByDoctorId",
          cleared_at as "clearedAt",
          clear_reason as "clearReason"
      `,
      [current.id, input.actor.userId, input.actor.doctorId, input.reason]
    );
    const override = manualFinalOverride(updated.rows[0]);
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actor.userId,
      actorDoctorId: input.actor.doctorId,
      eventType: "reporting_board_case_manual_final_cleared",
      targetType: "appointment",
      targetId: input.appointmentId,
      metadata: {
        overrideId: override.id,
        appointmentId: input.appointmentId,
      },
      reason: input.reason,
    });
    await client.query("commit");
    return override;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function findAssignableDoctorForReporting(doctorId: number) {
  const result = await pool.query<{ id: number; displayName: string; canFinalizeReports: boolean }>(
    `
      select id, display_name as "displayName", can_finalize_reports as "canFinalizeReports"
      from doctor_portal.doctor_profiles
      where id = $1 and active = true
      limit 1
    `,
    [doctorId]
  );
  return result.rows[0] ?? null;
}

export async function doctorCanReportAllModalities(doctorId: number, modalityIds: number[]): Promise<boolean> {
  if (modalityIds.length === 0) return true;
  const uniqueModalityIds = [...new Set(modalityIds)];
  const result = await pool.query<{ modality_id: number }>(
    `
      select distinct modality_id
      from doctor_portal.doctor_modality_permissions
      where doctor_id = $1
        and modality_id = any($2::bigint[])
        and can_report = true
        and active = true
    `,
    [doctorId, uniqueModalityIds]
  );
  return result.rows.length === uniqueModalityIds.length;
}

export async function listDoctorReportableModalityIds(doctorId: number): Promise<number[]> {
  const result = await pool.query<{ modality_id: number }>(
    `
      select modality_id
      from doctor_portal.doctor_modality_permissions
      where doctor_id = $1
        and can_report = true
        and active = true
    `,
    [doctorId]
  );
  return result.rows.map((row) => Number(row.modality_id));
}

export async function bulkAssignReportingCases(input: {
  doctorId: number;
  candidateAppointmentIds: number[];
  reason: string | null;
  unassignedOnly: boolean;
  actor: AssignmentActor;
  caseAuditEventType?: string;
  summaryAuditEventType?: string;
  restrictToDoctorReportPermissions?: boolean;
}): Promise<BulkAssignNextCasesResult> {
  const client = await pool.connect();
  const assignedAppointmentIds: number[] = [];
  const skipped: Array<{ appointmentId: number; reason: string }> = [];
  try {
    await client.query("begin");
    const locked = await client.query<CandidateAssignment & { modalityId: number }>(
      `
        select b.id as "appointmentId", b.modality_id as "modalityId", cta.id
        from appointments_v2.bookings b
        left join doctor_portal.case_team_assignments cta
          on cta.appointment_id = b.id and cta.assignment_type = 'reporting' and cta.status = 'active'
        where b.id = any($1::bigint[])
        for update of b
      `,
      [input.candidateAppointmentIds]
    );
    const lockedIds = new Set(locked.rows.map((row) => Number(row.appointmentId)));
    // The initial left join can have been read before this transaction waited
    // for another automatic assigner to release the booking lock. Re-read
    // active assignments after those locks are held so the waiting caller
    // reports a skip instead of correcting/replacing the first assignment.
    const activeAssignments = await client.query<{ appointment_id: number }>(
      `
        select appointment_id
        from doctor_portal.case_team_assignments
        where appointment_id = any($1::bigint[])
          and assignment_type = 'reporting'
          and status = 'active'
        for update
      `,
      [input.candidateAppointmentIds]
    );
    const existingActiveIds = new Set(activeAssignments.rows.map((row) => Number(row.appointment_id)));
    const modalityByAppointmentId = new Map(locked.rows.map((row) => [Number(row.appointmentId), Number(row.modalityId)]));
    const reportableModalityIds = input.restrictToDoctorReportPermissions
      ? new Set((await client.query<{ modality_id: number }>(
        `select modality_id from doctor_portal.doctor_modality_permissions where doctor_id = $1 and can_report = true and active = true`,
        [input.doctorId]
      )).rows.map((row) => Number(row.modality_id)))
      : null;
    for (const appointmentId of input.candidateAppointmentIds) {
      if (!lockedIds.has(appointmentId)) {
        skipped.push({ appointmentId, reason: "appointment_not_found" });
        continue;
      }
      if (input.unassignedOnly && existingActiveIds.has(appointmentId)) {
        skipped.push({ appointmentId, reason: "already_assigned" });
        continue;
      }
      if (reportableModalityIds && !reportableModalityIds.has(modalityByAppointmentId.get(appointmentId)!)) {
        skipped.push({ appointmentId, reason: "doctor_not_permitted_for_modality" });
        continue;
      }
      await client.query(
        `
          update doctor_portal.case_team_assignments
          set status = 'corrected', updated_at = now()
          where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'
        `,
        [appointmentId]
      );
      const inserted = await client.query<{ id: number }>(
        `
          insert into doctor_portal.case_team_assignments (
            appointment_id, roster_assignment_id, assigned_doctor_id, modality_id, assignment_type, expected_reporting_date, status
          )
          select b.id, null, $2, b.modality_id, 'reporting', b.booking_date, 'active'
          from appointments_v2.bookings b
          where b.id = $1
            and b.requires_report = true
            and b.status = 'completed'
          returning id
        `,
        [appointmentId, input.doctorId]
      );
      const assignmentId = inserted.rows[0]?.id;
      if (!assignmentId) {
        skipped.push({ appointmentId, reason: "case_not_assignable" });
        continue;
      }
      assignedAppointmentIds.push(appointmentId);
      await insertDoctorAuditEvent(client, {
        actorUserId: input.actor.userId,
        actorDoctorId: input.actor.doctorId,
        eventType: input.caseAuditEventType ?? "reporting_board_bulk_case_assigned",
        targetType: "case_team_assignment",
        targetId: assignmentId,
        metadata: { appointmentId, doctorId: input.doctorId, noteForDoctor: input.reason },
        reason: input.reason,
      });
    }
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actor.userId,
      actorDoctorId: input.actor.doctorId,
      eventType: input.summaryAuditEventType ?? "reporting_board_bulk_assign_completed",
      targetType: "case_team_assignment",
      targetId: null,
        metadata: {
          doctorId: input.doctorId,
          requestedCount: input.candidateAppointmentIds.length,
          assignedCount: assignedAppointmentIds.length,
          skipped,
          noteForDoctor: input.reason,
        },
      reason: input.reason,
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return {
    requestedCount: input.candidateAppointmentIds.length,
    assignedCount: assignedAppointmentIds.length,
    skippedCount: skipped.length,
    assignedAppointmentIds,
    skipped,
  };
}

interface ActiveReportingAssignment {
  id: number;
  appointmentId: number;
  assignedDoctorId: number | null;
  rosterAssignmentId: number | null;
  assignmentType: "reporting";
  assignedAt?: string | null;
}

function activeReportingAssignment(row: ActiveReportingAssignment): ActiveReportingAssignment {
  return {
    id: Number(row.id),
    appointmentId: Number(row.appointmentId),
    assignedDoctorId: nullableNumber(row.assignedDoctorId),
    rosterAssignmentId: nullableNumber(row.rosterAssignmentId),
    assignmentType: row.assignmentType,
    assignedAt: nullableIsoString(row.assignedAt),
  };
}

export async function undoReportingBoardBulkAssignmentJobAssignments(input: {
  jobId: number;
  targetDoctorId: number;
  assignedAppointmentIds: number[];
  finalAppointmentIds: number[];
  completedAt: string | null;
  actor: AssignmentActor;
}): Promise<BulkUnassignSelectedCasesResult> {
  const client = await pool.connect();
  const unassignedAppointmentIds: number[] = [];
  const skipped: Array<{ appointmentId: number; reason: string }> = [];
  const finalIds = new Set(input.finalAppointmentIds);
  try {
    await client.query("begin");
    const lockedBookings = await client.query<{ appointmentId: number }>(
      `
        select id as "appointmentId"
        from appointments_v2.bookings
        where id = any($1::bigint[])
        for update
      `,
      [input.assignedAppointmentIds]
    );
    const lockedIds = new Set(lockedBookings.rows.map((row) => Number(row.appointmentId)));
    const activeRows = await client.query<ActiveReportingAssignment>(
      `
        select
          id,
          appointment_id as "appointmentId",
          assigned_doctor_id as "assignedDoctorId",
          roster_assignment_id as "rosterAssignmentId",
          assignment_type as "assignmentType",
          assigned_at as "assignedAt"
        from doctor_portal.case_team_assignments
        where appointment_id = any($1::bigint[]) and assignment_type = 'reporting' and status = 'active'
        for update
      `,
      [input.assignedAppointmentIds]
    );
    const activeByAppointmentId = new Map(activeRows.rows.map((row) => {
      const assignment = activeReportingAssignment(row);
      return [assignment.appointmentId, assignment];
    }));

    for (const appointmentId of input.assignedAppointmentIds) {
      if (!lockedIds.has(appointmentId)) {
        skipped.push({ appointmentId, reason: "appointment_not_found" });
        continue;
      }
      if (finalIds.has(appointmentId)) {
        skipped.push({ appointmentId, reason: "report_final" });
        continue;
      }
      const assignment = activeByAppointmentId.get(appointmentId);
      if (!assignment) {
        skipped.push({ appointmentId, reason: "no_active_assignment" });
        continue;
      }
      if (assignment.assignedDoctorId !== input.targetDoctorId) {
        skipped.push({ appointmentId, reason: "assignment_changed" });
        continue;
      }
      if (input.completedAt && assignment.assignedAt && new Date(assignment.assignedAt).getTime() > new Date(input.completedAt).getTime()) {
        skipped.push({ appointmentId, reason: "assignment_changed_after_job" });
        continue;
      }
      await client.query(
        `
          update doctor_portal.case_team_assignments
          set status = 'cancelled', updated_at = now()
          where id = $1
        `,
        [assignment.id]
      );
      unassignedAppointmentIds.push(appointmentId);
      await insertDoctorAuditEvent(client, {
        actorUserId: input.actor.userId,
        actorDoctorId: input.actor.doctorId,
        eventType: "reporting_board_bulk_assignment_job_case_undone",
        targetType: "case_team_assignment",
        targetId: assignment.id,
        metadata: {
          jobId: input.jobId,
          appointmentId,
          previousDoctorId: assignment.assignedDoctorId,
          previousRosterAssignmentId: assignment.rosterAssignmentId,
          assignmentType: assignment.assignmentType,
        },
        reason: `Undo scheduled job #${input.jobId}`,
      });
    }

    const result = {
      requestedCount: input.assignedAppointmentIds.length,
      unassignedCount: unassignedAppointmentIds.length,
      skippedCount: skipped.length,
      unassignedAppointmentIds,
      skipped,
    };
    const nextStatus =
      result.unassignedCount === result.requestedCount
        ? "undone"
        : result.unassignedCount > 0
          ? "partially_undone"
          : null;
    await client.query(
      `
        update doctor_portal.reporting_board_bulk_assignment_jobs
        set
          status = coalesce($2, status),
          result_json = coalesce(result_json, '{}'::jsonb) || jsonb_build_object('undo', $3::jsonb),
          last_error = case when $2::text is null then 'No assigned cases could be undone.' else null end,
          updated_at = now()
        where id = $1
      `,
      [input.jobId, nextStatus, JSON.stringify(result)]
    );
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actor.userId,
      actorDoctorId: input.actor.doctorId,
      eventType: "reporting_board_bulk_assignment_job_undo_completed",
      targetType: "reporting_board_bulk_assignment_job",
      targetId: input.jobId,
      metadata: result,
      reason: `Undo scheduled job #${input.jobId}`,
    });
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function unassignReportingCase(input: {
  appointmentId: number;
  reason: string;
  actor: AssignmentActor;
}): Promise<{ unassigned: true; appointmentId: number; assignmentId: number }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const booking = await client.query<{ id: number }>(
      `select id from appointments_v2.bookings where id = $1 for update`,
      [input.appointmentId]
    );
    if (!booking.rows[0]) throw new Error("appointment_not_found");

    const active = await client.query<ActiveReportingAssignment>(
      `
        select
          id,
          appointment_id as "appointmentId",
          assigned_doctor_id as "assignedDoctorId",
          roster_assignment_id as "rosterAssignmentId",
          assignment_type as "assignmentType"
        from doctor_portal.case_team_assignments
        where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'
        limit 1
        for update
      `,
      [input.appointmentId]
    );
    const assignment = active.rows[0] ? activeReportingAssignment(active.rows[0]) : null;
    if (!assignment) throw new Error("active_assignment_not_found");

    await client.query(
      `
        update doctor_portal.case_team_assignments
        set status = 'cancelled', updated_at = now()
        where id = $1
      `,
      [assignment.id]
    );
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actor.userId,
      actorDoctorId: input.actor.doctorId,
      eventType: "reporting_board_case_unassigned",
      targetType: "case_team_assignment",
      targetId: assignment.id,
      metadata: {
        appointmentId: input.appointmentId,
        previousDoctorId: assignment.assignedDoctorId,
        previousRosterAssignmentId: assignment.rosterAssignmentId,
        assignmentType: assignment.assignmentType,
      },
      reason: input.reason,
    });
    await client.query("commit");
    return { unassigned: true, appointmentId: input.appointmentId, assignmentId: assignment.id };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function bulkUnassignReportingCases(input: {
  candidateAppointmentIds: number[];
  reason: string;
  actor: AssignmentActor;
  skipped?: Array<{ appointmentId: number; reason: string }>;
}): Promise<BulkUnassignSelectedCasesResult> {
  const client = await pool.connect();
  const unassignedAppointmentIds: number[] = [];
  const skipped = [...(input.skipped ?? [])];
  try {
    await client.query("begin");
    const lockedBookings = await client.query<{ appointmentId: number }>(
      `
        select id as "appointmentId"
        from appointments_v2.bookings
        where id = any($1::bigint[])
        for update
      `,
      [input.candidateAppointmentIds]
    );
    const lockedIds = new Set(lockedBookings.rows.map((row) => Number(row.appointmentId)));
    const activeRows = await client.query<ActiveReportingAssignment>(
      `
        select
          id,
          appointment_id as "appointmentId",
          assigned_doctor_id as "assignedDoctorId",
          roster_assignment_id as "rosterAssignmentId",
          assignment_type as "assignmentType"
        from doctor_portal.case_team_assignments
        where appointment_id = any($1::bigint[]) and assignment_type = 'reporting' and status = 'active'
        for update
      `,
      [input.candidateAppointmentIds]
    );
    const activeByAppointmentId = new Map(activeRows.rows.map((row) => {
      const assignment = activeReportingAssignment(row);
      return [assignment.appointmentId, assignment];
    }));

    for (const appointmentId of input.candidateAppointmentIds) {
      if (!lockedIds.has(appointmentId)) {
        skipped.push({ appointmentId, reason: "appointment_not_found" });
        continue;
      }
      const assignment = activeByAppointmentId.get(appointmentId);
      if (!assignment) {
        skipped.push({ appointmentId, reason: "no_active_assignment" });
        continue;
      }
      await client.query(
        `
          update doctor_portal.case_team_assignments
          set status = 'cancelled', updated_at = now()
          where id = $1
        `,
        [assignment.id]
      );
      unassignedAppointmentIds.push(appointmentId);
      await insertDoctorAuditEvent(client, {
        actorUserId: input.actor.userId,
        actorDoctorId: input.actor.doctorId,
        eventType: "reporting_board_bulk_selected_case_unassigned",
        targetType: "case_team_assignment",
        targetId: assignment.id,
        metadata: {
          appointmentId,
          previousDoctorId: assignment.assignedDoctorId,
          previousRosterAssignmentId: assignment.rosterAssignmentId,
          assignmentType: assignment.assignmentType,
        },
        reason: input.reason,
      });
    }
    const requestedCount = input.candidateAppointmentIds.length + (input.skipped?.length ?? 0);
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actor.userId,
      actorDoctorId: input.actor.doctorId,
      eventType: "reporting_board_bulk_selected_unassign_completed",
      targetType: "case_team_assignment",
      targetId: null,
      metadata: {
        requestedCount,
        unassignedCount: unassignedAppointmentIds.length,
        skipped,
      },
      reason: input.reason,
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return {
    requestedCount: input.candidateAppointmentIds.length + (input.skipped?.length ?? 0),
    unassignedCount: unassignedAppointmentIds.length,
    skippedCount: skipped.length,
    unassignedAppointmentIds,
    skipped,
  };
}

function notificationEvent(row: {
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
}): ReportingBoardNotificationEvent {
  return { ...row, id: Number(row.id) };
}

export async function readReportingBoardPushConfig(): Promise<ReportingBoardPushConfig> {
  const config = await getPatientWebPushSharedConfig();
  return {
    enabled: config.enabled,
    publicKey: config.publicKey || null,
  };
}

export async function upsertReportingBoardPushSubscription(input: {
  savedViewId: number;
  userId: UserId | null;
  doctorId: number | null;
  subscription: BrowserPushSubscriptionInput;
  userAgent?: string | null;
}): Promise<{ subscriptionId: number }> {
  const config = await readReportingBoardPushConfig();
  if (!config.enabled) {
    throw new HttpError(503, "Web Push is disabled.");
  }
  const normalized = normalizePushSubscription(input.subscription);
  const subscriptionHash = hashPushSubscription(normalized);
  const result = await pool.query<{ id: number }>(
    `
      insert into doctor_portal.reporting_board_web_push_subscriptions (
        saved_view_id,
        user_id,
        doctor_id,
        endpoint,
        p256dh,
        auth,
        subscription_hash,
        user_agent,
        enabled,
        disabled_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, true, null, now())
      on conflict (saved_view_id, subscription_hash) do update
      set user_id = excluded.user_id,
          doctor_id = excluded.doctor_id,
          endpoint = excluded.endpoint,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          enabled = true,
          disabled_at = null,
          updated_at = now()
      returning id
    `,
    [
      input.savedViewId,
      input.userId,
      input.doctorId,
      normalized.endpoint,
      normalized.p256dh,
      normalized.auth,
      subscriptionHash,
      input.userAgent ?? null,
    ]
  );
  return { subscriptionId: Number(result.rows[0].id) };
}

export async function disableReportingBoardPushSubscription(input: {
  savedViewId: number;
  subscription: BrowserPushSubscriptionInput;
}): Promise<{ disabled: boolean }> {
  const normalized = normalizePushSubscription(input.subscription);
  const result = await pool.query(
    `
      update doctor_portal.reporting_board_web_push_subscriptions
      set enabled = false, disabled_at = now(), updated_at = now()
      where saved_view_id = $1 and subscription_hash = $2
    `,
    [input.savedViewId, hashPushSubscription(normalized)]
  );
  return { disabled: (result.rowCount ?? 0) > 0 };
}

export async function getReportingBoardPushSubscriptionStatus(input: {
  savedViewId: number;
  subscription: BrowserPushSubscriptionInput;
}): Promise<{ enabled: boolean; lastSuccessAt: string | null }> {
  const normalized = normalizePushSubscription(input.subscription);
  const result = await pool.query<{ enabled: boolean; last_success_at: Date | null }>(
    `select enabled, last_success_at from doctor_portal.reporting_board_web_push_subscriptions where saved_view_id = $1 and subscription_hash = $2 limit 1`,
    [input.savedViewId, hashPushSubscription(normalized)]
  );
  const row = result.rows[0];
  return { enabled: Boolean(row?.enabled), lastSuccessAt: nullableIsoString(row?.last_success_at) };
}

function reportingCaseNotificationText(row: ReportingBoardCaseRow | null): { title: string; body: string } {
  if (!row) {
    return {
      title: "RISpro test reporting notification",
      body: "Test notification for Reporting Board saved view alerts.",
    };
  }
  return {
    title: row.caseType === "comparison" ? "RISpro comparison request update" : "RISpro reporting case update",
    body: "Open the saved reporting view to review this update.",
  };
}

interface PushSubscriptionDeliveryRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function sendSavedViewPushNotifications(notification: CreatedNotificationRow, targetSubscriptions?: PushSubscriptionDeliveryRow[]): Promise<PushDeliveryResult> {
  if (!(await reportingBoardPushVapidConfigurer())) return { attempted: 0, sent: 0, failed: 0 };
  const subscriptions = targetSubscriptions ?? (await pool.query<PushSubscriptionDeliveryRow>(
    `
      select id, endpoint, p256dh, auth
      from doctor_portal.reporting_board_web_push_subscriptions
      where saved_view_id = $1
        and enabled = true
    `,
    [notification.savedViewId]
  )).rows;
  let sent = 0;
  let failed = 0;
  for (const row of subscriptions) {
    const subscription: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    const clickUrl = notification.actionUrl?.replace(/^\/doctor\/reporting-board\/saved\//, "/reporting/worklist/")
      ?? "/doctor/reporting-board";
    try {
      await reportingBoardPushSender(subscription, JSON.stringify({
        eventType: "reporting_case_assigned_to_me",
        title: notification.title,
        body: notification.body,
        clickUrl,
      }));
      await pool.query(
        `update doctor_portal.reporting_board_web_push_subscriptions set last_success_at = now(), updated_at = now() where id = $1`,
        [row.id]
      );
      sent += 1;
    } catch {
      await pool.query(
        `update doctor_portal.reporting_board_web_push_subscriptions set last_failure_at = now(), updated_at = now() where id = $1`,
        [row.id]
      );
      failed += 1;
    }
  }
  return { attempted: subscriptions.length, sent, failed };
}

export async function sendReportingBoardSavedViewTestPush(input: {
  savedViewId: number;
  actionUrl: string;
  caseRow?: ReportingBoardCaseRow | null;
  subscription?: BrowserPushSubscriptionInput;
}): Promise<PushDeliveryResult> {
  const text = reportingCaseNotificationText(input.caseRow ?? null);
  let targetSubscriptions: PushSubscriptionDeliveryRow[] | undefined;
  if (input.subscription) {
    const normalized = normalizePushSubscription(input.subscription);
    const result = await pool.query<PushSubscriptionDeliveryRow>(
      `
        select id, endpoint, p256dh, auth
        from doctor_portal.reporting_board_web_push_subscriptions
        where saved_view_id = $1 and subscription_hash = $2 and enabled = true
        limit 1
      `,
      [input.savedViewId, hashPushSubscription(normalized)]
    );
    if (!result.rows[0]) throw new HttpError(404, "Active notification subscription not found for this saved view.");
    targetSubscriptions = result.rows;
  }
  return sendSavedViewPushNotifications({
    id: 0,
    savedViewId: input.savedViewId,
    title: text.title,
    body: text.body,
    actionUrl: input.actionUrl,
  }, targetSubscriptions);
}

export async function createAssignedToMeNotifications(input: {
  doctorId: number;
  appointmentIds?: number[];
  comparisonRequestIds?: number[];
}): Promise<number> {
  const appointmentIds = input.appointmentIds ?? [];
  const comparisonRequestIds = input.comparisonRequestIds ?? [];
  if (appointmentIds.length === 0 && comparisonRequestIds.length === 0) return 0;
  const targets = await pool.query<NotificationTargetRow>(
    `
      select
        rbsv.id as "savedViewId",
        rbsv.token,
        dp.user_id as "recipientUserId",
        dp.id as "recipientDoctorId"
      from doctor_portal.reporting_board_saved_views rbsv
      join doctor_portal.doctor_profiles dp on dp.id = coalesce(rbsv.target_doctor_id, rbsv.owner_doctor_id)
      join users u on u.id = dp.user_id
      where coalesce(rbsv.target_doctor_id, rbsv.owner_doctor_id) = $1
        and rbsv.active = true
        and dp.active = true
        and u.is_active = true
        and coalesce((rbsv.notification_settings_json->>'notifyAssignedToMe')::boolean, false) = true
    `,
    [input.doctorId]
  );
  if (targets.rows.length === 0) return 0;

  let created = 0;
  const pushNotifications: CreatedNotificationRow[] = [];
  const notificationCases: Array<{ caseType: "appointment"; id: number } | { caseType: "comparison"; id: number }> = [
    ...appointmentIds.map((id) => ({ caseType: "appointment" as const, id })),
    ...comparisonRequestIds.map((id) => ({ caseType: "comparison" as const, id })),
  ];
  for (const target of targets.rows) {
    for (const notificationCase of notificationCases) {
      const [caseRow] = notificationCase.caseType === "appointment"
        ? await listReportingBoardCaseCandidates({ appointmentId: notificationCase.id, limit: 1, offset: 0 })
        : await import("../../services/comparison-request-service.js").then((module) =>
            module.listComparisonReportingBoardRows({ comparisonRequestId: notificationCase.id, reportStatus: "all", limit: 1, offset: 0 })
          );
      const text = reportingCaseNotificationText(caseRow ?? null);
      const actionUrl = caseRow?.caseType === "comparison" && caseRow.comparisonRequestId
        ? `/comparisons/${caseRow.comparisonRequestId}`
        : `/reporting/worklist/${target.token}`;
      const dedupeKey = `reporting_case_assigned_to_me:${target.savedViewId}:${target.recipientDoctorId}:${notificationCase.caseType}:${notificationCase.id}`;
      const result = await pool.query<CreatedNotificationRow>(
        `
          insert into doctor_portal.reporting_board_notification_events (
            saved_view_id,
            recipient_user_id,
            recipient_doctor_id,
            appointment_id,
            comparison_request_id,
            event_type,
            delivery_channel,
            status,
            title,
            body,
            action_url,
            dedupe_key,
            metadata_json,
            delivered_at
          )
          values (
            $1,
            $2,
            $3,
            $4,
            $10,
            'reporting_case_assigned_to_me',
            'in_app',
            'delivered',
            $8,
            $9,
            $5,
            $6,
            $7::jsonb,
            now()
          )
          on conflict (dedupe_key) do nothing
          returning
            id,
            saved_view_id as "savedViewId",
            title,
            body,
            action_url as "actionUrl"
        `,
        [
          target.savedViewId,
          target.recipientUserId,
          target.recipientDoctorId,
          notificationCase.caseType === "appointment" ? notificationCase.id : null,
          actionUrl,
          dedupeKey,
          JSON.stringify({ notificationType: "reporting_case_assigned_to_me", caseType: notificationCase.caseType }),
          text.title,
          text.body,
          notificationCase.caseType === "comparison" ? notificationCase.id : null,
        ]
      );
      created += Number(result.rowCount ?? 0);
      if (result.rows[0]) pushNotifications.push(result.rows[0]);
    }
  }
  await Promise.all(pushNotifications.map((notification) => sendSavedViewPushNotifications(notification)));
  return created;
}

export async function listReportingBoardNotifications(userId: UserId): Promise<ReportingBoardNotificationEvent[]> {
  const result = await pool.query<ReportingBoardNotificationEvent>(
    `
      select
        id,
        event_type as "eventType",
        title,
        body,
        action_url as "actionUrl",
        status,
        created_at as "createdAt",
        delivered_at as "deliveredAt",
        read_at as "readAt",
        dismissed_at as "dismissedAt"
      from doctor_portal.reporting_board_notification_events
      where recipient_user_id = $1
        and status <> 'dismissed'
      order by created_at desc, id desc
      limit 50
    `,
    [userId]
  );
  return result.rows.map(notificationEvent);
}

export async function markReportingBoardNotificationRead(userId: UserId, id: number): Promise<ReportingBoardNotificationEvent | null> {
  const result = await pool.query<ReportingBoardNotificationEvent>(
    `
      update doctor_portal.reporting_board_notification_events
      set status = 'read', read_at = coalesce(read_at, now())
      where id = $1 and recipient_user_id = $2
      returning
        id,
        event_type as "eventType",
        title,
        body,
        action_url as "actionUrl",
        status,
        created_at as "createdAt",
        delivered_at as "deliveredAt",
        read_at as "readAt",
        dismissed_at as "dismissedAt"
    `,
    [id, userId]
  );
  return result.rows[0] ? notificationEvent(result.rows[0]) : null;
}

export async function dismissReportingBoardNotification(userId: UserId, id: number): Promise<ReportingBoardNotificationEvent | null> {
  const result = await pool.query<ReportingBoardNotificationEvent>(
    `
      update doctor_portal.reporting_board_notification_events
      set status = 'dismissed', dismissed_at = coalesce(dismissed_at, now())
      where id = $1 and recipient_user_id = $2
      returning
        id,
        event_type as "eventType",
        title,
        body,
        action_url as "actionUrl",
        status,
        created_at as "createdAt",
        delivered_at as "deliveredAt",
        read_at as "readAt",
        dismissed_at as "dismissedAt"
    `,
    [id, userId]
  );
  return result.rows[0] ? notificationEvent(result.rows[0]) : null;
}

export async function markAllReportingBoardNotificationsRead(userId: UserId): Promise<number> {
  const result = await pool.query(
    `
      update doctor_portal.reporting_board_notification_events
      set status = 'read', read_at = coalesce(read_at, now())
      where recipient_user_id = $1
        and status = 'delivered'
    `,
    [userId]
  );
  return Number(result.rowCount ?? 0);
}
