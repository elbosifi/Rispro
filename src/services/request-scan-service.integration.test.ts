import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs/promises";
import { pool } from "../db/pool.js";
import { issueLegacyPublicCancelToken, issuePublicCancelToken, verifyPublicCancelToken } from "../modules/appointments-v2/public/utils/public-cancel-token.js";
import type { DocumentRow, DocumentUploadPayload } from "./document-service.js";
import type { RequestScanBarcodeResult } from "./request-scan-barcode-service.js";
import {
  findEligibleRequestScanAppointment,
  getRequestScanJob,
  listRequestScanJobs,
  manuallyAssignRequestScan,
  processRequestScanJob,
  retryRequestScanJob,
  runRequestScanCycle,
  type RequestScanServiceDependencies,
} from "./request-scan-service.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";

const created = { jobs: [] as number[], bookings: [] as number[], patients: [] as number[], policyVersions: [] as number[], policySets: [] as number[], modalities: [] as number[], users: [] as number[] };
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
     values($1,$2,null,null,current_date,'09:00:00','non_oncology',$3,'request scan test',$4,$5,$5) returning id`,
    [patientId, modalityId, status, policyVersionId, userId]
  );
  const id = Number(booking.rows[0].id);
  created.bookings.push(id);
  return { id, patientId, userId, accession: `V2-${String(id).padStart(6, "0")}` };
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
} = {}): RequestScanServiceDependencies {
  return {
    listRequestScanFiles: async () => [],
    downloadRequestScanFile: async (_settings, _remotePath, localPath) => { await fs.writeFile(localPath, "request scan"); },
    extractRequestScanBarcode: async (localPath) => { options.recognitionCalls?.push(localPath); return result; },
    moveRequestScanFile: async (_settings, _sourcePath, destinationFolder, filename) => {
      if (options.failAllMoves || (options.failProcessedMove && destinationFolder.includes("Processed") && !destinationFolder.includes("Duplicates"))) throw new Error("SMB move failed");
      return `${destinationFolder}\\${filename}`;
    },
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

test("uses an exact accession filename as a fast path while preserving eligibility and duplicate checks", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob("pending", `${booking.accession}.pdf`);
  const recognitionCalls: string[] = [];
  const uploads: Array<{ payload: DocumentUploadPayload; userId: string | number | null }> = [];
  const job = await processRequestScanJob(
    jobId,
    settings,
    dependencies({ ok: false, reason: "barcode_processing_failed" }, { recognitionCalls, uploads })
  );
  assert.equal(job.status, "processed");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.equal(job.barcode_value, booking.accession);
  assert.deepEqual(recognitionCalls, []);
  assert.equal(uploads.length, 1);

  const duplicateJobId = await createJob("pending", `Scan_${booking.accession}_Page1.jpg`);
  const duplicateRecognitionCalls: string[] = [];
  const duplicate = await processRequestScanJob(
    duplicateJobId,
    settings,
    dependencies({ ok: false, reason: "barcode_processing_failed" }, { recognitionCalls: duplicateRecognitionCalls })
  );
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(duplicateRecognitionCalls, []);
});

test("verifies scanner-safe patient QR filenames and skips document recognition", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const token = await issuePublicCancelToken(booking.id);
  assert.ok(token);
  const filename = `https___rispro.nccb.com.ly_public_appointment_t=${token}.pdf`;
  const jobId = await createJob("pending", filename);
  const recognitionCalls: string[] = [];
  const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  let verifiedToken: string | null = null;
  const scannerDependencies = dependencies({ ok: false, reason: "barcode_processing_failed" }, { recognitionCalls, diagnostics, verifyToken: async (value) => { verifiedToken = value; return verifyPublicCancelToken(value); } });
  const job = await processRequestScanJob(
    jobId,
    settings,
    scannerDependencies
  );
  assert.equal(job.status, "processed");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.deepEqual(recognitionCalls, []);
  assert.equal(verifiedToken, token);
  assert.ok(diagnostics.some(({ metadata }) => metadata.code === "IDENTIFIER_SUCCESS_FILENAME_QR"));
  assert.equal(JSON.stringify(diagnostics).includes(token), false);
  assert.equal(job.error_message, null);

  const normalUrlJobId = await createJob("pending", `https://rispro.nccb.com.ly/public/appointment?t=${token}.pdf`);
  const normalUrlRecognitionCalls: string[] = [];
  const normalUrlDependencies = dependencies(
    { ok: false, reason: "barcode_processing_failed" },
    { existingDocument: () => true, recognitionCalls: normalUrlRecognitionCalls }
  );
  normalUrlDependencies.downloadRequestScanFile = async () => {};
  const normalUrlJob = await processRequestScanJob(normalUrlJobId, settings, normalUrlDependencies);
  assert.equal(normalUrlJob.status, "duplicate");
  assert.equal(Number(normalUrlJob.appointment_id), booking.id);
  assert.deepEqual(normalUrlRecognitionCalls, []);
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
    dependencies({ ok: false, reason: "barcode_processing_failed" }, { recognitionCalls: consensusRecognitionCalls })
  );
  assert.equal(consensus.status, "processed");
  assert.equal(Number(consensus.appointment_id), first.id);
  assert.deepEqual(consensusRecognitionCalls, []);

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
  assert.equal(conflict.error_message, "The scanned document contains conflicting appointment information. Assign the document manually.");
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
  assert.equal(job.error_message, "The scanned document contains conflicting appointment information. Assign the document manually.");
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
  assert.equal(accessionJob.status, "processed");
  assert.equal(Number(accessionJob.appointment_id), booking.id);
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

  const active = await listRequestScanJobs("active");
  const relevant = active.filter(({ id }) => [olderPendingId, processingId, newerPendingId, failedId].includes(Number(id)));
  assert.deepEqual(relevant.map(({ id }) => Number(id)), [processingId, olderPendingId, newerPendingId]);
  assert.deepEqual(relevant.map(({ status }) => status), ["processing", "pending", "pending"]);

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
  }), /Only failed request scans can be retried/);
});

