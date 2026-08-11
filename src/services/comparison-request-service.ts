import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type { Role } from "../types/domain.js";
import type { UserId } from "../types/http.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { findActiveDoctorProfileByUserId } from "../modules/doctor-portal/profile-repository.js";
import { insertDoctorAuditEvent } from "../modules/doctor-portal/profile-repository.js";
import { requireRosterManager } from "../modules/doctor-portal/roster-service.js";
import { createAssignedToMeNotifications, doctorCanReportAllModalities, findAssignableDoctorForReporting } from "../modules/doctor-portal/reporting-board-repository.js";
import type { ReportingBoardCaseRow, ReportingBoardFilters, ReportingBoardStatsBaseRow } from "../modules/doctor-portal/reporting-board-types.js";

export type ComparisonRequestStatus =
  | "pending_upload_confirmation"
  | "ready_for_reporting"
  | "assigned"
  | "finalized"
  | "cancelled";

export interface ComparisonActor {
  userId: UserId;
  appRole: Role;
}

export interface PreviousCompletedStudy {
  bookingId: number;
  patientId: number;
  date: string;
  time: string | null;
  modalityId: number;
  modalityCode: string;
  modalityName: string;
  examTypeId: number | null;
  examName: string | null;
  accessionNumber: string;
  studyInstanceUid: string | null;
  reportStatus: "unknown";
}

