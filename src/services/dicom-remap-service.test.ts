import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import dcmjs from "dcmjs";
import {
  __dicomRemapTestables,
  assertDicomRemapRouteAccess,
  cancelDicomRemapJob,
  claimNextDicomRemapProcessingJob,
  cleanupExpiredAwaitingDicomRemapStaging,
  cleanupDicomRemapStagingStorage,
  confirmStagedDicomRemapJob,
  confirmDicomRemapAndSend,
  createDicomRemapMultipartUploadJob,
  createDicomRemapUploadJob,
  failStaleDicomRemapSendEnqueues,
  finalizeDicomRemapAwaitingConfirmationStagingJob,
  getMyActiveDicomRemapJob,
  monitorDicomRemapSendJob,
  previewDicomRemapMultipartUpload,
  resendDicomRemapJobToPacs,
  validateDicomRemapUploadFilesInput,
  validateExplicitConfirm,
  writeDicomRemapStagedFile,
  type DicomRemapJobRow,
} from "./dicom-remap-service.js";
import { HttpError } from "../utils/http-error.js";
const { datasetToBuffer, DicomMessage, DicomMetaDictionary } = dcmjs.data;

function remapJob(overrides: Partial<DicomRemapJobRow> = {}): DicomRemapJobRow {
  return {
    id: 1,
    created_by_user_id: 42,
    status: "uploaded",
    source_orthanc_study_id: "source-study-id",
    modified_orthanc_study_id: null,
    rispro_patient_id: null,
    destination_pacs_key: null,
    original_patient_id: null,
    original_patient_name: null,
    original_patient_sex: null,
    original_patient_birth_date: null,
    replacement_patient_id: null,
    replacement_patient_name: null,
    replacement_patient_sex: null,
    replacement_patient_birth_date: null,
    send_result: null,
    orthanc_send_job_id: null,
    send_attempt_count: 0,
    send_started_at: null,
    send_completed_at: null,
    send_last_checked_at: null,
    send_last_heartbeat_at: null,
    send_error_code: null,
    send_error_details: null,
    error_message: null,
    cancellation_reason: null,
    created_at: "2026-04-30T00:00:00.000Z",
    updated_at: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

function queueQueryResults(items: Array<{ rows: unknown[] } | Error>) {
  const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const query = async (sql: unknown, params?: unknown[]) => {
    calls.push({ sql: String(sql), params });
    const item = items.shift();
    if (!item) {
      throw new Error(`Unexpected query: ${String(sql)}`);
    }
    if (item instanceof Error) {
      throw item;
    }
    return item;
  };
  __dicomRemapTestables.setQueryForTests(query as never);
  return calls;
}

function orthancResult(overrides: Partial<{ status: number; ok: boolean; text: string; json: unknown }> = {}) {
  return {
    status: overrides.status ?? 200,
    ok: overrides.ok ?? true,
    text: overrides.text ?? "",
    json: overrides.json ?? {},
  };
}

function queueOrthancResults(items: Array<ReturnType<typeof orthancResult>>) {
  const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
  __dicomRemapTestables.setOrthancFetchForTests(async (path, options = {}) => {
    calls.push({ path, method: options.method, body: options.body });
    const item = items.shift();
    if (!item) {
      throw new Error(`Unexpected Orthanc request: ${path}`);
    }
    return item;
  });
  return calls;
}

function stableStudyResponses(overrides: { isStable?: boolean; lastUpdate?: string; series?: string[]; count?: number } = {}) {
  return [
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        ID: "study-id",
        IsStable: overrides.isStable ?? true,
        LastUpdate: overrides.lastUpdate ?? "20260430T120000",
        Series: overrides.series ?? ["series-1"],
      },
    }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { CountInstances: overrides.count ?? 465 } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { Version: "1.12.11", DatabaseServerIdentifier: "dbid" },
    }),
  ];
}

function makeSyntheticDicomBuffer(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(datasetToBuffer({
    _meta: {
      FileMetaInformationVersion: new Uint8Array([0, 1]),
      MediaStorageSOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
      MediaStorageSOPInstanceUID: "1.2.3.4.5.6",
      TransferSyntaxUID: "1.2.840.10008.1.2.1",
      ImplementationClassUID: "2.25.12345",
    },
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
    SOPInstanceUID: "1.2.3.4.5.6",
    StudyInstanceUID: "1.2.840.113619.2.55.3.604688433.1234.1456789012.1",
    SeriesInstanceUID: "1.2.840.113619.2.55.3.604688433.1234.1456789012.1.1",
    PatientID: "OLDID",
    PatientName: "OLD^PATIENT",
    PatientSex: "M",
    PatientBirthDate: "19900101",
    Rows: 1,
    Columns: 1,
    SamplesPerPixel: 1,
    PhotometricInterpretation: "MONOCHROME2",
    BitsAllocated: 16,
    BitsStored: 16,
    HighBit: 15,
    PixelRepresentation: 0,
    PixelData: new Uint16Array([1]),
    ...overrides,
  }));
}

async function makeStagedFiles(files: Array<{ fileName: string; content?: string; mimeType?: string }>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-test-"));
  const staged = [];
  for (const [index, file] of files.entries()) {
    const stagedPath = path.join(tempDir, `${index}.dcm`);
    const content = Buffer.from(file.content ?? "dicom");
    await writeFile(stagedPath, content);
    staged.push({
      fileName: file.fileName,
      mimeType: file.mimeType || "application/dicom",
      path: stagedPath,
      size: content.length,
    });
  }
  return { tempDir, staged };
}

function selectedStudyManifest(
  selectedStudyInstanceUID: string,
  files: Array<{ id: string; relativePath: string; displayName: string; mimeType: string; byteSize: number; sha256: string }>,
  identityOverrides: Partial<{
    patientId: string;
    patientName: string;
    patientBirthDate: string;
    patientSex: string;
    modality: string;
    studyDate: string;
  }> = {}
) {
  return {
    version: 2,
    provisionalSelectedStudyInstanceUID: selectedStudyInstanceUID,
    provisionalSourceIdentity: {
      studyInstanceUid: selectedStudyInstanceUID,
      patientId: "OLDID",
      patientName: "OLD^PATIENT",
      patientBirthDate: "19900101",
      patientSex: "M",
      modality: "CT",
      studyDate: "20260726",
      ...identityOverrides,
    },
    uploadMode: "staged_folder_selected_study" as const,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.byteSize, 0),
    files,
  };
}

test.afterEach(() => {
  __dicomRemapTestables.resetTestOverrides();
});

test("validateDicomRemapUploadFilesInput rejects empty payloads", () => {
  assert.throws(
    () => validateDicomRemapUploadFilesInput([]),
    /non-empty array/i
  );
});

test("validateDicomRemapUploadFilesInput accepts file arrays", () => {
  const files = validateDicomRemapUploadFilesInput([{ fileName: "study.dcm", fileContentBase64: "AA==" }]);
  assert.equal(files.length, 1);
});

test("validateExplicitConfirm only accepts explicit true values", () => {
  assert.equal(validateExplicitConfirm(true), true);
  assert.equal(validateExplicitConfirm("true"), true);
  assert.equal(validateExplicitConfirm("TRUE"), true);
  assert.equal(validateExplicitConfirm("false"), false);
  assert.equal(validateExplicitConfirm(undefined), false);
});

