/**
 * Appointments V2 — Capacity repository.
 *
 * Queries booked counts from appointments_v2.bookings.
 */

import type { PoolClient } from "pg";

const GET_BOOKED_COUNT_SQL = `
  select count(*)::int as count
  from appointments_v2.bookings
  where modality_id = $1
    and booking_date = $2
    and case_category = $3
    and status <> 'cancelled'
`;

export async function getBookedCountForDate(
  client: PoolClient,
  modalityId: number,
  date: string,
  caseCategory: string
): Promise<number> {
  const result = await client.query<{ count: number }>(GET_BOOKED_COUNT_SQL, [
    modalityId,
    date,
    caseCategory,
  ]);
  return result.rows[0]?.count ?? 0;
}

const GET_SPECIAL_QUOTA_BOOKED_COUNT_SQL = `
  select count(*)::int as count
  from appointments_v2.bookings
  where modality_id = $1
    and booking_date = $2
    and case_category = $3
    and exam_type_id = $4
    and status <> 'cancelled'
    and uses_special_quota = true
`;

export async function getSpecialQuotaBookedCount(
  client: PoolClient,
  params: {
    modalityId: number;
    bookingDate: string;
    caseCategory: string;
    examTypeId: number;
  }
): Promise<number> {
  const result = await client.query<{ count: number }>(GET_SPECIAL_QUOTA_BOOKED_COUNT_SQL, [
    params.modalityId,
    params.bookingDate,
    params.caseCategory,
    params.examTypeId,
  ]);
  return result.rows[0]?.count ?? 0;
}
