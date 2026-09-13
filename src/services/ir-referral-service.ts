import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type { Role } from "../types/domain.js";
import type { UserId } from "../types/http.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import { deleteDocumentById, uploadDocument, type DocumentRow, type DocumentUploadPayload } from "./document-service.js";
import { findActiveDoctorProfileByUserId } from "../modules/doctor-portal/profile-repository.js";
import { enqueueEmail } from "./email-outbox-service.js";
import { createIrReferralReadyNotification } from "../modules/doctor-portal/reporting-board-repository.js";

export type IrReferralStatus = "preparing" | "ready_for_review" | "needs_information" | "appointment_requested" | "scheduled" | "not_suitable" | "completed" | "cancelled";
export type IrReferralActor = { userId: UserId; appRole: Role };

export type IrReferralRow = {
  id: number; patientId: number; patientMrn: string | null; patientEnglishName: string | null; patientArabicName: string | null;
  requestedProcedure: string; clinicalIndication: string | null; status: IrReferralStatus;
  assignedDoctorId: number | null; assignedDoctorName: string | null; assignedDoctorNameAr: string | null; assignedDoctorNameEn: string | null;
  notifyAssignedDoctor: boolean; documentsConfirmed: boolean; imagesConfirmed: boolean; materialsConfirmed: boolean;
  materialsConfirmedBy: number | null; materialsConfirmedAt: string | null; materialsConfirmationNote: string | null;
  assessmentText: string | null; decision: string | null; decisionNote: string | null; reviewedByDoctorId: number | null; reviewedAt: string | null;
  createdByUserId: number; createdByName: string | null; createdAt: string; updatedAt: string; documentCount: number; remapJobId: number | null; remapJobStatus: string | null; scheduleRequestId: number | null;
};

const CREATE_ROLES = new Set<Role>(["receptionist", "administrative", "modality_staff", "doctor", "supervisor", "super_admin"]);
const PREPARE_ROLES = new Set<Role>(["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"]);
const MANAGER_ROLES = new Set<Role>(["supervisor", "super_admin"]);
const SELECT = `
  select ir.id, ir.patient_id as "patientId", p.mrn as "patientMrn", p.english_full_name as "patientEnglishName", p.arabic_full_name as "patientArabicName",
    ir.requested_procedure as "requestedProcedure", ir.clinical_indication as "clinicalIndication", ir.status,
    ir.assigned_doctor_id as "assignedDoctorId", dp.display_name as "assignedDoctorName", du.full_name as "assignedDoctorNameAr", du.english_name as "assignedDoctorNameEn",
    ir.notify_assigned_doctor as "notifyAssignedDoctor", ir.documents_confirmed as "documentsConfirmed", ir.images_confirmed as "imagesConfirmed", ir.materials_confirmed as "materialsConfirmed",
    ir.materials_confirmed_by as "materialsConfirmedBy", ir.materials_confirmed_at as "materialsConfirmedAt", ir.materials_confirmation_note as "materialsConfirmationNote",
    ir.assessment_text as "assessmentText", ir.decision, ir.decision_note as "decisionNote", ir.reviewed_by_doctor_id as "reviewedByDoctorId", ir.reviewed_at as "reviewedAt",
    ir.created_by_user_id as "createdByUserId", cu.full_name as "createdByName", ir.created_at as "createdAt", ir.updated_at as "updatedAt",
    (select count(*)::integer from ir_referral_documents ird where ird.ir_referral_case_id = ir.id) as "documentCount",
    remap.id as "remapJobId", remap.status as "remapJobStatus", schedule.id as "scheduleRequestId"
  from ir_referral_cases ir
  join patients p on p.id = ir.patient_id
  left join doctor_portal.doctor_profiles dp on dp.id = ir.assigned_doctor_id
  left join users du on du.id = dp.user_id
  join users cu on cu.id = ir.created_by_user_id
  left join lateral (select id, status from dicom_remap_jobs where ir_referral_case_id = ir.id order by created_at desc limit 1) remap on true
  left join lateral (select id from ir_referral_schedule_requests where ir_referral_case_id = ir.id and status = 'pending_scheduling' order by requested_at desc limit 1) schedule on true`;

