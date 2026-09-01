import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import type { Request } from "express";
import { cleanupDicomRemapStagingStorage, cleanupDicomRemapUploadTempDir } from "../services/dicom-remap-service.js";
import { HttpError } from "../utils/http-error.js";
import { __pacsRouteTestables } from "./pacs.js";

const TEMP_PREFIX = "rispro-dicom-remap-";

async function listRemapTempDirs(): Promise<string[]> {
  const entries = await readdir(os.tmpdir(), { withFileTypes: true });
  return entries
    // Service tests use `rispro-dicom-remap-test-*`; only observe the exact
    // production route prefix so parallel test files cannot appear as leaks.
    .filter((entry) => entry.isDirectory() && new RegExp(`^${TEMP_PREFIX}[A-Za-z0-9]{6}$`).test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function multipartRequest(boundary: string): PassThrough & { headers: Record<string, string>; complete?: boolean } {
  const req = new PassThrough() as PassThrough & { headers: Record<string, string>; complete?: boolean };
  req.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };
  req.complete = false;
  return req;
}

async function waitForListener(stream: PassThrough, eventName: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (stream.listenerCount(eventName) > 0) {
      return;
    }
    await setImmediate();
  }
}

test("pacs remap multipart staging cleans temp files when client aborts", async () => {
  const before = await listRemapTempDirs();
  const req = multipartRequest("abort-boundary");
  const promise = __pacsRouteTestables.stageDicomRemapMultipartFiles(req as unknown as Request);

  await waitForListener(req, "aborted");
  req.emit("aborted");

  await assert.rejects(
    () => promise,
    /DICOM remap upload was interrupted\. Please start a new upload\./
  );

  const after = await listRemapTempDirs();
  assert.deepEqual(after, before);
});

test("active remap process-multipart bypasses the global Express JSON parser", async () => {
  const appSource = await readFile(new URL("../app.ts", import.meta.url), "utf8");
  assert.match(appSource, /const PACS_REMAP_PROCESS_MULTIPART_UPLOAD_PATH = "\/api\/pacs\/remap\/jobs\/process-multipart";/);
  assert.match(appSource, /req\.path === PACS_REMAP_PROCESS_MULTIPART_UPLOAD_PATH/);
  assert.match(appSource, /const PACS_REMAP_STAGE_MULTIPART_UPLOAD_PATH = "\/api\/pacs\/remap\/jobs\/stage-multipart";/);
  assert.match(appSource, /req\.path === PACS_REMAP_STAGE_MULTIPART_UPLOAD_PATH/);
  assert.match(appSource, /Let route-specific body parsers handle it\./);
});

test("comparison-only remap access is request, patient, and job scoped", async () => {
  const routeSource = await readFile(new URL("./pacs.ts", import.meta.url), "utf8");
  const comparisonScopeMiddleware = routeSource.slice(
    routeSource.indexOf('pacsRouter.use("/remap", async function requireComparisonRemapScope'),
    routeSource.indexOf("async function stageDicomRemapMultipartFiles")
  );
  assert.match(routeSource, /res\.locals\.comparisonRemapScope/);
  assert.match(routeSource, /Replacement patient must match the comparison request/);
  assert.match(routeSource, /assertDicomRemapJobComparisonAccess/);
  assert.match(routeSource, /Comparison-linked remap access is limited to this request/);
  assert.doesNotMatch(comparisonScopeMiddleware, /patient-search/);
});

