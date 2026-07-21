import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getProjectRootDir } from "./document-storage-path.js";
import { classifyBackupV3MigrationHistory } from "./backup-v3-historical-compatibility.js";
import type { BackupV3Manifest } from "./backup-v3-types.js";

const execFileAsync = promisify(execFile);
const migrationDir = path.join(getProjectRootDir(), "src", "db", "migrations");
async function currentHistory() { return (await fs.readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort(); }
function databaseTarget(url: URL) {
  return {
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
  };
}
export function validateBackupV3RehearsalDatabaseUrl(value = process.env.BACKUP_V3_REHEARSAL_DATABASE_URL || "", productionValue = process.env.DATABASE_URL || "") {
  if (!value) throw new HttpError(503, "Historical rehearsal requires BACKUP_V3_REHEARSAL_DATABASE_URL.");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new HttpError(500, "Historical rehearsal database must be a valid PostgreSQL URL."); }
  const target = databaseTarget(parsed);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !target.database || !/rehearsal/i.test(target.database)) throw new HttpError(500, "Historical rehearsal database must be a dedicated rehearsal database.");
  if (productionValue) {
    let production: URL;
    try { production = new URL(productionValue); } catch { throw new HttpError(500, "Production database configuration is invalid."); }
    const productionTarget = databaseTarget(production);
    if (target.host === productionTarget.host && target.port === productionTarget.port && target.database === productionTarget.database) throw new HttpError(500, "Historical rehearsal database must not be the production database.");
  }
  return parsed;
}
function rehearsalUrl() { return validateBackupV3RehearsalDatabaseUrl(); }
function databaseName() { return `rispro_rehearsal_${crypto.randomUUID().replace(/-/g, "")}`; }
export async function createBackupV3MigrationRehearsal(previewJobId: string) {
  const preview = await pool.query<{ status: string; compatibility_classification: string | null; archive_path: string | null }>("select status,compatibility_classification,archive_path from backup_restore_preview_jobs where preview_job_id=$1::uuid", [previewJobId]); const row = preview.rows[0];
  if (!row || row.status !== "succeeded" || row.compatibility_classification !== "older_supported" || !row.archive_path) throw new HttpError(409, "Migration rehearsal requires a successful older-supported preview.");
  const id = crypto.randomUUID(); await pool.query("insert into backup_restore_migration_rehearsals (rehearsal_id,preview_job_id,status,compatibility_classification,target_migrations) values ($1::uuid,$2::uuid,'queued','older_supported',$3::jsonb)", [id, previewJobId, JSON.stringify(await currentHistory())]); return getBackupV3MigrationRehearsal(id);
}
export async function getBackupV3MigrationRehearsal(id: string) { const result = await pool.query("select * from backup_restore_migration_rehearsals where rehearsal_id=$1::uuid", [id]); if (!result.rows[0]) throw new HttpError(404, "Migration rehearsal was not found."); return result.rows[0]; }
export async function runNextBackupV3MigrationRehearsal() {
  const claim = await pool.query<{ rehearsal_id: string; preview_job_id: string }>("with candidate as (select rehearsal_id from backup_restore_migration_rehearsals where status='queued' order by created_at for update skip locked limit 1) update backup_restore_migration_rehearsals r set status='running',progress=5 from candidate where r.rehearsal_id=candidate.rehearsal_id returning r.rehearsal_id,r.preview_job_id"); const job = claim.rows[0]; if (!job) return false;
  let admin: Client | null = null; let isolated: Client | null = null; let name = "";
  try { const preview = await pool.query<{ archive_path: string }>("select archive_path from backup_restore_preview_jobs where preview_job_id=$1::uuid", [job.preview_job_id]); const archivePath = preview.rows[0]?.archive_path; if (!archivePath) throw new Error("Preview artifact is unavailable."); const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(archivePath), "staged", "manifest.json"), "utf8")) as BackupV3Manifest; const history = await currentHistory(); const compatibility = classifyBackupV3MigrationHistory(manifest, history); if (compatibility.classification !== "older_supported" || !manifest.postgresDump) throw new Error(compatibility.message); const base = rehearsalUrl(); name = databaseName(); const adminUrl = new URL(base.toString()); adminUrl.pathname = "/postgres"; admin = new Client({ connectionString: adminUrl.toString() }); await admin.connect(); await admin.query(`create database ${name}`); const target = new URL(base.toString()); target.pathname = `/${name}`; await pool.query("update backup_restore_migration_rehearsals set progress=25,source_migrations=$2::jsonb where rehearsal_id=$1::uuid", [job.rehearsal_id, JSON.stringify(manifest.database.migrationHistory)]); await execFileAsync("pg_restore", ["--exit-on-error", "--single-transaction", "--dbname", target.toString(), path.join(path.dirname(archivePath), "staged", manifest.postgresDump.archivePath)]); isolated = new Client({ connectionString: target.toString() }); await isolated.connect(); const restored = (await isolated.query<{ filename: string }>("select filename from schema_migrations order by applied_at,filename")).rows.map((row) => row.filename); if (JSON.stringify(restored) !== JSON.stringify(manifest.database.migrationHistory)) throw new Error("Restored schema_migrations does not match the backup manifest."); for (const file of history.slice(restored.length)) { await isolated.query("begin"); try { await isolated.query(await fs.readFile(path.join(migrationDir, file), "utf8")); await isolated.query("insert into schema_migrations(filename) values($1)", [file]); await isolated.query("commit"); } catch (error) { await isolated.query("rollback"); throw error; } } const applied = (await isolated.query<{ filename: string }>("select filename from schema_migrations order by applied_at,filename")).rows.map((row) => row.filename); if (JSON.stringify(applied) !== JSON.stringify(history)) throw new Error("Rehearsal migration list is incomplete or inconsistent."); const fk = await isolated.query<{ count: string }>("select count(*) from pg_constraint where contype='f' and not convalidated"); const tables = await isolated.query<{ count: string }>("select count(*) from information_schema.tables where table_schema in ('public','appointments_v2','doctor_portal')"); if (Number(fk.rows[0]?.count || 0)) throw new Error("Rehearsal has invalid foreign keys."); await pool.query("update backup_restore_migration_rehearsals set status='succeeded',progress=100,applied_migrations=$2::jsonb,validation_results=$3::jsonb,promotion_ready=true,cleanup_status='completed',completed_at=now(),cleanup_at=now() where rehearsal_id=$1::uuid", [job.rehearsal_id, JSON.stringify(applied), JSON.stringify({ foreignKeysValid: true, tableCount: Number(tables.rows[0]?.count || 0), productionDatabaseUsed: false })]); return true;
  } catch (error) { await pool.query("update backup_restore_migration_rehearsals set status='failed',progress=100,errors=$2::jsonb,cleanup_status='completed',completed_at=now(),cleanup_at=now() where rehearsal_id=$1::uuid", [job.rehearsal_id, JSON.stringify([error instanceof Error ? error.message : "Migration rehearsal failed."])]); return true;
  } finally { await isolated?.end().catch(() => undefined); if (admin && name) await admin.query(`drop database if exists ${name}`).catch(() => undefined); await admin?.end().catch(() => undefined); }
}
