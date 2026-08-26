import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";
import { logAuditEntry } from "../../../services/audit-service.js";
import { PROTOCOLING_MODALITY_SQL } from "../../../services/protocoling-modality.js";

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
  patientDisplayName?: string | null;
  patientMrn?: string | null;
  patientIdentifier?: string | null;
  originalAccession?: string;
  originalExam?: string | null;
  originalExamAr?: string | null;
  originalExamEn?: string | null;
  modalityName?: string | null;
  modalityNameAr?: string | null;
  modalityNameEn?: string | null;
  modalityCode?: string | null;
  patientArabicName?: string | null;
  patientEnglishName?: string | null;
  requesterDisplayName?: string | null;
  recallAppointmentAccession?: string | null;
  recallAppointmentDate?: string | null;
  previousAttemptAppointmentId?: number | null;
  previousAttemptReason?: string | null;
  previousAttemptAt?: string | null;
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
  const extra = row as RecallRow & Record<string, unknown>;
  return { id: Number(row.id), originalAppointmentId: Number(row.original_appointment_id), recallAppointmentId: row.recall_appointment_id == null ? null : Number(row.recall_appointment_id), receptionInstruction: row.reception_instruction, technologistInstruction: row.technologist_instruction, status: row.status, requestedByUserId: Number(row.requested_by_user_id), requestedAt: row.requested_at, receptionSeenAt: row.reception_seen_at, scheduledAt: row.scheduled_at, completedAt: row.completed_at, cancelledAt: row.cancelled_at, patientDisplayName: extra.patient_display_name == null ? null : String(extra.patient_display_name), patientMrn: extra.patient_mrn == null ? null : String(extra.patient_mrn), patientIdentifier: extra.patient_identifier == null ? null : String(extra.patient_identifier), patientArabicName: extra.patient_arabic_name == null ? null : String(extra.patient_arabic_name), patientEnglishName: extra.patient_english_name == null ? null : String(extra.patient_english_name), originalAccession: extra.original_accession == null ? undefined : String(extra.original_accession), originalExam: extra.original_exam == null ? null : String(extra.original_exam), originalExamAr: extra.original_exam_ar == null ? null : String(extra.original_exam_ar), originalExamEn: extra.original_exam_en == null ? null : String(extra.original_exam_en), modalityName: extra.modality_name == null ? null : String(extra.modality_name), modalityNameAr: extra.modality_name_ar == null ? null : String(extra.modality_name_ar), modalityNameEn: extra.modality_name_en == null ? null : String(extra.modality_name_en), modalityCode: extra.modality_code == null ? null : String(extra.modality_code), requesterDisplayName: extra.requester_display_name == null ? null : String(extra.requester_display_name), recallAppointmentAccession: extra.recall_appointment_accession == null ? null : String(extra.recall_appointment_accession), recallAppointmentDate: extra.recall_appointment_date == null ? null : String(extra.recall_appointment_date), previousAttemptAppointmentId: extra.previous_attempt_appointment_id == null ? null : Number(extra.previous_attempt_appointment_id), previousAttemptReason: extra.previous_attempt_reason == null ? null : String(extra.previous_attempt_reason), previousAttemptAt: extra.previous_attempt_at == null ? null : String(extra.previous_attempt_at) };
}

const SELECT = `id, original_appointment_id, recall_appointment_id, reception_instruction, technologist_instruction, status, requested_by_user_id, requested_at, reception_seen_at, scheduled_at, completed_at, cancelled_at`;

