import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";
import { logAuditEntry } from "../../../services/audit-service.js";
import { PROTOCOLING_MODALITY_SQL } from "../../../services/protocoling-modality.js";
import { queueComplementaryRecallCompletedEmail, getComplementaryRecallCompletionEmailStatuses, type CompletionEmailNotification } from "./complementary-recall-email.js";
import { uploadDocumentIdempotently, upsertDocumentAppointmentLinks } from "../../../services/document-service.js";

export type ComplementaryRecallStatus = "pending_scheduling" | "scheduled" | "completed" | "cancelled";
export type ComplementaryRecallReasonCode = "missing_sequence_phase" | "incomplete_anatomical_coverage" | "motion_nondiagnostic_quality" | "incorrect_protocol" | "incorrect_contrast_phase_timing" | "additional_diagnostic_characterization" | "technical_equipment_problem" | "patient_related_limitation" | "other";
export type ComplementaryRecallQaClassification = "diagnostic_addition" | "technical_repeat" | "protocol_error" | "acquisition_error" | "equipment_failure" | "patient_related_unavoidable" | "other";
export type ComplementaryRecallUrgency = "same_day" | "within_24_hours" | "within_72_hours" | "routine";
export type ComplementaryRecallReportingDisposition = "supplement_original_report" | "separate_report" | "no_separate_report";
export type ComplementaryRecallOriginalReportDependency = "none" | "imaging_completed" | "report_finalized";
export type ComplementaryRecallContactMethod = "phone" | "whatsapp" | "in_person" | "clinical_team" | "other";
export type ComplementaryRecallContactOutcome = "reached_agreed" | "no_answer" | "unreachable" | "wrong_number" | "callback_requested" | "declined" | "temporarily_unavailable" | "inpatient" | "completed_elsewhere" | "other";

const REASON_CODES: readonly ComplementaryRecallReasonCode[] = ["missing_sequence_phase", "incomplete_anatomical_coverage", "motion_nondiagnostic_quality", "incorrect_protocol", "incorrect_contrast_phase_timing", "additional_diagnostic_characterization", "technical_equipment_problem", "patient_related_limitation", "other"];
const QA_CLASSIFICATIONS: readonly ComplementaryRecallQaClassification[] = ["diagnostic_addition", "technical_repeat", "protocol_error", "acquisition_error", "equipment_failure", "patient_related_unavoidable", "other"];
const URGENCIES: readonly ComplementaryRecallUrgency[] = ["same_day", "within_24_hours", "within_72_hours", "routine"];
const REPORTING_DISPOSITIONS: readonly ComplementaryRecallReportingDisposition[] = ["supplement_original_report", "separate_report", "no_separate_report"];
const ORIGINAL_REPORT_DEPENDENCIES: readonly ComplementaryRecallOriginalReportDependency[] = ["none", "imaging_completed", "report_finalized"];
const CONTACT_METHODS: readonly ComplementaryRecallContactMethod[] = ["phone", "whatsapp", "in_person", "clinical_team", "other"];
const CONTACT_OUTCOMES: readonly ComplementaryRecallContactOutcome[] = ["reached_agreed", "no_answer", "unreachable", "wrong_number", "callback_requested", "declined", "temporarily_unavailable", "inpatient", "completed_elsewhere", "other"];

export interface ComplementaryRecallContactAttempt {
  id: number;
  recallRequestId: number;
  contactMethod: ComplementaryRecallContactMethod;
  contactValue: string | null;
  outcome: ComplementaryRecallContactOutcome;
  note: string | null;
  followUpAt: string | null;
  recordedByUserId: number;
  recordedByDisplayName: string;
  createdAt: string;
}

export interface ComplementaryRecall {
  id: number;
  originalAppointmentId: number;
  recallAppointmentId: number | null;
  receptionInstruction: string | null;
  technologistInstruction: string;
  reasonCode: ComplementaryRecallReasonCode | null;
  qaClassification: ComplementaryRecallQaClassification | null;
  urgency: ComplementaryRecallUrgency | null;
  dueAt: string | null;
  reportingDisposition: ComplementaryRecallReportingDisposition | null;
  requestedModalityId: number | null;
  requestedExamTypeId: number | null;
  originalReportDependency: ComplementaryRecallOriginalReportDependency | null;
  dependencyResolvedAt: string | null;
  notifyOnArrival: boolean;
  notifyOnImagingCompleted: boolean;
  status: ComplementaryRecallStatus;
  requestedByUserId: number;
  requestedAt: string;
  receptionSeenAt: string | null;
  receptionAcknowledgedAt: string | null;
  receptionAcknowledgedByUserId: number | null;
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
  receptionAcknowledgedByDisplayName?: string | null;
  recallAppointmentAccession?: string | null;
  recallAppointmentDate?: string | null;
  recallAppointmentTime?: string | null;
  recallAppointmentStartsAt?: string | null;
  effectiveDueAt?: string | null;
  latestFollowUpAt?: string | null;
  isOverdue?: boolean;
  isDueToday?: boolean;
  isFollowUpDue?: boolean;
  isScheduledAfterTarget?: boolean;
  previousAttemptAppointmentId?: number | null;
  previousAttemptReason?: string | null;
  previousAttemptAt?: string | null;
  patientPhone1?: string | null;
  patientPhone2?: string | null;
  contactAttempts: ComplementaryRecallContactAttempt[];
  completionEmailNotification?: CompletionEmailNotification;
}
export interface ComplementaryRecallBookingContext extends ComplementaryRecall { patientId: number; modalityId: number; examTypeId: number; requiresReport: boolean; originalAccession: string; originalExam: string | null; }

