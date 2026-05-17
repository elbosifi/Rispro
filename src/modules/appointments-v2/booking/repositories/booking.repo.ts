/**
 * Appointments V2 — Booking repository.
 *
 * Queries appointments_v2.bookings.
 */

import type { PoolClient } from "pg";
import type { Booking } from "../models/booking.js";
import type { CapacityResolutionMode } from "../../shared/types/common.js";

const INSERT_SQL = `
  insert into appointments_v2.bookings (
    patient_id, modality_id, exam_type_id, reporting_priority_id,
    booking_date, booking_time, case_category, requires_report, study_instance_uid, status, notes,
    policy_version_id, capacity_resolution_mode, uses_special_quota, special_reason_code, special_reason_note,
    is_walk_in, created_by_user_id, updated_by_user_id
  ) values (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
  )
  returning id, patient_id as "patientId", modality_id as "modalityId",
    exam_type_id as "examTypeId", reporting_priority_id as "reportingPriorityId",
    booking_date::text as "bookingDate", booking_time as "bookingTime",
    case_category as "caseCategory", requires_report as "requiresReport",
    study_instance_uid as "studyInstanceUid", status, notes,
    policy_version_id as "policyVersionId",
    capacity_resolution_mode as "capacityResolutionMode",
    uses_special_quota as "usesSpecialQuota",
    special_reason_code as "specialReasonCode",
    special_reason_note as "specialReasonNote",
    is_walk_in as "isWalkIn",
    created_at as "createdAt", created_by_user_id as "createdByUserId",
    updated_at as "updatedAt", updated_by_user_id as "updatedByUserId",
    voided_at as "voidedAt", voided_by_user_id as "voidedByUserId", void_reason as "voidReason"
`;

export async function insertBooking(
  client: PoolClient,
  booking: {
    patientId: number;
    modalityId: number;
    examTypeId: number | null;
    reportingPriorityId: number | null;
    bookingDate: string;
    bookingTime: string | null;
    caseCategory: string;
    requiresReport: boolean;
    studyInstanceUid: string | null;
    status: string;
    notes: string | null;
    policyVersionId: number;
    capacityResolutionMode: CapacityResolutionMode;
    usesSpecialQuota: boolean;
    specialReasonCode: string | null;
    specialReasonNote: string | null;
    isWalkIn: boolean;
    userId: number;
  }
): Promise<Booking> {
  const result = await client.query<Booking>(INSERT_SQL, [
    booking.patientId,
    booking.modalityId,
    booking.examTypeId,
    booking.reportingPriorityId,
    booking.bookingDate,
    booking.bookingTime,
    booking.caseCategory,
    booking.requiresReport,
    booking.studyInstanceUid,
    booking.status,
    booking.notes,
    booking.policyVersionId,
    booking.capacityResolutionMode,
    booking.usesSpecialQuota,
    booking.specialReasonCode,
    booking.specialReasonNote,
    booking.isWalkIn,
    booking.userId,
    booking.userId,
  ]);
  return result.rows[0];
}

const FIND_BY_ID_SQL = `
  select id, patient_id as "patientId", modality_id as "modalityId",
    exam_type_id as "examTypeId", reporting_priority_id as "reportingPriorityId",
    booking_date::text as "bookingDate", booking_time as "bookingTime",
    case_category as "caseCategory", requires_report as "requiresReport",
    study_instance_uid as "studyInstanceUid", status, notes,
    policy_version_id as "policyVersionId",
    capacity_resolution_mode as "capacityResolutionMode",
    uses_special_quota as "usesSpecialQuota",
    special_reason_code as "specialReasonCode",
    special_reason_note as "specialReasonNote",
    is_walk_in as "isWalkIn",
    created_at as "createdAt", created_by_user_id as "createdByUserId",
    updated_at as "updatedAt", updated_by_user_id as "updatedByUserId",
    voided_at as "voidedAt", voided_by_user_id as "voidedByUserId", void_reason as "voidReason"
  from appointments_v2.bookings
  where id = $1
`;

