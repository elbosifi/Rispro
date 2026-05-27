import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PoolClient } from "pg";
import type { Writable } from "node:stream";
import { once } from "node:events";
import dotenv from "dotenv";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { getProjectRootDir } from "./document-storage-path.js";
import { encryptBackupV3EnvPayload } from "./backup-v3-env.js";
import { isBackupV3ManagedEnvKey } from "./backup-v3-env-policy.js";
import { sha256Buffer } from "./backup-v3-checksums.js";
import { buildBackupV3DatabaseMetadata } from "./backup-v3-database-metadata.js";
import { collectBackupV3StorageFiles } from "./backup-v3-file-collector.js";
import { DEFAULT_BACKUP_V3_ARCHIVE_LIMITS, buildBackupV3Manifest } from "./backup-v3-manifest.js";
import { resolveBackupV3StorageRoots } from "./backup-v3-storage-roots.js";
import type {
  BackupV3ArchiveManifestEntry,
  BackupV3ArchiveLimits,
} from "./backup-v3-types.js";
import { BackupV3ZipWriter } from "./backup-v3-zip-writer.js";
import { HttpError } from "../utils/http-error.js";
import type { NullableUserId } from "../types/http.js";

const execFileAsync = promisify(execFile);

export interface StreamBackupV3Options {
  currentUserId: NullableUserId;
  passphrase: unknown;
  output: Writable;
  backupName?: string;
  limits?: Partial<BackupV3ArchiveLimits>;
}

export interface BackupV3ArchiveResult {
  backupName: string;
  manifest: ReturnType<typeof buildBackupV3Manifest>;
}

async function endWritable(output: Writable): Promise<void> {
  if (output.writableEnded) {
    return;
  }
  const finished = once(output, "finish");
  output.end();
  await finished;
}

function requirePassphrase(passphrase: unknown): string {
  const value = String(passphrase || "");
  if (value.length < 8) {
    throw new HttpError(400, "Backup passphrase must be at least 8 characters.");
  }
  return value;
}

function requireClassicZipLimits(limits: BackupV3ArchiveLimits): void {
  if (limits.maxFiles >= 65_535) {
    throw new HttpError(400, "Backup max file count must be below 65535 because ZIP64 is not enabled.");
  }
  if (limits.maxFileBytes >= 4 * 1024 * 1024 * 1024) {
    throw new HttpError(400, "Backup max file size must be below 4 GiB because ZIP64 is not enabled.");
  }
  if (limits.maxTotalUncompressedBytes >= 4 * 1024 * 1024 * 1024) {
    throw new HttpError(400, "Backup max total size must be below 4 GiB because ZIP64 is not enabled.");
  }
}

