import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { issueLegacyPublicCancelToken, issuePublicCancelToken, verifyPublicCancelToken } from "../modules/appointments-v2/public/utils/public-cancel-token.js";
import { resolveRequestScanAppointmentToken } from "./request-scan-appointment-token-service.js";
import { listDocuments, uploadDocumentIdempotently, type DocumentRow, type DocumentUploadPayload } from "./document-service.js";
import { resolveStoredPath } from "./document-storage-path.js";
import type { RequestScanBarcodeResult } from "./request-scan-barcode-service.js";
import {
  findEligibleRequestScanAppointment,
  downloadRequestScanJobFile,
  getRequestScanJob,
  listRequestScanJobs,
  manuallyAssignRequestScan,
  processClaimedRequestScanJob,
  processRequestScanJob,
  reconcileIncomingRequestScanFile,
  retryRequestScanArchive,
  bulkRetryRequestScanArchives,
  requestStopRequestScanJob,
  returnRequestScanToIncoming,
  retryRequestScanJob,
  runRequestScanCycle,
  type RequestScanServiceDependencies,
} from "./request-scan-service.js";
import { claimRequestScanJob } from "./request-scan-processing-service.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";
import { acquireRequestScanWorkerLeadership, releaseRequestScanWorkerLeadership } from "./request-scan-worker-control-service.js";

const created = { jobs: [] as number[], bookings: [] as number[], patients: [] as number[], policyVersions: [] as number[], policySets: [] as number[], modalities: [] as number[], examTypes: [] as number[], users: [] as number[] };
let sequence = 0;

const settings: RequestScanSettings = {
  enabled: true,
  server: "test-server",
  share: "test-share",
  domain: "",
  username: "test-user",
  password: "test-password",
  incomingSubfolder: "Requests/Incoming",
  processedSubfolder: "Requests/Processed",
  failedSubfolder: "Requests/Failed",
  pollingIntervalSeconds: 15,
  fileReadyDelaySeconds: 1,
};

function suffix() {
  sequence += 1;
  return `${Date.now()}_${sequence}`;
}

async function ensureDatabase(t: { skip(message: string): void }): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
}

async function createBooking(status = "scheduled") {
  const marker = suffix();
  const user = await pool.query<{ id: number }>(
    "insert into users(username, full_name, password_hash, role, is_active) values($1,$2,'test','supervisor',true) returning id",
    [`request_scan_${marker}`, `Request Scan ${marker}`]
  );
  const userId = Number(user.rows[0].id);
  created.users.push(userId);
  const patient = await pool.query<{ id: number }>(
    `insert into patients(national_id,identifier_type,identifier_value,arabic_full_name,english_full_name,normalized_arabic_name,age_years,estimated_date_of_birth,sex,phone_1,address,created_by_user_id,updated_by_user_id)
     values($1,'national_id',$2,$3,$4,$5,35,'1991-01-01','M','0912345678','Test',$6,$6) returning id`,
    [`8${marker.replace(/\D/g, "").slice(-11).padStart(11, "0")}`, `8${marker.replace(/\D/g, "").slice(-11).padStart(11, "0")}`, `طلب ${marker}`, `Request ${marker}`, `طلب${marker}`, userId]
  );
  const patientId = Number(patient.rows[0].id);
  created.patients.push(patientId);
  const modality = await pool.query<{ id: number }>(
    "insert into modalities(code,name_ar,name_en,daily_capacity,is_active) values($1,$2,$3,20,true) returning id",
    [`RS${marker.slice(-8)}`, `مود ${marker}`, `Request scan modality ${marker}`]
  );
  const modalityId = Number(modality.rows[0].id);
  created.modalities.push(modalityId);
  const exam = await pool.query<{ id: number }>(
    "insert into exam_types(modality_id,code,name_ar,name_en,is_active) values($1,$2,$3,$4,true) returning id",
    [modalityId, `request_scan_exam_${marker}`, `ÙØ­Øµ ${marker}`, `Request scan exam ${marker}`]
  );
  const examTypeId = Number(exam.rows[0].id);
  created.examTypes.push(examTypeId);
  const policySet = await pool.query<{ id: number }>(
    "insert into appointments_v2.policy_sets(key,name,created_by_user_id) values($1,$2,$3) returning id",
    [`request_scan_policy_${marker}`, `Request scan policy ${marker}`, userId]
  );
  const policySetId = Number(policySet.rows[0].id);
  created.policySets.push(policySetId);
  const policyVersion = await pool.query<{ id: number }>(
    "insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash,change_note,created_by_user_id) values($1,1,'published',$2,'request scan test',$3) returning id",
    [policySetId, `request_scan_${marker}`, userId]
  );
  const policyVersionId = Number(policyVersion.rows[0].id);
  created.policyVersions.push(policyVersionId);
  const booking = await pool.query<{ id: number }>(
    `insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,reporting_priority_id,booking_date,booking_time,case_category,status,notes,policy_version_id,created_by_user_id,updated_by_user_id)
     values($1,$2,$3,null,current_date,'09:00:00','non_oncology',$4,'request scan test',$5,$6,$6) returning id`,
    [patientId, modalityId, examTypeId, status, policyVersionId, userId]
  );
  const id = Number(booking.rows[0].id);
  created.bookings.push(id);
  return { id, patientId, userId, accession: `V2-${String(id).padStart(6, "0")}` };
}

async function createBookingForSamePatient(bookingId: number) {
  const source = await pool.query<{ patient_id: number; modality_id: number; policy_version_id: number; created_by_user_id: number }>(
    "select patient_id,modality_id,policy_version_id,created_by_user_id from appointments_v2.bookings where id=$1",
    [bookingId],
  );
  const row = source.rows[0]!;
  const inserted = await pool.query<{ id: number }>(
    `insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,reporting_priority_id,booking_date,booking_time,case_category,status,notes,policy_version_id,created_by_user_id,updated_by_user_id)
     values($1,$2,null,null,current_date+1,'10:00:00','non_oncology','scheduled','request scan multi test',$3,$4,$4) returning id`,
    [row.patient_id, row.modality_id, row.policy_version_id, row.created_by_user_id],
  );
  const id = Number(inserted.rows[0]!.id); created.bookings.push(id);
  return { id, patientId: Number(row.patient_id), accession: `V2-${String(id).padStart(6, "0")}` };
}