test("manually assigns a failed request to an eligible V2 appointment through the document service", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob("failed");
  const uploads: Array<{ payload: DocumentUploadPayload; userId: string | number | null }> = [];

  const job = await manuallyAssignRequestScan(jobId, booking.id, booking.userId, settings, dependencies({ ok: false, reason: "no_barcode" }, { uploads }));
  assert.equal(job.status, "processed");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.ok(Number(job.document_id) > 0);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].userId, booking.userId);
  assert.equal(Number(uploads[0].payload.appointmentId), booking.id);
  assert.equal(uploads[0].payload.appointmentRefType, "v2_booking");
  assert.equal(uploads[0].payload.documentType, "appointment_request");
  assert.equal(uploads[0].payload.source, "request_scan_automation");
});

test("after attachment succeeds and SMB moves fail, the next worker cycle records a duplicate without attaching again", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const first = dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true, uploads });

  const failed = await processRequestScanJob(jobId, settings, first);
  assert.equal(failed.status, "failed");
  assert.equal(uploads.length, 1);

  assert.equal(failed.source_relative_path.includes("Incoming"), true);
  const second = dependencies({ ok: true, accession: booking.accession }, { uploads });
  second.listRequestScanFiles = async () => [{ filename: failed.filename, relativePath: failed.source_relative_path, modifiedAt: null }];
  const cycle = await runRequestScanCycle(settings, second);
  assert.equal(cycle.discovered, 1);
  assert.equal(cycle.duplicates, 1);
  assert.equal((await getRequestScanJob(jobId)).status, "duplicate");
  assert.equal(uploads.length, 1);
});

after(async () => {
  if (created.jobs.length) await pool.query("delete from request_scan_jobs where id = any($1::bigint[])", [created.jobs]);
  if (created.bookings.length) {
    await pool.query("delete from external_mwl_outbox where booking_id = any($1::bigint[])", [created.bookings]);
    await pool.query("delete from external_mwl_sync where booking_id = any($1::bigint[])", [created.bookings]);
    await pool.query("delete from appointments_v2.bookings where id = any($1::bigint[])", [created.bookings]);
  }
  if (created.patients.length) await pool.query("delete from patients where id = any($1::bigint[])", [created.patients]);
  if (created.policyVersions.length) await pool.query("delete from appointments_v2.policy_versions where id = any($1::bigint[])", [created.policyVersions]);
  if (created.policySets.length) await pool.query("delete from appointments_v2.policy_sets where id = any($1::bigint[])", [created.policySets]);
  if (created.modalities.length) await pool.query("delete from modalities where id = any($1::bigint[])", [created.modalities]);
  if (created.users.length) await pool.query("delete from users where id = any($1::bigint[])", [created.users]);
  await pool.end();
});
