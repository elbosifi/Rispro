import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import jwt from "jsonwebtoken";
import dcmjs from "dcmjs";

if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-durable-"));
process.env.DICOM_REMAP_STAGING_DIR = stagingRoot;

const { datasetToBuffer, DicomMessage, DicomMetaDictionary } = dcmjs.data;

test.after(async () => {
  await fs.rm(stagingRoot, { recursive: true, force: true });
  const { pool } = await import("../db/pool.js");
  await pool.end().catch(() => undefined);
});

interface FakeOrthancScenario {
  returnedStudyUid?: string;
  returnedPatientId?: string;
  returnedPatientName?: string;
  statisticsStatus?: number;
  reportedInstanceCount?: number;
  parentStudyBySop?: Record<string, string>;
  uploadFailureAfterAccepted?: number | null;
  duplicateMode?: "matching" | "conflicting";
  sendMode?: "success" | "missing-id";
  malformedStatistics?: boolean;
}

interface FakeOrthancState {
  studyId: string;
  studyUid: string;
  uploaded: Map<string, Buffer>;
  uploadRecords: Array<{ sop: string; study: string; body: Buffer }>;
  scenario: FakeOrthancScenario;
  firstUploadPlanExists: boolean | null;
  firstUploadPlanPath: string | null;
  sendCount: number;
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function syntheticDicom(sopInstanceUid: string): Buffer {
  return Buffer.from(datasetToBuffer({
    _meta: {
      FileMetaInformationVersion: new Uint8Array([0, 1]),
      MediaStorageSOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
      MediaStorageSOPInstanceUID: sopInstanceUid,
      TransferSyntaxUID: "1.2.840.10008.1.2.1",
      ImplementationClassUID: "2.25.12345",
    },
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
    SOPInstanceUID: sopInstanceUid,
    StudyInstanceUID: "1.2.840.10008.1.2.3.4.5",
    SeriesInstanceUID: "1.2.840.10008.1.2.3.4.5.1",
    PatientID: "SOURCE-ID",
    PatientName: "Source^Patient",
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
  }));
}

function parseDicom(buffer: Buffer): { study: string; series: string; sop: string; patientId: string; patientName: string } {
  const parsed = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)) as { dict: Record<string, unknown> };
  const dataset = DicomMetaDictionary.naturalizeDataset(parsed.dict) as Record<string, unknown>;
  const readValue = (value: unknown, depth = 0): string => {
    if (depth > 5) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return readValue(value[0], depth + 1);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["Alphabetic", "Value", "value", "Text", "text"]) {
        if (key in record) {
          const parsedValue = readValue(record[key], depth + 1);
          if (parsedValue) return parsedValue;
        }
      }
      for (const nested of Object.values(record)) {
        const parsedValue = readValue(nested, depth + 1);
        if (parsedValue) return parsedValue;
      }
    }
    return "";
  };
  return {
    study: readValue(dataset.StudyInstanceUID),
    series: readValue(dataset.SeriesInstanceUID),
    sop: readValue(dataset.SOPInstanceUID),
    patientId: readValue(dataset.PatientID),
    patientName: readValue(dataset.PatientName),
  };
}

function jsonResponse(res: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(body);
}