function id(value: unknown, name: string): number { const result = normalizePositiveInteger(value, name); if (!result) throw new HttpError(400, `${name} is required.`); return result; }
function requiredText(value: unknown, name: string): string { const text = String(value ?? "").trim(); if (!text) throw new HttpError(400, `${name} is required.`); return text; }
function optionalText(value: unknown): string | null { const text = String(value ?? "").trim(); return text || null; }
function asRow(row: Record<string, unknown>): IrReferralRow { return { ...row, id: Number(row.id), patientId: Number(row.patientId), assignedDoctorId: row.assignedDoctorId == null ? null : Number(row.assignedDoctorId), materialsConfirmedBy: row.materialsConfirmedBy == null ? null : Number(row.materialsConfirmedBy), reviewedByDoctorId: row.reviewedByDoctorId == null ? null : Number(row.reviewedByDoctorId), createdByUserId: Number(row.createdByUserId), documentCount: Number(row.documentCount || 0), remapJobId: row.remapJobId == null ? null : Number(row.remapJobId), scheduleRequestId: row.scheduleRequestId == null ? null : Number(row.scheduleRequestId) } as IrReferralRow; }
async function audit(actor: IrReferralActor, actionType: string, referralId: number, newValues: Record<string, unknown>, db: PoolClient | typeof pool = pool) { await logAuditEntry({ entityType: "ir_referral_case", entityId: referralId, actionType, newValues, changedByUserId: actor.userId }, db); }
async function lock(caseId: number, db: PoolClient): Promise<IrReferralRow> { const found = await db.query(`${SELECT} where ir.id = $1 for update of ir`, [caseId]); if (!found.rows[0]) throw new HttpError(404, "IR referral not found."); return asRow(found.rows[0]); }
async function activeDoctor(doctorId: number, db: PoolClient | typeof pool = pool) { const result = await db.query<{ id: number }>(`select dp.id from doctor_portal.doctor_profiles dp join users u on u.id = dp.user_id where dp.id = $1 and dp.active = true and u.is_active = true and u.role in ('doctor','supervisor','super_admin') limit 1`, [doctorId]); if (!result.rows[0]) throw new HttpError(400, "Assigned IR doctor must have an active Doctor Workspace profile."); }

