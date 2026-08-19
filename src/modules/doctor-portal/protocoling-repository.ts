import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";
import { logAuditEntry } from "../../services/audit-service.js";
import { buildSonicDicomReportBrowserUrl, buildSonicDicomStaffViewerUrl, checkSonicDicomReportStatus } from "../../services/sonicdicom-report-service.js";
import { readSonicDicomReportSettings } from "../../services/sonicdicom-report-settings.js";
import { scheduleBookingWorklistSync } from "../../services/dicom-service.js";
import { PROTOCOLING_MODALITY_SQL, protocolingModalityAppliesSql } from "../../services/protocoling-modality.js";
import { discoverHistoricalPacsCandidatesForPatient, getHistoricalPacsReconciliationForPatient, lookupHistoricalPacsByPatientId, type HistoricalPacsCandidate } from "../../services/historical-pacs-index-service.js";
import { reconcileProtocolingPatientHistory } from "./protocoling-history.js";
import { getPatientIdentityReconciliationForStudies, requestPatientIdentityReconciliation } from "../../services/patient-identity-reconciliation-service.js";
import {
  assertRequestDocumentProtocolEligibility,
  isRequestDocumentRequiredForProtocolQueue,
  qualifyingRequestDocumentExistsSql,
} from "../../services/request-document-protocol-policy.js";
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
  ProtocolDocumentAnnotation,
  ProtocolDocumentAnnotationType,
} from "./protocoling-types.js";

type RawRecord = Record<string, unknown>;

type HistoricalPacsCandidateWithReconciliation = Omit<HistoricalPacsCandidate, "studies"> & {
  studies: Array<HistoricalPacsCandidate["studies"][number] & {
    reconciliation: { id: number; status: string; oldPatientId: string | null; operationType: string; failureCode: string | null } | null;
    attestation: { studyInstanceUid: string; status: "confirmed" | "denied"; recordedByUserId: number; recordedByName: string | null; recordedAt: string } | null;
  }>;
};

function latestPatientIdentityReconciliationJobs<T extends { id: number; study_instance_uid: string }>(jobs: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const job of jobs) {
    const studyInstanceUid = job.study_instance_uid.trim();
    if (!studyInstanceUid) continue;
    const existing = latest.get(studyInstanceUid);
    if (!existing || job.id > existing.id) latest.set(studyInstanceUid, job);
  }
  return latest;
}

async function attachPatientIdentityReconciliationToHistoricalCandidates(
  candidates: HistoricalPacsCandidate[],
  loadJobs = getPatientIdentityReconciliationForStudies,
  patientId?: number,
): Promise<HistoricalPacsCandidateWithReconciliation[]> {
  const studyInstanceUids = [...new Set(candidates.flatMap((candidate) => candidate.studies.map((study) => study.studyInstanceUid?.trim()).filter((value): value is string => Boolean(value))))];
  const jobs = await loadJobs(studyInstanceUids);
  const attestations = patientId && studyInstanceUids.length
    ? await pool.query<{ study_instance_uid: string; status: "confirmed" | "denied"; recorded_by_user_id: number; recorded_by_name: string | null; recorded_at: string }>(
      `select a.study_instance_uid, a.status, a.recorded_by_user_id, coalesce(nullif(u.full_name, ''), u.username) as recorded_by_name, a.recorded_at::text
       from historical_pacs_patient_attestations a join users u on u.id = a.recorded_by_user_id
       where a.patient_id = $1 and a.study_instance_uid = any($2::text[])`, [patientId, studyInstanceUids])
    : { rows: [] };
  const attestationByStudy = new Map(attestations.rows.map((row) => [row.study_instance_uid, { studyInstanceUid: row.study_instance_uid, status: row.status, recordedByUserId: row.recorded_by_user_id, recordedByName: row.recorded_by_name, recordedAt: row.recorded_at }]));
  const latest = latestPatientIdentityReconciliationJobs(jobs);
  return candidates.map((candidate) => ({
    ...candidate,
    studies: candidate.studies.map((study) => {
      const job = study.studyInstanceUid ? latest.get(study.studyInstanceUid.trim()) : undefined;
      return { ...study, reconciliation: job ? { id: job.id, status: job.status, oldPatientId: job.old_patient_id, operationType: job.operation_type, failureCode: job.failure_code } : null, attestation: study.studyInstanceUid ? attestationByStudy.get(study.studyInstanceUid.trim()) ?? null : null };
    }),
  }));
}

function stringOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function normalizeProtocolingModality(value: unknown): ProtocolingModality {
  const code = String(value ?? "").trim().toUpperCase();
  return code === "MR" ? "MRI" : code as ProtocolingModality;
}

function mapAssignment(row: RawRecord): ProtocolAssignmentSummary | null {
  if (row.assignment_id == null) return null;
  return {
    assignmentId: Number(row.assignment_id),
    protocolId: numberOrNull(row.protocol_id),
    protocolVersionId: numberOrNull(row.protocol_version_id),
    protocolName: stringOrNull(row.protocol_name),
    versionNumber: stringOrNull(row.version_number),
    scannerId: numberOrNull(row.scanner_id),
    scannerName: stringOrNull(row.scanner_name),
    protocolNotes: stringOrNull(row.protocol_notes),
    contrastNotes: stringOrNull(row.contrast_notes),
    freeTextProtocol: stringOrNull(row.free_text_protocol),
    status: String(row.assignment_status) as ProtocolAssignmentStatus,
    assignedBy: numberOrNull(row.assigned_by),
    assignedAt: stringOrNull(row.assigned_at),
  };
}

function mapAppointment(row: RawRecord): DoctorProtocolingAppointmentRow {
  const assignment = mapAssignment(row);
  return {
    appointmentId: Number(row.appointment_id),
    accessionNumber: String(row.accession_number),
    patientId: Number(row.patient_id),
    patientMrn: stringOrNull(row.patient_mrn),
    patientNationalId: stringOrNull(row.patient_national_id),
    patientArabicName: stringOrNull(row.patient_arabic_name),
    patientEnglishName: stringOrNull(row.patient_english_name),
    ageYears: numberOrNull(row.age_years),
    sex: stringOrNull(row.sex),
    appointmentDate: String(row.appointment_date),
    appointmentTime: stringOrNull(row.appointment_time),
    requiresReport: Boolean(row.requires_report),
    modalityId: Number(row.modality_id),
    modalityCode: normalizeProtocolingModality(row.modality_code),
    modalityName: stringOrNull(row.modality_name),
    modalitySafetyWorkflowType: row.modality_safety_workflow_type === "mri_primary_implant_screening" ? "mri_primary_implant_screening" : "standard_acknowledgement",
    mriPrimaryScreeningResult: row.mri_primary_screening_result === "no_known_implant_reported" || row.mri_primary_screening_result === "implant_reported_review_required"
      ? row.mri_primary_screening_result
      : null,
    examTypeId: numberOrNull(row.exam_type_id),
    examTypeName: stringOrNull(row.exam_type_name),
    caseCategory: stringOrNull(row.case_category),
    clinicalNotes: stringOrNull(row.clinical_notes),
    patientDicomId: stringOrNull(row.patient_dicom_id),
    studyInstanceUid: stringOrNull(row.study_instance_uid),
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
    ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
    b.patient_id,
    p.mrn as patient_mrn,
    p.national_id as patient_national_id,
    p.arabic_full_name as patient_arabic_name,
    p.english_full_name as patient_english_name,
    p.age_years,
    p.sex,
    b.booking_date::text as appointment_date,
    b.booking_time::text as appointment_time,
    b.requires_report,
    b.modality_id,
    protocoling_modality.modality_code,
    m.name_en as modality_name,
    m.safety_workflow_type as modality_safety_workflow_type,
    screening.result as mri_primary_screening_result,
    b.exam_type_id,
    et.name_en as exam_type_name,
    b.case_category,
    b.notes as clinical_notes,
    coalesce(nullif(trim(primary_identifier.value), ''), nullif(trim(p.identifier_value), ''), nullif(trim(p.national_id), '')) as patient_dicom_id,
    b.study_instance_uid,
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
    apa.free_text_protocol,
    apa.status as assignment_status,
    apa.assigned_by,
    apa.assigned_at
  from appointments_v2.bookings b
  join patients p on p.id = b.patient_id
  join modalities m on m.id = b.modality_id
  left join appointments_v2.mri_primary_screenings screening on screening.booking_id = b.id
  cross join lateral (
    select ${PROTOCOLING_MODALITY_SQL} as modality_code
  ) protocoling_modality
  left join exam_types et on et.id = b.exam_type_id
  left join lateral (
    select pi.value
    from patient_identifiers pi
    where pi.patient_id = p.id and pi.is_primary = true
    order by pi.id asc
    limit 1
  ) primary_identifier on true
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
      assignment.free_text_protocol,
      assignment.status,
      assignment.assigned_by,
      assignment.assigned_at
    from appointment_protocol_assignments assignment
    left join protocols protocol on protocol.id = assignment.protocol_id
    left join protocol_versions version on version.id = assignment.protocol_version_id
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
    protocolingModalityAppliesSql("protocoling_modality.modality_code"),
  ];
  if (await isRequestDocumentRequiredForProtocolQueue()) {
    where.push(qualifyingRequestDocumentExistsSql("b.id"));
  }
  if (filters.modality) {
    values.push(filters.modality);
    where.push(`protocoling_modality.modality_code = $${values.length}`);
  }
  if (filters.protocolStatus === "NOT_PROTOCOLLED") {
    where.push("apa.assignment_id is null");
  } else if (filters.protocolStatus === "ASSIGNED") {
    where.push("apa.assignment_id is not null");
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    where.push(`(
      p.english_full_name ilike $${values.length}
      or p.arabic_full_name ilike $${values.length}
      or p.mrn ilike $${values.length}
      or ('V2-' || lpad(b.id::text, 6, '0')) ilike $${values.length}
      or b.id::text = $${values.length}
    )`);
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
       and ${protocolingModalityAppliesSql("protocoling_modality.modality_code")}
     limit 1`,
    [appointmentId]
  );
  return result.rows[0] ? mapAppointment(result.rows[0]) : null;
}

async function getAssignmentDetail(assignment: ProtocolAssignmentSummary): Promise<ProtocolAssignmentDetail> {
  if (!assignment.protocolVersionId) return { assignment, ctPhases: [], mriSequences: [] };
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
  await assertRequestDocumentProtocolEligibility(appointmentId);
  let protocolVersionId: number | null = null;
  if (input.protocolId !== null) {
    const protocol = await activeProtocol(input.protocolId);
    if (!protocol?.active_version_id || protocol.version_status !== "ACTIVE") throw new HttpError(400, "Protocol version must be ACTIVE.");
    if (protocol.modality !== appointment.modalityCode) throw new HttpError(400, "Protocol modality must match appointment modality.");
    protocolVersionId = protocol.active_version_id;
  } else if (!input.freeTextProtocol?.trim()) {
    throw new HttpError(400, "Select a saved protocol or enter a free-text protocol.");
  }
  if (input.scannerId) {
    const modality = await scannerModality(input.scannerId);
    if (modality !== appointment.modalityCode) {
      throw new HttpError(400, "Scanner modality must match appointment modality.");
    }
  }
  return { appointment, protocolVersionId };
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
            free_text_protocol = $8,
            status = $9,
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
        input.freeTextProtocol,
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
          free_text_protocol,
          status
        )
        values ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9)
      `,
      [
        appointmentId,
        input.protocolId,
        protocolVersionId,
        input.scannerId,
        assignedBy,
        input.protocolNotes,
        input.contrastNotes,
        input.freeTextProtocol,
        input.status,
      ]
    );
  }

  const detail = await getProtocolingAppointmentDetail(appointmentId);
  if (!detail) throw new HttpError(404, "Appointment not found.");
  scheduleBookingWorklistSync(appointmentId);
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
  scheduleBookingWorklistSync(appointmentId);
  return detail;
}