test("durable staging writes a hashed private file by generated path", async () => {
  const storageKey = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await mkdir(path.resolve("storage/dicom/remap-staging", storageKey, "files"), { recursive: true, mode: 0o700 });
  const stream = new PassThrough();
  const write = writeDicomRemapStagedFile({
    context: { job: remapJob(), storageKey, directory: path.resolve("storage/dicom/remap-staging", storageKey) },
    fileIndex: 0,
    fileName: "../../unsafe patient file.dcm",
    mimeType: "application/dicom",
    stream,
  });
  stream.end(Buffer.from("durable-dicom"));
  const staged = await write;
  try {
    assert.match(staged.relativePath, /^files\/[a-z0-9-]+\.dcm$/i);
    assert.equal(staged.displayName.includes("/"), false);
    assert.equal(staged.byteSize, 13);
    assert.match(staged.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual((await readdir(path.resolve("storage/dicom/remap-staging", storageKey, "files"))).filter((name) => name.endsWith(".part")), []);
  } finally {
    await cleanupDicomRemapStagingStorage(storageKey);
  }
});

test("fast durable staging completes without a patient or destination and confirmation queues the same job idempotently", async () => {
  const storageKey = `jobs/1-${randomUUID()}`;
  const directory = path.resolve("storage/dicom/remap-staging", storageKey);
  await mkdir(path.join(directory, "files"), { recursive: true, mode: 0o700 });
  const selectedStudyInstanceUID = "1.2.840.113619.2.55.3.604688433.1234.1456789012.1";
  const body = makeSyntheticDicomBuffer({ StudyInstanceUID: selectedStudyInstanceUID });
  const relativePath = "files/000000-fast-stage.dcm";
  await writeFile(path.join(directory, relativePath), body);
  const files = [{
    id: "000000-fast-stage",
    relativePath,
    displayName: "source.dcm",
    mimeType: "application/dicom",
    byteSize: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  }];
  const provisionalSourceIdentity = {
    studyInstanceUid: selectedStudyInstanceUID,
    patientId: "OLDID",
    patientName: "OLD^PATIENT",
    patientBirthDate: "19900101",
    patientSex: "M",
    modality: "CT",
    studyDate: "20260726",
  };
  const stagingJob = remapJob({
    status: "uploaded",
    processing_stage: "staging",
    staged_storage_key: storageKey,
    created_by_user_id: 42,
  });
  const awaitingJob = remapJob({
    ...stagingJob,
    status: "awaiting_confirmation",
    processing_stage: "awaiting_confirmation",
    staged_manifest_version: 2,
    staged_file_count: files.length,
    staged_total_bytes: body.length,
    provisional_source_identity: provisionalSourceIdentity,
  });

  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  queueQueryResults([{ rows: [awaitingJob] }]);
  try {
    const staged = await finalizeDicomRemapAwaitingConfirmationStagingJob({
      context: { job: stagingJob, storageKey, directory },
      files,
      selectedStudyInstanceUID,
      provisionalSourceIdentity,
      confirmSource: "true",
    });
    assert.equal(staged.job.id, stagingJob.id);
    assert.equal(staged.job.status, "awaiting_confirmation");
    assert.equal(staged.job.rispro_patient_id, null);
    assert.equal(staged.job.destination_pacs_key, null);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as Record<string, unknown>;
    assert.equal(manifest.version, 2);
    assert.equal(manifest.uploadMode, "staged_folder_selected_study");
    assert.equal(manifest.provisionalSelectedStudyInstanceUID, selectedStudyInstanceUID);
    assert.equal("selectedStudyInstanceUID" in manifest, false);

    __dicomRemapTestables.setPatientLoaderForTests(async () => ({
      id: 77,
      mrn: "RIS-77",
      national_id: null,
      identifier_type: "other",
      identifier_value: "RIS-77",
      category: null,
      arabic_full_name: "Replacement Patient",
      english_full_name: "Replacement Patient",
      age_years: 35,
      demographics_estimated: false,
      sex: "F",
      phone_1: null,
      phone_2: null,
      address: null,
      estimated_date_of_birth: "1991-01-02",
    }));
    __dicomRemapTestables.setModalityListerForTests(async () => ({
      modalities: [{ key: "MAIN", aet: "MAIN", host: "127.0.0.1", port: 104, isDefault: true }],
    }));
    const queuedJob = remapJob({
      ...awaitingJob,
      status: "uploaded",
      processing_stage: "queued",
      selected_study_instance_uid: selectedStudyInstanceUID,
      rispro_patient_id: 77,
      destination_pacs_key: "MAIN",
      replacement_patient_id: "RIS-77",
      replacement_patient_name: "Replacement^Patient",
    });
    const confirmationCalls = queueQueryResults([{ rows: [awaitingJob] }, { rows: [queuedJob] }]);
    const confirmed = await confirmStagedDicomRemapJob({
      jobId: stagingJob.id,
      selectedStudyInstanceUID,
      risproPatientId: 77,
      destinationPacsKey: "MAIN",
      confirm: true,
      currentUserId: 42,
    });
    assert.equal(confirmed.job.id, stagingJob.id);
    assert.equal(confirmed.job.status, "uploaded");
    assert.equal(confirmed.job.processing_stage, "queued");
    assert.match(confirmationCalls[1]!.sql, /status = 'awaiting_confirmation'/i);
    assert.match(confirmationCalls[1]!.sql, /processing_stage = 'awaiting_confirmation'/i);

    const duplicateCalls = queueQueryResults([{ rows: [queuedJob] }]);
    const duplicate = await confirmStagedDicomRemapJob({
      jobId: stagingJob.id,
      selectedStudyInstanceUID,
      risproPatientId: 77,
      destinationPacsKey: "MAIN",
      confirm: true,
      currentUserId: 42,
    });
    assert.equal(duplicate.job.id, stagingJob.id);
    assert.equal(duplicateCalls.length, 1);

    const cancelledAfterConfirmation = remapJob({
      ...queuedJob,
      status: "cancelled",
      processing_stage: "cancelled",
      cancellation_reason: "Operator reset before final confirmation.",
    });
    queueQueryResults([{ rows: [cancelledAfterConfirmation] }]);
    await assert.rejects(
      () => confirmStagedDicomRemapJob({
        jobId: stagingJob.id,
        selectedStudyInstanceUID,
        risproPatientId: 77,
        destinationPacsKey: "MAIN",
        confirm: true,
        currentUserId: 42,
      }),
      (error) => {
        assert.equal(error instanceof HttpError ? error.statusCode : null, 409);
        assert.equal(error instanceof HttpError ? (error.details as { status?: string } | null)?.status : null, "cancelled");
        return true;
      },
    );
  } finally {
    await cleanupDicomRemapStagingStorage(storageKey);
  }
});

test("processing claim uses a skip-locked lease claim", async () => {
  const claimed = remapJob({ status: "processing", processing_attempt_count: 1, processing_lease_owner: "worker-a" });
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  const calls = queueQueryResults([{ rows: [{ ...claimed, recovered: false, previous_status: "uploaded" }] }]);
  const result = await claimNextDicomRemapProcessingJob("worker-a", 120);
  assert.equal(result?.job.id, claimed.id);
  assert.equal(result?.recovered, false);
  assert.match(calls[0]!.sql, /for update skip locked/i);
  assert.match(calls[0]!.sql, /processing_lease_owner/i);
  assert.doesNotMatch(calls[0]!.sql, /status\s*=\s*'awaiting_confirmation'/i);
});

test("expired awaiting-confirmation staging is cancelled before staged PHI is removed", async () => {
  const storageKey = `jobs/902-${randomUUID()}`;
  const directory = path.resolve("storage/dicom/remap-staging", storageKey);
  await mkdir(path.join(directory, "files"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, "files", "staged.dcm"), Buffer.from("private-phi"));
  const awaiting = remapJob({
    id: 902,
    status: "awaiting_confirmation",
    processing_stage: "awaiting_confirmation",
    staged_storage_key: storageKey,
    staging_cleanup_completed_at: null,
  });
  const cancelled = remapJob({
    ...awaiting,
    status: "cancelled",
    processing_stage: "cancelled",
    cancellation_reason: "AWAITING_CONFIRMATION_EXPIRED",
  });
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  const calls = queueQueryResults([
    { rows: [awaiting] },
    { rows: [cancelled] },
    { rows: [{ ...cancelled, staging_cleanup_completed_at: "2026-07-26T00:00:00.000Z" }] },
  ]);

  const cleaned = await cleanupExpiredAwaitingDicomRemapStaging(24);
  assert.equal(cleaned, 1);
  assert.match(calls[0]!.sql, /status = 'awaiting_confirmation'/i);
  assert.match(calls[1]!.sql, /cancellation_reason = 'AWAITING_CONFIRMATION_EXPIRED'/i);
  assert.match(calls[2]!.sql, /staging_cleanup_completed_at = now\(\)/i);
  await assert.rejects(() => readFile(path.join(directory, "files", "staged.dcm")));
});

test("retention cleanup retries staged PHI removal after an operator-cancel cleanup failure", async () => {
  const storageKey = `jobs/903-${randomUUID()}`;
  const directory = path.resolve("storage/dicom/remap-staging", storageKey);
  await mkdir(path.join(directory, "files"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, "files", "staged.dcm"), Buffer.from("private-phi"));
  const cancelled = remapJob({
    id: 903,
    status: "cancelled",
    processing_stage: "cancelled",
    staged_storage_key: storageKey,
    staging_cleanup_completed_at: null,
    cancellation_reason: "Operator reset before final confirmation.",
  });
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  const calls = queueQueryResults([
    { rows: [cancelled] },
    { rows: [{ ...cancelled, staging_cleanup_completed_at: "2026-07-26T00:00:00.000Z" }] },
  ]);

  const cleaned = await cleanupExpiredAwaitingDicomRemapStaging(24);
  assert.equal(cleaned, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.sql, /or status = 'cancelled'/i);
  assert.match(calls[1]!.sql, /status = 'cancelled'/i);
  await assert.rejects(() => readFile(path.join(directory, "files", "staged.dcm")));
});

test("persisted remap upload rejects a conflicting duplicate instance safely", async () => {
  queueOrthancResults([orthancResult({ status: 409, ok: false, json: { OrthancStatus: 17, Message: "different content" } })]);
  await assert.rejects(
    () => __dicomRemapTestables.uploadPersistedRemappedInstance(Buffer.from("conflicting"), 1),
    (error: unknown) => (error as { details?: { code?: string } }).details?.code === "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT"
  );
});

test("assertDicomRemapRouteAccess enforces authenticated user id", async () => {
  await assert.rejects(
    () => assertDicomRemapRouteAccess(null),
    /currentUserId/i
  );

  const userId = await assertDicomRemapRouteAccess(42);
  assert.equal(userId, 42);
});

test("dicom helper: DICOM file checks are strict but predictable", () => {
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.dcm", "application/octet-stream"), true);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.bin", "application/dicom"), true);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.ima", "application/octet-stream"), true);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.bin", "application/octet-stream"), true);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.jpg", "image/jpeg"), false);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("notes.txt", "text/plain"), false);
  assert.equal(__dicomRemapTestables.isSkippableDicomRemapFolderEntry("DICOMDIR"), true);
  assert.equal(__dicomRemapTestables.isSkippableDicomRemapFolderEntry("MEDIAVIE.PRO"), true);
  assert.equal(__dicomRemapTestables.isSkippableDicomRemapFolderEntry("CDVIEWER.JAR"), true);
  assert.equal(__dicomRemapTestables.isSkippableDicomRemapFolderEntry("image.dcm"), false);
});

test("asynchronous Orthanc C-STORE uses the documented payload and requires a job ID", async () => {
  const calls = queueOrthancResults([
    orthancResult({ status: 202, ok: true, text: "{\"ID\":\"orthanc-send-1\"}", json: { ID: "orthanc-send-1" } }),
  ]);
  const result = await __dicomRemapTestables.enqueueOrthancAsyncStore("study-1", "PACS_MAIN");
  assert.equal(result.orthancJobId, "orthanc-send-1");
  assert.deepEqual(calls[0], {
    path: "/modalities/PACS_MAIN/store",
    method: "POST",
    body: { Resources: ["study-1"], Synchronous: false },
  });

  queueOrthancResults([orthancResult({ status: 202, ok: true, text: "{}", json: {} })]);
  await assert.rejects(
    () => __dicomRemapTestables.enqueueOrthancAsyncStore("study-1", "PACS_MAIN"),
    /did not return a resolvable job ID/i
  );
});

test("Orthanc asynchronous job ID parser accepts documented response variants", () => {
  assert.equal(__dicomRemapTestables.parseOrthancSendJobId({ ID: "one" }), "one");
  assert.equal(__dicomRemapTestables.parseOrthancSendJobId({ result: { id: "two" } }), "two");
  assert.equal(__dicomRemapTestables.parseOrthancSendJobId({ Path: "/jobs/three" }), "three");
});

