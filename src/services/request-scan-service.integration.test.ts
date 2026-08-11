import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { issueLegacyPublicCancelToken, issuePublicCancelToken, verifyPublicCancelToken } from "../modules/appointments-v2/public/utils/public-cancel-token.js";
import { resolveRequestScanAppointmentToken } from "./request-scan-appointment-token-service.js";
import { listDocuments, uploadDocumentIdempotently, upsertDocumentAppointmentLinks, type DocumentRow, type DocumentUploadPayload } from "./document-service.js";
import { resolveStoredPath } from "./document-storage-path.js";
import type { RequestScanBarcodeResult } from "./request-scan-barcode-service.js";
import {
  buildRequestScanInbox,
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
  sanitizeRequestScanModalityCode,
  verifyFailedRequestScanFileIdentity,
  type RequestScanServiceDependencies,
} from "./request-scan-service.js";
import { claimRequestScanJob, recoverExpiredRequestScanJobs, updateRequestScanCheckpoint } from "./request-scan-processing-service.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";
import { acquireRequestScanWorkerLeadership, releaseRequestScanWorkerLeadership } from "./request-scan-worker-control-service.js";
import { __resetAuthoritativeOrthancForTests, __setAuthoritativeOrthancSettingsForTests } from "./authoritative-orthanc-service.js";

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

before(() => {
  __setAuthoritativeOrthancSettingsForTests({
    enabled: true,
    autoExportClinicalDocuments: true,
    autoRouteEnabled: false,
    autoRouteDestinationKey: "",
    autoRouteDestinationKeys: [],
    baseUrl: "http://orthanc.test",
    username: "",
    password: "",
    timeoutSeconds: 10,
    verifyTls: true,
    displayName: "Test Orthanc",
  });
});

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
  return { id, patientId, userId, modalityId, accession: `V2-${String(id).padStart(6, "0")}` };
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
async function createModalityJob(modalityId: number, modalityCode: string, filename = `clinical-${suffix()}.jpg`, sourceRelativePath?: string) {
  const result = await pool.query<{ id: number }>(
    "insert into request_scan_jobs(filename,source_relative_path,mime_type,status,workflow_source,modality_id) values($1,$2,'image/jpeg','pending','modality',$3) returning id",
    [filename, sourceRelativePath ?? `ModalityDocuments\\${modalityCode}\\Incoming\\${filename}`, modalityId],
  );
  const id = Number(result.rows[0].id); created.jobs.push(id); return id;
}

function dependencies(result: RequestScanBarcodeResult, options: {
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
         values($1,$2,$3,$4,$5,$6,$7,$8,'local_fallback',$9) returning id::text`,
        [payload.patientId, payload.appointmentId, payload.documentType, payload.originalFilename, `tests/${payload.originalFilename}`, payload.mimeType, payload.fileContentBuffer?.length ?? 0, userId ?? null, payload.source]
      );
      return { id: Number(inserted.rows[0].id) } as DocumentRow;
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

test("Failed-file identity verification requires both exact size and SHA-256", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "request-scan-identity-test-"));
  try {
    const storedPath = path.join(tempDir, "stored.pdf");
    await fs.writeFile(storedPath, "same-size-a");
    const document = { stored_path: storedPath, file_size: 11 } as DocumentRow;
    const download = (content: string) => async (_settings: RequestScanSettings, _remotePath: string, localPath: string) => { await fs.writeFile(localPath, content); };
    assert.equal(await verifyFailedRequestScanFileIdentity(settings, "Failed\\same.pdf", document, download("same-size-a")), "match");
    assert.equal(await verifyFailedRequestScanFileIdentity(settings, "Failed\\different.pdf", document, download("same-size-b")), "mismatch");
    assert.equal(await verifyFailedRequestScanFileIdentity(settings, "Failed\\missing.pdf", document, async () => { throw Object.assign(new Error("No such file"), { code: "ENOENT" }); }), "missing");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("modality ingestion attaches clinical documents, rejects modality mismatches, and permits multiple files per appointment", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const ct = await createBooking("scheduled");
  const mri = await createBooking("scheduled");
  const ctCode = `CT${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [ct.modalityId, ctCode]);
  const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const firstId = await createModalityJob(ct.modalityId, ctCode, "ct-first.jpg");
  const secondId = await createModalityJob(ct.modalityId, ctCode, "ct-second.jpg");
  const mismatchId = await createModalityJob(ct.modalityId, ctCode, "ct-mismatch.jpg");
  const documentsBeforeMismatch = await pool.query<{ count: number }>("select count(*)::int count from documents where v2_booking_id=$1", [mri.id]);
  const linksBeforeMismatch = await pool.query<{ count: number }>("select count(*)::int count from document_appointment_links where appointment_id=$1", [mri.id]);

  const first = await processRequestScanJob(firstId, settings, dependencies({ ok: true, accession: ct.accession }, { uploads }));
  const second = await processRequestScanJob(secondId, settings, dependencies({ ok: true, accession: ct.accession }, { uploads }));
  const mismatch = await processRequestScanJob(mismatchId, settings, dependencies({ ok: true, accession: mri.accession }, { uploads }));

  assert.equal(first.status, "processed");
  assert.equal(second.status, "processed");
  assert.equal(uploads.length, 2);
  assert.equal((uploads[0]!.payload as DocumentUploadPayload).documentType, "clinical_document");
  assert.equal((uploads[0]!.payload as DocumentUploadPayload).source, "modality_scan_automation");
  assert.equal((await pool.query<{ count: number }>("select count(*)::int count from documents where v2_booking_id=$1 and document_type='clinical_document' and source='modality_scan_automation'", [ct.id])).rows[0]!.count, 2);
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.failure_category, "modality_mismatch");
  assert.match(mismatch.source_relative_path, /Failed/);
  assert.match(mismatch.source_relative_path, new RegExp(`ModalityDocuments[\\\\/]${ctCode}[\\\\/]Failed`));
  assert.equal((await pool.query<{ count: number }>("select count(*)::int count from documents where v2_booking_id=$1", [mri.id])).rows[0]!.count, documentsBeforeMismatch.rows[0]!.count);
  assert.equal((await pool.query<{ count: number }>("select count(*)::int count from document_appointment_links where appointment_id=$1", [mri.id])).rows[0]!.count, linksBeforeMismatch.rows[0]!.count);
  assert.equal((await pool.query("select 1 from request_scan_job_appointments where request_scan_job_id=$1", [mismatchId])).rowCount, 0);
  const ctJobs = await listRequestScanJobs("all", undefined, "modality", ct.modalityId);
  assert.ok([firstId, secondId, mismatchId].every((id) => ctJobs.some((job) => Number(job.id) === id)));
  assert.ok(ctJobs.every((job) => job.workflow_source === "modality" && Number(job.modality_id) === ct.modalityId));
  assert.ok(!(await listRequestScanJobs("all", undefined, "reception")).some((job) => [firstId, secondId, mismatchId].includes(Number(job.id))));
});

