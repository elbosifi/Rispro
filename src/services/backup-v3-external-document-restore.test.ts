import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256File } from "./backup-v3-checksums.js";
import {
  BackupV3ExternalDocumentPartialFailureError,
  restoreBackupV3ExternalDocumentsOnly,
} from "./backup-v3-external-document-restore.js";
import { validateBackupV3ArchiveEntries } from "./backup-v3-validators.js";
import type { BackupV3Manifest, BackupV3SafetyBackupMethod, BackupV3StorageRoot } from "./backup-v3-types.js";
import type { BackupV3SafetyMetadata } from "./backup-v3-safety-service.js";

function safetyMetadata(tempDir: string): BackupV3SafetyMetadata {
  return {
    timestamp: "2026-05-27T00-00-00-000Z",
    initiatingUserId: 1,
    uploadedArchiveName: "backup.rispro.zip",
    uploadedArchiveSha256: "abc",
    dbSafetyMethod: "v3_snapshot" as BackupV3SafetyBackupMethod,
    dbSafetyPath: path.join(tempDir, "db.rispro.zip"),
    envSafetyPath: path.join(tempDir, ".env.pre-restore"),
    storageSafetyRoot: path.join(tempDir, "storage-safety"),
    storageSafetyPaths: [path.join(tempDir, "storage-safety", "documents")],
    metadataPath: path.join(tempDir, "metadata.json"),
  };
}

function root(id: string, kind: BackupV3StorageRoot["kind"], absolutePath: string, archivePrefix: string): BackupV3StorageRoot {
  return { id, kind, absolutePath, archivePrefix, appOwned: true };
}

function digestFor(content: string): { byteSize: number; sha256: string } {
  return {
    byteSize: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function makeManifest(
  tempDir: string,
  entries: Array<{
    root: BackupV3StorageRoot;
    relativePath: string;
    content: string;
    archivePath?: string;
    skipStagedWrite?: boolean;
  }>
): Promise<{ manifest: BackupV3Manifest; stagingDir: string }> {
  const stagingDir = path.join(tempDir, "staged");
  const storageRoots = [...new Map(entries.map((entry) => [entry.root.id, entry.root])).values()];
  const files = [];

  for (const entry of entries) {
    const archivePath = entry.archivePath || `${entry.root.archivePrefix}/${entry.relativePath.replace(/\\/g, "/")}`;
    let digest = digestFor(entry.content);
    if (!entry.skipStagedWrite) {
      const fullPath = path.join(stagingDir, archivePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, entry.content);
      digest = await sha256File(fullPath);
    }
    files.push({
      archivePath,
      rootId: entry.root.id,
      relativePath: entry.relativePath,
      byteSize: digest.byteSize,
      sha256: digest.sha256,
      crc32: 0,
    });
  }

  return {
    stagingDir,
    manifest: {
      formatVersion: 3,
      app: { name: "rispro-reception", packageVersion: "0.1.0", gitCommit: null },
      createdAt: "2026-05-27T00:00:00.000Z",
      initiatedByUserId: null,
      database: { schemas: ["public"], migrationVersion: null, tables: [] },
      storageRoots,
      archiveEntries: [],
      files,
      env: { archivePath: "config/env.enc.json", variableNames: [] },
      safetyBackup: { preferredMethod: "pg_dump_custom", fallbackMethod: "v3_snapshot" },
      limits: { maxFiles: 60000, maxFileBytes: 1000, maxTotalUncompressedBytes: 1000 },
    },
  };
}

test("restoreBackupV3ExternalDocumentsOnly restores allowlisted external documents and preserves unrelated files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-doc-restore-"));
  const docRoot = root("external-documents", "document_storage", path.join(tempDir, "documents"), "documents/external");
  await fs.mkdir(docRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(docRoot.absolutePath, "unrelated.txt"), "keep");
  const prepared = await makeManifest(tempDir, [
    { root: docRoot, relativePath: "patient/a.pdf", content: "new-document" },
  ]);

  const result = await restoreBackupV3ExternalDocumentsOnly({
    manifest: prepared.manifest,
    stagingDir: prepared.stagingDir,
    approvedDocumentRoots: [docRoot],
    safetyBackupsCreated: safetyMetadata(tempDir),
  });

  assert.equal(result.externalDocumentsRestored, true);
  assert.equal(result.dbRestored, false);
  assert.equal(result.storageRestored, false);
  assert.equal(result.envRestored, false);
  assert.equal(result.restoreIncomplete, true);
  assert.equal(await fs.readFile(path.join(docRoot.absolutePath, "patient", "a.pdf"), "utf8"), "new-document");
  assert.equal(await fs.readFile(path.join(docRoot.absolutePath, "unrelated.txt"), "utf8"), "keep");
});