async function createJob(status = "pending", filename?: string) {
  const marker = suffix();
  const storedFilename = filename ?? `request-${marker}.jpg`;
  const result = await pool.query<{ id: number }>(
    "insert into request_scan_jobs(filename,source_relative_path,mime_type,status) values($1,$2,'image/jpeg',$3) returning id",
    [storedFilename, `Requests\\Incoming\\request-${marker}.jpg`, status]
  );
  const id = Number(result.rows[0].id);
  created.jobs.push(id);
  return id;
}

function dependencies(result: RequestScanBarcodeResult, options: {
  existingDocument?: () => boolean;
  failProcessedMove?: boolean;
  failAllMoves?: boolean;
  uploads?: Array<{ payload: unknown; userId: string | number | null }>;
  recognitionCalls?: string[];
  diagnostics?: Array<{ event: string; metadata: Record<string, string | number | boolean> }>;
  verifyToken?: typeof verifyPublicCancelToken;
  reconciliation?: "moved" | "already_moved" | "identical_source_removed" | "conflict" | "missing";
} = {}): RequestScanServiceDependencies {
  return {
    listRequestScanFiles: async () => [],
    downloadRequestScanFile: async (_settings, _remotePath, localPath) => { await fs.writeFile(localPath, "request scan"); },
    extractRequestScanBarcode: async (localPath) => { options.recognitionCalls?.push(localPath); return result; },
    moveRequestScanFile: async (_settings, _sourcePath, destinationFolder, filename) => {
      if (options.failAllMoves || (options.failProcessedMove && destinationFolder.includes("Processed") && !destinationFolder.includes("Duplicates"))) throw new Error("SMB move failed");
      return `${destinationFolder}\\${filename}`;
    },
    ...(options.reconciliation ? { reconcileRequestScanMove: async () => options.reconciliation! } : {}),
    uploadDocument: async (payload, userId) => {
      options.uploads?.push({ payload, userId: userId ?? null });
      const inserted = await pool.query<{ id: string }>(
        `insert into documents(patient_id,v2_booking_id,document_type,original_filename,stored_path,mime_type,file_size,uploaded_by_user_id,storage_location_type,source)
         values($1,$2,$3,$4,$5,$6,$7,$8,'local_fallback','request_scan_automation') returning id::text`,
        [payload.patientId, payload.appointmentId, payload.documentType, payload.originalFilename, `tests/${payload.originalFilename}`, payload.mimeType, payload.fileContentBuffer?.length ?? 0, userId ?? null]
      );
      return { id: Number(inserted.rows[0].id) } as DocumentRow;
    },
    automatedDocumentExists: async (appointmentId) => {
      if (options.existingDocument) return options.existingDocument();
      const existing = await pool.query("select 1 from documents where v2_booking_id=$1 and document_type='appointment_request' and source='request_scan_automation' limit 1", [appointmentId]);
      return Boolean(existing.rowCount);
    },
    findEligibleAppointment: findEligibleRequestScanAppointment,
    verifyPublicAppointmentToken: options.verifyToken ?? verifyPublicCancelToken,
    logDiagnostic(event, metadata) { options.diagnostics?.push({ event, metadata }); },
  };
}

test("finds exactly one eligible V2 accession and excludes cancelled, discontinued, and voided bookings", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const eligible = await createBooking("scheduled");
  const excluded = await Promise.all(["cancelled", "discontinued", "voided"].map((status) => createBooking(status)));

  const found = await findEligibleRequestScanAppointment(eligible.accession);
  assert.equal(Number(found.id), eligible.id);
  for (const booking of excluded) {
    await assert.rejects(() => findEligibleRequestScanAppointment(booking.accession), /No eligible appointment matches this accession/);
  }
});

test("Request Scan token resolver accepts genuine expired compact tokens while public verification remains unchanged", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const token = issueLegacyPublicCancelToken(booking.id, { expiresInSeconds: -60 });
  assert.ok(token);
  const resolved = await resolveRequestScanAppointmentToken(token);
  assert.deepEqual(resolved, { bookingId: booking.id, tokenType: "compact" });
  await assert.rejects(() => verifyPublicCancelToken(token), /expired/i);
});

test("Request Scan opaque token resolver rejects revocation without exposing the token", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const token = await issuePublicCancelToken(booking.id); assert.ok(token);
  assert.deepEqual(await resolveRequestScanAppointmentToken(token), { bookingId: booking.id, tokenType: "opaque" });
  await pool.query("update appointments_v2.public_appointment_tokens set revoked_at=now() where booking_id=$1", [booking.id]);
  await assert.rejects(() => resolveRequestScanAppointmentToken(token), (error: unknown) => (error as { details?: { code?: string } }).details?.code === "qr_token_revoked");
});

test("Request Scan resolver accepts expired legacy JWT signatures and rejects tampering or missing bookings", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const secret = process.env.APPOINTMENT_PUBLIC_TOKEN_SECRET || process.env.JWT_SECRET; assert.ok(secret);
  const expiredJwt = jwt.sign({ bookingId: booking.id, action: "cancel" }, secret, { algorithm: "HS256", expiresIn: -60 });
  assert.deepEqual(await resolveRequestScanAppointmentToken(expiredJwt), { bookingId: booking.id, tokenType: "jwt" });
  await assert.rejects(() => verifyPublicCancelToken(expiredJwt), /expired/i);
  await assert.rejects(() => resolveRequestScanAppointmentToken(`${expiredJwt.slice(0, -1)}x`), /Invalid Request Scan appointment token/);
  const missing = issueLegacyPublicCancelToken(999_999_999, { expiresInSeconds: 3600 }); assert.ok(missing);
  await assert.rejects(() => resolveRequestScanAppointmentToken(missing), (error: unknown) => (error as { details?: { code?: string } }).details?.code === "qr_booking_not_found");
});

