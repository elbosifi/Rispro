import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import webPush, { type PushSubscription } from "web-push";
import { pool } from "../../db/pool.js";
import type { UserId } from "../../types/http.js";
import { HttpError } from "../../utils/http-error.js";
import { configurePatientWebPushVapid, getPatientWebPushSharedConfig } from "../../services/patient-web-push-service.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import type {
  BrowserPushSubscriptionInput,
  BulkAssignNextCasesResult,
  ReportingBoardCaseRow,
  ReportingBoardFilters,
  ReportingBoardNotificationSettings,
  ReportingBoardNotificationEvent,
  ReportingBoardPushConfig,
  ReportingBoardSavedView,
  ReportingBoardSettings,
} from "./reporting-board-types.js";

const SETTINGS_CATEGORY = "doctor_portal_reporting_board";
const SETTINGS_KEY = "config";

export const DEFAULT_REPORTING_BOARD_SETTINGS: ReportingBoardSettings = {
  cutoffMode: "days_back",
  defaultCutoffDate: null,
  daysBack: 14,
  enabledModalityCodes: ["CT", "MR"],
  defaultRequiresReport: true,
  defaultReportStatusFilter: "required_not_final",
};

interface AssignmentActor {
  userId: UserId;
  doctorId: number | null;
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

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
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
  const daysBack = Number.isInteger(record.daysBack) && Number(record.daysBack) >= 0 ? Number(record.daysBack) : 14;
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
  createdAt: string;
  updatedAt: string;
}): ReportingBoardSavedView {
  return {
    ...row,
    filters: cleanRecord(row.filters) as ReportingBoardFilters,
    notificationSettings: cleanRecord(row.notificationSettings) as ReportingBoardNotificationSettings,
  };
}

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

