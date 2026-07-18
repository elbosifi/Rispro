import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { sha256File } from "./backup-v3-checksums.js";
import { getProjectRootDir } from "./document-storage-path.js";
import { previewBackupV3RestoreFromArchive } from "./backup-v3-preview-service.js";
import type { BackupV3Manifest } from "./backup-v3-types.js";

const execFileAsync = promisify(execFile);

export interface BackupV3RestoreVerificationEnvironment { databaseUrl: string; storageRoot: string; }
export interface BackupV3RestoreVerificationResult { ok: boolean; databaseTablesVerified: number; databaseRowsVerified: number; filesVerified: number; warnings: string[]; }

export interface BackupV3RestoreVerificationDependencies {
  validateArchive(input: { archivePath: string; passphrase: string; stagingDir: string; expectedSha256: string }): Promise<BackupV3Manifest>;
  restoreDatabase(dumpPath: string, databaseUrl: string): Promise<void>;
  verifyDatabase(manifest: BackupV3Manifest, databaseUrl: string): Promise<{ tables: number; rows: number }>;
  restoreAndVerifyFiles(manifest: BackupV3Manifest, stagingDir: string, storageRoot: string): Promise<number>;
}

function requireVerificationUrl(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new HttpError(503, "Restore verification database URL is not configured."); }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new HttpError(503, "Restore verification database URL must use PostgreSQL.");
  return parsed;
}

/** Refuses endpoints that could plausibly be the live RISpro database or storage. */
export function getBackupV3RestoreVerificationEnvironment(): BackupV3RestoreVerificationEnvironment {
  const databaseUrl = String(process.env.BACKUP_V3_RESTORE_VERIFY_DATABASE_URL || "").trim();
  const storageRoot = String(process.env.BACKUP_V3_RESTORE_VERIFY_STORAGE_ROOT || "").trim();
  const verification = requireVerificationUrl(databaseUrl);
  const production = requireVerificationUrl(env.databaseUrl);
  const databaseName = verification.pathname.replace(/^\//, "");
  if (!/^rispro_restore_verify(?:_[a-z0-9_]+)?$/i.test(databaseName) || databaseUrl === env.databaseUrl || (verification.hostname === production.hostname && verification.port === production.port && verification.pathname === production.pathname)) {
    throw new HttpError(503, "Restore verification database target is not a dedicated disposable database.");
  }
  const resolvedStorage = path.resolve(storageRoot);
  const projectStorage = path.resolve(getProjectRootDir(), "storage");
  const uploads = path.resolve(env.uploadsDir);
  if (!storageRoot || !/restore[-_]?verify/i.test(path.basename(resolvedStorage)) || resolvedStorage === projectStorage || resolvedStorage.startsWith(`${projectStorage}${path.sep}`) || resolvedStorage === uploads || resolvedStorage.startsWith(`${uploads}${path.sep}`)) {
    throw new HttpError(503, "Restore verification storage target is not a dedicated disposable path.");
  }
  return { databaseUrl, storageRoot: resolvedStorage };
}

function pgEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const parsed = requireVerificationUrl(databaseUrl);
  return { ...process.env, PGHOST: parsed.hostname, PGPORT: parsed.port || "5432", PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: parsed.pathname.replace(/^\//, "") };
}

const defaultDependencies: BackupV3RestoreVerificationDependencies = {
  async validateArchive({ archivePath, passphrase, stagingDir, expectedSha256 }) {
    const digest = await sha256File(archivePath);
    if (digest.sha256 !== expectedSha256) throw new HttpError(400, "Stored backup checksum verification failed.");
    const preview = await previewBackupV3RestoreFromArchive(archivePath, stagingDir, passphrase);
    if (!preview.ok) throw new HttpError(400, `Stored backup validation failed: ${preview.errors.join("; ")}`);
    const manifest = JSON.parse(await fs.readFile(path.join(stagingDir, "manifest.json"), "utf8")) as BackupV3Manifest;
    if (!manifest.postgresDump || manifest.postgresDump.archivePath !== "database/postgresql.dump") throw new HttpError(400, "Automated backup does not contain a PostgreSQL custom dump.");
    return manifest;
  },
  async restoreDatabase(dumpPath, databaseUrl) {
    await execFileAsync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", dumpPath], { env: pgEnvironment(databaseUrl) });
  },
  async verifyDatabase(manifest, databaseUrl) {
    const target = new Pool({ connectionString: databaseUrl });
    try {
      let rows = 0;
      for (const table of manifest.database.tables) {
        const qualified = `"${table.schema.replace(/"/g, '""')}"."${table.name.replace(/"/g, '""')}"`;
        const result = await target.query<{ count: string }>(`select count(*)::text as count from ${qualified}`);
        const count = Number(result.rows[0]?.count || 0);
        if (count !== table.rowCount) throw new HttpError(400, `Restore verification row count differs for ${table.schema}.${table.name}.`);
        rows += count;
      }
      return { tables: manifest.database.tables.length, rows };
    } finally { await target.end(); }
  },
  async restoreAndVerifyFiles(manifest, stagingDir, storageRoot) {
    const runRoot = path.join(storageRoot, `restore-verify-${crypto.randomUUID()}`);
    let verified = 0;
    try {
      await fs.mkdir(runRoot, { recursive: true });
      for (const file of manifest.files) {
        const source = path.join(stagingDir, file.archivePath);
        const target = path.join(runRoot, file.archivePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
        const digest = await sha256File(target);
        if (digest.sha256 !== file.sha256 || digest.byteSize !== file.byteSize) throw new HttpError(400, `Restore verification file checksum differs for ${file.archivePath}.`);
        verified += 1;
      }
      return verified;
    } finally { await fs.rm(runRoot, { recursive: true, force: true }).catch(() => undefined); }
  },
};

export async function verifyBackupV3Restore(input: { archivePath: string; expectedSha256: string; passphrase: string; environment?: BackupV3RestoreVerificationEnvironment }, dependencies: BackupV3RestoreVerificationDependencies = defaultDependencies): Promise<BackupV3RestoreVerificationResult> {
  const environment = input.environment || getBackupV3RestoreVerificationEnvironment();
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-restore-verify-"));
  try {
    const manifest = await dependencies.validateArchive({ archivePath: input.archivePath, passphrase: input.passphrase, stagingDir, expectedSha256: input.expectedSha256 });
    const dumpPath = path.join(stagingDir, "database/postgresql.dump");
    await dependencies.restoreDatabase(dumpPath, environment.databaseUrl);
    const database = await dependencies.verifyDatabase(manifest, environment.databaseUrl);
    const filesVerified = await dependencies.restoreAndVerifyFiles(manifest, stagingDir, environment.storageRoot);
    return { ok: true, databaseTablesVerified: database.tables, databaseRowsVerified: database.rows, filesVerified, warnings: [] };
  } finally { await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined); }
}
