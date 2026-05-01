import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readdir } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import os from "node:os";
import type { Request } from "express";
import { cleanupDicomRemapUploadTempDir } from "../services/dicom-remap-service.js";
import { __pacsRouteTestables } from "./pacs.js";

const TEMP_PREFIX = "rispro-dicom-remap-";

async function listRemapTempDirs(): Promise<string[]> {
  const entries = await readdir(os.tmpdir(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX))
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
