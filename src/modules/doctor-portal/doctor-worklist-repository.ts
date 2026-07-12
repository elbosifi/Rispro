import { randomBytes } from "node:crypto";
import { pool } from "../../db/pool.js";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import type { DoctorReportingWorklistSummary, ReportingBoardSavedView } from "./reporting-board-types.js";

type WorklistBaseRow = ReportingBoardSavedView & Omit<DoctorReportingWorklistSummary,
  keyof ReportingBoardSavedView | "effectiveModalityCodes" | "assignedPendingCount" | "eligibleUnassignedCount" | "scopeMessage">;

const WORKLIST_SELECT = `
  select
    sv.id,
    sv.owner_user_id as "ownerUserId",
    sv.owner_doctor_id as "ownerDoctorId",
    sv.name,
    sv.token,
    sv.filters_json as filters,
    sv.notification_settings_json as "notificationSettings",
    sv.active,
    sv.last_accessed_at as "lastAccessedAt",
    sv.expires_at as "expiresAt",
    sv.revoked_at as "revokedAt",
    sv.access_mode as "accessMode",
    sv.link_kind as "linkKind",
    sv.system_managed as "systemManaged",
    sv.target_doctor_id as "targetDoctorId",
    sv.admin_disabled_at as "adminDisabledAt",
    sv.created_at as "createdAt",
    sv.updated_at as "updatedAt",
    dp.display_name as "doctorDisplayName",
    u.username,
    dp.doctor_role as "doctorRole",
    u.is_active as "userActive",
    dp.active as "doctorActive",
    count(distinct ps.id) filter (where ps.enabled = true)::int as "subscriptionCount"
  from doctor_portal.reporting_board_saved_views sv
  join doctor_portal.doctor_profiles dp on dp.id = sv.target_doctor_id
  join users u on u.id = dp.user_id
  left join doctor_portal.reporting_board_web_push_subscriptions ps on ps.saved_view_id = sv.id
`;

function normalize(row: WorklistBaseRow): WorklistBaseRow {
  return {
    ...row,
    id: Number(row.id),
    ownerUserId: row.ownerUserId === null ? null : Number(row.ownerUserId),
    ownerDoctorId: row.ownerDoctorId === null ? null : Number(row.ownerDoctorId),
    targetDoctorId: row.targetDoctorId === null ? null : Number(row.targetDoctorId),
    filters: row.filters ?? {},
    notificationSettings: row.notificationSettings ?? {},
    accessMode: "public_readonly",
    linkKind: "doctor_worklist",
    systemManaged: true,
    lastAccessedAt: row.lastAccessedAt ? new Date(row.lastAccessedAt).toISOString() : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    adminDisabledAt: row.adminDisabledAt ? new Date(row.adminDisabledAt).toISOString() : null,
    subscriptionCount: Number(row.subscriptionCount ?? 0),
  };
}

const GROUP_BY = `
  group by sv.id, dp.id, u.id
`;

export async function listDoctorWorklistBaseRows(): Promise<WorklistBaseRow[]> {
  const result = await pool.query<WorklistBaseRow>(`
    ${WORKLIST_SELECT}
    where sv.link_kind = 'doctor_worklist' and sv.system_managed = true
    ${GROUP_BY}
    order by dp.active desc, dp.display_name asc, dp.id asc
  `);
  return result.rows.map(normalize);
}