export async function listSavedViews(ownerUserId: UserId, ownerDoctorId: number | null): Promise<ReportingBoardSavedView[]> {
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
        created_at as "createdAt",
        updated_at as "updatedAt"
      from doctor_portal.reporting_board_saved_views
      where owner_user_id = $1
        and ($2::bigint is null or owner_doctor_id = $2)
        and active = true
      order by created_at desc, id desc
    `,
    [ownerUserId, ownerDoctorId]
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
        owner_user_id, owner_doctor_id, name, token, filters_json, notification_settings_json, created_by_user_id, updated_by_user_id
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $1, $1)
      returning
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
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
}): Promise<ReportingBoardSavedView | null> {
  const result = await pool.query(
    `
      update doctor_portal.reporting_board_saved_views
      set
        name = coalesce($4, name),
        filters_json = coalesce($5::jsonb, filters_json),
        notification_settings_json = coalesce($6::jsonb, notification_settings_json),
        active = coalesce($7, active),
        updated_by_user_id = $2,
        updated_at = now()
      where id = $1
        and owner_user_id = $2
        and ($3::bigint is null or owner_doctor_id = $3)
      returning
        id,
        owner_user_id as "ownerUserId",
        owner_doctor_id as "ownerDoctorId",
        name,
        token,
        filters_json as filters,
        notification_settings_json as "notificationSettings",
        active,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      input.id,
      input.ownerUserId,
      input.ownerDoctorId,
      input.name ?? null,
      input.filters ? JSON.stringify(input.filters) : null,
      input.notificationSettings ? JSON.stringify(input.notificationSettings) : null,
      input.active ?? null,
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
        created_at as "createdAt",
        updated_at as "updatedAt"
      from doctor_portal.reporting_board_saved_views
      where token = $1 and active = true
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
        created_at as "createdAt",
        updated_at as "updatedAt"
      from doctor_portal.reporting_board_saved_views
      where id = $1 and owner_user_id = $2 and active = true
      limit 1
    `,
    [id, ownerUserId]
  );
  return result.rows[0] ? savedView(result.rows[0]) : null;
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
  return where;
}

export async function listReportingBoardCaseCandidates(
  filters: Required<Pick<ReportingBoardFilters, "limit" | "offset">> & ReportingBoardFilters,
  options: CaseQueryOptions = {}
): Promise<ReportingBoardCaseRow[]> {
  const db = options.db ?? pool;
  const values: unknown[] = [];
  const where = addCaseFilters(filters, values);
  const limit = options.limitOverride ?? filters.limit ?? 50;
  const offset = options.offsetOverride ?? filters.offset ?? 0;
  values.push(limit);
  const limitParam = values.length;
  values.push(offset);
  const offsetParam = values.length;

  const result = await db.query<ReportingBoardCaseRow>(
    `
      select
        b.id as "appointmentId",
        b.patient_id as "patientId",
        p.mrn as "patientMrn",
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
        'unavailable'::text as "reportStatus",
        null::text as "reportStatusCheckedAt",
        (b.requires_report = true and b.status = 'completed') as "canAssign",
        case
          when b.requires_report = false then 'report_not_required'
          when b.status <> 'completed' then 'study_not_completed'
          else null
        end as "exclusionReason"
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      left join reporting_priorities rp on rp.id = b.reporting_priority_id
      left join doctor_portal.case_team_assignments cta on cta.appointment_id = b.id and cta.assignment_type = 'reporting' and cta.status = 'active'
      left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cta.assigned_doctor_id
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      order by rp.sort_order asc nulls last, b.booking_date asc, b.booking_time asc nulls first, b.id asc
      limit $${limitParam} offset $${offsetParam}
      ${options.forUpdate ? "for update of b skip locked" : ""}
    `,
    values
  );
  return result.rows.map((row) => ({
    ...row,
    appointmentId: Number(row.appointmentId),
    patientId: Number(row.patientId),
    modalityId: Number(row.modalityId),
    examTypeId: nullableNumber(row.examTypeId),
    reportingPriorityId: nullableNumber(row.reportingPriorityId),
    reportingPrioritySortOrder: nullableNumber(row.reportingPrioritySortOrder),
    assignedDoctorId: nullableNumber(row.assignedDoctorId),
  }));
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

export async function bulkAssignReportingCases(input: {
  doctorId: number;
  candidateAppointmentIds: number[];
  reason: string | null;
  unassignedOnly: boolean;
  actor: AssignmentActor;
}): Promise<BulkAssignNextCasesResult> {
  const client = await pool.connect();
  const assignedAppointmentIds: number[] = [];
  const skipped: Array<{ appointmentId: number; reason: string }> = [];
  try {
    await client.query("begin");
    const locked = await client.query<CandidateAssignment>(
      `
        select b.id as "appointmentId", cta.id
        from appointments_v2.bookings b
        left join doctor_portal.case_team_assignments cta
          on cta.appointment_id = b.id and cta.assignment_type = 'reporting' and cta.status = 'active'
        where b.id = any($1::bigint[])
        for update of b
      `,
      [input.candidateAppointmentIds]
    );
    const lockedIds = new Set(locked.rows.map((row) => Number(row.appointmentId)));
    const existingActiveIds = new Set(locked.rows.filter((row) => row.id !== null).map((row) => Number(row.appointmentId)));
    for (const appointmentId of input.candidateAppointmentIds) {
      if (!lockedIds.has(appointmentId)) {
        skipped.push({ appointmentId, reason: "appointment_not_found" });
        continue;
      }
      if (input.unassignedOnly && existingActiveIds.has(appointmentId)) {
        skipped.push({ appointmentId, reason: "already_assigned" });
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
        eventType: "reporting_board_bulk_case_assigned",
        targetType: "case_team_assignment",
        targetId: assignmentId,
        metadata: { appointmentId, doctorId: input.doctorId, noteForDoctor: input.reason },
        reason: input.reason,
      });
    }
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actor.userId,
      actorDoctorId: input.actor.doctorId,
      eventType: "reporting_board_bulk_assign_completed",
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
  userId: UserId;
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

async function sendSavedViewPushNotifications(notification: CreatedNotificationRow): Promise<void> {
  if (!(await configurePatientWebPushVapid())) return;
  const subscriptions = await pool.query<{
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `
      select id, endpoint, p256dh, auth
      from doctor_portal.reporting_board_web_push_subscriptions
      where saved_view_id = $1
        and enabled = true
    `,
    [notification.savedViewId]
  );
  for (const row of subscriptions.rows) {
    const subscription: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try {
      await webPush.sendNotification(subscription, JSON.stringify({
        eventType: "reporting_case_assigned_to_me",
        title: notification.title,
        body: notification.body,
        clickUrl: notification.actionUrl ?? "/doctor/reporting-board",
      }));
      await pool.query(
        `update doctor_portal.reporting_board_web_push_subscriptions set last_success_at = now(), updated_at = now() where id = $1`,
        [row.id]
      );
    } catch {
      await pool.query(
        `update doctor_portal.reporting_board_web_push_subscriptions set last_failure_at = now(), updated_at = now() where id = $1`,
        [row.id]
      );
    }
  }
}

export async function createAssignedToMeNotifications(input: {
  doctorId: number;
  appointmentIds: number[];
}): Promise<number> {
  if (input.appointmentIds.length === 0) return 0;
  const targets = await pool.query<NotificationTargetRow>(
    `
      select
        rbsv.id as "savedViewId",
        rbsv.token,
        dp.user_id as "recipientUserId",
        dp.id as "recipientDoctorId"
      from doctor_portal.reporting_board_saved_views rbsv
      join doctor_portal.doctor_profiles dp on dp.id = rbsv.owner_doctor_id
      join users u on u.id = dp.user_id
      where rbsv.owner_doctor_id = $1
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
  for (const target of targets.rows) {
    for (const appointmentId of input.appointmentIds) {
      const dedupeKey = `reporting_case_assigned_to_me:${target.savedViewId}:${target.recipientDoctorId}:${appointmentId}`;
      const result = await pool.query<CreatedNotificationRow>(
        `
          insert into doctor_portal.reporting_board_notification_events (
            saved_view_id,
            recipient_user_id,
            recipient_doctor_id,
            appointment_id,
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
            'reporting_case_assigned_to_me',
            'in_app',
            'delivered',
            'New reporting case assigned',
            'A reporting case has been assigned to you. Open RISpro to review your reporting board.',
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
          appointmentId,
          `/doctor/reporting-board/saved/${target.token}`,
          dedupeKey,
          JSON.stringify({ notificationType: "reporting_case_assigned_to_me" }),
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