function fingerprintedRequestScanDependencies(accession: string, content: string, options: { failAllMoves?: boolean; recognitionCalls?: string[] } = {}): RequestScanServiceDependencies {
  const result = dependencies({ ok: true, accession }, { failAllMoves: options.failAllMoves, recognitionCalls: options.recognitionCalls });
  result.downloadRequestScanFile = async (_settings, _remotePath, localPath) => { await fs.writeFile(localPath, content); };
  result.uploadDocumentIdempotently = uploadDocumentIdempotently;
  result.upsertDocumentAppointmentLinks = upsertDocumentAppointmentLinks;
  return result;
}

test("reception Request Scans detect a renamed exact file only for the same appointment", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const firstId = await createJob("pending", "request-original.pdf");
  const first = await processRequestScanJob(firstId, settings, fingerprintedRequestScanDependencies(booking.accession, "same-request-bytes"));
  const secondId = await createJob("pending", "request-renamed.pdf");
  const second = await processRequestScanJob(secondId, settings, fingerprintedRequestScanDependencies(booking.accession, "same-request-bytes"));
  assert.equal(first.status, "processed"); assert.equal(second.status, "duplicate");
  assert.equal(Number(second.document_id), Number(first.document_id));
  assert.equal(second.error_message, "This file is identical to an existing document and was not attached again.");
  assert.equal((await pool.query("select id from documents where patient_id=$1 and v2_booking_id=$2 and document_type='appointment_request' and source='request_scan_automation'", [booking.patientId, booking.id])).rowCount, 1);
});

test("reception Request Scans accept same-named files with different bytes and different request documents", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const firstId = await createJob("pending", "same-name.pdf");
  const first = await processRequestScanJob(firstId, settings, fingerprintedRequestScanDependencies(booking.accession, "scan-bytes-one"));
  const secondId = await createJob("pending", "same-name.pdf");
  const second = await processRequestScanJob(secondId, settings, fingerprintedRequestScanDependencies(booking.accession, "scan-bytes-two"));
  const thirdId = await createJob("pending", "different-request.pdf");
  const third = await processRequestScanJob(thirdId, settings, fingerprintedRequestScanDependencies(booking.accession, "different-request-bytes"));
  assert.deepEqual([first.status, second.status, third.status], ["processed", "processed", "processed"]);
  assert.equal((await pool.query("select id from documents where patient_id=$1 and v2_booking_id=$2 and document_type='appointment_request' and source='request_scan_automation'", [booking.patientId, booking.id])).rowCount, 3);
});

test("different PDF bytes with the same visible pages are not perceptually deduplicated", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const firstId = await createJob("pending", "visible-page.pdf");
  const first = await processRequestScanJob(firstId, settings, fingerprintedRequestScanDependencies(booking.accession, "%PDF same visible page metadata-a"));
  const secondId = await createJob("pending", "visible-page-renamed.pdf");
  const second = await processRequestScanJob(secondId, settings, fingerprintedRequestScanDependencies(booking.accession, "%PDF same visible page metadata-b"));
  assert.deepEqual([first.status, second.status], ["processed", "processed"]);
  assert.notEqual(Number(first.document_id), Number(second.document_id));
});

function modalityDuplicateDependencies(accession: string, content: string, options: { failAllMoves?: boolean; recognitionCalls?: string[] } = {}): RequestScanServiceDependencies {
  const result = dependencies({ ok: true, accession }, { failAllMoves: options.failAllMoves, recognitionCalls: options.recognitionCalls });
  result.downloadRequestScanFile = async (_settings, _remotePath, localPath) => { await fs.writeFile(localPath, content); };
  result.uploadDocumentIdempotently = uploadDocumentIdempotently;
  result.upsertDocumentAppointmentLinks = upsertDocumentAppointmentLinks;
  return result;
}

