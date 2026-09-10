import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || "";
const runIntegration = process.env.BACKUP_V3_EPHEMERAL_INTEGRATION === "1" && !!TEST_DB_URL;

if (runIntegration) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET ||= "test-secret";
}

const maybeTest = runIntegration ? test : test.skip;

async function collectStream(stream: PassThrough): Promise<Buffer> {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>((resolve) => stream.on("end", resolve));
  return Buffer.concat(chunks);
}

function readZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    let compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    if (compressedSize === 0xffffffff) {
      const extra = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + extraLength);
      compressedSize = Number(extra.readBigUInt64LE(12));
    }
    const contentStart = offset + 30 + nameLength + extraLength;
    const contentEnd = contentStart + compressedSize;
    entries.set(name, zip.subarray(contentStart, contentEnd));
    offset = contentEnd;
  }
  return entries;
}

maybeTest("Backup V3 preserves HA table metadata while writing empty table data", async () => {
  const [{ pool }, { env }, { sha256Buffer }, { streamBackupV3Archive }] = await Promise.all([
    import("../db/pool.js"),
    import("../config/env.js"),
    import("./backup-v3-checksums.js"),
    import("./backup-v3-service.js"),
  ]);
  const originalUploadsDir = env.uploadsDir;
  const tempUploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-uploads-"));
  const content = Buffer.from(`temporary-ha-backup-secret-${crypto.randomUUID()}`);
  const digest = sha256Buffer(content);
  let documentId: number | null = null;
  try {
    env.uploadsDir = tempUploadsDir;
    const document = await pool.query<{ id: number }>(
      `insert into documents(document_type, original_filename, stored_path, mime_type, file_size, content_sha256, storage_location_type, source)
       values('appointment_request', $1, 'missing-from-storage', 'application/pdf', $2, $3, 'local_fallback', 'manual_upload')
       returning id`,
      [`backup-ha-${crypto.randomUUID()}.pdf`, content.length, digest],
    );
    documentId = Number(document.rows[0]!.id);
    await pool.query(
      `insert into document_ha_blobs(document_id, content, byte_size, content_sha256, retention_due_at)
       values($1, $2, $3, $4, now() + interval '48 hours')`,
      [documentId, content, content.length, digest],
    );
    assert.equal((await pool.query("select count(*)::int as count from document_ha_blobs where document_id=$1", [documentId])).rows[0]!.count, 1);

    const output = new PassThrough();
    const archivePromise = collectStream(output);
    const result = await streamBackupV3Archive({
      currentUserId: null,
      passphrase: "backup-passphrase",
      output,
      backupName: "ephemeral-test.rispro.zip",
      includePostgresDump: false,
    });
    const entries = readZipEntries(await archivePromise);
    const schema = JSON.parse(entries.get("database/schema.json")!.toString("utf8")) as {
      tables: Array<{ schema: string; name: string; archivePath: string; rowCount: number }>;
    };
    const haTable = schema.tables.find((table) => table.schema === "public" && table.name === "document_ha_blobs");
    assert.ok(haTable);
    assert.equal(haTable.rowCount, 0);
    assert.deepEqual(JSON.parse(entries.get(haTable.archivePath)!.toString("utf8")), []);
    assert.equal(entries.get("database/tables/public.document_ha_blobs.json")!.includes(content), false);
    assert.equal(result.manifest.database.tables.find((table) => table.name === "document_ha_blobs")?.rowCount, 0);
  } finally {
    if (documentId !== null) await pool.query("delete from documents where id=$1", [documentId]).catch(() => undefined);
    env.uploadsDir = originalUploadsDir;
    await fs.rm(tempUploadsDir, { recursive: true, force: true });
  }
});