test("same-patient multi-appointment identifiers create one document and link every appointment", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking(); const second = await createBookingForSamePatient(first.id); const jobId = await createJob();
  const firstToken = await issuePublicCancelToken(first.id); const secondToken = await issuePublicCancelToken(second.id); assert.ok(firstToken); assert.ok(secondToken);
  const multiDependencies = dependencies({ ok: true, accessions: [], qrTokens: [firstToken, secondToken] });
  multiDependencies.uploadDocumentIdempotently = uploadDocumentIdempotently;
  const completed = await processRequestScanJob(jobId, settings, multiDependencies);
  assert.equal(completed.status, "processed"); assert.equal(Number(completed.appointment_id), Math.min(first.id, second.id));
  const documents = await pool.query<{ id: number }>("select id from documents where request_scan_job_id=$1 or id=$2", [jobId, completed.document_id]);
  assert.equal(documents.rowCount, 1);
  const stored = await pool.query<DocumentRow>("select * from documents where id=$1", [completed.document_id]);
  const storedPath = resolveStoredPath(stored.rows[0]!.stored_path); assert.equal(await fs.stat(storedPath).then((value) => value.isFile(), () => false), true);
  const documentLinks = await pool.query<{ appointment_id: number }>("select appointment_id from document_appointment_links where document_id=$1 order by appointment_id", [completed.document_id]);
  assert.deepEqual(documentLinks.rows.map((row) => Number(row.appointment_id)), [first.id, second.id].sort((a, b) => a - b));
  const primaryDocuments = await listDocuments({ appointmentId: first.id, appointmentRefType: "v2_booking" });
  const secondaryDocuments = await listDocuments({ appointmentId: second.id, appointmentRefType: "v2_booking" });
  assert.equal(primaryDocuments.filter((document) => Number(document.id) === Number(completed.document_id)).length, 1);
  assert.equal(secondaryDocuments.filter((document) => Number(document.id) === Number(completed.document_id)).length, 1);
  const jobLinks = await pool.query<{ appointment_id: number; patient_id: number }>("select appointment_id,patient_id from request_scan_job_appointments where request_scan_job_id=$1 order by appointment_id", [jobId]);
  assert.deepEqual(jobLinks.rows.map((row) => Number(row.appointment_id)), [first.id, second.id].sort((a, b) => a - b));
  assert.equal(new Set(jobLinks.rows.map((row) => Number(row.patient_id))).size, 1);
  assert.equal((await getRequestScanJob(jobId)).matchedAppointments?.length, 2);
  await fs.rm(storedPath, { force: true });
});

test("different-patient and unresolved internal identifiers fail before attachment", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking(); const differentPatient = await createBooking();
  const conflictJob = await createJob();
  const conflict = await processRequestScanJob(conflictJob, settings, dependencies({ ok: true, accessions: [first.accession, differentPatient.accession], qrTokens: [] }));
  assert.equal(conflict.status, "failed"); assert.match(conflict.error_message || "", /different patients/); assert.equal(conflict.document_id, null);
  const unresolvedJob = await createJob();
  const unresolved = await processRequestScanJob(unresolvedJob, settings, dependencies({ ok: true, accessions: [first.accession, "V2-999999999"], qrTokens: [] }));
  assert.equal(unresolved.status, "failed"); assert.match(unresolved.error_message || "", /could not be resolved/); assert.equal(unresolved.document_id, null);
});

test("attaches a matched request through the document service and marks the job processed", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  const uploads: Array<{ payload: DocumentUploadPayload; userId: string | number | null }> = [];

  const job = await processRequestScanJob(jobId, settings, dependencies({ ok: true, accession: booking.accession }, { uploads }));
  assert.equal(job.status, "processed");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.ok(Number(job.document_id) > 0);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].userId, null);
  assert.equal(Number(uploads[0].payload.patientId), booking.patientId);
  assert.equal(Number(uploads[0].payload.appointmentId), booking.id);
  assert.equal(uploads[0].payload.appointmentRefType, "v2_booking");
  assert.equal(uploads[0].payload.documentType, "appointment_request");
  assert.equal(uploads[0].payload.source, "request_scan_automation");
  assert.equal(uploads[0].payload.fileContentBuffer, undefined);
  assert.equal(typeof uploads[0].payload.fileSourcePath, "string");
});

test("marks an existing automated request as a duplicate without attaching another document", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const existingDocument = dependencies({ ok: true, accession: booking.accession });
  await existingDocument.uploadDocument({
    patientId: booking.patientId,
    appointmentId: booking.id,
    appointmentRefType: "v2_booking",
    documentType: "appointment_request",
    originalFilename: "already-attached.jpg",
    mimeType: "image/jpeg",
    fileContentBuffer: Buffer.from("existing"),
    source: "request_scan_automation",
  }, null);

  const job = await processRequestScanJob(jobId, settings, dependencies({ ok: true, accession: booking.accession }, { uploads }));
  assert.equal(job.status, "duplicate");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.equal(uploads.length, 0);
  assert.match(job.source_relative_path, /^Requests\/Processed\\Duplicates\\/);
});

test("requires matching document evidence for an accession filename", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob("pending", `${booking.accession}.pdf`);
  const recognitionCalls: string[] = [];
  const uploads: Array<{ payload: DocumentUploadPayload; userId: string | number | null }> = [];
  const job = await processRequestScanJob(
    jobId,
    settings,
    dependencies({ ok: true, accession: booking.accession }, { recognitionCalls, uploads })
  );
  assert.equal(job.status, "processed");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.equal(job.barcode_value, booking.accession);
  assert.equal(recognitionCalls.length, 1);
  assert.equal(uploads.length, 1);

  const duplicateJobId = await createJob("pending", `Scan_${booking.accession}_Page1.jpg`);
  const duplicateRecognitionCalls: string[] = [];
  const duplicate = await processRequestScanJob(
    duplicateJobId,
    settings,
    dependencies({ ok: true, accession: booking.accession }, { recognitionCalls: duplicateRecognitionCalls })
  );
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicateRecognitionCalls.length, 1);
});