export async function findBookingById(
  client: PoolClient | null,
  bookingId: number
): Promise<Booking | null> {
  if (!client) return null;
  const result = await client.query<Booking>(FIND_BY_ID_SQL, [bookingId]);
  return result.rows[0] ?? null;
}

const UPDATE_STATUS_SQL = `
  update appointments_v2.bookings
  set status = $1, updated_at = now(), updated_by_user_id = $2
  where id = $3
`;

export async function updateBookingStatus(
  client: PoolClient,
  bookingId: number,
  status: string,
  userId: number
): Promise<void> {
  await client.query(UPDATE_STATUS_SQL, [status, userId, bookingId]);
}

const VOID_BOOKING_SQL = `
  update appointments_v2.bookings
  set
    status = 'voided',
    void_reason = $1,
    voided_at = now(),
    voided_by_user_id = $2,
    updated_at = now(),
    updated_by_user_id = $2
  where id = $3
`;

export async function voidBooking(
  client: PoolClient,
  bookingId: number,
  voidReason: string,
  userId: number
): Promise<void> {
  await client.query(VOID_BOOKING_SQL, [voidReason, userId, bookingId]);
}

const UPDATE_DATE_TIME_SQL = `
  update appointments_v2.bookings
  set booking_date = $1,
      booking_time = $2,
      reporting_priority_id = $3,
      notes = $4,
      requires_report = $5,
      study_instance_uid = $6,
      updated_at = now(),
      updated_by_user_id = $7
  where id = $8
`;

export async function updateBookingDateTime(
  client: PoolClient,
  bookingId: number,
  newDate: string,
  newTime: string | null,
  userId: number,
  reportingPriorityId: number | null,
  notes: string | null,
  requiresReport: boolean,
  studyInstanceUid: string | null
): Promise<void> {
  await client.query(UPDATE_DATE_TIME_SQL, [
    newDate,
    newTime,
    reportingPriorityId,
    notes,
    requiresReport,
    studyInstanceUid,
    userId,
    bookingId,
  ]);
}

const UPDATE_RESCHEDULE_SQL = `
  update appointments_v2.bookings
  set booking_date = $1,
      booking_time = $2,
      policy_version_id = $3,
      capacity_resolution_mode = $4,
      uses_special_quota = $5,
      special_reason_code = $6,
      special_reason_note = $7,
      exam_type_id = $8,
      reporting_priority_id = $9,
      notes = $10,
      requires_report = $11,
      study_instance_uid = $12,
      updated_at = now(),
      updated_by_user_id = $13
  where id = $14
`;

export async function updateBookingForReschedule(
  client: PoolClient,
  bookingId: number,
  newDate: string,
  newTime: string | null,
  policyVersionId: number,
  userId: number,
  capacityResolutionMode: CapacityResolutionMode,
  usesSpecialQuota: boolean,
  specialReasonCode: string | null,
  specialReasonNote: string | null,
  examTypeId: number | null,
  reportingPriorityId: number | null,
  notes: string | null,
  requiresReport: boolean,
  studyInstanceUid: string | null
): Promise<void> {
  await client.query(UPDATE_RESCHEDULE_SQL, [
    newDate,
    newTime,
    policyVersionId,
    capacityResolutionMode,
    usesSpecialQuota,
    specialReasonCode,
    specialReasonNote,
    examTypeId,
    reportingPriorityId,
    notes,
    requiresReport,
    studyInstanceUid,
    userId,
    bookingId,
  ]);
}

// ---------------------------------------------------------------------------
// List bookings (read-only — uses pool, not transaction)
// ---------------------------------------------------------------------------

