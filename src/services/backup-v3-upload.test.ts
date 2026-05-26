import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readdir } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import os from "node:os";
import type { Request } from "express";
import { cleanupBackupV3StagedUpload, stageBackupV3MultipartUpload } from "./backup-v3-upload.js";

const TEMP_PREFIX = "rispro-restore-v3-test-";

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

async function listTempDirs(): Promise<string[]> {
  const entries = await readdir(os.tmpdir(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX))
    .map((entry) => entry.name)
    .sort();
}

test("stageBackupV3MultipartUpload stages accepted archive fields without buffering", async () => {
  const boundary = "backup-v3-normal";
  const req = multipartRequest(boundary);
  const promise = stageBackupV3MultipartUpload(req as unknown as Request, TEMP_PREFIX);

  await waitForListener(req, "close");
  req.complete = true;
  req.end([
    `--${boundary}`,
    'Content-Disposition: form-data; name="passphrase"',
    "",
    "passphrase",
    `--${boundary}`,
    'Content-Disposition: form-data; name="confirmation"',
    "",
    "RESTORE RISPRO",
    `--${boundary}`,
    'Content-Disposition: form-data; name="backup"; filename="backup.rispro.zip"',
    "Content-Type: application/zip",
    "",
    "ZIP",
    `--${boundary}--`,
    "",
  ].join("\r\n"));

  const staged = await promise;
  try {
    assert.equal(staged.passphrase, "passphrase");
    assert.equal(staged.confirmation, "RESTORE RISPRO");
    assert.equal(staged.archiveFileName, "backup.rispro.zip");
    assert.ok(staged.archiveSize > 0);
  } finally {
    await cleanupBackupV3StagedUpload(staged);
    req.destroy();
  }
});

test("stageBackupV3MultipartUpload rejects unexpected file fields and cleans temp files", async () => {
  const before = await listTempDirs();
  const boundary = "backup-v3-bad-field";
  const req = multipartRequest(boundary);
  const promise = stageBackupV3MultipartUpload(req as unknown as Request, TEMP_PREFIX);

  await waitForListener(req, "close");
  req.complete = true;
  req.end([
    `--${boundary}`,
    'Content-Disposition: form-data; name="evil"; filename="backup.rispro.zip"',
    "Content-Type: application/zip",
    "",
    "ZIP",
    `--${boundary}--`,
    "",
  ].join("\r\n"));

  await assert.rejects(() => promise, /Unexpected backup archive field/);
  req.destroy();
  assert.deepEqual(await listTempDirs(), before);
});

test("stageBackupV3MultipartUpload cleans temp files when client disconnects", async () => {
  const before = await listTempDirs();
  const req = multipartRequest("backup-v3-abort");
  const promise = stageBackupV3MultipartUpload(req as unknown as Request, TEMP_PREFIX);

  await waitForListener(req, "aborted");
  req.emit("aborted");
  req.end();

  await assert.rejects(() => promise, /Backup restore upload was interrupted|Unexpected end of form/);
  req.destroy();
  assert.deepEqual(await listTempDirs(), before);
});
