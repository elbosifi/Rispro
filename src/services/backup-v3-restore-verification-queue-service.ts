import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pool } from "../db/pool.js";
import { getBackupArchivePassphrase, getBackupDestinationCredentials } from "./backup-v3-control-center-service.js";
import { verifyBackupV3Restore } from "./backup-v3-restore-verification-service.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import type { NullableUserId } from "../types/http.js";
import { retrieveBackupV3FromLocalDestination } from "./backup-v3-local-destination.js";
import { retrieveBackupV3FromSmbDestination } from "./backup-v3-smb-destination.js";
import { retrieveBackupV3FromSftpDestination } from "./backup-v3-sftp-destination.js";
import { retrieveBackupV3FromWebDavDestination } from "./backup-v3-webdav-destination.js";
import { cleanupBackupV3RetrievedCopy } from "./backup-v3-retrieval.js";

export async function queueScheduledBackupV3RestoreVerification(jobId: string): Promise<string | null> {
  const { rows } = await pool.query<{ artifact_id: string; source_schedule_id: string; restore_verification_frequency: "disabled" | "weekly" | "monthly" }>(
    `select artifact.artifact_id,job.source_schedule_id,schedule.restore_verification_frequency
     from backup_jobs job join backup_artifacts artifact on artifact.artifact_id=coalesce(job.reused_artifact_id,(select source.artifact_id from backup_artifacts source where source.job_id=job.job_id)) join backup_schedules schedule on schedule.schedule_id=job.source_schedule_id
     where job.job_id=$1::uuid and job.status='completed'`,
    [jobId]
  );
  const source = rows[0];
  if (!source || source.restore_verification_frequency === "disabled") return null;
  const interval = source.restore_verification_frequency === "weekly" ? "7 days" : "30 days";
  const recent = await pool.query("select 1 from backup_restore_verification_jobs where source_schedule_id=$1::uuid and ((status in ('queued','running')) or (status='completed' and completed_at > now() - $2::interval)) limit 1", [source.source_schedule_id, interval]);
  if (recent.rowCount) return null;
  const copy = await pool.query<{ copy_attempt_id: string; destination_id: string; destination_type: string }>(`select copy.copy_attempt_id,copy.destination_id,profile.destination_type from backup_destination_copy_attempts copy join backup_destination_profiles profile on profile.destination_id=copy.destination_id where copy.artifact_id=$1::uuid and copy.status='verified' order by (profile.destination_type <> 'local') desc,copy.completed_at desc limit 1`, [source.artifact_id]);
  if (!copy.rowCount) return null;
  const id = crypto.randomUUID();
  await pool.query("insert into backup_restore_verification_jobs (restore_verification_job_id,artifact_id,destination_id,copy_attempt_id,source_schedule_id,status,retrieval) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'queued',$6::jsonb)", [id, source.artifact_id, copy.rows[0].destination_id, copy.rows[0].copy_attempt_id, source.source_schedule_id, JSON.stringify({ selection: "scheduled", fallbackToLocal: copy.rows[0].destination_type === "local" })]);
  return id;
}

