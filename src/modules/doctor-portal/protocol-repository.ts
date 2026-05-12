import { pool } from "../../db/pool.js";
import type { PoolClient } from "pg";
import type {
  AppointmentProtocolRow,
  ProtocolAuditEventType,
  ProtocolAuditTimelineEvent,
  ProtocolDetails,
  ProtocolInput,
  ProtocolStatus,
  ProtocolTaskRow,
} from "./protocol-types.js";

type Db = Pick<PoolClient, "query"> | typeof pool;

const PROTOCOL_SELECT = `
  select
    ap.id,
    ap.appointment_id as "appointmentId",
    ap.protocol_text as "protocolText",
    ap.contrast_required as "contrastRequired",
    ap.contrast_phase_or_protocol as "contrastPhaseOrProtocol",
    ap.special_preparation as "specialPreparation",
    ap.technologist_notes as "technologistNotes",
    ap.protocol_status as "protocolStatus",
    ap.assigned_by_doctor_id as "assignedByDoctorId",
    assigned.display_name as "assignedByDoctorName",
    ap.assigned_at as "assignedAt",
    ap.updated_by_doctor_id as "updatedByDoctorId",
    updated.display_name as "updatedByDoctorName",
    ap.updated_at as "updatedAt",
    ap.version,
    ap.created_at as "createdAt"
  from doctor_portal.appointment_protocols ap
  left join doctor_portal.doctor_profiles assigned on assigned.id = ap.assigned_by_doctor_id
  left join doctor_portal.doctor_profiles updated on updated.id = ap.updated_by_doctor_id
`;

const TASK_SELECT = `
  select
    b.id as "appointmentId",
    b.patient_id as "patientId",
    p.mrn as "patientMrn",
    p.national_id as "patientNationalId",
    p.arabic_full_name as "patientArabicName",
    p.english_full_name as "patientEnglishName",
    p.age_years as "ageYears",
    p.sex,
    b.booking_date::text as "appointmentDate",
    b.booking_time::text as "appointmentTime",
    b.modality_id as "modalityId",
    m.code as "modalityCode",
    m.name_en as "modalityName",
    b.exam_type_id as "examTypeId",
    et.name_en as "examTypeName",
    b.case_category as "caseCategory",
    b.requires_report as "requiresReport",
    b.notes as "clinicalIndication",
    b.status as "appointmentStatus",
    cta.roster_assignment_id as "rosterAssignmentId",
    dra.team_name as "teamName",
    ap.protocol_status as "protocolStatus",
    assigned.display_name as "assignedByDoctorName",
    ap.updated_at as "updatedAt"
  from appointments_v2.bookings b
  join patients p on p.id = b.patient_id
  join modalities m on m.id = b.modality_id
  left join exam_types et on et.id = b.exam_type_id
  left join doctor_portal.case_team_assignments cta on cta.appointment_id = b.id and cta.status = 'active'
  left join doctor_portal.doctor_roster_assignments dra on dra.id = cta.roster_assignment_id
  left join doctor_portal.appointment_protocols ap on ap.appointment_id = b.id
  left join doctor_portal.doctor_profiles assigned on assigned.id = ap.assigned_by_doctor_id
`;

function taskFilters(params: { dateFrom: string; dateTo: string; modalityId?: number | null; protocolStatus?: string | null; unprotocolledOnly?: boolean; requiresReport?: boolean | null; caseCategory?: string | null }) {
  const values: unknown[] = [params.dateFrom, params.dateTo];
  const where = ["b.booking_date >= $1::date", "b.booking_date <= $2::date", "b.status not in ('cancelled', 'discontinued', 'voided')"];
  if (params.modalityId) {
    values.push(params.modalityId);
    where.push(`b.modality_id = $${values.length}`);
  }
  if (params.protocolStatus) {
    values.push(params.protocolStatus);
    where.push(`coalesce(ap.protocol_status, 'unprotocolled') = $${values.length}`);
  }
  if (params.unprotocolledOnly) {
    where.push("ap.id is null");
  }
  if (params.requiresReport !== null && params.requiresReport !== undefined) {
    values.push(params.requiresReport);
    where.push(`b.requires_report = $${values.length}`);
  }
  if (params.caseCategory) {
    values.push(params.caseCategory);
    where.push(`b.case_category = $${values.length}`);
  }
  return { values, where };
}

