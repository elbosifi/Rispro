import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256File } from "./backup-v3-checksums.js";
import { copyBackupV3ToLocalDestination, testBackupV3LocalDestination } from "./backup-v3-local-destination.js";

test("local Backup V3 destination copies through a temporary name and verifies checksum", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-local-destination-"));
  const source = path.join(root, "source.rispro.zip");
  await fs.writeFile(source, "encrypted archive content");
  const digest = await sha256File(source);
  try {
    const connectivity = await testBackupV3LocalDestination(root);
    assert.ok(connectivity.freeBytes === null || connectivity.freeBytes > 0);
    const copy = await copyBackupV3ToLocalDestination({ sourcePath: source, archiveName: "backup.rispro.zip", rootPath: root, expectedSha256: digest.sha256, expectedByteSize: digest.byteSize });
    assert.equal(copy.sha256, digest.sha256);
    assert.equal(await fs.readFile(path.join(root, "backup.rispro.zip"), "utf8"), "encrypted archive content");
    assert.equal((await fs.readdir(root)).some((name) => name.endsWith(".partial")), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("local Backup V3 destination rejects traversal filenames before writing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-local-destination-"));
  const source = path.join(root, "source.rispro.zip");
  await fs.writeFile(source, "content");
  const digest = await sha256File(source);
  try {
    await assert.rejects(
      () => copyBackupV3ToLocalDestination({ sourcePath: source, archiveName: "../escape.rispro.zip", rootPath: root, expectedSha256: digest.sha256, expectedByteSize: digest.byteSize }),
      /unsafe/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