export async function getProtocolingPatientHistory(appointmentId: number) {
  const current = await getProtocolingAppointment(appointmentId);
  if (!current) throw new HttpError(404, "Appointment not found.");
  const result = await pool.query<RawRecord>(
    `
      select
        b.id as appointment_id,
        ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
        b.study_instance_uid,
        b.booking_date::text as appointment_date,
        b.booking_time::text as appointment_time,
        m.code as modality_code,
        m.name_en as modality_name,
        et.name_en as exam_type_name,
        b.status as appointment_status,
        coalesce(cache.report_status = 'final', false) as report_available
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      left join doctor_portal.reporting_board_sonicdicom_cache cache on cache.appointment_id = b.id
      where b.patient_id = $1 and b.id <> $2
      order by b.booking_date desc, b.booking_time desc nulls last, b.id desc
    `,
    [current.patientId, appointmentId]
  );
  const rispro = result.rows.map((value) => ({
    appointmentId: Number(value.appointment_id),
    accessionNumber: stringOrNull(value.accession_number),
    studyInstanceUid: stringOrNull(value.study_instance_uid),
    date: stringOrNull(value.appointment_date),
    time: stringOrNull(value.appointment_time),
    modalityCode: stringOrNull(value.modality_code),
    description: stringOrNull(value.exam_type_name) ?? stringOrNull(value.modality_name),
    appointmentStatus: String(value.appointment_status),
    reportAvailable: Boolean(value.report_available),
  }));
  const patientRow=(await pool.query<{patient_id:string|null;name:string|null;birth_date:string|null}>(`select coalesce(nullif(trim(pi.value),''),nullif(trim(p.identifier_value),''),nullif(trim(p.national_id),'')) patient_id,coalesce(nullif(trim(p.english_full_name),''),p.arabic_full_name) name,p.estimated_date_of_birth::text birth_date from patients p left join lateral(select value from patient_identifiers where patient_id=p.id and is_primary=true order by id limit 1) pi on true where p.id=$1`,[current.patientId])).rows[0];
  const currentPatient={id:current.patientId,patientId:patientRow?.patient_id||current.patientDicomId,name:patientRow?.name||current.patientEnglishName||current.patientArabicName,birthDate:patientRow?.birth_date||null};
  try {
    const discovery = await getHistoricalPacsReconciliationForPatient(current.patientId, rispro.map((row) => row.studyInstanceUid).filter((value): value is string => Boolean(value)));
    const pacsStatus = discovery.knownPatientIds.length === 0
      ? "patient_id_unavailable" as const
      : discovery.indexStatus === "ready" ? "available" as const : "unavailable" as const;
    const baseItems=reconcileProtocolingPatientHistory(rispro, discovery.exactStudies, current.accessionNumber, current.studyInstanceUid, discovery.knownPatientIds);
    const jobs=await getPatientIdentityReconciliationForStudies(baseItems.map((item)=>item.studyInstanceUid?.trim()).filter((value):value is string=>Boolean(value))); const latest=latestPatientIdentityReconciliationJobs(jobs);
    return {
      items: baseItems.map((item)=>{const job=item.studyInstanceUid?latest.get(item.studyInstanceUid.trim()):undefined;return {...item,reconciliation:job?{id:job.id,status:job.status,oldPatientId:job.old_patient_id,operationType:job.operation_type,failureCode:job.failure_code}:null};}),
      pacsStatus,
      historicalPacsIndexStatus: discovery.indexStatus,
      historicalPacsLastSuccessAt: discovery.lastSuccessAt,
      currentPatient,
    };
  } catch {
    return { items: reconcileProtocolingPatientHistory(rispro, [], current.accessionNumber, current.studyInstanceUid), pacsStatus: "unavailable" as const, historicalPacsIndexStatus: "unavailable" as const, historicalPacsLastSuccessAt: null, currentPatient };
  }
}

