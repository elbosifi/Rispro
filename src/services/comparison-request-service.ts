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
import {
  deleteDocumentById,
  uploadDocument,
  type DocumentRow,
  type DocumentUploadPayload,
} from "./document-service.js";

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
  documentsDisposition: "attached_verified" | "not_required" | null;
  assignedDoctorId: number | null;
  assignedDoctorName: string | null;
  plannedReportingDoctorId: number | null;
  plannedReportingDoctorName: string | null;
  plannedReportingDoctorSetBy: number | null;
  plannedReportingDoctorSetAt: string | null;
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
  preparationReturnedBy: number | null;
  preparationReturnedByName: string | null;
  preparationReturnedAt: string | null;
  preparationReturnReason: string | null;
  documentCount: number;
  remapJobId: number | null;
  remapJobStatus: string | null;
  remapProcessingStage: string | null;
  remapSendErrorCode: string | null;
  remapErrorMessage: string | null;
  remapUpdatedAt: string | null;
}

const CREATE_ROLES = new Set<Role>(["receptionist", "administrative", "modality_staff", "doctor", "supervisor", "super_admin"]);
const CONFIRM_ROLES = new Set<Role>(["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"]);
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
    documentsDisposition: row.documentsDisposition === "attached_verified" || row.documentsDisposition === "not_required" ? row.documentsDisposition : null,
    assignedDoctorId: row.assignedDoctorId == null ? null : Number(row.assignedDoctorId),
    assignedDoctorName: row.assignedDoctorName == null ? null : String(row.assignedDoctorName),
    plannedReportingDoctorId: row.plannedReportingDoctorId == null ? null : Number(row.plannedReportingDoctorId),
    plannedReportingDoctorName: row.plannedReportingDoctorName == null ? null : String(row.plannedReportingDoctorName),
    plannedReportingDoctorSetBy: row.plannedReportingDoctorSetBy == null ? null : Number(row.plannedReportingDoctorSetBy),
    plannedReportingDoctorSetAt: optionalIso(row.plannedReportingDoctorSetAt),
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
    preparationReturnedBy: row.preparationReturnedBy == null ? null : Number(row.preparationReturnedBy),
    preparationReturnedByName: row.preparationReturnedByName == null ? null : String(row.preparationReturnedByName),
    preparationReturnedAt: optionalIso(row.preparationReturnedAt),
    preparationReturnReason: row.preparationReturnReason == null ? null : String(row.preparationReturnReason),
    documentCount: Number(row.documentCount ?? 0),
    remapJobId: row.remapJobId == null ? null : Number(row.remapJobId),
    remapJobStatus: row.remapJobStatus == null ? null : String(row.remapJobStatus),
    remapProcessingStage: row.remapProcessingStage == null ? null : String(row.remapProcessingStage),
    remapSendErrorCode: row.remapSendErrorCode == null ? null : String(row.remapSendErrorCode),
    remapErrorMessage: row.remapErrorMessage == null ? null : String(row.remapErrorMessage),
    remapUpdatedAt: optionalIso(row.remapUpdatedAt),
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
    cr.documents_disposition as "documentsDisposition",
    cr.assigned_doctor_id as "assignedDoctorId",
    assigned_doctor.display_name as "assignedDoctorName",
    cr.planned_reporting_doctor_id as "plannedReportingDoctorId",
    planned_doctor.display_name as "plannedReportingDoctorName",
    cr.planned_reporting_doctor_set_by as "plannedReportingDoctorSetBy",
    cr.planned_reporting_doctor_set_at as "plannedReportingDoctorSetAt",
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
    cr.cancellation_reason as "cancellationReason",
    cr.preparation_returned_by as "preparationReturnedBy",
    returned_by.full_name as "preparationReturnedByName",
    cr.preparation_returned_at as "preparationReturnedAt",
    cr.preparation_return_reason as "preparationReturnReason",
    coalesce(comparison_documents.document_count, 0)::integer as "documentCount",
    latest_remap.id as "remapJobId",
    latest_remap.status as "remapJobStatus",
    latest_remap.processing_stage as "remapProcessingStage",
    latest_remap.send_error_code as "remapSendErrorCode",
    latest_remap.error_message as "remapErrorMessage",
    latest_remap.updated_at as "remapUpdatedAt"
  from comparison_requests cr
  join patients p on p.id = cr.patient_id
  left join modalities m on m.id = cr.linked_modality_id
  left join users confirmed_by on confirmed_by.id = cr.materials_confirmed_by
  left join users finalized_by on finalized_by.id = cr.finalized_by
  left join users created_by on created_by.id = cr.created_by
  left join users returned_by on returned_by.id = cr.preparation_returned_by
  left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cr.assigned_doctor_id
  left join doctor_portal.doctor_profiles planned_doctor on planned_doctor.id = cr.planned_reporting_doctor_id
  left join lateral (
    select count(*)::integer as document_count
    from comparison_request_documents crd
    where crd.comparison_request_id = cr.id
  ) comparison_documents on true
  left join lateral (
    select drj.id, drj.status, drj.processing_stage, drj.send_error_code, drj.error_message, drj.updated_at
    from dicom_remap_jobs drj
    where drj.comparison_request_id = cr.id
    order by drj.created_at desc, drj.id desc
    limit 1
  ) latest_remap on true
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
  input: { patientId: unknown; linkedPreviousBookingId: unknown; reason: unknown; plannedReportingDoctorId?: unknown }
): Promise<ComparisonRequestRow> {
  if (!CREATE_ROLES.has(actor.appRole)) throw new HttpError(403, "This role cannot create comparison requests.");
  const patientId = normalizeId(input.patientId, "patientId");
  const linkedPreviousBookingId = normalizeId(input.linkedPreviousBookingId, "linkedPreviousBookingId");
  const reason = cleanRequiredText(input.reason, "reason");
  const isManager = actor.appRole === "supervisor" || actor.appRole === "super_admin";
  const hasPlannedDoctor = input.plannedReportingDoctorId !== undefined && input.plannedReportingDoctorId !== null && input.plannedReportingDoctorId !== "";
  if (hasPlannedDoctor && !isManager) throw new HttpError(403, "Only supervisors can plan a reporting doctor.");
  const plannedReportingDoctorId = hasPlannedDoctor ? normalizeId(input.plannedReportingDoctorId, "plannedReportingDoctorId") : null;

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
    if (plannedReportingDoctorId) await assertDoctorCanReportComparison(plannedReportingDoctorId, Number(previousRow.modality_id));

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
          created_by,
          planned_reporting_doctor_id,
          planned_reporting_doctor_set_by,
          planned_reporting_doctor_set_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12::bigint, $13, case when $12::bigint is null then null else now() end)
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
        plannedReportingDoctorId,
        plannedReportingDoctorId ? actor.userId : null,
      ]
    );
    const request = await findComparisonRequestById(created.rows[0].id, client);
    if (!request) throw new HttpError(500, "Failed to create comparison request.");
    await audit(client, actor, "comparison_request_created", request, { reason }, reason);
    await audit(client, actor, "comparison_previous_study_selected", request, { linkedPreviousBookingId }, null);
    if (plannedReportingDoctorId) await audit(client, actor, "comparison_planned_reporting_doctor_set", request, { doctorId: plannedReportingDoctorId }, null);
    await client.query("commit");
    return request;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function assertDoctorCanReportComparison(doctorId: number, modalityId: number): Promise<void> {
  const doctor = await findAssignableDoctorForReporting(doctorId);
  if (!doctor || !doctor.canFinalizeReports || !(await doctorCanReportAllModalities(doctorId, [modalityId]))) {
    throw new HttpError(400, "Doctor cannot report this comparison modality.");
  }
}

