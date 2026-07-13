import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readFile, readdir } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import os from "node:os";
import type { Request } from "express";
import { cleanupDicomRemapUploadTempDir } from "../services/dicom-remap-service.js";
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
  assert.match(appSource, /Let route-specific body parsers handle it\./);
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