export async function queueManualBackupV3RestoreVerification(jobId: string, userId: NullableUserId, copyAttemptId?: string): Promise<string> {
  const { rows } = await pool.query<{ artifact_id: string; source_schedule_id: string | null }>(
    `select artifact.artifact_id,job.source_schedule_id from backup_jobs job join backup_artifacts artifact on artifact.artifact_id=coalesce(job.reused_artifact_id,(select source.artifact_id from backup_artifacts source where source.job_id=job.job_id))
     where job.job_id=$1::uuid and job.status='completed'`,
    [jobId]
  );
  const source = rows[0];
  if (!source) throw new HttpError(409, "Only a completed backup with a stored archive can be verified.");
  const copies = await pool.query<{ copy_attempt_id: string; destination_id: string }>("select copy_attempt_id,destination_id from backup_destination_copy_attempts where artifact_id=$1::uuid and status='verified' and ($2::uuid is null or copy_attempt_id=$2::uuid) order by completed_at desc limit 1", [source.artifact_id, copyAttemptId || null]);
  if (!copies.rowCount) throw new HttpError(409, "Select a successful destination copy for restore verification.");
  const active = await pool.query("select 1 from backup_restore_verification_jobs where artifact_id=$1::uuid and status in ('queued','running') limit 1", [source.artifact_id]);
  if (active.rowCount) throw new HttpError(409, "This backup already has a restore verification in progress.");
  const id = crypto.randomUUID();
  await pool.query("insert into backup_restore_verification_jobs (restore_verification_job_id,artifact_id,destination_id,copy_attempt_id,source_schedule_id,status,retrieval) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'queued',$6::jsonb)", [id, source.artifact_id, copies.rows[0].destination_id, copies.rows[0].copy_attempt_id, source.source_schedule_id, JSON.stringify({ selection: "manual" })]);
  await logAuditEntry({ entityType: "backup_restore_verification", actionType: "backup_restore_verification_queued", newValues: { jobId, restoreVerificationJobId: id, source: "manual" }, changedByUserId: userId });
  return id;
}

export async function retryFailedBackupV3RestoreVerification(restoreVerificationJobId: string, userId: NullableUserId): Promise<string> {
  const { rows } = await pool.query<{ artifact_id: string; destination_id: string | null; copy_attempt_id: string | null; source_schedule_id: string | null; status: string; retrieval: Record<string, unknown> }>("select artifact_id,destination_id,copy_attempt_id,source_schedule_id,status,retrieval from backup_restore_verification_jobs where restore_verification_job_id=$1::uuid", [restoreVerificationJobId]);
  const failed = rows[0];
  if (!failed) throw new HttpError(404, "Restore verification job was not found.");
  if (failed.status !== "failed") throw new HttpError(409, "Only failed restore verifications can be retried.");
  const id = crypto.randomUUID();
  if (!failed.copy_attempt_id || !failed.destination_id) throw new HttpError(409, "The failed verification has no destination copy to retry.");
  await pool.query("insert into backup_restore_verification_jobs (restore_verification_job_id,artifact_id,destination_id,copy_attempt_id,source_schedule_id,status,retrieval) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'queued',$6::jsonb)", [id, failed.artifact_id, failed.destination_id, failed.copy_attempt_id, failed.source_schedule_id, JSON.stringify({ ...failed.retrieval, retryOf: restoreVerificationJobId })]);
  await logAuditEntry({ entityType: "backup_restore_verification", actionType: "backup_restore_verification_retried", newValues: { restoreVerificationJobId, retryJobId: id }, changedByUserId: userId });
  return id;
}

export async function listBackupV3RestoreVerifications(limit = 50) {
  const { rows } = await pool.query(
    `select verify.restore_verification_job_id,verify.artifact_id,verify.destination_id,verify.copy_attempt_id,verify.source_schedule_id,verify.status,verify.report,verify.retrieval,verify.failure_message,verify.started_at,verify.completed_at,verify.created_at,
       artifact.job_id,artifact.archive_name,copy.remote_path,destination.destination_type,destination.name as destination_name
     from backup_restore_verification_jobs verify left join backup_artifacts artifact on artifact.artifact_id=verify.artifact_id
     left join backup_destination_copy_attempts copy on copy.copy_attempt_id=verify.copy_attempt_id left join backup_destination_profiles destination on destination.destination_id=verify.destination_id
     order by verify.created_at desc limit $1`,
    [Math.max(1, Math.min(limit, 200))]
  );
  return rows;
}