export async function listComparisonReportingDoctors(actor: ComparisonActor, modalityIdInput: unknown): Promise<Array<{ id: number; displayName: string }>> {
  if (actor.appRole !== "supervisor" && actor.appRole !== "super_admin") throw new HttpError(403, "Only supervisors can select reporting doctors.");
  const modalityId = normalizeId(modalityIdInput, "modalityId");
  const result = await pool.query<{ id: number; displayName: string }>(
    `select distinct dp.id, dp.display_name as "displayName"
     from doctor_portal.doctor_profiles dp
     join doctor_portal.doctor_modality_permissions dmp on dmp.doctor_id = dp.id
     where dp.active = true and dp.can_finalize_reports = true
       and dmp.modality_id = $1 and dmp.can_report = true and dmp.active = true
     order by dp.display_name asc, dp.id asc`,
    [modalityId]
  );
  return result.rows;
}

export async function findComparisonRequestById(idInput: unknown, db: PoolClient | typeof pool = pool): Promise<ComparisonRequestRow | null> {
  const id = normalizeId(idInput, "comparisonRequestId");
  const result = await db.query(`${COMPARISON_SELECT} where cr.id = $1 limit 1`, [id]);
  return result.rows[0] ? comparisonRequest(result.rows[0]) : null;
}