test("requires matching document QR evidence for a QR filename", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const token = await issuePublicCancelToken(booking.id);
  assert.ok(token);
  const filename = `https___rispro.nccb.com.ly_public_appointment_t=${token}.pdf`;
  const jobId = await createJob("pending", filename);
  const recognitionCalls: string[] = [];
  const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  let verifiedToken: string | null = null;
  const scannerDependencies = dependencies({ ok: true, qrTokens: [token] }, { recognitionCalls, diagnostics, verifyToken: async (value) => { verifiedToken = value; return verifyPublicCancelToken(value); } });
  const job = await processRequestScanJob(
    jobId,
    settings,
    scannerDependencies
  );
  assert.equal(job.status, "processed");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.equal(recognitionCalls.length, 1);
  assert.equal(verifiedToken, token);
  assert.ok(diagnostics.some(({ metadata }) => metadata.code === "IDENTIFIER_DOCUMENT_CONFIRMATION"));
  assert.equal(JSON.stringify(diagnostics).includes(token), false);
  assert.equal(job.error_message, null);

  const normalUrlJobId = await createJob("pending", `https://rispro.nccb.com.ly/public/appointment?t=${token}.pdf`);
  const normalUrlRecognitionCalls: string[] = [];
  const normalUrlDependencies = dependencies(
    { ok: true, qrTokens: [token] },
    { existingDocument: () => true, recognitionCalls: normalUrlRecognitionCalls }
  );
  normalUrlDependencies.downloadRequestScanFile = async () => {};
  const normalUrlJob = await processRequestScanJob(normalUrlJobId, settings, normalUrlDependencies);
  assert.equal(normalUrlJob.status, "duplicate");
  assert.equal(Number(normalUrlJob.appointment_id), booking.id);
  assert.equal(normalUrlRecognitionCalls.length, 1);
});

test("treats matching accession and QR evidence as consensus and conflicting evidence as manual review", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking();
  const second = await createBooking();
  const firstToken = await issuePublicCancelToken(first.id);
  const secondToken = await issuePublicCancelToken(second.id);
  assert.ok(firstToken);
  assert.ok(secondToken);

  const consensusId = await createJob("pending", `${first.accession}_https___rispro.nccb.com.ly_public_appointment_t=${firstToken}.pdf`);
  const consensusRecognitionCalls: string[] = [];
  const consensus = await processRequestScanJob(
    consensusId,
    settings,
    dependencies({ ok: true, accession: first.accession }, { recognitionCalls: consensusRecognitionCalls })
  );
  assert.equal(consensus.status, "processed");
  assert.equal(Number(consensus.appointment_id), first.id);
  assert.equal(consensusRecognitionCalls.length, 1);

  const conflictId = await createJob("pending", `${first.accession}_https___rispro.nccb.com.ly_public_appointment_t=${secondToken}.pdf`);
  const conflictRecognitionCalls: string[] = [];
  const conflict = await processRequestScanJob(
    conflictId,
    settings,
    dependencies({ ok: true, accession: first.accession }, { recognitionCalls: conflictRecognitionCalls })
  );
  assert.equal(conflict.status, "failed");
  assert.equal(conflict.error_message, "The filename contains conflicting appointment information. Assign the document manually.");
  assert.deepEqual(conflictRecognitionCalls, []);
});

test("requires document confirmation for partial filename evidence and rejects disagreement", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking();
  const second = await createBooking();
  const invalidToken = "pa_invalid_token_value";
  const matchingId = await createJob("pending", `${first.accession}_https___rispro.nccb.com.ly_public_appointment_t=${invalidToken}.jpg`);
  const matchingCalls: string[] = [];
  const matching = await processRequestScanJob(
    matchingId,
    settings,
    dependencies({ ok: true, accession: first.accession }, { recognitionCalls: matchingCalls })
  );
  assert.equal(matching.status, "processed");
  assert.equal(Number(matching.appointment_id), first.id);
  assert.equal(matchingCalls.length, 1);

  const disagreementId = await createJob("pending", `${first.accession}_https___rispro.nccb.com.ly_public_appointment_t=${invalidToken}.jpg`);
  const disagreement = await processRequestScanJob(
    disagreementId,
    settings,
    dependencies({ ok: true, accession: second.accession })
  );
  assert.equal(disagreement.status, "failed");
  assert.equal(disagreement.error_message, "The filename and scanned barcode identify different appointments. Assign the document manually.");
});

test("invalid, expired, and wrong-action filename tokens all invoke document fallback", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const tokens = [
    { rejection: "invalid", token: "pa_invalid_private_value" },
    { rejection: "expired", token: issueLegacyPublicCancelToken(booking.id, { expiresInSeconds: -1 }) },
    { rejection: "wrong-action", token: issueLegacyPublicCancelToken(booking.id, { action: "view" }) },
  ];
  for (const { rejection, token } of tokens) {
    assert.ok(token);
    const filename = `https___rispro.nccb.com.ly_public_appointment_t=${token}.jpg`;
    const jobId = await createJob("pending", filename);
    const recognitionCalls: string[] = [];
    const uploads: Array<{ payload: DocumentUploadPayload; userId: string | number | null }> = [];
    const job = await processRequestScanJob(
      jobId,
      settings,
      dependencies(
        { ok: true, accession: booking.accession },
        {
          recognitionCalls,
          uploads,
        }
      )
    );
    assert.equal(job.status, rejection === "invalid" ? "processed" : "duplicate");
    assert.equal(recognitionCalls.length, 1);
    assert.equal(String(job.error_message ?? "").includes(token), false);
    if (uploads[0]) assert.equal(uploads[0].payload.originalFilename, filename);
  }
});

test("multiple filename accessions resolving to different appointments require manual review", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking();
  const second = await createBooking();
  const jobId = await createJob("pending", `${first.accession}_${second.accession}.pdf`);
  const recognitionCalls: string[] = [];
  const job = await processRequestScanJob(
    jobId,
    settings,
    dependencies({ ok: true, accession: first.accession }, { recognitionCalls })
  );
  assert.equal(job.status, "failed");
  assert.equal(job.error_message, "The filename contains conflicting appointment information. Assign the document manually.");
  assert.deepEqual(recognitionCalls, []);
});

test("an unreadable document never promotes incomplete filename evidence", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const token = "pa_unverified_private_value";
  const filename = `${booking.accession}_https___rispro.nccb.com.ly_public_appointment_t=${token}.jpg`;
  const jobId = await createJob("pending", filename);
  const job = await processRequestScanJob(jobId, settings, dependencies({ ok: false, reason: "no_barcode" }));
  assert.equal(job.status, "failed");
  assert.equal(job.error_message, "No valid appointment identifier could be confirmed. Assign the document manually.");
  assert.equal(job.error_message.includes(token), false);
  assert.equal(job.appointment_id, null);
});

