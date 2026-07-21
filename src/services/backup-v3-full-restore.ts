import fs from "node:fs/promises";
import path from "node:path";
import type { NullableUserId } from "../types/http.js";
import type { BackupV3Manifest, BackupV3StorageRoot } from "./backup-v3-types.js";
import type { BackupV3SafetyMetadata } from "./backup-v3-safety-service.js";
import { restoreBackupV3DatabaseOnly, type BackupV3DbRestoreResult } from "./backup-v3-db-restore.js";
import { restoreBackupV3AppOwnedStorageOnly, BackupV3StoragePartialFailureError } from "./backup-v3-storage-restore.js";
import {
  restoreBackupV3ExternalDocumentsOnly,
  BackupV3ExternalDocumentPartialFailureError,
} from "./backup-v3-external-document-restore.js";
import { restoreBackupV3EnvOnly, type BackupV3EnvRestoreResult } from "./backup-v3-env-restore.js";
import { getProjectRootDir } from "./document-storage-path.js";
import { sha256File } from "./backup-v3-checksums.js";

export interface BackupV3FullRestoreInput {
  currentUserId: NullableUserId;
  uploadedArchivePath: string;
  uploadedArchiveName: string | null;
  passphrase: string;
  stagingDir: string;
  appOwnedStorageRoots?: BackupV3StorageRoot[];
  approvedDocumentRoots?: BackupV3StorageRoot[];
  envPath?: string;
  /** Digest captured by the durable preview job. Rechecked after the restore lock. */
  expectedArchiveDigest?: { sha256: string; byteSize: number };
  /** Durable preview is claimed only after the restore lock is acquired. */
  previewJobId?: string;
}

export interface BackupV3FullRestoreResult {
  ok: boolean;
  dbRestored: boolean;
  storageRestored: boolean | "partial";
  externalDocumentsRestored: boolean | "partial";
  envRestored: boolean;
  restartRequired: boolean;
  restoreIncomplete: boolean;
  safetyBackupsCreated: BackupV3SafetyMetadata;
  restoredCounts: {
    tables: number;
    rows: number;
    storageFiles: number;
    externalDocumentFiles: number;
    envVars: number;
  };
  warnings: string[];
  partialFailure?: {
    component: "storage" | "external_documents" | "env";
    message: string;
    details?: unknown;
  };
  env?: Pick<BackupV3EnvRestoreResult, "envVarsRestored" | "ignoredArchiveKeys" | "preservedLocalKeys" | "safetyBackupPath">;
}

interface ValidatedArchive {
  manifest: BackupV3Manifest;
  warnings: string[];
}

export interface BackupV3FullRestoreDependencies {
  validateArchive(input: BackupV3FullRestoreInput): Promise<ValidatedArchive>;
  acquireRestoreLock(): Promise<{ release(): Promise<void> }>;
  resolveReviewedArtifact(input: BackupV3FullRestoreInput): Promise<BackupV3FullRestoreInput>;
  verifyArchiveUnchanged(input: BackupV3FullRestoreInput): Promise<void>;
  createSafetyBackups(input: BackupV3FullRestoreInput): Promise<BackupV3SafetyMetadata>;
  restoreDatabase(input: BackupV3FullRestoreInput, manifest: BackupV3Manifest): Promise<BackupV3DbRestoreResult>;
  restoreStorage(
    input: BackupV3FullRestoreInput,
    manifest: BackupV3Manifest,
    safety: BackupV3SafetyMetadata
  ): Promise<{ filesRestored: number }>;
  restoreExternalDocuments(
    input: BackupV3FullRestoreInput,
    manifest: BackupV3Manifest,
    safety: BackupV3SafetyMetadata
  ): Promise<{ filesRestored: number }>;
  restoreEnv(
    input: BackupV3FullRestoreInput,
    safety: BackupV3SafetyMetadata
  ): Promise<BackupV3EnvRestoreResult>;
}