type RecallRow = {
  id: number; original_appointment_id: number; recall_appointment_id: number | null;
  reception_instruction: string | null; technologist_instruction: string; status: ComplementaryRecallStatus;
  reason_code: ComplementaryRecallReasonCode | null; qa_classification: ComplementaryRecallQaClassification | null;
  urgency: ComplementaryRecallUrgency | null; due_at: string | Date | null; reporting_disposition: ComplementaryRecallReportingDisposition | null;
  requested_modality_id: number | null; requested_exam_type_id: number | null; original_report_dependency: ComplementaryRecallOriginalReportDependency | null;
  dependency_resolved_at: string | Date | null; notify_on_arrival: boolean; notify_on_imaging_completed: boolean;
  requested_by_user_id: number; requested_at: string; reception_seen_at: string | null;
  reception_acknowledged_at: string | Date | null; reception_acknowledged_by_user_id: number | null;
  scheduled_at: string | null; completed_at: string | null; cancelled_at: string | null;
  patient_phone_1?: string | null; patient_phone_2?: string | null; contact_attempts?: unknown;
};
type Queryable = Pick<PoolClient, "query">;

function map(row: RecallRow): ComplementaryRecall {
  const extra = row as RecallRow & Record<string, unknown>;
  const contactAttempts = Array.isArray(extra.contact_attempts) ? extra.contact_attempts.filter((attempt): attempt is Record<string, unknown> => typeof attempt === "object" && attempt !== null).map(mapContactAttempt) : [];
  const iso = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();
  return { id: Number(row.id), originalAppointmentId: Number(row.original_appointment_id), recallAppointmentId: row.recall_appointment_id == null ? null : Number(row.recall_appointment_id), receptionInstruction: row.reception_instruction, technologistInstruction: row.technologist_instruction, reasonCode: row.reason_code, qaClassification: row.qa_classification, urgency: row.urgency, dueAt: row.due_at == null ? null : new Date(row.due_at).toISOString(), reportingDisposition: row.reporting_disposition, requestedModalityId: row.requested_modality_id == null ? null : Number(row.requested_modality_id), requestedExamTypeId: row.requested_exam_type_id == null ? null : Number(row.requested_exam_type_id), originalReportDependency: row.original_report_dependency, dependencyResolvedAt: row.dependency_resolved_at == null ? null : new Date(row.dependency_resolved_at).toISOString(), notifyOnArrival: Boolean(row.notify_on_arrival), notifyOnImagingCompleted: Boolean(row.notify_on_imaging_completed), status: row.status, requestedByUserId: Number(row.requested_by_user_id), requestedAt: row.requested_at, receptionSeenAt: row.reception_seen_at, receptionAcknowledgedAt: row.reception_acknowledged_at == null ? null : new Date(row.reception_acknowledged_at).toISOString(), receptionAcknowledgedByUserId: row.reception_acknowledged_by_user_id == null ? null : Number(row.reception_acknowledged_by_user_id), scheduledAt: row.scheduled_at, completedAt: row.completed_at, cancelledAt: row.cancelled_at, patientDisplayName: extra.patient_display_name == null ? null : String(extra.patient_display_name), patientMrn: extra.patient_mrn == null ? null : String(extra.patient_mrn), patientIdentifier: extra.patient_identifier == null ? null : String(extra.patient_identifier), patientArabicName: extra.patient_arabic_name == null ? null : String(extra.patient_arabic_name), patientEnglishName: extra.patient_english_name == null ? null : String(extra.patient_english_name), originalAccession: extra.original_accession == null ? undefined : String(extra.original_accession), originalExam: extra.original_exam == null ? null : String(extra.original_exam), originalExamAr: extra.original_exam_ar == null ? null : String(extra.original_exam_ar), originalExamEn: extra.original_exam_en == null ? null : String(extra.original_exam_en), modalityName: extra.modality_name == null ? null : String(extra.modality_name), modalityNameAr: extra.modality_name_ar == null ? null : String(extra.modality_name_ar), modalityNameEn: extra.modality_name_en == null ? null : String(extra.modality_name_en), modalityCode: extra.modality_code == null ? null : String(extra.modality_code), requesterDisplayName: extra.requester_display_name == null ? null : String(extra.requester_display_name), receptionAcknowledgedByDisplayName: extra.reception_acknowledged_by_display_name == null ? null : String(extra.reception_acknowledged_by_display_name), recallAppointmentAccession: extra.recall_appointment_accession == null ? null : String(extra.recall_appointment_accession), recallAppointmentDate: extra.recall_appointment_date == null ? null : String(extra.recall_appointment_date), recallAppointmentTime: extra.recall_appointment_time == null ? null : String(extra.recall_appointment_time), recallAppointmentStartsAt: iso(extra.recall_appointment_starts_at), effectiveDueAt: iso(extra.effective_due_at), latestFollowUpAt: iso(extra.latest_follow_up_at), isOverdue: extra.is_overdue == null ? undefined : Boolean(extra.is_overdue), isDueToday: extra.is_due_today == null ? undefined : Boolean(extra.is_due_today), isFollowUpDue: extra.is_follow_up_due == null ? undefined : Boolean(extra.is_follow_up_due), isScheduledAfterTarget: extra.is_scheduled_after_target == null ? undefined : Boolean(extra.is_scheduled_after_target), previousAttemptAppointmentId: extra.previous_attempt_appointment_id == null ? null : Number(extra.previous_attempt_appointment_id), previousAttemptReason: extra.previous_attempt_reason == null ? null : String(extra.previous_attempt_reason), previousAttemptAt: extra.previous_attempt_at == null ? null : String(extra.previous_attempt_at), patientPhone1: row.patient_phone_1 ?? null, patientPhone2: row.patient_phone_2 ?? null, contactAttempts };
}