export async function requestProtocolingPatientIdentityReconciliation(appointmentId:number,studyInstanceUid:string,accessionNumber:string|null,userId:number){const current=await getProtocolingAppointment(appointmentId);if(!current)throw new HttpError(404,"Appointment not found.");return requestPatientIdentityReconciliation({patientId:current.patientId,studyInstanceUid,accessionNumber,requestedByUserId:userId});}

export async function getProtocolingHistoricalPacsCandidates(appointmentId: number) {
  const current = await getProtocolingAppointment(appointmentId);
  if (!current) throw new HttpError(404, "Appointment not found.");
  const discovery = await discoverHistoricalPacsCandidatesForPatient(current.patientId);
  return {
    historicalCandidates: await attachPatientIdentityReconciliationToHistoricalCandidates(discovery.candidates, undefined, current.patientId),
    historicalPacsIndexStatus: discovery.indexStatus,
    historicalPacsLastSuccessAt: discovery.lastSuccessAt,
  };
}

export async function searchProtocolingHistoricalPacsPatientId(appointmentId: number, oldPatientId: string) {
  if (!(await getProtocolingAppointment(appointmentId))) throw new HttpError(404, "Appointment not found.");
  const current = await getProtocolingAppointment(appointmentId);
  if (!current) throw new HttpError(404, "Appointment not found.");
  return { candidates: await attachPatientIdentityReconciliationToHistoricalCandidates(await lookupHistoricalPacsByPatientId(oldPatientId), undefined, current.patientId) };
}

