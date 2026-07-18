import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import type { NullableUserId } from "../types/http.js";
import { getBackupDestinationCredentials, type BackupDestinationType } from "./backup-v3-control-center-service.js";
import { deleteBackupV3WebDavDestinationCopy } from "./backup-v3-webdav-destination.js";
import { deleteBackupV3SftpDestinationCopy } from "./backup-v3-sftp-destination.js";
import { deleteBackupV3SmbDestinationCopy } from "./backup-v3-smb-destination.js";

export interface BackupV3RetentionPolicy { daily: number; weekly: number; monthly: number; }
export interface BackupV3RetentionCopy {
  copyAttemptId: string;
  artifactId: string;
  createdAt: string;
  remotePath: string;
  verifiedCopyCount: number;
}

export interface BackupV3RetentionPlan { keep: Array<BackupV3RetentionCopy & { reason: string }>; delete: BackupV3RetentionCopy[]; }

function boundedCount(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) throw new HttpError(400, "Retention values must be whole numbers from 0 through 3650.");
  return parsed;
}

export function normalizeBackupV3RetentionPolicy(value: unknown): BackupV3RetentionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { daily: 0, weekly: 0, monthly: 0 };
  const record = value as Record<string, unknown>;
  const preset = String(record.preset || "");
  if (preset === "7_daily_4_weekly_12_monthly") return { daily: 7, weekly: 4, monthly: 12 };
  if (preset === "14_daily_12_monthly") return { daily: 14, weekly: 0, monthly: 12 };
  if (preset === "30_daily") return { daily: 30, weekly: 0, monthly: 0 };
  return { daily: boundedCount(record.daily), weekly: boundedCount(record.weekly), monthly: boundedCount(record.monthly) };
}

function dayKey(date: Date): string { return date.toISOString().slice(0, 10); }
function monthKey(date: Date): string { return date.toISOString().slice(0, 7); }
function weekKey(date: Date): string {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return `${value.getUTCFullYear()}-W${String(Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)).padStart(2, "0")}`;
}

export function planBackupV3Retention(copies: BackupV3RetentionCopy[], policyInput: unknown): BackupV3RetentionPlan {
  const policy = normalizeBackupV3RetentionPolicy(policyInput);
  const sorted = [...copies].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.copyAttemptId.localeCompare(a.copyAttemptId));
  const keep = new Map<string, BackupV3RetentionCopy & { reason: string }>();
  const protect = (copy: BackupV3RetentionCopy, reason: string) => { if (!keep.has(copy.copyAttemptId)) keep.set(copy.copyAttemptId, { ...copy, reason }); };
  if (sorted[0]) protect(sorted[0], "newest_verified_copy");
  const groups: Array<{ limit: number; key: (date: Date) => string; reason: string }> = [
    { limit: policy.daily, key: dayKey, reason: "daily_retention" },
    { limit: policy.weekly, key: weekKey, reason: "weekly_retention" },
    { limit: policy.monthly, key: monthKey, reason: "monthly_retention" },
  ];
  for (const group of groups) {
    const keptKeys = new Set<string>();
    for (const copy of sorted) {
      if (keptKeys.size >= group.limit) break;
      const key = group.key(new Date(copy.createdAt));
      if (!keptKeys.has(key)) { keptKeys.add(key); protect(copy, group.reason); }
    }
  }
  for (const copy of sorted) if (copy.verifiedCopyCount <= 1) protect(copy, "only_verified_copy_for_artifact");
  return { keep: [...keep.values()], delete: sorted.filter((copy) => !keep.has(copy.copyAttemptId)) };
}

function safeOwnedLocalArchive(rootPath: string, candidatePath: string): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(candidatePath);
  if (!target.startsWith(`${root}${path.sep}`) || path.basename(target) !== target.split(path.sep).pop() || !target.endsWith(".rispro.zip")) {
    throw new HttpError(400, "Retention refused to delete a path outside the configured local backup destination.");
  }
  return target;
}