function mapContactAttempt(row: Record<string, unknown>): ComplementaryRecallContactAttempt {
  return { id: Number(row.id), recallRequestId: Number(row.recallRequestId ?? row.recall_request_id), contactMethod: String(row.contactMethod ?? row.contact_method) as ComplementaryRecallContactMethod, contactValue: row.contactValue == null && row.contact_value == null ? null : String(row.contactValue ?? row.contact_value), outcome: String(row.outcome) as ComplementaryRecallContactOutcome, note: row.note == null ? null : String(row.note), followUpAt: row.followUpAt == null && row.follow_up_at == null ? null : new Date(String(row.followUpAt ?? row.follow_up_at)).toISOString(), recordedByUserId: Number(row.recordedByUserId ?? row.recorded_by_user_id), recordedByDisplayName: String(row.recordedByDisplayName ?? row.recorded_by_display_name ?? ""), createdAt: new Date(String(row.createdAt ?? row.created_at)).toISOString() };
}

const SELECT = `id, original_appointment_id, recall_appointment_id, reception_instruction, technologist_instruction, reason_code, qa_classification, urgency, due_at, reporting_disposition, requested_modality_id, requested_exam_type_id, original_report_dependency, dependency_resolved_at, notify_on_arrival, notify_on_imaging_completed, status, requested_by_user_id, requested_at, reception_seen_at, reception_acknowledged_at, reception_acknowledged_by_user_id, scheduled_at, completed_at, cancelled_at`;
const ACTIVE_TARGET_STATUSES_SQL = "('pending_scheduling', 'scheduled')";
const effectiveDueAtSql = (alias: string) => `case when ${alias}.due_at is not null then ${alias}.due_at when ${alias}.urgency = 'same_day' then ((date_trunc('day', ${alias}.requested_at at time zone 'Africa/Tripoli') + interval '1 day' - interval '1 millisecond') at time zone 'Africa/Tripoli') when ${alias}.urgency = 'within_24_hours' then ${alias}.requested_at + interval '24 hours' when ${alias}.urgency = 'within_72_hours' then ${alias}.requested_at + interval '72 hours' else null end`;

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!allowed.includes(normalized as T)) throw new HttpError(400, `Invalid ${label}.`);
  return normalized as T;
}

function normalizeDueAt(value: unknown): string | null {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new HttpError(400, "Due date/time must be a valid timestamp.");
  return new Date(value).toISOString();
}

function optionalPositiveInteger(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${label} must be a positive integer.`);
  return parsed;
}

async function normalizeReportingPlan(client: PoolClient, input: { reportingDisposition: unknown; requestedModalityId?: unknown; requestedExamTypeId?: unknown; originalReportDependency?: unknown }) {
  const reportingDisposition = normalizeEnum(input.reportingDisposition, REPORTING_DISPOSITIONS, "reporting disposition");
  if (reportingDisposition === "no_separate_report") throw new HttpError(400, "No separate report is available only on historical additional imaging requests.");
  if (reportingDisposition === "supplement_original_report") {
    return { reportingDisposition, requestedModalityId: null, requestedExamTypeId: null, originalReportDependency: "imaging_completed" as const };
  }
  const requestedModalityId = optionalPositiveInteger(input.requestedModalityId, "Requested modality");
  const requestedExamTypeId = optionalPositiveInteger(input.requestedExamTypeId, "Requested exam type");
  if (!requestedModalityId || !requestedExamTypeId) throw new HttpError(400, "A separate report requires a requested modality and exam type.");
  const validExam = await client.query("select 1 from exam_types where id=$1 and modality_id=$2", [requestedExamTypeId, requestedModalityId]);
  if (!validExam.rows[0]) throw new HttpError(400, "Requested exam type must belong to the requested modality.");
  return { reportingDisposition, requestedModalityId, requestedExamTypeId, originalReportDependency: normalizeEnum(input.originalReportDependency, ORIGINAL_REPORT_DEPENDENCIES, "original report dependency") };
}

function normalizeFollowUpAt(value: unknown): string | null {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim()) || Number.isNaN(Date.parse(value))) throw new HttpError(400, "Follow-up date/time must be a valid timestamp.");
  return new Date(value).toISOString();
}

export async function createComplementaryRecall(client: PoolClient, input: { originalAppointmentId: number; receptionInstruction: string | null; technologistInstruction: string; reasonCode: unknown; qaClassification: unknown; urgency: unknown; dueAt: unknown; reportingDisposition: unknown; requestedModalityId?: unknown; requestedExamTypeId?: unknown; originalReportDependency?: unknown; notifyOnArrival?: unknown; notifyOnImagingCompleted?: unknown; requestedByUserId: number }): Promise<ComplementaryRecall> {
  const original = await client.query<{ id: number; status: string; exam_type_id: number | null; protocoling_modality: string | null }>(`select b.id, b.status, b.exam_type_id, ${PROTOCOLING_MODALITY_SQL} as protocoling_modality from appointments_v2.bookings b join modalities m on m.id = b.modality_id where b.id = $1 for update`, [input.originalAppointmentId]);
  if (!original.rows[0]) throw new HttpError(404, "Original appointment not found.");
  if (original.rows[0].protocoling_modality == null) throw new HttpError(409, "Only CT or MRI protocoling appointments can receive an additional imaging request.");
  if (original.rows[0].status !== "completed") throw new HttpError(409, "Only completed appointments are eligible for additional imaging.");
  if (original.rows[0].exam_type_id == null) throw new HttpError(409, "The original appointment requires an exam type before additional imaging can be requested.");
  const text = input.technologistInstruction.trim();
  if (!text) throw new HttpError(400, "Technologist instruction is required.");
  const reasonCode = normalizeEnum(input.reasonCode, REASON_CODES, "recall reason");
  const qaClassification = normalizeEnum(input.qaClassification, QA_CLASSIFICATIONS, "QA classification");
  const urgency = normalizeEnum(input.urgency, URGENCIES, "urgency");
  const dueAt = normalizeDueAt(input.dueAt);
  const plan = await normalizeReportingPlan(client, input);
  let result;
  try {
    result = await client.query<RecallRow>(`insert into appointments_v2.complementary_recall_requests (original_appointment_id, reception_instruction, technologist_instruction, reason_code, qa_classification, urgency, due_at, reporting_disposition, requested_modality_id, requested_exam_type_id, original_report_dependency, notify_on_arrival, notify_on_imaging_completed, status, requested_by_user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending_scheduling',$14) returning ${SELECT}`, [input.originalAppointmentId, input.receptionInstruction?.trim() || null, text, reasonCode, qaClassification, urgency, dueAt, plan.reportingDisposition, plan.requestedModalityId, plan.requestedExamTypeId, plan.originalReportDependency, input.notifyOnArrival === true, input.notifyOnImagingCompleted === true, input.requestedByUserId]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new HttpError(409, "An active additional imaging request already exists for this appointment.");
    throw error;
  }
  const recall = map(result.rows[0]!);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_requested", newValues: { originalAppointmentId: recall.originalAppointmentId, status: recall.status, reasonCode: recall.reasonCode, qaClassification: recall.qaClassification, urgency: recall.urgency, dueAt: recall.dueAt, reportingDisposition: recall.reportingDisposition, requestedModalityId: recall.requestedModalityId, requestedExamTypeId: recall.requestedExamTypeId, originalReportDependency: recall.originalReportDependency, notifyOnArrival: recall.notifyOnArrival, notifyOnImagingCompleted: recall.notifyOnImagingCompleted }, changedByUserId: input.requestedByUserId }, client);
  return recall;
}