export async function createComplementaryRecall(client: PoolClient, input: { originalAppointmentId: number; receptionInstruction: string | null; technologistInstruction: string; requestedByUserId: number }): Promise<ComplementaryRecall> {
  const original = await client.query<{ id: number; status: string; exam_type_id: number | null; protocoling_modality: string | null }>(`select b.id, b.status, b.exam_type_id, ${PROTOCOLING_MODALITY_SQL} as protocoling_modality from appointments_v2.bookings b join modalities m on m.id = b.modality_id where b.id = $1 for update`, [input.originalAppointmentId]);
  if (!original.rows[0]) throw new HttpError(404, "Original appointment not found.");
  if (original.rows[0].protocoling_modality == null) throw new HttpError(409, "Only CT or MRI protocoling appointments can receive an additional imaging request.");
  if (original.rows[0].status !== "completed") throw new HttpError(409, "Only completed appointments are eligible for additional imaging.");
  if (original.rows[0].exam_type_id == null) throw new HttpError(409, "The original appointment requires an exam type before additional imaging can be requested.");
  const text = input.technologistInstruction.trim();
  if (!text) throw new HttpError(400, "Technologist instruction is required.");
  let result;
  try {
    result = await client.query<RecallRow>(`insert into appointments_v2.complementary_recall_requests (original_appointment_id, reception_instruction, technologist_instruction, status, requested_by_user_id) values ($1,$2,$3,'pending_scheduling',$4) returning ${SELECT}`, [input.originalAppointmentId, input.receptionInstruction?.trim() || null, text, input.requestedByUserId]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new HttpError(409, "An active additional imaging request already exists for this appointment.");
    throw error;
  }
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
  if (row.status !== "pending_scheduling") throw new HttpError(409, "Additional imaging request is not available for booking.");
  const recall = map(row);
  return { ...recall, patientId: Number(row.patient_id), modalityId: Number(row.modality_id), examTypeId: Number(row.exam_type_id), originalAccession: `V2-${String(recall.originalAppointmentId).padStart(6, "0")}`, originalExam: row.original_exam };
}

export async function listComplementaryRecalls(client: Queryable = pool): Promise<ComplementaryRecall[]> {
  const result = await client.query<RecallRow>(`select r.${SELECT.replaceAll(", ", ", r.")}, coalesce(nullif(trim(p.english_full_name), ''), nullif(trim(p.arabic_full_name), '')) as patient_display_name, p.arabic_full_name as patient_arabic_name, p.english_full_name as patient_english_name, p.mrn as patient_mrn, coalesce(nullif(trim(primary_identifier.value), ''), nullif(trim(p.identifier_value), ''), nullif(trim(p.national_id), '')) as patient_identifier, ('V2-' || lpad(original_booking.id::text, 6, '0')) as original_accession, et.name_en as original_exam, et.name_ar as original_exam_ar, et.name_en as original_exam_en, m.name_en as modality_name, m.name_ar as modality_name_ar, m.name_en as modality_name_en, m.code as modality_code, coalesce(nullif(trim(requester.full_name), ''), requester.username) as requester_display_name, case when return_booking.id is null then null else ('V2-' || lpad(return_booking.id::text, 6, '0')) end as recall_appointment_accession, return_booking.booking_date::text as recall_appointment_date, previous_attempt.previous_attempt_appointment_id, previous_attempt.previous_attempt_reason, previous_attempt.previous_attempt_at from appointments_v2.complementary_recall_requests r join appointments_v2.bookings original_booking on original_booking.id = r.original_appointment_id join patients p on p.id = original_booking.patient_id join modalities m on m.id = original_booking.modality_id left join exam_types et on et.id = original_booking.exam_type_id left join users requester on requester.id = r.requested_by_user_id left join appointments_v2.bookings return_booking on return_booking.id = r.recall_appointment_id left join lateral (select pi.value from patient_identifiers pi where pi.patient_id = p.id and pi.is_primary = true order by pi.id asc limit 1) primary_identifier on true left join lateral (select case when audit.new_values->>'previousRecallAppointmentId' ~ '^[1-9][0-9]{0,17}$' then (audit.new_values->>'previousRecallAppointmentId')::bigint else null end as previous_attempt_appointment_id, audit.new_values->>'reason' as previous_attempt_reason, audit.created_at::text as previous_attempt_at from audit_log audit where audit.entity_type = 'complementary_recall_request' and audit.entity_id = r.id and audit.action_type = 'complementary_recall_reopened_after_uncompleted_booking' order by audit.created_at desc, audit.id desc limit 1) previous_attempt on true order by r.requested_at desc, r.id desc`);
  return result.rows.map(map);
}

export async function complementaryRecallUnseenCount(client: Queryable = pool): Promise<number> {
  const result = await client.query<{ count: string }>("select count(*)::text as count from appointments_v2.complementary_recall_requests where reception_seen_at is null and status in ('pending_scheduling', 'scheduled')");
  return Number(result.rows[0]?.count ?? 0);
}

export async function complementaryRecallReceptionSummary(client: Queryable = pool): Promise<{ pendingCount: number; unseenPendingCount: number }> {
  const result = await client.query<{ pending_count: string; unseen_pending_count: string }>("select count(*) filter (where status = 'pending_scheduling')::text as pending_count, count(*) filter (where status = 'pending_scheduling' and reception_seen_at is null)::text as unseen_pending_count from appointments_v2.complementary_recall_requests");
  return { pendingCount: Number(result.rows[0]?.pending_count ?? 0), unseenPendingCount: Number(result.rows[0]?.unseen_pending_count ?? 0) };
}

export async function markComplementaryRecallSeen(client: PoolClient, id: number, userId: number): Promise<void> {
  await client.query("update appointments_v2.complementary_recall_requests set reception_seen_at = coalesce(reception_seen_at, now()), reception_seen_by_user_id = coalesce(reception_seen_by_user_id, $2) where id = $1", [id, userId]);
}

export async function markComplementaryRecallsSeen(client: PoolClient, ids: number[], userId: number): Promise<void> {
  const validIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!validIds.length) return;
  await client.query("update appointments_v2.complementary_recall_requests set reception_seen_at = coalesce(reception_seen_at, now()), reception_seen_by_user_id = coalesce(reception_seen_by_user_id, $2) where id = any($1::bigint[])", [validIds, userId]);
}