export async function recordHistoricalPacsPatientAttestation(appointmentId: number, studyInstanceUid: string, status: "confirmed" | "denied", recordedByUserId: number) {
  const current = await getProtocolingAppointment(appointmentId);
  if (!current) throw new HttpError(404, "Appointment not found.");
  const normalizedStudyInstanceUid = studyInstanceUid.trim();
  if (!normalizedStudyInstanceUid) throw new HttpError(400, "studyInstanceUid is required.");
  const discovery = await discoverHistoricalPacsCandidatesForPatient(current.patientId);
  if (!discovery.candidates.some((candidate) => candidate.studies.some((study) => study.studyInstanceUid?.trim() === normalizedStudyInstanceUid))) {
    throw new HttpError(404, "Historical PACS study is not a candidate for this patient.");
  }
  const existing = await pool.query<{ status: string }>(`select status from historical_pacs_patient_attestations where patient_id=$1 and study_instance_uid=$2`, [current.patientId, normalizedStudyInstanceUid]);
  const result = await pool.query<{ study_instance_uid: string; status: "confirmed" | "denied"; recorded_by_user_id: number; recorded_by_name: string | null; recorded_at: string }>(
    `insert into historical_pacs_patient_attestations (patient_id, study_instance_uid, status, recorded_by_user_id)
     values ($1, $2, $3, $4)
     on conflict (patient_id, study_instance_uid) do update set status=excluded.status, recorded_by_user_id=excluded.recorded_by_user_id, recorded_at=now()
     returning study_instance_uid, status, recorded_by_user_id, (select coalesce(nullif(full_name, ''), username) from users where id=$4) as recorded_by_name, recorded_at::text`,
    [current.patientId, normalizedStudyInstanceUid, status, recordedByUserId]
  );
  const row = result.rows[0]!;
  await logAuditEntry({ entityType: "historical_pacs_patient_attestation", entityId: null, actionType: `historical_pacs_patient_${status}`, oldValues: existing.rows[0] ?? null, newValues: { patientId: current.patientId, studyInstanceUid: normalizedStudyInstanceUid, status }, changedByUserId: recordedByUserId });
  return { studyInstanceUid: row.study_instance_uid, status: row.status, recordedByUserId: row.recorded_by_user_id, recordedByName: row.recorded_by_name, recordedAt: row.recorded_at };
}

export const __protocolingRepositoryTestables = { attachPatientIdentityReconciliationToHistoricalCandidates, latestPatientIdentityReconciliationJobs };

async function assertProtocolingDocument(documentId: number): Promise<void> {
  const result = await pool.query(
    `select d.id
     from documents d
     join appointments_v2.bookings b on b.id = d.v2_booking_id
     join modalities m on m.id = b.modality_id
     where d.id = $1 and m.code in ('CT', 'MRI')
     limit 1`,
    [documentId]
  );
  if (!result.rows[0]) throw new HttpError(404, "Protocoling document not found.");
}