export async function getComplementaryRecall(id: number, client: Queryable = pool): Promise<ComplementaryRecall | null> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1`, [id]);
  return result.rows[0] ? map(result.rows[0]) : null;
}

export async function getActiveComplementaryRecallForOriginalAppointment(originalAppointmentId: number, client: Queryable = pool): Promise<ComplementaryRecall | null> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where original_appointment_id = $1 and status in ('pending_scheduling', 'scheduled') limit 1`, [originalAppointmentId]);
  return result.rows[0] ? map(result.rows[0]) : null;
}

export async function getComplementaryRecallBookingContext(id: number, client: Queryable = pool): Promise<ComplementaryRecallBookingContext | null> {
  const result = await client.query<RecallRow & { patient_id: number; modality_id: number; exam_type_id: number | null; original_exam: string | null }>(`select r.${SELECT.replaceAll(", ", ", r.")}, b.patient_id, b.modality_id, b.exam_type_id, et.name_en as original_exam from appointments_v2.complementary_recall_requests r join appointments_v2.bookings b on b.id = r.original_appointment_id left join exam_types et on et.id = b.exam_type_id where r.id = $1`, [id]);
  const row = result.rows[0];
  if (!row || row.exam_type_id == null) return null;
  if (row.status !== "pending_scheduling") throw new HttpError(409, "Additional imaging request is not available for booking.");
  const recall = map(row);
  const separate = recall.reportingDisposition === "separate_report";
  if (separate && (!recall.requestedModalityId || !recall.requestedExamTypeId)) throw new HttpError(409, "This separate-report additional imaging request is missing its authorized modality or exam type.");
  return { ...recall, patientId: Number(row.patient_id), modalityId: separate ? recall.requestedModalityId! : Number(row.modality_id), examTypeId: separate ? recall.requestedExamTypeId! : Number(row.exam_type_id), requiresReport: separate, originalAccession: `V2-${String(recall.originalAppointmentId).padStart(6, "0")}`, originalExam: row.original_exam };
}

