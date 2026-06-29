import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";
import type {
  DoctorProtocolingAppointmentDetail,
  DoctorProtocolingAppointmentRow,
  ProtocolAssignmentDetail,
  ProtocolAssignmentInput,
  ProtocolAssignmentStatus,
  ProtocolAssignmentSummary,
  ProtocolingCtPhaseRow,
  ProtocolingFilters,
  ProtocolingMriSequenceRow,
  ProtocolingModality,
} from "./protocoling-types.js";

type RawRecord = Record<string, unknown>;

function stringOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function mapAssignment(row: RawRecord): ProtocolAssignmentSummary | null {
  if (row.assignment_id == null) return null;
  return {
    assignmentId: Number(row.assignment_id),
    protocolId: Number(row.protocol_id),
    protocolVersionId: Number(row.protocol_version_id),
    protocolName: String(row.protocol_name),
    versionNumber: String(row.version_number),
    scannerId: numberOrNull(row.scanner_id),
    scannerName: stringOrNull(row.scanner_name),
    protocolNotes: stringOrNull(row.protocol_notes),
    contrastNotes: stringOrNull(row.contrast_notes),
    status: String(row.assignment_status) as ProtocolAssignmentStatus,
    assignedBy: numberOrNull(row.assigned_by),
    assignedAt: stringOrNull(row.assigned_at),
  };
}

function mapAppointment(row: RawRecord): DoctorProtocolingAppointmentRow {
  const assignment = mapAssignment(row);
  return {
    appointmentId: Number(row.appointment_id),
    patientId: Number(row.patient_id),
    patientMrn: stringOrNull(row.patient_mrn),
    patientNationalId: stringOrNull(row.patient_national_id),
    patientArabicName: stringOrNull(row.patient_arabic_name),
    patientEnglishName: stringOrNull(row.patient_english_name),
    ageYears: numberOrNull(row.age_years),
    sex: stringOrNull(row.sex),
    appointmentDate: String(row.appointment_date),
    appointmentTime: stringOrNull(row.appointment_time),
    modalityId: Number(row.modality_id),
    modalityCode: String(row.modality_code).toUpperCase() as ProtocolingModality,
    modalityName: stringOrNull(row.modality_name),
    examTypeId: numberOrNull(row.exam_type_id),
    examTypeName: stringOrNull(row.exam_type_name),
    caseCategory: stringOrNull(row.case_category),
    clinicalNotes: stringOrNull(row.clinical_notes),
    appointmentStatus: String(row.appointment_status),
    protocolStatus: String(row.protocol_status) as DoctorProtocolingAppointmentRow["protocolStatus"],
    assignment,
  };
}

function mapCtPhase(row: RawRecord): ProtocolingCtPhaseRow {
  return {
    id: Number(row.id),
    orderIndex: Number(row.order_index),
    ctPhasePresetId: numberOrNull(row.ct_phase_preset_id),
    ctPhasePresetName: stringOrNull(row.ct_phase_preset_name),
    customPhaseName: stringOrNull(row.custom_phase_name),
    timingOverride: stringOrNull(row.timing_override),
    coverageOverride: stringOrNull(row.coverage_override),
    reconstructionOverride: stringOrNull(row.reconstruction_override),
    instructionsOverride: stringOrNull(row.instructions_override),
    isRequired: Boolean(row.is_required),
  };
}

function mapMriSequence(row: RawRecord): ProtocolingMriSequenceRow {
  return {
    id: Number(row.id),
    orderIndex: Number(row.order_index),
    scannerId: numberOrNull(row.scanner_id),
    scannerName: stringOrNull(row.scanner_name),
    mriSequencePresetId: numberOrNull(row.mri_sequence_preset_id),
    mriSequencePresetName: stringOrNull(row.mri_sequence_preset_name),
    planeOverride: stringOrNull(row.plane_override),
    coverageOverride: stringOrNull(row.coverage_override),
    bValuesOverride: stringOrNull(row.b_values_override),
    timingOverride: stringOrNull(row.timing_override),
    notesOverride: stringOrNull(row.notes_override),
    isRequired: Boolean(row.is_required),
  };
}