test("modality ingestion reuses an identical file for the same appointment without a second export", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const code = `DU${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [booking.modalityId, code]);
  const firstId = await createModalityJob(booking.modalityId, code, "duplicate-same.pdf");
  const first = await processRequestScanJob(firstId, { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" }, modalityDuplicateDependencies(booking.accession, "identical modality PDF"));
  const secondId = await createModalityJob(booking.modalityId, code, "duplicate-renamed.pdf");
  const second = await processRequestScanJob(secondId, { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" }, modalityDuplicateDependencies(booking.accession, "identical modality PDF"));
  assert.equal(first.status, "processed"); assert.equal(second.status, "duplicate");
  assert.equal(Number(second.document_id), Number(first.document_id));
  assert.equal(second.attachment_created, false);
  assert.equal(second.error_message, "This file is identical to an existing document and was not attached again.");
  assert.equal((await pool.query("select id from documents where patient_id=$1 and document_type='clinical_document' and source='modality_scan_automation'", [booking.patientId])).rowCount, 1);
  assert.equal((await pool.query("select id from clinical_document_exports where document_id=$1 and appointment_id=$2", [first.document_id, booking.id])).rowCount, 1);
});

test("modality ingestion does not use a filename or hash alone as duplicate evidence", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking(); const second = await createBooking();
  const firstCode = `DF${suffix().slice(-6)}`; const secondCode = `DG${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [first.modalityId, firstCode]);
  await pool.query("update modalities set code=$2 where id=$1", [second.modalityId, secondCode]);
  const differentBytesA = await createModalityJob(first.modalityId, firstCode, "same-name.pdf");
  const otherPatient = await createModalityJob(second.modalityId, secondCode, "same-name.pdf");
  const settingsWithRoot = { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" };
  const a = await processRequestScanJob(differentBytesA, settingsWithRoot, modalityDuplicateDependencies(first.accession, "bytes-a"));
  const differentBytesB = await createModalityJob(first.modalityId, firstCode, "same-name.pdf");
  const b = await processRequestScanJob(differentBytesB, settingsWithRoot, modalityDuplicateDependencies(first.accession, "bytes-b"));
  const c = await processRequestScanJob(otherPatient, settingsWithRoot, modalityDuplicateDependencies(second.accession, "bytes-a"));
  assert.deepEqual([a.status, b.status, c.status], ["processed", "processed", "processed"]);
  assert.equal((await pool.query("select id from documents where document_type='clinical_document' and original_filename='same-name.pdf' and source='modality_scan_automation' and patient_id=any($1::bigint[])", [[first.patientId, second.patientId]])).rowCount, 3);
});

test("an identical modality document is linked and exported only for a newly identified appointment", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const first = await createBooking(); const second = await createBookingForSamePatient(first.id); const code = `DA${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [first.modalityId, code]);
  const firstId = await createModalityJob(first.modalityId, code, "same-patient.pdf");
  const settingsWithRoot = { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" };
  const original = await processRequestScanJob(firstId, settingsWithRoot, modalityDuplicateDependencies(first.accession, "same-patient-content"));
  const secondId = await createModalityJob(first.modalityId, code, "same-patient.pdf");
  const reused = await processRequestScanJob(secondId, settingsWithRoot, modalityDuplicateDependencies(second.accession, "same-patient-content"));
  assert.equal(reused.status, "duplicate"); assert.equal(Number(reused.document_id), Number(original.document_id));
  const links = await pool.query<{ appointment_id: number }>("select appointment_id from document_appointment_links where document_id=$1 order by appointment_id", [original.document_id]);
  assert.deepEqual(links.rows.map((row) => Number(row.appointment_id)), [first.id, second.id].sort((a, b) => a - b));
  const exports = await pool.query<{ appointment_id: number }>("select appointment_id from clinical_document_exports where document_id=$1 order by appointment_id", [original.document_id]);
  assert.deepEqual(exports.rows.map((row) => Number(row.appointment_id)), [first.id, second.id].sort((a, b) => a - b));
});

test("a legacy modality document is lazily fingerprinted before it is reused", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const code = `DL${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [booking.modalityId, code]);
  const firstId = await createModalityJob(booking.modalityId, code, "legacy-hash.pdf");
  const settingsWithRoot = { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" };
  const first = await processRequestScanJob(firstId, settingsWithRoot, modalityDuplicateDependencies(booking.accession, "legacy-content"));
  await pool.query("update documents set content_sha256=null where id=$1", [first.document_id]);
  const secondId = await createModalityJob(booking.modalityId, code, "legacy-hash.pdf");
  const second = await processRequestScanJob(secondId, settingsWithRoot, modalityDuplicateDependencies(booking.accession, "legacy-content"));
  assert.equal(second.status, "duplicate"); assert.equal(Number(second.document_id), Number(first.document_id));
  assert.match(String((await pool.query<{ content_sha256: string }>("select content_sha256 from documents where id=$1", [first.document_id])).rows[0]!.content_sha256), /^[0-9a-f]{64}$/);
});

test("a legacy modality fingerprint is recovered and reused for another appointment of the same patient", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const firstBooking = await createBooking(); const secondBooking = await createBookingForSamePatient(firstBooking.id); const code = `LX${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [firstBooking.modalityId, code]);
  const firstId = await createModalityJob(firstBooking.modalityId, code, "legacy-cross-appointment.pdf");
  const settingsWithRoot = { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" };
  const first = await processRequestScanJob(firstId, settingsWithRoot, modalityDuplicateDependencies(firstBooking.accession, "legacy-cross-content"));
  await pool.query("update documents set content_sha256=null where id=$1", [first.document_id]);
  const secondId = await createModalityJob(firstBooking.modalityId, code, "legacy-cross-renamed.pdf");
  const second = await processRequestScanJob(secondId, settingsWithRoot, modalityDuplicateDependencies(secondBooking.accession, "legacy-cross-content"));
  assert.equal(second.status, "duplicate"); assert.equal(Number(second.document_id), Number(first.document_id));
  assert.equal((await pool.query("select 1 from document_appointment_links where document_id=$1 and appointment_id=$2", [first.document_id, secondBooking.id])).rowCount, 1);
  assert.match(String((await pool.query<{ content_sha256: string }>("select content_sha256 from documents where id=$1", [first.document_id])).rows[0]!.content_sha256), /^[0-9a-f]{64}$/);
});

test("modality fingerprint reuse requires the matching SHA-256 and byte size", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const code = `DS${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [booking.modalityId, code]);
  const firstId = await createModalityJob(booking.modalityId, code, "size-check.pdf");
  const settingsWithRoot = { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" };
  const first = await processRequestScanJob(firstId, settingsWithRoot, modalityDuplicateDependencies(booking.accession, "size-check-content"));
  await pool.query("update documents set file_size=file_size+1 where id=$1", [first.document_id]);
  const secondId = await createModalityJob(booking.modalityId, code, "size-check.pdf");
  const second = await processRequestScanJob(secondId, settingsWithRoot, modalityDuplicateDependencies(booking.accession, "size-check-content"));
  assert.equal(second.status, "processed");
  assert.notEqual(Number(second.document_id), Number(first.document_id));
});