const LIST_BOOKINGS_SQL = `
  select
    b.id,
    b.patient_id as "patientId",
    b.modality_id as "modalityId",
    b.exam_type_id as "examTypeId",
    b.reporting_priority_id as "reportingPriorityId",
    b.booking_date::text as "bookingDate",
    b.booking_time as "bookingTime",
    b.case_category as "caseCategory",
    b.requires_report as "requiresReport",
    b.study_instance_uid as "studyInstanceUid",
    b.status,
    b.notes,
    b.policy_version_id as "policyVersionId",
    b.capacity_resolution_mode as "capacityResolutionMode",
    b.uses_special_quota as "usesSpecialQuota",
    b.special_reason_code as "specialReasonCode",
    b.special_reason_note as "specialReasonNote",
    b.is_walk_in as "isWalkIn",
    b.created_at as "createdAt",
    b.created_by_user_id as "createdByUserId",
    b.updated_at as "updatedAt",
    b.updated_by_user_id as "updatedByUserId",
    p.arabic_full_name as "patientArabicName",
    p.english_full_name as "patientEnglishName",
    p.national_id as "patientNationalId",
    coalesce(primary_identifier.value, p.identifier_value, p.national_id) as "patientIdentifierValue",
    m.name_en as "modalityName",
    et.name_en as "examTypeName"
  from appointments_v2.bookings b
  left join patients p on p.id = b.patient_id
  left join lateral (
    select pi.value
    from patient_identifiers pi
    where pi.patient_id = p.id
      and pi.is_primary = true
    order by pi.id asc
    limit 1
  ) primary_identifier on true
  left join modalities m on m.id = b.modality_id
  left join exam_types et on et.id = b.exam_type_id
  where b.modality_id = $1
    and b.booking_date >= $2
    and b.booking_date <= $3
    and ($4 = true or b.status not in ('cancelled', 'discontinued', 'voided'))
  order by b.booking_date asc, b.booking_time asc nulls first, b.created_at desc
  limit $5
  offset $6
`;

export interface ListBookingsParams {
  modalityId: number;
  dateFrom: string; // ISO yyyy-mm-dd
  dateTo: string;   // ISO yyyy-mm-dd
  limit: number;
  offset: number;
  includeCancelled: boolean;
}

export interface BookingWithPatientInfo extends Booking {
  patientArabicName: string | null;
  patientEnglishName: string | null;
  patientNationalId: string | null;
  patientIdentifierValue: string | null;
  modalityName: string | null;
  examTypeName: string | null;
}

export async function listBookings(
  pool: import("pg").Pool,
  params: ListBookingsParams
): Promise<BookingWithPatientInfo[]> {
  const result = await pool.query<BookingWithPatientInfo>(LIST_BOOKINGS_SQL, [
    params.modalityId,
    params.dateFrom,
    params.dateTo,
    params.includeCancelled,
    params.limit,
    params.offset,
  ]);
  return result.rows;
}