const APPOINTMENT_SELECT = `
  select
    b.id as appointment_id,
    b.patient_id,
    p.mrn as patient_mrn,
    p.national_id as patient_national_id,
    p.arabic_full_name as patient_arabic_name,
    p.english_full_name as patient_english_name,
    p.age_years,
    p.sex,
    b.booking_date::text as appointment_date,
    b.booking_time::text as appointment_time,
    b.modality_id,
    upper(m.code) as modality_code,
    m.name_en as modality_name,
    b.exam_type_id,
    et.name_en as exam_type_name,
    b.case_category,
    b.notes as clinical_notes,
    b.status as appointment_status,
    coalesce(apa.status, 'NOT_PROTOCOLLED') as protocol_status,
    apa.assignment_id,
    apa.protocol_id,
    apa.protocol_version_id,
    apa.protocol_name,
    apa.version_number,
    apa.scanner_id,
    apa.scanner_name,
    apa.protocol_notes,
    apa.contrast_notes,
    apa.status as assignment_status,
    apa.assigned_by,
    apa.assigned_at
  from appointments_v2.bookings b
  join patients p on p.id = b.patient_id
  join modalities m on m.id = b.modality_id
  left join exam_types et on et.id = b.exam_type_id
  left join lateral (
    select
      assignment.id as assignment_id,
      assignment.protocol_id,
      assignment.protocol_version_id,
      protocol.name as protocol_name,
      version.version_number,
      assignment.scanner_id,
      scanner.name as scanner_name,
      assignment.protocol_notes,
      assignment.contrast_notes,
      assignment.status,
      assignment.assigned_by,
      assignment.assigned_at
    from appointment_protocol_assignments assignment
    join protocols protocol on protocol.id = assignment.protocol_id
    join protocol_versions version on version.id = assignment.protocol_version_id
    left join imaging_scanners scanner on scanner.id = assignment.scanner_id
    where assignment.appointment_id = b.id
      and assignment.status <> 'CANCELLED'
    order by assignment.updated_at desc, assignment.id desc
    limit 1
  ) apa on true
`;

export async function listProtocolingAppointments(filters: ProtocolingFilters): Promise<DoctorProtocolingAppointmentRow[]> {
  const values: unknown[] = [filters.dateFrom, filters.dateTo];
  const where = [
    "b.booking_date >= $1::date",
    "b.booking_date <= $2::date",
    "b.status not in ('cancelled', 'discontinued', 'voided')",
    "upper(m.code) in ('CT', 'MRI')",
  ];
  if (filters.modality) {
    values.push(filters.modality);
    where.push(`upper(m.code) = $${values.length}`);
  }
  if (filters.protocolStatus === "NOT_PROTOCOLLED") {
    where.push("apa.assignment_id is null");
  } else if (filters.protocolStatus === "ASSIGNED") {
    where.push("apa.assignment_id is not null");
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    where.push(`(p.english_full_name ilike $${values.length} or p.arabic_full_name ilike $${values.length} or p.mrn ilike $${values.length} or b.id::text = $${values.length})`);
  }

  const result = await pool.query<RawRecord>(
    `${APPOINTMENT_SELECT}
     where ${where.join(" and ")}
     order by b.booking_date asc, b.booking_time asc nulls first, b.id asc
     limit 500`,
    values
  );
  return result.rows.map(mapAppointment);
}

async function getProtocolingAppointment(appointmentId: number): Promise<DoctorProtocolingAppointmentRow | null> {
  const result = await pool.query<RawRecord>(
    `${APPOINTMENT_SELECT}
     where b.id = $1
       and upper(m.code) in ('CT', 'MRI')
     limit 1`,
    [appointmentId]
  );
  return result.rows[0] ? mapAppointment(result.rows[0]) : null;
}

async function getAssignmentDetail(assignment: ProtocolAssignmentSummary): Promise<ProtocolAssignmentDetail> {
  const ctRows = await pool.query<RawRecord>(
    `
      select
        phase.id,
        phase.order_index,
        phase.ct_phase_preset_id,
        preset.name as ct_phase_preset_name,
        phase.custom_phase_name,
        phase.timing_override,
        phase.coverage_override,
        phase.reconstruction_override,
        phase.instructions_override,
        phase.is_required
      from protocol_ct_phases phase
      left join ct_phase_presets preset on preset.id = phase.ct_phase_preset_id
      where phase.protocol_version_id = $1
      order by phase.order_index asc, phase.id asc
    `,
    [assignment.protocolVersionId]
  );
  const mriRows = await pool.query<RawRecord>(
    `
      select
        sequence.id,
        sequence.order_index,
        sequence.scanner_id,
        scanner.name as scanner_name,
        sequence.mri_sequence_preset_id,
        preset.name as mri_sequence_preset_name,
        sequence.plane_override,
        sequence.coverage_override,
        sequence.b_values_override,
        sequence.timing_override,
        sequence.notes_override,
        sequence.is_required
      from protocol_mri_sequences sequence
      left join imaging_scanners scanner on scanner.id = sequence.scanner_id
      left join mri_sequence_presets preset on preset.id = sequence.mri_sequence_preset_id
      where sequence.protocol_version_id = $1
      order by sequence.order_index asc, sequence.id asc
    `,
    [assignment.protocolVersionId]
  );
  return {
    assignment,
    ctPhases: ctRows.rows.map(mapCtPhase),
    mriSequences: mriRows.rows.map(mapMriSequence),
  };
}