export async function lockComplementaryRecallForBooking(client: PoolClient, recallId: number, payload: { patientId: number; modalityId: number; examTypeId: number | null }): Promise<ComplementaryRecall> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [recallId]);
  if (!result.rows[0]) throw new HttpError(404, "Additional imaging request not found.");
  const recall = map(result.rows[0]);
  if (recall.status !== "pending_scheduling" || recall.recallAppointmentId != null) throw new HttpError(409, "Additional imaging request is not available for scheduling.");
  const original = await client.query<{ patient_id: number; modality_id: number; exam_type_id: number | null }>("select patient_id, modality_id, exam_type_id from appointments_v2.bookings where id = $1 for update", [recall.originalAppointmentId]);
  const booking = original.rows[0];
  if (!booking) throw new HttpError(409, "Additional imaging original appointment no longer exists.");
  if (booking.exam_type_id == null || Number(booking.patient_id) !== payload.patientId || Number(booking.modality_id) !== payload.modalityId || Number(booking.exam_type_id) !== payload.examTypeId) throw new HttpError(409, "Complementary appointment must match the original patient, modality, and exam type.");
  return recall;
}

export async function linkComplementaryRecallBooking(client: PoolClient, recall: ComplementaryRecall, bookingId: number, actorUserId: number): Promise<void> {
  await client.query("update appointments_v2.complementary_recall_requests set recall_appointment_id = $2, status = 'scheduled', scheduled_at = now() where id = $1", [recall.id, bookingId]);
  await client.query(`insert into appointment_protocol_assignments (appointment_id, protocol_id, protocol_version_id, scanner_id, free_text_protocol, status, assigned_by, assigned_at, created_at, updated_at) values ($1, null, null, null, $2, 'ASSIGNED', $3, now(), now(), now())`, [bookingId, recall.technologistInstruction, recall.requestedByUserId]);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_scheduled", oldValues: { status: "pending_scheduling", recallAppointmentId: null }, newValues: { status: "scheduled", recallAppointmentId: bookingId }, changedByUserId: actorUserId }, client);
}