test("ambiguous asynchronous enqueue remains sending and does not expose ordinary resend", async () => {
  const job = remapJob({ status: "remapped", destination_pacs_key: "PACS_MAIN", modified_orthanc_study_id: "study-1" });
  const ambiguous = remapJob({ ...job, status: "sending", send_error_code: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS", error_message: "RISpro could not confirm whether Orthanc accepted the PACS transfer." });
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  const calls = queueQueryResults([{ rows: [job] }, { rows: [ambiguous] }]);
  __dicomRemapTestables.setOrthancFetchForTests(async (path) => {
    if (path.includes("/studies/")) return orthancResult({ json: { ID: "study-1" } });
    throw new HttpError(504, "Orthanc request timed out after 60000ms.");
  });
  const result = await __dicomRemapTestables.sendExistingDicomRemapJobToDestination({ job, currentUserId: 42, auditActionType: "pacs_send_enqueued" });
  assert.equal(result.job.status, "sending");
  assert.equal(result.job.orthanc_send_job_id, null);
  assert.equal(result.job.send_error_code, "ORTHANC_SEND_ENQUEUE_AMBIGUOUS");
  assert.equal(__dicomRemapTestables.isDestinationVerificationRequired(result.job.send_error_code), true);
  assert.match(calls[1]!.sql, /set status = 'sending'/i);
});

test("ambiguous failed resend requires explicit destination verification and audits confirmation", async () => {
  const ambiguous = remapJob({ id: 44, status: "failed", destination_pacs_key: "PACS_MAIN", modified_orthanc_study_id: "study-44", send_error_code: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS" });
  queueQueryResults([{ rows: [ambiguous] }]);
  await assert.rejects(() => resendDicomRemapJobToPacs({ jobId: 44, currentUserId: 42 }), /Check the destination PACS/i);

  const auditEntries: Array<Record<string, unknown>> = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => { auditEntries.push(entry as unknown as Record<string, unknown>); return {} as never; });
  const sending = remapJob({ ...ambiguous, status: "sending" });
  const accepted = remapJob({ ...sending, orthanc_send_job_id: "orthanc-44", send_attempt_count: 1, send_error_code: null });
  queueQueryResults([{ rows: [ambiguous] }, { rows: [sending] }, { rows: [accepted] }]);
  queueOrthancResults([
    orthancResult({ json: { ID: "study-44" } }),
    orthancResult({ status: 202, ok: true, json: { ID: "orthanc-44" } }),
  ]);
  const result = await resendDicomRemapJobToPacs({ jobId: 44, currentUserId: 42, confirmDestinationChecked: true });
  assert.equal(result.job.status, "sending");
  assert.equal((auditEntries.find((entry) => entry.actionType === "pacs_resend_enqueued")?.newValues as { confirmDestinationChecked?: boolean }).confirmDestinationChecked, true);
});

test("monitor transport and Orthanc errors remain sending with specific diagnostics", async () => {
  const job = remapJob({ status: "sending", orthanc_send_job_id: "monitor-1", destination_pacs_key: "PACS_MAIN" });
  const timeoutCalls = queueQueryResults([{ rows: [] }]);
  __dicomRemapTestables.setOrthancFetchForTests(async () => { throw new HttpError(504, "Orthanc request timed out"); });
  assert.equal(await monitorDicomRemapSendJob(job), null);
  assert.match(String(timeoutCalls[0]!.params?.[1]), /ORTHANC_SEND_MONITOR_TIMEOUT/);
  assert.match(timeoutCalls[0]!.sql, /orthanc_send_job_id = \$6/i);

  const authCalls = queueQueryResults([{ rows: [] }]);
  queueOrthancResults([orthancResult({ status: 401, ok: false, json: { HttpStatus: 401 } })]);
  assert.equal(await monitorDicomRemapSendJob(job), null);
  assert.equal(authCalls[0]!.params?.[1], "ORTHANC_SEND_MONITOR_AUTH_FAILED");
});

test("monitor marks unknown job state without heartbeat and keeps recognized running state live", async () => {
  const job = remapJob({ status: "sending", orthanc_send_job_id: "monitor-2", destination_pacs_key: "PACS_MAIN" });
  const unknownCalls = queueQueryResults([{ rows: [] }]);
  queueOrthancResults([orthancResult({ json: { ID: "monitor-2", State: "MysteryState", Type: "DicomModalityStore" } })]);
  assert.equal(await monitorDicomRemapSendJob(job), null);
  assert.equal(unknownCalls[0]!.params?.[1], "ORTHANC_SEND_STATE_UNKNOWN");
  assert.equal(unknownCalls[0]!.params?.[4], false);

  const runningCalls = queueQueryResults([{ rows: [] }]);
  queueOrthancResults([orthancResult({ json: { ID: "monitor-2", State: "Running", Type: "DicomModalityStore" } })]);
  assert.equal(await monitorDicomRemapSendJob(job), null);
  assert.equal(runningCalls[0]!.params?.[1], "ORTHANC_SEND_ACTIVE");
  assert.equal(runningCalls[0]!.params?.[4], true);
});

test("send monitor keeps running jobs in sending and completes only after Orthanc success", async () => {
  const runningJob = remapJob({ status: "sending", orthanc_send_job_id: "job-running", send_attempt_count: 1, destination_pacs_key: "PACS_MAIN" });
  const runningCalls = queueQueryResults([{ rows: [] }]);
  queueOrthancResults([orthancResult({ json: { ID: "job-running", State: "Running", Type: "DicomModalityStore" } })]);
  assert.equal(await monitorDicomRemapSendJob(runningJob), null);
  assert.match(runningCalls[0]!.sql, /send_last_heartbeat_at/i);
  assert.doesNotMatch(runningCalls[0]!.sql, /status = 'sent'/i);

  const auditEntries: Array<Record<string, unknown>> = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => { auditEntries.push(entry as unknown as Record<string, unknown>); return {} as never; });
  const sentJob = remapJob({ ...runningJob, status: "sent", send_completed_at: "2026-07-11T00:00:00.000Z" });
  queueQueryResults([{ rows: [sentJob] }]);
  queueOrthancResults([orthancResult({ json: { ID: "job-running", State: "Success", Type: "DicomModalityStore" } })]);
  const result = await monitorDicomRemapSendJob(runningJob);
  assert.equal(result?.status, "sent");
  assert.equal(auditEntries.some((entry) => entry.actionType === "pacs_send_completed"), true);
});

test("send monitor sanitizes failure classification and missing Orthanc jobs safely", async () => {
  const job = remapJob({ status: "sending", orthanc_send_job_id: "job-failed", send_attempt_count: 2, destination_pacs_key: "PACS_MAIN" });
  const failed = remapJob({ ...job, status: "failed", send_error_code: "PACS_DIMSE_REJECTED" });
  queueQueryResults([{ rows: [failed] }]);
  queueOrthancResults([orthancResult({ json: { State: "Failure", Type: "DicomModalityStore", DIMSEStatus: "0xA700", ErrorDescription: "association rejected" } })]);
  const result = await monitorDicomRemapSendJob(job);
  assert.equal(result?.status, "failed");
  assert.equal(result?.send_error_code, "PACS_DIMSE_REJECTED");

  const missing = remapJob({ ...job, status: "failed", send_error_code: "ORTHANC_SEND_JOB_NOT_FOUND" });
  queueQueryResults([{ rows: [missing] }]);
  queueOrthancResults([orthancResult({ status: 404, ok: false, json: { HttpStatus: 404 } })]);
  assert.equal((await monitorDicomRemapSendJob(job))?.send_error_code, "ORTHANC_SEND_JOB_NOT_FOUND");
});

test("stale sending rows without an Orthanc job ID become recoverable failed rows", async () => {
  const stale = remapJob({ status: "failed", orthanc_send_job_id: null, send_error_code: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS" });
  queueQueryResults([{ rows: [stale] }]);
  assert.equal(await failStaleDicomRemapSendEnqueues(10), 1);
});

test("dicom helper: Orthanc invalid-DICOM upload rejection detection is narrow", () => {
  assert.equal(__dicomRemapTestables.isOrthancInvalidDicomUploadRejection(
    orthancResult({
      status: 400,
      ok: false,
      text: "Bad file format",
      json: { OrthancStatus: 15 },
    })
  ), true);
  assert.equal(__dicomRemapTestables.isOrthancInvalidDicomUploadRejection(
    orthancResult({
      status: 400,
      ok: false,
      text: "Cannot parse an invalid DICOM file",
      json: { Message: "Cannot parse an invalid DICOM file" },
    })
  ), true);
  assert.equal(__dicomRemapTestables.isOrthancInvalidDicomUploadRejection(
    orthancResult({
      status: 500,
      ok: false,
      text: "Bad file format",
      json: { OrthancStatus: 15 },
    })
  ), false);
  assert.equal(__dicomRemapTestables.isOrthancInvalidDicomUploadRejection(
    orthancResult({
      status: 401,
      ok: false,
      text: "Unauthorized",
      json: { HttpError: "Unauthorized" },
    })
  ), false);
});

test("dicom helper: upload failure message uses a generated label and omits raw Orthanc response", () => {
  const message = __dicomRemapTestables.formatOrthancUploadFailureMessage(
    "bad.dcm",
    7,
    orthancResult({
      status: 400,
      ok: false,
      text: "Task failed: invalid string length Authorization: Basic secret-token",
      json: { HttpError: "Bad Request", Message: "Task failed: invalid string length" },
    })
  );

  assert.doesNotMatch(message, /bad\.dcm/);
  assert.match(message, /File 7/);
  assert.match(message, /status=400/);
  assert.doesNotMatch(message, /invalid string length/);
  assert.doesNotMatch(message, /secret-token/);
});

test("dicom helper: patient sex and birth date normalization", () => {
  assert.equal(__dicomRemapTestables.normalizePatientSex("female"), "F");
  assert.equal(__dicomRemapTestables.normalizePatientSex("M"), "M");
  assert.equal(__dicomRemapTestables.normalizePatientSex(""), "");

  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("1990-04-05"), "19900405");
  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("19900405"), "19900405");
  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("05-04-1990"), "");
});

test("dicom helper: replacement identity validation passes normal values", () => {
  const validated = __dicomRemapTestables.validateOrthancReplacementIdentity({
    patientId: "  RISPRO-123  ",
    patientName: "Jane Doe",
    patientSex: "female",
    patientBirthDate: "1990-01-02",
  });

  assert.equal(validated.patientId, "RISPRO-123");
  assert.equal(validated.patientName, "Jane^Doe");
  assert.equal(validated.patientSex, "F");
  assert.equal(validated.patientBirthDate, "19900102");
});

test("dicom helper: replacement identity rejects long PatientID", () => {
  const tooLong = "A".repeat(65);
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientIdForReplace(tooLong),
    /PatientID is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects PatientID by byte length", () => {
  const tooLong = "م".repeat(33);
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientIdForReplace(tooLong),
    /PatientID is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects long PatientName component group", () => {
  const tooLongGroup = "B".repeat(65);
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace(`${tooLongGroup}=OK`),
    /PatientName is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects PatientName group by byte length", () => {
  const tooLongGroup = "م".repeat(33);
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace(`${tooLongGroup}=OK`),
    /PatientName is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects PatientName total byte length", () => {
  const eachGroupFitsButTotalDoesNot = `${"A".repeat(40)}=${"B".repeat(25)}`;
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace(eachGroupFitsButTotalDoesNot),
    /PatientName is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects control characters consistently", () => {
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientIdForReplace("RISPRO-\u0007-123"),
    /control characters/i
  );
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace("Jane\u0000 Doe"),
    /control characters/i
  );
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace("Jane\nDoe"),
    /control characters/i
  );
});

test("dicom helper: rewriteDicomFileForRemap preserves study identity and replaces patient identity", async () => {
  const stagedFiles = await makeStagedFiles([
    {
      fileName: "image-1.dcm",
      content: makeSyntheticDicomBuffer().toString("binary"),
      mimeType: "application/dicom",
    },
  ]);

  await writeFile(stagedFiles.staged[0].path, makeSyntheticDicomBuffer());

  const rewritten = await __dicomRemapTestables.rewriteDicomFileForRemap(stagedFiles.staged[0], {
    patientId: "NEWID",
    patientName: "NEW^PATIENT",
    patientSex: "F",
    patientBirthDate: "20000101",
  }, {
    studyInstanceUid: "2.25.999001",
    seriesInstanceUidByOriginal: new Map(),
  });

  assert.equal(rewritten.originalSummary.studyInstanceUid, "1.2.840.113619.2.55.3.604688433.1234.1456789012.1");
  assert.equal(rewritten.originalSummary.patientId, "OLDID");
  assert.equal(rewritten.originalSummary.patientName, "OLD^PATIENT");

  const dicom = DicomMessage.readFile(rewritten.body.buffer.slice(rewritten.body.byteOffset, rewritten.body.byteOffset + rewritten.body.byteLength));
  const dataset = DicomMetaDictionary.naturalizeDataset(dicom.dict) as Record<string, unknown>;
  const summary = __dicomRemapTestables.readNaturalizedStudySummary(dataset);
  assert.equal(summary.studyInstanceUid, "2.25.999001");
  assert.notEqual(String(dataset.SeriesInstanceUID || "").trim(), "1.2.840.113619.2.55.3.604688433.1234.1456789012.1.1");
  assert.notEqual(String(dataset.SOPInstanceUID || "").trim(), "1.2.3.4.5.6");
  assert.equal(summary.patientId, "NEWID");
  assert.equal(summary.patientName, "NEW^PATIENT");
  assert.equal(summary.patientSex, "F");
  assert.equal(summary.patientBirthDate, "20000101");
});

test("dicom preview: parses bounded headers without Orthanc upload, rewrite, or send", async () => {
  let orthancCalled = false;
  __dicomRemapTestables.setOrthancFetchForTests(async () => {
    orthancCalled = true;
    throw new Error("preview must not call Orthanc");
  });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-preview-test-"));
  const stagedPath = path.join(tempDir, "preview.dcm");
  const body = makeSyntheticDicomBuffer({
    StudyDescription: "Preview Study",
    StudyDate: "20260505",
    Modality: "CT",
  });
  await writeFile(stagedPath, body.subarray(0, __dicomRemapTestables.DICOM_REMAP_PREVIEW_HEADER_BYTES));

  const result = await previewDicomRemapMultipartUpload({
    tempDir,
    files: [{
      previewIndex: 0,
      fileName: "preview.dcm",
      originalFileName: "preview.dcm",
      originalFilePath: "CD/STUDY/preview.dcm",
      originalFileSize: body.length,
      mimeType: "application/dicom",
      path: stagedPath,
      size: Math.min(body.length, __dicomRemapTestables.DICOM_REMAP_PREVIEW_HEADER_BYTES),
    }],
  });

  assert.equal(orthancCalled, false);
  assert.equal(result.previewOnly, true);
  assert.equal(result.studies.length, 1);
  assert.equal(result.studies[0]?.studyInstanceUid, "1.2.840.113619.2.55.3.604688433.1234.1456789012.1");
  assert.equal(result.studies[0]?.patientId, "OLDID");
  assert.equal(result.studies[0]?.patientName, "OLD^PATIENT");
  assert.equal(result.studies[0]?.studyDescription, "Preview Study");
});

test("unverified single-study folder validation scans every staged DICOM before rejecting a mixed study", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-plan-"));
  await mkdir(path.join(directory, "files"));
  const files = [
    { id: "valid-file-one", relativePath: "files/one.dcm", displayName: "one.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "a".repeat(64) },
    { id: "valid-file-two", relativePath: "files/two.dcm", displayName: "two.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "b".repeat(64) },
  ];
  await writeFile(path.join(directory, files[0]!.relativePath), makeSyntheticDicomBuffer());
  await writeFile(path.join(directory, files[1]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: "2.25.200" }));

  await assert.rejects(
    () => __dicomRemapTestables.readOrBuildDicomRemapUidPlan({
      directory,
      manifest: { version: 1, selectedStudyInstanceUID: "1.2.840.113619.2.55.3.604688433.1234.1456789012.1", uploadMode: "single_study_folder_unverified", fileCount: 2, totalBytes: 2, files },
    }),
    (error) => {
      assert.equal(error instanceof HttpError ? (error.details as { code?: string } | null)?.code : null, "DICOM_REMAP_MULTIPLE_STUDIES_DETECTED");
      assert.deepEqual(error instanceof HttpError ? error.details : null, { code: "DICOM_REMAP_MULTIPLE_STUDIES_DETECTED", parsedDicomFileCount: 2, uniqueStudyCount: 2 });
      return true;
    },
  );
  assert.equal((await readdir(directory)).includes("uid-plan.json"), false);
});