test("unknown and non-allowlisted document roots are rejected before writes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-doc-restore-"));
  const docRoot = root("external-documents", "document_storage", path.join(tempDir, "documents"), "documents/external");
  const otherRoot = root("other-documents", "document_storage", path.join(tempDir, "other"), "documents/other");
  await fs.mkdir(docRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(docRoot.absolutePath, "existing.txt"), "existing");

  const unknown = await makeManifest(tempDir, [{ root: docRoot, relativePath: "new.txt", content: "new" }]);
  unknown.manifest.files[0]!.rootId = "missing-root";
  await assert.rejects(
    () => restoreBackupV3ExternalDocumentsOnly({
      manifest: unknown.manifest,
      stagingDir: unknown.stagingDir,
      approvedDocumentRoots: [docRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /unknown document root/
  );

  const nonAllowlisted = await makeManifest(tempDir, [{ root: docRoot, relativePath: "new.txt", content: "new" }]);
  await assert.rejects(
    () => restoreBackupV3ExternalDocumentsOnly({
      manifest: nonAllowlisted.manifest,
      stagingDir: nonAllowlisted.stagingDir,
      approvedDocumentRoots: [otherRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /not approved/
  );
  assert.equal(await fs.readFile(path.join(docRoot.absolutePath, "existing.txt"), "utf8"), "existing");
});

test("unsafe external document paths are rejected", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-doc-restore-"));
  const docRoot = root("external-documents", "document_storage", path.join(tempDir, "documents"), "documents/external");
  const cases = ["../escape.pdf", "/absolute.pdf", "C:\\windows.pdf", "\\\\server\\share\\doc.pdf"];

  for (const unsafePath of cases) {
    const prepared = await makeManifest(tempDir, [
      { root: docRoot, relativePath: unsafePath, content: "new", skipStagedWrite: true },
    ]);
    await assert.rejects(
      () => restoreBackupV3ExternalDocumentsOnly({
        manifest: prepared.manifest,
        stagingDir: prepared.stagingDir,
        approvedDocumentRoots: [docRoot],
        safetyBackupsCreated: safetyMetadata(tempDir),
      }),
      /Unsafe external document path/
    );
  }
});

test("checksum mismatch and missing staged file prevent document writes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-doc-restore-"));
  const docRoot = root("external-documents", "document_storage", path.join(tempDir, "documents"), "documents/external");
  await fs.mkdir(docRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(docRoot.absolutePath, "doc.txt"), "old");
  const prepared = await makeManifest(tempDir, [{ root: docRoot, relativePath: "doc.txt", content: "new" }]);

  prepared.manifest.files[0]!.sha256 = "0".repeat(64);
  await assert.rejects(
    () => restoreBackupV3ExternalDocumentsOnly({
      manifest: prepared.manifest,
      stagingDir: prepared.stagingDir,
      approvedDocumentRoots: [docRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /checksum or size mismatch/
  );
  assert.equal(await fs.readFile(path.join(docRoot.absolutePath, "doc.txt"), "utf8"), "old");

  const missing = await makeManifest(tempDir, [{ root: docRoot, relativePath: "doc.txt", content: "new" }]);
  await fs.rm(path.join(missing.stagingDir, missing.manifest.files[0]!.archivePath));
  await assert.rejects(
    () => restoreBackupV3ExternalDocumentsOnly({
      manifest: missing.manifest,
      stagingDir: missing.stagingDir,
      approvedDocumentRoots: [docRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /ENOENT/
  );
  assert.equal(await fs.readFile(path.join(docRoot.absolutePath, "doc.txt"), "utf8"), "old");
});

test("existing target is replaced only after validation passes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-doc-restore-"));
  const docRoot = root("external-documents", "document_storage", path.join(tempDir, "documents"), "documents/external");
  await fs.mkdir(docRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(docRoot.absolutePath, "doc.txt"), "old");
  const prepared = await makeManifest(tempDir, [{ root: docRoot, relativePath: "doc.txt", content: "new" }]);

  await restoreBackupV3ExternalDocumentsOnly({
    manifest: prepared.manifest,
    stagingDir: prepared.stagingDir,
    approvedDocumentRoots: [docRoot],
    safetyBackupsCreated: safetyMetadata(tempDir),
  });

  assert.equal(await fs.readFile(path.join(docRoot.absolutePath, "doc.txt"), "utf8"), "new");
});

test("app-owned storage roots, Orthanc-looking roots, and .env are not touched", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-doc-restore-"));
  const appRoot = root("project-storage", "project_storage", path.join(tempDir, "storage"), "storage/project");
  const orthancRoot = root("orthanc-documents", "document_storage", path.join(tempDir, "orthanc"), "documents/orthanc");
  const docRoot = root("external-documents", "document_storage", path.join(tempDir, "documents"), "documents/external");
  const envPath = path.join(tempDir, ".env");
  await fs.mkdir(appRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(appRoot.absolutePath, "file.txt"), "app-owned");
  await fs.writeFile(envPath, "DATABASE_URL=unchanged");

  const appPrepared = await makeManifest(tempDir, [{ root: appRoot, relativePath: "file.txt", content: "new" }]);
  const appResult = await restoreBackupV3ExternalDocumentsOnly({
    manifest: appPrepared.manifest,
    stagingDir: appPrepared.stagingDir,
    approvedDocumentRoots: [docRoot],
    safetyBackupsCreated: safetyMetadata(tempDir),
  });
  assert.deepEqual(appResult.filesRestored, []);
  assert.equal(await fs.readFile(path.join(appRoot.absolutePath, "file.txt"), "utf8"), "app-owned");
  assert.equal(await fs.readFile(envPath, "utf8"), "DATABASE_URL=unchanged");

  const orthanc = await makeManifest(tempDir, [{ root: orthancRoot, relativePath: "image.dcm", content: "nope" }]);
  await assert.rejects(
    () => restoreBackupV3ExternalDocumentsOnly({
      manifest: orthanc.manifest,
      stagingDir: orthanc.stagingDir,
      approvedDocumentRoots: [orthancRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /Orthanc/
  );
});

test("symlink-like archive entries are rejected before external document restore staging", () => {
  const errors = validateBackupV3ArchiveEntries(
    [{ path: "documents/external/link", type: "symlink", uncompressedSize: 0 }],
    { maxFiles: 10, maxFileBytes: 100, maxTotalUncompressedBytes: 100 }
  );
  assert.match(errors.join("\n"), /not allowed/);
});

test("partial failure reports restored and failed files with safety metadata", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-doc-restore-"));
  const docRoot = root("external-documents", "document_storage", path.join(tempDir, "documents"), "documents/external");
  const prepared = await makeManifest(tempDir, [
    { root: docRoot, relativePath: "one.txt", content: "one" },
    { root: docRoot, relativePath: "two.txt", content: "two" },
  ]);
  const safety = safetyMetadata(tempDir);

  await assert.rejects(
    () => restoreBackupV3ExternalDocumentsOnly({
      manifest: prepared.manifest,
      stagingDir: prepared.stagingDir,
      approvedDocumentRoots: [docRoot],
      safetyBackupsCreated: safety,
      failAfterWrites: 1,
    }),
    (error: unknown) => {
      assert.ok(error instanceof BackupV3ExternalDocumentPartialFailureError);
      assert.equal(error.result.partialFailure, true);
      assert.equal(error.result.filesRestored.length, 1);
      assert.equal(error.result.filesFailed.length, 1);
      assert.equal(error.result.safetyBackupsCreated.storageSafetyRoot, safety.storageSafetyRoot);
      return true;
    }
  );
  assert.equal(await fs.readFile(path.join(docRoot.absolutePath, "one.txt"), "utf8"), "one");
  await assert.rejects(() => fs.access(path.join(docRoot.absolutePath, "two.txt")));
});

test("failure before write leaves existing file unchanged", async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-doc-restore-"));
  const docRoot = root("external-documents", "document_storage", path.join(tempDir, "documents"), "documents/external");
  await fs.mkdir(path.join(docRoot.absolutePath, "linked"), { recursive: true });
  await fs.writeFile(path.join(docRoot.absolutePath, "linked", "doc.txt"), "old");
  const prepared = await makeManifest(tempDir, [{ root: docRoot, relativePath: "linked/doc.txt", content: "new" }]);
  await fs.rm(path.join(docRoot.absolutePath, "linked"), { recursive: true, force: true });
  try {
    await fs.symlink(tempDir, path.join(docRoot.absolutePath, "linked"), "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Symlink creation is not permitted on this Windows account");
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => restoreBackupV3ExternalDocumentsOnly({
      manifest: prepared.manifest,
      stagingDir: prepared.stagingDir,
      approvedDocumentRoots: [docRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /symlink/
  );
  assert.equal(await fs.readFile(path.join(tempDir, "doc.txt"), "utf8").catch(() => "missing"), "missing");
});

test("v2 restore route remains JSON-based and unchanged", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");
    assert.match(source, /"\/restore",[\s\S]*express\.json\(\{ limit: "500mb" \}\)/);
  assert.match(source, /restoreBackupSnapshot\(body\.backup, req\.user!\.sub, body\.passphrase, body\.confirmation\)/);
});