export async function listComplementaryRecalls(client: Queryable = pool): Promise<ComplementaryRecall[]> {
  const targetSql = effectiveDueAtSql("r");
  const result = await client.query<RecallRow>(`select r.${SELECT.replaceAll(", ", ", r.")}, p.phone_1 as patient_phone_1, p.phone_2 as patient_phone_2, coalesce(nullif(trim(p.english_full_name), ''), nullif(trim(p.arabic_full_name), '')) as patient_display_name, p.arabic_full_name as patient_arabic_name, p.english_full_name as patient_english_name, p.mrn as patient_mrn, coalesce(nullif(trim(primary_identifier.value), ''), nullif(trim(p.identifier_value), ''), nullif(trim(p.national_id), '')) as patient_identifier, ('V2-' || lpad(original_booking.id::text, 6, '0')) as original_accession, et.name_en as original_exam, et.name_ar as original_exam_ar, et.name_en as original_exam_en, m.name_en as modality_name, m.name_ar as modality_name_ar, m.name_en as modality_name_en, m.code as modality_code, coalesce(nullif(trim(requester.full_name), ''), requester.username) as requester_display_name, coalesce(nullif(trim(acknowledgement_user.full_name), ''), acknowledgement_user.username) as reception_acknowledged_by_display_name, case when return_booking.id is null then null else ('V2-' || lpad(return_booking.id::text, 6, '0')) end as recall_appointment_accession, return_booking.booking_date::text as recall_appointment_date, return_booking.booking_time::text as recall_appointment_time, case when return_booking.booking_time is null then null else ((return_booking.booking_date + return_booking.booking_time) at time zone 'Africa/Tripoli') end as recall_appointment_starts_at, target.effective_due_at, latest_contact.latest_follow_up_at, (r.status in ${ACTIVE_TARGET_STATUSES_SQL} and target.effective_due_at is not null and now() > target.effective_due_at) as is_overdue, (r.status in ${ACTIVE_TARGET_STATUSES_SQL} and target.effective_due_at is not null and now() <= target.effective_due_at and (target.effective_due_at at time zone 'Africa/Tripoli')::date = (now() at time zone 'Africa/Tripoli')::date) as is_due_today, (r.status = 'pending_scheduling' and r.recall_appointment_id is null and latest_contact.latest_follow_up_at is not null and now() >= latest_contact.latest_follow_up_at) as is_follow_up_due, (r.status = 'scheduled' and target.effective_due_at is not null and (case when return_booking.booking_time is not null then ((return_booking.booking_date + return_booking.booking_time) at time zone 'Africa/Tripoli') > target.effective_due_at else return_booking.booking_date > (target.effective_due_at at time zone 'Africa/Tripoli')::date end)) as is_scheduled_after_target, previous_attempt.previous_attempt_appointment_id, previous_attempt.previous_attempt_reason, previous_attempt.previous_attempt_at, contact_history.contact_attempts from appointments_v2.complementary_recall_requests r join appointments_v2.bookings original_booking on original_booking.id = r.original_appointment_id join patients p on p.id = original_booking.patient_id join modalities m on m.id = original_booking.modality_id left join exam_types et on et.id = original_booking.exam_type_id left join users requester on requester.id = r.requested_by_user_id left join users acknowledgement_user on acknowledgement_user.id = r.reception_acknowledged_by_user_id left join appointments_v2.bookings return_booking on return_booking.id = r.recall_appointment_id cross join lateral (select ${targetSql} as effective_due_at) target left join lateral (select attempt.follow_up_at as latest_follow_up_at from appointments_v2.complementary_recall_contact_attempts attempt where attempt.recall_request_id = r.id order by attempt.created_at desc, attempt.id desc limit 1) latest_contact on true left join lateral (select pi.value from patient_identifiers pi where pi.patient_id = p.id and pi.is_primary = true order by pi.id asc limit 1) primary_identifier on true left join lateral (select case when audit.new_values->>'previousRecallAppointmentId' ~ '^[1-9][0-9]{0,17}$' then (audit.new_values->>'previousRecallAppointmentId')::bigint else null end as previous_attempt_appointment_id, audit.new_values->>'reason' as previous_attempt_reason, audit.created_at::text as previous_attempt_at from audit_log audit where audit.entity_type = 'complementary_recall_request' and audit.entity_id = r.id and audit.action_type = 'complementary_recall_reopened_after_uncompleted_booking' order by audit.created_at desc, audit.id desc limit 1) previous_attempt on true left join lateral (select json_agg(json_build_object('id', attempt.id, 'recallRequestId', attempt.recall_request_id, 'contactMethod', attempt.contact_method, 'contactValue', attempt.contact_value, 'outcome', attempt.outcome, 'note', attempt.note, 'followUpAt', attempt.follow_up_at, 'recordedByUserId', attempt.recorded_by_user_id, 'recordedByDisplayName', coalesce(nullif(trim(recorded_by.full_name), ''), recorded_by.username), 'createdAt', attempt.created_at) order by attempt.created_at desc, attempt.id desc) as contact_attempts from appointments_v2.complementary_recall_contact_attempts attempt join users recorded_by on recorded_by.id = attempt.recorded_by_user_id where attempt.recall_request_id = r.id) contact_history on true order by r.requested_at desc, r.id desc`);
  const recalls = result.rows.map(map);
  const statuses = await getComplementaryRecallCompletionEmailStatuses(recalls.map((recall) => recall.id), client);
  return recalls.map((recall) => ({ ...recall, completionEmailNotification: statuses.get(recall.id)! }));
}

export async function complementaryRecallUnseenCount(client: Queryable = pool): Promise<number> {
  const result = await client.query<{ count: string }>("select count(*)::text as count from appointments_v2.complementary_recall_requests where reception_seen_at is null and status in ('pending_scheduling', 'scheduled')");
  return Number(result.rows[0]?.count ?? 0);
}

export async function complementaryRecallReceptionSummary(client: Queryable = pool): Promise<{ pendingCount: number; unseenPendingCount: number; dueTodayCount: number; overdueCount: number; followUpDueCount: number }> {
  const targetSql = effectiveDueAtSql("r");
  const result = await client.query<{ pending_count: string; unseen_pending_count: string; due_today_count: string; overdue_count: string; follow_up_due_count: string }>(`select count(*) filter (where r.status = 'pending_scheduling')::text as pending_count, count(*) filter (where r.status = 'pending_scheduling' and r.reception_seen_at is null)::text as unseen_pending_count, count(*) filter (where r.status in ${ACTIVE_TARGET_STATUSES_SQL} and target.effective_due_at is not null and now() <= target.effective_due_at and (target.effective_due_at at time zone 'Africa/Tripoli')::date = (now() at time zone 'Africa/Tripoli')::date)::text as due_today_count, count(*) filter (where r.status in ${ACTIVE_TARGET_STATUSES_SQL} and target.effective_due_at is not null and now() > target.effective_due_at)::text as overdue_count, count(*) filter (where r.status = 'pending_scheduling' and r.recall_appointment_id is null and latest_contact.latest_follow_up_at is not null and now() >= latest_contact.latest_follow_up_at)::text as follow_up_due_count from appointments_v2.complementary_recall_requests r cross join lateral (select ${targetSql} as effective_due_at) target left join lateral (select attempt.follow_up_at as latest_follow_up_at from appointments_v2.complementary_recall_contact_attempts attempt where attempt.recall_request_id = r.id order by attempt.created_at desc, attempt.id desc limit 1) latest_contact on true`);
  return { pendingCount: Number(result.rows[0]?.pending_count ?? 0), unseenPendingCount: Number(result.rows[0]?.unseen_pending_count ?? 0), dueTodayCount: Number(result.rows[0]?.due_today_count ?? 0), overdueCount: Number(result.rows[0]?.overdue_count ?? 0), followUpDueCount: Number(result.rows[0]?.follow_up_due_count ?? 0) };
}

export async function markComplementaryRecallSeen(client: PoolClient, id: number, userId: number): Promise<void> {
  await client.query("update appointments_v2.complementary_recall_requests set reception_seen_at = coalesce(reception_seen_at, now()), reception_seen_by_user_id = coalesce(reception_seen_by_user_id, $2) where id = $1", [id, userId]);
}

export async function markComplementaryRecallsSeen(client: PoolClient, ids: number[], userId: number): Promise<void> {
  const validIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!validIds.length) return;
  await client.query("update appointments_v2.complementary_recall_requests set reception_seen_at = coalesce(reception_seen_at, now()), reception_seen_by_user_id = coalesce(reception_seen_by_user_id, $2) where id = any($1::bigint[])", [validIds, userId]);
}