test("resolves a patient appointment QR detected in the document through the authoritative verifier", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const token = await issuePublicCancelToken(booking.id);
  assert.ok(token);
  const jobId = await createJob();
  const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  const job = await processRequestScanJob(
    jobId,
    settings,
    dependencies({ ok: true, qrTokens: [token] }, { diagnostics })
  );
  assert.equal(job.status, "processed");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.equal(job.barcode_value, booking.accession);
  assert.ok(diagnostics.some(({ metadata }) => metadata.code === "IDENTIFIER_SUCCESS_DOCUMENT_QR"));
  assert.equal(JSON.stringify(diagnostics).includes(token), false);
});

test("reconciles document accession and QR evidence as consensus or conflict", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking();
  const second = await createBooking();
  const firstToken = await issuePublicCancelToken(first.id);
  const secondToken = await issuePublicCancelToken(second.id);
  assert.ok(firstToken);
  assert.ok(secondToken);

  const consensusId = await createJob();
  const consensusDiagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  const consensus = await processRequestScanJob(
    consensusId,
    settings,
    dependencies({ ok: true, accession: first.accession, qrTokens: [firstToken] }, { diagnostics: consensusDiagnostics })
  );
  assert.equal(consensus.status, "processed");
  assert.equal(Number(consensus.appointment_id), first.id);
  assert.ok(consensusDiagnostics.some(({ metadata }) => metadata.code === "IDENTIFIER_SUCCESS_DOCUMENT_CONSENSUS"));

  const conflictId = await createJob();
  const conflict = await processRequestScanJob(
    conflictId,
    settings,
    dependencies({ ok: true, accession: first.accession, qrTokens: [secondToken] })
  );
  assert.equal(conflict.status, "failed");
  assert.equal(conflict.error_message, "The document contains appointment identifiers for different patients. Separate the document or assign it manually.");
  assert.equal(conflict.error_message.includes(secondToken), false);
});

test("multiple document QR tokens resolving differently require manual review", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking();
  const second = await createBooking();
  const firstToken = await issuePublicCancelToken(first.id);
  const secondToken = await issuePublicCancelToken(second.id);
  assert.ok(firstToken);
  assert.ok(secondToken);
  const jobId = await createJob();
  const job = await processRequestScanJob(
    jobId,
    settings,
    dependencies({ ok: true, qrTokens: [firstToken, secondToken] })
  );
  assert.equal(job.status, "failed");
  assert.equal(job.error_message, "The document contains appointment identifiers for different patients. Separate the document or assign it manually.");
});

test("invalid, expired, and wrong-action document QR tokens are rejected without disclosure", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const tokens = [
    "pa_invalid_document_private_value",
    issueLegacyPublicCancelToken(booking.id, { expiresInSeconds: -1 }),
    issueLegacyPublicCancelToken(booking.id, { action: "view" }),
  ];
  for (const token of tokens) {
    assert.ok(token);
    const jobId = await createJob();
    const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
    const job = await processRequestScanJob(jobId, settings, dependencies({ ok: true, qrTokens: [token] }, { diagnostics }));
    assert.equal(job.status, "failed");
    assert.equal(job.error_message, "No valid appointment identifier could be confirmed. Assign the document manually.");
    assert.equal(job.error_message.includes(token), false);
    assert.ok(diagnostics.some(({ metadata }) => metadata.code === "IDENTIFIER_DOCUMENT_QR_INVALID"));
    assert.equal(JSON.stringify(diagnostics).includes(token), false);
  }

  const accessionJobId = await createJob();
  const accessionJob = await processRequestScanJob(
    accessionJobId,
    settings,
    dependencies({ ok: true, accession: booking.accession, qrTokens: ["pa_invalid_but_ignored"] })
  );
  assert.equal(accessionJob.status, "failed");
  assert.equal(accessionJob.error_message, "The document contains an appointment identifier that could not be resolved. Review and assign the document manually.");
});

test("ignored unrelated document QR payloads remain manual and emit only safe diagnostics", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const jobId = await createJob();
  const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  const job = await processRequestScanJob(
    jobId,
    settings,
    dependencies({ ok: false, reason: "no_valid_accession", ignoredQrCount: 1 }, { diagnostics })
  );
  assert.equal(job.status, "failed");
  assert.equal(job.error_message, "No valid appointment identifier could be confirmed. Assign the document manually.");
  assert.ok(diagnostics.some(({ metadata }) => metadata.code === "IDENTIFIER_DOCUMENT_QR_IGNORED"));
});

test("persists a failed job with its concise barcode error", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const jobId = await createJob();
  const job = await processRequestScanJob(jobId, settings, dependencies({ ok: false, reason: "no_barcode" }));
  assert.equal(job.status, "failed");
  assert.equal(job.error_message, "No valid appointment identifier could be confirmed. Assign the document manually.");
  assert.equal(job.attempt_count, 1);
  assert.match(job.source_relative_path, /^Requests\/Failed\\/);
  assert.equal((await getRequestScanJob(jobId)).status, "failed");
});

test("active Request Scan filtering returns processing first and pending oldest-first", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const olderPendingId = await createJob("pending");
  const processingId = await createJob("processing");
  const newerPendingId = await createJob("pending");
  const failedId = await createJob("failed");
  const processedId = await createJob("processed");
  const duplicateId = await createJob("duplicate");
  await pool.query("update request_scan_jobs set created_at=$2 where id=$1", [olderPendingId, "2026-07-23T08:00:00.000Z"]);
  await pool.query("update request_scan_jobs set created_at=$2 where id=$1", [processingId, "2026-07-23T10:00:00.000Z"]);
  await pool.query("update request_scan_jobs set created_at=$2 where id=$1", [newerPendingId, "2026-07-23T09:00:00.000Z"]);
  const bilingualBooking = await createBooking();
  await pool.query("update request_scan_jobs set appointment_id=$2 where id=$1", [processingId, bilingualBooking.id]);

  const active = await listRequestScanJobs("active");
  const relevant = active.filter(({ id }) => [olderPendingId, processingId, newerPendingId, failedId].includes(Number(id)));
  assert.deepEqual(relevant.map(({ id }) => Number(id)), [processingId, olderPendingId, newerPendingId]);
  assert.deepEqual(relevant.map(({ status }) => status), ["processing", "pending", "pending"]);

  const bilingual = relevant.find(({ id }) => Number(id) === processingId)!;
  const source = await pool.query<{ patient_name_ar: string; patient_name_en: string; modality_name_ar: string; modality_name_en: string; exam_name_ar: string; exam_name_en: string }>(
    `select p.arabic_full_name as patient_name_ar,p.english_full_name as patient_name_en,m.name_ar as modality_name_ar,m.name_en as modality_name_en,e.name_ar as exam_name_ar,e.name_en as exam_name_en
     from appointments_v2.bookings b join patients p on p.id=b.patient_id join modalities m on m.id=b.modality_id join exam_types e on e.id=b.exam_type_id where b.id=$1`,
    [bilingualBooking.id],
  );
  assert.deepEqual({ patient_name_ar: bilingual.patient_name_ar, patient_name_en: bilingual.patient_name_en, modality_name_ar: bilingual.modality_name_ar, modality_name_en: bilingual.modality_name_en, exam_name_ar: bilingual.exam_name_ar, exam_name_en: bilingual.exam_name_en }, source.rows[0]);

  assert.ok((await listRequestScanJobs("failed")).some(({ id }) => Number(id) === failedId));
  assert.ok((await listRequestScanJobs("processed")).some(({ id }) => Number(id) === processedId));
  assert.ok((await listRequestScanJobs("duplicate")).some(({ id }) => Number(id) === duplicateId));
  assert.ok((await listRequestScanJobs("all")).some(({ id }) => Number(id) === failedId));
});