export interface ComparisonRequestRow {
  id: number;
  patientId: number;
  patientMrn: string | null;
  patientEnglishName: string | null;
  patientArabicName: string | null;
  linkedPreviousBookingId: number;
  linkedPreviousStudyUid: string | null;
  linkedPreviousAccessionNumber: string | null;
  linkedModalityId: number | null;
  linkedModalityCode: string | null;
  linkedModalityName: string | null;
  linkedExamTypeId: number | null;
  linkedExamName: string | null;
  linkedStudyDate: string | null;
  reason: string;
  status: ComparisonRequestStatus;
  materialsConfirmed: boolean;
  materialsConfirmedBy: number | null;
  materialsConfirmedByName: string | null;
  materialsConfirmedAt: string | null;
  materialsConfirmationNote: string | null;
  imageAvailabilityConfirmed: boolean;
  documentsAvailabilityConfirmed: boolean;
  selectedPriorConfirmed: boolean;
  assignedDoctorId: number | null;
  assignedDoctorName: string | null;
  finalizedBy: number | null;
  finalizedByName: string | null;
  finalizedAt: string | null;
  finalText: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledBy: number | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

const CREATE_ROLES = new Set<Role>(["receptionist", "administrative", "modality_staff", "doctor", "supervisor", "super_admin"]);
const CONFIRM_ROLES = new Set<Role>(["modality_staff", "doctor", "supervisor", "super_admin"]);
const CANCEL_ROLES = new Set<Role>(["supervisor", "super_admin"]);

function optionalIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function cleanRequiredText(value: unknown, field: string): string {
  const clean = String(value ?? "").trim();
  if (!clean) throw new HttpError(400, `${field} is required.`);
  return clean;
}

function cleanOptionalText(value: unknown): string | null {
  const clean = String(value ?? "").trim();
  return clean || null;
}

function normalizeId(value: unknown, field: string): number {
  const parsed = normalizePositiveInteger(value, field);
  if (!parsed) throw new HttpError(400, `${field} is required.`);
  return parsed;
}

function actorDoctorId(profile: { id: number } | null | undefined): number | null {
  return profile?.id ?? null;
}

async function audit(
  db: PoolClient | typeof pool,
  actor: ComparisonActor,
  eventType: string,
  request: Pick<ComparisonRequestRow, "id" | "patientId" | "linkedPreviousBookingId" | "linkedModalityId" | "linkedModalityCode"> | null,
  metadata: Record<string, unknown> = {},
  reason: string | null = null,
  actorDoctor: { id: number } | null = null
) {
  await insertDoctorAuditEvent(db, {
    actorUserId: actor.userId,
    actorDoctorId: actorDoctorId(actorDoctor),
    eventType,
    targetType: "comparison_request",
    targetId: request?.id ?? null,
    metadata: {
      comparisonRequestId: request?.id ?? null,
      patientId: request?.patientId ?? null,
      linkedPreviousBookingId: request?.linkedPreviousBookingId ?? null,
      linkedModalityId: request?.linkedModalityId ?? null,
      linkedModalityCode: request?.linkedModalityCode ?? null,
      actorUserId: actor.userId,
      actorRole: actor.appRole,
      ...metadata,
    },
    reason,
  });
}

function comparisonRequest(row: Record<string, unknown>): ComparisonRequestRow {
  return {
    id: Number(row.id),
    patientId: Number(row.patientId),
    patientMrn: row.patientMrn == null ? null : String(row.patientMrn),
    patientEnglishName: row.patientEnglishName == null ? null : String(row.patientEnglishName),
    patientArabicName: row.patientArabicName == null ? null : String(row.patientArabicName),
    linkedPreviousBookingId: Number(row.linkedPreviousBookingId),
    linkedPreviousStudyUid: row.linkedPreviousStudyUid == null ? null : String(row.linkedPreviousStudyUid),
    linkedPreviousAccessionNumber: row.linkedPreviousAccessionNumber == null ? null : String(row.linkedPreviousAccessionNumber),
    linkedModalityId: row.linkedModalityId == null ? null : Number(row.linkedModalityId),
    linkedModalityCode: row.linkedModalityCode == null ? null : String(row.linkedModalityCode),
    linkedModalityName: row.linkedModalityName == null ? null : String(row.linkedModalityName),
    linkedExamTypeId: row.linkedExamTypeId == null ? null : Number(row.linkedExamTypeId),
    linkedExamName: row.linkedExamName == null ? null : String(row.linkedExamName),
    linkedStudyDate: row.linkedStudyDate == null ? null : String(row.linkedStudyDate),
    reason: String(row.reason ?? ""),
    status: row.status as ComparisonRequestStatus,
    materialsConfirmed: Boolean(row.materialsConfirmed),
    materialsConfirmedBy: row.materialsConfirmedBy == null ? null : Number(row.materialsConfirmedBy),
    materialsConfirmedByName: row.materialsConfirmedByName == null ? null : String(row.materialsConfirmedByName),
    materialsConfirmedAt: optionalIso(row.materialsConfirmedAt),
    materialsConfirmationNote: row.materialsConfirmationNote == null ? null : String(row.materialsConfirmationNote),
    imageAvailabilityConfirmed: Boolean(row.imageAvailabilityConfirmed),
    documentsAvailabilityConfirmed: Boolean(row.documentsAvailabilityConfirmed),
    selectedPriorConfirmed: Boolean(row.selectedPriorConfirmed),
    assignedDoctorId: row.assignedDoctorId == null ? null : Number(row.assignedDoctorId),
    assignedDoctorName: row.assignedDoctorName == null ? null : String(row.assignedDoctorName),
    finalizedBy: row.finalizedBy == null ? null : Number(row.finalizedBy),
    finalizedByName: row.finalizedByName == null ? null : String(row.finalizedByName),
    finalizedAt: optionalIso(row.finalizedAt),
    finalText: row.finalText == null ? null : String(row.finalText),
    createdBy: row.createdBy == null ? null : Number(row.createdBy),
    createdByName: row.createdByName == null ? null : String(row.createdByName),
    createdAt: optionalIso(row.createdAt) ?? "",
    updatedAt: optionalIso(row.updatedAt) ?? "",
    cancelledBy: row.cancelledBy == null ? null : Number(row.cancelledBy),
    cancelledAt: optionalIso(row.cancelledAt),
    cancellationReason: row.cancellationReason == null ? null : String(row.cancellationReason),
  };
}

const COMPARISON_SELECT = `
  select
    cr.id,
    cr.patient_id as "patientId",
    p.mrn as "patientMrn",
    p.english_full_name as "patientEnglishName",
    p.arabic_full_name as "patientArabicName",
    cr.linked_previous_booking_id as "linkedPreviousBookingId",
    cr.linked_previous_study_uid as "linkedPreviousStudyUid",
    cr.linked_previous_accession_number as "linkedPreviousAccessionNumber",
    cr.linked_modality_id as "linkedModalityId",
    cr.linked_modality_code as "linkedModalityCode",
    m.name_en as "linkedModalityName",
    cr.linked_exam_type_id as "linkedExamTypeId",
    cr.linked_exam_name as "linkedExamName",
    cr.linked_study_date::text as "linkedStudyDate",
    cr.reason,
    cr.status,
    cr.materials_confirmed as "materialsConfirmed",
    cr.materials_confirmed_by as "materialsConfirmedBy",
    confirmed_by.full_name as "materialsConfirmedByName",
    cr.materials_confirmed_at as "materialsConfirmedAt",
    cr.materials_confirmation_note as "materialsConfirmationNote",
    cr.image_availability_confirmed as "imageAvailabilityConfirmed",
    cr.documents_availability_confirmed as "documentsAvailabilityConfirmed",
    cr.selected_prior_confirmed as "selectedPriorConfirmed",
    cr.assigned_doctor_id as "assignedDoctorId",
    assigned_doctor.display_name as "assignedDoctorName",
    cr.finalized_by as "finalizedBy",
    finalized_by.full_name as "finalizedByName",
    cr.finalized_at as "finalizedAt",
    cr.final_text as "finalText",
    cr.created_by as "createdBy",
    created_by.full_name as "createdByName",
    cr.created_at as "createdAt",
    cr.updated_at as "updatedAt",
    cr.cancelled_by as "cancelledBy",
    cr.cancelled_at as "cancelledAt",
    cr.cancellation_reason as "cancellationReason"
  from comparison_requests cr
  join patients p on p.id = cr.patient_id
  left join modalities m on m.id = cr.linked_modality_id
  left join users confirmed_by on confirmed_by.id = cr.materials_confirmed_by
  left join users finalized_by on finalized_by.id = cr.finalized_by
  left join users created_by on created_by.id = cr.created_by
  left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cr.assigned_doctor_id
`;

export async function listPreviousCompletedStudiesForPatient(patientIdInput: unknown): Promise<PreviousCompletedStudy[]> {
  const patientId = normalizeId(patientIdInput, "patientId");
  const result = await pool.query(
    `
      select
        b.id as "bookingId",
        b.patient_id as "patientId",
        b.booking_date::text as date,
        b.booking_time::text as time,
        b.modality_id as "modalityId",
        m.code as "modalityCode",
        m.name_en as "modalityName",
        b.exam_type_id as "examTypeId",
        et.name_en as "examName",
        ('V2-' || lpad(b.id::text, 6, '0')) as "accessionNumber",
        b.study_instance_uid as "studyInstanceUid"
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      where b.patient_id = $1
        and b.status = 'completed'
      order by b.booking_date desc, b.booking_time desc nulls last, b.id desc
      limit 100
    `,
    [patientId]
  );
  return result.rows.map((row) => ({
    bookingId: Number(row.bookingId),
    patientId: Number(row.patientId),
    date: String(row.date),
    time: row.time == null ? null : String(row.time),
    modalityId: Number(row.modalityId),
    modalityCode: String(row.modalityCode ?? ""),
    modalityName: String(row.modalityName ?? row.modalityCode ?? ""),
    examTypeId: row.examTypeId == null ? null : Number(row.examTypeId),
    examName: row.examName == null ? null : String(row.examName),
    accessionNumber: String(row.accessionNumber),
    studyInstanceUid: row.studyInstanceUid == null ? null : String(row.studyInstanceUid),
    reportStatus: "unknown",
  }));
}

export async function createComparisonRequest(
  actor: ComparisonActor,
  input: { patientId: unknown; linkedPreviousBookingId: unknown; reason: unknown }
): Promise<ComparisonRequestRow> {
  if (!CREATE_ROLES.has(actor.appRole)) throw new HttpError(403, "This role cannot create comparison requests.");
  const patientId = normalizeId(input.patientId, "patientId");
  const linkedPreviousBookingId = normalizeId(input.linkedPreviousBookingId, "linkedPreviousBookingId");
  const reason = cleanRequiredText(input.reason, "reason");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const previous = await client.query(
      `
        select
          b.id,
          b.patient_id,
          b.study_instance_uid,
          b.modality_id,
          m.code as modality_code,
          b.exam_type_id,
          et.name_en as exam_name,
          b.booking_date::text as study_date,
          ('V2-' || lpad(b.id::text, 6, '0')) as accession_number
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        where b.id = $1
          and b.patient_id = $2
          and b.status = 'completed'
        limit 1
      `,
      [linkedPreviousBookingId, patientId]
    );
    const previousRow = previous.rows[0];
    if (!previousRow) throw new HttpError(400, "A completed previous RISpro study is required.");

    const created = await client.query(
      `
        insert into comparison_requests (
          patient_id,
          linked_previous_booking_id,
          linked_previous_study_uid,
          linked_previous_accession_number,
          linked_modality_id,
          linked_modality_code,
          linked_exam_type_id,
          linked_exam_name,
          linked_study_date,
          reason,
          created_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11)
        returning id
      `,
      [
        patientId,
        linkedPreviousBookingId,
        previousRow.study_instance_uid ?? null,
        previousRow.accession_number ?? null,
        previousRow.modality_id ?? null,
        previousRow.modality_code ?? null,
        previousRow.exam_type_id ?? null,
        previousRow.exam_name ?? null,
        previousRow.study_date ?? null,
        reason,
        actor.userId,
      ]
    );
    const request = await findComparisonRequestById(created.rows[0].id, client);
    if (!request) throw new HttpError(500, "Failed to create comparison request.");
    await audit(client, actor, "comparison_request_created", request, { reason }, reason);
    await audit(client, actor, "comparison_previous_study_selected", request, { linkedPreviousBookingId }, null);
    await client.query("commit");
    return request;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function findComparisonRequestById(idInput: unknown, db: PoolClient | typeof pool = pool): Promise<ComparisonRequestRow | null> {
  const id = normalizeId(idInput, "comparisonRequestId");
  const result = await db.query(`${COMPARISON_SELECT} where cr.id = $1 limit 1`, [id]);
  return result.rows[0] ? comparisonRequest(result.rows[0]) : null;
}

export async function listComparisonRequests(filters: { status?: unknown } = {}): Promise<ComparisonRequestRow[]> {
  const status = cleanOptionalText(filters.status);
  const values: unknown[] = [];
  const where: string[] = [];
  if (status) {
    values.push(status);
    where.push(`cr.status = $${values.length}`);
  }
  const result = await pool.query(
    `
      ${COMPARISON_SELECT}
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by cr.created_at desc, cr.id desc
      limit 300
    `,
    values
  );
  return result.rows.map(comparisonRequest);
}

async function lockComparisonRequest(id: number, client: PoolClient): Promise<ComparisonRequestRow> {
  const locked = await client.query(`select id from comparison_requests where id = $1 for update`, [id]);
  if (!locked.rows[0]) throw new HttpError(404, "Comparison request not found.");
  const request = await findComparisonRequestById(id, client);
  if (!request) throw new HttpError(404, "Comparison request not found.");
  return request;
}

export async function confirmComparisonMaterials(
  actor: ComparisonActor,
  idInput: unknown,
  input: {
    imageAvailabilityConfirmed?: unknown;
    documentsAvailabilityConfirmed?: unknown;
    selectedPriorConfirmed?: unknown;
    note?: unknown;
  }
): Promise<ComparisonRequestRow> {
  const id = normalizeId(idInput, "comparisonRequestId");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await lockComparisonRequest(id, client);
    const actorProfile = await findActiveDoctorProfileByUserId(actor.userId).catch(() => null);
    if (!CONFIRM_ROLES.has(actor.appRole)) {
      await audit(client, actor, "comparison_materials_confirmation_denied", request, { deniedReason: "role_not_allowed" }, null, actorProfile);
      throw new HttpError(403, "This role cannot confirm comparison materials.");
    }
    if (request.status !== "pending_upload_confirmation") {
      throw new HttpError(409, "Only pending comparison requests can be confirmed.");
    }
    if (
      input.imageAvailabilityConfirmed !== true ||
      input.documentsAvailabilityConfirmed !== true ||
      input.selectedPriorConfirmed !== true
    ) {
      throw new HttpError(400, "All comparison readiness confirmations are required.");
    }
    const note = cleanOptionalText(input.note);
    await client.query(
      `
        update comparison_requests
        set
          status = 'ready_for_reporting',
          materials_confirmed = true,
          materials_confirmed_by = $2,
          materials_confirmed_at = now(),
          materials_confirmation_note = $3,
          image_availability_confirmed = true,
          documents_availability_confirmed = true,
          selected_prior_confirmed = true,
          updated_at = now()
        where id = $1
      `,
      [id, actor.userId, note]
    );
    const updated = await findComparisonRequestById(id, client);
    if (!updated) throw new HttpError(404, "Comparison request not found.");
    await audit(client, actor, "comparison_materials_confirmed", updated, { note }, note, actorProfile);
    await audit(client, actor, "comparison_released_to_reporting_pool", updated, { linkedModalityId: updated.linkedModalityId }, null, actorProfile);
    await client.query("commit");
    return updated;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelComparisonRequest(actor: ComparisonActor, idInput: unknown, reasonInput: unknown): Promise<ComparisonRequestRow> {
  if (!CANCEL_ROLES.has(actor.appRole)) throw new HttpError(403, "This role cannot cancel comparison requests.");
  const id = normalizeId(idInput, "comparisonRequestId");
  const reason = cleanRequiredText(reasonInput, "reason");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await lockComparisonRequest(id, client);
    if (request.status === "finalized") throw new HttpError(409, "Finalized comparison requests cannot be cancelled.");
    await client.query(
      `
        update comparison_requests
        set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancellation_reason = $3, updated_at = now()
        where id = $1
      `,
      [id, actor.userId, reason]
    );
    await client.query(
      `
        update doctor_portal.comparison_case_assignments
        set status = 'cancelled', updated_at = now()
        where comparison_request_id = $1 and status = 'active'
      `,
      [id]
    );
    const updated = await findComparisonRequestById(id, client);
    if (!updated) throw new HttpError(404, "Comparison request not found.");
    await audit(client, actor, "comparison_cancelled", updated, { reason }, reason);
    await client.query("commit");
    return updated;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function assignComparisonRequest(
  actor: ComparisonActor,
  idInput: unknown,
  input: { doctorId: unknown; reason?: unknown }
): Promise<{ assignmentId: number; comparisonRequestId: number }> {
  const manager = await requireRosterManager(actor);
  const id = normalizeId(idInput, "comparisonRequestId");
  const doctorId = normalizeId(input.doctorId, "doctorId");
  const reason = cleanOptionalText(input.reason);
  const doctor = await findAssignableDoctorForReporting(doctorId);
  if (!doctor || !doctor.canFinalizeReports) throw new HttpError(404, "Active reporting doctor not found.");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await lockComparisonRequest(id, client);
    if (!["ready_for_reporting", "assigned"].includes(request.status)) {
      throw new HttpError(409, "Only ready comparison requests can be assigned.");
    }
    if (!request.linkedModalityId) throw new HttpError(409, "Comparison request modality is missing.");
    if (!(await doctorCanReportAllModalities(doctorId, [request.linkedModalityId]))) {
      throw new HttpError(400, "Doctor cannot report this comparison modality.");
    }
    await client.query(
      `
        update doctor_portal.comparison_case_assignments
        set status = 'superseded', updated_at = now()
        where comparison_request_id = $1 and status = 'active'
      `,
      [id]
    );
    const inserted = await client.query<{ id: number }>(
      `
        insert into doctor_portal.comparison_case_assignments (
          comparison_request_id, assigned_doctor_id, modality_id, assigned_by_user_id, assigned_by_doctor_id, reason
        )
        values ($1, $2, $3, $4, $5, $6)
        returning id
      `,
      [id, doctorId, request.linkedModalityId, actor.userId, manager.profile!.id, reason]
    );
    const assignmentId = Number(inserted.rows[0].id);
    await client.query(
      `update comparison_requests set status = 'assigned', assigned_doctor_id = $2, updated_at = now() where id = $1`,
      [id, doctorId]
    );
    const updated = await findComparisonRequestById(id, client);
    if (!updated) throw new HttpError(404, "Comparison request not found.");
    await audit(client, actor, "comparison_assigned", updated, { assignmentId, doctorId, noteForDoctor: reason }, reason, manager.profile);
    await client.query("commit");
    await createAssignedToMeNotifications({ doctorId, comparisonRequestIds: [id] });
    return { assignmentId, comparisonRequestId: id };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function unassignComparisonRequest(
  actor: ComparisonActor,
  idInput: unknown,
  reasonInput: unknown
): Promise<{ unassigned: true; comparisonRequestId: number; assignmentId: number }> {
  const manager = await requireRosterManager(actor);
  const id = normalizeId(idInput, "comparisonRequestId");
  const reason = cleanRequiredText(reasonInput, "reason");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockComparisonRequest(id, client);
    const active = await client.query<{ id: number }>(
      `
        select id
        from doctor_portal.comparison_case_assignments
        where comparison_request_id = $1 and status = 'active'
        limit 1
        for update
      `,
      [id]
    );
    const assignmentId = active.rows[0]?.id;
    if (!assignmentId) throw new HttpError(404, "Active comparison assignment not found.");
    await client.query(
      `update doctor_portal.comparison_case_assignments set status = 'cancelled', updated_at = now() where id = $1`,
      [assignmentId]
    );
    await client.query(
      `update comparison_requests set status = 'ready_for_reporting', assigned_doctor_id = null, updated_at = now() where id = $1`,
      [id]
    );
    const updated = await findComparisonRequestById(id, client);
    if (!updated) throw new HttpError(404, "Comparison request not found.");
    await audit(client, actor, "comparison_unassigned", updated, { assignmentId }, reason, manager.profile);
    await client.query("commit");
    return { unassigned: true, comparisonRequestId: id, assignmentId: Number(assignmentId) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeComparisonRequest(
  actor: ComparisonActor,
  idInput: unknown,
  finalTextInput: unknown
): Promise<ComparisonRequestRow> {
  const id = normalizeId(idInput, "comparisonRequestId");
  const finalText = cleanRequiredText(finalTextInput, "finalText");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await lockComparisonRequest(id, client);
    const actorProfile = await findActiveDoctorProfileByUserId(actor.userId).catch(() => null);
    const activeAssignment = await client.query<{ assignedDoctorId: number | null }>(
      `
        select assigned_doctor_id as "assignedDoctorId"
        from doctor_portal.comparison_case_assignments
        where comparison_request_id = $1 and status = 'active'
        limit 1
      `,
      [id]
    );
    const assignedDoctorId = activeAssignment.rows[0]?.assignedDoctorId == null ? null : Number(activeAssignment.rows[0].assignedDoctorId);
    const supervisorAllowed = actor.appRole === "supervisor" || actor.appRole === "super_admin";
    const assignedDoctorAllowed =
      actor.appRole === "doctor" &&
      actorProfile?.canFinalizeReports === true &&
      actorProfile.id === assignedDoctorId;
    if (!supervisorAllowed && !assignedDoctorAllowed) {
      await audit(client, actor, "comparison_finalization_denied", request, { assignedDoctorId }, null, actorProfile);
      throw new HttpError(403, "You are not allowed to finalize this comparison request.");
    }
    if (!["assigned", "ready_for_reporting"].includes(request.status)) {
      throw new HttpError(409, "Only released comparison requests can be finalized.");
    }
    await client.query(
      `
        update comparison_requests
        set status = 'finalized', finalized_by = $2, finalized_at = now(), final_text = $3, updated_at = now()
        where id = $1
      `,
      [id, actor.userId, finalText]
    );
    const updated = await findComparisonRequestById(id, client);
    if (!updated) throw new HttpError(404, "Comparison request not found.");
    await audit(client, actor, "comparison_finalized", updated, { assignedDoctorId }, null, actorProfile);
    await client.query("commit");
    return updated;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getComparisonInternalLinkTarget(actor: ComparisonActor, idInput: unknown): Promise<{ comparisonRequest: ComparisonRequestRow; path: string }> {
  const request = await findComparisonRequestById(idInput);
  if (!request) throw new HttpError(404, "Comparison request not found.");
  const actorProfile = await findActiveDoctorProfileByUserId(actor.userId).catch(() => null);
  await audit(pool, actor, "comparison_internal_link_opened", request, {}, null, actorProfile).catch(() => undefined);
  return { comparisonRequest: request, path: `/comparisons/${request.id}` };
}

function addComparisonFilter(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function comparisonReportingWhere(filters: ReportingBoardFilters, values: unknown[]): string[] {
  const where = [`cr.status in ('ready_for_reporting', 'assigned', 'finalized')`];
  if (filters.dateFrom) where.push(`cr.created_at::date >= ${addComparisonFilter(values, filters.dateFrom)}::date`);
  if (filters.dateTo) where.push(`cr.created_at::date <= ${addComparisonFilter(values, filters.dateTo)}::date`);
  if (filters.modalityId) where.push(`cr.linked_modality_id = ${addComparisonFilter(values, filters.modalityId)}`);
  if (filters.modalityCode) where.push(`upper(cr.linked_modality_code) = ${addComparisonFilter(values, filters.modalityCode.toUpperCase())}`);
  if (filters.modalityCodes?.length) where.push(`upper(cr.linked_modality_code) = any(${addComparisonFilter(values, filters.modalityCodes.map((code) => code.toUpperCase()))}::text[])`);
  if (filters.assignedDoctorId) where.push(`cca.assigned_doctor_id = ${addComparisonFilter(values, filters.assignedDoctorId)}`);
  if (filters.assignmentStatus === "unassigned") where.push(`cca.id is null`);
  if (filters.assignmentStatus === "assigned") where.push(`cca.id is not null`);
  if (filters.comparisonRequestId) where.push(`cr.id = ${addComparisonFilter(values, filters.comparisonRequestId)}`);
  if (filters.caseCategory && filters.caseCategory !== "comparison") where.push(`false`);
  if (filters.priorityCode) where.push(`false`);
  if (filters.requiresReport === false) where.push(`false`);
  if (filters.q) {
    values.push(`%${filters.q.trim().toLowerCase()}%`);
    where.push(`(
      lower(coalesce(p.english_full_name, '')) like $${values.length}
      or lower(coalesce(p.arabic_full_name, '')) like $${values.length}
      or lower(coalesce(p.mrn, '')) like $${values.length}
      or lower(coalesce(cr.linked_previous_accession_number, '')) like $${values.length}
      or lower(coalesce(cr.linked_exam_name, '')) like $${values.length}
      or lower(coalesce(cr.reason, '')) like $${values.length}
    )`);
  }
  return where;
}

function comparisonReportingCaseRow(row: Record<string, unknown>): ReportingBoardCaseRow {
  const status = String(row.status || "");
  const finalizedAt = optionalIso(row.reportFinalAt);
  return {
    caseType: "comparison",
    caseKey: `comparison:${Number(row.comparisonRequestId)}`,
    appointmentId: Number(row.appointmentId),
    comparisonRequestId: Number(row.comparisonRequestId),
    patientId: Number(row.patientId),
    patientMrn: row.patientMrn == null ? null : String(row.patientMrn),
    patientDicomId: row.patientDicomId == null ? null : String(row.patientDicomId),
    patientEnglishName: row.patientEnglishName == null ? null : String(row.patientEnglishName),
    patientArabicName: row.patientArabicName == null ? null : String(row.patientArabicName),
    accessionNumber: String(row.accessionNumber ?? ""),
    studyInstanceUid: row.studyInstanceUid == null ? null : String(row.studyInstanceUid),
    bookingDate: String(row.bookingDate ?? ""),
    bookingTime: null,
    modalityId: Number(row.modalityId),
    modalityCode: String(row.modalityCode ?? ""),
    modalityName: String(row.modalityName ?? row.modalityCode ?? ""),
    examTypeId: row.examTypeId == null ? null : Number(row.examTypeId),
    examTypeName: row.examTypeName == null ? null : String(row.examTypeName),
    linkedPreviousBookingId: Number(row.appointmentId),
    linkedPreviousStudyDate: row.linkedPreviousStudyDate == null ? null : String(row.linkedPreviousStudyDate),
    linkedPreviousAccessionNumber: row.linkedPreviousAccessionNumber == null ? null : String(row.linkedPreviousAccessionNumber),
    caseCategory: "comparison",
    appointmentStatus: status,
    requiresReport: true,
    reportingPriorityId: null,
    reportingPriorityCode: null,
    reportingPriorityName: null,
    reportingPrioritySortOrder: null,
    assignedDoctorId: row.assignedDoctorId == null ? null : Number(row.assignedDoctorId),
    assignedDoctorName: row.assignedDoctorName == null ? null : String(row.assignedDoctorName),
    assignmentStatus: row.assignedDoctorId == null ? "unassigned" : "assigned",
    completedAt: optionalIso(row.completedAt),
    currentAssignedAt: optionalIso(row.currentAssignedAt),
    firstAssignedAt: optionalIso(row.currentAssignedAt),
    reportFinalAt: finalizedAt,
    reportStatusCheckedAt: new Date().toISOString(),
    reportStatusSource: "rispro",
    sonicDicomStudyNote: null,
    sonicDicomStudyNoteCheckedAt: null,
    sonicDicomStudyNoteSource: null,
    dueAt: null,
    completedToAssignedMinutes: null,
    assignedToFinalMinutes: null,
    completedToFinalMinutes: null,
    currentAssignmentAgeMinutes: null,
    completedUnassignedAgeMinutes: null,
    reportStatus: finalizedAt ? "final" : "no_report",
    canAssign: status !== "finalized",
    exclusionReason: status === "finalized" ? "report_final" : null,
  };
}

export async function listComparisonReportingBoardRows(
  filters: Required<Pick<ReportingBoardFilters, "limit" | "offset">> & ReportingBoardFilters
): Promise<ReportingBoardCaseRow[]> {
  const values: unknown[] = [];
  const where = comparisonReportingWhere(filters, values);
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  values.push(limit);
  const limitParam = values.length;
  values.push(offset);
  const offsetParam = values.length;
  const result = await pool.query(
    `
      select
        cr.id as "comparisonRequestId",
        cr.linked_previous_booking_id as "appointmentId",
        cr.patient_id as "patientId",
        p.mrn as "patientMrn",
        coalesce(
          nullif(trim(primary_identifier.value), ''),
          nullif(trim(p.identifier_value), ''),
          nullif(trim(p.national_id), '')
        ) as "patientDicomId",
        p.english_full_name as "patientEnglishName",
        p.arabic_full_name as "patientArabicName",
        cr.linked_previous_accession_number as "accessionNumber",
        cr.linked_previous_study_uid as "studyInstanceUid",
        cr.created_at::date::text as "bookingDate",
        cr.linked_modality_id as "modalityId",
        cr.linked_modality_code as "modalityCode",
        m.name_en as "modalityName",
        cr.linked_exam_type_id as "examTypeId",
        cr.linked_exam_name as "examTypeName",
        cr.linked_study_date::text as "linkedPreviousStudyDate",
        cr.linked_previous_accession_number as "linkedPreviousAccessionNumber",
        cr.status,
        cr.materials_confirmed_at as "completedAt",
        cca.assigned_at as "currentAssignedAt",
        cr.finalized_at as "reportFinalAt",
        cca.assigned_doctor_id as "assignedDoctorId",
        assigned_doctor.display_name as "assignedDoctorName"
      from comparison_requests cr
      join patients p on p.id = cr.patient_id
      left join modalities m on m.id = cr.linked_modality_id
      left join doctor_portal.comparison_case_assignments cca on cca.comparison_request_id = cr.id and cca.status = 'active'
      left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cca.assigned_doctor_id
      left join lateral (
        select pi.value
        from patient_identifiers pi
        where pi.patient_id = p.id
          and pi.is_primary = true
        order by pi.id asc
        limit 1
      ) primary_identifier on true
      where ${where.join(" and ")}
      order by cr.created_at desc, cr.id desc
      limit $${limitParam} offset $${offsetParam}
    `,
    values
  );
  return result.rows.map(comparisonReportingCaseRow);
}

export async function listComparisonReportingBoardStatsRows(filters: ReportingBoardFilters): Promise<ReportingBoardStatsBaseRow[]> {
  const rows = await listComparisonReportingBoardRows({ ...filters, limit: 1000, offset: 0 });
  return rows.map((row) => ({
    caseType: "comparison",
    appointmentId: row.appointmentId,
    comparisonRequestId: row.comparisonRequestId,
    bookingDate: row.bookingDate,
    appointmentStatus: row.appointmentStatus,
    modalityCode: row.modalityCode,
    requiresReport: true,
    reportingPriorityCode: null,
    reportingPriorityName: null,
    assignedDoctorId: row.assignedDoctorId,
    assignedDoctorName: row.assignedDoctorName,
    assignmentStatus: row.assignmentStatus,
    completedAt: row.completedAt,
    currentAssignedAt: row.currentAssignedAt,
    firstAssignedAt: row.firstAssignedAt,
    reportFinalAt: row.reportFinalAt,
    reportStatus: row.reportStatus,
  }));
}