export async function getProtocolingAppointmentDetail(appointmentId: number): Promise<DoctorProtocolingAppointmentDetail | null> {
  const appointment = await getProtocolingAppointment(appointmentId);
  if (!appointment) return null;
  return {
    appointment,
    assignmentDetail: appointment.assignment ? await getAssignmentDetail(appointment.assignment) : null,
  };
}

async function activeProtocol(protocolId: number) {
  const result = await pool.query<{
    id: number;
    modality: ProtocolingModality;
    active_version_id: number | null;
    version_status: string | null;
  }>(
    `
      select p.id, p.modality, p.active_version_id, version.status as version_status
      from protocols p
      left join protocol_versions version on version.id = p.active_version_id
      where p.id = $1
        and p.is_active = true
      limit 1
    `,
    [protocolId]
  );
  return result.rows[0] ?? null;
}

async function scannerModality(scannerId: number): Promise<ProtocolingModality | null> {
  const result = await pool.query<{ modality: ProtocolingModality }>(
    "select modality from imaging_scanners where id = $1 and is_active = true limit 1",
    [scannerId]
  );
  return result.rows[0]?.modality ?? null;
}

async function validateAssignment(appointmentId: number, input: ProtocolAssignmentInput) {
  const appointment = await getProtocolingAppointment(appointmentId);
  if (!appointment) throw new HttpError(404, "Appointment not found.");
  const protocol = await activeProtocol(input.protocolId);
  if (!protocol?.active_version_id || protocol.version_status !== "ACTIVE") {
    throw new HttpError(400, "Protocol version must be ACTIVE.");
  }
  if (protocol.modality !== appointment.modalityCode) {
    throw new HttpError(400, "Protocol modality must match appointment modality.");
  }
  if (input.scannerId) {
    const modality = await scannerModality(input.scannerId);
    if (modality !== appointment.modalityCode) {
      throw new HttpError(400, "Scanner modality must match appointment modality.");
    }
  }
  return { appointment, protocolVersionId: protocol.active_version_id };
}

export async function saveProtocolAssignment(
  appointmentId: number,
  input: ProtocolAssignmentInput,
  assignedBy: number | null
): Promise<DoctorProtocolingAppointmentDetail> {
  const { protocolVersionId } = await validateAssignment(appointmentId, input);
  const existing = await pool.query<{ id: number }>(
    `
      select id
      from appointment_protocol_assignments
      where appointment_id = $1
        and status <> 'CANCELLED'
      order by updated_at desc, id desc
      limit 1
    `,
    [appointmentId]
  );

  if (existing.rows[0]) {
    await pool.query(
      `
        update appointment_protocol_assignments
        set protocol_id = $2,
            protocol_version_id = $3,
            scanner_id = $4,
            assigned_by = $5,
            assigned_at = now(),
            protocol_notes = $6,
            contrast_notes = $7,
            status = $8,
            updated_at = now()
        where id = $1
      `,
      [
        existing.rows[0].id,
        input.protocolId,
        protocolVersionId,
        input.scannerId,
        assignedBy,
        input.protocolNotes,
        input.contrastNotes,
        input.status,
      ]
    );
  } else {
    await pool.query(
      `
        insert into appointment_protocol_assignments (
          appointment_id,
          protocol_id,
          protocol_version_id,
          scanner_id,
          assigned_by,
          assigned_at,
          protocol_notes,
          contrast_notes,
          status
        )
        values ($1, $2, $3, $4, $5, now(), $6, $7, $8)
      `,
      [
        appointmentId,
        input.protocolId,
        protocolVersionId,
        input.scannerId,
        assignedBy,
        input.protocolNotes,
        input.contrastNotes,
        input.status,
      ]
    );
  }

  const detail = await getProtocolingAppointmentDetail(appointmentId);
  if (!detail) throw new HttpError(404, "Appointment not found.");
  return detail;
}

export async function cancelProtocolAssignment(appointmentId: number): Promise<DoctorProtocolingAppointmentDetail> {
  await pool.query(
    `
      update appointment_protocol_assignments
      set status = 'CANCELLED',
          updated_at = now()
      where appointment_id = $1
        and status <> 'CANCELLED'
    `,
    [appointmentId]
  );
  const detail = await getProtocolingAppointmentDetail(appointmentId);
  if (!detail) throw new HttpError(404, "Appointment not found.");
  return detail;
}