export async function listProtocolTasks(
  doctorId: number,
  isManager: boolean,
  params: { dateFrom: string; dateTo: string; modalityId?: number | null; protocolStatus?: string | null; unprotocolledOnly?: boolean; requiresReport?: boolean | null; caseCategory?: string | null }
): Promise<ProtocolTaskRow[]> {
  const scoped = taskFilters(params);
  if (!isManager) {
    scoped.values.push(doctorId);
    scoped.where.push(`
      exists (
        select 1
        from doctor_portal.doctor_roster_members drm
        where drm.roster_assignment_id = cta.roster_assignment_id
          and drm.doctor_id = $${scoped.values.length}
      )
    `);
  }
  const result = await pool.query<ProtocolTaskRow>(
    `${TASK_SELECT} where ${scoped.where.join(" and ")} order by b.booking_date asc, b.booking_time asc nulls first, b.id asc limit 500`,
    scoped.values
  );
  return result.rows;
}

export async function getProtocolDetails(appointmentId: number): Promise<ProtocolDetails | null> {
  const appointment = await pool.query<ProtocolTaskRow>(`${TASK_SELECT} where b.id = $1 limit 1`, [appointmentId]);
  const task = appointment.rows[0];
  if (!task) return null;
  return { appointment: task, protocol: await findProtocolByAppointmentId(pool, appointmentId) };
}

export async function appointmentHasDoctorRosterMembership(appointmentId: number, doctorId: number): Promise<boolean> {
  const result = await pool.query(
    `
      select 1
      from doctor_portal.case_team_assignments cta
      join doctor_portal.doctor_roster_members drm on drm.roster_assignment_id = cta.roster_assignment_id
      where cta.appointment_id = $1
        and cta.status = 'active'
        and drm.doctor_id = $2
      limit 1
    `,
    [appointmentId, doctorId]
  );
  return Boolean(result.rows[0]);
}

export async function findProtocolByAppointmentId(db: Db, appointmentId: number): Promise<AppointmentProtocolRow | null> {
  const result = await db.query<AppointmentProtocolRow>(`${PROTOCOL_SELECT} where ap.appointment_id = $1 limit 1`, [appointmentId]);
  return result.rows[0] ?? null;
}

export async function createProtocol(
  input: ProtocolInput & { appointmentId: number; doctorId: number; status: ProtocolStatus; reason?: string | null }
): Promise<AppointmentProtocolRow> {
  const result = await pool.query<AppointmentProtocolRow>(
    `
      insert into doctor_portal.appointment_protocols (
        appointment_id,
        protocol_text,
        contrast_required,
        contrast_phase_or_protocol,
        special_preparation,
        technologist_notes,
        protocol_status,
        assigned_by_doctor_id,
        assigned_at,
        updated_by_doctor_id,
        version
      )
      values ($1, $2, $3, $4, $5, $6, $7::text, case when $7::text = 'assigned' then $8::bigint else null::bigint end, case when $7::text = 'assigned' then now() else null end, $8::bigint, 1)
      returning
        id, appointment_id as "appointmentId", protocol_text as "protocolText", contrast_required as "contrastRequired",
        contrast_phase_or_protocol as "contrastPhaseOrProtocol", special_preparation as "specialPreparation",
        technologist_notes as "technologistNotes", protocol_status as "protocolStatus",
        assigned_by_doctor_id as "assignedByDoctorId", null::text as "assignedByDoctorName", assigned_at as "assignedAt",
        updated_by_doctor_id as "updatedByDoctorId", null::text as "updatedByDoctorName", updated_at as "updatedAt",
        version, created_at as "createdAt"
    `,
    [
      input.appointmentId,
      input.protocolText,
      input.contrastRequired,
      input.contrastPhaseOrProtocol,
      input.specialPreparation,
      input.technologistNotes,
      input.status,
      input.doctorId,
    ]
  );
  const protocol = result.rows[0];
  const eventType: ProtocolAuditEventType =
    protocol.protocolStatus === "assigned"
      ? "protocol_assigned"
      : protocol.protocolStatus === "clarification_needed"
        ? "clarification_requested"
        : protocol.protocolStatus === "cancelled"
          ? "protocol_cancelled"
          : "protocol_created";
  await insertProtocolAudit(pool, {
    protocolId: protocol.id,
    appointmentId: protocol.appointmentId,
    doctorId: input.doctorId,
    eventType,
    oldValue: null,
    newValue: protocol,
    reason: input.reason ?? null,
  });
  return protocol;
}