test("concurrent identical modality jobs create one document and an archive retry stays archive-only", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const code = `DC${suffix().slice(-6)}`;
  const filename = `concurrent-${suffix()}.pdf`;
  await pool.query("update modalities set code=$2 where id=$1", [booking.modalityId, code]);
  const firstId = await createModalityJob(booking.modalityId, code, filename);
  const secondId = await createModalityJob(booking.modalityId, code, filename, `ModalityDocuments\\${code}\\Incoming\\parallel\\${filename}`);
  const settingsWithRoot = { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" };
  const recognitionCalls: string[] = [];
  const [first, second] = await Promise.all([
    processRequestScanJob(firstId, settingsWithRoot, modalityDuplicateDependencies(booking.accession, "concurrent-content", { recognitionCalls })),
    processRequestScanJob(secondId, settingsWithRoot, modalityDuplicateDependencies(booking.accession, "concurrent-content", { recognitionCalls })),
  ]);
  assert.deepEqual([first.status, second.status].sort(), ["duplicate", "processed"]);
  assert.equal((await pool.query("select id from documents where patient_id=$1 and document_type='clinical_document' and source='modality_scan_automation'", [booking.patientId])).rowCount, 1);
  const stored = await pool.query<DocumentRow>("select * from documents where patient_id=$1 and document_type='clinical_document' and source='modality_scan_automation'", [booking.patientId]);
  const storedPath = resolveStoredPath(stored.rows[0].stored_path);
  assert.equal((await fs.stat(storedPath)).isFile(), true);
  assert.equal((await fs.readdir(path.dirname(storedPath))).filter((name) => name.endsWith(`-${filename}`)).length, 1);
  assert.equal((await pool.query("select id from clinical_document_exports where appointment_id=$1", [booking.id])).rowCount, 1);

  const failedId = await createModalityJob(booking.modalityId, code, filename);
  const failed = await processRequestScanJob(failedId, settingsWithRoot, modalityDuplicateDependencies(booking.accession, "concurrent-content", { failAllMoves: true, recognitionCalls }));
  assert.equal(failed.status, "failed"); assert.equal(failed.attachment_created, false);
  await retryRequestScanJob(failedId, { readSettings: async () => settingsWithRoot, moveFile: async () => { throw new Error("duplicate archive retry must not return to Incoming"); } });
  const resumed = await processRequestScanJob(failedId, settingsWithRoot, modalityDuplicateDependencies(booking.accession, "different-content", { recognitionCalls }));
  assert.equal(resumed.status, "duplicate");
  assert.equal(recognitionCalls.length, 3);
  assert.equal((await pool.query("select id from documents where patient_id=$1 and document_type='clinical_document' and source='modality_scan_automation'", [booking.patientId])).rowCount, 1);
});

