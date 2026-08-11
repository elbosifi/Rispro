import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import {
  attachDocumentToComparisonRequest,
  cancelComparisonRequest,
  createComparisonRequest,
  deleteComparisonRequestDocument,
  findComparisonRequestById,
  listComparisonRequestDocuments,
  uploadComparisonRequestDocument,
  type ComparisonActor,
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
};

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
  if (created.modalities.length) await pool.query("delete from modalities where id=any($1::bigint[])", [created.modalities]);
  if (created.patients.length) await pool.query("delete from patients where id=any($1::bigint[])", [created.patients]);
  if (created.users.length) {
    await pool.query("delete from audit_log where changed_by_user_id=any($1::bigint[])", [created.users]);
    await pool.query("delete from users where id=any($1::bigint[])", [created.users]);
  }
  await pool.end();
});