export async function previewLocalBackupV3Retention(destinationId: string, policyInput: unknown): Promise<BackupV3RetentionPlan> {
  const { rows } = await pool.query<{
    copy_attempt_id: string; artifact_id: string; created_at: string; remote_path: string; verified_copy_count: string;
  }>(
    `select copy.copy_attempt_id,copy.artifact_id,copy.created_at,copy.remote_path,
       (select count(*) from backup_destination_copy_attempts sibling where sibling.artifact_id=copy.artifact_id and sibling.status='verified')::text as verified_copy_count
     from backup_destination_copy_attempts copy join backup_destination_profiles destination on destination.destination_id=copy.destination_id
     where copy.destination_id=$1::uuid and copy.status='verified' and copy.remote_path is not null
     order by copy.created_at desc`,
    [destinationId]
  );
  return planBackupV3Retention(rows.map((row) => ({ copyAttemptId: row.copy_attempt_id, artifactId: row.artifact_id, createdAt: new Date(row.created_at).toISOString(), remotePath: row.remote_path, verifiedCopyCount: Number(row.verified_copy_count) })), policyInput);
}

export async function getLocalBackupV3DestinationRoot(destinationId: string): Promise<string> {
  const { rows } = await pool.query<{ destination_type: string; config: Record<string, unknown> }>("select destination_type,config from backup_destination_profiles where destination_id=$1::uuid", [destinationId]);
  const destination = rows[0];
  if (!destination) throw new HttpError(404, "Backup destination was not found.");
  if (destination.destination_type !== "local") throw new HttpError(400, "Manual retention is currently available only for local backup destinations.");
  const rootPath = typeof destination.config.rootPath === "string" ? destination.config.rootPath : "";
  if (!rootPath) throw new HttpError(400, "Local backup destination is missing its configured root.");
  return rootPath;
}

export async function executeLocalBackupV3Retention(input: { destinationId: string; rootPath: string; policy: unknown; performedByUserId?: NullableUserId }): Promise<{ deleted: number; retained: number }> {
  const plan = await previewLocalBackupV3Retention(input.destinationId, input.policy);
  let deleted = 0;
  for (const copy of plan.delete) {
    const target = safeOwnedLocalArchive(input.rootPath, copy.remotePath);
    try {
      await fs.rm(target, { force: true });
      await pool.query("update backup_destination_copy_attempts set status='deleted',updated_at=now() where copy_attempt_id=$1::uuid and status='verified'", [copy.copyAttemptId]);
      await pool.query("insert into backup_retention_actions (retention_action_id,destination_id,artifact_id,action,reason,details,performed_by_user_id) values ($1::uuid,$2::uuid,$3::uuid,'delete','retention_policy',$4::jsonb,$5)", [crypto.randomUUID(), input.destinationId, copy.artifactId, JSON.stringify({ copyAttemptId: copy.copyAttemptId, remotePath: path.basename(target) }), input.performedByUserId || null]);
      deleted += 1;
    } catch (error) {
      await pool.query("insert into backup_retention_actions (retention_action_id,destination_id,artifact_id,action,reason,details,performed_by_user_id) values ($1::uuid,$2::uuid,$3::uuid,'failed','retention_delete_failed',$4::jsonb,$5)", [crypto.randomUUID(), input.destinationId, copy.artifactId, JSON.stringify({ copyAttemptId: copy.copyAttemptId }), input.performedByUserId || null]).catch(() => undefined);
      throw error;
    }
  }
  return { deleted, retained: plan.keep.length };
}

export async function executeManualLocalBackupV3Retention(input: { destinationId: string; policy: unknown; performedByUserId?: NullableUserId }): Promise<{ deleted: number; retained: number }> {
  const rootPath = await getLocalBackupV3DestinationRoot(input.destinationId);
  return executeLocalBackupV3Retention({ ...input, rootPath });
}