async function readStagedManifest(stagingDir: string): Promise<BackupV3Manifest> {
  return JSON.parse(await fs.readFile(path.join(stagingDir, "manifest.json"), "utf8")) as BackupV3Manifest;
}

function defaultStorageRoots(manifest: BackupV3Manifest): BackupV3StorageRoot[] {
  return manifest.storageRoots.filter((root) => root.kind !== "document_storage");
}

function defaultDocumentRoots(manifest: BackupV3Manifest): BackupV3StorageRoot[] {
  return manifest.storageRoots.filter((root) => root.kind === "document_storage");
}

export const defaultBackupV3FullRestoreDependencies: BackupV3FullRestoreDependencies = {
  async validateArchive(input) {
    const { previewBackupV3RestoreFromArchive } = await import("./backup-v3-preview-service.js");
    const preview = await previewBackupV3RestoreFromArchive(input.uploadedArchivePath, input.stagingDir, input.passphrase);
    if (!preview.ok) {
      throw new Error(`Backup is not safe to restore: ${preview.errors.join("; ")}`);
    }
    return {
      manifest: await readStagedManifest(input.stagingDir),
      warnings: preview.warnings,
    };
  },
  async acquireRestoreLock() {
    const { pool } = await import("../db/pool.js");
    const { acquireBackupV3RestoreLock, releaseBackupV3RestoreLock } = await import("./backup-v3-safety-service.js");
    const client = await pool.connect();
    let locked = false;
    try {
      await acquireBackupV3RestoreLock(client);
      locked = true;
      return {
        async release() {
          if (locked) {
            locked = false;
            await releaseBackupV3RestoreLock(client);
          }
          client.release();
        },
      };
    } catch (error) {
      client.release();
      throw error;
    }
  },
  async resolveReviewedArtifact(input) {
    if (!input.previewJobId) return input;
    const { claimBackupV3PreviewForRestore } = await import("./backup-v3-restore-jobs-service.js");
    const preview = await claimBackupV3PreviewForRestore(input.previewJobId);
    return {
      ...input,
      uploadedArchivePath: preview.archivePath,
      stagingDir: preview.stagingDir,
      expectedArchiveDigest: { sha256: preview.archiveSha256, byteSize: preview.archiveSizeBytes },
    };
  },
  async verifyArchiveUnchanged(input) {
    if (!input.expectedArchiveDigest) return;
    const actual = await sha256File(input.uploadedArchivePath);
    if (actual.byteSize !== input.expectedArchiveDigest.byteSize || actual.sha256.toLowerCase() !== input.expectedArchiveDigest.sha256.toLowerCase()) {
      throw new Error("Reviewed restore artifact changed after preview and cannot be restored.");
    }
  },
  async createSafetyBackups(input) {
    const { createBackupV3PreRestoreSafetyBackups } = await import("./backup-v3-safety-service.js");
    const safety = await createBackupV3PreRestoreSafetyBackups(input);
    return safety.safetyBackupsCreated;
  },
  async restoreDatabase(input, manifest) {
    const { pool } = await import("../db/pool.js");
    const client = await pool.connect();
    try {
      return await restoreBackupV3DatabaseOnly(client, manifest, input.stagingDir);
    } finally {
      client.release();
    }
  },
  async restoreStorage(input, manifest, safety) {
    const roots = input.appOwnedStorageRoots || defaultStorageRoots(manifest);
    const result = await restoreBackupV3AppOwnedStorageOnly({
      manifest,
      stagingDir: input.stagingDir,
      currentRoots: roots,
      safetyBackupsCreated: safety,
    });
    return { filesRestored: result.restoredRoots.reduce((sum, root) => sum + root.files, 0) };
  },
  async restoreExternalDocuments(input, manifest, safety) {
    const roots = input.approvedDocumentRoots || defaultDocumentRoots(manifest);
    const result = await restoreBackupV3ExternalDocumentsOnly({
      manifest,
      stagingDir: input.stagingDir,
      approvedDocumentRoots: roots,
      safetyBackupsCreated: safety,
    });
    return { filesRestored: result.filesRestored.length };
  },
  async restoreEnv(input, safety) {
    return restoreBackupV3EnvOnly({
      stagingDir: input.stagingDir,
      passphrase: input.passphrase,
      envPath: input.envPath || path.join(getProjectRootDir(), ".env"),
      safetyBackupPath: safety.envSafetyPath,
    });
  },
};