test("modality inbox paths are exact and unsafe modality codes are rejected", () => {
  const inbox = buildRequestScanInbox({ ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" }, { id: 7, code: "CT" });
  assert.deepEqual(inbox, {
    workflowSource: "modality",
    modalityId: 7,
    modalityCode: "CT",
    incomingSubfolder: "ModalityDocuments\\CT\\Incoming",
    processedSubfolder: "ModalityDocuments\\CT\\Processed",
    failedSubfolder: "ModalityDocuments\\CT\\Failed",
  });
  for (const unsafe of ["", "   ", ".", "..", "CT/MRI", "CT\\MRI", "CT∕MRI", "CT／MRI"]) {
    assert.throws(() => sanitizeRequestScanModalityCode(unsafe), /unsafe/i);
  }
});

test("one cycle processes Reception and CT while isolating an unavailable MRI inbox and unsafe modality code", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const code = `CT${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [booking.modalityId, code]);
  const receptionFilename = `mixed-reception-${suffix()}.jpg`;
  const modalityFilename = `mixed-ct-${suffix()}.jpg`;
  const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  const base = dependencies({ ok: true, accession: booking.accession }, { uploads, diagnostics });
  const workerId = `mixed-cycle-${suffix()}`;
  assert.equal(await acquireRequestScanWorkerLeadership(workerId), true);
  let cycle: Awaited<ReturnType<typeof runRequestScanCycle>>;
  try {
    cycle = await runRequestScanCycle(
      { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" },
      {
        ...base,
        listActiveModalities: async () => [
          { id: booking.modalityId, code },
          { id: booking.modalityId + 100_000, code: "MRI" },
          { id: booking.modalityId + 200_000, code: "../unsafe" },
        ],
        ensureRequestScanFolders: async (_settings, folders) => {
          if (folders.some((folder) => folder.includes("\\MRI\\"))) throw Object.assign(new Error("MRI share unavailable"), { code: "ENOENT" });
        },
        listRequestScanFiles: async (_settings, _limit, incomingSubfolder) => {
          if (incomingSubfolder === settings.incomingSubfolder) return [{ filename: receptionFilename, relativePath: `Requests\\Incoming\\${receptionFilename}`, modifiedAt: null }];
          if (incomingSubfolder === `ModalityDocuments\\${code}\\Incoming`) return [{ filename: modalityFilename, relativePath: `ModalityDocuments\\${code}\\Incoming\\${modalityFilename}`, modifiedAt: null }];
          return [];
        },
      },
      workerId,
    );
  } finally {
    await releaseRequestScanWorkerLeadership(workerId);
  }
  const jobs = await pool.query<{ id: number }>("select id from request_scan_jobs where filename=any($1::text[])", [[receptionFilename, modalityFilename]]);
  created.jobs.push(...jobs.rows.map((row) => Number(row.id)));

  assert.equal(cycle.discovered, 2);
  const outcomes = await pool.query("select filename,status,error_message,failure_category from request_scan_jobs where filename=any($1::text[]) order by filename", [[receptionFilename, modalityFilename]]);
  assert.equal(cycle.processed, 2, JSON.stringify({ cycle, outcomes: outcomes.rows, diagnostics }));
  assert.deepEqual(uploads.map(({ payload }) => (payload as DocumentUploadPayload).documentType).sort(), ["appointment_request", "clinical_document"]);
  assert.ok(diagnostics.some(({ event, metadata }) => event === "request_scan_inbox_failed" && metadata.modalityCode === "MRI"));
  assert.ok(diagnostics.some(({ event, metadata }) => event === "request_scan_inbox_failed" && metadata.stage === "configuration"));
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

test("allows a different automated request document for an appointment that already has one", async (t) => {
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
  assert.equal(job.status, "processed");
  assert.equal(Number(job.appointment_id), booking.id);
  assert.equal(uploads.length, 1);
  assert.match(job.source_relative_path, /^Requests[\\/]Processed[\\/]/);
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
  assert.equal(duplicate.status, "processed");
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
  const normalUrlDependencies = dependencies({ ok: true, qrTokens: [token] }, { recognitionCalls: normalUrlRecognitionCalls });
  normalUrlDependencies.downloadRequestScanFile = async () => {};
  const normalUrlJob = await processRequestScanJob(normalUrlJobId, settings, normalUrlDependencies);
  assert.equal(normalUrlJob.status, "processed");
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
    assert.equal(job.status, "processed");
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
  assert.equal(returned.status, "pending"); assert.equal(returned.return_requested_at, null); assert.equal(returned.return_source_path, null); assert.equal(returned.return_destination_path, null); assert.equal(returned.return_completed_at, null); assert.match(returned.source_relative_path, /Incoming/); assert.equal(reconciliations, 0); assert.equal(triggers, 1);

  const interruptedId = await createJob("failed"); const interrupted = await getRequestScanJob(interruptedId);
  const destinationPath = `${settings.incomingSubfolder}\\${interrupted.filename}`;
  await pool.query("update request_scan_jobs set return_requested_at=now(),return_source_path=source_relative_path,return_destination_path=$2 where id=$1", [interruptedId, destinationPath]);
  const repaired = await returnRequestScanToIncoming(interruptedId, { readSettings: async () => settings, reconcileMove: async () => "already_moved", triggerWorker: async () => ({} as never) });
  assert.equal(repaired.status, "pending"); assert.equal(repaired.source_relative_path, destinationPath); assert.equal(repaired.return_requested_at, null); assert.equal(repaired.return_source_path, null); assert.equal(repaired.return_destination_path, null); assert.equal(repaired.return_completed_at, null);
});

test("Incoming ownership collisions are visible and only in-progress Returns reactivate their terminal row", async (t) => {
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
  const stale = await reconcileIncomingRequestScanFile(returnedRow.filename, returnedRow.source_relative_path);
  assert.equal(stale.outcome, "orphan_conflict");

  const inProgressId = await createJob("failed", "in-progress-returned.pdf"); const inProgressRow = await getRequestScanJob(inProgressId);
  const inProgressDestination = `${settings.incomingSubfolder}\\${inProgressRow.filename}`;
  await pool.query("update request_scan_jobs set return_requested_at=now(),return_source_path=$2,return_destination_path=$3,return_completed_at=null where id=$1", [inProgressId, inProgressRow.source_relative_path, inProgressDestination]);
  const reactivated = await reconcileIncomingRequestScanFile(inProgressRow.filename, inProgressDestination);
  assert.equal(reactivated.outcome, "reactivated"); assert.equal(reactivated.job.status, "pending");
  assert.equal(reactivated.job.return_requested_at, null); assert.equal(reactivated.job.return_source_path, null); assert.equal(reactivated.job.return_destination_path, null); assert.equal(reactivated.job.return_completed_at, null);
});

test("retry across calendar dates uses the current Failed source instead of an old Return checkpoint", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const jobId = await createJob("failed", "dated-retry.pdf");
  const currentFailedPath = `${settings.failedSubfolder}\\2026-07-28\\dated-retry.pdf`;
  const oldReturnPath = `${settings.failedSubfolder}\\2026-07-27\\dated-retry.pdf`;
  await pool.query("update request_scan_jobs set source_relative_path=$2,return_requested_at=$3,return_source_path=$4,return_destination_path=$5,return_completed_at=$6 where id=$1", [jobId, currentFailedPath, "2026-07-27T10:00:00Z", oldReturnPath, `${settings.incomingSubfolder}\\dated-retry.pdf`, "2026-07-27T10:01:00Z"]);
  let movedFrom = "";
  const retried = await retryRequestScanJob(jobId, {
    readSettings: async () => settings,
    moveFile: async (_settings, sourcePath, destinationFolder, filename) => { movedFrom = sourcePath; return `${destinationFolder}\\${filename}`; },
  });
  assert.equal(movedFrom, currentFailedPath);
  assert.equal(retried.source_relative_path, `${settings.incomingSubfolder}\\dated-retry.pdf`);
  assert.equal(retried.return_requested_at, null);
  assert.equal(retried.return_source_path, null);
  assert.equal(retried.return_destination_path, null);
  assert.equal(retried.return_completed_at, null);
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

test("manual assignment processes through the real checkpoint constraint and queues completed Orthanc export", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking("completed");
  await pool.query("update appointments_v2.bookings set completed_at=now() where id=$1", [booking.id]);
  const code = `CT${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [booking.modalityId, code]);
  const jobId = await createModalityJob(booking.modalityId, code, `manual-${suffix()}.jpg`);
  await pool.query("update request_scan_jobs set status='failed',failure_category='recognition',error_message='No barcode',completed_at=now() where id=$1", [jobId]);

  await manuallyAssignRequestScan(jobId, booking.id, booking.userId, settings);
  const dependenciesWithRealUpload = dependencies({ ok: false, reason: "no_barcode" }, { reconciliation: "moved" });
  dependenciesWithRealUpload.uploadDocumentIdempotently = uploadDocumentIdempotently;
  const processed = await processRequestScanJob(jobId, { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" }, dependenciesWithRealUpload);

  assert.equal(processed.status, "processed");
  assert.equal(processed.identifier_strategy, "manual");
  assert.ok(processed.identifier_verified_at);
  assert.ok(processed.document_id);
  assert.ok(processed.attachment_completed_at);
  assert.match(processed.source_relative_path, new RegExp(`ModalityDocuments[\\\\/]${code}[\\\\/]Processed`));
  assert.ok(processed.source_moved_at);

  const checkpoint = await pool.query<{ identifier_source: string }>("select identifier_source from request_scan_job_appointments where request_scan_job_id=$1 and appointment_id=$2", [jobId, booking.id]);
  assert.deepEqual(checkpoint.rows, [{ identifier_source: "manual" }]);
  const document = await pool.query<{ id: number; document_type: string; source: string; stored_path: string }>("select id,document_type,source,stored_path from documents where id=$1", [processed.document_id]);
  assert.deepEqual(document.rows[0] && { document_type: document.rows[0].document_type, source: document.rows[0].source }, { document_type: "clinical_document", source: "modality_scan_automation" });
  assert.ok(await fs.stat(resolveStoredPath(document.rows[0]!.stored_path)).then((value) => value.isFile(), () => false));
  const exportRow = await pool.query<{ status: string; destination_key: string }>("select status,destination_key from clinical_document_exports where document_id=$1 and appointment_id=$2", [processed.document_id, booking.id]);
  assert.deepEqual(exportRow.rows, [{ status: "pending", destination_key: "authoritative_orthanc" }]);
  await fs.rm(resolveStoredPath(document.rows[0]!.stored_path), { force: true });
});

test("unexpected Request Scan failures retain safe database diagnostics", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob("pending");
  const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  const failingDependencies = dependencies({ ok: true, accession: booking.accession }, { diagnostics });
  failingDependencies.uploadDocumentIdempotently = async () => {
    throw Object.assign(new Error("check failed for patient John Doe at C:\\sensitive\\source.pdf"), { code: "23514", constraint: "request_scan_job_appointments_identifier_source_check" });
  };
  const failed = await processRequestScanJob(jobId, settings, failingDependencies);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_message, "The document could not be attached because the Request Scan database configuration is incompatible. Contact an administrator.");
  const failureDiagnostics = diagnostics.filter(({ event }) => event === "request_scan_processing_failed");
  assert.equal(failureDiagnostics.length, 1);
  assert.deepEqual(failureDiagnostics[0]!.metadata, {
    eventType: "request_scan_processing_failed",
    jobId,
    processingStage: "attaching_document",
    workflowSource: "reception",
    modalityId: 0,
    errorName: "Error",
    safeErrorMessage: "The document could not be attached because the Request Scan database configuration is incompatible. Contact an administrator.",
    postgresErrorCode: "23514",
    postgresConstraint: "request_scan_job_appointments_identifier_source_check",
  });
  assert.doesNotMatch(JSON.stringify(failureDiagnostics), /John Doe|sensitive|source\.pdf/i);
});

test("manual assignment rejects a different-modality appointment without mutating the modality job", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const ct = await createBooking();
  const mri = await createBooking();
  const ctCode = `CT${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [ct.modalityId, ctCode]);
  const jobId = await createModalityJob(ct.modalityId, ctCode, "ct-manual-mismatch.jpg");
  await pool.query("update request_scan_jobs set status='failed',failure_category='recognition',error_message='Manual review required',completed_at=now() where id=$1", [jobId]);
  const before = await getRequestScanJob(jobId);

  await assert.rejects(
    () => manuallyAssignRequestScan(jobId, mri.id, ct.userId, settings, dependencies({ ok: false, reason: "no_barcode" })),
    /No eligible appointment matches this selection/,
  );

  const after = await getRequestScanJob(jobId);
  assert.equal(after.status, before.status);
  assert.equal(after.failure_category, before.failure_category);
  assert.equal(after.error_message, before.error_message);
  assert.equal(after.appointment_id, null);
  assert.equal(after.manual_assignment_appointment_id, null);
  assert.equal(after.manual_assignment_requested_at, null);
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

test("a committed attachment checkpoint with a lost acknowledgement is never moved to Failed", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  const failedMoves: string[] = [];
  const injected = dependencies({ ok: true, accession: booking.accession });
  injected.updateCheckpoint = async (id, lease, values) => {
    const checkpointed = await updateRequestScanCheckpoint(id, lease, values);
    if (values.attachment_completed_at) throw new Error("Simulated lost attachment-checkpoint acknowledgement.");
    return checkpointed;
  };
  injected.moveRequestScanFile = async (_settings, sourcePath, destinationFolder, filename) => {
    if (destinationFolder.includes("Failed")) failedMoves.push(sourcePath);
    return `${destinationFolder}\\${filename}`;
  };

  const result = await processRequestScanJob(jobId, settings, injected);
  const authoritative = await getRequestScanJob(jobId);

  assert.ok(authoritative.document_id);
  assert.ok(authoritative.attachment_completed_at);
  assert.equal(authoritative.source_relative_path.includes("Incoming"), true);
  assert.equal(result.source_relative_path.includes("Incoming"), true);
  assert.deepEqual(failedMoves, []);
});

test("a successful Failed move with a lost path checkpoint is reconciled on the next lease cycle", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const jobId = await createJob();
  const original = await getRequestScanJob(jobId);
  const remoteFiles = new Set([original.source_relative_path]);
  let expireAfterMove = true;
  const injected = dependencies({ ok: false, reason: "no_barcode" });
  injected.downloadRequestScanFile = async (_settings, remotePath, localPath) => {
    if (!remoteFiles.has(remotePath)) throw Object.assign(new Error("No such file"), { code: "ENOENT" });
    await fs.writeFile(localPath, "request scan");
  };
  injected.reconcileRequestScanMove = async (_settings, sourcePath, destinationPath) => {
    if (remoteFiles.has(sourcePath) && !remoteFiles.has(destinationPath)) {
      remoteFiles.delete(sourcePath);
      remoteFiles.add(destinationPath);
      if (expireAfterMove && destinationPath.includes("Failed")) {
        expireAfterMove = false;
        await pool.query("update request_scan_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [jobId]);
      }
      return "moved";
    }
    if (!remoteFiles.has(sourcePath) && remoteFiles.has(destinationPath)) return "already_moved";
    if (remoteFiles.has(sourcePath) && remoteFiles.has(destinationPath)) return "conflict";
    return "missing";
  };

  const ambiguous = await processRequestScanJob(jobId, settings, injected);
  assert.equal(ambiguous.status, "processing");
  assert.equal(ambiguous.source_relative_path, original.source_relative_path);
  assert.ok(ambiguous.failure_destination_path);
  assert.equal(remoteFiles.has(ambiguous.failure_destination_path!), true);

  assert.equal((await recoverExpiredRequestScanJobs()).requeued, 1);
  const reconciled = await processRequestScanJob(jobId, settings, injected);
  assert.equal(reconciled.status, "failed");
  assert.equal(reconciled.source_relative_path, ambiguous.failure_destination_path);
  assert.ok(reconciled.failure_moved_at);
  assert.equal(remoteFiles.has(reconciled.source_relative_path), true);
});

test("an archive move with a lost source-moved checkpoint completes idempotently on retry", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  const original = await getRequestScanJob(jobId);
  const remoteFiles = new Set([original.source_relative_path]);
  const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const recognitionCalls: string[] = [];
  let expireAfterArchiveMove = true;
  const injected = dependencies({ ok: true, accession: booking.accession }, { uploads, recognitionCalls });
  injected.downloadRequestScanFile = async (_settings, remotePath, localPath) => {
    if (!remoteFiles.has(remotePath)) throw Object.assign(new Error("No such file"), { code: "ENOENT" });
    await fs.writeFile(localPath, "request scan");
  };
  injected.reconcileRequestScanMove = async (_settings, sourcePath, destinationPath) => {
    if (remoteFiles.has(sourcePath) && !remoteFiles.has(destinationPath)) {
      remoteFiles.delete(sourcePath);
      remoteFiles.add(destinationPath);
      if (expireAfterArchiveMove && destinationPath.includes("Processed")) {
        expireAfterArchiveMove = false;
        await pool.query("update request_scan_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [jobId]);
      }
      return "moved";
    }
    if (!remoteFiles.has(sourcePath) && remoteFiles.has(destinationPath)) return "already_moved";
    if (remoteFiles.has(sourcePath) && remoteFiles.has(destinationPath)) return "conflict";
    return "missing";
  };

  const ambiguous = await processRequestScanJob(jobId, settings, injected);
  assert.equal(ambiguous.status, "processing");
  assert.ok(ambiguous.document_id);
  assert.ok(ambiguous.attachment_completed_at);
  assert.ok(ambiguous.intended_destination_path);
  assert.equal(ambiguous.source_moved_at, null);
  assert.equal(remoteFiles.has(ambiguous.intended_destination_path!), true);

  assert.equal((await recoverExpiredRequestScanJobs()).requeued, 1);
  const completed = await processRequestScanJob(jobId, settings, injected);
  assert.equal(completed.status, "processed");
  assert.equal(completed.source_relative_path, ambiguous.intended_destination_path);
  assert.ok(completed.source_moved_at);
  assert.equal(uploads.length, 1);
  assert.equal(recognitionCalls.length, 1);
});

test("an attached document stranded in its deterministic Failed path is hash-verified and archived without reprocessing", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const failed = await processRequestScanJob(jobId, settings, dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true, uploads }));
  assert.equal(failed.status, "failed");
  await retryRequestScanJob(jobId, { readSettings: async () => settings, moveFile: async () => { throw new Error("attached retry must not move to Incoming"); } });

  const recognitionCalls: string[] = [];
  const reconciliations: Array<{ source: string; destination: string }> = [];
  let verifiedPath = "";
  const recovery = dependencies({ ok: false, reason: "no_barcode" }, { uploads, recognitionCalls });
  recovery.reconcileRequestScanMove = async (_settings, source, destination) => {
    reconciliations.push({ source, destination });
    return source.includes("Failed") ? "moved" : "missing";
  };
  recovery.verifyFailedFileIdentity = async (_settings, remotePath) => {
    verifiedPath = remotePath;
    return "match";
  };

  const completed = await processRequestScanJob(jobId, settings, recovery);
  assert.equal(completed.status, "processed");
  assert.ok(completed.source_moved_at);
  assert.equal(completed.archive_recovered_from_path, verifiedPath);
  assert.ok(completed.archive_recovered_at);
  assert.match(verifiedPath, /Requests[\\/]Failed[\\/]\d{4}-\d{2}-\d{2}[\\/]/);
  assert.equal(reconciliations.some(({ source }) => source === verifiedPath), true);
  assert.equal(uploads.length, 1);
  assert.equal(recognitionCalls.length, 0);
});

test("a different same-named Failed file is preserved for manual review", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  const failed = await processRequestScanJob(jobId, settings, dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true }));
  await retryRequestScanJob(jobId, { readSettings: async () => settings, moveFile: async () => { throw new Error("attached retry must not move to Incoming"); } });
  let recoveryMoveCalls = 0;
  const recovery = dependencies({ ok: false, reason: "no_barcode" });
  recovery.reconcileRequestScanMove = async (_settings, source) => {
    if (source.includes("Failed")) recoveryMoveCalls += 1;
    return "missing";
  };
  recovery.verifyFailedFileIdentity = async () => "mismatch";

  const reviewed = await processRequestScanJob(jobId, settings, recovery);
  assert.equal(reviewed.status, "failed");
  assert.equal(reviewed.source_relative_path, failed.source_relative_path);
  assert.equal(reviewed.source_moved_at, null);
  assert.equal(recoveryMoveCalls, 0);
  assert.equal(reviewed.error_message, "A same-named file exists in the Request Scan Failed folder, but its size or SHA-256 does not match the stored document. The file was preserved for manual review.");
});

test("RequestScanProcessingError retains its specific safe archive message", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const jobId = await createJob();
  await processRequestScanJob(jobId, settings, dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true }));
  await retryRequestScanJob(jobId, { readSettings: async () => settings, moveFile: async () => { throw new Error("attached retry must not move to Incoming"); } });
  const missing = dependencies({ ok: false, reason: "no_barcode" });
  missing.reconcileRequestScanMove = async () => "missing";
  missing.verifyFailedFileIdentity = async () => "missing";

  const result = await processRequestScanJob(jobId, settings, missing);
  assert.equal(result.status, "failed");
  assert.equal(result.error_message, "The Request Scan source and archive destination are both missing.");
  assert.equal(result.archive_last_error, result.error_message);
  assert.equal(result.failure_category, "source_missing");
});

test("a disabled-modality job retry resumes its original checkpoint and cannot create a second clinical document", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking();
  const code = `CT${suffix().slice(-6)}`;
  await pool.query("update modalities set code=$2 where id=$1", [booking.modalityId, code]);
  const jobId = await createModalityJob(booking.modalityId, code, "disabled-modality-retry.jpg");
  const uploads: Array<{ payload: unknown; userId: string | number | null }> = [];
  const failed = await processRequestScanJob(jobId, { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" }, dependencies({ ok: true, accession: booking.accession }, { failAllMoves: true, uploads }));
  assert.equal(failed.status, "failed");
  assert.equal(uploads.length, 1);
  assert.ok(failed.attachment_completed_at);
  await pool.query("update modalities set is_active=false where id=$1", [booking.modalityId]);
  assert.ok((await listRequestScanJobs("failed", undefined, "modality", booking.modalityId)).some((job) => Number(job.id) === jobId));
  await retryRequestScanJob(jobId, {
    readSettings: async () => ({ ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" }),
    moveFile: async () => { throw new Error("checkpointed retry must not move or consult active modalities"); },
  });
  const resumed = await processRequestScanJob(jobId, { ...settings, modalityDocumentsRootSubfolder: "ModalityDocuments" }, dependencies({ ok: false, reason: "no_barcode" }, { uploads }));
  assert.equal(resumed.status, "processed");
  assert.equal(uploads.length, 1);
  assert.equal((await pool.query<{ count: number }>("select count(*)::int count from documents where id=$1 and document_type='clinical_document' and source='modality_scan_automation'", [failed.document_id])).rows[0]!.count, 1);
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

test("concurrent reception Request Scan uploads create one document and remove the losing staged file", async (t) => {
  if (!(await ensureDatabase(t))) return;
  const booking = await createBooking(); const jobA = await createJob(); const jobB = await createJob();
  const keyA = `request-scan:job:${jobA}:appointment-request`; const keyB = `request-scan:job:${jobB}:appointment-request`;
  const payload = { patientId: booking.patientId, appointmentId: booking.id, appointmentRefType: "v2_booking", documentType: "appointment_request", originalFilename: "same-request.pdf", mimeType: "application/pdf", fileContentBuffer: Buffer.from("same-request"), source: "request_scan_automation" };
  const results = await Promise.all([uploadDocumentIdempotently({ ...payload, requestScanJobId: jobA }, null, keyA), uploadDocumentIdempotently({ ...payload, requestScanJobId: jobB }, null, keyB)]);
  assert.equal(new Set(results.map((result) => result.document.id)).size, 1); assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
  const rows = await pool.query<DocumentRow>("select * from documents where request_scan_job_id=any($1::bigint[])", [[jobA, jobB]]); assert.equal(rows.rowCount, 1);
  const winningPath = resolveStoredPath(rows.rows[0].stored_path); const storedNames = await fs.readdir(path.dirname(winningPath));
  assert.equal(storedNames.filter((name) => name.endsWith("-same-request.pdf")).length, 1);
  const stagingNames = await fs.readdir(path.join(path.dirname(path.dirname(winningPath)), ".rispro-document-staging")).catch(() => [] as string[]);
  assert.equal(stagingNames.filter((name) => name.endsWith("-same-request.pdf")).length, 0);
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
  __resetAuthoritativeOrthancForTests();
  if (created.users.length) await pool.query("delete from audit_log where changed_by_user_id=any($1::bigint[])", [created.users]);
  if (created.jobs.length) await pool.query("delete from audit_log where entity_type='request_scan_job' and entity_id=any($1::bigint[])", [created.jobs]);
  if (created.patients.length) await pool.query("delete from documents where patient_id=any($1::bigint[]) and source in ('request_scan_automation','modality_scan_automation')", [created.patients]);
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
