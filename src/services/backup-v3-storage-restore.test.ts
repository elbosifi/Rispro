import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256File } from "./backup-v3-checksums.js";
import {
  BackupV3StoragePartialFailureError,
  restoreBackupV3AppOwnedStorageOnly,
} from "./backup-v3-storage-restore.js";
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
    storageSafetyPaths: [path.join(tempDir, "storage-safety", "project-storage")],
    metadataPath: path.join(tempDir, "metadata.json"),
  };
}

function root(id: string, kind: BackupV3StorageRoot["kind"], absolutePath: string, archivePrefix: string): BackupV3StorageRoot {
  return { id, kind, absolutePath, archivePrefix, appOwned: true };
}

async function makeManifest(
  tempDir: string,
  entries: Array<{ root: BackupV3StorageRoot; relativePath: string; content: string }>
): Promise<{ manifest: BackupV3Manifest; stagingDir: string; currentRoots: BackupV3StorageRoot[] }> {
  const stagingDir = path.join(tempDir, "staged");
  const storageRoots = [...new Map(entries.map((entry) => [entry.root.id, entry.root])).values()];
  const files = [];
  for (const entry of entries) {
    const archivePath = `${entry.root.archivePrefix}/${entry.relativePath.replace(/\\/g, "/")}`;
    const fullPath = path.join(stagingDir, archivePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, entry.content);
    const digest = await sha256File(fullPath);
    files.push({
      archivePath,
      rootId: entry.root.id,
      relativePath: entry.relativePath,
      byteSize: digest.byteSize,
      sha256: digest.sha256,
      crc32: digest.crc32,
    });
  }

  return {
    stagingDir,
    currentRoots: storageRoots,
    manifest: {
      formatVersion: 3,
      app: { name: "rispro-reception", packageVersion: "0.1.0", gitCommit: null },
      createdAt: "2026-05-27T00:00:00.000Z",
      initiatedByUserId: null,
      database: { schemas: ["public", "appointments_v2"], migrationVersion: null, tables: [] },
      storageRoots,
      archiveEntries: [],
      files,
      env: { archivePath: "config/env.enc.json", variableNames: [] },
      safetyBackup: { preferredMethod: "pg_dump_custom", fallbackMethod: "v3_snapshot" },
      limits: { maxFiles: 60000, maxFileBytes: 1000, maxTotalUncompressedBytes: 1000 },
    },
  };
}

