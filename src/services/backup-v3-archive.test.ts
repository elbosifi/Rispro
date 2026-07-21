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
import { createBackupV3PostgresCustomDump } from "./backup-v3-service.js";
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
    let compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    if (compressedSize === 0xffffffff) {
      const extra = zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + extraLength);
      assert.equal(extra.readUInt16LE(0), 0x0001);
      assert.ok(extra.readUInt16LE(2) >= 16);
      compressedSize = Number(extra.readBigUInt64LE(12));
    }
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

test("collectBackupV3StorageFiles excludes path-safe Backup V3 internals but keeps sibling application storage", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-storage-"));
  try {
    await fs.mkdir(path.join(storage, "uploads"), { recursive: true });
    await fs.mkdir(path.join(storage, "dicom", "worklist-source"), { recursive: true });
    await fs.mkdir(path.join(storage, "backups", "staging"), { recursive: true });
    await fs.mkdir(path.join(storage, "backups", "artifacts"), { recursive: true });
    await fs.mkdir(path.join(storage, "backups", "restore-verification", "scratch"), { recursive: true });
    await fs.mkdir(path.join(storage, "backups-other"), { recursive: true });
    await fs.writeFile(path.join(storage, "uploads", "patient.pdf"), "upload");
    await fs.writeFile(path.join(storage, "dicom", "worklist-source", "mwl.wl"), "worklist");
    await fs.writeFile(path.join(storage, "backups", "staging", ".current.part"), "part");
    await fs.writeFile(path.join(storage, "backups", "artifacts", "old.rispro.zip"), "archive");
    await fs.writeFile(path.join(storage, "backups", "restore-verification", "scratch", "result.txt"), "scratch");
    await fs.writeFile(path.join(storage, "backups-other", "keep.txt"), "sibling");
    const files = await collectBackupV3StorageFiles([{ id: "project-storage", kind: "project_storage", absolutePath: storage, archivePrefix: "storage/project", appOwned: true }], { maxFiles: 20, maxFileBytes: 100, maxTotalUncompressedBytes: 1_000 });
    const archivePaths = files.map((file) => file.archivePath);
    assert.ok(archivePaths.includes("storage/project/uploads/patient.pdf"));
    assert.ok(archivePaths.includes("storage/project/dicom/worklist-source/mwl.wl"));
    assert.ok(archivePaths.includes("storage/project/backups-other/keep.txt"));
    assert.equal(archivePaths.some((entry) => entry.includes("/backups/")), false);
  } finally {
    await fs.rm(storage, { recursive: true, force: true });
  }
});

test("admin route source keeps v2 backup and adds separate v3 archive endpoint", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");

  assert.match(source, /"\/backup\/v3"/);
  assert.match(source, /\.rispro\.zip/);
  assert.match(source, /setBackupV3DownloadHeaders/);
  assert.match(source, /streamBackupV3Archive/);
  assert.match(source, /"\/backup",[\s\S]*?requireAnyRole\(\["super_admin"\]\),[\s\S]*?asyncRoute/);
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

test("automated Backup V3 PostgreSQL dump uses process environment instead of credentials in arguments", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-pg-dump-"));
  const target = path.join(tempDir, "database.postgresql.dump");
  let receivedArgs: string[] = [];
  let receivedEnvironment: NodeJS.ProcessEnv | undefined;
  try {
    const result = await createBackupV3PostgresCustomDump(target, {
      async execFile(_command, args, options) {
        receivedArgs = args;
        receivedEnvironment = options.env;
        await fs.writeFile(target, "PGDMP custom-format fixture");
      },
    });
    assert.deepEqual(receivedArgs, ["-Fc", "--file", target]);
    assert.ok(receivedEnvironment?.PGHOST);
    assert.ok(receivedEnvironment?.PGDATABASE);
    assert.ok(receivedEnvironment?.PGPASSWORD);
    assert.equal(receivedArgs.some((arg) => arg.includes(receivedEnvironment?.PGPASSWORD || "")), false);
    assert.ok(result.byteSize > 0);
    assert.equal(result.sha256, (await sha256File(target)).sha256);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("automated Backup V3 PostgreSQL dump fails clearly when pg_dump does not produce an archive", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-pg-dump-"));
  try {
    await assert.rejects(
      () => createBackupV3PostgresCustomDump(path.join(tempDir, "missing.dump"), { async execFile() {} }),
      /PostgreSQL custom dump failed/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