export async function listAssignableIrDoctors() { const result = await pool.query(`select dp.id, dp.display_name as "displayName", u.full_name as "fullName", u.english_name as "englishName", u.username from doctor_portal.doctor_profiles dp join users u on u.id = dp.user_id where dp.active = true and u.is_active = true and u.role in ('doctor','supervisor','super_admin') order by coalesce(u.english_name, u.full_name, dp.display_name), dp.id`); return result.rows.map((row) => ({ ...row, id: Number(row.id) })); }
export async function findIrReferralById(caseIdInput: unknown, db: PoolClient | typeof pool = pool) { const result = await db.query(`${SELECT} where ir.id = $1 limit 1`, [id(caseIdInput, "irReferralId")]); return result.rows[0] ? asRow(result.rows[0]) : null; }
export async function listIrReferrals(filters: { status?: unknown; q?: unknown } = {}) { const values: unknown[] = []; const where: string[] = []; const status = optionalText(filters.status); const q = optionalText(filters.q); if (status && status !== "all") { values.push(status); where.push(`ir.status = $${values.length}`); } if (q) { values.push(`%${q}%`); where.push(`(p.mrn ilike $${values.length} or p.english_full_name ilike $${values.length} or p.arabic_full_name ilike $${values.length} or ir.requested_procedure ilike $${values.length})`); } const result = await pool.query(`${SELECT}${where.length ? ` where ${where.join(" and ")}` : ""} order by ir.created_at desc`, values); return result.rows.map(asRow); }
export async function listMyIrReferralWorklist(actor: IrReferralActor) { const profile = await findActiveDoctorProfileByUserId(actor.userId); if (!profile) throw new HttpError(403, "An active Doctor Workspace profile is required."); const result = await pool.query(`${SELECT} where ir.assigned_doctor_id = $1 and ir.status in ('preparing','ready_for_review','needs_information','appointment_requested') order by case ir.status when 'ready_for_review' then 0 else 1 end, ir.created_at asc`, [profile.id]); return result.rows.map(asRow); }
export async function recordIrReferralDecision(actor: IrReferralActor, caseIdInput: unknown, input: { assessmentText?: unknown; decision: unknown; decisionNote?: unknown }) { const profile = await findActiveDoctorProfileByUserId(actor.userId); if (!profile) throw new HttpError(403, "An active Doctor Workspace profile is required."); const caseId=id(caseIdInput,"irReferralId"); const decision=requiredText(input.decision,"decision"); if (!["eligible_for_intervention","needs_information","not_suitable"].includes(decision)) throw new HttpError(400,"Invalid IR decision."); const note=optionalText(input.decisionNote); if ((decision === "needs_information" || decision === "not_suitable") && !note) throw new HttpError(400,"A decision note is required."); const client=await pool.connect(); try { await client.query("begin"); const referral=await lock(caseId,client); if (referral.assignedDoctorId !== profile.id && !MANAGER_ROLES.has(actor.appRole)) throw new HttpError(403,"Only the assigned IR doctor can record this decision."); if (referral.status !== "ready_for_review") throw new HttpError(409,"Only ready IR referrals can be reviewed."); const status=decision === "needs_information" ? "needs_information" : decision === "not_suitable" ? "not_suitable" : "ready_for_review"; await client.query(`update ir_referral_cases set assessment_text=$2, decision=$3, decision_note=$4, reviewed_by_doctor_id=$5, reviewed_at=now(), status=$6, updated_at=now() where id=$1`,[caseId,optionalText(input.assessmentText),decision,note,profile.id,status]); const updated=await lock(caseId,client); await audit(actor,"ir_referral_decision_recorded",caseId,{decision,status},client); await client.query("commit"); return updated; } catch(error) { await client.query("rollback"); throw error; } finally {client.release();} }
export async function createIrReferral(actor: IrReferralActor, input: { patientId: unknown; requestedProcedure: unknown; clinicalIndication?: unknown; assignedDoctorId: unknown; notifyAssignedDoctor?: unknown }) {
  if (!CREATE_ROLES.has(actor.appRole)) throw new HttpError(403, "This role cannot create IR referrals.");
  const patientId = id(input.patientId, "patientId"); const doctorId = id(input.assignedDoctorId, "assignedDoctorId"); const requestedProcedure = requiredText(input.requestedProcedure, "requestedProcedure");
  const client = await pool.connect(); try { await client.query("begin"); const patient = await client.query("select id from patients where id = $1 for key share", [patientId]); if (!patient.rows[0]) throw new HttpError(404, "Patient not found."); await activeDoctor(doctorId, client);
    const inserted = await client.query<{ id: number }>(`insert into ir_referral_cases(patient_id, requested_procedure, clinical_indication, assigned_doctor_id, notify_assigned_doctor, created_by_user_id) values($1,$2,$3,$4,$5,$6) returning id`, [patientId, requestedProcedure, optionalText(input.clinicalIndication), doctorId, input.notifyAssignedDoctor === true, actor.userId]); const caseId = Number(inserted.rows[0].id);
    await client.query(`insert into doctor_portal.ir_referral_assignments(ir_referral_case_id, assigned_doctor_id, assigned_by_user_id) values($1,$2,$3)`, [caseId, doctorId, actor.userId]); await audit(actor, "ir_referral_created", caseId, { patientId, doctorId }, client); await audit(actor, "ir_referral_doctor_assigned", caseId, { doctorId }, client); const referral = await lock(caseId, client); await client.query("commit"); return referral;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
export async function listIrReferralDocuments(caseIdInput: unknown) { const caseId = id(caseIdInput, "irReferralId"); const result = await pool.query<DocumentRow>(`select d.* from ir_referral_documents ird join documents d on d.id = ird.document_id where ird.ir_referral_case_id = $1 order by ird.created_at desc, d.id desc`, [caseId]); return result.rows; }
export async function attachDocumentToIrReferral(actor: IrReferralActor, caseIdInput: unknown, documentIdInput: unknown) { if (!PREPARE_ROLES.has(actor.appRole)) throw new HttpError(403, "This role cannot prepare IR referrals."); const caseId = id(caseIdInput, "irReferralId"); const documentId = id(documentIdInput, "documentId"); const client = await pool.connect(); try { await client.query("begin"); const referral = await lock(caseId, client); if (referral.status !== "preparing") throw new HttpError(409, "Only preparing IR referrals accept documents."); const document = (await client.query<DocumentRow>("select * from documents where id = $1 for update", [documentId])).rows[0]; if (!document) throw new HttpError(404, "Document not found."); if (Number(document.patient_id) !== referral.patientId) throw new HttpError(400, "Document patient does not match the IR referral patient."); await client.query(`insert into ir_referral_documents(ir_referral_case_id, document_id, created_by) values($1,$2,$3) on conflict do nothing`, [caseId, documentId, actor.userId]); await audit(actor, "ir_referral_document_attached", caseId, { documentId }, client); await client.query("commit"); return document; } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } }
export async function deleteIrReferralDocument(actor: IrReferralActor, caseIdInput: unknown, documentIdInput: unknown) {
  if (!MANAGER_ROLES.has(actor.appRole)) throw new HttpError(403, "This role cannot remove IR referral documents.");
  const caseId = id(caseIdInput, "irReferralId"); const documentId = id(documentIdInput, "documentId"); const client = await pool.connect();
  try {
    await client.query("begin"); const referral = await lock(caseId, client); if (referral.status !== "preparing") throw new HttpError(409, "Only preparing IR referrals can remove documents.");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`ir-referral-document:${documentId}`]);
    const linked = await client.query<{ appointment_id:number|null; v2_booking_id:number|null; other_ir_count:number; comparison_count:number }>(`select d.appointment_id, d.v2_booking_id, (select count(*)::integer from ir_referral_documents x where x.document_id=d.id and x.ir_referral_case_id<>$1) as other_ir_count, (select count(*)::integer from comparison_request_documents x where x.document_id=d.id) as comparison_count from ir_referral_documents link join documents d on d.id=link.document_id where link.ir_referral_case_id=$1 and link.document_id=$2 for update`, [caseId, documentId]);
    const row = linked.rows[0]; if (!row) throw new HttpError(404, "IR referral document link not found."); if (row.appointment_id != null || row.v2_booking_id != null || Number(row.other_ir_count) > 0 || Number(row.comparison_count) > 0) throw new HttpError(409, "This canonical document is used elsewhere and cannot be removed from storage.");
    await deleteDocumentById(documentId, actor.userId); await audit(actor, "ir_referral_document_removed", caseId, { documentId }, client); await client.query("commit"); return { deleted: true, documentId };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
export async function uploadIrReferralDocument(actor: IrReferralActor, caseIdInput: unknown, payload: DocumentUploadPayload) { const referral = await findIrReferralById(caseIdInput); if (!referral) throw new HttpError(404, "IR referral not found."); const document = await uploadDocument({ ...payload, patientId: referral.patientId, appointmentId: undefined, appointmentRefType: undefined, documentType: "ir_referral" }, actor.userId); try { return await attachDocumentToIrReferral(actor, referral.id, document.id); } catch (error) { await deleteDocumentById(document.id, actor.userId).catch(() => undefined); throw error; } }
async function queueIrReferralReadyEmail(referral: IrReferralRow, actor: IrReferralActor): Promise<void> { if (!referral.notifyAssignedDoctor || !referral.assignedDoctorId) return; const recipient = await pool.query<{ user_id:number; email:string|null; is_active:boolean }>(`select u.id as user_id,u.email,u.is_active from doctor_portal.doctor_profiles dp join users u on u.id=dp.user_id where dp.id=$1 and dp.active=true limit 1`,[referral.assignedDoctorId]); const user=recipient.rows[0]; if(!user?.is_active || !user.email?.trim()) { await audit(actor,"ir_referral_ready_email_recipient_unavailable",referral.id,{assignedDoctorId:referral.assignedDoctorId}); return; } const patient=referral.patientEnglishName||referral.patientArabicName||referral.patientMrn||`Patient ${referral.patientId}`; await enqueueEmail({eventType:"ir_referral_ready_for_review",recipientUserId:user.user_id,recipientEmail:user.email.trim(),subject:"IR consultation ready for review",textBody:`IR consultation ready for review.\n\nPatient: ${patient}${referral.patientMrn?`\nMRN: ${referral.patientMrn}`:""}\nRequested procedure: ${referral.requestedProcedure}\n\nOpen RISpro Doctor Workspace to review.`,idempotencyKey:`ir_referral_ready_for_review:${referral.id}:${user.user_id}`,relatedEntityType:"ir_referral_case",relatedEntityId:String(referral.id),createdByUserId:actor.userId}); await audit(actor,"ir_referral_ready_email_enqueued",referral.id,{assignedDoctorId:referral.assignedDoctorId}); }
async function queueIrReferralReadyNotification(referral: IrReferralRow, actor: IrReferralActor): Promise<void> {
  if (!referral.assignedDoctorId) return;
  const recipient = await pool.query<{ user_id: number }>(`select u.id as user_id from doctor_portal.doctor_profiles dp join users u on u.id = dp.user_id where dp.id = $1 and dp.active = true and u.is_active = true limit 1`, [referral.assignedDoctorId]);
  const user = recipient.rows[0];
  if (!user) return;
  const created = await createIrReferralReadyNotification({ referralId: referral.id, recipientDoctorId: referral.assignedDoctorId, recipientUserId: user.user_id });
  await audit(actor, "ir_referral_ready_notification_created", referral.id, { assignedDoctorId: referral.assignedDoctorId, created });
}

export async function confirmIrReferralMaterials(actor: IrReferralActor, caseIdInput: unknown, input: { documentsConfirmed?: unknown; imagesConfirmed?: unknown; note?: unknown }) {
  if (!PREPARE_ROLES.has(actor.appRole)) throw new HttpError(403, "This role cannot confirm IR referral materials.");
  if (input.documentsConfirmed !== true || input.imagesConfirmed !== true) throw new HttpError(400, "Both IR referral confirmations are required.");
  const caseId = id(caseIdInput, "irReferralId");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const referral = await lock(caseId, client);
    if (referral.status === "ready_for_review" && referral.materialsConfirmed) { await client.query("commit"); return referral; }
    if (referral.status !== "preparing") throw new HttpError(409, "Only preparing IR referrals can be confirmed.");
    await client.query(`update ir_referral_cases set status='ready_for_review', documents_confirmed=true, images_confirmed=true, materials_confirmed=true, materials_confirmed_by=$2, materials_confirmed_at=now(), materials_confirmation_note=$3, updated_at=now() where id=$1`, [caseId, actor.userId, optionalText(input.note)]);
    const updated = await lock(caseId, client);
    await audit(actor, "ir_referral_materials_confirmed", caseId, {}, client);
    await audit(actor, "ir_referral_ready_for_review", caseId, {}, client);
    await client.query("commit");
    await Promise.all([queueIrReferralReadyNotification(updated, actor), queueIrReferralReadyEmail(updated, actor)].map((task) => task.catch(() => undefined)));
    return updated;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export type IrReferralScheduleRequest = {
  id: number; irReferralCaseId: number; patientId: number; patientMrn: string | null; patientEnglishName: string | null; patientArabicName: string | null;
  requestedProcedure: string; assignedDoctorName: string | null; requestedModalityId: number; requestedExamTypeId: number; preferredDate: string | null;
  urgency: "same_day" | "within_24_hours" | "within_72_hours" | "routine"; receptionInstruction: string | null; technologistInstruction: string;
  status: "pending_scheduling" | "scheduled" | "cancelled"; appointmentId: number | null; requestedAt: string; scheduledAt: string | null;
};

const SCHEDULE_URGENCIES = new Set<IrReferralScheduleRequest["urgency"]>(["same_day", "within_24_hours", "within_72_hours", "routine"]);
const SCHEDULE_SELECT = `select sr.id, sr.ir_referral_case_id as "irReferralCaseId", ir.patient_id as "patientId", p.mrn as "patientMrn", p.english_full_name as "patientEnglishName", p.arabic_full_name as "patientArabicName", ir.requested_procedure as "requestedProcedure", coalesce(assigned_user.english_name, assigned_user.full_name, assigned_doctor.display_name) as "assignedDoctorName", sr.requested_modality_id as "requestedModalityId", sr.requested_exam_type_id as "requestedExamTypeId", sr.preferred_date as "preferredDate", sr.urgency, sr.reception_instruction as "receptionInstruction", sr.technologist_instruction as "technologistInstruction", sr.status, sr.appointment_id as "appointmentId", sr.requested_at as "requestedAt", sr.scheduled_at as "scheduledAt" from ir_referral_schedule_requests sr join ir_referral_cases ir on ir.id = sr.ir_referral_case_id join patients p on p.id = ir.patient_id left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = ir.assigned_doctor_id left join users assigned_user on assigned_user.id = assigned_doctor.user_id`;
function asScheduleRequest(row: Record<string, unknown>): IrReferralScheduleRequest { return { ...row, id: Number(row.id), irReferralCaseId: Number(row.irReferralCaseId), patientId: Number(row.patientId), requestedModalityId: Number(row.requestedModalityId), requestedExamTypeId: Number(row.requestedExamTypeId), appointmentId: row.appointmentId == null ? null : Number(row.appointmentId) } as IrReferralScheduleRequest; }
async function requireIrScheduleReviewer(actor: IrReferralActor, referral: IrReferralRow) { const profile = await findActiveDoctorProfileByUserId(actor.userId); if (!profile) throw new HttpError(403, "An active Doctor Workspace profile is required."); if (referral.assignedDoctorId !== profile.id && !MANAGER_ROLES.has(actor.appRole)) throw new HttpError(403, "Only the assigned IR doctor can request scheduling."); return profile; }

export async function createIrReferralScheduleRequest(actor: IrReferralActor, caseIdInput: unknown, input: { modalityId: unknown; examTypeId: unknown; preferredDate?: unknown; urgency: unknown; receptionInstruction?: unknown; technologistInstruction: unknown }) {
  const caseId = id(caseIdInput, "irReferralId"); const modalityId = id(input.modalityId, "modalityId"); const examTypeId = id(input.examTypeId, "examTypeId"); const urgency = requiredText(input.urgency, "urgency") as IrReferralScheduleRequest["urgency"];
  if (!SCHEDULE_URGENCIES.has(urgency)) throw new HttpError(400, "Invalid IR scheduling urgency.");
  const preferredDate = optionalText(input.preferredDate); if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) throw new HttpError(400, "preferredDate must be a date.");
  const client = await pool.connect();
  try {
    await client.query("begin"); const referral = await lock(caseId, client); await requireIrScheduleReviewer(actor, referral);
    if (referral.status !== "ready_for_review" || referral.decision !== "eligible_for_intervention") throw new HttpError(409, "Only an eligible ready IR referral can request an appointment.");
    const exam = await client.query("select id from exam_types where id = $1 and modality_id = $2", [examTypeId, modalityId]); if (!exam.rows[0]) throw new HttpError(400, "Requested examination does not belong to the selected modality.");
    const inserted = await client.query<{ id: number }>(`insert into ir_referral_schedule_requests(ir_referral_case_id, requested_by_user_id, requested_modality_id, requested_exam_type_id, preferred_date, urgency, reception_instruction, technologist_instruction) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [caseId, actor.userId, modalityId, examTypeId, preferredDate, urgency, optionalText(input.receptionInstruction), requiredText(input.technologistInstruction, "technologistInstruction")]);
    await client.query("update ir_referral_cases set status = 'appointment_requested', updated_at = now() where id = $1", [caseId]);
    const schedule = await client.query(`${SCHEDULE_SELECT} where sr.id = $1`, [inserted.rows[0]!.id]); await audit(actor, "ir_referral_scheduling_requested", caseId, { scheduleRequestId: inserted.rows[0]!.id, modalityId, examTypeId, urgency }, client); await client.query("commit"); return asScheduleRequest(schedule.rows[0]);
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export async function listIrReferralScheduleRequests() { const result = await pool.query(`${SCHEDULE_SELECT} where sr.status = 'pending_scheduling' order by sr.requested_at asc`); return result.rows.map(asScheduleRequest); }
export async function getIrReferralScheduleBookingContext(scheduleIdInput: unknown) { const result = await pool.query(`${SCHEDULE_SELECT} where sr.id = $1`, [id(scheduleIdInput, "irReferralScheduleRequestId")]); const schedule = result.rows[0] ? asScheduleRequest(result.rows[0]) : null; if (!schedule) throw new HttpError(404, "IR scheduling request not found."); if (schedule.status !== "pending_scheduling" || schedule.appointmentId != null) throw new HttpError(409, "IR scheduling request is not available for booking."); return schedule; }
export async function lockIrReferralScheduleRequestForBooking(client: PoolClient, scheduleIdInput: unknown, payload: { patientId: number; modalityId: number; examTypeId: number | null }): Promise<IrReferralScheduleRequest> { const result = await client.query(`${SCHEDULE_SELECT} where sr.id = $1 for update of sr`, [id(scheduleIdInput, "irReferralScheduleRequestId")]); const schedule = result.rows[0] ? asScheduleRequest(result.rows[0]) : null; if (!schedule) throw new HttpError(404, "IR scheduling request not found."); if (schedule.status !== "pending_scheduling" || schedule.appointmentId != null) throw new HttpError(409, "IR scheduling request is not available for booking."); if (schedule.patientId !== payload.patientId || schedule.requestedModalityId !== payload.modalityId || schedule.requestedExamTypeId !== payload.examTypeId) throw new HttpError(409, "IR appointment must use the requested patient, modality, and examination."); return schedule; }
export async function linkIrReferralScheduleBooking(client: PoolClient, schedule: IrReferralScheduleRequest, bookingId: number, actorUserId: number): Promise<void> { if (schedule.status === "scheduled" && schedule.appointmentId === bookingId) return; if (schedule.status !== "pending_scheduling" || schedule.appointmentId != null) throw new HttpError(409, "IR scheduling request is already linked to another appointment."); await client.query("update ir_referral_schedule_requests set appointment_id = $2, status = 'scheduled', scheduled_at = now() where id = $1", [schedule.id, bookingId]); await client.query("update ir_referral_cases set status = 'scheduled', updated_at = now() where id = $1", [schedule.irReferralCaseId]); await logAuditEntry({ entityType: "ir_referral_case", entityId: schedule.irReferralCaseId, actionType: "ir_referral_scheduled", newValues: { scheduleRequestId: schedule.id, appointmentId: bookingId }, changedByUserId: actorUserId }, client); }