export async function acknowledgeComplementaryRecall(client: PoolClient, id: number, actorUserId: number): Promise<ComplementaryRecall> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [id]);
  if (!result.rows[0]) throw new HttpError(404, "Additional imaging request not found.");
  const recall = map(result.rows[0]);
  if (recall.status !== "pending_scheduling" || recall.recallAppointmentId != null) throw new HttpError(409, "Additional imaging request can only be acknowledged before a complementary appointment is booked.");
  const alreadyAcknowledged = recall.receptionAcknowledgedAt !== null || recall.receptionAcknowledgedByUserId !== null;
  const changed = await client.query<RecallRow>(`update appointments_v2.complementary_recall_requests set reception_acknowledged_at = coalesce(reception_acknowledged_at, now()), reception_acknowledged_by_user_id = coalesce(reception_acknowledged_by_user_id, $2), reception_seen_at = coalesce(reception_seen_at, now()), reception_seen_by_user_id = coalesce(reception_seen_by_user_id, $2) where id = $1 returning ${SELECT}`, [id, actorUserId]);
  const acknowledged = map(changed.rows[0]!);
  if (!alreadyAcknowledged) {
    await logAuditEntry({ entityType: "complementary_recall_request", entityId: id, actionType: "complementary_recall_acknowledged", oldValues: { status: recall.status, acknowledgedAt: recall.receptionAcknowledgedAt, acknowledgedByUserId: recall.receptionAcknowledgedByUserId }, newValues: { acknowledgedAt: acknowledged.receptionAcknowledgedAt, acknowledgedByUserId: acknowledged.receptionAcknowledgedByUserId, changedByUserId: actorUserId }, changedByUserId: actorUserId }, client);
  }
  return acknowledged;
}

type ContactAttemptRow = {
  id: number;
  recall_request_id: number;
  contact_method: ComplementaryRecallContactMethod;
  contact_value: string | null;
  outcome: ComplementaryRecallContactOutcome;
  note: string | null;
  follow_up_at: string | Date | null;
  recorded_by_user_id: number;
  recorded_by_display_name: string;
  created_at: string | Date;
};

function mapInsertedContactAttempt(row: ContactAttemptRow): ComplementaryRecallContactAttempt {
  return { id: Number(row.id), recallRequestId: Number(row.recall_request_id), contactMethod: row.contact_method, contactValue: row.contact_value, outcome: row.outcome, note: row.note, followUpAt: row.follow_up_at == null ? null : new Date(row.follow_up_at).toISOString(), recordedByUserId: Number(row.recorded_by_user_id), recordedByDisplayName: row.recorded_by_display_name, createdAt: new Date(row.created_at).toISOString() };
}

export async function recordComplementaryRecallContactAttempt(client: PoolClient, id: number, input: { contactMethod: unknown; contactValue: unknown; outcome: unknown; note: unknown; followUpAt: unknown; actorUserId: number }): Promise<ComplementaryRecallContactAttempt> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [id]);
  if (!result.rows[0]) throw new HttpError(404, "Additional imaging request not found.");
  const recall = map(result.rows[0]);
  if (recall.status !== "pending_scheduling" || recall.recallAppointmentId != null) throw new HttpError(409, "Contact attempts can only be recorded before a complementary appointment is booked.");

  const contactMethod = normalizeEnum(input.contactMethod, CONTACT_METHODS, "contact method");
  const outcome = normalizeEnum(input.outcome, CONTACT_OUTCOMES, "contact outcome");
  const contactValue = input.contactValue == null ? null : String(input.contactValue).trim() || null;
  if ((contactMethod === "phone" || contactMethod === "whatsapp") && contactValue == null) throw new HttpError(400, "Contact used is required for phone and WhatsApp attempts.");
  const note = input.note == null ? null : String(input.note).trim() || null;
  if (outcome === "other" && note == null) throw new HttpError(400, "A note is required for the other contact outcome.");
  const followUpAt = normalizeFollowUpAt(input.followUpAt);

  await acknowledgeComplementaryRecall(client, id, input.actorUserId);
  const inserted = await client.query<ContactAttemptRow>(`with inserted as (insert into appointments_v2.complementary_recall_contact_attempts (recall_request_id, contact_method, contact_value, outcome, note, follow_up_at, recorded_by_user_id) values ($1, $2, $3, $4, $5, $6, $7) returning id, recall_request_id, contact_method, contact_value, outcome, note, follow_up_at, recorded_by_user_id, created_at) select inserted.*, coalesce(nullif(trim(recorded_by.full_name), ''), recorded_by.username) as recorded_by_display_name from inserted join users recorded_by on recorded_by.id = inserted.recorded_by_user_id`, [id, contactMethod, contactValue, outcome, note, followUpAt, input.actorUserId]);
  const attempt = mapInsertedContactAttempt(inserted.rows[0]!);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: id, actionType: "complementary_recall_contact_attempt_recorded", newValues: { contactAttemptId: attempt.id, contactMethod: attempt.contactMethod, outcome: attempt.outcome, followUpAt: attempt.followUpAt, changedByUserId: input.actorUserId }, changedByUserId: input.actorUserId }, client);
  return attempt;
}

