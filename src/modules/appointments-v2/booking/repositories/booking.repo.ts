/**
 * Appointments V2 — Booking repository.
 *
 * Queries appointments_v2.bookings.
 */

import type { PoolClient } from "pg";
import type { Booking } from "../models/booking.js";

const INSERT_SQL = `
  insert into appointments_v2.bookings (
    patient_id, modality_id, exam_type_id, reporting_priority_id,
    booking_date, booking_time, case_category, status, notes,
    policy_version_id, capacity_resolution_mode, uses_special_quota, special_reason_code, special_reason_note,
    is_walk_in, created_by_user_id, updated_by_user_id
  ) values (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
  )
  returning id, patient_id as "patientId", modality_id as "modalityId",
    exam_type_id as "examTypeId", reporting_priority_id as "reportingPriorityId",
    booking_date::text as "bookingDate", booking_time as "bookingTime",
    case_category as "caseCategory", status, notes,
    policy_version_id as "policyVersionId",
    capacity_resolution_mode as "capacityResolutionMode",
    uses_special_quota as "usesSpecialQuota",
    special_reason_code as "specialReasonCode",
    special_reason_note as "specialReasonNote",
    is_walk_in as "isWalkIn",
    created_at as "createdAt", created_by_user_id as "createdByUserId",
    updated_at as "updatedAt", updated_by_user_id as "updatedByUserId"
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
    status: string;
    notes: string | null;
    policyVersionId: number;
    capacityResolutionMode: "standard" | "category_override" | "special_quota_extra";
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
    case_category as "caseCategory", status, notes,
    policy_version_id as "policyVersionId",
    capacity_resolution_mode as "capacityResolutionMode",
    uses_special_quota as "usesSpecialQuota",
    special_reason_code as "specialReasonCode",
    special_reason_note as "specialReasonNote",
    is_walk_in as "isWalkIn",
    created_at as "createdAt", created_by_user_id as "createdByUserId",
    updated_at as "updatedAt", updated_by_user_id as "updatedByUserId"
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

const UPDATE_DATE_TIME_SQL = `
  update appointments_v2.bookings
  set booking_date = $1,
      booking_time = $2,
      reporting_priority_id = $3,
      notes = $4,
      updated_at = now(),
      updated_by_user_id = $5
  where id = $6
`;

export async function updateBookingDateTime(
  client: PoolClient,
  bookingId: number,
  newDate: string,
  newTime: string | null,
  userId: number,
  reportingPriorityId: number | null,
  notes: string | null
): Promise<void> {
  await client.query(UPDATE_DATE_TIME_SQL, [
    newDate,
    newTime,
    reportingPriorityId,
    notes,
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
      updated_at = now(),
      updated_by_user_id = $11
  where id = $12
`;

export async function updateBookingForReschedule(
  client: PoolClient,
  bookingId: number,
  newDate: string,
  newTime: string | null,
  policyVersionId: number,
  userId: number,
  capacityResolutionMode: "standard" | "category_override" | "special_quota_extra",
  usesSpecialQuota: boolean,
  specialReasonCode: string | null,
  specialReasonNote: string | null,
  examTypeId: number | null,
  reportingPriorityId: number | null,
  notes: string | null
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
    m.name_en as "modalityName",
    et.name_en as "examTypeName"
  from appointments_v2.bookings b
  left join patients p on p.id = b.patient_id
  left join modalities m on m.id = b.modality_id
  left join exam_types et on et.id = b.exam_type_id
  where b.modality_id = $1
    and b.booking_date >= $2
    and b.booking_date <= $3
    and ($4 = true or b.status <> 'cancelled')
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
    ('V2-' || bb.id::text) as accession_number,
    bb.appointment_date,
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
        and slot.status <> 'cancelled'
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
    rp.name_ar as priority_name_ar,
    rp.name_en as priority_name_en
  from booking_base bb
  join patients p on p.id = bb.patient_id
  join modalities m on m.id = bb.modality_id
  left join exam_types et on et.id = bb.exam_type_id
  left join reporting_priorities rp on rp.id = bb.reporting_priority_id
`;

export interface BookingPrintDetailsRow {
  id: number;
  accession_number: string;
  appointment_date: string;
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
  priority_name_ar: string | null;
  priority_name_en: string | null;
}

export async function findBookingPrintDetailsById(
  pool: import("pg").Pool,
  bookingId: number
): Promise<BookingPrintDetailsRow | null> {
  const result = await pool.query<BookingPrintDetailsRow>(FIND_BOOKING_PRINT_DETAILS_SQL, [bookingId]);
  return result.rows[0] ?? null;
}