test("restoreBackupV3AppOwnedStorageOnly rejects unknown roots and unsafe paths before replacement", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-storage-restore-"));
  const currentRoot = root("project-storage", "project_storage", path.join(tempDir, "current"), "storage/project");
  await fs.mkdir(currentRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(currentRoot.absolutePath, "keep.txt"), "current");
  const unknownRoot = root("unknown-root", "project_storage", path.join(tempDir, "unknown"), "storage/unknown");
  const { manifest, stagingDir } = await makeManifest(tempDir, [
    { root: unknownRoot, relativePath: "file.txt", content: "new" },
  ]);

  await assert.rejects(
    () => restoreBackupV3AppOwnedStorageOnly({
      manifest,
      stagingDir,
      currentRoots: [currentRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /unknown storage root/
  );
  assert.equal(await fs.readFile(path.join(currentRoot.absolutePath, "keep.txt"), "utf8"), "current");

  const badPath = await makeManifest(tempDir, [
    { root: currentRoot, relativePath: "../escape.txt", content: "new" },
  ]);
  await assert.rejects(
    () => restoreBackupV3AppOwnedStorageOnly({
      manifest: badPath.manifest,
      stagingDir: badPath.stagingDir,
      currentRoots: [currentRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /Unsafe storage restore path/
  );
  assert.equal(await fs.readFile(path.join(currentRoot.absolutePath, "keep.txt"), "utf8"), "current");
});

test("archive validation rejects symlink-like storage entries before restore staging", () => {
  const errors = validateBackupV3ArchiveEntries(
    [{ path: "storage/project/link", type: "symlink", uncompressedSize: 0 }],
    { maxFiles: 10, maxFileBytes: 100, maxTotalUncompressedBytes: 100 }
  );
  assert.match(errors.join("\n"), /not allowed/);
});

test("checksum mismatch and missing staged files prevent replacement", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-storage-restore-"));
  const currentRoot = root("project-storage", "project_storage", path.join(tempDir, "current"), "storage/project");
  await fs.mkdir(currentRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(currentRoot.absolutePath, "extra.txt"), "extra");
  const prepared = await makeManifest(tempDir, [{ root: currentRoot, relativePath: "file.txt", content: "new" }]);

  prepared.manifest.files[0]!.sha256 = "0".repeat(64);
  await assert.rejects(
    () => restoreBackupV3AppOwnedStorageOnly({
      manifest: prepared.manifest,
      stagingDir: prepared.stagingDir,
      currentRoots: [currentRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /checksum or size mismatch/
  );
  assert.equal(await fs.readFile(path.join(currentRoot.absolutePath, "extra.txt"), "utf8"), "extra");

  prepared.manifest.files[0]!.sha256 = (await sha256File(path.join(prepared.stagingDir, prepared.manifest.files[0]!.archivePath))).sha256;
  await fs.rm(path.join(prepared.stagingDir, prepared.manifest.files[0]!.archivePath));
  await assert.rejects(
    () => restoreBackupV3AppOwnedStorageOnly({
      manifest: prepared.manifest,
      stagingDir: prepared.stagingDir,
      currentRoots: [currentRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /ENOENT/
  );
  assert.equal(await fs.readFile(path.join(currentRoot.absolutePath, "extra.txt"), "utf8"), "extra");
});

test("restoreBackupV3AppOwnedStorageOnly mirrors app-owned storage exactly", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-storage-restore-"));
  const currentRoot = root("project-storage", "project_storage", path.join(tempDir, "current"), "storage/project");
  await fs.mkdir(path.join(currentRoot.absolutePath, "old-dir"), { recursive: true });
  await fs.writeFile(path.join(currentRoot.absolutePath, "old-dir", "extra.txt"), "extra");
  const prepared = await makeManifest(tempDir, [
    { root: currentRoot, relativePath: "nested/file.txt", content: "new" },
  ]);

  const result = await restoreBackupV3AppOwnedStorageOnly({
    manifest: prepared.manifest,
    stagingDir: prepared.stagingDir,
    currentRoots: [currentRoot],
    safetyBackupsCreated: safetyMetadata(tempDir),
  });

  assert.equal(result.storageRestored, true);
  assert.equal(result.dbRestored, false);
  assert.equal(result.envRestored, false);
  assert.equal(result.restoreIncomplete, true);
  assert.equal(await fs.readFile(path.join(currentRoot.absolutePath, "nested", "file.txt"), "utf8"), "new");
  await assert.rejects(() => fs.access(path.join(currentRoot.absolutePath, "old-dir", "extra.txt")));
});

test("nested app-owned roots are preserved as boundaries and restored by content replacement", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-storage-restore-"));
  const projectRoot = root("project-storage", "project_storage", path.join(tempDir, "storage"), "storage/project");
  const santeRoot = root("sante-hl7-outbox", "hl7_outbox", path.join(projectRoot.absolutePath, "sante-hl7-outbox"), "storage/sante-hl7-outbox");
  await fs.mkdir(santeRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(projectRoot.absolutePath, "old.txt"), "old");
  await fs.writeFile(path.join(santeRoot.absolutePath, "extra.hl7"), "extra");
  const removedPaths: string[] = [];
  const prepared = await makeManifest(tempDir, [
    { root: projectRoot, relativePath: "top.txt", content: "top" },
    { root: projectRoot, relativePath: "sante-hl7-outbox/duplicate-from-parent.hl7", content: "skip-parent-copy" },
    { root: santeRoot, relativePath: "message.hl7", content: "hl7" },
  ]);

  const result = await restoreBackupV3AppOwnedStorageOnly({
    manifest: prepared.manifest,
    stagingDir: prepared.stagingDir,
    currentRoots: [projectRoot, santeRoot],
    safetyBackupsCreated: safetyMetadata(tempDir),
    onRemovePath: (targetPath) => removedPaths.push(targetPath),
  });

  assert.equal(result.storageRestored, true);
  assert.equal(await fs.readFile(path.join(projectRoot.absolutePath, "top.txt"), "utf8"), "top");
  assert.equal(await fs.readFile(path.join(santeRoot.absolutePath, "message.hl7"), "utf8"), "hl7");
  await assert.rejects(() => fs.access(path.join(projectRoot.absolutePath, "old.txt")));
  await assert.rejects(() => fs.access(path.join(santeRoot.absolutePath, "extra.hl7")));
  await assert.rejects(() => fs.access(path.join(santeRoot.absolutePath, "duplicate-from-parent.hl7")));
  assert.equal(removedPaths.includes(santeRoot.absolutePath), false);
});

test("external document roots are ignored by app-owned storage restore and Orthanc roots are rejected", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-storage-restore-"));
  const externalRoot = root("document-storage", "document_storage", path.join(tempDir, "external-docs"), "documents/external");
  const orthancRoot = root("orthanc-data", "project_storage", path.join(tempDir, "orthanc"), "storage/orthanc");
  await fs.mkdir(externalRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(externalRoot.absolutePath, "external.txt"), "external");
  await fs.mkdir(orthancRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(orthancRoot.absolutePath, "orthanc.txt"), "orthanc");

  const external = await makeManifest(tempDir, [
    { root: externalRoot, relativePath: "external.txt", content: "new" },
  ]);
  const externalResult = await restoreBackupV3AppOwnedStorageOnly({
    manifest: external.manifest,
    stagingDir: external.stagingDir,
    currentRoots: [externalRoot],
    safetyBackupsCreated: safetyMetadata(tempDir),
  });
  assert.equal(externalResult.storageRestored, true);
  assert.equal(await fs.readFile(path.join(externalRoot.absolutePath, "external.txt"), "utf8"), "external");

  const orthanc = await makeManifest(tempDir, [
    { root: orthancRoot, relativePath: "orthanc.txt", content: "new" },
  ]);
  await assert.rejects(
    () => restoreBackupV3AppOwnedStorageOnly({
      manifest: orthanc.manifest,
      stagingDir: orthanc.stagingDir,
      currentRoots: [orthancRoot],
      safetyBackupsCreated: safetyMetadata(tempDir),
    }),
    /Orthanc/
  );
  assert.equal(await fs.readFile(path.join(orthancRoot.absolutePath, "orthanc.txt"), "utf8"), "orthanc");
});

test("partial failure after replacement starts reports safety paths and does not write env", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-storage-restore-"));
  const currentRoot = root("project-storage", "project_storage", path.join(tempDir, "current"), "storage/project");
  const envPath = path.join(tempDir, ".env");
  await fs.mkdir(currentRoot.absolutePath, { recursive: true });
  await fs.writeFile(path.join(currentRoot.absolutePath, "current.txt"), "current");
  await fs.writeFile(envPath, "DATABASE_URL=unchanged");
  const prepared = await makeManifest(tempDir, [{ root: currentRoot, relativePath: "new.txt", content: "new" }]);
  const safety = safetyMetadata(tempDir);

  await assert.rejects(
    () => restoreBackupV3AppOwnedStorageOnly({
      manifest: prepared.manifest,
      stagingDir: prepared.stagingDir,
      currentRoots: [currentRoot],
      safetyBackupsCreated: safety,
      failAfterRemovingRootId: "project-storage",
    }),
    (error: unknown) => {
      assert.ok(error instanceof BackupV3StoragePartialFailureError);
      assert.equal(error.result.partialFailure, true);
      assert.equal(error.result.safetyBackupsCreated.storageSafetyRoot, safety.storageSafetyRoot);
      return true;
    }
  );
  assert.equal(await fs.readFile(path.join(currentRoot.absolutePath, "current.txt"), "utf8"), "current");
  assert.equal(await fs.readFile(envPath, "utf8"), "DATABASE_URL=unchanged");
});

test("v2 restore route remains JSON-based and unchanged", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");
    assert.match(source, /"\/restore",[\s\S]*express\.json\(\{ limit: "500mb" \}\)/);
  assert.match(source, /restoreBackupSnapshot\(body\.backup, req\.user!\.sub, body\.passphrase, body\.confirmation\)/);
});
