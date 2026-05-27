import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  restoreBackupV3FullService,
  type BackupV3FullRestoreDependencies,
  type BackupV3FullRestoreInput,
} from "./backup-v3-full-restore.js";
import { BackupV3StoragePartialFailureError } from "./backup-v3-storage-restore.js";
import { BackupV3ExternalDocumentPartialFailureError } from "./backup-v3-external-document-restore.js";
import type { BackupV3Manifest, BackupV3SafetyBackupMethod } from "./backup-v3-types.js";
import type { BackupV3SafetyMetadata } from "./backup-v3-safety-service.js";

function manifest(): BackupV3Manifest {
  return {
    formatVersion: 3,
    app: { name: "rispro", packageVersion: "1.0.0", gitCommit: null },
    createdAt: "2026-05-27T00:00:00.000Z",
    initiatedByUserId: 1,
    database: { schemas: ["public"], migrationVersion: null, tables: [] },
    storageRoots: [],
    archiveEntries: [],
    files: [],
    env: { archivePath: "config/env.enc.json", variableNames: [] },
    safetyBackup: { preferredMethod: "pg_dump_custom", fallbackMethod: "v3_snapshot" },
    limits: { maxFiles: 100, maxFileBytes: 1000, maxTotalUncompressedBytes: 1000 },
  };
}

function safety(): BackupV3SafetyMetadata {
  return {
    timestamp: "2026-05-27T00-00-00-000Z",
    initiatingUserId: 1,
    uploadedArchiveName: "backup.rispro.zip",
    uploadedArchiveSha256: "abc",
    dbSafetyMethod: "v3_snapshot" as BackupV3SafetyBackupMethod,
    dbSafetyPath: "safety/db.rispro.zip",
    envSafetyPath: "safety/.env.pre-restore",
    storageSafetyRoot: "safety/storage",
    storageSafetyPaths: ["safety/storage/project-storage"],
    metadataPath: "safety/metadata.json",
  };
}

function input(): BackupV3FullRestoreInput {
  return {
    currentUserId: 1,
    uploadedArchivePath: "backup.rispro.zip",
    uploadedArchiveName: "backup.rispro.zip",
    passphrase: "passphrase",
    stagingDir: "staged",
  };
}

function deps(overrides: Partial<BackupV3FullRestoreDependencies> = {}, calls: string[] = []): BackupV3FullRestoreDependencies {
  return {
    async validateArchive() {
      calls.push("validate");
      return { manifest: manifest(), warnings: ["version warning"] };
    },
    async createSafetyBackups() {
      calls.push("safety");
      return safety();
    },
    async restoreDatabase() {
      calls.push("db");
      return { tablesRestored: 2, rowsRestored: 3 };
    },
    async restoreStorage() {
      calls.push("storage");
      return { filesRestored: 4 };
    },
    async restoreExternalDocuments() {
      calls.push("external");
      return { filesRestored: 5 };
    },
    async restoreEnv() {
      calls.push("env");
      return {
        ok: true,
        envRestored: true,
        dbRestored: false,
        storageRestored: false,
        externalDocumentsRestored: false,
        restartRequired: true,
        restoreIncomplete: true,
        envVarsRestored: [{ name: "DATABASE_URL", isSecret: true, value: "********" }],
        ignoredArchiveKeys: ["NODE_ENV", "UNMANAGED_BACKUP_KEY"],
        preservedLocalKeys: [{ name: "PORT", isSecret: false, value: "<restored>" }],
        safetyBackupPath: "safety/.env.pre-restore",
      };
    },
    ...overrides,
  };
}

test("validation failure changes nothing", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => restoreBackupV3FullService(input(), deps({
      async validateArchive() {
        calls.push("validate");
        throw new Error("invalid archive");
      },
    }, calls)),
    /invalid archive/
  );
  assert.deepEqual(calls, ["validate"]);
});

test("safety-backup failure changes nothing", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => restoreBackupV3FullService(input(), deps({
      async createSafetyBackups() {
        calls.push("safety");
        throw new Error("safety failed");
      },
    }, calls)),
    /safety failed/
  );
  assert.deepEqual(calls, ["validate", "safety"]);
});

test("DB failure rolls back through DB restore service and does not touch storage or env", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => restoreBackupV3FullService(input(), deps({
      async restoreDatabase() {
        calls.push("db");
        throw new Error("db rollback complete");
      },
    }, calls)),
    /db rollback complete/
  );
  assert.deepEqual(calls, ["validate", "safety", "db"]);
});