test("unverified single-study folder validation accepts one matching staged study", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-plan-"));
  await mkdir(path.join(directory, "files"));
  const uid = "1.2.840.113619.2.55.3.604688433.1234.1456789012.1";
  const files = [{ id: "valid-file-one", relativePath: "files/one.dcm", displayName: "one.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "a".repeat(64) }];
  await writeFile(path.join(directory, files[0]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: uid }));

  const result = await __dicomRemapTestables.readOrBuildDicomRemapUidPlan({
    directory,
    manifest: { version: 1, selectedStudyInstanceUID: uid, uploadMode: "single_study_folder_unverified", fileCount: 1, totalBytes: 1, files },
  });
  assert.equal(result.validFiles.length, 1);
  assert.equal(result.originalSummary.studyInstanceUid, uid);
});

test("fast staged-folder validation isolates the selected study and ignores identity differences in excluded studies", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-selected-plan-"));
  await mkdir(path.join(directory, "files"));
  const selectedUid = "1.2.840.113619.2.55.3.604688433.1234.1456789012.1";
  const otherUid = "2.25.200";
  const files = [
    { id: "selected-file-one", relativePath: "files/selected.dcm", displayName: "selected.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "a".repeat(64) },
    { id: "excluded-file-one", relativePath: "files/excluded-one.dcm", displayName: "excluded-one.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "b".repeat(64) },
    { id: "excluded-file-two", relativePath: "files/excluded-two.dcm", displayName: "excluded-two.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "c".repeat(64) },
    { id: "unparsed-file-one", relativePath: "files/unparsed.dcm", displayName: "unparsed.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "d".repeat(64) },
  ];
  await writeFile(path.join(directory, files[0]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: selectedUid }));
  await writeFile(path.join(directory, files[1]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: otherUid, PatientID: "OTHER-A", PatientName: "Other^One" }));
  await writeFile(path.join(directory, files[2]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: otherUid, PatientID: "OTHER-B", PatientName: "Other^Two" }));
  await writeFile(path.join(directory, files[3]!.relativePath), Buffer.from("not-a-dicom"));

  const result = await __dicomRemapTestables.readOrBuildDicomRemapUidPlan({
    directory,
    manifest: selectedStudyManifest(selectedUid, files),
    selectedStudyInstanceUID: selectedUid,
  });
  assert.deepEqual(result.validFiles.map((file) => file.id), ["selected-file-one"]);
  assert.deepEqual(Object.keys(result.plan.sopInstanceUidByFileId), ["selected-file-one"]);
  assert.deepEqual(result.selectionCounts, {
    totalStagedFiles: 4,
    validDicomFiles: 3,
    selectedStudyFiles: 1,
    excludedOtherStudyFiles: 2,
    excludedStudyCount: 1,
    skippedOrUnparsedFiles: 1,
  });
});

test("fast staged-folder validation fails safely when the confirmed study is absent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-selected-plan-"));
  await mkdir(path.join(directory, "files"));
  const selectedUid = "2.25.999";
  const files = [
    { id: "other-study-file", relativePath: "files/other.dcm", displayName: "other.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "a".repeat(64) },
  ];
  await writeFile(path.join(directory, files[0]!.relativePath), makeSyntheticDicomBuffer());

  await assert.rejects(
    () => __dicomRemapTestables.readOrBuildDicomRemapUidPlan({
      directory,
      manifest: selectedStudyManifest(selectedUid, files),
      selectedStudyInstanceUID: selectedUid,
    }),
    (error) => {
      assert.equal(error instanceof HttpError ? (error.details as { code?: string } | null)?.code : null, "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND");
      return true;
    },
  );
  assert.equal((await readdir(directory)).includes("uid-plan.json"), false);
});

test("fast staged-folder validation checks identity consistency only within the selected study", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-selected-plan-"));
  await mkdir(path.join(directory, "files"));
  const selectedUid = "1.2.840.113619.2.55.3.604688433.1234.1456789012.1";
  const files = [
    { id: "selected-identity-one", relativePath: "files/one.dcm", displayName: "one.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "a".repeat(64) },
    { id: "selected-identity-two", relativePath: "files/two.dcm", displayName: "two.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "b".repeat(64) },
  ];
  await writeFile(path.join(directory, files[0]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: selectedUid, PatientID: "SOURCE-A" }));
  await writeFile(path.join(directory, files[1]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: selectedUid, PatientID: "SOURCE-B" }));

  await assert.rejects(
    () => __dicomRemapTestables.readOrBuildDicomRemapUidPlan({
      directory,
      manifest: selectedStudyManifest(selectedUid, files),
      selectedStudyInstanceUID: selectedUid,
    }),
    (error) => {
      assert.equal(error instanceof HttpError ? (error.details as { code?: string } | null)?.code : null, "DICOM_REMAP_SOURCE_IDENTITY_INCONSISTENT");
      assert.equal(error instanceof HttpError ? (error.details as { selectedStudyFiles?: number } | null)?.selectedStudyFiles : null, 2);
      return true;
    },
  );
  assert.equal((await readdir(directory)).includes("uid-plan.json"), false);
});

test("fast staged-folder validation stops when authoritative selected-study identity differs from the preliminary card", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-selected-plan-"));
  await mkdir(path.join(directory, "files"));
  const selectedUid = "1.2.840.113619.2.55.3.604688433.1234.1456789012.1";
  const files = [
    { id: "selected-mismatch-one", relativePath: "files/one.dcm", displayName: "one.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "a".repeat(64) },
  ];
  await writeFile(path.join(directory, files[0]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: selectedUid, PatientID: "AUTHORITATIVE" }));

  await assert.rejects(
    () => __dicomRemapTestables.readOrBuildDicomRemapUidPlan({
      directory,
      manifest: selectedStudyManifest(selectedUid, files, { patientId: "PROVISIONAL" }),
      selectedStudyInstanceUID: selectedUid,
    }),
    (error) => {
      assert.equal(error instanceof HttpError ? (error.details as { code?: string } | null)?.code : null, "DICOM_REMAP_SOURCE_IDENTITY_MISMATCH");
      assert.equal(error instanceof HttpError ? (error.details as { mismatchFieldCount?: number } | null)?.mismatchFieldCount : null, 1);
      return true;
    },
  );
  assert.equal((await readdir(directory)).includes("uid-plan.json"), false);
});

test("staged DICOM validation rejects conflicting source identity with sanitized counts before UID planning", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-plan-"));
  await mkdir(path.join(directory, "files"));
  const uid = "1.2.840.113619.2.55.3.604688433.1234.1456789012.1";
  const files = [
    { id: "identity-file-one", relativePath: "files/one.dcm", displayName: "one.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "a".repeat(64) },
    { id: "identity-file-two", relativePath: "files/two.dcm", displayName: "two.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "b".repeat(64) },
  ];
  await writeFile(path.join(directory, files[0]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: uid, PatientID: "SOURCE-A", PatientName: "Source^Patient", PatientBirthDate: "19900101", PatientSex: "M" }));
  await writeFile(path.join(directory, files[1]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: uid, PatientID: "SOURCE-B", PatientName: "source^patient", PatientBirthDate: "19900101", PatientSex: "M" }));

  await assert.rejects(
    () => __dicomRemapTestables.readOrBuildDicomRemapUidPlan({
      directory,
      manifest: { version: 1, selectedStudyInstanceUID: uid, uploadMode: "single_study_folder_unverified", fileCount: 2, totalBytes: 2, files },
    }),
    (error) => {
      assert.equal(error instanceof HttpError ? (error.details as { code?: string } | null)?.code : null, "DICOM_REMAP_SOURCE_IDENTITY_INCONSISTENT");
      assert.deepEqual(error instanceof HttpError ? error.details : null, {
        code: "DICOM_REMAP_SOURCE_IDENTITY_INCONSISTENT",
        parsedDicomFileCount: 2,
        uniquePatientIdCount: 2,
        uniquePatientNameCount: 1,
        uniqueBirthDateCount: 1,
        uniqueSexCount: 1,
        totalStagedFiles: 2,
        validDicomFiles: 2,
        selectedStudyFiles: 2,
        excludedOtherStudyFiles: 0,
        excludedStudyCount: 0,
        skippedOrUnparsedFiles: 0,
      });
      return true;
    },
  );
  assert.equal((await readdir(directory)).includes("uid-plan.json"), false);
});

test("staged DICOM validation accepts empty identities and trivial name formatting variation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-plan-"));
  await mkdir(path.join(directory, "files"));
  const uid = "1.2.840.113619.2.55.3.604688433.1234.1456789012.1";
  const files = [
    { id: "consistent-file-one", relativePath: "files/one.dcm", displayName: "one.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "a".repeat(64) },
    { id: "consistent-file-two", relativePath: "files/two.dcm", displayName: "two.dcm", mimeType: "application/dicom", byteSize: 1, sha256: "b".repeat(64) },
  ];
  await writeFile(path.join(directory, files[0]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: uid, PatientID: "SOURCE", PatientName: "Source^Patient", PatientBirthDate: "", PatientSex: "" }));
  await writeFile(path.join(directory, files[1]!.relativePath), makeSyntheticDicomBuffer({ StudyInstanceUID: uid, PatientID: "SOURCE", PatientName: " source^patient ", PatientBirthDate: "", PatientSex: "" }));
  const result = await __dicomRemapTestables.readOrBuildDicomRemapUidPlan({
    directory,
    manifest: { version: 1, selectedStudyInstanceUID: uid, uploadMode: "single_study_folder_unverified", fileCount: 2, totalBytes: 2, files },
  });
  assert.equal(result.validFiles.length, 2);
});

test("dicom helper: Orthanc resource id parser supports common response shapes", () => {
  assert.equal(__dicomRemapTestables.parseOrthancResourceId({ ParentStudy: "abc-study" }), "abc-study");
  assert.equal(__dicomRemapTestables.parseOrthancResourceId({ ID: "new-id" }), "new-id");
  assert.equal(__dicomRemapTestables.parseOrthancResourceId({}), "");
});

test("dicom helper: Orthanc upload parser prefers explicit ParentStudy", async () => {
  const uploadResponse = {
    status: 200,
    ok: true,
    text: "",
    json: {
      ID: "instance-id",
      ParentStudy: "study-id",
      Path: "/instances/instance-id",
    },
  };

  const parsed = __dicomRemapTestables.parseOrthancUploadResponse(uploadResponse.json);
  assert.deepEqual(parsed.parentStudyIds, ["study-id"]);
  assert.deepEqual(parsed.instanceIds, ["instance-id"]);

  const resolved = await __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
    uploadResponse,
    async () => {
      throw new Error("instance lookup should not be used when ParentStudy is present");
    }
  );
  assert.equal(resolved, "study-id");
});

test("dicom helper: Orthanc upload resolver treats ID-only response as instance ID", async () => {
  const seenInstanceIds: string[] = [];

  const resolved = await __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
    {
      status: 200,
      ok: true,
      text: "",
      json: { ID: "instance-only-id" },
    },
    async (instanceId) => {
      seenInstanceIds.push(instanceId);
      return "resolved-study-id";
    }
  );

  assert.equal(resolved, "resolved-study-id");
  assert.deepEqual(seenInstanceIds, ["instance-only-id"]);
});

test("dicom helper: Orthanc upload resolver extracts instance ID from Path", async () => {
  const seenInstanceIds: string[] = [];

  const resolved = await __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
    {
      status: 200,
      ok: true,
      text: "",
      json: { Path: "/instances/path-instance-id" },
    },
    async (instanceId) => {
      seenInstanceIds.push(instanceId);
      return "path-study-id";
    }
  );

  assert.equal(resolved, "path-study-id");
  assert.deepEqual(seenInstanceIds, ["path-instance-id"]);
});

test("dicom helper: Orthanc upload parser handles array and nested shapes", async () => {
  const uploadResponse = {
    status: 200,
    ok: true,
    text: "",
    json: [
      {
        Status: "Success",
        Instance: {
          ID: "nested-instance-id",
          Path: "/instances/nested-instance-id",
        },
      },
      {
        Result: {
          ParentStudy: "nested-study-id",
        },
      },
    ],
  };

  const parsed = __dicomRemapTestables.parseOrthancUploadResponse(uploadResponse.json);
  assert.deepEqual(parsed.parentStudyIds, ["nested-study-id"]);
  assert.deepEqual(parsed.instanceIds, ["nested-instance-id"]);

  const resolved = await __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
    uploadResponse,
    async () => {
      throw new Error("instance lookup should not be used when nested ParentStudy is present");
    }
  );
  assert.equal(resolved, "nested-study-id");
});