async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function startFakeOrthanc(initialScenario: FakeOrthancScenario = {}): Promise<{ state: FakeOrthancState; url: string; close: () => Promise<void> }> {
  const state: FakeOrthancState = {
    studyId: "fake-study-1",
    studyUid: "",
    uploaded: new Map(),
    uploadRecords: [],
    scenario: { ...initialScenario },
    firstUploadPlanExists: null,
    firstUploadPlanPath: null,
    sendCount: 0,
  };
  const parentStudyForSop = (sop: string): string => {
    const direct = state.scenario.parentStudyBySop?.[sop];
    if (direct) return direct;
    const values = Object.values(state.scenario.parentStudyBySop || {});
    const recordIndex = state.uploadRecords.findIndex((record) => record.sop === sop);
    return values[recordIndex >= 0 ? recordIndex : state.uploaded.size] || state.studyId;
  };
  const server = http.createServer(async (req, res) => {
    const requestPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
    try {
      if (req.method === "GET" && requestPath === "/modalities") return jsonResponse(res, 200, ["PACS_TEST"]);
      if (req.method === "GET" && requestPath === "/modalities/PACS_TEST/configuration") return jsonResponse(res, 200, ["PACS_AE", "127.0.0.1", 104]);
      if (req.method === "PUT" && requestPath === "/modalities/PACS_TEST") {
        await readRequestBody(req);
        return jsonResponse(res, 200, {});
      }
      if (req.method === "POST" && requestPath === "/instances") {
        const body = await readRequestBody(req);
        const parsed = parseDicom(body);
        if (!state.firstUploadPlanExists) {
          state.firstUploadPlanExists = Boolean(state.firstUploadPlanPath && await fs.access(state.firstUploadPlanPath).then(() => true).catch(() => false));
        }
        if (!state.studyUid) state.studyUid = parsed.study;
        const previous = state.uploaded.get(parsed.sop);
        if (previous) {
          if (state.scenario.duplicateMode !== "conflicting" && Buffer.compare(previous, body) === 0) return jsonResponse(res, 409, { ID: `instance-${parsed.sop}`, ParentStudy: parentStudyForSop(parsed.sop) });
          return jsonResponse(res, 409, { OrthancStatus: 17, Message: "Instance already exists with different content" });
        }
        if (state.scenario.uploadFailureAfterAccepted != null && state.uploaded.size >= state.scenario.uploadFailureAfterAccepted) return jsonResponse(res, 500, { OrthancStatus: 99, Message: "simulated upload failure" });
        state.uploaded.set(parsed.sop, body);
        state.uploadRecords.push({ sop: parsed.sop, study: parsed.study, body });
        return jsonResponse(res, 200, { ID: `instance-${parsed.sop}`, ParentStudy: parentStudyForSop(parsed.sop) });
      }
      if (req.method === "GET" && requestPath.endsWith("/statistics")) {
        const status = state.scenario.statisticsStatus ?? 200;
        if (status !== 200) return jsonResponse(res, status, { error: "simulated statistics failure" });
        if (state.scenario.malformedStatistics) return jsonResponse(res, 200, { Statistics: { unexpected: true } });
        return jsonResponse(res, 200, { CountInstances: state.scenario.reportedInstanceCount ?? state.uploaded.size });
      }
      if (req.method === "GET" && requestPath.startsWith("/studies/")) {
        const requestedStudyId = decodeURIComponent(requestPath.slice("/studies/".length));
        const first = Array.from(state.uploaded.entries()).find(([sop]) => parentStudyForSop(sop) === requestedStudyId)?.[1] || state.uploaded.values().next().value as Buffer | undefined;
        const parsed = first ? parseDicom(first) : { patientId: "", patientName: "", study: state.studyUid, series: "", sop: "" };
        return jsonResponse(res, 200, {
          ID: requestedStudyId,
          MainDicomTags: { StudyInstanceUID: state.scenario.returnedStudyUid || state.studyUid },
          PatientMainDicomTags: { PatientID: state.scenario.returnedPatientId || parsed.patientId, PatientName: state.scenario.returnedPatientName || parsed.patientName, PatientSex: "M", PatientBirthDate: "" },
          Series: [parsed.series || "fake-series"],
        });
      }
      if (req.method === "POST" && requestPath === "/modalities/PACS_TEST/store") {
        await readRequestBody(req);
        state.sendCount += 1;
        return jsonResponse(res, 202, state.scenario.sendMode === "missing-id" ? {} : { ID: "fake-send-1" });
      }
      return jsonResponse(res, 404, { error: "not found" });
    } catch (error) {
      return jsonResponse(res, 500, { error: error instanceof Error ? error.message : "fake orthanc error" });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Orthanc did not bind.");
  return {
    state,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function resetFakeOrthancState(state: FakeOrthancState, scenario: FakeOrthancScenario = {}): void {
  state.studyUid = "";
  state.uploaded.clear();
  state.uploadRecords.length = 0;
  state.scenario = { ...scenario };
  state.firstUploadPlanExists = null;
  state.firstUploadPlanPath = null;
  state.sendCount = 0;
}

async function ensureDbOrSkip(t: { skip: (message?: string) => void }): Promise<boolean> {
  const { pool } = await import("../db/pool.js");
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
}

test("migration 119 exposes durable processing columns, accepted status, and indexes", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const { pool } = await import("../db/pool.js");
  const expectedColumns = [
    "processing_stage", "staged_storage_key", "staged_manifest_version", "staged_file_count", "staged_total_bytes",
    "processed_file_count", "processing_skipped_file_count", "processing_attempt_count", "processing_started_at",
    "processing_completed_at", "processing_last_checked_at", "processing_last_heartbeat_at", "processing_lease_owner",
    "processing_lease_expires_at", "processing_error_code", "processing_error_details", "staging_cleanup_completed_at",
  ];
  const columns = await pool.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'dicom_remap_jobs' and column_name = any($1::text[])`, [expectedColumns]);
  assert.deepEqual(new Set(columns.rows.map((row) => row.column_name)), new Set(expectedColumns));
  const constraint = await pool.query<{ definition: string }>(`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'dicom_remap_jobs'::regclass and conname = 'dicom_remap_jobs_status_check'`);
  assert.match(constraint.rows[0]?.definition || "", /processing/);
  const indexes = await pool.query<{ indexname: string; indexdef: string }>(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'dicom_remap_jobs' and indexname = any($1::text[])`, [["dicom_remap_jobs_single_active_per_user_idx", "dicom_remap_jobs_processing_queue_idx", "dicom_remap_jobs_processing_lease_idx"]]);
  assert.equal(indexes.rows.length, 3);
  assert.match(indexes.rows.find((row) => row.indexname === "dicom_remap_jobs_single_active_per_user_idx")?.indexdef || "", /processing/);
});

test("durable remap processing stages, claims concurrently, recovers partial Orthanc work, and resumes send handoff", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const { pool } = await import("../db/pool.js");
  const { env } = await import("../config/env.js");
  const { createApp } = await import("../app.js");
  const { runDicomRemapProcessingWorkerTick } = await import("./dicom-remap-processing-worker.js");
  const { __dicomRemapTestables } = await import("./dicom-remap-service.js");
  const { __setOrthancPacsFetchForTests, __setOrthancPacsSettingsForTests, __resetOrthancPacsFetchForTests, __resetOrthancPacsSettingsForTests } = await import("./orthanc-pacs-service.js");
  const fake = await startFakeOrthanc();
  const suffix = uniqueSuffix();
  const username = `dicom_durable_${suffix}`;
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const user = await pool.query<{ id: number }>(`insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, $3, 'supervisor', true) returning id`, [username, `DICOM Durable ${suffix}`, passwordHash]);
  const userId = Number(user.rows[0]!.id);
  const claimUser = await pool.query<{ id: number }>(`insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, $3, 'supervisor', true) returning id`, [`${username}_claim`, `DICOM Durable Claim ${suffix}`, passwordHash]);
  const claimUserId = Number(claimUser.rows[0]!.id);
  const nationalId = `${Date.now()}`.slice(-12);
  const patient = await pool.query<{ id: number }>(`insert into patients (national_id, identifier_type, identifier_value, arabic_full_name, english_full_name, normalized_arabic_name, age_years, estimated_date_of_birth, sex, phone_1, address, created_by_user_id, updated_by_user_id) values ($1::varchar, 'national_id', $1::text, $2, $3, $4, 35, '1991-01-01', 'M', '0912345678', 'Test', $5::bigint, $5::bigint) returning id`, [nationalId, `مريض ${suffix}`, `Durable^Patient^${suffix}`, `مريض${suffix}`, userId]);
  const patientId = Number(patient.rows[0]!.id);
  let appServer: http.Server | null = null;
  let jobId = 0;
  try {
    const fakeRequest = async (requestPath: string, options: { method?: string; body?: unknown } = {}) => {
      let body: BodyInit | undefined;
      if (Buffer.isBuffer(options.body)) body = new Uint8Array(options.body) as unknown as BodyInit;
      else if (options.body !== undefined) body = JSON.stringify(options.body);
      const response = await fetch(`${fake.url}${requestPath}`, { method: options.method || "GET", body, headers: options.body && !Buffer.isBuffer(options.body) ? { "Content-Type": "application/json" } : undefined });
      const text = await response.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: response.status, ok: response.ok, text, json };
    };
    __dicomRemapTestables.setOrthancFetchForTests(fakeRequest as never);
    __setOrthancPacsSettingsForTests({ enabled: false, shadowMode: false, connectionMode: "external", baseUrl: fake.url, username: "", password: "", timeoutSeconds: 5, verifyTls: false, sendOnlyWhenPatientEntersQueue: false, worklistTarget: "", strategyPreference: "put_first", mwlCompatibility: { enabledTags: [], extraTags: [] } } as never);
    __setOrthancPacsFetchForTests(fakeRequest as never);

    const app = createApp();
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const address = appServer.address();
    if (!address || typeof address === "string") throw new Error("RISpro test server did not bind.");
    const risproUrl = `http://127.0.0.1:${address.port}`;
    const token = jwt.sign({ sub: userId, role: "supervisor", username, fullName: `DICOM Durable ${suffix}` }, env.jwtSecret);
    const sourceA = syntheticDicom("1.2.840.10008.1.2.3.4.5.1");
    const sourceB = syntheticDicom("1.2.840.10008.1.2.3.4.5.2");
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(sourceA)], { type: "application/dicom" }), "a.dcm");
    form.append("files", new Blob([new Uint8Array(sourceB)], { type: "application/dicom" }), "b.dcm");
    form.append("selectedStudyInstanceUID", "1.2.840.10008.1.2.3.4.5");
    form.append("risproPatientId", String(patientId));
    form.append("destinationPacsKey", "PACS_TEST");
    form.append("confirm", "true");
    const uploadResponse = await fetch(`${risproUrl}/api/pacs/remap/jobs/process-multipart`, { method: "POST", headers: { Cookie: `${env.cookieName}=${token}` }, body: form });
    const uploadPayload = await uploadResponse.json() as { job?: { id: number; status: string; processing_stage?: string; staged_storage_key?: string } };
    assert.equal(uploadResponse.status, 202);
    assert.equal(uploadPayload.job?.status, "uploaded");
    assert.equal(uploadPayload.job?.processing_stage, "queued");
    jobId = Number(uploadPayload.job?.id);
    assert.ok(jobId > 0);
    const stagedStorageKey = String(uploadPayload.job?.staged_storage_key || "");
    const stagedDirectory = path.join(stagingRoot, stagedStorageKey);
    const manifestPath = path.join(stagedDirectory, "manifest.json");
    assert.equal((await fs.readFile(manifestPath, "utf8")).includes("a.dcm"), true);

    const queued = await pool.query<{ status: string; processing_stage: string; staged_file_count: number }>(`select status, processing_stage, staged_file_count from dicom_remap_jobs where id = $1`, [jobId]);
    assert.deepEqual(queued.rows[0], { status: "uploaded", processing_stage: "queued", staged_file_count: 2 });

    const claimJob = await pool.query(`insert into dicom_remap_jobs (created_by_user_id, status, processing_stage) values ($1, 'uploaded', 'queued') returning id`, [claimUserId]);
    const claimId = Number(claimJob.rows[0].id);
    await pool.query(`update dicom_remap_jobs set status = 'processing', processing_stage = 'validating', processing_lease_owner = 'hold-main', processing_lease_expires_at = now() + interval '10 minutes' where id = $1`, [jobId]);
    const [claimA, claimB] = await Promise.all([
      (await import("./dicom-remap-service.js")).claimNextDicomRemapProcessingJob("claim-a", 120),
      (await import("./dicom-remap-service.js")).claimNextDicomRemapProcessingJob("claim-b", 120),
    ]);
    const winners = [claimA, claimB].filter(Boolean);
    assert.equal(winners.length, 1);
    assert.equal(Number(winners[0]!.job.id), claimId);
    const claimedRow = await pool.query<{ processing_lease_owner: string; processing_attempt_count: number }>(`select processing_lease_owner, processing_attempt_count from dicom_remap_jobs where id = $1`, [claimId]);
    assert.equal(Number(claimedRow.rows[0]?.processing_attempt_count), 1);
    assert.ok(["claim-a", "claim-b"].includes(claimedRow.rows[0]?.processing_lease_owner || ""));
    await pool.query(`update dicom_remap_jobs set status = 'processing', processing_stage = 'validating', processing_lease_owner = 'stopped-claim-worker', processing_lease_expires_at = now() - interval '1 second' where id = $1`, [claimId]);
    const recovered = await (await import("./dicom-remap-service.js")).claimNextDicomRemapProcessingJob("claim-recovered", 120);
    assert.equal(Number(recovered?.job.id), claimId);
    assert.equal(recovered?.recovered, true);
    await pool.query(`delete from dicom_remap_jobs where id = $1`, [claimId]);
    await pool.query(`update dicom_remap_jobs set status = 'uploaded', processing_stage = 'queued', processing_lease_owner = null, processing_lease_expires_at = null where id = $1`, [jobId]);

    fake.state.scenario.uploadFailureAfterAccepted = 1;
    fake.state.firstUploadPlanPath = path.join(stagedDirectory, "uid-plan.json");
    const firstRun = await runDicomRemapProcessingWorkerTick({ owner: "processing-a", batchSize: 1, leaseSeconds: 120 });
    assert.equal(firstRun.failed, 1);
    assert.equal(fake.state.firstUploadPlanExists, true);
    const failed = await pool.query<{ status: string; processing_error_code: string; processed_file_count: number }>(`select status, processing_error_code, processed_file_count from dicom_remap_jobs where id = $1`, [jobId]);
    assert.equal(failed.rows[0]?.status, "failed");
    assert.equal(failed.rows[0]?.processing_error_code, "DICOM_REMAP_ORTHANC_UPLOAD_FAILED");
    const uidPlan = JSON.parse(await fs.readFile(path.join(stagedDirectory, "uid-plan.json"), "utf8")) as Record<string, unknown>;
    const uidPlanText = JSON.stringify(uidPlan);
    assert.doesNotMatch(uidPlanText, /Patient|MRN|national|accession/i);

    fake.state.scenario.uploadFailureAfterAccepted = null;
    await pool.query(`update dicom_remap_jobs set status = 'processing', processing_stage = 'uploading_to_orthanc', processing_lease_owner = 'stopped-worker', processing_lease_expires_at = now() - interval '1 second', processing_error_code = null, processing_error_details = null where id = $1`, [jobId]);
    const retryRun = await runDicomRemapProcessingWorkerTick({ owner: "processing-b", batchSize: 1, leaseSeconds: 120 });
    assert.equal(retryRun.completed, 1);
    const completed = await pool.query<{ status: string; processing_stage: string; modified_orthanc_study_id: string; processed_file_count: number; orthanc_send_job_id: string }>(`select status, processing_stage, modified_orthanc_study_id, processed_file_count, orthanc_send_job_id from dicom_remap_jobs where id = $1`, [jobId]);
    assert.equal(completed.rows[0]?.status, "sending");
    assert.equal(completed.rows[0]?.processing_stage, "enqueueing_send");
    assert.equal(completed.rows[0]?.modified_orthanc_study_id, fake.state.studyId);
    assert.equal(Number(completed.rows[0]?.processed_file_count), 2);
    assert.equal(completed.rows[0]?.orthanc_send_job_id, "fake-send-1");
    assert.equal(fake.state.sendCount, 1);
    const replacementUids = fake.state.uploadRecords.filter((record) => record.body.length > 0).map((record) => parseDicom(record.body));
    assert.equal(new Set(replacementUids.map((value) => value.study)).size, 1);
    assert.equal(new Set(replacementUids.map((value) => value.sop)).size, 2);
    assert.equal(fake.state.uploaded.size, 2);

    await pool.query(`update dicom_remap_jobs set status = 'sent' where id = $1`, [jobId]);
    const handoffJob = await pool.query<{ id: number }>(`insert into dicom_remap_jobs (created_by_user_id, status, processing_stage, modified_orthanc_study_id, destination_pacs_key, replacement_patient_id, replacement_patient_name, replacement_patient_sex, replacement_patient_birth_date) values ($1, 'remapped', 'enqueueing_send', $2, 'PACS_TEST', $3, $4, 'M', null) returning id`, [userId, fake.state.studyId, nationalId, `Durable^Patient^${suffix}`]);
    const handoffId = Number(handoffJob.rows[0].id);
    const beforeHandoffUploadCount = fake.state.uploadRecords.length;
    const handoffRun = await runDicomRemapProcessingWorkerTick({ owner: "handoff-worker", batchSize: 1, leaseSeconds: 120 });
    assert.equal(handoffRun.completed, 1);
    assert.equal(fake.state.uploadRecords.length, beforeHandoffUploadCount);
    const handoffRow = await pool.query<{ status: string; orthanc_send_job_id: string }>(`select status, orthanc_send_job_id from dicom_remap_jobs where id = $1`, [handoffId]);
    assert.deepEqual(handoffRow.rows[0], { status: "sending", orthanc_send_job_id: "fake-send-1" });

    fake.state.scenario.sendMode = "missing-id";
    const ambiguousJob = await pool.query<{ id: number }>(`insert into dicom_remap_jobs (created_by_user_id, status, processing_stage, modified_orthanc_study_id, destination_pacs_key, replacement_patient_id, replacement_patient_name, replacement_patient_sex, replacement_patient_birth_date) values ($1, 'remapped', 'enqueueing_send', $2, 'PACS_TEST', $3, $4, 'M', null) returning id`, [claimUserId, fake.state.studyId, nationalId, `Durable^Patient^${suffix}`]);
    const ambiguousId = Number(ambiguousJob.rows[0].id);
    const ambiguousRun = await runDicomRemapProcessingWorkerTick({ owner: "ambiguous-handoff-worker", batchSize: 1, leaseSeconds: 120 });
    assert.equal(ambiguousRun.completed, 1);
    const ambiguousRow = await pool.query<{ status: string; send_error_code: string; orthanc_send_job_id: string | null }>(`select status, send_error_code, orthanc_send_job_id from dicom_remap_jobs where id = $1`, [ambiguousId]);
    assert.deepEqual(ambiguousRow.rows[0], { status: "sending", send_error_code: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS", orthanc_send_job_id: null });
    assert.equal(fake.state.sendCount, 3);
    fake.state.scenario.sendMode = "success";

    await pool.query(`delete from audit_log where entity_type = 'dicom_remap_job' and entity_id in ($1, $2, $3, $4)`, [jobId, handoffId, ambiguousId, claimId]);
    await pool.query(`delete from dicom_remap_jobs where id in ($1, $2, $3)`, [jobId, handoffId, ambiguousId]);
  } finally {
    __dicomRemapTestables.resetTestOverrides();
    __resetOrthancPacsFetchForTests();
    __resetOrthancPacsSettingsForTests();
    if (appServer) await new Promise<void>((resolve) => appServer!.close(() => resolve()));
    await fake.close();
    await pool.query(`delete from audit_log where changed_by_user_id = $1`, [userId]).catch(() => undefined);
    await pool.query(`delete from patients where id = $1`, [patientId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [claimUserId]).catch(() => undefined);
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
});

test("Orthanc verification failure matrix is sanitized, lease-safe, and never enqueues PACS", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const { pool } = await import("../db/pool.js");
  const { env } = await import("../config/env.js");
  const { createApp } = await import("../app.js");
  const { runDicomRemapProcessingWorkerTick } = await import("./dicom-remap-processing-worker.js");
  const { __dicomRemapTestables } = await import("./dicom-remap-service.js");
  const { __setOrthancPacsFetchForTests, __setOrthancPacsSettingsForTests, __resetOrthancPacsFetchForTests, __resetOrthancPacsSettingsForTests } = await import("./orthanc-pacs-service.js");
  const fake = await startFakeOrthanc();
  const suffix = uniqueSuffix();
  const username = `dicom_matrix_${suffix}`;
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const user = await pool.query<{ id: number }>(`insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, $3, 'supervisor', true) returning id`, [username, `DICOM Matrix ${suffix}`, passwordHash]);
  const userId = Number(user.rows[0]!.id);
  const nationalId = `${Date.now()}`.slice(-12);
  const patient = await pool.query<{ id: number }>(`insert into patients (national_id, identifier_type, identifier_value, arabic_full_name, english_full_name, normalized_arabic_name, age_years, estimated_date_of_birth, sex, phone_1, address, created_by_user_id, updated_by_user_id) values ($1::varchar, 'national_id', $1::text, $2, $3, $4, 35, '1991-01-01', 'M', '0912345678', 'Test', $5::bigint, $5::bigint) returning id`, [nationalId, `مريض ${suffix}`, `Durable^Patient^${suffix}`, `مريض${suffix}`, userId]);
  const patientId = Number(patient.rows[0]!.id);
  let appServer: http.Server | null = null;
  const jobIds: number[] = [];
  try {
    const fakeRequest = async (requestPath: string, options: { method?: string; body?: unknown } = {}) => {
      const body = Buffer.isBuffer(options.body) ? new Uint8Array(options.body) as unknown as BodyInit : options.body === undefined ? undefined : JSON.stringify(options.body);
      const response = await fetch(`${fake.url}${requestPath}`, { method: options.method || "GET", body, headers: options.body && !Buffer.isBuffer(options.body) ? { "Content-Type": "application/json" } : undefined });
      const text = await response.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: response.status, ok: response.ok, text, json };
    };
    __dicomRemapTestables.setOrthancFetchForTests(fakeRequest as never);
    __setOrthancPacsSettingsForTests({ enabled: false, shadowMode: false, connectionMode: "external", baseUrl: fake.url, username: "", password: "", timeoutSeconds: 5, verifyTls: false, sendOnlyWhenPatientEntersQueue: false, worklistTarget: "", strategyPreference: "put_first", mwlCompatibility: { enabledTags: [], extraTags: [] } } as never);
    __setOrthancPacsFetchForTests(fakeRequest as never);
    const app = createApp();
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const address = appServer.address();
    if (!address || typeof address === "string") throw new Error("RISpro test server did not bind.");
    const risproUrl = `http://127.0.0.1:${address.port}`;
    const token = jwt.sign({ sub: userId, role: "supervisor", username, fullName: `DICOM Matrix ${suffix}` }, env.jwtSecret);
    const sourceA = syntheticDicom("1.2.840.10008.1.2.3.4.5.11");
    const sourceB = syntheticDicom("1.2.840.10008.1.2.3.4.5.12");
    const scenarios: Array<{ name: string; scenario: FakeOrthancScenario; code: string }> = [
      { name: "wrong Study Instance UID", scenario: { returnedStudyUid: "1.2.3.999" }, code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED" },
      { name: "wrong replacement identity", scenario: { returnedPatientId: "WRONG-ID" }, code: "DICOM_REMAP_IDENTITY_VERIFICATION_FAILED" },
      { name: "missing instance", scenario: { reportedInstanceCount: 1 }, code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED" },
      { name: "extra instance", scenario: { reportedInstanceCount: 3 }, code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED" },
      { name: "multiple resulting studies", scenario: { parentStudyBySop: { "1.2.840.10008.1.2.3.4.5.11": "fake-study-a", "1.2.840.10008.1.2.3.4.5.12": "fake-study-b" } }, code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED" },
      { name: "statistics unavailable", scenario: { statisticsStatus: 500 }, code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED" },
      { name: "statistics malformed", scenario: { malformedStatistics: true }, code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED" },
    ];
    for (const scenarioCase of scenarios) {
      resetFakeOrthancState(fake.state, scenarioCase.scenario);
      const form = new FormData();
      form.append("files", new Blob([new Uint8Array(sourceA)], { type: "application/dicom" }), "matrix-a.dcm");
      form.append("files", new Blob([new Uint8Array(sourceB)], { type: "application/dicom" }), "matrix-b.dcm");
      form.append("selectedStudyInstanceUID", "1.2.840.10008.1.2.3.4.5");
      form.append("risproPatientId", String(patientId));
      form.append("destinationPacsKey", "PACS_TEST");
      form.append("confirm", "true");
      const upload = await fetch(`${risproUrl}/api/pacs/remap/jobs/process-multipart`, { method: "POST", headers: { Cookie: `${env.cookieName}=${token}` }, body: form });
      assert.equal(upload.status, 202, scenarioCase.name);
      const payload = await upload.json() as { job: { id: number; staged_storage_key: string } };
      const jobId = Number(payload.job.id);
      jobIds.push(jobId);
      const result = await runDicomRemapProcessingWorkerTick({ owner: `matrix-${scenarioCase.name}`, batchSize: 1, leaseSeconds: 120 });
      assert.equal(result.failed, 1, scenarioCase.name);
      const row = await pool.query<{ status: string; processing_stage: string; processing_error_code: string; processing_lease_owner: string | null; processing_lease_expires_at: string | null; modified_orthanc_study_id: string | null; orthanc_send_job_id: string | null; processing_error_details: unknown }>(`select status, processing_stage, processing_error_code, processing_lease_owner, processing_lease_expires_at, modified_orthanc_study_id, orthanc_send_job_id, processing_error_details from dicom_remap_jobs where id = $1`, [jobId]);
      assert.equal(row.rows[0]?.status, "failed", scenarioCase.name);
      assert.equal(row.rows[0]?.processing_stage, "failed", scenarioCase.name);
      assert.equal(row.rows[0]?.processing_error_code, scenarioCase.code, scenarioCase.name);
      assert.equal(row.rows[0]?.processing_lease_owner, null, scenarioCase.name);
      assert.equal(row.rows[0]?.processing_lease_expires_at, null, scenarioCase.name);
      assert.equal(row.rows[0]?.modified_orthanc_study_id, null, scenarioCase.name);
      assert.equal(row.rows[0]?.orthanc_send_job_id, null, scenarioCase.name);
      assert.equal(fake.state.sendCount, 0, scenarioCase.name);
      const diagnostics = JSON.stringify(row.rows[0]?.processing_error_details);
      assert.doesNotMatch(diagnostics, new RegExp(`${nationalId}|Durable\\^Patient|matrix-[ab]\\.dcm|${stagingRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), scenarioCase.name);
      const audit = await pool.query<{ old_values: unknown; new_values: unknown }>(`select old_values, new_values from audit_log where entity_type = 'dicom_remap_job' and entity_id = $1 and action_type = 'dicom_remap_processing_failed' order by id desc limit 1`, [jobId]);
      assert.doesNotMatch(JSON.stringify(audit.rows[0] || {}), new RegExp(`${nationalId}|Durable\\^Patient|matrix-[ab]\\.dcm|${stagingRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), scenarioCase.name);
      const resend = await fetch(`${risproUrl}/api/pacs/remap/jobs/${jobId}/resend`, { method: "POST", headers: { Cookie: `${env.cookieName}=${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirmDestinationChecked: true }) });
      assert.equal(resend.status, 409, `${scenarioCase.name} resend`);
      await fs.rm(path.join(stagingRoot, payload.job.staged_storage_key), { recursive: true, force: true });
      await pool.query(`delete from audit_log where entity_type = 'dicom_remap_job' and entity_id = $1`, [jobId]);
      await pool.query(`delete from dicom_remap_jobs where id = $1`, [jobId]);
    }
  } finally {
    __dicomRemapTestables.resetTestOverrides();
    __resetOrthancPacsFetchForTests();
    __resetOrthancPacsSettingsForTests();
    if (appServer) await new Promise<void>((resolve) => appServer!.close(() => resolve()));
    await fake.close();
    for (const jobId of jobIds) {
      await pool.query(`delete from audit_log where entity_type = 'dicom_remap_job' and entity_id = $1`, [jobId]).catch(() => undefined);
      await pool.query(`delete from dicom_remap_jobs where id = $1`, [jobId]).catch(() => undefined);
    }
    await pool.query(`delete from patients where id = $1`, [patientId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
  }
});

test("abrupt worker death leaves a reclaimable row and resumes partial Orthanc upload idempotently", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const { pool } = await import("../db/pool.js");
  const { env } = await import("../config/env.js");
  const { createApp } = await import("../app.js");
  const { runDicomRemapProcessingWorkerTick } = await import("./dicom-remap-processing-worker.js");
  const { __dicomRemapTestables } = await import("./dicom-remap-service.js");
  const { __setOrthancPacsFetchForTests, __setOrthancPacsSettingsForTests, __resetOrthancPacsFetchForTests, __resetOrthancPacsSettingsForTests } = await import("./orthanc-pacs-service.js");
  const fake = await startFakeOrthanc();
  const suffix = uniqueSuffix();
  const username = `dicom_crash_${suffix}`;
  const passwordHash = bcrypt.hashSync("test-pass", 10);
  const user = await pool.query<{ id: number }>(`insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, $3, 'supervisor', true) returning id`, [username, `DICOM Crash ${suffix}`, passwordHash]);
  const userId = Number(user.rows[0]!.id);
  const nationalId = `${Date.now()}`.slice(-12);
  const patient = await pool.query<{ id: number }>(`insert into patients (national_id, identifier_type, identifier_value, arabic_full_name, english_full_name, normalized_arabic_name, age_years, estimated_date_of_birth, sex, phone_1, address, created_by_user_id, updated_by_user_id) values ($1::varchar, 'national_id', $1::text, $2, $3, $4, 35, '1991-01-01', 'M', '0912345678', 'Test', $5::bigint, $5::bigint) returning id`, [nationalId, `مريض ${suffix}`, `Crash^Patient^${suffix}`, `مريض${suffix}`, userId]);
  const patientId = Number(patient.rows[0]!.id);
  let appServer: http.Server | null = null;
  const jobIds: number[] = [];
  try {
    const fakeRequest = async (requestPath: string, options: { method?: string; body?: unknown } = {}) => {
      const body = Buffer.isBuffer(options.body) ? new Uint8Array(options.body) as unknown as BodyInit : options.body === undefined ? undefined : JSON.stringify(options.body);
      const response = await fetch(`${fake.url}${requestPath}`, { method: options.method || "GET", body, headers: options.body && !Buffer.isBuffer(options.body) ? { "Content-Type": "application/json" } : undefined });
      const text = await response.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: response.status, ok: response.ok, text, json };
    };
    __dicomRemapTestables.setOrthancFetchForTests(fakeRequest as never);
    __setOrthancPacsSettingsForTests({ enabled: false, shadowMode: false, connectionMode: "external", baseUrl: fake.url, username: "", password: "", timeoutSeconds: 5, verifyTls: false, sendOnlyWhenPatientEntersQueue: false, worklistTarget: "", strategyPreference: "put_first", mwlCompatibility: { enabledTags: [], extraTags: [] } } as never);
    __setOrthancPacsFetchForTests(fakeRequest as never);
    const app = createApp();
    appServer = http.createServer(app);
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const address = appServer.address();
    if (!address || typeof address === "string") throw new Error("RISpro test server did not bind.");
    const risproUrl = `http://127.0.0.1:${address.port}`;
    const token = jwt.sign({ sub: userId, role: "supervisor", username, fullName: `DICOM Crash ${suffix}` }, env.jwtSecret);
    const stageJob = async (): Promise<{ id: number; key: string }> => {
      const form = new FormData();
      form.append("files", new Blob([new Uint8Array(syntheticDicom(`1.2.840.10008.1.2.3.4.5.21`))], { type: "application/dicom" }), "crash-a.dcm");
      form.append("files", new Blob([new Uint8Array(syntheticDicom(`1.2.840.10008.1.2.3.4.5.22`))], { type: "application/dicom" }), "crash-b.dcm");
      form.append("selectedStudyInstanceUID", "1.2.840.10008.1.2.3.4.5");
      form.append("risproPatientId", String(patientId));
      form.append("destinationPacsKey", "PACS_TEST");
      form.append("confirm", "true");
      const response = await fetch(`${risproUrl}/api/pacs/remap/jobs/process-multipart`, { method: "POST", headers: { Cookie: `${env.cookieName}=${token}` }, body: form });
      assert.equal(response.status, 202);
      const payload = await response.json() as { job: { id: number; staged_storage_key: string } };
      jobIds.push(Number(payload.job.id));
      return { id: Number(payload.job.id), key: payload.job.staged_storage_key };
    };
    const runCrash = async (mode: "matching" | "conflicting") => {
      resetFakeOrthancState(fake.state, { duplicateMode: "matching" });
      const staged = await stageJob();
      fake.state.firstUploadPlanPath = path.join(stagingRoot, staged.key, "uid-plan.json");
      const child = spawn(process.execPath, ["--import", "tsx", "src/services/dicom-remap-processing-crash-child.ts", "--orthanc-url", fake.url, "--owner", `crash-worker-${mode}`], { cwd: process.cwd(), env: { ...process.env, DICOM_REMAP_STAGING_DIR: stagingRoot }, stdio: ["ignore", "pipe", "pipe"] });
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        let stderr = "";
        child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
        child.once("close", () => { if (stderr && !child.killed) process.stderr.write(stderr); });
      });
      if (process.platform === "win32") {
        assert.notEqual(exit.code, 0, `${mode} child must die abruptly`);
        assert.equal(exit.signal, null);
      } else {
        assert.equal(exit.signal, "SIGKILL", `${mode} child must die abruptly`);
      }
      const crashed = await pool.query<{ status: string; processing_lease_owner: string | null; processing_error_code: string | null }>(`select status, processing_lease_owner, processing_error_code from dicom_remap_jobs where id = $1`, [staged.id]);
      assert.equal(crashed.rows[0]?.status, "processing");
      assert.equal(crashed.rows[0]?.processing_lease_owner, `crash-worker-${mode}`);
      assert.equal(crashed.rows[0]?.processing_error_code, null);
      assert.equal(fake.state.uploaded.size, 1);
      assert.equal(fake.state.firstUploadPlanExists, true);
      const firstUid = parseDicom(fake.state.uploaded.values().next().value as Buffer);
      const persistedPlan = JSON.parse(await fs.readFile(path.join(stagingRoot, staged.key, "uid-plan.json"), "utf8")) as Record<string, unknown>;
      assert.equal(typeof persistedPlan.studyInstanceUid, "string");
      assert.equal(fake.state.sendCount, 0);
      if (mode === "conflicting") {
        fake.state.scenario.duplicateMode = "conflicting";
        fake.state.uploaded.set(firstUid.sop, Buffer.from("conflicting-content"));
      }
      await pool.query(`update dicom_remap_jobs set processing_lease_expires_at = now() - interval '1 second' where id = $1`, [staged.id]);
      const recovered = await runDicomRemapProcessingWorkerTick({ owner: `crash-recovery-${mode}`, batchSize: 1, leaseSeconds: 120 });
      assert.equal(recovered.claimed, 1);
      const row = await pool.query<{ status: string; processing_attempt_count: number; processing_error_code: string | null; processing_lease_owner: string | null; modified_orthanc_study_id: string | null; orthanc_send_job_id: string | null }>(`select status, processing_attempt_count, processing_error_code, processing_lease_owner, modified_orthanc_study_id, orthanc_send_job_id from dicom_remap_jobs where id = $1`, [staged.id]);
      assert.equal(Number(row.rows[0]?.processing_attempt_count), 2);
      if (mode === "matching") {
        assert.equal(row.rows[0]?.status, "sending");
        assert.equal(row.rows[0]?.processing_error_code, null);
        assert.equal(row.rows[0]?.modified_orthanc_study_id, fake.state.studyId);
        assert.equal(row.rows[0]?.orthanc_send_job_id, "fake-send-1");
        assert.equal(fake.state.uploaded.size, 2);
        const recoveredUids = Array.from(fake.state.uploaded.values()).map((body) => parseDicom(body));
        assert.equal(new Set(recoveredUids.map((value) => value.study)).size, 1);
        assert.equal(new Set(recoveredUids.map((value) => value.series)).size, 1);
        assert.equal(recoveredUids.some((value) => value.study === firstUid.study && value.series === firstUid.series && value.sop === firstUid.sop), true);
        assert.equal(recoveredUids[0]?.study, persistedPlan.studyInstanceUid);
        assert.equal(fake.state.sendCount, 1);
      } else {
        assert.equal(row.rows[0]?.status, "failed");
        assert.equal(row.rows[0]?.processing_error_code, "DICOM_REMAP_ORTHANC_INSTANCE_CONFLICT");
        assert.equal(row.rows[0]?.processing_lease_owner, null);
        assert.equal(row.rows[0]?.modified_orthanc_study_id, null);
        assert.equal(row.rows[0]?.orthanc_send_job_id, null);
        assert.equal(fake.state.sendCount, 0);
      }
      if (mode === "matching") await pool.query(`update dicom_remap_jobs set status = 'sent' where id = $1`, [staged.id]);
      await fs.rm(path.join(stagingRoot, staged.key), { recursive: true, force: true });
    };
    await runCrash("matching");
    await runCrash("conflicting");
  } finally {
    __dicomRemapTestables.resetTestOverrides();
    __resetOrthancPacsFetchForTests();
    __resetOrthancPacsSettingsForTests();
    if (appServer) await new Promise<void>((resolve) => appServer!.close(() => resolve()));
    await fake.close();
    for (const jobId of jobIds) {
      await pool.query(`delete from audit_log where entity_type = 'dicom_remap_job' and entity_id = $1`, [jobId]).catch(() => undefined);
      await pool.query(`delete from dicom_remap_jobs where id = $1`, [jobId]).catch(() => undefined);
    }
    await pool.query(`delete from patients where id = $1`, [patientId]).catch(() => undefined);
    await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
  }
});