export async function findDoctorWorklistByDoctorId(doctorId: number): Promise<WorklistBaseRow | null> {
  const result = await pool.query<WorklistBaseRow>(`
    ${WORKLIST_SELECT}
    where sv.link_kind = 'doctor_worklist'
      and sv.system_managed = true
      and sv.target_doctor_id = $1
    ${GROUP_BY}
    limit 1
  `, [doctorId]);
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

export async function findDoctorWorklistById(id: number): Promise<WorklistBaseRow | null> {
  const result = await pool.query<WorklistBaseRow>(`
    ${WORKLIST_SELECT}
    where sv.link_kind = 'doctor_worklist'
      and sv.system_managed = true
      and sv.id = $1
    ${GROUP_BY}
    limit 1
  `, [id]);
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

export async function listEffectiveDoctorModalityCodes(doctorId: number, globallyEnabled: string[]): Promise<string[]> {
  if (globallyEnabled.length === 0) return [];
  const result = await pool.query<{ code: string }>(
    `
      select distinct upper(m.code) as code
      from doctor_portal.doctor_modality_permissions dmp
      join modalities m on m.id = dmp.modality_id
      where dmp.doctor_id = $1
        and dmp.active = true
        and dmp.can_report = true
        and upper(m.code) = any($2::text[])
      order by code
    `,
    [doctorId, globallyEnabled.map((code) => code.toUpperCase())]
  );
  return result.rows.map((row) => row.code);
}

export async function updateDoctorWorklistLifecycle(input: {
  id: number;
  actorUserId: UserId;
  active?: boolean;
  expiresAt?: string | null;
  rotate?: boolean;
}): Promise<void> {
  await pool.query(
    `
      update doctor_portal.reporting_board_saved_views
      set
        token = case when $4 then $5 else token end,
        active = case when $3::boolean is null then active else $3 end,
        admin_disabled_at = case
          when $3::boolean = false then now()
          when $3::boolean = true then null
          else admin_disabled_at
        end,
        expires_at = case when $6 then $7::timestamptz else expires_at end,
        revoked_at = case when $3::boolean = true then null else revoked_at end,
        updated_by_user_id = $2,
        updated_at = now()
      where id = $1 and link_kind = 'doctor_worklist' and system_managed = true
    `,
    [input.id, input.actorUserId, input.active ?? null, Boolean(input.rotate), randomBytes(32).toString("base64url"), input.expiresAt !== undefined, input.expiresAt ?? null]
  );
}

export async function claimAppointmentToDoctor(input: {
  appointmentId: number;
  doctorId: number;
  actorUserId: UserId;
  allowedModalityCodes: string[];
  reason?: string | null;
}): Promise<{ assignmentId: number } | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{ id: number }>(
      `
        insert into doctor_portal.case_team_assignments (
          appointment_id, assigned_doctor_id, modality_id, assignment_type, expected_reporting_date, status
        )
        select b.id, $2, b.modality_id, 'reporting', b.booking_date, 'active'
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        where b.id = $1
          and b.status = 'completed'
          and b.requires_report = true
          and upper(m.code) = any($4::text[])
          and not exists (
            select 1 from doctor_portal.reporting_board_manual_final_overrides mf
            where mf.appointment_id = b.id and mf.cleared_at is null
          )
        on conflict (appointment_id, assignment_type) where status = 'active'
        do nothing
        returning id
      `,
      [input.appointmentId, input.doctorId, input.actorUserId, input.allowedModalityCodes]
    );
    const assignmentId = Number(inserted.rows[0]?.id ?? 0);
    if (!assignmentId) {
      await client.query("rollback");
      return null;
    }
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actorUserId,
      actorDoctorId: input.doctorId,
      eventType: "doctor_worklist_case_claimed",
      targetType: "case_team_assignment",
      targetId: assignmentId,
      metadata: { appointmentId: input.appointmentId, doctorId: input.doctorId },
      reason: input.reason ?? "doctor worklist claim to self",
    });
    await client.query("commit");
    return { assignmentId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimComparisonToDoctor(input: {
  comparisonRequestId: number;
  doctorId: number;
  actorUserId: UserId;
  allowedModalityCodes: string[];
  reason?: string | null;
}): Promise<{ assignmentId: number; comparisonRequestId: number } | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await client.query<{ modality_id: number; modality_code: string }>(
      `
        select cr.linked_modality_id as modality_id, upper(cr.linked_modality_code) as modality_code
        from comparison_requests cr
        where cr.id = $1 and cr.status = 'ready_for_reporting'
        for update
      `,
      [input.comparisonRequestId]
    );
    const row = request.rows[0];
    if (!row || !row.modality_id || !input.allowedModalityCodes.includes(row.modality_code)) {
      await client.query("rollback");
      return null;
    }
    const inserted = await client.query<{ id: number }>(
      `
        insert into doctor_portal.comparison_case_assignments (
          comparison_request_id, assigned_doctor_id, modality_id, assigned_by_user_id, assigned_by_doctor_id, reason
        )
        values ($1, $2, $3, $4, $2, $5)
        on conflict (comparison_request_id) where status = 'active'
        do nothing
        returning id
      `,
      [input.comparisonRequestId, input.doctorId, row.modality_id, input.actorUserId, input.reason ?? "doctor worklist claim to self"]
    );
    const assignmentId = Number(inserted.rows[0]?.id ?? 0);
    if (!assignmentId) {
      await client.query("rollback");
      return null;
    }
    await client.query(
      `update comparison_requests set status = 'assigned', assigned_doctor_id = $2, updated_at = now() where id = $1`,
      [input.comparisonRequestId, input.doctorId]
    );
    await insertDoctorAuditEvent(client, {
      actorUserId: input.actorUserId,
      actorDoctorId: input.doctorId,
      eventType: "doctor_worklist_comparison_claimed",
      targetType: "comparison_request",
      targetId: input.comparisonRequestId,
      metadata: { assignmentId, doctorId: input.doctorId },
      reason: input.reason ?? "doctor worklist claim to self",
    });
    await client.query("commit");
    return { assignmentId, comparisonRequestId: input.comparisonRequestId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
