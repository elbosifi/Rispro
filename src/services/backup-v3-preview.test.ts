import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { encryptBackupV3EnvPayload, decryptBackupV3EnvPayload } from "./backup-v3-env.js";
import { buildBackupV3Manifest } from "./backup-v3-manifest.js";
import { extractStoredBackupV3ZipToStaging } from "./backup-v3-zip-reader.js";
import { BackupV3ZipWriter } from "./backup-v3-zip-writer.js";
import type { BackupV3SchemaMetadata } from "./backup-v3-types.js";

async function collectStream(stream: PassThrough): Promise<Buffer> {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>((resolve) => stream.on("end", resolve));
  return Buffer.concat(chunks);
}

async function writeZip(entries: Array<{ name: string; content: string }>): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-preview-zip-"));
  const archivePath = path.join(tempDir, "backup.rispro.zip");
  const output = new PassThrough();
  const zipPromise = collectStream(output);
  const writer = new BackupV3ZipWriter(output);
  for (const entry of entries) {
    await writer.addBuffer(entry.name, Buffer.from(entry.content));
  }
  await writer.finish();
  output.end();
  await fs.writeFile(archivePath, await zipPromise);
  return archivePath;
}

const schema: BackupV3SchemaMetadata = {
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
  ],
};

test("extractStoredBackupV3ZipToStaging extracts valid archive entries to temp staging", async () => {
  const archivePath = await writeZip([
    { name: "database/schema.json", content: JSON.stringify(schema) },
    { name: "database/tables/public.users.json", content: "[{\"id\":1}]" },
    {
      name: "config/env.enc.json",
      content: JSON.stringify(encryptBackupV3EnvPayload({ createdAt: "now", variables: { DATABASE_URL: "x" } }, "passphrase")),
    },
    {
      name: "manifest.json",
      content: JSON.stringify(buildBackupV3Manifest({
        appName: "rispro-reception",
        packageVersion: "0.1.0",
        gitCommit: null,
        createdAt: "2026-05-26T00:00:00.000Z",
        initiatedByUserId: null,
        database: schema,
        storageRoots: [],
        archiveEntries: [],
        files: [],
        envVariableNames: ["DATABASE_URL"],
      })),
    },
  ]);
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-preview-stage-"));

  const entries = await extractStoredBackupV3ZipToStaging(archivePath, stagingDir, {
    maxFiles: 10,
    maxFileBytes: 100_000,
    maxTotalUncompressedBytes: 100_000,
  });

  assert.ok(entries.some((entry) => entry.path === "manifest.json"));
  assert.match(await fs.readFile(path.join(stagingDir, "database/schema.json"), "utf8"), /public/);
});

test("extractStoredBackupV3ZipToStaging rejects hostile archive paths before trust", async () => {
  const archivePath = await writeZip([{ name: "../escape.txt", content: "nope" }]);
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-preview-stage-"));

  await assert.rejects(
    () => extractStoredBackupV3ZipToStaging(archivePath, stagingDir, {
      maxFiles: 10,
      maxFileBytes: 100_000,
      maxTotalUncompressedBytes: 100_000,
    }),
    /path traversal/
  );
  assert.deepEqual(await fs.readdir(stagingDir).catch(() => []), []);
});

test("decryptBackupV3EnvPayload validates the backup passphrase", () => {
  const bundle = encryptBackupV3EnvPayload({ createdAt: "now", variables: { DATABASE_URL: "x" } }, "right-pass");

  assert.throws(() => decryptBackupV3EnvPayload(bundle, "wrong-pass"));
  assert.equal(decryptBackupV3EnvPayload(bundle, "right-pass").variables.DATABASE_URL, "x");
});

test("admin route source adds v3 multipart preview without changing v2 restore", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");
  const uploadSource = await fs.readFile(path.join(process.cwd(), "src/services/backup-v3-upload.ts"), "utf8");

  assert.match(source, /"\/restore\/v3\/preview"/);
  assert.match(uploadSource, /Busboy/);
  assert.match(source, /previewBackupV3RestoreFromArchive/);
  assert.match(source, /"\/restore\/preview",\s*\n\s*express\.json/);
});