test("DICOM Remap retention PACS settings remain supervisor re-auth protected", async () => {
  const routeSource = await readFile(new URL("./pacs.ts", import.meta.url), "utf8");
  assert.match(routeSource, /pacsRouter\.get\(\s*"\/dicom-remap-retention",\s*\.\.\.supervisorMiddleware/);
  assert.match(routeSource, /pacsRouter\.put\(\s*"\/dicom-remap-retention",\s*\.\.\.supervisorMiddleware/);
  assert.match(routeSource, /readDicomRemapRetentionSettings\(\)/);
  assert.match(routeSource, /saveDicomRemapRetentionSettings\(\{ sentSourceRetentionDays: body\.sentSourceRetentionDays/);
});

test("both full DICOM remap multipart parsers use the authoritative configured file limit", async () => {
  const routeSource = await readFile(new URL("./pacs.ts", import.meta.url), "utf8");
  assert.equal((routeSource.match(/files: DICOM_REMAP_STAGING_MAX_FILES/g) || []).length, 2);
  assert.doesNotMatch(routeSource, /limits:\s*\{\s*files:\s*5000/);
});

test("remap patient search keeps patient lookup within the remap authorization boundary", async () => {
  const routeSource = await readFile(new URL("./pacs.ts", import.meta.url), "utf8");
  const patientsRouteSource = await readFile(new URL("./patients.ts", import.meta.url), "utf8");

  assert.match(routeSource, /pacsRouter\.use\("\/remap", requireAuth, requirePacsRemapAccess\)/);
  assert.match(routeSource, /pacsRouter\.get\(\s*"\/remap\/patient-search",\s*\.\.\.authMiddleware/);
  assert.match(routeSource, /const patients = await searchPatients\(search\)/);
  assert.match(patientsRouteSource, /patientsRouter\.use\(requirePageAccess\("patients"\)\)/);
});

test("Recover Source stays inside authenticated remap access and streams a neutral ZIP attachment", async () => {
  const routeSource = await readFile(new URL("./pacs.ts", import.meta.url), "utf8");
  assert.match(routeSource, /pacsRouter\.get\(\s*"\/remap\/jobs\/:jobId\/recover-source",\s*\.\.\.authMiddleware/);
  assert.match(routeSource, /prepareDicomRemapSourceRecovery\(\{ jobId, currentUserId \}\)/);
  assert.match(routeSource, /Content-Type", "application\/zip"/);
  assert.match(routeSource, /dicom-remap-source-job-\$\{recovery\.jobId\}\.zip/);
  assert.match(routeSource, /if \(!res\.destroyed\) res\.destroy\(error\)/);
  assert.doesNotMatch(routeSource, /recover-source[\s\S]{0,900}staged_storage_key/);
});

test("remap history keeps the existing remap access boundary and validates shared-history scope", async () => {
  const routeSource = await readFile(new URL("./pacs.ts", import.meta.url), "utf8");
  assert.match(routeSource, /pacsRouter\.use\("\/remap", requireAuth, requirePacsRemapAccess\)/);
  assert.match(routeSource, /const scope = asOptionalString\(query\.scope\) \|\| "mine"/);
  assert.match(routeSource, /scope !== "mine" && scope !== "all"/);
  assert.match(routeSource, /listDicomRemapJobs\(\{[\s\S]{0,150}scope,/);
});

test("remap patient search input and response remain bounded to picker fields", () => {
  assert.equal(__pacsRouteTestables.normalizeRemapPatientSearch("  Ja  "), "Ja");
  assert.throws(
    () => __pacsRouteTestables.normalizeRemapPatientSearch("J"),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400
  );
  assert.throws(
    () => __pacsRouteTestables.normalizeRemapPatientSearch("x".repeat(201)),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400
  );

  const patients = Array.from({ length: 26 }, (_, index) => ({
    id: index + 1,
    arabic_full_name: `Arabic ${index + 1}`,
    english_full_name: `English ${index + 1}`,
    national_id: `N-${index + 1}`,
    mrn: `MRN-${index + 1}`,
    sex: "F",
    estimated_date_of_birth: "1990-01-02",
    phone_1: "should-not-leak",
    address: "should-not-leak",
  })) as never;
  const response = __pacsRouteTestables.toRemapPatientSearchPatients(patients);

  assert.equal(response.length, 25);
  assert.deepEqual(Object.keys(response[0]!).sort(), [
    "arabic_full_name",
    "date_of_birth",
    "english_full_name",
    "id",
    "mrn",
    "national_id",
    "sex",
  ]);
  assert.equal(response[0]!.date_of_birth, "1990-01-02");
});

test("fast durable multipart staging accepts source confirmation without patient or destination fields", async () => {
  const boundary = "fast-durable-boundary";
  const req = multipartRequest(boundary);
  const storageKey = `jobs/901-${randomUUID()}`;
  const directory = path.resolve("storage/dicom/remap-staging", storageKey);
  await mkdir(path.join(directory, "files"), { recursive: true, mode: 0o700 });
  const selectedStudyInstanceUID = "1.2.840.113619.2.55.3.604688433.1234.1456789012.1";
  const provisionalSourceIdentity = {
    studyInstanceUid: selectedStudyInstanceUID,
    patientId: "SOURCE",
    patientName: "Source^Patient",
    patientBirthDate: "19900101",
    patientSex: "M",
    modality: "CT",
    studyDate: "20260726",
  };
  const promise = __pacsRouteTestables.stageDicomRemapMultipartDurably(req as unknown as Request, {
    job: { id: 901 } as never,
    storageKey,
    directory,
  });

  await waitForListener(req, "close");
  req.complete = true;
  req.end([
    `--${boundary}`,
    'Content-Disposition: form-data; name="selectedStudyInstanceUID"',
    "",
    selectedStudyInstanceUID,
    `--${boundary}`,
    'Content-Disposition: form-data; name="provisionalSourceIdentity"',
    "",
    JSON.stringify(provisionalSourceIdentity),
    `--${boundary}`,
    'Content-Disposition: form-data; name="confirmSource"',
    "",
    "true",
    `--${boundary}`,
    'Content-Disposition: form-data; name="files"; filename="image.dcm"',
    "Content-Type: application/dicom",
    "",
    "DICOM",
    `--${boundary}--`,
    "",
  ].join("\r\n"));

  try {
    const staged = await promise;
    assert.equal(staged.files.length, 1);
    assert.equal(staged.selectedStudyInstanceUID, selectedStudyInstanceUID);
    assert.deepEqual(staged.provisionalSourceIdentity, provisionalSourceIdentity);
    assert.equal(staged.confirmSource, "true");
    assert.equal(staged.risproPatientId, null);
    assert.equal(staged.destinationPacsKey, null);
  } finally {
    await cleanupDicomRemapStagingStorage(storageKey);
  }
});

test("durable multipart staging preserves the upload error when failure persistence also fails", async () => {
  const req = multipartRequest("persistence-failure-boundary");
  const persistenceError = Object.assign(new Error("database failure with unsafe details"), { code: "42P08" });
  const logged: Array<{ type: string; jobId: number; databaseCode: string }> = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    const promise = __pacsRouteTestables.stageDicomRemapMultipartDurably(req as unknown as Request, {
      job: { id: 902 } as never,
      storageKey: "jobs/902-test",
      directory: path.resolve("storage/dicom/remap-staging/jobs/902-test"),
    }, {
      persistFailure: async () => { throw persistenceError; },
      logPersistenceFailure: (details) => logged.push(details),
    });

    await waitForListener(req, "aborted");
    req.emit("aborted");
    await assert.rejects(
      promise,
      (error: unknown) => error instanceof HttpError
        && error.statusCode === 400
        && error.message === "DICOM remap upload was interrupted. Please start a new upload."
    );
    await setImmediate();

    assert.deepEqual(unhandled, []);
    assert.deepEqual(logged, [{
      type: "dicom_remap_staging_failure_persistence_failed",
      jobId: 902,
      databaseCode: "42P08",
    }]);
    assert.equal(JSON.stringify(logged).includes("unsafe details"), false);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("pacs remap multipart staging keeps normal completed upload staged for service cleanup", async () => {
  const boundary = "normal-boundary";
  const req = multipartRequest(boundary);
  const promise = __pacsRouteTestables.stageDicomRemapMultipartFiles(req as unknown as Request);

  await waitForListener(req, "close");
  req.complete = true;
  req.end([
    `--${boundary}`,
    'Content-Disposition: form-data; name="files"; filename="image.dcm"',
    "Content-Type: application/dicom",
    "",
    "DICOM",
    `--${boundary}--`,
    "",
  ].join("\r\n"));

  const staged = await promise;
  try {
    assert.equal(staged.files.length, 1);
    assert.equal(staged.files[0]?.fileName, "image.dcm");
    assert.ok(staged.tempDir.includes(TEMP_PREFIX));
  } finally {
    await cleanupDicomRemapUploadTempDir(staged.tempDir);
  }
});

test("pacs remap preview multipart staging rejects missing files", async () => {
  const boundary = "preview-empty-boundary";
  const req = multipartRequest(boundary);
  const promise = __pacsRouteTestables.stageDicomRemapPreviewMultipartFiles(req as unknown as Request);

  await waitForListener(req, "close");
  req.complete = true;
  req.end([
    `--${boundary}`,
    'Content-Disposition: form-data; name="fileMetadata"',
    "",
    "[]",
    `--${boundary}--`,
    "",
  ].join("\r\n"));

  await assert.rejects(
    () => promise,
    /At least one DICOM preview file is required\./
  );
});

test("pacs remap preview multipart staging does not require confirm or remap fields", async () => {
  const boundary = "preview-normal-boundary";
  const req = multipartRequest(boundary);
  const promise = __pacsRouteTestables.stageDicomRemapPreviewMultipartFiles(req as unknown as Request);

  await waitForListener(req, "close");
  req.complete = true;
  req.end([
    `--${boundary}`,
    'Content-Disposition: form-data; name="fileMetadata"',
    "",
    JSON.stringify([{ fileName: "image.dcm", filePath: "CD/image.dcm", fileSize: 2048 }]),
    `--${boundary}`,
    'Content-Disposition: form-data; name="files"; filename="image.dcm"',
    "Content-Type: application/dicom",
    "",
    "DICOM",
    `--${boundary}--`,
    "",
  ].join("\r\n"));

  const staged = await promise;
  try {
    assert.equal(staged.files.length, 1);
    assert.equal(staged.files[0]?.originalFileName, "image.dcm");
    assert.equal(staged.files[0]?.originalFilePath, "CD/image.dcm");
    assert.equal(staged.files[0]?.originalFileSize, 2048);
  } finally {
    await cleanupDicomRemapUploadTempDir(staged.tempDir);
  }
});
