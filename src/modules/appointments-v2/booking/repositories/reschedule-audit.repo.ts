/**
 * Appointments V2 — Reschedule audit repository.
 *
 * Writes immutable reschedule history events.
 */

import type { PoolClient } from "pg";

const INSERT_SQL = `
  insert into appointments_v2.reschedule_audit_events (
    booking_id,
    previous_date,
    previous_time,
    new_date,
    new_time,
    changed_by_user_id,
    override_used,
    supervisor_user_id,
    reason
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`;

export async function recordRescheduleAudit(
  client: PoolClient,
  audit: {
    bookingId: number;
    previousDate: string;
    previousTime: string | null;
    newDate: string;
    newTime: string | null;
    changedByUserId: number;
    overrideUsed: boolean;
    supervisorUserId: number | null;
    reason: string | null;
  }
): Promise<void> {
  await client.query(INSERT_SQL, [
    audit.bookingId,
    audit.previousDate,
    audit.previousTime,
    audit.newDate,
    audit.newTime,
    audit.changedByUserId,
    audit.overrideUsed,
    audit.supervisorUserId,
    audit.reason,
  ]);
}