async function readPackageMetadata(): Promise<{ name: string; version: string | null }> {
  const packageJson = JSON.parse(await fs.readFile(path.join(getProjectRootDir(), "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  return { name: packageJson.name || "rispro", version: packageJson.version || null };
}

async function readGitCommit(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: getProjectRootDir() });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readSettingValues(client: PoolClient): Promise<Map<string, string>> {
  const settings = new Map<string, string>();
  const { rows } = await client.query<{ category: string; setting_key: string; value: string | null }>(
    `
      select category, setting_key, setting_value->>'value' as value
      from public.system_settings
      where (category = 'documents_and_uploads' and setting_key = 'storage_path')
         or (category = 'dicom_gateway' and setting_key in ('worklist_source_dir', 'worklist_output_dir'))
         or (category = 'sante_worklist' and setting_key in ('output_folder_path'))
    `
  );
  for (const row of rows) {
    if (row.value) {
      settings.set(`${row.category}.${row.setting_key}`, row.value);
    }
  }
  return settings;
}

async function collectEnvVariables(): Promise<Record<string, string>> {
  try {
    const envContent = await fs.readFile(path.join(getProjectRootDir(), ".env"), "utf8");
    return Object.fromEntries(
      Object.entries(dotenv.parse(envContent)).filter(([key]) => isBackupV3ManagedEnvKey(key))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && isBackupV3ManagedEnvKey(key)) {
      variables[key] = value;
    }
  }
  return variables;
}

async function listRows(client: PoolClient, schema: string, table: string): Promise<unknown[]> {
  const quotedSchema = `"${schema.replace(/"/g, '""')}"`;
  const quotedTable = `"${table.replace(/"/g, '""')}"`;
  const { rows } = await client.query(`select * from ${quotedSchema}.${quotedTable} order by 1 asc`);
  return rows;
}

function archiveEntryForBuffer(archivePath: string, content: Buffer): BackupV3ArchiveManifestEntry {
  return {
    archivePath,
    byteSize: content.length,
    sha256: sha256Buffer(content),
  };
}

export async function streamBackupV3Archive(options: StreamBackupV3Options): Promise<BackupV3ArchiveResult> {
  const passphrase = requirePassphrase(options.passphrase);
  const limits = { ...DEFAULT_BACKUP_V3_ARCHIVE_LIMITS, ...options.limits };
  requireClassicZipLimits(limits);
  const client = await pool.connect();
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-v3-stage-"));
  const createdAt = new Date().toISOString();
  const backupName = options.backupName || `rispro-backup-${createdAt.replace(/[:.]/g, "-")}.rispro.zip`;
  let archiveFileCount = 0;
  let archiveTotalBytes = 0;

  const trackArchiveEntry = (archivePath: string, byteSize: number) => {
    if (byteSize > limits.maxFileBytes) {
      throw new HttpError(413, `Backup entry exceeds max file size: ${archivePath}`);
    }
    archiveFileCount += 1;
    if (archiveFileCount > limits.maxFiles) {
      throw new HttpError(413, "Backup archive contains too many files.");
    }
    archiveTotalBytes += byteSize;
    if (archiveTotalBytes > limits.maxTotalUncompressedBytes) {
      throw new HttpError(413, "Backup archive exceeds max total uncompressed size.");
    }
  };

  try {
    await client.query("begin isolation level repeatable read read only");
    const settings = await readSettingValues(client);
    const database = await buildBackupV3DatabaseMetadata(client);
    const packageMetadata = await readPackageMetadata();
    const gitCommit = await readGitCommit();
    const storageRoots = resolveBackupV3StorageRoots({
      uploadsDir: env.uploadsDir,
      documentStorageRoot: settings.get("documents_and_uploads.storage_path"),
      documentStorageAllowlist: [
        path.join(getProjectRootDir(), "storage"),
        settings.get("documents_and_uploads.storage_path"),
      ].filter((root): root is string => Boolean(root)),
      dicomWorklistSourceDir: settings.get("dicom_gateway.worklist_source_dir"),
      dicomWorklistOutputDir: settings.get("dicom_gateway.worklist_output_dir"),
      santeHl7OutputFolderPath: settings.get("sante_worklist.output_folder_path") || env.santeHl7OutputFolderPath,
    });
    const storageFiles = await collectBackupV3StorageFiles(storageRoots, limits, stagingDir);
    const envVariables = await collectEnvVariables();
    const envBundle = encryptBackupV3EnvPayload(
      { createdAt, variables: envVariables },
      passphrase,
      crypto.randomBytes
    );
    const zip = new BackupV3ZipWriter(options.output);
    const archiveEntries: BackupV3ArchiveManifestEntry[] = [];
    const envBuffer = Buffer.from(JSON.stringify(envBundle, null, 2));
    const schemaBuffer = Buffer.from(JSON.stringify(database, null, 2));
    trackArchiveEntry("config/env.enc.json", envBuffer.length);
    trackArchiveEntry("database/schema.json", schemaBuffer.length);
    archiveEntries.push(archiveEntryForBuffer("config/env.enc.json", envBuffer));
    archiveEntries.push(archiveEntryForBuffer("database/schema.json", schemaBuffer));
    await zip.addBuffer("config/env.enc.json", envBuffer);
    await zip.addBuffer("database/schema.json", schemaBuffer);

    for (const table of database.tables) {
      const rows = await listRows(client, table.schema, table.name);
      const tableBuffer = Buffer.from(JSON.stringify(rows));
      trackArchiveEntry(table.archivePath, tableBuffer.length);
      archiveEntries.push(archiveEntryForBuffer(table.archivePath, tableBuffer));
      await zip.addBuffer(table.archivePath, tableBuffer);
    }

    for (const file of storageFiles) {
      const root = storageRoots.find((candidate) => candidate.id === file.rootId);
      if (!root) {
        throw new Error(`Missing storage root for ${file.archivePath}`);
      }
      if (file.crc32 === undefined) {
        throw new Error(`Missing CRC32 for ${file.archivePath}`);
      }
      trackArchiveEntry(file.archivePath, file.byteSize);
      await zip.addFile(file.archivePath, file.stagedPath, file.byteSize, file.crc32);
      archiveEntries.push({
        archivePath: file.archivePath,
        byteSize: file.byteSize,
        sha256: file.sha256,
      });
    }

    const manifest = buildBackupV3Manifest({
      appName: packageMetadata.name,
      packageVersion: packageMetadata.version,
      gitCommit,
      createdAt,
      initiatedByUserId: options.currentUserId,
      database,
      storageRoots,
      archiveEntries,
      files: storageFiles,
      envVariableNames: Object.keys(envVariables),
      limits,
    });
    await zip.addBuffer("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    await zip.finish();
    await endWritable(options.output);
    await client.query("commit");

    return { backupName, manifest };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    client.release();
  }
}