test("retry moves a failed Request Scan back to the durable pending queue without processing it", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const jobId = await createJob("failed");
  await pool.query("update request_scan_jobs set attempt_count=3,error_message='Previous failure',completed_at=now() where id=$1", [jobId]);
  let moveCalls = 0;

  const queued = await retryRequestScanJob(jobId, {
    readSettings: async () => settings,
    moveFile: async (_settings, sourcePath, destinationFolder, filename) => {
      moveCalls += 1;
      assert.match(sourcePath, /Incoming/);
      assert.equal(destinationFolder, settings.incomingSubfolder);
      return `${destinationFolder}\\${filename}`;
    },
  });

  assert.equal(moveCalls, 1);
  assert.equal(queued.status, "pending");
  assert.equal(queued.attempt_count, 3);
  assert.equal(queued.error_message, null);
  assert.equal(queued.completed_at, null);
  assert.match(queued.source_relative_path, /^Requests\/Incoming\\/);
  await assert.rejects(() => retryRequestScanJob(jobId, {
    readSettings: async () => settings,
    moveFile: async () => { throw new Error("must not move"); },
  }), /Only visible failed request scans can be retried/);
});

test("Return rejects attached jobs and durable pre-attachment Return completes or repairs after interruption", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const attachedId = await createJob();
  const attached = await processRequestScanJob(attachedId, settings, dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true }));
  assert.ok(attached.attachment_completed_at); await assert.rejects(() => returnRequestScanToIncoming(attachedId, { readSettings: async () => settings }), /already attached.*Resume archive/i);

  const jobId = await createJob("failed"); let reconciliations = 0; let triggers = 0;
  const returned = await returnRequestScanToIncoming(jobId, { readSettings: async () => settings, reconcileMove: async () => { reconciliations += 1; return "moved"; }, triggerWorker: async () => { triggers += 1; return {} as never; } });
  assert.equal(returned.status, "pending"); assert.ok(returned.return_requested_at); assert.ok(returned.return_completed_at); assert.match(returned.source_relative_path, /Incoming/); assert.equal(reconciliations, 1); assert.equal(triggers, 1);

  const interruptedId = await createJob("failed"); const interrupted = await getRequestScanJob(interruptedId);
  const destinationPath = `${settings.incomingSubfolder}\\${interrupted.filename}`;
  await pool.query("update request_scan_jobs set return_requested_at=now(),return_source_path=source_relative_path,return_destination_path=$2 where id=$1", [interruptedId, destinationPath]);
  const repaired = await returnRequestScanToIncoming(interruptedId, { readSettings: async () => settings, reconcileMove: async () => "already_moved", triggerWorker: async () => ({} as never) });
  assert.equal(repaired.status, "pending"); assert.equal(repaired.source_relative_path, destinationPath); assert.ok(repaired.return_completed_at);
});

test("Incoming ownership collisions are visible and completed Returns reactivate their terminal row", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const owner = await createJob("pending", "owned.pdf"); await pool.query("update request_scan_jobs set source_relative_path=$2 where id=$1", [owner, `${settings.incomingSubfolder}\\owned.pdf`]); const ownerRow = await getRequestScanJob(owner);
  const failed = await createJob("failed", "owned.pdf");
  await assert.rejects(() => returnRequestScanToIncoming(failed, { readSettings: async () => settings, reconcileMove: async () => "moved", triggerWorker: async () => ({} as never) }), /already owns/);
  const conflict = await reconcileIncomingRequestScanFile(ownerRow.filename, ownerRow.source_relative_path);
  assert.equal(conflict.outcome, "active"); assert.equal(Number(conflict.job.id), owner);

  const terminal = await createJob("processed", "terminal.pdf"); const terminalRow = await getRequestScanJob(terminal);
  const exposed = await reconcileIncomingRequestScanFile(terminalRow.filename, terminalRow.source_relative_path);
  assert.equal(exposed.outcome, "orphan_conflict"); assert.equal(exposed.job.status, "failed"); assert.match(exposed.job.error_message || "", /terminal Request Scan row/);

  const returnedId = await createJob("failed", "returned.pdf"); const returnedRow = await getRequestScanJob(returnedId);
  await pool.query("update request_scan_jobs set return_requested_at=now(),return_destination_path=source_relative_path,return_completed_at=now() where id=$1", [returnedId]);
  const reactivated = await reconcileIncomingRequestScanFile(returnedRow.filename, returnedRow.source_relative_path);
  assert.equal(reactivated.outcome, "reactivated"); assert.equal(reactivated.job.status, "pending");
});

