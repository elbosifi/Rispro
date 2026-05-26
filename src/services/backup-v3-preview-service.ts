import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { sha256File } from "./backup-v3-checksums.js";
import { buildBackupV3DatabaseMetadata } from "./backup-v3-database-metadata.js";
import { decryptBackupV3EnvPayload, type BackupV3EncryptedEnvBundle } from "./backup-v3-env.js";
import { DEFAULT_BACKUP_V3_ARCHIVE_LIMITS } from "./backup-v3-manifest.js";
import type { BackupV3ArchiveEntry, BackupV3Manifest } from "./backup-v3-types.js";
import {
  validateBackupV3Compatibility,
  validateBackupV3ManifestChecksums,
} from "./backup-v3-validators.js";
import { extractStoredBackupV3ZipToStaging } from "./backup-v3-zip-reader.js";
import { getProjectRootDir } from "./document-storage-path.js";

const execFileAsync = promisify(execFile);

export interface BackupV3RestorePreview {
  ok: boolean;
  manifest: {
    formatVersion: number;
    createdAt: string;
    appName: string;
    packageVersion: string | null;
    gitCommit: string | null;
    migrationVersion: string | null;
  };
  counts: {
    tables: number;
    rows: number;
    archiveEntries: number;
    storageFiles: number;
    envVars: number;
  };
  warnings: string[];
  errors: string[];
}

function requirePassphrase(passphrase: unknown): string {
  const value = String(passphrase || "");
  if (value.length < 8) {
    throw new HttpError(400, "Backup passphrase must be at least 8 characters.");
  }
  return value;
}

async function readJsonFile<T>(stagingDir: string, archivePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(stagingDir, archivePath), "utf8")) as T;
}

async function readActualFileDigests(stagingDir: string, entries: BackupV3ArchiveEntry[]) {
  const digests = new Map<string, { sha256: string; byteSize: number }>();
  for (const entry of entries) {
    if (entry.type !== "file" || entry.path === "manifest.json") {
      continue;
    }
    const digest = await sha256File(path.join(stagingDir, entry.path));
    digests.set(entry.path, { sha256: digest.sha256, byteSize: digest.byteSize });
  }
  return digests;
}

async function readRuntimeAppMetadata(): Promise<{ appName: string; packageVersion: string | null; gitCommit: string | null }> {
  const packageJson = JSON.parse(await fs.readFile(path.join(getProjectRootDir(), "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  let gitCommit: string | null = null;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: getProjectRootDir() });
    gitCommit = stdout.trim() || null;
  } catch {
    gitCommit = null;
  }
  return {
    appName: packageJson.name || "rispro",
    packageVersion: packageJson.version || null,
    gitCommit,
  };
}

function validateManifestShape(manifest: BackupV3Manifest): void {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.formatVersion !== 3 ||
    !manifest.app ||
    !manifest.database ||
    !Array.isArray(manifest.database.tables) ||
    !Array.isArray(manifest.archiveEntries) ||
    !Array.isArray(manifest.files) ||
    !manifest.env
  ) {
    throw new HttpError(400, "Invalid v3 backup manifest.");
  }
}

function findUnexpectedArchiveEntries(manifest: BackupV3Manifest, entries: BackupV3ArchiveEntry[]): string[] {
  const expected = new Set([
    "manifest.json",
    "config/env.enc.json",
    "database/schema.json",
    ...manifest.archiveEntries.map((entry) => entry.archivePath),
    ...manifest.files.map((entry) => entry.archivePath),
  ]);
  return entries
    .filter((entry) => entry.type === "file" && !expected.has(entry.path))
    .map((entry) => `Archive contains unexpected file: ${entry.path}`);
}

export async function previewBackupV3RestoreFromArchive(
  archivePath: string,
  stagingDir: string,
  passphrase: unknown
): Promise<BackupV3RestorePreview> {
  const cleanPassphrase = requirePassphrase(passphrase);
  const entries = await extractStoredBackupV3ZipToStaging(archivePath, stagingDir, DEFAULT_BACKUP_V3_ARCHIVE_LIMITS);
  const manifest = await readJsonFile<BackupV3Manifest>(stagingDir, "manifest.json");
  validateManifestShape(manifest);
  const envBundle = await readJsonFile<BackupV3EncryptedEnvBundle>(stagingDir, "config/env.enc.json");
  try {
    decryptBackupV3EnvPayload(envBundle, cleanPassphrase);
  } catch {
    throw new HttpError(400, "Could not decrypt env bundle. Check the backup passphrase.");
  }

  const checksumErrors = [
    ...validateBackupV3ManifestChecksums(manifest, await readActualFileDigests(stagingDir, entries)),
    ...findUnexpectedArchiveEntries(manifest, entries),
  ];
  const client = await pool.connect();
  try {
    const database = await buildBackupV3DatabaseMetadata(client);
    const app = await readRuntimeAppMetadata();
    const compatibility = validateBackupV3Compatibility(manifest, {
      appName: app.appName,
      packageVersion: app.packageVersion,
      gitCommit: app.gitCommit,
      database,
    });
    const warnings = compatibility.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message);
    const errors = [
      ...checksumErrors,
      ...compatibility.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message),
    ];

    return {
      ok: errors.length === 0,
      manifest: {
        formatVersion: manifest.formatVersion,
        createdAt: manifest.createdAt,
        appName: manifest.app.name,
        packageVersion: manifest.app.packageVersion,
        gitCommit: manifest.app.gitCommit,
        migrationVersion: manifest.database.migrationVersion,
      },
      counts: {
        tables: manifest.database.tables.length,
        rows: manifest.database.tables.reduce((sum, table) => sum + table.rowCount, 0),
        archiveEntries: manifest.archiveEntries.length,
        storageFiles: manifest.files.length,
        envVars: manifest.env.variableNames.length,
      },
      warnings,
      errors,
    };
  } finally {
    client.release();
  }
}
