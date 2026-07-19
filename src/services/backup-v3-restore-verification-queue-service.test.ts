import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { pool } from "../db/pool.js";
import { queueScheduledBackupV3RestoreVerification } from "./backup-v3-restore-verification-queue-service.js";

test("scheduled restore verification queues once per schedule until the queued verification is resolved", async () => {
  const destinationId = crypto.randomUUID();
  const scheduleId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const artifactId = crypto.randomUUID();
  const copyAttemptId = crypto.randomUUID();
  try {
    await pool.query("insert into backup_destination_profiles (destination_id,name,destination_type,config) values ($1::uuid,$2,'local','{}'::jsonb)", [destinationId, `restore verify ${destinationId}`]);
    await pool.query("insert into backup_schedules (schedule_id,name,frequency,time_of_day,timezone,destination_ids,restore_verification_frequency) values ($1::uuid,$2,'daily','01:00','Africa/Tripoli',$3::uuid[],'weekly')", [scheduleId, `restore verify ${scheduleId}`, [destinationId]]);
    await pool.query("insert into backup_jobs (job_id,status,source_schedule_id,requested_destination_ids,completed_at) values ($1::uuid,'completed',$2::uuid,$3::uuid[],now())", [jobId, scheduleId, [destinationId]]);
    await pool.query("insert into backup_artifacts (artifact_id,job_id,archive_name,staging_path,byte_size,sha256,manifest) values ($1::uuid,$2::uuid,'backup.rispro.zip','/tmp/backup.rispro.zip',1,'abc','{}'::jsonb)", [artifactId, jobId]);
    await pool.query("insert into backup_destination_copy_attempts (copy_attempt_id,job_id,artifact_id,destination_id,status,remote_path,byte_size,sha256,completed_at) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'verified','/tmp/backup.rispro.zip',1,'abc',now())", [copyAttemptId, jobId, artifactId, destinationId]);
    const queued = await queueScheduledBackupV3RestoreVerification(jobId);
    assert.ok(queued);
    assert.equal(await queueScheduledBackupV3RestoreVerification(jobId), null);
    const result = await pool.query<{ status: string }>("select status from backup_restore_verification_jobs where restore_verification_job_id=$1::uuid", [queued]);
    assert.equal(result.rows[0]?.status, "queued");
  } finally {
    await pool.query("delete from backup_restore_verification_jobs where source_schedule_id=$1::uuid", [scheduleId]).catch(() => undefined);
    await pool.query("delete from backup_destination_copy_attempts where copy_attempt_id=$1::uuid", [copyAttemptId]).catch(() => undefined);
    await pool.query("delete from backup_jobs where job_id=$1::uuid", [jobId]).catch(() => undefined);
    await pool.query("delete from backup_schedules where schedule_id=$1::uuid", [scheduleId]).catch(() => undefined);
    await pool.query("delete from backup_destination_profiles where destination_id=$1::uuid", [destinationId]).catch(() => undefined);
  }
});
