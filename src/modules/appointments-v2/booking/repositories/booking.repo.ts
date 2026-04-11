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