export async function restoreBackupV3FullService(
  input: BackupV3FullRestoreInput,
  dependencies: BackupV3FullRestoreDependencies = defaultBackupV3FullRestoreDependencies
): Promise<BackupV3FullRestoreResult> {
  try {
    const lock = await dependencies.acquireRestoreLock();
    try {
      // Claiming is deliberately inside the restore lock: a second restore
      // cannot consume the same reviewed artifact while this one is waiting.
      const restoreInput = await dependencies.resolveReviewedArtifact(input);
      const validated = await dependencies.validateArchive(restoreInput);
      // This is deliberately after the exclusive lock and immediately before
      // the first mutable restore step, so a reviewed artifact cannot drift.
      await dependencies.verifyArchiveUnchanged(restoreInput);
      const safetyBackupsCreated = await dependencies.createSafetyBackups(restoreInput);
      const db = await dependencies.restoreDatabase(restoreInput, validated.manifest);
      const base = {
        safetyBackupsCreated,
        warnings: validated.warnings,
        restoredCounts: {
          tables: db.tablesRestored,
          rows: db.rowsRestored,
          storageFiles: 0,
          externalDocumentFiles: 0,
          envVars: 0,
        },
      };

      let storage;
      try {
        storage = await dependencies.restoreStorage(restoreInput, validated.manifest, safetyBackupsCreated);
        base.restoredCounts.storageFiles = storage.filesRestored;
      } catch (error) {
        const details = error instanceof BackupV3StoragePartialFailureError ? error.result : undefined;
        return {
          ok: false,
          dbRestored: true,
          storageRestored: "partial",
          externalDocumentsRestored: false,
          envRestored: false,
          restartRequired: true,
          restoreIncomplete: true,
          ...base,
          partialFailure: {
            component: "storage",
            message: error instanceof Error ? error.message : String(error),
            details,
          },
        };
      }

      try {
        const externalDocuments = await dependencies.restoreExternalDocuments(restoreInput, validated.manifest, safetyBackupsCreated);
        base.restoredCounts.externalDocumentFiles = externalDocuments.filesRestored;
      } catch (error) {
        const details = error instanceof BackupV3ExternalDocumentPartialFailureError ? error.result : undefined;
        return {
          ok: false,
          dbRestored: true,
          storageRestored: true,
          externalDocumentsRestored: "partial",
          envRestored: false,
          restartRequired: true,
          restoreIncomplete: true,
          ...base,
          partialFailure: {
            component: "external_documents",
            message: error instanceof Error ? error.message : String(error),
            details,
          },
        };
      }

      try {
        const envRestore = await dependencies.restoreEnv(restoreInput, safetyBackupsCreated);
        base.restoredCounts.envVars = envRestore.envVarsRestored.length;
        return {
          ok: true,
          dbRestored: true,
          storageRestored: true,
          externalDocumentsRestored: true,
          envRestored: true,
          restartRequired: true,
          restoreIncomplete: false,
          ...base,
          env: {
            envVarsRestored: envRestore.envVarsRestored,
            ignoredArchiveKeys: envRestore.ignoredArchiveKeys,
            preservedLocalKeys: envRestore.preservedLocalKeys,
            safetyBackupPath: envRestore.safetyBackupPath,
          },
        };
      } catch (error) {
        return {
          ok: false,
          dbRestored: true,
          storageRestored: true,
          externalDocumentsRestored: true,
          envRestored: false,
          restartRequired: true,
          restoreIncomplete: true,
          ...base,
          partialFailure: {
            component: "env",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    } finally {
      await lock.release();
    }
  } catch (error) {
    throw error;
  }
}