async function deleteBackupV3RemoteCopy(destination: { destinationType: BackupDestinationType; config: Record<string, unknown>; destinationId: string }, remotePath: string): Promise<void> {
  const credentials = await getBackupDestinationCredentials(destination.destinationId);
  if (destination.destinationType === "nextcloud") {
    const appPassword = typeof credentials.appPassword === "string" ? credentials.appPassword : "";
    await deleteBackupV3WebDavDestinationCopy({ remotePath, config: destination.config, credentials: { appPassword } });
  } else if (destination.destinationType === "sftp") {
    await deleteBackupV3SftpDestinationCopy({ remotePath, config: destination.config, credentials: { ...(typeof credentials.password === "string" ? { password: credentials.password } : {}), ...(typeof credentials.privateKey === "string" ? { privateKey: credentials.privateKey } : {}), ...(typeof credentials.passphrase === "string" ? { passphrase: credentials.passphrase } : {}) } });
  } else if (destination.destinationType === "smb") {
    const username = typeof credentials.username === "string" ? credentials.username : "";
    const password = typeof credentials.password === "string" ? credentials.password : "";
    await deleteBackupV3SmbDestinationCopy({ remotePath, config: destination.config, credentials: { username, password } });
  } else {
    throw new HttpError(501, "Retention deletion is not available for this destination type.");
  }
}

/** Executes the same verified-copy safety plan for local and supported network destinations. */
export async function executeBackupV3Retention(input: { destinationId: string; policy: unknown; performedByUserId?: NullableUserId }): Promise<{ deleted: number; retained: number }> {
  const { rows } = await pool.query<{ destination_type: BackupDestinationType; config: Record<string, unknown> }>("select destination_type,config from backup_destination_profiles where destination_id=$1::uuid", [input.destinationId]);
  const profile = rows[0];
  if (!profile) throw new HttpError(404, "Backup destination was not found.");
  if (profile.destination_type === "local") return executeManualLocalBackupV3Retention(input);
  if (profile.destination_type === "onedrive") throw new HttpError(501, "Retention deletion is unavailable until OneDrive support is configured.");
  const plan = await previewLocalBackupV3Retention(input.destinationId, input.policy);
  let deleted = 0;
  for (const copy of plan.delete) {
    try {
      await deleteBackupV3RemoteCopy({ destinationType: profile.destination_type, config: profile.config, destinationId: input.destinationId }, copy.remotePath);
      await pool.query("update backup_destination_copy_attempts set status='deleted',updated_at=now() where copy_attempt_id=$1::uuid and status='verified'", [copy.copyAttemptId]);
      await pool.query("insert into backup_retention_actions (retention_action_id,destination_id,artifact_id,action,reason,details,performed_by_user_id) values ($1::uuid,$2::uuid,$3::uuid,'delete','retention_policy',$4::jsonb,$5)", [crypto.randomUUID(), input.destinationId, copy.artifactId, JSON.stringify({ copyAttemptId: copy.copyAttemptId, remotePath: path.basename(copy.remotePath) }), input.performedByUserId || null]);
      deleted += 1;
    } catch (error) {
      await pool.query("insert into backup_retention_actions (retention_action_id,destination_id,artifact_id,action,reason,details,performed_by_user_id) values ($1::uuid,$2::uuid,$3::uuid,'failed','retention_delete_failed',$4::jsonb,$5)", [crypto.randomUUID(), input.destinationId, copy.artifactId, JSON.stringify({ copyAttemptId: copy.copyAttemptId }), input.performedByUserId || null]).catch(() => undefined);
      throw error;
    }
  }
  return { deleted, retained: plan.keep.length };
}

/** Runs only after a completed automated job; retention failure never changes backup success. */
export async function runAutomaticBackupV3Retention(jobId: string): Promise<{ deleted: number; retained: number }> {
  const { rows } = await pool.query<{ destination_id: string; retention_policy: unknown }>(
    `select destination.destination_id,destination.config,schedule.retention_policy
     from backup_jobs job join backup_schedules schedule on schedule.schedule_id=job.source_schedule_id
     join backup_destination_profiles destination on destination.destination_id = any(job.requested_destination_ids)
     where job.job_id=$1::uuid and job.status='completed' and destination.enabled=true and destination.destination_type in ('local','smb','sftp','nextcloud')`,
    [jobId]
  );
  let deleted = 0;
  let retained = 0;
  for (const destination of rows) {
    const result = await executeBackupV3Retention({ destinationId: destination.destination_id, policy: destination.retention_policy });
    deleted += result.deleted;
    retained += result.retained;
  }
  return { deleted, retained };
}
