import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import test from "node:test";
import { BackupV3ZipWriter } from "./backup-v3-zip-writer.js";
import { extractStoredBackupV3ZipToStaging } from "./backup-v3-zip-reader.js";

test("Backup V3 ZIP writer emits ZIP64 metadata and reader extracts stored entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-zip64-"));
  const archivePath = path.join(root, "backup.rispro.zip");
  const stagingPath = path.join(root, "staging");
  try {
    const output = createWriteStream(archivePath, { flags: "wx" });
    const writer = new BackupV3ZipWriter(output);
    await writer.addBuffer("manifest.json", Buffer.from('{"formatVersion":3}'));
    await writer.finish();
    await new Promise<void>((resolve, reject) => { output.on("finish", resolve); output.on("error", reject); output.end(); });
    const content = await fs.readFile(archivePath);
    assert.notEqual(content.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])), -1, "ZIP64 end-of-central-directory record is present");
    const entries = await extractStoredBackupV3ZipToStaging(archivePath, stagingPath, { maxFiles: 100_000, maxFileBytes: 8 * 1024 ** 3, maxTotalUncompressedBytes: 16 * 1024 ** 3 });
    assert.deepEqual(entries.map((entry) => entry.path), ["manifest.json"]);
    assert.equal(await fs.readFile(path.join(stagingPath, "manifest.json"), "utf8"), '{"formatVersion":3}');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
