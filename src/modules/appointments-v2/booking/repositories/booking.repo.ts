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
    policy_version_id, created_by_user_id, updated_by_user_id
  ) values (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
  )
  returning id, patient_id as "patientId", modality_id as "modalityId",
    exam_type_id as "examTypeId", reporting_priority_id as "reportingPriorityId",
    booking_date as "bookingDate", booking_time as "bookingTime",
    case_category as "caseCategory", status, notes,
    policy_version_id as "policyVersionId",
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
    booking.userId,
    booking.userId,
  ]);
  return result.rows[0];
}

const FIND_BY_ID_SQL = `
  select id, patient_id as "patientId", modality_id as "modalityId",
    exam_type_id as "examTypeId", reporting_priority_id as "reportingPriorityId",
    booking_date as "bookingDate", booking_time as "bookingTime",
    case_category as "caseCategory", status, notes,
    policy_version_id as "policyVersionId",
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
  set booking_date = $1, booking_time = $2, updated_at = now(), updated_by_user_id = $3
  where id = $4
`;

export async function updateBookingDateTime(
  client: PoolClient,
  bookingId: number,
  newDate: string,
  newTime: string | null,
  userId: number
): Promise<void> {
  await client.query(UPDATE_DATE_TIME_SQL, [newDate, newTime, userId, bookingId]);
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
    b.booking_date as "bookingDate",
    b.booking_time as "bookingTime",
    b.case_category as "caseCategory",
    b.status,
    b.notes,
    b.policy_version_id as "policyVersionId",
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