test("dicom helper: Orthanc upload resolver reports sanitized shape when no ID can be resolved", async () => {
  await assert.rejects(
    () => __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
      {
        status: 201,
        ok: true,
        text: JSON.stringify({ Sensitive: "not included in error" }),
        json: { Status: "Success", Details: { Imported: true } },
      },
      async () => {
        throw new Error("instance lookup should not be used without an instance ID");
      }
    ),
    (error) => {
      assert.match((error as Error).message, /status=201/);
      assert.match((error as Error).message, /shape=object\(keys=Status,Details\)/);
      assert.doesNotMatch((error as Error).message, /Sensitive|not included/);
      return true;
    }
  );
});

test("dicom helper: createModifiedStudyCopy preflights source study and reports missing study clearly", async () => {
  const calls = queueOrthancResults([
    orthancResult({ status: 404, ok: false, text: "Unknown resource", json: { Error: "Unknown resource" } }),
    orthancResult({ status: 404, ok: false, text: "No statistics", json: { Error: "Unknown resource" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { Version: "1.12.11" } }),
    orthancResult({ status: 404, ok: false, text: "Unknown instance", json: { Error: "Unknown resource" } }),
  ]);

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("missing-study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }),
    (error) => {
      assert.match((error as Error).message, /source study no longer exists/i);
      assert.match((error as Error).message, /sourceStudyId=missing-study-id/);
      assert.match((error as Error).message, /status=404/);
      return true;
    }
  );

  assert.equal(calls[0]?.path, "/studies/missing-study-id");
  assert.equal(calls.some((call) => call.path.includes("/modify")), false);
});

test("dicom helper: createModifiedStudyCopy reports source IDs that are instances", async () => {
  queueOrthancResults([
    orthancResult({ status: 404, ok: false, text: "Unknown study", json: { Error: "Unknown resource" } }),
    orthancResult({ status: 404, ok: false, text: "No statistics", json: { Error: "Unknown resource" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { Version: "1.12.11" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ParentStudy: "real-study-id" } }),
  ]);

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("instance-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }),
    /source ID is an Orthanc instance ID, not a study ID/i
  );
});

test("dicom helper: createModifiedStudyCopy logs and reports modify 404 diagnostics", async () => {
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    __dicomRemapTestables.setSleepForTests(async () => {});
    const modify404 = orthancResult({
      status: 404,
      ok: false,
      text: "Cannot modify study. Authorization: Basic secret-token",
      json: { Error: "Unknown resource" },
    });
    const calls = queueOrthancResults([
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "study-id" } }),
    ]);
    __dicomRemapTestables.setBulkModifyRouteAvailableForTests(false);

    await assert.rejects(
      () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
        patientId: "P1",
        patientName: "Test^Patient",
        patientSex: "M",
        patientBirthDate: "19900101",
      }),
      (error) => {
        assert.match((error as Error).message, /Orthanc could not modify this uploaded study/i);
        return true;
      }
    );

    assert.equal(calls[0]?.path, "/studies/study-id");
    assert.equal(calls[1]?.path, "/studies/study-id/statistics");
    assert.equal(calls[2]?.path, "/system");
    assert.equal(calls[3]?.path, "/studies/study-id/modify");
    assert.equal(calls[4]?.path, "/studies/study-id");
    assert.equal(calls.some((call) => call.path === "/tools/bulk-modify"), false);
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.[0], "Orthanc study modify failed.");
    assert.deepEqual(logged[0]?.[1], {
      sourceStudyId: "study-id",
      studyPreflightStatus: 200,
      instanceCount: 465,
      isStable: true,
      lastUpdate: "20260430T120000",
      seriesCount: 1,
      orthancVersion: "1.12.11",
      databaseServerIdentifier: "dbid",
      modifyStatus: 404,
      modifyResponseBody: "[redacted]",
      modifyResponseShape: "object(keys=Error)",
      modifyPayloadShape: "object(keys=Replace,KeepSource,Force)",
      stabilityTimedOut: false,
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("dicom helper: createModifiedStudyCopy sends Force true with patient identity replacement", async () => {
  const calls = queueOrthancResults([
    ...stableStudyResponses(),
    orthancResult({ status: 200, ok: true, text: JSON.stringify({ ID: "modified-study-id" }), json: { ID: "modified-study-id" } }),
  ]);

  const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
    patientId: "RISPRO-123",
    patientName: "Replacement^Patient",
    patientSex: "F",
    patientBirthDate: "19850123",
  });

  assert.equal(modifiedStudyId, "modified-study-id");
  assert.equal(calls[3]?.path, "/studies/study-id/modify");
  assert.equal(calls[3]?.method, "POST");
  assert.deepEqual(calls[3]?.body, {
    Replace: {
      PatientID: "RISPRO-123",
      PatientName: "Replacement^Patient",
      PatientSex: "F",
      PatientBirthDate: "19850123",
    },
    KeepSource: true,
    Force: true,
  });
});

test("dicom helper: createModifiedStudyCopy rejects long PatientID before Orthanc modify", async () => {
  const calls = queueOrthancResults(stableStudyResponses());

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "X".repeat(65),
      patientName: "Replacement^Patient",
      patientSex: "F",
      patientBirthDate: "19850123",
    }),
    /PatientID is too long for DICOM/
  );

  assert.equal(calls.some((call) => call.path.endsWith("/modify")), false);
});

test("dicom helper: createModifiedStudyCopy rejects long PatientName before Orthanc modify", async () => {
  const calls = queueOrthancResults(stableStudyResponses());

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "RISPRO-123",
      patientName: `${"N".repeat(65)}`,
      patientSex: "F",
      patientBirthDate: "19850123",
    }),
    /PatientName is too long for DICOM/
  );

  assert.equal(calls.some((call) => call.path.endsWith("/modify")), false);
});

test("dicom helper: waitForOrthancStudyStable proceeds immediately for stable studies", async () => {
  const calls = queueOrthancResults(stableStudyResponses({ count: 3, series: ["a", "b"] }));

  const preflight = await __dicomRemapTestables.waitForOrthancStudyStable("study-id");

  assert.equal(preflight.isStable, true);
  assert.equal(preflight.instanceCount, 3);
  assert.equal(preflight.seriesCount, 2);
  assert.equal(calls.length, 3);
});

test("dicom helper: waitForOrthancStudyStable polls until Orthanc reports stable", async () => {
  const sleeps: number[] = [];
  __dicomRemapTestables.setSleepForTests(async (ms) => {
    sleeps.push(ms);
  });
  const calls = queueOrthancResults([
    ...stableStudyResponses({ isStable: false, lastUpdate: "first" }),
    ...stableStudyResponses({ isStable: true, lastUpdate: "second" }),
  ]);

  const preflight = await __dicomRemapTestables.waitForOrthancStudyStable("study-id");

  assert.equal(preflight.isStable, true);
  assert.equal(preflight.lastUpdate, "second");
  assert.deepEqual(sleeps, [1000]);
  assert.equal(calls.filter((call) => call.path === "/studies/study-id").length, 2);
});

test("dicom helper: createModifiedStudyCopy retries transient modify 404 while study still exists", async () => {
  const sleeps: number[] = [];
  __dicomRemapTestables.setSleepForTests(async (ms) => {
    sleeps.push(ms);
  });
  const calls = queueOrthancResults([
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not ready", json: { Error: "Unknown resource" } }),
    ...stableStudyResponses(),
    orthancResult({ status: 200, ok: true, text: JSON.stringify({ ID: "modified-study-id" }), json: { ID: "modified-study-id" } }),
  ]);

  const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
    patientId: "P1",
    patientName: "Test^Patient",
    patientSex: "M",
    patientBirthDate: "19900101",
  });

  assert.equal(modifiedStudyId, "modified-study-id");
  assert.deepEqual(sleeps, [500]);
  assert.equal(calls.filter((call) => call.path === "/studies/study-id/modify").length, 2);
});

test("dicom helper: createModifiedStudyCopy proceeds after stability timeout when modify succeeds", async () => {
  const originalConsoleWarn = console.warn;
  const originalDateNow = Date.now;
  console.warn = () => {};
  __dicomRemapTestables.setSleepForTests(async () => {});
  let studyReads = 0;

  try {
    const nowValues = [0, 0, 1];
    Date.now = () => nowValues.shift() ?? 1;
    const calls = queueOrthancResults([
      ...stableStudyResponses({ isStable: false, lastUpdate: "first" }),
      ...stableStudyResponses({ isStable: false, lastUpdate: "after-timeout" }),
      orthancResult({ status: 200, ok: true, text: JSON.stringify({ ID: "modified-study-id" }), json: { ID: "modified-study-id" } }),
    ]);

    const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }, {
      stabilityTimeoutMs: 0,
    });

    studyReads = calls.filter((call) => call.path === "/studies/study-id").length;
    assert.equal(modifiedStudyId, "modified-study-id");
    assert.equal(studyReads, 2);
    assert.equal(calls.filter((call) => call.path === "/studies/study-id/modify").length, 1);
  } finally {
    console.warn = originalConsoleWarn;
    Date.now = originalDateNow;
  }
});

test("dicom helper: createModifiedStudyCopy treats timeout as success when modified study is verifiable", async () => {
  const calls: string[] = [];
  __dicomRemapTestables.setOrthancFetchForTests(async (path, options = {}) => {
    calls.push(path);
    if (path === "/studies/study-id") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: {
          ID: "study-id",
          IsStable: true,
          LastUpdate: "20260501T100000",
          Series: ["series-1"],
          ParentPatient: "patient-1",
        },
      });
    }
    if (path === "/studies/study-id/statistics") {
      return orthancResult({ status: 200, ok: true, text: "{}", json: { CountInstances: 11 } });
    }
    if (path === "/system") {
      return orthancResult({ status: 200, ok: true, text: "{}", json: { Version: "1.12.11" } });
    }
    if (path === "/patients/patient-1") {
      const firstRead = calls.filter((entry) => entry === "/patients/patient-1").length === 1;
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: { Studies: firstRead ? ["study-id"] : ["study-id", "modified-study-id"] },
      });
    }
    if (path === "/studies/study-id/modify" && options.method === "POST") {
      throw new HttpError(504, "Orthanc request timed out after 60000ms.");
    }
    if (path === "/studies/modified-study-id") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: {
          MainDicomTags: {},
          PatientMainDicomTags: {
            PatientID: "P1",
            PatientName: "Test^Patient",
            PatientSex: "M",
            PatientBirthDate: "19900101",
          },
        },
      });
    }
    throw new Error(`Unexpected Orthanc request: ${path}`);
  });

  const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
    patientId: "P1",
    patientName: "Test^Patient",
    patientSex: "M",
    patientBirthDate: "19900101",
  });

  assert.equal(modifiedStudyId, "modified-study-id");
});

test("dicom helper: createModifiedStudyCopy keeps timeout clear when verification cannot prove success", async () => {
  __dicomRemapTestables.setOrthancFetchForTests(async (path, options = {}) => {
    if (path === "/studies/study-id") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: {
          ID: "study-id",
          IsStable: true,
          LastUpdate: "20260501T100000",
          Series: ["series-1"],
          ParentPatient: "patient-1",
        },
      });
    }
    if (path === "/studies/study-id/statistics") {
      return orthancResult({ status: 200, ok: true, text: "{}", json: { CountInstances: 11 } });
    }
    if (path === "/system") {
      return orthancResult({ status: 200, ok: true, text: "{}", json: { Version: "1.12.11" } });
    }
    if (path === "/patients/patient-1") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: { Studies: ["study-id"] },
      });
    }
    if (path === "/studies/study-id/modify" && options.method === "POST") {
      throw new HttpError(504, "Orthanc request timed out after 60000ms.");
    }
    throw new Error(`Unexpected Orthanc request: ${path}`);
  });

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }),
    /timed out and verification could not confirm modified study creation/i
  );
});

test("dicom helper: verifySendCompletionAfterTimeout finds completed job when available", async () => {
  __dicomRemapTestables.setOrthancFetchForTests(async (path) => {
    if (path === "/jobs?expand") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: [
          {
            ID: "job-1",
            State: "Success",
            Content: { StudyId: "modified-study-id", Modality: "RISPRO_NODE_7" },
          },
        ],
      });
    }
    throw new Error(`Unexpected Orthanc request: ${path}`);
  });

  const verified = await __dicomRemapTestables.verifySendCompletionAfterTimeout("modified-study-id", "RISPRO_NODE_7");
  assert.ok(verified);
});

