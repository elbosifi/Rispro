import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { getProjectRootDir } from "./document-storage-path.js";
import { sha256File } from "./backup-v3-checksums.js";
import { resolveBackupV3StorageRoots } from "./backup-v3-storage-roots.js";
import { streamBackupV3Archive } from "./backup-v3-service.js";
import type { NullableUserId } from "../types/http.js";
import { HttpError } from "../utils/http-error.js";
import type { BackupV3Manifest } from "./backup-v3-types.js";
import { restoreBackupV3DatabaseOnly } from "./backup-v3-db-restore.js";

const execFileAsync = promisify(execFile);
export const BACKUP_V3_RESTORE_LOCK_KEY = "rispro_restore_v3";
const RESTORE_CONFIRMATION = "RESTORE RISPRO";

export interface BackupV3SafetyMetadata {
  timestamp: string;
  initiatingUserId: NullableUserId;
  uploadedArchiveName: string | null;
  uploadedArchiveSha256: string;
  dbSafetyMethod: "pg_dump_custom" | "v3_snapshot";
  dbSafetyPath: string;
  envSafetyPath: string | null;
  storageSafetyRoot: string;
  storageSafetyPaths: string[];
  metadataPath: string;
}

export interface CreateBackupV3SafetyInput {
  currentUserId: NullableUserId;
  uploadedArchivePath: string;
  uploadedArchiveName: string | null;
  passphrase: string;
}

export interface BackupV3RestoreSkeletonResult {
  ok: true;
  restoreNotExecuted: true;
  safetyBackupsCreated: BackupV3SafetyMetadata;
  restartRequired: false;
}

export interface BackupV3DbRestoreOnlyResult {
  ok: true;
  dbRestored: true;
  storageRestored: false;
  envRestored: false;
  restoreIncomplete: true;
  restartRequired: true;
  tablesRestored: number;
  rowsRestored: number;
  safetyBackupsCreated: BackupV3SafetyMetadata;
}

function timestampId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function requireBackupV3RestoreConfirmation(confirmation: unknown): void {
  if (String(confirmation || "") !== RESTORE_CONFIRMATION) {
    throw new HttpError(400, `Confirmation must be ${RESTORE_CONFIRMATION}.`);
  }
}

export async function acquireBackupV3RestoreLock(client: PoolClient): Promise<void> {
  const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [
    BACKUP_V3_RESTORE_LOCK_KEY,
  ]);
  if (!lock.rows[0]?.locked) {
    throw new HttpError(409, "Another restore is already running.");
  }
}

export async function releaseBackupV3RestoreLock(client: PoolClient): Promise<void> {
  await client.query("select pg_advisory_unlock(hashtext($1))", [BACKUP_V3_RESTORE_LOCK_KEY]).catch(() => undefined);
}

async function isPgDumpAvailable(): Promise<boolean> {
  try {
    await execFileAsync("pg_dump", ["--version"]);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT" ? true : false;
  }
}

export function selectBackupV3DbSafetyMethod(pgDumpAvailable: boolean): "pg_dump_custom" | "v3_snapshot" {
  return pgDumpAvailable ? "pg_dump_custom" : "v3_snapshot";
}

function pgDumpConnectionEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: url.pathname.replace(/^\//, ""),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

async function createDbSafetyBackup(
  outputDir: string,
  currentUserId: NullableUserId,
  passphrase: string
): Promise<{ method: "pg_dump_custom" | "v3_snapshot"; path: string }> {
  const dumpPath = path.join(outputDir, "database-pre-restore.dump");
  const method = selectBackupV3DbSafetyMethod(await isPgDumpAvailable());
  if (method === "pg_dump_custom") {
    try {
      await execFileAsync("pg_dump", ["-Fc", "--file", dumpPath], {
        env: { ...process.env, ...pgDumpConnectionEnv(env.databaseUrl) },
      });
      return { method: "pg_dump_custom", path: dumpPath };
    } catch {
      console.warn("pg_dump safety backup failed; falling back to v3 snapshot safety backup.");
      await fs.rm(dumpPath, { force: true }).catch(() => undefined);
    }
  }

  const snapshotPath = path.join(outputDir, "database-pre-restore.rispro.zip");
  const output = createWriteStream(snapshotPath, { flags: "wx" });
  await streamBackupV3Archive({
    currentUserId,
    passphrase,
    output,
    backupName: path.basename(snapshotPath),
  });
  return { method: "v3_snapshot", path: snapshotPath };
}

async function copyEnvSafety(outputDir: string): Promise<string | null> {
  const envPath = path.join(getProjectRootDir(), ".env");
  const outputPath = path.join(outputDir, ".env.pre-restore");
  try {
    await fs.copyFile(envPath, outputPath);
    return outputPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function copyDirectoryWithoutSymlinks(source: string, target: string): Promise<void> {
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await fs.readdir(source, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  await fs.mkdir(target, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      await copyDirectoryWithoutSymlinks(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function copyStorageSafety(outputDir: string): Promise<string[]> {
  const roots = resolveBackupV3StorageRoots({
    uploadsDir: env.uploadsDir,
    santeHl7OutputFolderPath: env.santeHl7OutputFolderPath,
  });
  const storageRoot = path.join(outputDir, "storage");
  const copied: string[] = [];
  for (const root of roots) {
    const target = path.join(storageRoot, root.id);
    await copyDirectoryWithoutSymlinks(root.absolutePath, target);
    copied.push(target);
  }
  return copied;
}

export async function createBackupV3PreRestoreSafetyBackups(
  input: CreateBackupV3SafetyInput
): Promise<BackupV3RestoreSkeletonResult> {
  const timestamp = timestampId();
  const safetyRoot = path.join(getProjectRootDir(), ".rispro-safety", "pre-restore", timestamp);
  await fs.mkdir(safetyRoot, { recursive: true });
  const uploadedArchive = await sha256File(input.uploadedArchivePath);
  const dbSafety = await createDbSafetyBackup(safetyRoot, input.currentUserId, input.passphrase);
  const envSafetyPath = await copyEnvSafety(safetyRoot);
  const storageSafetyPaths = await copyStorageSafety(safetyRoot);
  const metadataPath = path.join(safetyRoot, "metadata.json");
  const metadata: BackupV3SafetyMetadata = {
    timestamp,
    initiatingUserId: input.currentUserId,
    uploadedArchiveName: input.uploadedArchiveName,
    uploadedArchiveSha256: uploadedArchive.sha256,
    dbSafetyMethod: dbSafety.method,
    dbSafetyPath: dbSafety.path,
    envSafetyPath,
    storageSafetyRoot: path.join(safetyRoot, "storage"),
    storageSafetyPaths,
    metadataPath,
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  return {
    ok: true,
    restoreNotExecuted: true,
    safetyBackupsCreated: metadata,
    restartRequired: false,
  };
}

export async function runBackupV3RestoreSafetySkeleton(
  input: CreateBackupV3SafetyInput
): Promise<BackupV3RestoreSkeletonResult> {
  const client = await pool.connect();
  let locked = false;
  try {
    await acquireBackupV3RestoreLock(client);
    locked = true;
    return await createBackupV3PreRestoreSafetyBackups(input);
  } finally {
    if (locked) {
      await releaseBackupV3RestoreLock(client);
    }
    client.release();
  }
}

async function readStagedManifest(stagingDir: string): Promise<BackupV3Manifest> {
  return JSON.parse(await fs.readFile(path.join(stagingDir, "manifest.json"), "utf8")) as BackupV3Manifest;
}

export async function runBackupV3DatabaseRestoreOnly(input: CreateBackupV3SafetyInput & {
  stagingDir: string;
}): Promise<BackupV3DbRestoreOnlyResult> {
  const client = await pool.connect();
  let locked = false;
  try {
    await acquireBackupV3RestoreLock(client);
    locked = true;
    const safety = await createBackupV3PreRestoreSafetyBackups(input);
    const dbRestore = await restoreBackupV3DatabaseOnly(client, await readStagedManifest(input.stagingDir), input.stagingDir);
    return {
      ok: true,
      dbRestored: true,
      storageRestored: false,
      envRestored: false,
      restoreIncomplete: true,
      restartRequired: true,
      tablesRestored: dbRestore.tablesRestored,
      rowsRestored: dbRestore.rowsRestored,
      safetyBackupsCreated: safety.safetyBackupsCreated,
    };
  } finally {
    if (locked) {
      await releaseBackupV3RestoreLock(client);
    }
    client.release();
  }
}
