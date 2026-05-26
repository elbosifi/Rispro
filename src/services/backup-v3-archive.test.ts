import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { encryptBackupV3EnvPayload } from "./backup-v3-env.js";
import { sha256Buffer, sha256File } from "./backup-v3-checksums.js";
import { collectBackupV3StorageFiles } from "./backup-v3-file-collector.js";
import { setBackupV3DownloadHeaders } from "./backup-v3-http.js";
import { buildBackupV3Manifest } from "./backup-v3-manifest.js";
import { BackupV3ZipWriter } from "./backup-v3-zip-writer.js";
import type { BackupV3FileManifestEntry, BackupV3SchemaMetadata } from "./backup-v3-types.js";

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
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const contentStart = offset + 30 + nameLength + extraLength;
    const contentEnd = contentStart + compressedSize;
    entries.set(name, zip.subarray(contentStart, contentEnd));
    offset = contentEnd;
  }
  return entries;
}

const schemaMetadata: BackupV3SchemaMetadata = {
  schemas: ["public", "appointments_v2"],
  migrationVersion: "085_orthanc_mwl_queue_gate",
  tables: [
    {
      schema: "public",
      name: "users",
      archivePath: "database/tables/public.users.json",
      rowCount: 1,
      columns: [
        {
          name: "id",
          dataType: "bigint",
          udtName: "int8",
          isNullable: false,
          hasDefault: true,
          ordinalPosition: 1,
        },
      ],
    },
    {
      schema: "appointments_v2",
      name: "bookings",
      archivePath: "database/tables/appointments_v2.bookings.json",
      rowCount: 1,
      columns: [
        {
          name: "id",
          dataType: "bigint",
          udtName: "int8",
          isNullable: false,
          hasDefault: true,
          ordinalPosition: 1,
        },
      ],
    },
  ],
};

test("BackupV3ZipWriter emits v3 archive layout with manifest, schema, env, table, and storage entries", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-"));
  const storageFile = path.join(tempDir, "report.txt");
  await fs.writeFile(storageFile, "report");
  const digest = await sha256File(storageFile);
  const storageEntry: BackupV3FileManifestEntry = {
    archivePath: "storage/project/report.txt",
    rootId: "project-storage",
    relativePath: "report.txt",
    byteSize: digest.byteSize,
    sha256: digest.sha256,
    crc32: digest.crc32,
  };
  const manifest = buildBackupV3Manifest({
    appName: "rispro-reception",
    packageVersion: "0.1.0",
    gitCommit: "01de0b42",
    createdAt: "2026-05-26T00:00:00.000Z",
    initiatedByUserId: 1,
    database: schemaMetadata,
    storageRoots: [
      {
        id: "project-storage",
        kind: "project_storage",
        absolutePath: tempDir,
        archivePrefix: "storage/project",
        appOwned: true,
      },
    ],
    files: [storageEntry],
    envVariableNames: ["DATABASE_URL"],
  });
  const envBundle = encryptBackupV3EnvPayload(
    { createdAt: manifest.createdAt, variables: { DATABASE_URL: "postgres://example" } },
    "passphrase",
    (size) => Buffer.alloc(size, 1)
  );

  const output = new PassThrough();
  const zipPromise = collectStream(output);
  const writer = new BackupV3ZipWriter(output);
  await writer.addBuffer("manifest.json", Buffer.from(JSON.stringify(manifest)));
  await writer.addBuffer("config/env.enc.json", Buffer.from(JSON.stringify(envBundle)));
  await writer.addBuffer("database/schema.json", Buffer.from(JSON.stringify(schemaMetadata)));
  await writer.addBuffer("database/tables/public.users.json", Buffer.from(JSON.stringify([{ id: 1 }])));
  await writer.addBuffer("database/tables/appointments_v2.bookings.json", Buffer.from(JSON.stringify([{ id: 1 }])));
  await writer.addFile(storageEntry.archivePath, storageFile, storageEntry.byteSize, storageEntry.crc32!);
  await writer.finish();
  output.end();

  const entries = readZipEntries(await zipPromise);
  assert.ok(entries.has("manifest.json"));
  assert.ok(entries.has("config/env.enc.json"));
  assert.ok(entries.has("database/schema.json"));
  assert.ok(entries.has("database/tables/public.users.json"));
  assert.ok(entries.has("database/tables/appointments_v2.bookings.json"));
  assert.ok(entries.has("storage/project/report.txt"));

  const parsedManifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as { files: BackupV3FileManifestEntry[] };
  assert.equal(parsedManifest.files[0]?.sha256, sha256Buffer(entries.get("storage/project/report.txt")!));
  assert.equal(parsedManifest.files[0]?.byteSize, entries.get("storage/project/report.txt")!.length);
});

test("collectBackupV3StorageFiles enforces file count, single-file, and total-size limits", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-limits-"));
  await fs.writeFile(path.join(tempDir, "a.txt"), "aaaa");
  await fs.writeFile(path.join(tempDir, "b.txt"), "bbbb");

  const roots = [
    {
      id: "project-storage",
      kind: "project_storage" as const,
      absolutePath: tempDir,
      archivePrefix: "storage/project",
      appOwned: true as const,
    },
  ];

  await assert.rejects(
    () => collectBackupV3StorageFiles(roots, { maxFiles: 1, maxFileBytes: 10, maxTotalUncompressedBytes: 20 }),
    /too many files/
  );
  await assert.rejects(
    () => collectBackupV3StorageFiles(roots, { maxFiles: 10, maxFileBytes: 3, maxTotalUncompressedBytes: 20 }),
    /exceeds max file size/
  );
  await assert.rejects(
    () => collectBackupV3StorageFiles(roots, { maxFiles: 10, maxFileBytes: 10, maxTotalUncompressedBytes: 6 }),
    /exceeds max total uncompressed size/
  );
});

test("admin route source keeps v2 backup and adds separate v3 archive endpoint", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");

  assert.match(source, /"\/backup\/v3"/);
  assert.match(source, /\.rispro\.zip/);
  assert.match(source, /setBackupV3DownloadHeaders/);
  assert.match(source, /streamBackupV3Archive/);
  assert.match(source, /"\/backup",\s*\n\s*asyncRoute/);
  assert.match(source, /res\.json\(result\.backup\)/);
});

test("setBackupV3DownloadHeaders returns zip attachment headers with rispro zip filename", () => {
  const headers = new Map<string, string>();
  setBackupV3DownloadHeaders(
    {
      setHeader(name, value) {
        headers.set(name, value);
      },
    },
    "rispro-backup-test.rispro.zip"
  );

  assert.equal(headers.get("Content-Type"), "application/zip");
  assert.equal(headers.get("Content-Disposition"), 'attachment; filename="rispro-backup-test.rispro.zip"');
});
