/**
 * Appointments V2 — Override audit repository.
 *
 * Records override events to appointments_v2.override_audit_events.
 */

import type { PoolClient } from "pg";

const INSERT_SQL = `
  insert into appointments_v2.override_audit_events (
    booking_id, patient_id, modality_id, exam_type_id, booking_date,
    requesting_user_id, supervisor_user_id, override_reason,
    decision_snapshot, outcome
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

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
    decisionSnapshot: unknown;
    outcome: "approved_and_booked" | "approved_but_failed" | "denied" | "cancelled";
  }
): Promise<void> {
  await client.query(INSERT_SQL, [
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
}