const FIND_BOOKING_PRINT_DETAILS_SQL = `
  with booking_base as (
    select
      b.id,
      b.patient_id,
      b.modality_id,
      b.exam_type_id,
      b.reporting_priority_id,
      b.booking_date::text as appointment_date,
      b.booking_time,
      b.case_category,
      b.requires_report,
      b.study_instance_uid,
      b.special_reason_code,
      b.special_reason_note,
      b.status,
      b.notes,
      b.is_walk_in,
      b.created_at,
      b.updated_at
    from appointments_v2.bookings b
    where b.id = $1
    limit 1
  )
  select
    bb.id,
    ('V2-' || lpad(bb.id::text, 6, '0')) as accession_number,
    bb.appointment_date,
    bb.booking_time,
    bb.requires_report,
    bb.study_instance_uid,
    bb.special_reason_code,
    bb.special_reason_note,
    (
      select count(*)
      from appointments_v2.bookings seq
      where seq.booking_date = bb.appointment_date::date
        and seq.id <= bb.id
    )::int as daily_sequence,
    (
      select count(*)
      from appointments_v2.bookings slot
      where slot.modality_id = bb.modality_id
        and slot.booking_date = bb.appointment_date::date
        and slot.status not in ('cancelled', 'discontinued', 'voided')
        and slot.id <= bb.id
    )::int as modality_slot_number,
    bb.status,
    bb.notes,
    bb.is_walk_in,
    false as is_overbooked,
    null::text as overbooking_reason,
    bb.created_at,
    bb.updated_at,
    p.id as patient_id,
    p.mrn,
    p.national_id,
    p.arabic_full_name,
    p.english_full_name,
    p.age_years,
    p.sex,
    p.phone_1,
    p.address,
    m.id as modality_id,
    m.code as modality_code,
    m.name_ar as modality_name_ar,
    m.name_en as modality_name_en,
    m.general_instruction_ar as modality_general_instruction_ar,
    m.general_instruction_en as modality_general_instruction_en,
    et.id as exam_type_id,
    et.name_ar as exam_name_ar,
    et.name_en as exam_name_en,
    et.specific_instruction_ar as exam_specific_instruction_ar,
    et.specific_instruction_en as exam_specific_instruction_en,
    src.label_ar as special_reason_label_ar,
    src.label_en as special_reason_label_en,
    rp.name_ar as priority_name_ar,
    rp.name_en as priority_name_en,
    ap.protocol_status,
    ap.protocol_text,
    ap.contrast_required,
    ap.contrast_phase_or_protocol,
    ap.special_preparation,
    ap.technologist_notes,
    dp.display_name as protocol_assigned_by_doctor_name,
    ap.assigned_at as protocol_assigned_at
  from booking_base bb
  join patients p on p.id = bb.patient_id
  join modalities m on m.id = bb.modality_id
  left join exam_types et on et.id = bb.exam_type_id
  left join appointments_v2.special_reason_codes src on src.code = bb.special_reason_code
  left join reporting_priorities rp on rp.id = bb.reporting_priority_id
  left join doctor_portal.appointment_protocols ap on ap.appointment_id = bb.id and ap.protocol_status = 'assigned'
  left join doctor_portal.doctor_profiles dp on dp.id = ap.assigned_by_doctor_id
`;

export interface BookingPrintDetailsRow {
  id: number;
  accession_number: string;
  requires_report: boolean;
  study_instance_uid: string | null;
  special_reason_code: string | null;
  special_reason_note: string | null;
  appointment_date: string;
  booking_time: string | null;
  daily_sequence: number;
  modality_slot_number: number | null;
  status: string;
  notes: string | null;
  is_walk_in: boolean;
  is_overbooked: boolean;
  overbooking_reason: string | null;
  created_at: string;
  updated_at: string;
  patient_id: number;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  age_years: number;
  sex: string | null;
  phone_1: string | null;
  address: string | null;
  modality_id: number;
  modality_code: string;
  modality_name_ar: string;
  modality_name_en: string;
  modality_general_instruction_ar: string | null;
  modality_general_instruction_en: string | null;
  exam_type_id: number | null;
  exam_name_ar: string | null;
  exam_name_en: string | null;
  exam_specific_instruction_ar: string | null;
  exam_specific_instruction_en: string | null;
  special_reason_label_ar: string | null;
  special_reason_label_en: string | null;
  priority_name_ar: string | null;
  priority_name_en: string | null;
  protocol_status: string | null;
  protocol_text: string | null;
  contrast_required: boolean | null;
  contrast_phase_or_protocol: string | null;
  special_preparation: string | null;
  technologist_notes: string | null;
  protocol_assigned_by_doctor_name: string | null;
  protocol_assigned_at: string | null;
}

export async function findBookingPrintDetailsById(
  pool: import("pg").Pool,
  bookingId: number
): Promise<BookingPrintDetailsRow | null> {
  const result = await pool.query<BookingPrintDetailsRow>(FIND_BOOKING_PRINT_DETAILS_SQL, [bookingId]);
  return result.rows[0] ?? null;
}