export async function updateProtocol(
  appointmentId: number,
  input: ProtocolInput & { doctorId: number; status?: ProtocolStatus; reason?: string | null; eventType?: ProtocolAuditEventType }
): Promise<AppointmentProtocolRow | null> {
  const existing = await findProtocolByAppointmentId(pool, appointmentId);
  if (!existing) return null;
  const nextStatus = input.status ?? input.protocolStatus ?? existing.protocolStatus;
  const result = await pool.query<AppointmentProtocolRow>(
    `
      update doctor_portal.appointment_protocols
      set protocol_text = $2,
          contrast_required = $3,
          contrast_phase_or_protocol = $4,
          special_preparation = $5,
          technologist_notes = $6,
          protocol_status = $7::text,
          assigned_by_doctor_id = case when $7::text = 'assigned' and assigned_by_doctor_id is null then $8::bigint else assigned_by_doctor_id end,
          assigned_at = case when $7::text = 'assigned' and assigned_at is null then now() else assigned_at end,
          updated_by_doctor_id = $8::bigint,
          updated_at = now(),
          version = version + 1
      where appointment_id = $1
      returning
        id, appointment_id as "appointmentId", protocol_text as "protocolText", contrast_required as "contrastRequired",
        contrast_phase_or_protocol as "contrastPhaseOrProtocol", special_preparation as "specialPreparation",
        technologist_notes as "technologistNotes", protocol_status as "protocolStatus",
        assigned_by_doctor_id as "assignedByDoctorId", null::text as "assignedByDoctorName", assigned_at as "assignedAt",
        updated_by_doctor_id as "updatedByDoctorId", null::text as "updatedByDoctorName", updated_at as "updatedAt",
        version, created_at as "createdAt"
    `,
    [
      appointmentId,
      input.protocolText,
      input.contrastRequired,
      input.contrastPhaseOrProtocol,
      input.specialPreparation,
      input.technologistNotes,
      nextStatus,
      input.doctorId,
    ]
  );
  const updated = result.rows[0];
  await insertProtocolAudit(pool, {
    protocolId: updated.id,
    appointmentId,
    doctorId: input.doctorId,
    eventType: input.eventType ?? (nextStatus === "assigned" ? "protocol_assigned" : "protocol_updated"),
    oldValue: existing,
    newValue: updated,
    reason: input.reason ?? null,
  });
  return updated;
}

export async function insertProtocolAudit(
  db: Db,
  input: {
    protocolId: number;
    appointmentId: number;
    doctorId: number;
    eventType: ProtocolAuditEventType;
    oldValue: unknown;
    newValue: unknown;
    reason: string | null;
  }
) {
  await db.query(
    `
      insert into doctor_portal.appointment_protocol_audit_events (
        appointment_protocol_id,
        appointment_id,
        changed_by_doctor_id,
        event_type,
        old_value_json,
        new_value_json,
        reason
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
    `,
    [
      input.protocolId,
      input.appointmentId,
      input.doctorId,
      input.eventType,
      input.oldValue == null ? null : JSON.stringify(input.oldValue),
      input.newValue == null ? null : JSON.stringify(input.newValue),
      input.reason,
    ]
  );
}

function protocolSummary(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<AppointmentProtocolRow>;
  const parts = [
    record.protocolStatus ? `status ${record.protocolStatus}` : null,
    typeof record.version === "number" ? `version ${record.version}` : null,
    record.contrastRequired === true ? "contrast required" : record.contrastRequired === false ? "no contrast" : null,
    record.protocolText ? "protocol text present" : null,
    record.technologistNotes ? "technologist notes present" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export async function listProtocolAuditEvents(appointmentId: number): Promise<ProtocolAuditTimelineEvent[]> {
  const result = await pool.query<{
    eventType: ProtocolAuditEventType;
    changedByDoctorId: number | null;
    changedByDoctorName: string | null;
    createdAt: string;
    reason: string | null;
    oldValueJson: unknown;
    newValueJson: unknown;
    version: number | null;
    protocolStatus: ProtocolStatus | null;
  }>(
    `
      select
        pae.event_type as "eventType",
        pae.changed_by_doctor_id as "changedByDoctorId",
        dp.display_name as "changedByDoctorName",
        pae.created_at as "createdAt",
        pae.reason,
        pae.old_value_json as "oldValueJson",
        pae.new_value_json as "newValueJson",
        nullif(pae.new_value_json->>'version', '')::int as "version",
        pae.new_value_json->>'protocolStatus' as "protocolStatus"
      from doctor_portal.appointment_protocol_audit_events pae
      left join doctor_portal.doctor_profiles dp on dp.id = pae.changed_by_doctor_id
      where pae.appointment_id = $1
      order by pae.created_at asc, pae.id asc
    `,
    [appointmentId]
  );
  return result.rows.map((row) => ({
    eventType: row.eventType,
    changedByDoctorId: row.changedByDoctorId,
    changedByDoctorName: row.changedByDoctorName,
    createdAt: row.createdAt,
    reason: row.reason,
    oldSummary: protocolSummary(row.oldValueJson),
    newSummary: protocolSummary(row.newValueJson),
    version: row.version,
    protocolStatus: row.protocolStatus,
  }));
}