test("identifier checkpoint skips recognition and preview prefers document then archive fallbacks", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const jobId = await createJob(); const recognitionCalls: string[] = [];
  await pool.query("update request_scan_jobs set appointment_id=$2,barcode_value=$3,identifier_verified_at=now(),identifier_strategy='document_accession' where id=$1", [jobId, booking.id, booking.accession]);
  const processed = await processRequestScanJob(jobId, settings, dependencies({ ok: false, reason: "no_barcode" }, { recognitionCalls }));
  assert.equal(processed.status, "processed"); assert.equal(recognitionCalls.length, 0);

  const previewJob = { ...(await getRequestScanJob(jobId)), document_id: 999, intended_destination_path: "Processed\\archive.pdf", source_relative_path: "Incoming\\missing.pdf" };
  const documentBytes = Buffer.from("attached document");
  const attachedPreview = await downloadRequestScanJobFile(jobId, { readSettings: async () => settings, getJob: async () => previewJob, getDocument: async () => ({ id: 999, stored_path: "safe" } as never), readFile: async () => documentBytes, downloadFile: async () => { throw new Error("SMB must not be used"); } });
  assert.deepEqual(attachedPreview.buffer, documentBytes);
  const tried: string[] = [];
  const archivePreview = await downloadRequestScanJobFile(jobId, { readSettings: async () => settings, getJob: async () => ({ ...previewJob, document_id: null }), downloadFile: async (_settings, remote, local) => { tried.push(remote); if (remote.includes("missing")) throw Object.assign(new Error("No such file"), { code: "ENOENT" }); await fs.writeFile(local, "archive"); } });
  assert.deepEqual(tried, ["Incoming\\missing.pdf", "Processed\\archive.pdf"]); assert.equal(archivePreview.buffer.toString(), "archive");
});

test("Stop before attachment prevents upload, moves to Failed, audits the user, and retry clears cancellation", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const jobId = await createJob(); const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const claimed = await claimRequestScanJob(jobId, "stop-test-worker"); assert.ok(claimed);
  const requested = await requestStopRequestScanJob(jobId, booking.userId);
  assert.ok(requested.cancel_requested_at); assert.equal(requested.cancel_reason, "manual_review_no_identifier");
  assert.equal(Number((await requestStopRequestScanJob(jobId, booking.userId)).id), jobId);
  const stopped = await processClaimedRequestScanJob(claimed, settings, dependencies({ ok: true, accession: booking.accession }, { uploads }));
  assert.equal(stopped.status, "failed"); assert.equal(stopped.failure_category, "recognition"); assert.match(stopped.error_message || "", /Automatic scanning was stopped/);
  assert.equal(uploads.length, 0); assert.match(stopped.source_relative_path, /Failed/);
  const audit = await pool.query<{ changed_by_user_id: number; new_values: { reason?: string } }>("select changed_by_user_id,new_values from audit_log where entity_type='request_scan_job' and entity_id=$1 and action_type='request_scan_processing_stopped' order by id desc limit 1", [jobId]);
  assert.equal(Number(audit.rows[0]?.changed_by_user_id), booking.userId); assert.equal(audit.rows[0]?.new_values.reason, "manual_review_no_identifier");
  const retried = await retryRequestScanJob(jobId, { readSettings: async () => settings, moveFile: async (_settings, _source, folder, filename) => `${folder}\\${filename}` });
  assert.equal(retried.status, "pending"); assert.equal(retried.cancel_requested_at, null); assert.equal(retried.cancel_requested_by, null); assert.equal(retried.cancel_reason, null);
});

test("Stop rejects queued, completed, attachment-completed, and irreversible-stage jobs", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const pending = await createJob("pending");
  await assert.rejects(() => requestStopRequestScanJob(pending, booking.userId), (error: Error & { statusCode?: number }) => error.statusCode === 409);
  const completed = await createJob("processed");
  await assert.rejects(() => requestStopRequestScanJob(completed, booking.userId), (error: Error & { statusCode?: number }) => error.statusCode === 409);
  for (const stage of ["attaching_document", "moving_file"]) {
    const id = await createJob("processing"); await pool.query("update request_scan_jobs set processing_stage=$2 where id=$1", [id, stage]);
    await assert.rejects(() => requestStopRequestScanJob(id, booking.userId), (error: Error & { statusCode?: number }) => error.statusCode === 409);
  }
  const attached = await createJob("processing"); await pool.query("update request_scan_jobs set attachment_completed_at=now() where id=$1", [attached]);
  await assert.rejects(() => requestStopRequestScanJob(attached, booking.userId), (error: Error & { statusCode?: number }) => error.statusCode === 409);
});

test("manual assignment queues a checkpointed worker job without direct upload", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob("failed");
  const uploads: Array<{ payload: DocumentUploadPayload; userId: string | number | null }> = [];

  const job = await manuallyAssignRequestScan(jobId, booking.id, booking.userId, settings, dependencies({ ok: false, reason: "no_barcode" }, { uploads }));
  assert.equal(job.status, "pending");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.equal(Number(job.manual_assignment_appointment_id), booking.id);
  assert.ok(job.manual_assignment_requested_at);
  assert.ok(job.manual_assignment_confirmed_at);
  assert.equal(uploads.length, 0);
});

test("after attachment succeeds and SMB moves fail, retry resumes the checkpoint without attaching again", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const first = dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true, uploads });

  const failed = await processRequestScanJob(jobId, settings, first);
  assert.equal(failed.status, "failed");
  assert.equal(uploads.length, 1);
  assert.ok(failed.attachment_completed_at); assert.ok(failed.document_id);
  const originalError = failed.error_message;
  const originalCategory = failed.failure_category;
  const originalUpdatedAt = failed.updated_at;
  const discovered = await reconcileIncomingRequestScanFile(failed.filename, failed.source_relative_path);
  assert.equal(discovered.outcome, "archive_pending");
  assert.equal(discovered.job.status, "failed");
  assert.equal(Number(discovered.job.id), jobId);
  assert.equal(Number(discovered.job.document_id), Number(failed.document_id));
  assert.equal(new Date(discovered.job.attachment_completed_at!).getTime(), new Date(failed.attachment_completed_at!).getTime());
  assert.equal(discovered.job.error_message, originalError);
  assert.equal(discovered.job.failure_category, originalCategory);
  assert.equal(new Date(discovered.job.updated_at).getTime(), new Date(originalUpdatedAt).getTime());
  const rediscovered = await reconcileIncomingRequestScanFile(failed.filename, failed.source_relative_path);
  assert.equal(rediscovered.outcome, "archive_pending");
  assert.equal(new Date(rediscovered.job.updated_at).getTime(), new Date(originalUpdatedAt).getTime());
  await pool.query("update request_scan_jobs set error_message='An Incoming file is owned by a terminal Request Scan row without a completed Return checkpoint. Manual reconciliation is required.',failure_category='internal_processing' where id=$1", [jobId]);
  const normalized = await reconcileIncomingRequestScanFile(failed.filename, failed.source_relative_path);
  assert.equal(normalized.outcome, "archive_pending");
  assert.equal(normalized.job.error_message, "Document attached successfully. Archive movement is pending.");
  assert.equal(normalized.job.failure_category, "smb_storage");
  assert.equal(Number(normalized.job.document_id), Number(failed.document_id));
  await pool.query("delete from document_appointment_links where document_id=$1", [failed.document_id]);
  assert.equal(failed.source_relative_path.includes("Incoming"), true);
  await retryRequestScanJob(jobId, { readSettings: async () => settings, moveFile: async () => { throw new Error("checkpointed retry must not move back to Incoming"); } });
  const recognitionCalls: string[] = [];
  const second = dependencies({ ok: true, accession: booking.accession }, { uploads, recognitionCalls });
  const resumed = await processRequestScanJob(jobId, settings, second);
  assert.equal(resumed.status, "processed");
  assert.equal(uploads.length, 1);
  assert.equal(recognitionCalls.length, 0);
  assert.equal((await pool.query("select count(*)::int as count from documents where id=$1", [failed.document_id])).rows[0].count, 1);
  assert.equal((await pool.query("select 1 from document_appointment_links where document_id=$1 and appointment_id=$2", [failed.document_id, booking.id])).rowCount, 1);
});

