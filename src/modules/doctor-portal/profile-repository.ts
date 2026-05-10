import { pool } from "../../db/pool.js";
import type { PoolClient } from "pg";
import type { UserId } from "../../types/http.js";

export type DoctorRole = "consultant" | "specialist" | "senior_house_officer" | "resident";

export interface DoctorProfileRow {
  id: number;
  userId: number;
  username: string | null;
  displayName: string;
  doctorRole: DoctorRole;
  active: boolean;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DoctorModalityPermissionRow {
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

export interface CreateDoctorProfileInput {
  userId: number;
  displayName: string;
  doctorRole: DoctorRole;
  active: boolean;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
}

type Db = Pick<PoolClient, "query"> | typeof pool;

const PROFILE_SELECT = `
  select
    dp.id,
    dp.user_id as "userId",
    u.username,
    dp.display_name as "displayName",
    dp.doctor_role as "doctorRole",
    dp.active,
    dp.can_finalize_reports as "canFinalizeReports",
    dp.can_assign_protocols as "canAssignProtocols",
    dp.can_supervise as "canSupervise",
    dp.created_at as "createdAt",
    dp.updated_at as "updatedAt"
  from doctor_portal.doctor_profiles dp
  left join users u on u.id = dp.user_id
`;

export async function findActiveDoctorProfileByUserId(userId: UserId): Promise<DoctorProfileRow | null> {
  const result = await pool.query<DoctorProfileRow>(
    `
      ${PROFILE_SELECT}
      where dp.user_id = $1
        and dp.active = true
      limit 1
    `,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function listDoctorProfiles(): Promise<DoctorProfileRow[]> {
  const result = await pool.query<DoctorProfileRow>(`
    ${PROFILE_SELECT}
    order by dp.active desc, dp.display_name asc, dp.id asc
  `);
  return result.rows;
}

export async function createDoctorProfile(
  input: CreateDoctorProfileInput,
  actorUserId: UserId
): Promise<DoctorProfileRow> {
  const result = await pool.query<DoctorProfileRow>(
    `
      insert into doctor_portal.doctor_profiles (
        user_id,
        display_name,
        doctor_role,
        active,
        can_finalize_reports,
        can_assign_protocols,
        can_supervise
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      returning
        id,
        user_id as "userId",
        null::text as username,
        display_name as "displayName",
        doctor_role as "doctorRole",
        active,
        can_finalize_reports as "canFinalizeReports",
        can_assign_protocols as "canAssignProtocols",
        can_supervise as "canSupervise",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      input.userId,
      input.displayName,
      input.doctorRole,
      input.active,
      input.canFinalizeReports,
      input.canAssignProtocols,
      input.canSupervise,
    ]
  );

  const profile = result.rows[0];
  await insertDoctorAuditEvent(pool, {
    actorUserId,
    actorDoctorId: null,
    eventType: "doctor_profile_created",
    targetType: "doctor_profile",
    targetId: profile.id,
    metadata: { userId: profile.userId, doctorRole: profile.doctorRole, active: profile.active },
    reason: null,
  });
  return profile;
}

export async function listDoctorModalityPermissions(doctorId: number): Promise<DoctorModalityPermissionRow[]> {
  const result = await pool.query<DoctorModalityPermissionRow>(
    `
      select
        dmp.id,
        dmp.doctor_id as "doctorId",
        dmp.modality_id as "modalityId",
        m.code as "modalityCode",
        m.name_en as "modalityNameEn",
        m.name_ar as "modalityNameAr",
        dmp.can_protocol as "canProtocol",
        dmp.can_report as "canReport",
        dmp.can_supervise as "canSupervise",
        dmp.active
      from doctor_portal.doctor_modality_permissions dmp
      join modalities m on m.id = dmp.modality_id
      where dmp.doctor_id = $1
        and dmp.active = true
      order by m.name_en asc, dmp.id asc
    `,
    [doctorId]
  );
  return result.rows;
}

export async function insertDoctorAuditEvent(
  db: Db,
  input: {
    actorUserId: UserId | null;
    actorDoctorId: number | null;
    eventType: string;
    targetType: string;
    targetId: number | null;
    metadata: Record<string, unknown>;
    reason: string | null;
  }
): Promise<void> {
  await db.query(
    `
      insert into doctor_portal.doctor_module_audit_events (
        actor_user_id,
        actor_doctor_id,
        event_type,
        target_type,
        target_id,
        metadata_json,
        reason
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7)
    `,
    [
      input.actorUserId,
      input.actorDoctorId,
      input.eventType,
      input.targetType,
      input.targetId,
      JSON.stringify(input.metadata),
      input.reason,
    ]
  );
}
