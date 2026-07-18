import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import { getBackupArchivePassphrase } from "./backup-v3-control-center-service.js";
import { verifyBackupV3Restore } from "./backup-v3-restore-verification-service.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import type { NullableUserId } from "../types/http.js";

export async function queueScheduledBackupV3RestoreVerification(jobId: string): Promise<string | null> {
  const { rows } = await pool.query<{ artifact_id: string; source_schedule_id: string; restore_verification_frequency: "disabled" | "weekly" | "monthly" }>(
    `select artifact.artifact_id,job.source_schedule_id,schedule.restore_verification_frequency
     from backup_jobs job join backup_artifacts artifact on artifact.job_id=job.job_id join backup_schedules schedule on schedule.schedule_id=job.source_schedule_id
     where job.job_id=$1::uuid and job.status='completed'`,
    [jobId]
  );
  const source = rows[0];
  if (!source || source.restore_verification_frequency === "disabled") return null;
  const interval = source.restore_verification_frequency === "weekly" ? "7 days" : "30 days";
  const recent = await pool.query("select 1 from backup_restore_verification_jobs where source_schedule_id=$1::uuid and ((status in ('queued','running')) or (status='completed' and completed_at > now() - $2::interval)) limit 1", [source.source_schedule_id, interval]);
  if (recent.rowCount) return null;
  const id = crypto.randomUUID();
  await pool.query("insert into backup_restore_verification_jobs (restore_verification_job_id,artifact_id,source_schedule_id,status) values ($1::uuid,$2::uuid,$3::uuid,'queued')", [id, source.artifact_id, source.source_schedule_id]);
  return id;
}

export async function queueManualBackupV3RestoreVerification(jobId: string, userId: NullableUserId): Promise<string> {
  const { rows } = await pool.query<{ artifact_id: string; source_schedule_id: string | null }>(
    `select artifact.artifact_id,job.source_schedule_id from backup_jobs job join backup_artifacts artifact on artifact.job_id=job.job_id
     where job.job_id=$1::uuid and job.status='completed'`,
    [jobId]
  );
  const source = rows[0];
  if (!source) throw new HttpError(409, "Only a completed backup with a stored archive can be verified.");
  const active = await pool.query("select 1 from backup_restore_verification_jobs where artifact_id=$1::uuid and status in ('queued','running') limit 1", [source.artifact_id]);
  if (active.rowCount) throw new HttpError(409, "This backup already has a restore verification in progress.");
  const id = crypto.randomUUID();
  await pool.query("insert into backup_restore_verification_jobs (restore_verification_job_id,artifact_id,source_schedule_id,status) values ($1::uuid,$2::uuid,$3::uuid,'queued')", [id, source.artifact_id, source.source_schedule_id]);
  await logAuditEntry({ entityType: "backup_restore_verification", actionType: "backup_restore_verification_queued", newValues: { jobId, restoreVerificationJobId: id, source: "manual" }, changedByUserId: userId });
  return id;
}

export async function retryFailedBackupV3RestoreVerification(restoreVerificationJobId: string, userId: NullableUserId): Promise<string> {
  const { rows } = await pool.query<{ artifact_id: string; source_schedule_id: string | null; status: string }>("select artifact_id,source_schedule_id,status from backup_restore_verification_jobs where restore_verification_job_id=$1::uuid", [restoreVerificationJobId]);
  const failed = rows[0];
  if (!failed) throw new HttpError(404, "Restore verification job was not found.");
  if (failed.status !== "failed") throw new HttpError(409, "Only failed restore verifications can be retried.");
  const id = crypto.randomUUID();
  await pool.query("insert into backup_restore_verification_jobs (restore_verification_job_id,artifact_id,source_schedule_id,status) values ($1::uuid,$2::uuid,$3::uuid,'queued')", [id, failed.artifact_id, failed.source_schedule_id]);
  await logAuditEntry({ entityType: "backup_restore_verification", actionType: "backup_restore_verification_retried", newValues: { restoreVerificationJobId, retryJobId: id }, changedByUserId: userId });
  return id;
}

export async function listBackupV3RestoreVerifications(limit = 50) {
  const { rows } = await pool.query(
    `select verify.restore_verification_job_id,verify.artifact_id,verify.source_schedule_id,verify.status,verify.report,verify.failure_message,verify.started_at,verify.completed_at,verify.created_at,
       artifact.job_id,artifact.archive_name
     from backup_restore_verification_jobs verify left join backup_artifacts artifact on artifact.artifact_id=verify.artifact_id
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
       returning job.restore_verification_job_id,job.artifact_id`
    );
    await client.query("commit");
    return rows[0] as { restore_verification_job_id: string; artifact_id: string } | undefined;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function runNextBackupV3RestoreVerification(): Promise<boolean> {
  const job = await claimQueuedRestoreVerification();
  if (!job) return false;
  try {
    const { rows } = await pool.query<{ staging_path: string; sha256: string }>("select staging_path,sha256 from backup_artifacts where artifact_id=$1::uuid", [job.artifact_id]);
    const artifact = rows[0];
    if (!artifact) throw new Error("Backup artifact is unavailable for restore verification.");
    const result = await verifyBackupV3Restore({ archivePath: artifact.staging_path, expectedSha256: artifact.sha256, passphrase: await getBackupArchivePassphrase() });
    await pool.query("update backup_restore_verification_jobs set status='completed',report=$2::jsonb,completed_at=now(),updated_at=now() where restore_verification_job_id=$1::uuid", [job.restore_verification_job_id, JSON.stringify(result)]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : "Restore verification failed.";
    await pool.query("update backup_restore_verification_jobs set status='failed',failure_message=$2,completed_at=now(),updated_at=now() where restore_verification_job_id=$1::uuid", [job.restore_verification_job_id, message]);
  }
  return true;
}