async function claimQueuedRestoreVerification() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `with candidate as (select restore_verification_job_id from backup_restore_verification_jobs where status='queued' order by created_at asc for update skip locked limit 1)
       update backup_restore_verification_jobs job set status='running',started_at=now(),updated_at=now() from candidate
       where job.restore_verification_job_id=candidate.restore_verification_job_id
       returning job.restore_verification_job_id,job.artifact_id,job.copy_attempt_id`
    );
    await client.query("commit");
    return rows[0] as { restore_verification_job_id: string; artifact_id: string; copy_attempt_id: string } | undefined;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function runNextBackupV3RestoreVerification(): Promise<boolean> {
  const job = await claimQueuedRestoreVerification();
  if (!job) return false;
  try {
    const { rows } = await pool.query<{ archive_name: string; sha256: string; byte_size: string; remote_path: string; destination_type: string; config: Record<string, unknown>; destination_id: string }>(`select artifact.archive_name,artifact.sha256,artifact.byte_size::text,copy.remote_path,profile.destination_type,profile.config,profile.destination_id from backup_artifacts artifact join backup_destination_copy_attempts copy on copy.copy_attempt_id=$2::uuid join backup_destination_profiles profile on profile.destination_id=copy.destination_id where artifact.artifact_id=$1::uuid and copy.status='verified'`, [job.artifact_id, job.copy_attempt_id]);
    const source = rows[0]; if (!source?.remote_path) throw new Error("Verified destination copy is unavailable for restore verification.");
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-destination-verify-"));
    let cleanupStatus = "cleaned";
    try {
      const expectedByteSize = Number(source.byte_size); const credentials = await getBackupDestinationCredentials(source.destination_id);
      const common = { remotePath: source.remote_path, archiveName: source.archive_name, expectedSha256: source.sha256, expectedByteSize, maximumByteSize: Number(process.env.BACKUP_V3_RESTORE_VERIFY_MAX_BYTES || 4 * 1024 ** 3), stagingDir, config: source.config };
      const retrieved = source.destination_type === "local" ? await retrieveBackupV3FromLocalDestination({ ...common, rootPath: String(source.config.rootPath || "") })
        : source.destination_type === "smb" ? await retrieveBackupV3FromSmbDestination({ ...common, credentials: { username: String(credentials.username || ""), password: String(credentials.password || "") } })
        : source.destination_type === "sftp" ? await retrieveBackupV3FromSftpDestination({ ...common, credentials: { password: typeof credentials.password === "string" ? credentials.password : undefined, privateKey: typeof credentials.privateKey === "string" ? credentials.privateKey : undefined, passphrase: typeof credentials.passphrase === "string" ? credentials.passphrase : undefined } })
        : source.destination_type === "nextcloud" ? await retrieveBackupV3FromWebDavDestination({ ...common, credentials: { appPassword: String(credentials.appPassword || "") } }) : await Promise.reject(new Error("Destination type is unavailable for restore verification."));
      const result = await verifyBackupV3Restore({ archivePath: retrieved.stagingPath, expectedSha256: source.sha256, passphrase: await getBackupArchivePassphrase() });
      cleanupStatus = await cleanupBackupV3RetrievedCopy(stagingDir);
      await pool.query("update backup_restore_verification_jobs set status='completed',report=$2::jsonb,retrieval=$3::jsonb,completed_at=now(),updated_at=now() where restore_verification_job_id=$1::uuid", [job.restore_verification_job_id, JSON.stringify(result), JSON.stringify({ status: "retrieved", remotePath: source.remote_path, expectedSha256: source.sha256, expectedByteSize, retrievedSha256: retrieved.sha256, retrievedByteSize: retrieved.byteSize, cleanupStatus, restoreDrillStatus: "completed" })]);
    } finally { await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => { cleanupStatus = "cleanup_failed"; }); }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : "Restore verification failed.";
    await pool.query("update backup_restore_verification_jobs set status='failed',failure_message=$2,completed_at=now(),updated_at=now() where restore_verification_job_id=$1::uuid", [job.restore_verification_job_id, message]);
  }
  return true;
}
