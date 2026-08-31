import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import {
  attachDocumentToComparisonRequest,
  cancelComparisonRequest,
  confirmComparisonMaterials,
  createComparisonRequest,
  deleteComparisonRequestDocument,
  findComparisonRequestById,
  listComparisonRequestDocuments,
  uploadComparisonRequestDocument,
  type ComparisonActor,
  updateComparisonRequest,
  returnComparisonToPreparation,
  unassignComparisonRequest,
} from "./comparison-request-service.js";
import { deleteDocumentById, uploadDocument } from "./document-service.js";
import {
  assertDicomRemapJobComparisonAccess,
  cleanupDicomRemapStagingStorage,
  createDicomRemapStagingContext,
  finalizeDicomRemapStagingJob,
} from "./dicom-remap-service.js";
import type { Role } from "../types/domain.js";

const marker = `comparison_preparation_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
const created = {
  users: [] as number[],
  patients: [] as number[],
  modalities: [] as number[],
  examTypes: [] as number[],
  policySets: [] as number[],
  policyVersions: [] as number[],
  bookings: [] as number[],
  comparisons: [] as number[],
  documents: [] as number[],
  remapJobs: [] as number[],
  doctorProfiles: [] as number[],
};

async function createReportingDoctor(role: "doctor" | "supervisor", modalityId: number): Promise<{ actor: ComparisonActor; doctorId: number }> {
  const actor = await createUser(role);
  const profile = await pool.query<{ id: number }>(
    `insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active,can_finalize_reports,can_assign_protocols,can_supervise)
     values($1,$2,'consultant',true,true,true,$3) returning id`,
    [actor.userId, `${marker} doctor ${created.doctorProfiles.length}`, role === "supervisor"]
  );
  const doctorId = Number(profile.rows[0]!.id);
  created.doctorProfiles.push(doctorId);
  await pool.query(
    `insert into doctor_portal.doctor_modality_permissions(doctor_id,modality_id,can_protocol,can_report,can_supervise,active)
     values($1,$2,true,true,true,true)`, [doctorId, modalityId]
  );
  return { actor, doctorId };
}

async function createUser(role: Role): Promise<ComparisonActor> {
  const result = await pool.query<{ id: number }>(
    `insert into users(username, full_name, password_hash, role, is_active)
     values($1,$2,'test',$3,true) returning id`,
    [`${marker}_${role}_${created.users.length}`, `${marker} ${role}`, role]
  );
  const userId = Number(result.rows[0]!.id);
  created.users.push(userId);
  return { userId, appRole: role };
}

async function createPatient(label: string, userId: number): Promise<number> {
  const suffix = `${Date.now()}${created.patients.length}`.slice(-11).padStart(11, "0");
  const result = await pool.query<{ id: number }>(
    `insert into patients(
       national_id, identifier_type, identifier_value, arabic_full_name, english_full_name,
       normalized_arabic_name, age_years, estimated_date_of_birth, sex, phone_1, address,
       created_by_user_id, updated_by_user_id
     ) values($1::varchar,'national_id',$1::text,$2::text,$3::text,$2::text,40,'1986-01-01','F','0912345678','Test',$4,$4)
     returning id`,
    [`7${suffix}`, `${marker} ar ${label}`, `${marker} ${label}`, userId]
  );
  const id = Number(result.rows[0]!.id);
  created.patients.push(id);
  return id;
}

async function createRequest(actor: ComparisonActor, label: string, patientId?: number) {
  const targetPatientId = patientId ?? await createPatient(label, Number(actor.userId));
  const modality = await pool.query<{ id: number }>(
    "insert into modalities(code,name_ar,name_en,daily_capacity,is_active) values($1,$2,$3,20,true) returning id",
    [`CP${created.modalities.length}${marker.slice(-4)}`, `${marker} modality`, `${marker} modality`]
  );
  const modalityId = Number(modality.rows[0]!.id);
  created.modalities.push(modalityId);
  const exam = await pool.query<{ id: number }>(
    "insert into exam_types(modality_id,code,name_ar,name_en,is_active) values($1,$2,$3,$4,true) returning id",
    [modalityId, `${marker}_exam_${created.examTypes.length}`, `${marker} exam`, `${marker} exam`]
  );
  const examTypeId = Number(exam.rows[0]!.id);
  created.examTypes.push(examTypeId);
  const policySet = await pool.query<{ id: number }>(
    "insert into appointments_v2.policy_sets(key,name,created_by_user_id) values($1,$2,$3) returning id",
    [`${marker}_policy_${created.policySets.length}`, `${marker} policy`, actor.userId]
  );
  const policySetId = Number(policySet.rows[0]!.id);
  created.policySets.push(policySetId);
  const policyVersion = await pool.query<{ id: number }>(
    "insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash,change_note,created_by_user_id) values($1,1,'published',$2,'comparison test',$3) returning id",
    [policySetId, `${marker}_${created.policyVersions.length}`, actor.userId]
  );
  const policyVersionId = Number(policyVersion.rows[0]!.id);
  created.policyVersions.push(policyVersionId);
  const booking = await pool.query<{ id: number }>(
    `insert into appointments_v2.bookings(
       patient_id, modality_id, exam_type_id, booking_date, booking_time, case_category, status,
       notes, policy_version_id, created_by_user_id, updated_by_user_id
     ) values($1,$2,$3,current_date,'09:00:00','non_oncology','completed',$4,$5,$6,$6) returning id`,
    [targetPatientId, modalityId, examTypeId, `${marker} completed`, policyVersionId, actor.userId]
  );
  const bookingId = Number(booking.rows[0]!.id);
  created.bookings.push(bookingId);
  const request = await createComparisonRequest(actor, {
    patientId: targetPatientId,
    linkedPreviousBookingId: bookingId,
    reason: `${marker} reason ${label}`,
  });
  created.comparisons.push(request.id);
  return request;
}

async function expectHttpStatus(promise: Promise<unknown>, statusCode: number) {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { statusCode?: number }).statusCode, statusCode);
    return true;
  });
}

test("supervisor and super_admin can cancel pending comparisons", async () => {
  const supervisor = await createUser("supervisor");
  const superAdmin = await createUser("super_admin");
  const first = await createRequest(supervisor, "supervisor cancel");
  const second = await createRequest(superAdmin, "admin cancel");
  assert.equal((await cancelComparisonRequest(supervisor, first.id, "Incorrect request")).status, "cancelled");
  assert.equal((await cancelComparisonRequest(superAdmin, second.id, "Cancelled by requester")).status, "cancelled");
});

test("unauthorized, finalized, and repeated cancellation are rejected without overwriting metadata", async () => {
  const modalityStaff = await createUser("modality_staff");
  const supervisor = await createUser("supervisor");
  const unauthorized = await createRequest(modalityStaff, "unauthorized cancel");
  await expectHttpStatus(cancelComparisonRequest(modalityStaff, unauthorized.id, "Not allowed"), 403);

  const finalized = await createRequest(supervisor, "finalized cancel");
  await pool.query("update comparison_requests set status='finalized' where id=$1", [finalized.id]);
  await expectHttpStatus(cancelComparisonRequest(supervisor, finalized.id, "Too late"), 409);

  const cancelled = await createRequest(supervisor, "repeat cancel");
  const original = await cancelComparisonRequest(supervisor, cancelled.id, "Original reason");
  await expectHttpStatus(cancelComparisonRequest(supervisor, cancelled.id, "Replacement reason"), 409);
  const persisted = await pool.query<{ cancelled_by: number; cancellation_reason: string; cancelled_at: string }>(
    "select cancelled_by,cancellation_reason,cancelled_at from comparison_requests where id=$1",
    [cancelled.id]
  );
  assert.equal(Number(persisted.rows[0]!.cancelled_by), original.cancelledBy);
  assert.equal(persisted.rows[0]!.cancellation_reason, "Original reason");
  assert.equal(new Date(persisted.rows[0]!.cancelled_at).toISOString(), original.cancelledAt);
});

test("comparison documents use canonical storage, enforce patient ownership, and list by request", async () => {
  const actor = await createUser("modality_staff");
  const request = await createRequest(actor, "documents");
  const before = await pool.query<{ count: string }>("select count(*)::text as count from documents");
  const attached = await uploadComparisonRequestDocument(actor, request.id, {
    originalFilename: "comparison-paper.pdf",
    mimeType: "application/pdf",
    fileContentBase64: Buffer.from("%PDF-1.4\ncomparison test\n%%EOF").toString("base64"),
    source: "manual_upload",
  });
  created.documents.push(attached.id);
  const after = await pool.query<{ count: string }>("select count(*)::text as count from documents");
  assert.equal(Number(after.rows[0]!.count), Number(before.rows[0]!.count) + 1);
  const linkCount = await pool.query<{ count: string }>(
    "select count(*)::text as count from comparison_request_documents where comparison_request_id=$1 and document_id=$2",
    [request.id, attached.id]
  );
  assert.equal(Number(linkCount.rows[0]!.count), 1);
  assert.deepEqual((await listComparisonRequestDocuments(request.id)).map((document) => document.id), [attached.id]);

  const otherPatientId = await createPatient("other patient", Number(actor.userId));
  const otherDocument = await uploadDocument({
    patientId: otherPatientId,
    originalFilename: "other.pdf",
    mimeType: "application/pdf",
    fileContentBase64: Buffer.from("%PDF-1.4\nother\n%%EOF").toString("base64"),
  }, actor.userId);
  created.documents.push(otherDocument.id);
  await expectHttpStatus(attachDocumentToComparisonRequest(actor, request.id, otherDocument.id), 400);

  const secondRequest = await createRequest(actor, "second request", request.patientId);
  const secondDocument = await uploadComparisonRequestDocument(actor, secondRequest.id, {
    originalFilename: "second.png",
    mimeType: "image/png",
    fileContentBase64: Buffer.from("not-a-real-image-but-storage-validates-mime-and-size").toString("base64"),
  });
  created.documents.push(secondDocument.id);
  assert.deepEqual((await listComparisonRequestDocuments(request.id)).map((document) => document.id), [attached.id]);

  const supervisor = await createUser("supervisor");
  assert.deepEqual(await deleteComparisonRequestDocument(supervisor, request.id, attached.id), { deleted: true, documentId: Number(attached.id) });
  const deleted = await pool.query("select id from documents where id=$1", [attached.id]);
  assert.equal(deleted.rowCount, 0);
});

test("comparison remap jobs link durably and reject invalid or cross-patient context", async () => {
  const actor = await createUser("modality_staff");
  const request = await createRequest(actor, "remap context");
  const context = await createDicomRemapStagingContext(actor.userId, request.id);
  created.remapJobs.push(context.job.id);
  assert.equal(Number(context.job.comparison_request_id), request.id);
  const persisted = await pool.query<{ comparison_request_id: number }>(
    "select comparison_request_id from dicom_remap_jobs where id=$1",
    [context.job.id]
  );
  assert.equal(Number(persisted.rows[0]!.comparison_request_id), request.id);
  await assertDicomRemapJobComparisonAccess(context.job.id, actor.userId, request.id);
  const unrelatedRequest = await createRequest(actor, "unrelated remap context", request.patientId);
  await expectHttpStatus(assertDicomRemapJobComparisonAccess(context.job.id, actor.userId, unrelatedRequest.id), 403);
  const otherPatientId = await createPatient("remap mismatch", Number(actor.userId));
  await expectHttpStatus(finalizeDicomRemapStagingJob({
    context,
    files: [{ id: "test-file", relativePath: "files/test.dcm", displayName: "test.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "00" }],
    selectedStudyInstanceUID: "1.2.3.4",
    uploadMode: null,
    risproPatientId: String(otherPatientId),
    destinationPacsKey: "TEST_DESTINATION",
    confirm: "true",
  }), 400);

  await pool.query("update dicom_remap_jobs set status='sent', processing_stage='sent', updated_at=now() where id=$1", [context.job.id]);
  const summarized = await findComparisonRequestById(request.id);
  assert.equal(summarized?.remapJobId, Number(context.job.id));
  assert.equal(summarized?.remapJobStatus, "sent");
  assert.equal(summarized?.remapProcessingStage, "sent");

  await expectHttpStatus(createDicomRemapStagingContext(actor.userId, 9_999_999_999), 404);
  await pool.query("update comparison_requests set status='cancelled' where id=$1", [request.id]);
  await expectHttpStatus(createDicomRemapStagingContext(actor.userId, request.id), 409);
  await cleanupDicomRemapStagingStorage(context.storageKey);
});

test("material confirmation enforces actual paper disposition and permits receptionist release", async () => {
  const receptionist = await createUser("receptionist");
  const noPaper = await createRequest(receptionist, "no paper release");
  const released = await confirmComparisonMaterials(receptionist, noPaper.id, { imageAvailabilityConfirmed: true, documentsDisposition: "not_required", selectedPriorConfirmed: true });
  assert.equal(released.status, "ready_for_reporting");
  const persisted = await pool.query<{ documents_disposition: string; materials_confirmed: boolean }>("select documents_disposition,materials_confirmed from comparison_requests where id=$1", [noPaper.id]);
  assert.deepEqual(persisted.rows[0], { documents_disposition: "not_required", materials_confirmed: true });
  const invalid = await createRequest(receptionist, "verified zero paper");
  await expectHttpStatus(confirmComparisonMaterials(receptionist, invalid.id, { imageAvailabilityConfirmed: true, documentsDisposition: "attached_verified", selectedPriorConfirmed: true }), 400);
  const legacy = await createRequest(receptionist, "legacy zero paper");
  await expectHttpStatus(confirmComparisonMaterials(receptionist, legacy.id, { imageAvailabilityConfirmed: true, documentsAvailabilityConfirmed: true, selectedPriorConfirmed: true }), 400);
  const paper = await createRequest(receptionist, "actual paper");
  const document = await uploadComparisonRequestDocument(receptionist, paper.id, { originalFilename: "paper.pdf", mimeType: "application/pdf", fileContentBase64: Buffer.from("%PDF-1.4\npaper\n%%EOF").toString("base64") });
  created.documents.push(document.id);
  const verified = await confirmComparisonMaterials(receptionist, paper.id, { imageAvailabilityConfirmed: true, documentsDisposition: "attached_verified", selectedPriorConfirmed: true });
  assert.equal(verified.documentsDisposition, "attached_verified");
});

test("planned doctor activates on release, falls back when ineligible, and unassignment clears plans", async () => {
  const supervisorBase = await createUser("supervisor");
  const request = await createRequest(supervisorBase, "planned activation");
  const supervisor = await createReportingDoctor("supervisor", request.linkedModalityId!);
  const doctor = await createReportingDoctor("doctor", request.linkedModalityId!);
  const planned = await updateComparisonRequest(supervisor.actor, request.id, { plannedReportingDoctorId: doctor.doctorId });
  assert.equal(planned.status, "pending_upload_confirmation");
  const before = await pool.query<{ count: string }>("select count(*)::text count from doctor_portal.comparison_case_assignments where comparison_request_id=$1 and status='active'", [request.id]);
  assert.equal(Number(before.rows[0]!.count), 0);
  await confirmComparisonMaterials(supervisorBase, request.id, { imageAvailabilityConfirmed: true, documentsDisposition: "not_required", selectedPriorConfirmed: true });
  const active = await pool.query<{ status: string; assigned_doctor_id: number; planned_reporting_doctor_id: number | null; planned_reporting_doctor_set_by: number | null; planned_reporting_doctor_set_at: string | null; count: string }>(
    `select cr.status,cr.assigned_doctor_id,cr.planned_reporting_doctor_id,cr.planned_reporting_doctor_set_by,cr.planned_reporting_doctor_set_at,(select count(*)::text from doctor_portal.comparison_case_assignments a where a.comparison_request_id=cr.id and a.status='active') count from comparison_requests cr where cr.id=$1`, [request.id]);
  assert.equal(active.rows[0]!.status, "assigned"); assert.equal(Number(active.rows[0]!.assigned_doctor_id), doctor.doctorId); assert.equal(Number(active.rows[0]!.count), 1); assert.equal(active.rows[0]!.planned_reporting_doctor_id, null); assert.equal(active.rows[0]!.planned_reporting_doctor_set_by, null); assert.equal(active.rows[0]!.planned_reporting_doctor_set_at, null);
  await unassignComparisonRequest(supervisor.actor, request.id, "send to pool");
  const unassigned = await findComparisonRequestById(request.id); assert.equal(unassigned?.status, "ready_for_reporting"); assert.equal(unassigned?.assignedDoctorId, null); assert.equal(unassigned?.plannedReportingDoctorId, null); assert.equal(unassigned?.plannedReportingDoctorSetBy, null); assert.equal(unassigned?.plannedReportingDoctorSetAt, null);
  const fallback = await createRequest(supervisorBase, "ineligible plan");
  const fallbackDoctor = await createReportingDoctor("doctor", fallback.linkedModalityId!);
  await updateComparisonRequest(supervisor.actor, fallback.id, { plannedReportingDoctorId: fallbackDoctor.doctorId });
  await pool.query("update doctor_portal.doctor_modality_permissions set active=false where doctor_id=$1", [fallbackDoctor.doctorId]);
  const poolRelease = await confirmComparisonMaterials(supervisorBase, fallback.id, { imageAvailabilityConfirmed: true, documentsDisposition: "not_required", selectedPriorConfirmed: true });
  assert.equal(poolRelease.status, "ready_for_reporting"); assert.equal(poolRelease.assignedDoctorId, null); assert.equal(poolRelease.plannedReportingDoctorId, null);
});

test("return preserves papers and remap, replans the assigned doctor, and re-release activates it", async () => {
  const creator = await createUser("receptionist"); const request = await createRequest(creator, "return lifecycle");
  const doctor = await createReportingDoctor("doctor", request.linkedModalityId!); const manager = await createReportingDoctor("supervisor", request.linkedModalityId!);
  await updateComparisonRequest(manager.actor, request.id, { plannedReportingDoctorId: doctor.doctorId });
  const document = await uploadComparisonRequestDocument(creator, request.id, { originalFilename: "return.pdf", mimeType: "application/pdf", fileContentBase64: Buffer.from("%PDF-1.4\nreturn\n%%EOF").toString("base64") }); created.documents.push(document.id);
  const context = await createDicomRemapStagingContext(creator.userId, request.id); created.remapJobs.push(context.job.id);
  await confirmComparisonMaterials(creator, request.id, { imageAvailabilityConfirmed: true, documentsDisposition: "attached_verified", selectedPriorConfirmed: true });
  const unrelated = await createReportingDoctor("doctor", request.linkedModalityId!);
  await expectHttpStatus(returnComparisonToPreparation(unrelated.actor, request.id, "no permission"), 403);
  await returnComparisonToPreparation(doctor.actor, request.id, "Need corrected comparison material");
  const returned = await pool.query<{ status: string; assigned_doctor_id: number | null; planned_reporting_doctor_id: number | null; planned_reporting_doctor_set_by: number | null; planned_reporting_doctor_set_at: string | null; materials_confirmed: boolean; documents_disposition: string | null; preparation_return_reason: string; assignments: string; documents: string; remap: number | null }>(`select cr.status,cr.assigned_doctor_id,cr.planned_reporting_doctor_id,cr.planned_reporting_doctor_set_by,cr.planned_reporting_doctor_set_at,cr.materials_confirmed,cr.documents_disposition,cr.preparation_return_reason,(select count(*)::text from doctor_portal.comparison_case_assignments a where a.comparison_request_id=cr.id and a.status='cancelled') assignments,(select count(*)::text from comparison_request_documents d where d.comparison_request_id=cr.id) documents,(select comparison_request_id from dicom_remap_jobs j where j.id=$2) remap from comparison_requests cr where cr.id=$1`, [request.id, context.job.id]);
  assert.equal(returned.rows[0]!.status, "pending_upload_confirmation"); assert.equal(returned.rows[0]!.assigned_doctor_id, null); assert.equal(Number(returned.rows[0]!.planned_reporting_doctor_id), doctor.doctorId); assert.equal(Number(returned.rows[0]!.planned_reporting_doctor_set_by), Number(doctor.actor.userId)); assert.ok(returned.rows[0]!.planned_reporting_doctor_set_at); assert.equal(returned.rows[0]!.materials_confirmed, false); assert.equal(returned.rows[0]!.documents_disposition, null); assert.equal(returned.rows[0]!.preparation_return_reason, "Need corrected comparison material"); assert.equal(Number(returned.rows[0]!.assignments), 1); assert.equal(Number(returned.rows[0]!.documents), 1); assert.equal(Number(returned.rows[0]!.remap), request.id);
  const rereleased = await confirmComparisonMaterials(creator, request.id, { imageAvailabilityConfirmed: true, documentsDisposition: "attached_verified", selectedPriorConfirmed: true }); assert.equal(rereleased.status, "assigned"); assert.equal(rereleased.assignedDoctorId, doctor.doctorId); assert.equal(rereleased.plannedReportingDoctorId, null);
  await cleanupDicomRemapStagingStorage(context.storageKey);
});

test("release without a plan stays in the reporting pool and ready returns retain no plan", async () => {
  const receptionist = await createUser("receptionist"); const manager = await createReportingDoctor("supervisor", (await createRequest(receptionist, "temporary")).linkedModalityId!);
  const request = await createRequest(receptionist, "no plan");
  const released = await confirmComparisonMaterials(receptionist, request.id, { imageAvailabilityConfirmed: true, documentsDisposition: "not_required", selectedPriorConfirmed: true });
  assert.equal(released.status, "ready_for_reporting"); assert.equal(released.assignedDoctorId, null); assert.equal(released.plannedReportingDoctorId, null); assert.equal(released.plannedReportingDoctorSetBy, null); assert.equal(released.plannedReportingDoctorSetAt, null);
  await returnComparisonToPreparation(manager.actor, request.id, "Needs review");
  const returned = await findComparisonRequestById(request.id); assert.equal(returned?.status, "pending_upload_confirmation"); assert.equal(returned?.plannedReportingDoctorId, null); assert.equal(returned?.plannedReportingDoctorSetBy, null); assert.equal(returned?.plannedReportingDoctorSetAt, null);
});

test("pending PATCH enforces ownership, refreshes the prior snapshot, and manages planned doctor metadata", async () => {
  const creator = await createUser("receptionist"); const request = await createRequest(creator, "patch source");
  const supervisor = await createReportingDoctor("supervisor", request.linkedModalityId!); const doctor = await createReportingDoctor("doctor", request.linkedModalityId!);
  assert.equal((await updateComparisonRequest(creator, request.id, { reason: "creator updated reason" })).reason, "creator updated reason");
  const other = await createUser("receptionist"); await expectHttpStatus(updateComparisonRequest(other, request.id, { reason: "not allowed" }), 403);
  const target = await createRequest(supervisor.actor, "patch target", request.patientId);
  await pool.query(`insert into doctor_portal.doctor_modality_permissions(doctor_id,modality_id,can_protocol,can_report,can_supervise,active) values($1,$2,true,true,true,true)`, [doctor.doctorId, target.linkedModalityId]);
  const changed = await updateComparisonRequest(supervisor.actor, request.id, { linkedPreviousBookingId: target.linkedPreviousBookingId, plannedReportingDoctorId: doctor.doctorId });
  assert.equal(changed.linkedPreviousBookingId, target.linkedPreviousBookingId); assert.equal(changed.linkedPreviousStudyUid, target.linkedPreviousStudyUid); assert.equal(changed.linkedPreviousAccessionNumber, target.linkedPreviousAccessionNumber); assert.equal(changed.linkedModalityId, target.linkedModalityId); assert.equal(changed.linkedModalityCode, target.linkedModalityCode); assert.equal(changed.linkedExamTypeId, target.linkedExamTypeId); assert.equal(changed.linkedExamName, target.linkedExamName); assert.equal(changed.linkedStudyDate, target.linkedStudyDate); assert.equal(changed.plannedReportingDoctorId, doctor.doctorId); assert.equal(changed.plannedReportingDoctorSetBy, Number(supervisor.actor.userId)); assert.ok(changed.plannedReportingDoctorSetAt);
  const cleared = await updateComparisonRequest(supervisor.actor, request.id, { plannedReportingDoctorId: null }); assert.equal(cleared.plannedReportingDoctorId, null); assert.equal(cleared.plannedReportingDoctorSetBy, null); assert.equal(cleared.plannedReportingDoctorSetAt, null);
  const document = await uploadComparisonRequestDocument(creator, request.id, { originalFilename: "lock.pdf", mimeType: "application/pdf", fileContentBase64: Buffer.from("%PDF-1.4\nlock\n%%EOF").toString("base64") }); created.documents.push(document.id);
  await expectHttpStatus(updateComparisonRequest(supervisor.actor, request.id, { linkedPreviousBookingId: target.linkedPreviousBookingId }), 409);
  const remapRequest = await createRequest(creator, "remap lock"); const remapTarget = await createRequest(creator, "remap target", remapRequest.patientId); const context = await createDicomRemapStagingContext(creator.userId, remapRequest.id); created.remapJobs.push(context.job.id);
  await expectHttpStatus(updateComparisonRequest(supervisor.actor, remapRequest.id, { linkedPreviousBookingId: remapTarget.linkedPreviousBookingId }), 409); await cleanupDicomRemapStagingStorage(context.storageKey);
  const autoClear = await createRequest(creator, "automatic plan clear"); const incompatiblePrior = await createRequest(creator, "incompatible prior", autoClear.patientId);
  await pool.query(`insert into doctor_portal.doctor_modality_permissions(doctor_id,modality_id,can_protocol,can_report,can_supervise,active) values($1,$2,true,true,true,true)`, [doctor.doctorId, autoClear.linkedModalityId]);
  await updateComparisonRequest(supervisor.actor, autoClear.id, { plannedReportingDoctorId: doctor.doctorId });
  const invalidated = await updateComparisonRequest(supervisor.actor, autoClear.id, { linkedPreviousBookingId: incompatiblePrior.linkedPreviousBookingId });
  assert.equal(invalidated.plannedReportingDoctorId, null); assert.equal(invalidated.plannedReportingDoctorSetBy, null); assert.equal(invalidated.plannedReportingDoctorSetAt, null);
});

after(async () => {
  for (const documentId of [...created.documents].reverse()) {
    await deleteDocumentById(documentId, null).catch(() => undefined);
  }
  if (created.remapJobs.length) await pool.query("delete from dicom_remap_jobs where id=any($1::bigint[])", [created.remapJobs]);
  if (created.comparisons.length) {
    await pool.query("delete from doctor_portal.doctor_module_audit_events where target_type='comparison_request' and target_id=any($1::bigint[])", [created.comparisons]);
    await pool.query("delete from comparison_requests where id=any($1::bigint[])", [created.comparisons]);
  }
  if (created.bookings.length) await pool.query("delete from appointments_v2.bookings where id=any($1::bigint[])", [created.bookings]);
  if (created.policyVersions.length) await pool.query("delete from appointments_v2.policy_versions where id=any($1::bigint[])", [created.policyVersions]);
  if (created.policySets.length) await pool.query("delete from appointments_v2.policy_sets where id=any($1::bigint[])", [created.policySets]);
  if (created.examTypes.length) await pool.query("delete from exam_types where id=any($1::bigint[])", [created.examTypes]);
  if (created.modalities.length) {
    await pool.query("delete from doctor_portal.doctor_modality_permissions where modality_id=any($1::bigint[])", [created.modalities]);
    await pool.query("delete from modalities where id=any($1::bigint[])", [created.modalities]);
  }
  if (created.patients.length) await pool.query("delete from patients where id=any($1::bigint[])", [created.patients]);
  if (created.doctorProfiles.length) {
    await pool.query("delete from doctor_portal.doctor_modality_permissions where doctor_id=any($1::bigint[])", [created.doctorProfiles]);
    await pool.query("delete from doctor_portal.doctor_profiles where id=any($1::bigint[])", [created.doctorProfiles]);
  }
  if (created.users.length) {
    await pool.query("delete from audit_log where changed_by_user_id=any($1::bigint[])", [created.users]);
    await pool.query("delete from users where id=any($1::bigint[])", [created.users]);
  }
  await pool.end();
});
