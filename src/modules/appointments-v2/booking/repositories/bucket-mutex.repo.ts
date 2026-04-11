/**
 * Appointments V2 — Bucket mutex repository.
 *
 * Uses row-level locking via SELECT ... FOR UPDATE on
 * appointments_v2.bucket_mutex for concurrency-safe booking.
 */

import type { PoolClient } from "pg";

const ACQUIRE_SQL = `
  insert into appointments_v2.bucket_mutex (modality_id, booking_date, case_category)
  values ($1, $2, $3)
  on conflict (modality_id, booking_date, case_category)
  do update set created_at = now()
`;

const LOCK_SQL = `
  select 1 from appointments_v2.bucket_mutex
  where modality_id = $1 and booking_date = $2 and case_category = $3
  for update
`;

export async function acquireBucketLock(
  client: PoolClient,
  modalityId: number,
  date: string,
  caseCategory: string
): Promise<void> {
  // Ensure the row exists
  await client.query(ACQUIRE_SQL, [modalityId, date, caseCategory]);
  // Lock it for the duration of the transaction
  await client.query(LOCK_SQL, [modalityId, date, caseCategory]);
}

export async function releaseBucketLock(
  _client: PoolClient,
  _modalityId: number,
  _date: string,
  _caseCategory: string
): Promise<void> {
  // Lock is released automatically on COMMIT or ROLLBACK.
  // No explicit action needed.
}