test("checkpointed identical source reconciliation completes without another upload", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const jobId = await createJob(); const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const failed = await processRequestScanJob(jobId, settings, dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true, uploads }));
  assert.equal(failed.status, "failed"); assert.ok(failed.attachment_completed_at);
  await pool.query("update request_scan_jobs set attachment_created=false where id=$1", [jobId]);
  await retryRequestScanJob(jobId, { readSettings: async () => settings, moveFile: async () => { throw new Error("must not move checkpointed source"); } });
  const resumed = await processRequestScanJob(jobId, settings, dependencies({ ok: false, reason: "no_barcode" }, { reconciliation: "identical_source_removed", uploads }));
  assert.equal(resumed.status, "duplicate");
  assert.equal(uploads.length, 1);
  assert.equal(Number(resumed.document_id), Number(failed.document_id));
  assert.ok(resumed.source_moved_at);
});

test("concurrent idempotent Request Scan uploads create one document and remove the losing file", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const jobA = await createJob();
  const key = `request-scan:job:${jobA}:appointment-request`;
  const payload = { patientId: booking.patientId, appointmentId: booking.id, appointmentRefType: "v2_booking", documentType: "appointment_request", originalFilename: "same-request.pdf", mimeType: "application/pdf", fileContentBuffer: Buffer.from("same-request"), source: "request_scan_automation" };
  const results = await Promise.all([uploadDocumentIdempotently({ ...payload, requestScanJobId: jobA }, null, key), uploadDocumentIdempotently({ ...payload, requestScanJobId: jobA }, null, key)]);
  assert.equal(new Set(results.map((result) => result.document.id)).size, 1); assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
  const rows = await pool.query<DocumentRow>("select * from documents where idempotency_key=$1", [key]); assert.equal(rows.rowCount, 1);
  const winningPath = resolveStoredPath(rows.rows[0].stored_path); const storedNames = await fs.readdir(path.dirname(winningPath));
  assert.equal(storedNames.filter((name) => name.endsWith("-same-request.pdf")).length, 1);
  await fs.rm(winningPath, { force: true }); await pool.query("delete from documents where id=$1", [rows.rows[0].id]);
});

test("archive-only retry queues the attached checkpoint once and reports per-item outcomes", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const jobId = await createJob();
  const failed = await processRequestScanJob(jobId, settings, dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true }));
  assert.ok(failed.document_id); assert.ok(failed.attachment_completed_at);
  await pool.query("update request_scan_jobs set archive_attempt_count=3,archive_last_error='SMB unavailable',archive_next_retry_at=now()+interval '10 minutes' where id=$1", [jobId]);
  const queued = await retryRequestScanArchive(jobId, booking.userId);
  assert.equal(queued.status, "pending"); assert.equal(queued.document_id, failed.document_id); assert.ok(queued.attachment_completed_at); assert.equal(queued.archive_next_retry_at, null);
  const again = await bulkRetryRequestScanArchives([jobId, 999999], booking.userId);
  assert.equal(again.queued.length, 0); assert.equal(again.failed.length, 2);
  const audit = await pool.query("select action_type from audit_log where entity_type='request_scan_job' and entity_id=$1 and action_type='request_scan_archive_retry_queued'", [jobId]);
  assert.equal(audit.rowCount, 1);
});

after(async () => {
  if (created.users.length) await pool.query("delete from audit_log where changed_by_user_id=any($1::bigint[])", [created.users]);
  if (created.jobs.length) await pool.query("delete from audit_log where entity_type='request_scan_job' and entity_id=any($1::bigint[])", [created.jobs]);
  if (created.patients.length) await pool.query("delete from documents where patient_id=any($1::bigint[]) and source='request_scan_automation'", [created.patients]);
  if (created.jobs.length) await pool.query("delete from request_scan_jobs where id = any($1::bigint[])", [created.jobs]);
  if (created.bookings.length) {
    await pool.query("delete from external_mwl_outbox where booking_id = any($1::bigint[])", [created.bookings]);
    await pool.query("delete from external_mwl_sync where booking_id = any($1::bigint[])", [created.bookings]);
    await pool.query("delete from appointments_v2.bookings where id = any($1::bigint[])", [created.bookings]);
  }
  if (created.patients.length) await pool.query("delete from patients where id = any($1::bigint[])", [created.patients]);
  if (created.policyVersions.length) await pool.query("delete from appointments_v2.policy_versions where id = any($1::bigint[])", [created.policyVersions]);
  if (created.policySets.length) await pool.query("delete from appointments_v2.policy_sets where id = any($1::bigint[])", [created.policySets]);
  if (created.examTypes.length) await pool.query("delete from exam_types where id = any($1::bigint[])", [created.examTypes]);
  if (created.modalities.length) await pool.query("delete from modalities where id = any($1::bigint[])", [created.modalities]);
  if (created.users.length) await pool.query("delete from users where id = any($1::bigint[])", [created.users]);
  await pool.end();
});
