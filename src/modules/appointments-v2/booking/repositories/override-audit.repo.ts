/**
 * Appointments V2 — Override audit repository.
 *
 * Records override events to appointments_v2.override_audit_events.
 */

import type { PoolClient } from "pg";
import type { SchedulingOverrideType } from "../../shared/types/common.js";

const INSERT_SQL = `
  insert into appointments_v2.override_audit_events (
    booking_id, patient_id, modality_id, exam_type_id, booking_date,
    requesting_user_id, supervisor_user_id, override_reason, override_type,
    decision_snapshot, outcome
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

const INSERT_SQL_LEGACY = `
  insert into appointments_v2.override_audit_events (
    booking_id, patient_id, modality_id, exam_type_id, booking_date,
    requesting_user_id, supervisor_user_id, override_reason,
    decision_snapshot, outcome
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

async function hasOverrideTypeColumn(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'appointments_v2'
          and table_name = 'override_audit_events'
          and column_name = 'override_type'
      ) as exists
    `
  );
  return rows[0]?.exists === true;
}

export async function recordOverrideAudit(
  client: PoolClient,
  audit: {
    bookingId: number | null;
    patientId: number | null;
    modalityId: number | null;
    examTypeId: number | null;
    bookingDate: string | null;
    requestingUserId: number | null;
    supervisorUserId: number | null;
    overrideReason: string | null;
    overrideType: SchedulingOverrideType;
    decisionSnapshot: unknown;
    outcome: "approved_and_booked" | "approved_but_failed" | "denied" | "cancelled";
  }
): Promise<void> {
  if (!(await hasOverrideTypeColumn(client))) {
    await client.query(INSERT_SQL_LEGACY, [
      audit.bookingId,
      audit.patientId,
      audit.modalityId,
      audit.examTypeId,
      audit.bookingDate,
      audit.requestingUserId,
      audit.supervisorUserId,
      audit.overrideReason,
      JSON.stringify(audit.decisionSnapshot),
      audit.outcome,
    ]);
    return;
  }

  await client.query(INSERT_SQL, [
    audit.bookingId,
    audit.patientId,
    audit.modalityId,
    audit.examTypeId,
    audit.bookingDate,
    audit.requestingUserId,
    audit.supervisorUserId,
    audit.overrideReason,
    audit.overrideType,
    JSON.stringify(audit.decisionSnapshot),
    audit.outcome,
  ]);
}
