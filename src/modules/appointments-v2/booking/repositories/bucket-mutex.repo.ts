/**
 * Appointments V2 — Bucket mutex repository.
 *
 * Uses row-level locking via SELECT ... FOR UPDATE on
 * appointments_v2.bucket_mutex for concurrency-safe booking.
 */

import type { PoolClient } from "pg";

export interface BucketLockKey {
  modalityId: number;
  date: string;
  caseCategory: string;
}

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

function compareLockKeys(a: BucketLockKey, b: BucketLockKey): number {
  if (a.modalityId !== b.modalityId) return a.modalityId - b.modalityId;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.caseCategory === b.caseCategory) return 0;
  return a.caseCategory < b.caseCategory ? -1 : 1;
}

export async function acquireBucketLocks(
  client: PoolClient,
  keys: BucketLockKey[]
): Promise<void> {
  const dedup = new Map<string, BucketLockKey>();
  for (const key of keys) {
    dedup.set(`${key.modalityId}:${key.date}:${key.caseCategory}`, key);
  }

  const ordered = [...dedup.values()].sort(compareLockKeys);
  for (const key of ordered) {
    await client.query(ACQUIRE_SQL, [key.modalityId, key.date, key.caseCategory]);
    await client.query(LOCK_SQL, [key.modalityId, key.date, key.caseCategory]);
  }
}

export async function acquireBucketLock(
  client: PoolClient,
  modalityId: number,
  date: string,
  caseCategory: string
): Promise<void> {
  await acquireBucketLocks(client, [{ modalityId, date, caseCategory }]);
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
