import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";
import { logAuditEntry } from "../../../services/audit-service.js";

export type ComplementaryRecallStatus = "pending_scheduling" | "scheduled" | "completed" | "cancelled";

export interface ComplementaryRecall {
  id: number;
  originalAppointmentId: number;
  recallAppointmentId: number | null;
  receptionInstruction: string | null;
  technologistInstruction: string;
  status: ComplementaryRecallStatus;
  requestedByUserId: number;
  requestedAt: string;
  receptionSeenAt: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}
export interface ComplementaryRecallBookingContext extends ComplementaryRecall { patientId: number; modalityId: number; examTypeId: number; originalAccession: string; originalExam: string | null; }

type RecallRow = {
  id: number; original_appointment_id: number; recall_appointment_id: number | null;
  reception_instruction: string | null; technologist_instruction: string; status: ComplementaryRecallStatus;
  requested_by_user_id: number; requested_at: string; reception_seen_at: string | null;
  scheduled_at: string | null; completed_at: string | null; cancelled_at: string | null;
};
type Queryable = Pick<PoolClient, "query">;

function map(row: RecallRow): ComplementaryRecall {
  return { id: Number(row.id), originalAppointmentId: Number(row.original_appointment_id), recallAppointmentId: row.recall_appointment_id == null ? null : Number(row.recall_appointment_id), receptionInstruction: row.reception_instruction, technologistInstruction: row.technologist_instruction, status: row.status, requestedByUserId: Number(row.requested_by_user_id), requestedAt: row.requested_at, receptionSeenAt: row.reception_seen_at, scheduledAt: row.scheduled_at, completedAt: row.completed_at, cancelledAt: row.cancelled_at };
}

const SELECT = `id, original_appointment_id, recall_appointment_id, reception_instruction, technologist_instruction, status, requested_by_user_id, requested_at, reception_seen_at, scheduled_at, completed_at, cancelled_at`;

export async function createComplementaryRecall(client: PoolClient, input: { originalAppointmentId: number; receptionInstruction: string | null; technologistInstruction: string; requestedByUserId: number }): Promise<ComplementaryRecall> {
  const original = await client.query<{ id: number }>("select id from appointments_v2.bookings where id = $1 for update", [input.originalAppointmentId]);
  if (!original.rows[0]) throw new HttpError(404, "Original appointment not found.");
  const text = input.technologistInstruction.trim();
  if (!text) throw new HttpError(400, "Technologist instruction is required.");
  const result = await client.query<RecallRow>(`insert into appointments_v2.complementary_recall_requests (original_appointment_id, reception_instruction, technologist_instruction, status, requested_by_user_id) values ($1,$2,$3,'pending_scheduling',$4) returning ${SELECT}`, [input.originalAppointmentId, input.receptionInstruction?.trim() || null, text, input.requestedByUserId]);
  const recall = map(result.rows[0]!);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_requested", newValues: { originalAppointmentId: recall.originalAppointmentId, status: recall.status }, changedByUserId: input.requestedByUserId }, client);
  return recall;
}

export async function getComplementaryRecall(id: number, client: Queryable = pool): Promise<ComplementaryRecall | null> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1`, [id]);
  return result.rows[0] ? map(result.rows[0]) : null;
}

export async function getComplementaryRecallBookingContext(id: number, client: Queryable = pool): Promise<ComplementaryRecallBookingContext | null> {
  const result = await client.query<RecallRow & { patient_id: number; modality_id: number; exam_type_id: number | null; original_exam: string | null }>(`select r.${SELECT.replaceAll(", ", ", r.")}, b.patient_id, b.modality_id, b.exam_type_id, et.name_en as original_exam from appointments_v2.complementary_recall_requests r join appointments_v2.bookings b on b.id = r.original_appointment_id left join exam_types et on et.id = b.exam_type_id where r.id = $1`, [id]);
  const row = result.rows[0];
  if (!row || row.exam_type_id == null) return null;
  const recall = map(row);
  return { ...recall, patientId: Number(row.patient_id), modalityId: Number(row.modality_id), examTypeId: Number(row.exam_type_id), originalAccession: `V2-${String(recall.originalAppointmentId).padStart(6, "0")}`, originalExam: row.original_exam };
}

export async function listComplementaryRecalls(client: Queryable = pool): Promise<ComplementaryRecall[]> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests order by requested_at desc, id desc`);
  return result.rows.map(map);
}

export async function complementaryRecallUnseenCount(client: Queryable = pool): Promise<number> {
  const result = await client.query<{ count: string }>("select count(*)::text as count from appointments_v2.complementary_recall_requests where reception_seen_at is null and status = 'pending_scheduling'");
  return Number(result.rows[0]?.count ?? 0);
}