export async function lockComplementaryRecallForBooking(client: PoolClient, recallId: number, payload: { patientId: number; modalityId: number; examTypeId: number | null; requiresReport?: boolean }): Promise<ComplementaryRecall> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [recallId]);
  if (!result.rows[0]) throw new HttpError(404, "Additional imaging request not found.");
  const recall = map(result.rows[0]);
  if (recall.status !== "pending_scheduling" || recall.recallAppointmentId != null) throw new HttpError(409, "Additional imaging request is not available for scheduling.");
  const original = await client.query<{ patient_id: number; modality_id: number; exam_type_id: number | null }>("select patient_id, modality_id, exam_type_id from appointments_v2.bookings where id = $1 for update", [recall.originalAppointmentId]);
  const booking = original.rows[0];
  if (!booking) throw new HttpError(409, "Additional imaging original appointment no longer exists.");
  const separate = recall.reportingDisposition === "separate_report";
  const expectedModalityId = separate ? recall.requestedModalityId : Number(booking.modality_id);
  const expectedExamTypeId = separate ? recall.requestedExamTypeId : Number(booking.exam_type_id);
  const expectedRequiresReport = separate;
  if (!expectedModalityId || !expectedExamTypeId) throw new HttpError(409, "Complementary recall is missing its authorized examination.");
  if (Number(booking.patient_id) !== payload.patientId || expectedModalityId !== payload.modalityId || expectedExamTypeId !== payload.examTypeId) throw new HttpError(409, "Complementary appointment must use the patient and doctor-authorized modality and exam type.");
  if (typeof payload.requiresReport === "boolean" && payload.requiresReport !== expectedRequiresReport) throw new HttpError(409, "Complementary appointment reporting requirement conflicts with the doctor-authorized recall.");
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
  await client.query("update appointments_v2.complementary_recall_requests set recall_appointment_id = null, status = 'pending_scheduling', scheduled_at = null, completed_at = null, dependency_resolved_at = null, reception_seen_at = null, reception_seen_by_user_id = null where id = $1", [recall.id]);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_reopened_after_uncompleted_booking", oldValues: { status: recall.status, recallAppointmentId: recall.recallAppointmentId, scheduledAt: recall.scheduledAt, completedAt: recall.completedAt }, newValues: { status: "pending_scheduling", recallAppointmentId: null, previousRecallAppointmentId: bookingId, reason }, changedByUserId: actorUserId }, client);
}

export async function completeComplementaryRecallForBooking(client: PoolClient, bookingId: number, actorUserId: number | null): Promise<void> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where recall_appointment_id = $1 and status = 'scheduled' for update`, [bookingId]);
  if (!result.rows[0]) return;
  const recall = map(result.rows[0]);
  const resolved = recall.originalReportDependency === "imaging_completed" || recall.reportingDisposition === "supplement_original_report";
  await client.query("update appointments_v2.complementary_recall_requests set status = 'completed', completed_at = now(), dependency_resolved_at = case when $2 then coalesce(dependency_resolved_at, now()) else dependency_resolved_at end where id = $1", [recall.id, resolved]);
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_completed", oldValues: { status: "scheduled", recallAppointmentId: bookingId }, newValues: { status: "completed", recallAppointmentId: bookingId }, changedByUserId: actorUserId }, client);
  const emailRequired = recall.reportingDisposition === "supplement_original_report" || recall.originalReportDependency === "imaging_completed";
  if (!recall.notifyOnImagingCompleted && !emailRequired) return;
  await client.query("savepoint complementary_recall_email_enqueue");
  try {
    await queueComplementaryRecallCompletedEmail(client, { recallRequestId: recall.id, recallAppointmentId: bookingId, actorUserId });
    await client.query("release savepoint complementary_recall_email_enqueue");
  } catch (error) {
    await client.query("rollback to savepoint complementary_recall_email_enqueue");
    await client.query("release savepoint complementary_recall_email_enqueue");
    console.warn({ type: "additional_imaging_completion_email_enqueue_failed", recallRequestId: recall.id, recallAppointmentId: bookingId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Resolves a separate-report dependency only after the linked appointment is effectively final. */
export async function resolveComplementaryRecallReportFinality(client: PoolClient, bookingId: number, actorUserId: number | null): Promise<boolean> {
  const changed = await client.query<RecallRow>(`update appointments_v2.complementary_recall_requests set dependency_resolved_at=coalesce(dependency_resolved_at, now()) where recall_appointment_id=$1 and status='completed' and reporting_disposition='separate_report' and original_report_dependency='report_finalized' and dependency_resolved_at is null returning ${SELECT}`, [bookingId]);
  const recall = changed.rows[0] ? map(changed.rows[0]) : null;
  if (!recall) return false;
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: recall.id, actionType: "complementary_recall_original_report_dependency_resolved", newValues: { dependency: "report_finalized", recallAppointmentId: bookingId }, changedByUserId: actorUserId }, client);
  return true;
}

export async function generateComplementaryRecallRequestDocument(recallId: number, recallAppointmentId: number): Promise<void> {
  const row = await pool.query<Record<string, unknown>>(`select r.*, p.id as patient_id, coalesce(nullif(trim(p.english_full_name),''),nullif(trim(p.arabic_full_name),'')) as patient_name, p.mrn, original.id as original_booking_id, original_et.name_en as original_exam, requested_m.code as requested_modality_code, requested_et.name_en as requested_exam, coalesce(nullif(trim(requester.full_name),''),requester.username) as requester_name from appointments_v2.complementary_recall_requests r join appointments_v2.bookings original on original.id=r.original_appointment_id join patients p on p.id=original.patient_id left join exam_types original_et on original_et.id=original.exam_type_id left join modalities requested_m on requested_m.id=r.requested_modality_id left join exam_types requested_et on requested_et.id=r.requested_exam_type_id join users requester on requester.id=r.requested_by_user_id where r.id=$1 and r.recall_appointment_id=$2`, [recallId, recallAppointmentId]);
  const request = row.rows[0];
  if (!request) return;
  const esc = (value: unknown) => String(value ?? "-").replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
  const lines = [
    "Additional Imaging Request", `Patient: ${esc(request.patient_name)}`, `MRN: ${esc(request.mrn)}`,
    `Original accession: V2-${String(request.original_booking_id).padStart(6, "0")}`, `Original examination: ${esc(request.original_exam)}`,
    `Requesting doctor: ${esc(request.requester_name)}`, `Requested: ${esc(request.requested_at)}`, `Reason: ${esc(request.reason_code)}`,
    `QA classification: ${esc(request.qa_classification)}`, `Urgency: ${esc(request.urgency)}`, `Due: ${esc(request.due_at)}`,
    `Additional imaging needed: ${esc(request.technologist_instruction)}`, `Reporting plan: ${esc(request.reporting_disposition)}`,
    `Original report dependency: ${esc(request.original_report_dependency)}`, `Reception note: ${esc(request.reception_instruction)}`,
    request.requested_modality_code ? `Requested examination: ${esc(request.requested_modality_code)} · ${esc(request.requested_exam)}` : "",
    `Additional-imaging accession: V2-${String(recallAppointmentId).padStart(6, "0")}`,
  ].filter(Boolean);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${Math.max(760, 80 + lines.length * 42)}"><rect width="100%" height="100%" fill="white"/><style>text{font-family:Arial,sans-serif;font-size:24px;fill:#172554}.title{font-size:34px;font-weight:bold}</style>${lines.map((line, index) => `<text class="${index === 0 ? "title" : ""}" x="48" y="${64 + index * 42}">${line}</text>`).join("")}</svg>`;
  const sharp = (await import("sharp")).default;
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  const key = `complementary-recall-request-document:${recallId}:${recallAppointmentId}`;
  const saved = await uploadDocumentIdempotently({ patientId: Number(request.patient_id), appointmentId: Number(request.original_appointment_id), appointmentRefType: "v2_booking", documentType: "appointment_request", originalFilename: `additional-imaging-request-V2-${String(recallAppointmentId).padStart(6, "0")}.png`, mimeType: "image/png", fileContentBuffer: image, source: "complementary_recall_system" }, null, key);
  await upsertDocumentAppointmentLinks(saved.document.id, [Number(request.original_appointment_id), recallAppointmentId]);
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