export async function listComparisonRequests(filters: { status?: unknown; q?: unknown } = {}): Promise<ComparisonRequestRow[]> {
  const status = cleanOptionalText(filters.status)?.toLowerCase() ?? "active";
  const q = cleanOptionalText(filters.q)?.toLowerCase() ?? null;
  const values: unknown[] = [];
  const where: string[] = [];
  const statusMap: Record<string, ComparisonRequestStatus[]> = {
    active: ["pending_upload_confirmation", "ready_for_reporting", "assigned"],
    pending: ["pending_upload_confirmation"],
    ready: ["ready_for_reporting"],
    assigned: ["assigned"],
    finalized: ["finalized"],
    cancelled: ["cancelled"],
    all: [],
    pending_upload_confirmation: ["pending_upload_confirmation"],
    ready_for_reporting: ["ready_for_reporting"],
  };
  const statuses = statusMap[status];
  if (!statuses) throw new HttpError(400, "Invalid comparison request status filter.");
  if (statuses.length) {
    values.push(statuses);
    where.push(`cr.status = any($${values.length}::text[])`);
  }
  if (q) {
    values.push(`%${q}%`);
    const param = `$${values.length}`;
    where.push(`(
      lower(coalesce(p.english_full_name, '')) like ${param}
      or lower(coalesce(p.arabic_full_name, '')) like ${param}
      or lower(coalesce(p.mrn, '')) like ${param}
      or lower(coalesce(cr.linked_previous_accession_number, '')) like ${param}
      or lower(coalesce(cr.linked_exam_name, '')) like ${param}
      or lower(coalesce(cr.reason, '')) like ${param}
    )`);
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

function assertCanPrepareComparisonMaterials(actor: ComparisonActor): void {
  if (!CONFIRM_ROLES.has(actor.appRole)) {
    throw new HttpError(403, "This role cannot prepare comparison materials.");
  }
}

function assertComparisonAcceptsMaterialChanges(request: ComparisonRequestRow): void {
  if (request.status !== "pending_upload_confirmation") {
    throw new HttpError(409, "Only pending comparison requests can change preparation materials.");
  }
}

export async function listComparisonRequestDocuments(idInput: unknown): Promise<DocumentRow[]> {
  const id = normalizeId(idInput, "comparisonRequestId");
  const request = await findComparisonRequestById(id);
  if (!request) throw new HttpError(404, "Comparison request not found.");
  const result = await pool.query<DocumentRow>(
    `
      select
        d.id,
        d.patient_id,
        d.appointment_id,
        d.v2_booking_id,
        d.document_type,
        d.original_filename,
        d.stored_path,
        d.mime_type,
        d.file_size,
        d.storage_location_type,
        d.source,
        d.scan_session_id,
        d.page_count,
        d.scanner_name,
        d.workstation_name,
        d.app_version,
        d.last_move_attempt_at,
        d.last_move_error,
        d.created_at
      from comparison_request_documents crd
      join documents d on d.id = crd.document_id
      where crd.comparison_request_id = $1
      order by crd.created_at desc, d.id desc
      limit 100
    `,
    [id]
  );
  return result.rows;
}

export async function attachDocumentToComparisonRequest(
  actor: ComparisonActor,
  idInput: unknown,
  documentIdInput: unknown
): Promise<DocumentRow> {
  assertCanPrepareComparisonMaterials(actor);
  const id = normalizeId(idInput, "comparisonRequestId");
  const documentId = normalizeId(documentIdInput, "documentId");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await lockComparisonRequest(id, client);
    assertComparisonAcceptsMaterialChanges(request);
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`comparison-document:${documentId}`]);
    const documentResult = await client.query<DocumentRow>("select * from documents where id = $1 for update", [documentId]);
    const document = documentResult.rows[0];
    if (!document) throw new HttpError(404, "Document not found.");
    if (Number(document.patient_id) !== request.patientId) {
      throw new HttpError(400, "Document patient does not match the comparison request patient.");
    }
    await client.query(
      `
        insert into comparison_request_documents (comparison_request_id, document_id, created_by)
        values ($1, $2, $3)
        on conflict (comparison_request_id, document_id) do nothing
      `,
      [id, documentId, actor.userId]
    );
    await audit(client, actor, "comparison_document_attached", request, { documentId }, null);
    await client.query("commit");
    return document;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function uploadComparisonRequestDocument(
  actor: ComparisonActor,
  idInput: unknown,
  payload: DocumentUploadPayload
): Promise<DocumentRow> {
  assertCanPrepareComparisonMaterials(actor);
  const id = normalizeId(idInput, "comparisonRequestId");
  const request = await findComparisonRequestById(id);
  if (!request) throw new HttpError(404, "Comparison request not found.");
  assertComparisonAcceptsMaterialChanges(request);
  const document = await uploadDocument(
    {
      ...payload,
      patientId: request.patientId,
      appointmentId: undefined,
      appointmentRefType: undefined,
      documentType: "comparison_request",
    },
    actor.userId
  );
  try {
    return await attachDocumentToComparisonRequest(actor, id, document.id);
  } catch (error) {
    await deleteDocumentById(document.id, actor.userId).catch(() => undefined);
    throw error;
  }
}

export async function deleteComparisonRequestDocument(
  actor: ComparisonActor,
  idInput: unknown,
  documentIdInput: unknown
): Promise<{ deleted: true; documentId: number }> {
  if (!CANCEL_ROLES.has(actor.appRole)) {
    throw new HttpError(403, "This role cannot remove comparison documents.");
  }
  const id = normalizeId(idInput, "comparisonRequestId");
  const documentId = normalizeId(documentIdInput, "documentId");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await lockComparisonRequest(id, client);
    assertComparisonAcceptsMaterialChanges(request);
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`comparison-document:${documentId}`]);
    const linked = await client.query<{
      appointment_id: number | null;
      v2_booking_id: number | null;
      other_comparison_count: number;
    }>(
      `
        select
          d.appointment_id,
          d.v2_booking_id,
          (
            select count(*)::integer
            from comparison_request_documents other_link
            where other_link.document_id = d.id
              and other_link.comparison_request_id <> $1
          ) as other_comparison_count
        from comparison_request_documents crd
        join documents d on d.id = crd.document_id
        where crd.comparison_request_id = $1 and crd.document_id = $2
        limit 1
      `,
      [id, documentId]
    );
    const row = linked.rows[0];
    if (!row) throw new HttpError(404, "Comparison document link not found.");
    if (row.appointment_id != null || row.v2_booking_id != null || Number(row.other_comparison_count) > 0) {
      throw new HttpError(409, "This canonical document is used elsewhere and cannot be removed from storage.");
    }
    await deleteDocumentById(documentId, actor.userId);
    await audit(client, actor, "comparison_document_deleted", request, { documentId }, null);
    await client.query("commit");
    return { deleted: true, documentId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function lockComparisonRequest(id: number, client: PoolClient): Promise<ComparisonRequestRow> {
  const locked = await client.query(`select id from comparison_requests where id = $1 for update`, [id]);
  if (!locked.rows[0]) throw new HttpError(404, "Comparison request not found.");
  const request = await findComparisonRequestById(id, client);
  if (!request) throw new HttpError(404, "Comparison request not found.");
  return request;
}

async function createActiveComparisonAssignment(
  client: PoolClient,
  request: ComparisonRequestRow,
  actor: ComparisonActor,
  doctorId: number,
  reason: string | null,
  assignedByDoctorId: number | null
): Promise<number> {
  if (!request.linkedModalityId) throw new HttpError(409, "Comparison request modality is missing.");
  await client.query(`update doctor_portal.comparison_case_assignments set status = 'superseded', updated_at = now() where comparison_request_id = $1 and status = 'active'`, [request.id]);
  const inserted = await client.query<{ id: number }>(
    `insert into doctor_portal.comparison_case_assignments (comparison_request_id, assigned_doctor_id, modality_id, assigned_by_user_id, assigned_by_doctor_id, reason)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [request.id, doctorId, request.linkedModalityId, actor.userId, assignedByDoctorId, reason]
  );
  return Number(inserted.rows[0].id);
}

export async function confirmComparisonMaterials(
  actor: ComparisonActor,
  idInput: unknown,
  input: {
    imageAvailabilityConfirmed?: unknown;
    documentsAvailabilityConfirmed?: unknown;
    documentsDisposition?: unknown;
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
    if (input.imageAvailabilityConfirmed !== true || input.selectedPriorConfirmed !== true) {
      throw new HttpError(400, "All comparison readiness confirmations are required.");
    }
    const documentCountResult = await client.query<{ count: number }>(
      `select count(*)::integer as count from comparison_request_documents where comparison_request_id = $1`, [id]
    );
    const documentCount = Number(documentCountResult.rows[0]?.count ?? 0);
    const documentsDisposition = input.documentsDisposition === "attached_verified" || input.documentsDisposition === "not_required"
      ? input.documentsDisposition
      : (input.documentsAvailabilityConfirmed === true && documentCount > 0 ? "attached_verified" : null);
    if (!documentsDisposition) throw new HttpError(400, "A comparison paper disposition is required.");
    if (documentsDisposition === "attached_verified" && documentCount === 0) throw new HttpError(400, "Attached papers must exist before they can be verified.");
    if (documentsDisposition === "not_required" && documentCount > 0) throw new HttpError(400, "Attached papers cannot be marked not required.");
    const note = cleanOptionalText(input.note);
    let activatedAssignmentId: number | null = null;
    let activatedDoctorId: number | null = null;
    let skippedPlannedDoctorId: number | null = null;
    if (request.plannedReportingDoctorId && request.linkedModalityId) {
      try {
        await assertDoctorCanReportComparison(request.plannedReportingDoctorId, request.linkedModalityId);
        activatedDoctorId = request.plannedReportingDoctorId;
        activatedAssignmentId = await createActiveComparisonAssignment(client, request, actor, activatedDoctorId, "planned assignment activated on release", null);
      } catch (error) {
        if (error instanceof HttpError) skippedPlannedDoctorId = request.plannedReportingDoctorId;
        else throw error;
      }
    }
    await client.query(
      `
        update comparison_requests
        set
          status = case when $4::bigint is null then 'ready_for_reporting' else 'assigned' end,
          materials_confirmed = true,
          materials_confirmed_by = $2,
          materials_confirmed_at = now(),
          materials_confirmation_note = $3,
          image_availability_confirmed = true,
          documents_availability_confirmed = true,
          selected_prior_confirmed = true,
          documents_disposition = $5,
          assigned_doctor_id = $4,
          planned_reporting_doctor_id = null,
          planned_reporting_doctor_set_by = null,
          planned_reporting_doctor_set_at = null,
          updated_at = now()
        where id = $1
      `,
      [id, actor.userId, note, activatedDoctorId, documentsDisposition]
    );
    const updated = await findComparisonRequestById(id, client);
    if (!updated) throw new HttpError(404, "Comparison request not found.");
    await audit(client, actor, "comparison_materials_confirmed", updated, { note, documentsDisposition }, note, actorProfile);
    if (activatedAssignmentId && activatedDoctorId) await audit(client, actor, "comparison_assigned", updated, { assignmentId: activatedAssignmentId, doctorId: activatedDoctorId, planned: true }, null, actorProfile);
    else await audit(client, actor, "comparison_released_to_reporting_pool", updated, { linkedModalityId: updated.linkedModalityId }, null, actorProfile);
    if (skippedPlannedDoctorId) await audit(client, actor, "comparison_planned_assignment_skipped", updated, { doctorId: skippedPlannedDoctorId, reason: "doctor_no_longer_eligible" }, null, actorProfile);
    await client.query("commit");
    if (activatedDoctorId) await createAssignedToMeNotifications({ doctorId: activatedDoctorId, comparisonRequestIds: [id] }).catch((error) => {
      console.warn(JSON.stringify({
        type: "comparison_assigned_notification_failed",
        comparisonRequestId: id,
        doctorId: activatedDoctorId,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    return updated;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateComparisonRequest(
  actor: ComparisonActor,
  idInput: unknown,
  input: { reason?: unknown; linkedPreviousBookingId?: unknown; plannedReportingDoctorId?: unknown }
): Promise<ComparisonRequestRow> {
  const id = normalizeId(idInput, "comparisonRequestId");
  const hasReason = input.reason !== undefined;
  const hasPrior = input.linkedPreviousBookingId !== undefined;
  const hasPlanned = input.plannedReportingDoctorId !== undefined;
  if (!hasReason && !hasPrior && !hasPlanned) throw new HttpError(400, "At least one editable comparison field is required.");
  const manager = actor.appRole === "supervisor" || actor.appRole === "super_admin";
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await lockComparisonRequest(id, client);
    if (request.status !== "pending_upload_confirmation") throw new HttpError(409, "Only pending comparison requests can be edited.");
    if (hasReason && !manager && request.createdBy !== actor.userId) throw new HttpError(403, "Only the creator or a supervisor can edit this reason.");
    if ((hasPrior || hasPlanned) && !manager) throw new HttpError(403, "Only supervisors can change this comparison field.");
    const reason = hasReason ? cleanRequiredText(input.reason, "reason") : request.reason;
    let prior = null as Record<string, unknown> | null;
    if (hasPrior) {
      if (request.materialsConfirmed || request.documentCount > 0) throw new HttpError(409, "Previous study cannot change after preparation evidence exists.");
      const remap = await client.query(`select 1 from dicom_remap_jobs where comparison_request_id = $1 limit 1`, [id]);
      if (remap.rows[0]) throw new HttpError(409, "Previous study cannot change after a remap job exists.");
      const bookingId = normalizeId(input.linkedPreviousBookingId, "linkedPreviousBookingId");
      const result = await client.query(`select b.id, b.study_instance_uid, b.modality_id, m.code as modality_code, b.exam_type_id, et.name_en as exam_name, b.booking_date::text as study_date, ('V2-' || lpad(b.id::text, 6, '0')) as accession_number from appointments_v2.bookings b join modalities m on m.id=b.modality_id left join exam_types et on et.id=b.exam_type_id where b.id=$1 and b.patient_id=$2 and b.status='completed' limit 1`, [bookingId, request.patientId]);
      prior = result.rows[0] ?? null;
      if (!prior) throw new HttpError(400, "A completed previous RISpro study for this patient is required.");
    }
    let plannedDoctorId = request.plannedReportingDoctorId;
    if (hasPlanned) plannedDoctorId = input.plannedReportingDoctorId === null || input.plannedReportingDoctorId === "" ? null : normalizeId(input.plannedReportingDoctorId, "plannedReportingDoctorId");
    const modalityId = prior ? Number(prior.modality_id) : request.linkedModalityId;
    if (plannedDoctorId && modalityId) {
      try { await assertDoctorCanReportComparison(plannedDoctorId, modalityId); }
      catch (error) {
        if (hasPlanned) throw error;
        plannedDoctorId = null;
      }
    }
    await client.query(
      `update comparison_requests set reason=$2, linked_previous_booking_id=coalesce($3, linked_previous_booking_id), linked_previous_study_uid=case when $3 is null then linked_previous_study_uid else $4 end, linked_previous_accession_number=case when $3 is null then linked_previous_accession_number else $5 end, linked_modality_id=case when $3 is null then linked_modality_id else $6 end, linked_modality_code=case when $3 is null then linked_modality_code else $7 end, linked_exam_type_id=case when $3 is null then linked_exam_type_id else $8 end, linked_exam_name=case when $3 is null then linked_exam_name else $9 end, linked_study_date=case when $3 is null then linked_study_date else $10::date end, planned_reporting_doctor_id=$11::bigint, planned_reporting_doctor_set_by=case when $12 then case when $11::bigint is null then null else $13::bigint end else planned_reporting_doctor_set_by end, planned_reporting_doctor_set_at=case when $12 then case when $11::bigint is null then null else now() end else planned_reporting_doctor_set_at end, updated_at=now() where id=$1`,
      [id, reason, prior?.id ?? null, prior?.study_instance_uid ?? null, prior?.accession_number ?? null, prior?.modality_id ?? null, prior?.modality_code ?? null, prior?.exam_type_id ?? null, prior?.exam_name ?? null, prior?.study_date ?? null, plannedDoctorId, hasPlanned || (Boolean(prior) && plannedDoctorId !== request.plannedReportingDoctorId), actor.userId]
    );
    const updated = await findComparisonRequestById(id, client);
    if (!updated) throw new HttpError(404, "Comparison request not found.");
    if (hasReason && reason !== request.reason) await audit(client, actor, "comparison_request_updated", updated, { changed: "reason" });
    if (prior) await audit(client, actor, "comparison_request_updated", updated, { changed: "linkedPreviousBookingId", oldBookingId: request.linkedPreviousBookingId, newBookingId: updated.linkedPreviousBookingId });
    if (updated.plannedReportingDoctorId !== request.plannedReportingDoctorId) await audit(client, actor, updated.plannedReportingDoctorId ? "comparison_planned_reporting_doctor_set" : "comparison_planned_reporting_doctor_cleared", updated, { previousDoctorId: request.plannedReportingDoctorId, doctorId: updated.plannedReportingDoctorId });
    await client.query("commit");
    return updated;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export async function returnComparisonToPreparation(actor: ComparisonActor, idInput: unknown, reasonInput: unknown): Promise<ComparisonRequestRow> {
  const id = normalizeId(idInput, "comparisonRequestId");
  const reason = cleanRequiredText(reasonInput, "reason");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const request = await lockComparisonRequest(id, client);
    if (!['ready_for_reporting', 'assigned'].includes(request.status)) throw new HttpError(409, "Only released comparison requests can return to preparation.");
    const profile = await findActiveDoctorProfileByUserId(actor.userId).catch(() => null);
    const active = await client.query<{ id: number; doctorId: number }>(`select id, assigned_doctor_id as "doctorId" from doctor_portal.comparison_case_assignments where comparison_request_id=$1 and status='active' limit 1 for update`, [id]);
    const activeAssignment = active.rows[0] ?? null;
    const supervisor = actor.appRole === "supervisor" || actor.appRole === "super_admin";
    const assignedDoctor = actor.appRole === "doctor" && profile?.canFinalizeReports === true && activeAssignment?.doctorId === profile.id;
    if (!supervisor && !assignedDoctor) throw new HttpError(403, "You are not allowed to return this comparison to preparation.");
    if (activeAssignment) await client.query(`update doctor_portal.comparison_case_assignments set status='cancelled', updated_at=now() where id=$1`, [activeAssignment.id]);
    await client.query(`update comparison_requests set status='pending_upload_confirmation', assigned_doctor_id=null, planned_reporting_doctor_id=$2::bigint, planned_reporting_doctor_set_by=case when $2::bigint is null then null else $3::bigint end, planned_reporting_doctor_set_at=case when $2::bigint is null then null else now() end, materials_confirmed=false, materials_confirmed_by=null, materials_confirmed_at=null, materials_confirmation_note=null, image_availability_confirmed=false, documents_availability_confirmed=false, selected_prior_confirmed=false, documents_disposition=null, preparation_returned_by=$3::bigint, preparation_returned_at=now(), preparation_return_reason=$4, updated_at=now() where id=$1`, [id, activeAssignment?.doctorId ?? null, actor.userId, reason]);
    const updated = await findComparisonRequestById(id, client);
    if (!updated) throw new HttpError(404, "Comparison request not found.");
    await audit(client, actor, "comparison_returned_to_preparation", updated, { previousStatus: request.status, previousAssignedDoctorId: activeAssignment?.doctorId ?? null, previousMaterialsConfirmationNote: request.materialsConfirmationNote, returnReason: reason }, reason, profile);
    await client.query("commit");
    return updated;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
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
    if (request.status === "cancelled") throw new HttpError(409, "Cancelled comparison requests cannot be cancelled again.");
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
    const assignmentId = await createActiveComparisonAssignment(client, request, actor, doctorId, reason, manager.profile!.id);
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
      `update comparison_requests set status = 'ready_for_reporting', assigned_doctor_id = null, planned_reporting_doctor_id = null, planned_reporting_doctor_set_by = null, planned_reporting_doctor_set_at = null, updated_at = now() where id = $1`,
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
      Number(actorProfile.id) === assignedDoctorId;
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
  if (filters.appointmentId) where.push(`cr.linked_previous_booking_id = ${addComparisonFilter(values, filters.appointmentId)}`);
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
  const sonicStatus = String(row.sonicReportStatus ?? "");
  const sonicCheckedAt = optionalIso(row.sonicLastSuccessAt);
  const hasSonicObservation = sonicCheckedAt !== null &&
    ["final", "draft", "no_report", "study_not_found", "unavailable"].includes(sonicStatus);
  const effectiveStatus = finalizedAt ? "final" : hasSonicObservation ? sonicStatus as ReportingBoardCaseRow["reportStatus"] : "no_report";
  const effectiveFinalAt = finalizedAt ?? (hasSonicObservation && sonicStatus === "final" ? optionalIso(row.sonicReportFinalAt) : null);
  const sonicDicomDocumentRemoved = hasSonicObservation && sonicStatus === "no_report" &&
    row.sonicDocumentId != null && row.sonicStatusCode != null;
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
    comparisonReason: row.comparisonReason == null ? null : String(row.comparisonReason),
    comparisonPreparationNote: row.comparisonPreparationNote == null ? null : String(row.comparisonPreparationNote),
    caseCategory: "comparison",
    appointmentStatus: status,
    requiresReport: true,
    reportingPriorityId: null,
    reportingPriorityCode: null,
    reportingPriorityName: null,
    reportingPrioritySortOrder: null,
    assignedDoctorId: row.assignedDoctorId == null ? null : Number(row.assignedDoctorId),
    assignedDoctorName: row.assignedDoctorName == null ? null : String(row.assignedDoctorName),
    assignmentOrigin: "rispro",
    finalizedByDoctorId: row.finalizedByDoctorId == null ? null : Number(row.finalizedByDoctorId),
    finalizedByDoctorName: row.finalizedByDoctorName == null ? null : String(row.finalizedByDoctorName),
    sonicDicomFinalizedByAccount: hasSonicObservation ? row.sonicAccount == null ? null : String(row.sonicAccount) : null,
    sonicDicomLatestDocumentId: hasSonicObservation ? row.sonicDocumentId == null ? null : String(row.sonicDocumentId) : null,
    sonicDicomDocumentRemoved,
    sonicDicomCorrelationMethod: hasSonicObservation && (row.sonicCorrelationMethod === "study_instance_uid" || row.sonicCorrelationMethod === "accession_fallback") ? row.sonicCorrelationMethod : null,
    assignmentMatch: "not_applicable",
    assignmentStatus: row.assignedDoctorId == null ? "unassigned" : "assigned",
    completedAt: optionalIso(row.completedAt),
    currentAssignedAt: optionalIso(row.currentAssignedAt),
    firstAssignedAt: optionalIso(row.currentAssignedAt),
    reportFinalAt: effectiveFinalAt,
    reportStatusCheckedAt: hasSonicObservation ? sonicCheckedAt : new Date().toISOString(),
    reportStatusSource: finalizedAt ? "rispro" : hasSonicObservation ? "sonicdicom" : "rispro",
    sonicDicomStudyNote: null,
    sonicDicomStudyNoteCheckedAt: null,
    sonicDicomStudyNoteSource: null,
    dueAt: null,
    completedToAssignedMinutes: null,
    assignedToFinalMinutes: null,
    completedToFinalMinutes: null,
    currentAssignmentAgeMinutes: null,
    completedUnassignedAgeMinutes: null,
    reportStatus: effectiveStatus,
    canAssign: status !== "finalized" && effectiveStatus !== "final",
    exclusionReason: status === "finalized" || effectiveStatus === "final" ? "report_final" : null,
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
        cr.reason as "comparisonReason",
        cr.materials_confirmation_note as "comparisonPreparationNote",
        cr.status,
        cr.materials_confirmed_at as "completedAt",
        cca.assigned_at as "currentAssignedAt",
        cr.finalized_at as "reportFinalAt",
        finalized_doctor.id as "finalizedByDoctorId",
        finalized_doctor.display_name as "finalizedByDoctorName",
        cca.assigned_doctor_id as "assignedDoctorId",
        assigned_doctor.display_name as "assignedDoctorName",
        comparison_cache.report_status as "sonicReportStatus",
        comparison_cache.report_final_at as "sonicReportFinalAt",
        comparison_cache.sonicdicom_document_id as "sonicDocumentId",
        comparison_cache.sonicdicom_status_code as "sonicStatusCode",
        comparison_cache.sonicdicom_account as "sonicAccount",
        comparison_cache.correlation_method as "sonicCorrelationMethod",
        comparison_cache.last_success_at as "sonicLastSuccessAt"
      from comparison_requests cr
      join patients p on p.id = cr.patient_id
      left join modalities m on m.id = cr.linked_modality_id
      left join doctor_portal.comparison_case_assignments cca on cca.comparison_request_id = cr.id and cca.status = 'active'
      left join lateral (
        select cache.*
        from doctor_portal.comparison_sonicdicom_cache cache
        where cache.comparison_request_id = cr.id
        order by (cache.comparison_assignment_id = cca.id) desc, cache.last_success_at desc nulls last, cache.updated_at desc, cache.comparison_assignment_id desc
        limit 1
      ) comparison_cache on true
      left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cca.assigned_doctor_id
      left join doctor_portal.doctor_profiles finalized_doctor on finalized_doctor.user_id = cr.finalized_by
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
    assignmentOrigin: row.assignmentOrigin,
    assignmentStatus: row.assignmentStatus,
    completedAt: row.completedAt,
    currentAssignedAt: row.currentAssignedAt,
    firstAssignedAt: row.firstAssignedAt,
    reportFinalAt: row.reportFinalAt,
    reportStatus: row.reportStatus,
  }));
}