test("dicom helper: verifySendCompletionAfterTimeout returns null when no proof exists", async () => {
  __dicomRemapTestables.setOrthancFetchForTests(async (path) => {
    if (path === "/jobs?expand" || path === "/jobs") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: [{ ID: "job-1", State: "Running", Content: { StudyId: "another-study" } }],
      });
    }
    throw new Error(`Unexpected Orthanc request: ${path}`);
  });

  const verified = await __dicomRemapTestables.verifySendCompletionAfterTimeout("modified-study-id", "RISPRO_NODE_7");
  assert.equal(verified, null);
});

test("dicom helper: createModifiedStudyCopy uses study-level bulk modify when study route rejects", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    __dicomRemapTestables.setSleepForTests(async () => {});
    const modify404 = orthancResult({
      status: 404,
      ok: false,
      text: "Accessing an inexistent item",
      json: { OrthancError: "Accessing an inexistent item" },
    });
    const calls = queueOrthancResults([
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "study-id" } }),
      orthancResult({
        status: 200,
        ok: true,
        text: JSON.stringify({ Resources: ["bulk-modified-study-id"] }),
        json: { Resources: ["bulk-modified-study-id"] },
      }),
    ]);
    __dicomRemapTestables.setBulkModifyRouteAvailableForTests(true);

    const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    });

    const bulkCall = calls.at(-1);
    assert.equal(modifiedStudyId, "bulk-modified-study-id");
    assert.equal(bulkCall?.path, "/tools/bulk-modify");
    assert.equal(bulkCall?.method, "POST");
    assert.deepEqual(bulkCall?.body, {
      Replace: {
        PatientID: "P1",
        PatientName: "Test^Patient",
        PatientSex: "M",
        PatientBirthDate: "19900101",
      },
      KeepSource: true,
      Force: true,
      Level: "Study",
      Resources: ["study-id"],
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("dicom helper: createModifiedStudyCopy reports missing source study after modify 404", async () => {
  __dicomRemapTestables.setSleepForTests(async () => {});
  const calls = queueOrthancResults([
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
  ]);
  __dicomRemapTestables.setBulkModifyRouteAvailableForTests(false);

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }),
    /Source study no longer exists in Orthanc\. Please reset and upload again\./i
  );

  assert.equal(calls[4]?.path, "/studies/study-id");
});

test("dicom helper: cancelled status is terminal and not active", () => {
  assert.equal(__dicomRemapTestables.isDicomRemapTerminalStatus("cancelled"), true);
  assert.equal(__dicomRemapTestables.isDicomRemapActiveStatus("cancelled"), false);
  assert.deepEqual(__dicomRemapTestables.TERMINAL_JOB_STATUSES, ["sent", "failed", "cancelled"]);
  assert.deepEqual(__dicomRemapTestables.ACTIVE_JOB_STATUSES, ["uploaded", "processing", "awaiting_confirmation", "remapped", "sending"]);
});

test("cancelDicomRemapJob cancels only an unconfirmed staged draft and audits it", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  const calls = queueQueryResults([
    { rows: [remapJob({ status: "cancelled", cancellation_reason: "User reset" })] },
  ]);

  const result = await cancelDicomRemapJob({
    jobId: 1,
    currentUserId: 42,
    reason: "User reset",
  });

  assert.equal(result.job.status, "cancelled");
  assert.equal(result.job.cancellation_reason, "User reset");
  assert.equal(auditEvents.length, 1);
  assert.match(calls[0]?.sql || "", /status = 'awaiting_confirmation'/i);
  assert.match(calls[0]?.sql || "", /processing_stage = 'awaiting_confirmation'/i);
  assert.match(calls[0]?.sql || "", /staged_manifest_version = \$4/i);
});

test("persisted remap upload accepts AlreadyStored only after replacement study and SOP verification", async () => {
  const calls = queueOrthancResults([
    orthancResult({ json: { Status: "AlreadyStored", ID: "instance-1", ParentStudy: "study-1" } }),
    orthancResult({ json: { ID: "instance-1", ParentStudy: "study-1" } }),
    orthancResult({ json: { StudyInstanceUID: "1.2.3", SOPInstanceUID: "1.2.3.4" } }),
  ]);
  const result = await __dicomRemapTestables.uploadPersistedRemappedInstance(Buffer.from("dicom"), 1, "1.2.3", "1.2.3.4", "study-1");
  assert.equal(result.category, "already_stored");
  assert.equal(result.studyId, "study-1");
  assert.deepEqual(calls.map((call) => call.path), ["/instances", "/instances/instance-1", "/instances/instance-1/simplified-tags"]);
});

test("persisted remap upload rejects AlreadyStored with unrelated replacement SOP identity", async () => {
  queueOrthancResults([
    orthancResult({ json: { Status: "AlreadyStored", ID: "instance-1", ParentStudy: "study-1" } }),
    orthancResult({ json: { ID: "instance-1", ParentStudy: "study-1" } }),
    orthancResult({ json: { StudyInstanceUID: "1.2.3", SOPInstanceUID: "9.9.9" } }),
  ]);
  await assert.rejects(
    () => __dicomRemapTestables.uploadPersistedRemappedInstance(Buffer.from("dicom"), 1, "1.2.3", "1.2.3.4", "study-1"),
    (error: unknown) => (error as { details?: { code?: string } }).details?.code === "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT"
  );
});

test("outcome summary counts unique accepted SOPs and exposes only generated file labels", () => {
  const summary = __dicomRemapTestables.buildDicomRemapOutcomeSummary({
    version: 3,
    studyInstanceUid: "1.2.3",
    seriesInstanceUidByOriginal: {},
    sopInstanceUidByFileId: {},
    fileOutcomes: {
      a: { fileLabel: "File 1", category: "processed", retryCount: 0, replacementSeriesInstanceUid: "2.1", replacementSopInstanceUid: "3.1" },
      b: { fileLabel: "File 2", category: "already_stored", retryCount: 0, replacementSeriesInstanceUid: "2.1", replacementSopInstanceUid: "3.1" },
      c: { fileLabel: "File 3", category: "unassigned_likely_dicom", retryCount: 0 },
    },
  }, { totalStagedFiles: 3, validDicomFiles: 2, selectedStudyFiles: 2, excludedOtherStudyFiles: 0, excludedStudyCount: 0, skippedOrUnparsedFiles: 1 });
  assert.equal(summary.acceptedUniqueInstances, 1);
  assert.equal(summary.completenessUncertain, true);
  assert.deepEqual(summary.failureSample, [{ fileLabel: "File 3", category: "unassigned_likely_dicom" }]);
  assert.doesNotMatch(JSON.stringify(summary), /patient|accession|\.dcm/i);
});

test("Orthanc health probe requires a successful system response", async () => {
  queueOrthancResults([orthancResult({ status: 503, ok: false, json: { HttpStatus: 503 } })]);
  assert.equal(await __dicomRemapTestables.probeOrthancHealthForRemap(), false);
  queueOrthancResults([orthancResult({ json: { Version: "deployment-version" } })]);
  assert.equal(await __dicomRemapTestables.probeOrthancHealthForRemap(), true);
});

test("Orthanc SOP verification uses the direct study instances endpoint and exact expanded SOP identities", async () => {
  const calls = queueOrthancResults([
    orthancResult({ json: { Name: "Orthanc", Version: "1.12.11" } }),
    orthancResult({ json: { ID: "study-1", IsStable: true, Series: ["series-1"] } }),
    orthancResult({ json: { CountInstances: 2 } }),
    orthancResult({ json: [
      { ID: "instance-1", MainDicomTags: { SOPInstanceUID: "1.2.3.1" } },
      { ID: "instance-2", MainDicomTags: { SOPInstanceUID: "1.2.3.2" } },
    ] }),
  ]);
  await __dicomRemapTestables.verifyOrthancStudyAcceptedSopSet("study-1", new Set(["1.2.3.1", "1.2.3.2"]));
  assert.deepEqual(calls.map((call) => call.path), ["/system", "/studies/study-1", "/studies/study-1/statistics", "/studies/study-1/instances"]);
});

test("Orthanc SOP verification falls back through multiple series and deduplicates instance IDs", async () => {
  const calls = queueOrthancResults([
    orthancResult({ json: { Name: "Orthanc", Version: "1.12.11" } }),
    orthancResult({ json: { ID: "study-1", IsStable: true, Series: ["series-1", "series-2"] } }),
    orthancResult({ json: { CountInstances: 2 } }),
    orthancResult({ status: 404, ok: false, json: { HttpStatus: 404 } }),
    orthancResult({ json: ["instance-1", "instance-2"] }),
    orthancResult({ status: 404, ok: false, json: { HttpStatus: 404 } }),
    orthancResult({ json: { ID: "series-2", Instances: ["instance-2"] } }),
    orthancResult({ json: { SOPInstanceUID: "1.2.3.1" } }),
    orthancResult({ json: { SOPInstanceUID: "1.2.3.2" } }),
  ]);
  await __dicomRemapTestables.verifyOrthancStudyAcceptedSopSet("study-1", new Set(["1.2.3.1", "1.2.3.2"]));
  assert.deepEqual(calls.slice(4, 7).map((call) => call.path), ["/series/series-1/instances", "/series/series-2/instances", "/series/series-2"]);
  assert.equal(calls.filter((call) => call.path.includes("/simplified-tags")).length, 2);
});

test("Orthanc SOP verification polls stability and renews its lease at a bounded cadence", async () => {
  __dicomRemapTestables.setSleepForTests(async () => {});
  const responses = [orthancResult({ json: { Name: "Orthanc", Version: "1.12.11" } })];
  for (let index = 0; index < 10; index += 1) responses.push(orthancResult({ json: { ID: "study-1", IsStable: false, Series: ["series-1"] } }));
  responses.push(
    orthancResult({ json: { ID: "study-1", IsStable: true, Series: ["series-1"] } }),
    orthancResult({ json: { CountInstances: 1 } }),
    orthancResult({ json: [{ ID: "instance-1", MainDicomTags: { SOPInstanceUID: "1.2.3.1" } }] }),
  );
  queueOrthancResults(responses);
  let renewals = 0;
  await __dicomRemapTestables.verifyOrthancStudyAcceptedSopSet("study-1", new Set(["1.2.3.1"]), { renewLease: async () => { renewals += 1; }, stabilityTimeoutSeconds: 20 });
  assert.equal(renewals, 3);
});

test("Orthanc SOP verification timeout and mismatches expose only safe structured reasons", async () => {
  __dicomRemapTestables.setSleepForTests(async () => {});
  queueOrthancResults([
    orthancResult({ json: { Name: "Orthanc", Version: "1.12.11" } }),
    orthancResult({ json: { ID: "study-1", IsStable: false, Series: ["series-1"] } }),
    orthancResult({ json: { ID: "study-1", IsStable: false, Series: ["series-1"] } }),
  ]);
  await assert.rejects(
    () => __dicomRemapTestables.verifyOrthancStudyAcceptedSopSet("study-1", new Set(["sensitive-sop"]), { stabilityTimeoutSeconds: 1 }),
    (error: unknown) => {
      const details = (error as { details?: Record<string, unknown> }).details || {};
      assert.equal(details.verificationReason, "STUDY_NOT_STABLE");
      assert.equal(details.expectedCount, 1);
      assert.doesNotMatch(JSON.stringify(details), /sensitive-sop/i);
      return true;
    }
  );

  queueOrthancResults([
    orthancResult({ json: { Name: "Orthanc", Version: "1.12.11" } }),
    orthancResult({ json: { ID: "study-1", IsStable: true, Series: ["series-1"] } }),
    orthancResult({ json: { CountInstances: 1 } }),
    orthancResult({ json: [{ ID: "instance-1", MainDicomTags: { SOPInstanceUID: "actual-sensitive-sop" } }] }),
  ]);
  await assert.rejects(
    () => __dicomRemapTestables.verifyOrthancStudyAcceptedSopSet("study-1", new Set(["expected-sensitive-sop"])),
    (error: unknown) => {
      const details = (error as { details?: Record<string, unknown> }).details || {};
      assert.equal(details.verificationReason, "SOP_SET_MISMATCH");
      assert.equal(details.expectedCount, 1);
      assert.equal(details.actualCount, 1);
      assert.equal(details.enumerationMethod, "direct");
      assert.doesNotMatch(JSON.stringify(details), /expected-sensitive-sop|actual-sensitive-sop/i);
      return true;
    }
  );
});