export async function reopenComplementaryRecallForUncompletedBooking(client: PoolClient, bookingId: number, actorUserId: number | null, reason: string): Promise<void> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where recall_appointment_id = $1 and status in ('scheduled', 'completed') for update`, [bookingId]);
  if (!result.rows[0]) return;
  const recall = map(result.rows[0]);
  await client.query("update appointments_v2.complementary_recall_requests set recall_appointment_id = null, status = 'pending_scheduling', scheduled_at = null, completed_at = null, reception_seen_at = null, reception_seen_by_user_id = null where id = $1", [recall.id]);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_reopened_after_uncompleted_booking", oldValues: { status: recall.status, recallAppointmentId: recall.recallAppointmentId, scheduledAt: recall.scheduledAt, completedAt: recall.completedAt }, newValues: { status: "pending_scheduling", recallAppointmentId: null, previousRecallAppointmentId: bookingId, reason }, changedByUserId: actorUserId }, client);
}

export async function completeComplementaryRecallForBooking(client: PoolClient, bookingId: number, actorUserId: number | null): Promise<void> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where recall_appointment_id = $1 and status = 'scheduled' for update`, [bookingId]);
  if (!result.rows[0]) return;
  const recall = map(result.rows[0]);
  await client.query("update appointments_v2.complementary_recall_requests set status = 'completed', completed_at = now() where id = $1", [recall.id]);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_completed", oldValues: { status: "scheduled", recallAppointmentId: bookingId }, newValues: { status: "completed", recallAppointmentId: bookingId }, changedByUserId: actorUserId }, client);
}

export async function withdrawComplementaryRecall(client: PoolClient, id: number, actorUserId: number): Promise<ComplementaryRecall> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [id]);
  if (!result.rows[0]) throw new HttpError(404, "Additional imaging request not found.");
  const recall = map(result.rows[0]);
  if (recall.status !== "pending_scheduling" || recall.recallAppointmentId != null) throw new HttpError(409, "Additional imaging can only be withdrawn before a complementary appointment is booked.");
  const changed = await client.query<RecallRow>(`update appointments_v2.complementary_recall_requests set status = 'cancelled', cancelled_at = now(), cancelled_by_user_id = $2 where id = $1 returning ${SELECT}`, [id, actorUserId]);
  const cancelled = map(changed.rows[0]!);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: id, actionType: "complementary_recall_withdrawn", oldValues: { status: recall.status, recallAppointmentId: recall.recallAppointmentId }, newValues: { status: "cancelled", recallAppointmentId: cancelled.recallAppointmentId }, changedByUserId: actorUserId }, client);
  return cancelled;
}

export async function updateComplementaryRecallInstructions(client: PoolClient, id: number, input: { receptionInstruction: string | null; technologistInstruction: string; actorUserId: number }): Promise<ComplementaryRecall> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [id]);
  if (!result.rows[0]) throw new HttpError(404, "Additional imaging request not found.");
  const recall = map(result.rows[0]);
  if (recall.status !== "pending_scheduling" || recall.recallAppointmentId != null) throw new HttpError(409, "Additional imaging instructions can only be edited before a complementary appointment is booked.");
  const technologistInstruction = input.technologistInstruction.trim();
  if (!technologistInstruction) throw new HttpError(400, "Technologist instruction is required.");
  const receptionInstruction = input.receptionInstruction?.trim() || null;
  const changed = await client.query<RecallRow>(`update appointments_v2.complementary_recall_requests set reception_instruction = $2, technologist_instruction = $3, reception_seen_at = null, reception_seen_by_user_id = null where id = $1 returning ${SELECT}`, [id, receptionInstruction, technologistInstruction]);
  const updated = map(changed.rows[0]!);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: id, actionType: "complementary_recall_instructions_updated", oldValues: { receptionInstruction: recall.receptionInstruction, technologistInstruction: recall.technologistInstruction }, newValues: { receptionInstruction: updated.receptionInstruction, technologistInstruction: updated.technologistInstruction }, changedByUserId: input.actorUserId }, client);
  return updated;
}

/** @deprecated Use reopenComplementaryRecallForUncompletedBooking with an outcome reason. */
export const reopenComplementaryRecallForCancelledBooking = (client: PoolClient, bookingId: number, actorUserId: number) => reopenComplementaryRecallForUncompletedBooking(client, bookingId, actorUserId, "cancelled");
/** @deprecated Use withdrawComplementaryRecall. */
export const cancelComplementaryRecall = withdrawComplementaryRecall;