test("storage failure after DB commit reports partial failure and safety paths", async () => {
  const calls: string[] = [];
  const result = await restoreBackupV3FullService(input(), deps({
    async restoreStorage() {
      calls.push("storage");
      throw new BackupV3StoragePartialFailureError({
        ok: false,
        storageRestored: "partial",
        dbRestored: false,
        envRestored: false,
        restoreIncomplete: true,
        partialFailure: true,
        message: "storage failed",
        safetyBackupsCreated: safety(),
        restoredRoots: [],
      });
    },
  }, calls));

  assert.equal(result.ok, false);
  assert.equal(result.dbRestored, true);
  assert.equal(result.storageRestored, "partial");
  assert.equal(result.restartRequired, true);
  assert.equal(result.safetyBackupsCreated.storageSafetyRoot, "safety/storage");
  assert.equal(result.partialFailure?.component, "storage");
  assert.deepEqual(calls, ["validate", "safety", "db", "storage"]);
});

test("external document partial failure reports restored and failed file metadata", async () => {
  const result = await restoreBackupV3FullService(input(), deps({
    async restoreExternalDocuments() {
      throw new BackupV3ExternalDocumentPartialFailureError({
        ok: false,
        externalDocumentsRestored: "partial",
        dbRestored: false,
        storageRestored: false,
        envRestored: false,
        restoreIncomplete: true,
        partialFailure: true,
        message: "external failed",
        filesRestored: [{ rootId: "document-storage", path: "/docs/one.pdf", archivePath: "documents/external/one.pdf" }],
        filesFailed: [{ rootId: "document-storage", archivePath: "documents/external/two.pdf", message: "disk full" }],
        safetyBackupsCreated: safety(),
      });
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.storageRestored, true);
  assert.equal(result.externalDocumentsRestored, "partial");
  assert.equal(result.partialFailure?.component, "external_documents");
  assert.match(JSON.stringify(result.partialFailure), /one\.pdf/);
  assert.match(JSON.stringify(result.partialFailure), /two\.pdf/);
});

test(".env failure reports partial failure and safety paths", async () => {
  const result = await restoreBackupV3FullService(input(), deps({
    async restoreEnv() {
      throw new Error("env write failed");
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.dbRestored, true);
  assert.equal(result.storageRestored, true);
  assert.equal(result.externalDocumentsRestored, true);
  assert.equal(result.envRestored, false);
  assert.equal(result.restartRequired, true);
  assert.equal(result.safetyBackupsCreated.envSafetyPath, "safety/.env.pre-restore");
  assert.equal(result.partialFailure?.component, "env");
});

test("successful orchestration calls components in order and returns complete result", async () => {
  const calls: string[] = [];
  const result = await restoreBackupV3FullService(input(), deps({}, calls));

  assert.deepEqual(calls, ["validate", "safety", "db", "storage", "external", "env"]);
  assert.equal(result.ok, true);
  assert.equal(result.dbRestored, true);
  assert.equal(result.storageRestored, true);
  assert.equal(result.externalDocumentsRestored, true);
  assert.equal(result.envRestored, true);
  assert.equal(result.restartRequired, true);
  assert.equal(result.restoreIncomplete, false);
  assert.deepEqual(result.restoredCounts, { tables: 2, rows: 3, storageFiles: 4, externalDocumentFiles: 5, envVars: 1 });
  assert.deepEqual(result.warnings, ["version warning"]);
});

test("restartRequired is not returned when validation, safety, or DB fail before mutation", async () => {
  await assert.rejects(() => restoreBackupV3FullService(input(), deps({
    async validateArchive() {
      throw new Error("invalid");
    },
  })));
  await assert.rejects(() => restoreBackupV3FullService(input(), deps({
    async createSafetyBackups() {
      throw new Error("safety");
    },
  })));
  await assert.rejects(() => restoreBackupV3FullService(input(), deps({
    async restoreDatabase() {
      throw new Error("db");
    },
  })));
});

test("secrets are not exposed in orchestration result", async () => {
  const result = await restoreBackupV3FullService(input(), deps({
    async restoreEnv() {
      return {
        ok: true,
        envRestored: true,
        dbRestored: false,
        storageRestored: false,
        externalDocumentsRestored: false,
        restartRequired: true,
        restoreIncomplete: true,
        envVarsRestored: [{ name: "JWT_SECRET", isSecret: true, value: "********" }],
        ignoredArchiveKeys: [],
        preservedLocalKeys: [{ name: "LOCAL_SECRET", isSecret: true, value: "********" }],
        safetyBackupPath: "safety/.env.pre-restore",
      };
    },
  }));

  assert.doesNotMatch(JSON.stringify(result), /actual-secret|postgres:\/\/|password/i);
  assert.match(JSON.stringify(result), /\*{8}/);
});

test("full v3 endpoint remains blocked and v2 restore behavior remains unchanged", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");
  assert.match(source, /"\/restore\/v3"/);
  assert.match(source, /Full v3 restore is not implemented yet/);
  assert.match(source, /"\/restore",\s*\n\s*express\.json\(\{ limit: "500mb" \}\)/);
  assert.match(source, /restoreBackupSnapshot\(body\.backup, req\.user!\.sub, body\.passphrase, body\.confirmation\)/);
});