test("Orthanc SOP verification distinguishes missing series lists and unreadable SOP identities", async () => {
  queueOrthancResults([
    orthancResult({ json: { Name: "Orthanc", Version: "1.12.11" } }),
    orthancResult({ json: { ID: "study-1", IsStable: true, Series: ["series-1"] } }),
    orthancResult({ json: { CountInstances: 1 } }),
    orthancResult({ status: 404, ok: false, json: { HttpStatus: 404 } }),
    orthancResult({ status: 404, ok: false, json: { HttpStatus: 404 } }),
    orthancResult({ json: { ID: "series-1" } }),
  ]);
  await assert.rejects(
    () => __dicomRemapTestables.verifyOrthancStudyAcceptedSopSet("study-1", new Set(["expected-sop"])),
    (error: unknown) => (error as { details?: { verificationReason?: string } }).details?.verificationReason === "STUDY_INSTANCE_LIST_MISSING"
  );

  queueOrthancResults([
    orthancResult({ json: { Name: "Orthanc", Version: "1.12.11" } }),
    orthancResult({ json: { ID: "study-1", IsStable: true, Series: ["series-1"] } }),
    orthancResult({ json: { CountInstances: 1 } }),
    orthancResult({ json: ["instance-1"] }),
    orthancResult({ json: {} }),
  ]);
  await assert.rejects(
    () => __dicomRemapTestables.verifyOrthancStudyAcceptedSopSet("study-1", new Set(["expected-sop"])),
    (error: unknown) => (error as { details?: { verificationReason?: string } }).details?.verificationReason === "INSTANCE_SOP_UID_UNREADABLE"
  );
});

test("cancelDicomRemapJob does not cancel a confirmed uploaded queued job", async () => {
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded", processing_stage: "queued", staged_manifest_version: 2 })] },
  ]);
  await assert.rejects(
    () => cancelDicomRemapJob({ jobId: 1, currentUserId: 42, reason: "start another upload" }),
    (error) => {
      assert.equal(error instanceof HttpError ? error.statusCode : 0, 409);
      assert.match((error as Error).message, /already being processed/i);
      return true;
    }
  );
});

test("cancelDicomRemapJob returns an already-cancelled job safely", async () => {
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "cancelled", cancellation_reason: "Already done" })] },
  ]);

  const result = await cancelDicomRemapJob({
    jobId: 1,
    currentUserId: 42,
    reason: "again",
  });

  assert.equal(result.job.status, "cancelled");
  assert.equal(result.job.cancellation_reason, "Already done");
});

test("cancelDicomRemapJob rejects sent and failed terminal jobs", async () => {
  for (const status of ["sent", "failed"] as const) {
    queueQueryResults([
      { rows: [] },
      { rows: [remapJob({ status })] },
    ]);

    await assert.rejects(
      () => cancelDicomRemapJob({ jobId: 1, currentUserId: 42, reason: "too late" }),
      (error) => {
        assert.equal(error instanceof HttpError ? error.statusCode : 0, 409);
        assert.match((error as Error).message, /cannot be cancelled/i);
        return true;
      }
    );
    __dicomRemapTestables.resetTestOverrides();
  }
});

test("resetDicomRemapJob deletes linked source and modified studies, ignores 404, and audits", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [remapJob({
      status: "failed",
      source_orthanc_study_id: "source-study",
      modified_orthanc_study_id: "modified-study",
    })] },
    { rows: [remapJob({
      status: "cancelled",
      source_orthanc_study_id: "source-study",
      modified_orthanc_study_id: "modified-study",
      cancellation_reason: "Reset by user before retry",
    })] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
    orthancResult({ status: 404, ok: false, text: "missing", json: { Error: "missing" } }),
  ]);

  const result = await __dicomRemapTestables.resetDicomRemapJob({
    jobId: 1,
    currentUserId: 42,
  });

  assert.equal(result.job.status, "cancelled");
  assert.equal(result.job.cancellation_reason, "Reset by user before retry");
  assert.equal(result.summary.studiesAttempted, 2);
  assert.equal(result.summary.studiesDeleted, 1);
  assert.equal(result.summary.studiesAlreadyMissing, 1);
  assert.deepEqual(calls.map((call) => call.path), ["/studies/source-study", "/studies/modified-study"]);
  assert.equal(auditEvents.length, 1);
});

test("resetDicomRemapJob fails clearly on non-404 Orthanc delete errors", async () => {
  queueQueryResults([
    { rows: [remapJob({ status: "failed", source_orthanc_study_id: "source-study" })] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 500, ok: false, text: "Orthanc down", json: { Error: "down" } }),
  ]);

  await assert.rejects(
    () => __dicomRemapTestables.resetDicomRemapJob({ jobId: 1, currentUserId: 42 }),
    (error) => {
      assert.equal(error instanceof HttpError ? error.statusCode : 0, 502);
      assert.match((error as Error).message, /Failed to delete one or more linked Orthanc studies/);
      return true;
    }
  );
});

test("resetDicomRemapJob rejects sending and sent jobs before Orthanc delete", async () => {
  for (const status of ["sending", "sent"] as const) {
    queueQueryResults([
      { rows: [remapJob({ status, source_orthanc_study_id: `${status}-source` })] },
    ]);

    await assert.rejects(
      () => __dicomRemapTestables.resetDicomRemapJob({ jobId: 1, currentUserId: 42 }),
      (error) => {
        assert.equal(error instanceof HttpError ? error.statusCode : 0, 409);
        assert.match((error as Error).message, /cannot be reset after send processing has started/);
        return true;
      }
    );
  }
});

test("clearFailedDicomRemapOrthancStudies deletes only failed and cancelled job studies", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [
      remapJob({ id: 1, status: "failed", source_orthanc_study_id: "failed-source", modified_orthanc_study_id: "failed-modified" }),
      remapJob({ id: 2, status: "cancelled", source_orthanc_study_id: "cancelled-source", modified_orthanc_study_id: "failed-source" }),
    ] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
    orthancResult({ status: 404, ok: false, text: "missing", json: {} }),
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
  ]);

  const summary = await __dicomRemapTestables.clearFailedDicomRemapOrthancStudies(42);

  assert.deepEqual(calls.map((call) => call.path), [
    "/studies/failed-source",
    "/studies/failed-modified",
    "/studies/cancelled-source",
  ]);
  assert.equal(summary.studiesAttempted, 3);
  assert.equal(summary.studiesDeleted, 2);
  assert.equal(summary.studiesAlreadyMissing, 1);
  assert.equal(auditEvents.length, 1);
});

test("clearFailedDicomRemapOrthancStudies discovers missing modified studies by accession/date/modality and replacement patient", async () => {
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  queueQueryResults([
    {
      rows: [
        remapJob({
          id: 1,
          status: "failed",
          source_orthanc_study_id: "source-study",
          modified_orthanc_study_id: null,
          replacement_patient_id: "RISPRO-900",
        }),
      ],
    },
  ]);

  const calls = queueOrthancResults([
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: { AccessionNumber: "ACC-42", StudyDate: "20260501" },
        PatientMainDicomTags: { PatientID: "SRC-PATIENT" },
        Series: ["src-series-1"],
      },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { MainDicomTags: { Modality: "CT" } },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "[]",
      json: ["source-study", "candidate-modified", "other-study"],
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: { AccessionNumber: "ACC-42", StudyDate: "20260501" },
        PatientMainDicomTags: { PatientID: "RISPRO-900" },
        Series: ["cand-series-1"],
      },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { MainDicomTags: { Modality: "CT" } },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: { AccessionNumber: "ACC-42", StudyDate: "20260501" },
        PatientMainDicomTags: { PatientID: "OTHER-PATIENT" },
        Series: ["other-series-1"],
      },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { MainDicomTags: { Modality: "CT" } },
    }),
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
  ]);

  const summary = await __dicomRemapTestables.clearFailedDicomRemapOrthancStudies(42);

  const deletePaths = calls.filter((call) => call.method === "DELETE").map((call) => call.path);
  assert.deepEqual(deletePaths, ["/studies/source-study", "/studies/candidate-modified"]);
  assert.equal(summary.studiesAttempted, 2);
  assert.equal(summary.studiesDeleted, 2);
  assert.equal(summary.studiesAlreadyMissing, 0);
});

test("hardResetOrthancStudies requires typed confirmation", async () => {
  await assert.rejects(
    () => __dicomRemapTestables.hardResetOrthancStudies(42, "delete"),
    /Typed confirmation is required/
  );
});

test("hardResetOrthancStudies deletes all Orthanc studies, marks active jobs failed, and audits", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: JSON.stringify(["study-a", "study-b"]), json: ["study-a", "study-b"] }),
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
    orthancResult({ status: 404, ok: false, text: "missing", json: {} }),
  ]);

  const summary = await __dicomRemapTestables.hardResetOrthancStudies(42, "DELETE ALL ORTHANC STUDIES");

  assert.deepEqual(calls.map((call) => call.path), ["/studies", "/studies/study-a", "/studies/study-b"]);
  assert.equal(summary.totalOrthancStudiesFound, 2);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.alreadyMissing, 1);
  assert.deepEqual(summary.failedDeletions, []);
  assert.equal(auditEvents.length, 1);
});

test("cancelled jobs do not count as active upload blockers", () => {
  assert.equal(__dicomRemapTestables.isDicomRemapActiveStatus("cancelled"), false);
  assert.equal(__dicomRemapTestables.ACTIVE_JOB_STATUSES.includes("cancelled"), false);
});

test("createDicomRemapUploadJob does not translate unrelated unique violations into singular active-job conflicts", async () => {
  const uniqueError = Object.assign(new Error("duplicate key"), { code: "23505" });
  queueQueryResults([uniqueError]);

  await assert.rejects(
    () => createDicomRemapUploadJob({
      files: [{ fileName: "study.dcm", fileContentBase64: "AA==" }],
      currentUserId: 42,
    }),
    (error) => {
      assert.equal((error as { code?: string }).code, "23505");
      return true;
    }
  );
});

test("active remap lookup resumes exactly one awaiting-confirmation draft only", async () => {
  const active = remapJob({ id: 77, created_by_user_id: 42, status: "awaiting_confirmation", processing_stage: "awaiting_confirmation", staged_manifest_version: 2, staged_storage_key: "jobs/77-test", source_orthanc_study_id: null });
  const calls = queueQueryResults([{ rows: [active] }, { rows: [active] }]);
  const result = await getMyActiveDicomRemapJob({ currentUserId: 42 });
  assert.equal(result.job?.id, 77);
  assert.equal(result.job?.status, "awaiting_confirmation");
  assert.match(calls[0]?.sql || "", /status = 'awaiting_confirmation'/);
  assert.match(calls[0]?.sql || "", /limit 2/i);
  assert.deepEqual(calls[0]?.params, [42, 2]);

  queueQueryResults([{ rows: [] }]);
  const noActive = await getMyActiveDicomRemapJob({ currentUserId: 42 });
  assert.deepEqual(noActive, { job: null, comparison: null });

  queueQueryResults([{ rows: [active, remapJob({ ...active, id: 78 })] }]);
  const ambiguousDrafts = await getMyActiveDicomRemapJob({ currentUserId: 42 });
  assert.deepEqual(ambiguousDrafts, { job: null, comparison: null });
});

test("createDicomRemapUploadJob skips DICOMDIR folder index files", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "study-id" })] },
  ]);
  const orthancCalls = queueOrthancResults([
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { ID: "instance-id", ParentStudy: "study-id" },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {},
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  const result = await createDicomRemapUploadJob({
    currentUserId: 42,
    files: [
      { fileName: "DICOMDIR", mimeType: "application/octet-stream", fileContentBase64: "AA==" },
      { fileName: "image.dcm", mimeType: "application/dicom", fileContentBase64: "AA==" },
    ],
  });

  assert.equal(result.job.source_orthanc_study_id, "study-id");
  assert.equal(orthancCalls.filter((call) => call.path === "/instances").length, 1);
  assert.equal(auditEvents.length, 1);
});