function mapAnnotation(row: RawRecord): ProtocolDocumentAnnotation {
  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    pageNumber: Number(row.page_number),
    annotationType: String(row.annotation_type) as ProtocolDocumentAnnotationType,
    geometry: (row.geometry && typeof row.geometry === "object" && !Array.isArray(row.geometry) ? row.geometry : {}) as Record<string, unknown>,
    textContent: stringOrNull(row.text_content),
    style: (row.style && typeof row.style === "object" && !Array.isArray(row.style) ? row.style : null) as Record<string, unknown> | null,
    createdByUserId: numberOrNull(row.created_by_user_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listProtocolDocumentAnnotations(documentId: number): Promise<ProtocolDocumentAnnotation[]> {
  await assertProtocolingDocument(documentId);
  const result = await pool.query<RawRecord>(
    `select id, document_id, page_number, annotation_type, geometry, text_content, style, created_by_user_id, created_at, updated_at
     from doctor_protocol_document_annotations
     where document_id = $1 and deleted_at is null
     order by page_number asc, id asc`,
    [documentId]
  );
  return result.rows.map(mapAnnotation);
}

export async function createProtocolDocumentAnnotation(input: {
  documentId: number;
  pageNumber: number;
  annotationType: ProtocolDocumentAnnotationType;
  geometry: Record<string, unknown>;
  textContent: string | null;
  style: Record<string, unknown> | null;
  createdByUserId: number | null;
}): Promise<ProtocolDocumentAnnotation> {
  await assertProtocolingDocument(input.documentId);
  const result = await pool.query<RawRecord>(
    `insert into doctor_protocol_document_annotations (document_id, page_number, annotation_type, geometry, text_content, style, created_by_user_id)
     values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)
     returning id, document_id, page_number, annotation_type, geometry, text_content, style, created_by_user_id, created_at, updated_at`,
    [input.documentId, input.pageNumber, input.annotationType, JSON.stringify(input.geometry), input.textContent, input.style ? JSON.stringify(input.style) : null, input.createdByUserId]
  );
  await logAuditEntry({ entityType: "document_annotation", entityId: Number(result.rows[0]?.id), actionType: "doctor_protocol_annotation_created", oldValues: null, newValues: { documentId: input.documentId, pageNumber: input.pageNumber, annotationType: input.annotationType }, changedByUserId: input.createdByUserId }).catch(() => null);
  return mapAnnotation(result.rows[0]!);
}

export async function updateProtocolDocumentAnnotation(input: {
  documentId: number;
  annotationId: number;
  pageNumber: number;
  annotationType: ProtocolDocumentAnnotationType;
  geometry: Record<string, unknown>;
  textContent: string | null;
  style: Record<string, unknown> | null;
  updatedByUserId: number | null;
}): Promise<ProtocolDocumentAnnotation> {
  await assertProtocolingDocument(input.documentId);
  const result = await pool.query<RawRecord>(
    `update doctor_protocol_document_annotations
     set page_number = $3, annotation_type = $4, geometry = $5::jsonb, text_content = $6, style = $7::jsonb
     where id = $1 and document_id = $2 and deleted_at is null
     returning id, document_id, page_number, annotation_type, geometry, text_content, style, created_by_user_id, created_at, updated_at`,
    [input.annotationId, input.documentId, input.pageNumber, input.annotationType, JSON.stringify(input.geometry), input.textContent, input.style ? JSON.stringify(input.style) : null]
  );
  if (!result.rows[0]) throw new HttpError(404, "Annotation not found.");
  await logAuditEntry({ entityType: "document_annotation", entityId: input.annotationId, actionType: "doctor_protocol_annotation_updated", oldValues: null, newValues: { documentId: input.documentId }, changedByUserId: input.updatedByUserId }).catch(() => null);
  return mapAnnotation(result.rows[0]);
}

export async function deleteProtocolDocumentAnnotation(documentId: number, annotationId: number, deletedByUserId: number | null): Promise<void> {
  await assertProtocolingDocument(documentId);
  const result = await pool.query("update doctor_protocol_document_annotations set deleted_at = now() where id = $1 and document_id = $2 and deleted_at is null", [annotationId, documentId]);
  if (!result.rowCount) throw new HttpError(404, "Annotation not found.");
  await logAuditEntry({ entityType: "document_annotation", entityId: annotationId, actionType: "doctor_protocol_annotation_deleted", oldValues: null, newValues: { documentId }, changedByUserId: deletedByUserId }).catch(() => null);
}

export async function getProtocolingSonicDicomRedirect(appointmentId: number, scope: "study" | "patient", requestHostname: string): Promise<string> {
  const appointment = await getProtocolingAppointment(appointmentId);
  if (!appointment) throw new HttpError(404, "Appointment not found.");
  const value = scope === "study" ? appointment.accessionNumber : appointment.patientDicomId;
  if (!value) throw new HttpError(400, scope === "study" ? "Accession number is unavailable." : "DICOM Patient ID is unavailable.");
  return buildSonicDicomStaffViewerUrl({
    settings: await readSonicDicomReportSettings(),
    requestHostname,
    target: scope === "study" ? "studyViewer" : "patientList",
    value,
  });
}

export async function getProtocolingHistorySonicDicomRedirect(accessionNumber: string, requestHostname: string): Promise<string> {
  const value = accessionNumber.trim();
  if (!value) throw new HttpError(400, "Accession number is required.");
  return buildSonicDicomStaffViewerUrl({ settings: await readSonicDicomReportSettings(), requestHostname, target: "studyViewer", value });
}

export async function getProtocolingReportRedirect(appointmentId: number, requestHostname: string): Promise<string> {
  const appointment = await getProtocolingAppointment(appointmentId);
  if (!appointment) throw new HttpError(404, "Appointment not found.");
  const context = {
    bookingId: appointment.appointmentId,
    accessionNumber: appointment.accessionNumber,
    studyInstanceUid: appointment.studyInstanceUid,
    requiresReport: true,
    status: appointment.appointmentStatus,
  };
  const status = await checkSonicDicomReportStatus(context, { useCache: true });
  if (!status.canViewReport) throw new HttpError(409, "The report is not available.");
  return buildSonicDicomReportBrowserUrl(context, requestHostname);
}