export async function markComplementaryRecallSeen(client: PoolClient, id: number, userId: number): Promise<void> {
  await client.query("update appointments_v2.complementary_recall_requests set reception_seen_at = coalesce(reception_seen_at, now()), reception_seen_by_user_id = coalesce(reception_seen_by_user_id, $2) where id = $1", [id, userId]);
}

export async function lockComplementaryRecallForBooking(client: PoolClient, recallId: number, payload: { patientId: number; modalityId: number; examTypeId: number | null }): Promise<ComplementaryRecall> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [recallId]);
  if (!result.rows[0]) throw new HttpError(404, "Complementary recall request not found.");
  const recall = map(result.rows[0]);
  if (recall.status !== "pending_scheduling" || recall.recallAppointmentId != null) throw new HttpError(409, "Complementary recall is not available for scheduling.");
  const original = await client.query<{ patient_id: number; modality_id: number; exam_type_id: number | null }>("select patient_id, modality_id, exam_type_id from appointments_v2.bookings where id = $1 for update", [recall.originalAppointmentId]);
  const booking = original.rows[0];
  if (!booking) throw new HttpError(409, "Complementary recall original appointment no longer exists.");
  if (booking.exam_type_id == null || Number(booking.patient_id) !== payload.patientId || Number(booking.modality_id) !== payload.modalityId || Number(booking.exam_type_id) !== payload.examTypeId) throw new HttpError(409, "Recall booking must match the original patient, modality, and exam type.");
  return recall;
}

export async function linkComplementaryRecallBooking(client: PoolClient, recall: ComplementaryRecall, bookingId: number, actorUserId: number): Promise<void> {
  await client.query("update appointments_v2.complementary_recall_requests set recall_appointment_id = $2, status = 'scheduled', scheduled_at = now() where id = $1", [recall.id, bookingId]);
  await client.query(`insert into appointment_protocol_assignments (appointment_id, protocol_id, protocol_version_id, scanner_id, free_text_protocol, status, assigned_by, assigned_at, created_at, updated_at) values ($1, null, null, null, $2, 'ASSIGNED', $3, now(), now(), now())`, [bookingId, recall.technologistInstruction, recall.requestedByUserId]);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_scheduled", oldValues: { status: "pending_scheduling", recallAppointmentId: null }, newValues: { status: "scheduled", recallAppointmentId: bookingId }, changedByUserId: actorUserId }, client);
}

export async function reopenComplementaryRecallForCancelledBooking(client: PoolClient, bookingId: number, actorUserId: number): Promise<void> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where recall_appointment_id = $1 and status = 'scheduled' for update`, [bookingId]);
  if (!result.rows[0]) return;
  const recall = map(result.rows[0]);
  await client.query("update appointments_v2.complementary_recall_requests set recall_appointment_id = null, status = 'pending_scheduling', scheduled_at = null where id = $1", [recall.id]);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_reopened_after_booking_cancelled", oldValues: { status: "scheduled", recallAppointmentId: bookingId }, newValues: { status: "pending_scheduling", recallAppointmentId: null, previousRecallAppointmentId: bookingId }, changedByUserId: actorUserId }, client);
}

export async function completeComplementaryRecallForBooking(client: PoolClient, bookingId: number, actorUserId: number | null): Promise<void> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where recall_appointment_id = $1 and status = 'scheduled' for update`, [bookingId]);
  if (!result.rows[0]) return;
  const recall = map(result.rows[0]);
  await client.query("update appointments_v2.complementary_recall_requests set status = 'completed', completed_at = now() where id = $1", [recall.id]);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_completed", oldValues: { status: "scheduled", recallAppointmentId: bookingId }, newValues: { status: "completed", recallAppointmentId: bookingId }, changedByUserId: actorUserId }, client);
}

export async function cancelComplementaryRecall(client: PoolClient, id: number, actorUserId: number): Promise<ComplementaryRecall> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [id]);
  if (!result.rows[0]) throw new HttpError(404, "Complementary recall request not found.");
  const recall = map(result.rows[0]);
  if (recall.status === "completed" || recall.status === "cancelled") throw new HttpError(409, "Complementary recall cannot be cancelled.");
  const changed = await client.query<RecallRow>(`update appointments_v2.complementary_recall_requests set status = 'cancelled', cancelled_at = now(), cancelled_by_user_id = $2 where id = $1 returning ${SELECT}`, [id, actorUserId]);
  const cancelled = map(changed.rows[0]!);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: id, actionType: "complementary_recall_clinically_cancelled", oldValues: { status: recall.status, recallAppointmentId: recall.recallAppointmentId }, newValues: { status: "cancelled", recallAppointmentId: cancelled.recallAppointmentId }, changedByUserId: actorUserId }, client);
  return cancelled;
}