export async function updateComplementaryRecallInstructions(client: PoolClient, id: number, input: { receptionInstruction: string | null; technologistInstruction: string; reasonCode: unknown; qaClassification: unknown; urgency: unknown; dueAt: unknown; reportingDisposition?: unknown; actorUserId: number }): Promise<ComplementaryRecall> {
  const result = await client.query<RecallRow>(`select ${SELECT} from appointments_v2.complementary_recall_requests where id = $1 for update`, [id]);
  if (!result.rows[0]) throw new HttpError(404, "Additional imaging request not found.");
  const recall = map(result.rows[0]);
  if (recall.status !== "pending_scheduling" || recall.recallAppointmentId != null) throw new HttpError(409, "Additional imaging instructions can only be edited before a complementary appointment is booked.");
  const technologistInstruction = input.technologistInstruction.trim();
  if (!technologistInstruction) throw new HttpError(400, "Technologist instruction is required.");
  const receptionInstruction = input.receptionInstruction?.trim() || null;
  const reasonCode = normalizeEnum(input.reasonCode, REASON_CODES, "recall reason");
  const qaClassification = normalizeEnum(input.qaClassification, QA_CLASSIFICATIONS, "QA classification");
  const urgency = normalizeEnum(input.urgency, URGENCIES, "urgency");
  const dueAt = normalizeDueAt(input.dueAt);
  const meaningfulChange = (recall.receptionInstruction?.trim() || null) !== receptionInstruction || recall.technologistInstruction.trim() !== technologistInstruction || recall.reasonCode !== reasonCode || recall.urgency !== urgency || recall.dueAt !== dueAt;
  const acknowledgementClear = meaningfulChange ? ", reception_acknowledged_at = null, reception_acknowledged_by_user_id = null" : "";
  const changed = await client.query<RecallRow>(`update appointments_v2.complementary_recall_requests set reception_instruction = $2, technologist_instruction = $3, reason_code = $4, qa_classification = $5, urgency = $6, due_at = $7, reception_seen_at = null, reception_seen_by_user_id = null${acknowledgementClear} where id = $1 returning ${SELECT}`, [id, receptionInstruction, technologistInstruction, reasonCode, qaClassification, urgency, dueAt]);
  const updated = map(changed.rows[0]!);
  if (meaningfulChange && (recall.receptionAcknowledgedAt !== null || recall.receptionAcknowledgedByUserId !== null)) {
    await logAuditEntry({ entityType: "complementary_recall_request", entityId: id, actionType: "complementary_recall_acknowledgement_cleared_by_request_update", oldValues: { acknowledgedAt: recall.receptionAcknowledgedAt, acknowledgedByUserId: recall.receptionAcknowledgedByUserId }, newValues: { acknowledgedAt: null, acknowledgedByUserId: null, reason: "meaningful recall fields changed", changedByUserId: input.actorUserId }, changedByUserId: input.actorUserId }, client);
  }
  await logAuditEntry({ entityType: "complementary_recall_request", entityId: id, actionType: "complementary_recall_instructions_updated", oldValues: { receptionInstruction: recall.receptionInstruction, technologistInstruction: recall.technologistInstruction, reasonCode: recall.reasonCode, qaClassification: recall.qaClassification, urgency: recall.urgency, dueAt: recall.dueAt }, newValues: { receptionInstruction: updated.receptionInstruction, technologistInstruction: updated.technologistInstruction, reasonCode: updated.reasonCode, qaClassification: updated.qaClassification, urgency: updated.urgency, dueAt: updated.dueAt }, changedByUserId: input.actorUserId }, client);
  return updated;
}

/** @deprecated Use reopenComplementaryRecallForUncompletedBooking with an outcome reason. */
export const reopenComplementaryRecallForCancelledBooking = (client: PoolClient, bookingId: number, actorUserId: number) => reopenComplementaryRecallForUncompletedBooking(client, bookingId, actorUserId, "cancelled");
/** @deprecated Use withdrawComplementaryRecall. */
export const cancelComplementaryRecall = withdrawComplementaryRecall;