test("createDicomRemapMultipartUploadJob skips sidecars and uploads accepted files without Base64", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "AUTORUN.INF", mimeType: "application/octet-stream" },
    { fileName: "DICOMDIR", mimeType: "application/octet-stream" },
    { fileName: "viewer.exe", mimeType: "application/octet-stream" },
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
    { fileName: "image-2.dcm", mimeType: "application/dicom" },
  ]);
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "study-id" })] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "study-id" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i2", ParentStudy: "study-id" } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {},
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  const result = await createDicomRemapMultipartUploadJob({
    currentUserId: 42,
    files: staged,
    tempDir,
  });

  assert.equal(result.job.source_orthanc_study_id, "study-id");
  assert.equal(result.skippedFilesCount, 3);
  assert.equal(calls.filter((call) => call.path === "/instances").length, 2);
  assert.equal(auditEvents.length, 1);
});

test("createDicomRemapMultipartUploadJob rejects selectedStudyInstanceUID mismatch", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
  ]);
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "study-id" } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {
          StudyInstanceUID: "1.2.840.study.actual",
        },
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
      selectedStudyInstanceUID: "1.2.840.study.selected",
    }),
    /Uploaded study does not match selected study\. Please rescan and retry\./
  );
});

test("createDicomRemapMultipartUploadJob skips Orthanc invalid-DICOM rejections when valid instances remain", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "opaque-support-file", mimeType: "application/octet-stream" },
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
  ]);
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "study-id" })] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({
      status: 400,
      ok: false,
      text: "Bad file format",
      json: { OrthancStatus: 15, Message: "Bad file format" },
    }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "study-id" } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {},
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  const result = await createDicomRemapMultipartUploadJob({
    currentUserId: 42,
    files: staged,
    tempDir,
  });

  assert.equal(result.job.source_orthanc_study_id, "study-id");
  assert.equal(result.skippedFilesCount, 1);
  assert.equal(calls.filter((call) => call.path === "/instances").length, 2);
});

test("createDicomRemapMultipartUploadJob fails when Orthanc accepts zero valid DICOM files", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "opaque-support-file", mimeType: "application/octet-stream" },
  ]);
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({
      status: 400,
      ok: false,
      text: "Cannot parse an invalid DICOM file",
      json: { Message: "Cannot parse an invalid DICOM file" },
    }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
    }),
    /No uploadable DICOM instance files were found/
  );
});

test("createDicomRemapMultipartUploadJob still fails on Orthanc 500 upload errors", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
  ]);
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({
      status: 500,
      ok: false,
      text: "Bad file format",
      json: { OrthancStatus: 15, Message: "Bad file format" },
    }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
    }),
    /status=500/
  );
});

test("createDicomRemapMultipartUploadJob still fails on Orthanc auth-style upload errors", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
  ]);
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({
      status: 401,
      ok: false,
      text: "Unauthorized",
      json: { HttpError: "Unauthorized" },
    }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
    }),
    /status=401/
  );
});

test("createDicomRemapMultipartUploadJob rejects multiple parent studies clearly", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "image-1.dcm" },
    { fileName: "image-2.dcm" },
  ]);
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "study-a" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i2", ParentStudy: "study-b" } }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
    }),
    /detected 2 studies/i
  );
});

test("createDicomRemapMultipartUploadJob handles 1000+ instances for one study", async () => {
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  const fileCount = 1001;
  const { tempDir, staged } = await makeStagedFiles(
    Array.from({ length: fileCount }, (_, index) => ({ fileName: `image-${index}.dcm` }))
  );
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "study-id" })] },
  ]);
  const orthancResponses = Array.from({ length: fileCount }, (_, index) => (
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: `i${index}`, ParentStudy: "study-id" } })
  ));
  orthancResponses.push(orthancResult({
    status: 200,
    ok: true,
    text: "{}",
    json: {
      MainDicomTags: {},
      PatientMainDicomTags: {
        PatientID: "P1",
        PatientName: "Original^Patient",
        PatientSex: "M",
        PatientBirthDate: "19900101",
      },
    },
  }));
  const calls = queueOrthancResults(orthancResponses);

  const result = await createDicomRemapMultipartUploadJob({
    currentUserId: 42,
    files: staged,
    tempDir,
  });

  assert.equal(result.job.source_orthanc_study_id, "study-id");
  assert.equal(calls.filter((call) => call.path === "/instances").length, fileCount);
});

test("prepareDicomRemapConfirmation marks missing source study as stale", async () => {
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "stale-study" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 404, ok: false, text: "missing", json: { Error: "missing" } }),
  ]);

  const { prepareDicomRemapConfirmation } = await import("./dicom-remap-service.js");
  await assert.rejects(
    () => prepareDicomRemapConfirmation({
      jobId: 1,
      currentUserId: 42,
      risproPatientId: 1,
      destinationPacsKey: "1",
    }),
    /Source study no longer exists in Orthanc/
  );
});

test("createDicomRemapUploadJob creates a fresh upload without inspecting another active job", async () => {
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  const queryCalls = queueQueryResults([
    { rows: [remapJob({ id: 10, status: "uploaded", source_orthanc_study_id: null })] },
    { rows: [remapJob({ id: 10, status: "uploaded", source_orthanc_study_id: "fresh-study" })] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "fresh-study" } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {},
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  const result = await createDicomRemapUploadJob({
    currentUserId: 42,
    files: [{ fileName: "fresh.dcm", mimeType: "application/dicom", fileContentBase64: "AA==" }],
  });

  assert.equal(result.job.id, 10);
  assert.equal(result.job.source_orthanc_study_id, "fresh-study");
  assert.match(queryCalls[0]?.sql || "", /insert into dicom_remap_jobs/i);
});

test("confirmDicomRemapAndSend claim failure returns already-sent job without Orthanc calls", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Orthanc should not be called when confirm claim fails");
  }) as typeof fetch;
  try {
    queueQueryResults([
      { rows: [] },
      { rows: [remapJob({ status: "sent" })] },
    ]);

    const result = await confirmDicomRemapAndSend({
      jobId: 1,
      currentUserId: 42,
      confirm: true,
    });

    assert.equal(result.job.status, "sent");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("confirmDicomRemapAndSend claim failure rejects non-sent jobs before Orthanc calls", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Orthanc should not be called when confirm claim fails");
  }) as typeof fetch;
  try {
    queueQueryResults([
      { rows: [] },
      { rows: [remapJob({ status: "awaiting_confirmation" })] },
    ]);

    await assert.rejects(
      () => confirmDicomRemapAndSend({
        jobId: 1,
        currentUserId: 42,
        confirm: true,
      }),
      (error) => {
        assert.equal(error instanceof HttpError ? error.statusCode : 0, 409);
        assert.match((error as Error).message, /not awaiting confirmation/i);
        return true;
      }
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resendDicomRemapJobToPacs atomically enqueues an asynchronous Orthanc job", async () => {
  const auditEntries: Array<Record<string, unknown>> = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEntries.push(entry as unknown as Record<string, unknown>);
    return {} as never;
  });
  __dicomRemapTestables.setPacsNodeGetterForTests(async () => ({
    id: 1,
    called_ae_title: "DEST_AE",
    host: "127.0.0.1",
    port: 104,
    is_active: true,
  } as never));

  queueQueryResults([
    { rows: [remapJob({ id: 21, status: "failed", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1" })] },
    { rows: [remapJob({ id: 21, status: "sending", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1", send_attempt_count: 1 })] },
    { rows: [remapJob({ id: 21, status: "sending", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1", orthanc_send_job_id: "orthanc-send-21", send_attempt_count: 1 })] },
  ]);

  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "modified-study" } }),
    orthancResult({ status: 202, ok: true, text: "{}", json: { ID: "orthanc-send-21" } }),
  ]);

  const result = await resendDicomRemapJobToPacs({
    jobId: 21,
    currentUserId: 42,
  });

  assert.equal(result.job.status, "sending");
  assert.equal(result.job.orthanc_send_job_id, "orthanc-send-21");
  assert.equal(auditEntries.some((entry) => entry.actionType === "pacs_resend_enqueued"), true);
});

test("confirmDicomRemapAndSend blocks partial-study send without the dedicated acknowledgement", async () => {
  const partial = remapJob({
    status: "awaiting_confirmation",
    processing_stage: "awaiting_send_confirmation",
    modified_orthanc_study_id: "partial-study",
    processing_selection_counts: {
      totalStagedFiles: 2,
      validDicomFiles: 2,
      selectedStudyFiles: 2,
      excludedOtherStudyFiles: 0,
      excludedStudyCount: 0,
      skippedOrUnparsedFiles: 0,
      acceptedUniqueInstances: 1,
      failedSelectedStudyFiles: 1,
      partial: true,
    },
  });
  queueQueryResults([{ rows: [] }, { rows: [partial] }]);
  await assert.rejects(
    () => confirmDicomRemapAndSend({ jobId: partial.id, confirm: true, confirmIncompleteStudy: false, currentUserId: 42 }),
    /incomplete-study acknowledgement is required/i
  );
});

test("repeated resend returns the persisted sending job without another Orthanc enqueue", async () => {
  const sending = remapJob({ id: 23, status: "sending", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1", orthanc_send_job_id: "orthanc-send-23", send_attempt_count: 2 });
  queueQueryResults([{ rows: [sending] }]);
  const orthancCalls = queueOrthancResults([]);
  const result = await resendDicomRemapJobToPacs({ jobId: 23, currentUserId: 42 });
  assert.equal(result.job.orthanc_send_job_id, "orthanc-send-23");
  assert.equal(result.job.send_attempt_count, 2);
  assert.equal(orthancCalls.length, 0);
});

test("resendDicomRemapJobToPacs records asynchronous enqueue failures without a fallback send", async () => {
  const auditEntries: Array<Record<string, unknown>> = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEntries.push(entry as unknown as Record<string, unknown>);
    return {} as never;
  });
  __dicomRemapTestables.setPacsNodeGetterForTests(async () => ({
    id: 1,
    called_ae_title: "DEST_AE",
    host: "127.0.0.1",
    port: 104,
    is_active: true,
  } as never));
  const originalFailure = remapJob({ id: 22, status: "failed", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1", orthanc_send_job_id: "previous-orthanc-job", send_attempt_count: 3, error_message: "Original persisted send failure", send_error_code: "ORTHANC_SEND_JOB_FAILED", send_error_details: { original: true } });
  const queryCalls = queueQueryResults([
    { rows: [originalFailure] },
    { rows: [remapJob({ ...originalFailure, status: "sending", orthanc_send_job_id: null })] },
    { rows: [originalFailure] },
  ]);

  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "modified-study" } }),
    orthancResult({ status: 500, ok: false, text: "store failed", json: { Message: "store failed" } }),
    orthancResult({ status: 404, ok: false, text: "missing", json: { HttpStatus: 404 } }),
    orthancResult({ status: 404, ok: false, text: "missing", json: { HttpStatus: 404 } }),
    orthancResult({ status: 500, ok: false, text: "store failed", json: { Message: "store failed" } }),
    orthancResult({ status: 500, ok: false, text: "store failed", json: { Message: "store failed" } }),
  ]);

  await assert.rejects(
    () => resendDicomRemapJobToPacs({
      jobId: 22,
      currentUserId: 42,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, /rejected asynchronous PACS send enqueue/i);
      return true;
    }
  );
  const failedUpdateCall = queryCalls.find((call) =>
    call.sql.includes("update dicom_remap_jobs") &&
    call.sql.includes("set status = 'failed'")
  );
  assert.ok(failedUpdateCall, "Resend failure should mark the job as failed");
  assert.equal(failedUpdateCall?.params?.[1], "previous-orthanc-job");
  assert.equal(failedUpdateCall?.params?.[2], "Original persisted send failure");
  assert.equal(failedUpdateCall?.params?.[3], "ORTHANC_SEND_JOB_FAILED");
  assert.equal(failedUpdateCall?.params?.[4], JSON.stringify({ original: true }));
  assert.equal(auditEntries.some((entry) => entry.actionType === "pacs_send_failed"), true);
});

test("dicom helper: status transition guard throws on unexpected status", () => {
  assert.throws(
    () => __dicomRemapTestables.assertJobStatus("uploaded", "awaiting_confirmation", "bad"),
    /bad/i
  );

  assert.doesNotThrow(() => {
    __dicomRemapTestables.assertJobStatus("uploaded", "uploaded", "ok");
  });
});
