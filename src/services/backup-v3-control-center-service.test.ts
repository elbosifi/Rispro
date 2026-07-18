import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pool } from "../db/pool.js";
import {
  createBackupDestinationProfile,
  createBackupSchedule,
  cancelQueuedBackupJob,
  deleteBackupSchedule,
  getBackupArchivePassphrase,
  getBackupControlCenterSummary,
  listBackupSchedules,
  queueBackupJob,
  recordBackupDestinationCopy,
  recordBackupWorkerHeartbeat,
  retryBackupJob,
  getBackupArtifactForDownload,
  testBackupDestinationProfile,
  updateBackupArchivePassphrase,
  updateBackupDestinationProfile,
  updateBackupSchedule,
} from "./backup-v3-control-center-service.js";
import { sha256File } from "./backup-v3-checksums.js";

test("Backup V3 Control Center persists masked local destinations, schedules, encrypted passphrases, and durable jobs", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const root = path.join(process.cwd(), "storage", "backups");
  const originalMasterKey = process.env.BACKUP_V3_MASTER_KEY;
  process.env.BACKUP_V3_MASTER_KEY = "backup-v3-control-center-test-key";
  await fs.mkdir(root, { recursive: true });
  let destinationId: string | null = null;
  let scheduleId: string | null = null;
  let jobId: string | null = null;
  let retryJobId: string | null = null;
  let copyRetrySourceJobId: string | null = null;
  let artifactPath: string | null = null;
  try {
    const destination = await createBackupDestinationProfile({
      name: `Local test ${suffix}`,
      destinationType: "local",
      config: { rootPath: root },
      credentials: { ignoredByLocalAdapter: "not-returned" },
    }, null);
    destinationId = String((destination as Record<string, unknown>).destination_id);
    assert.equal(destination.credentialsConfigured, true);
    assert.equal((destination as Record<string, unknown>).encrypted_credentials, undefined);
    const connectivity = await testBackupDestinationProfile(destinationId);
    assert.equal(connectivity.ok, true);
    const pausedDestination = await updateBackupDestinationProfile(destinationId, { enabled: false }, null);
    assert.equal((pausedDestination as Record<string, unknown>).enabled, false);
    const resumedDestination = await updateBackupDestinationProfile(destinationId, { enabled: true }, null);
    assert.equal((resumedDestination as Record<string, unknown>).enabled, true);

    await updateBackupArchivePassphrase("safe-test-passphrase", null);
    assert.equal(await getBackupArchivePassphrase(), "safe-test-passphrase");
    const storedSecret = await pool.query<{ encrypted_value: string }>("select encrypted_value from backup_control_secrets where secret_name='archive_passphrase'");
    assert.doesNotMatch(storedSecret.rows[0]?.encrypted_value || "", /safe-test-passphrase/);

    const schedule = await createBackupSchedule({
      name: `Schedule test ${suffix}`,
      frequency: "daily",
      timeOfDay: "02:30",
      timezone: "Africa/Tripoli",
      destinationIds: [destinationId],
      retentionPolicy: { preset: "7_daily_4_weekly_12_monthly" },
    }, null);
    scheduleId = String(schedule.schedule_id);
    assert.ok(schedule.next_run_at);
    const pausedSchedule = await updateBackupSchedule(scheduleId, { enabled: false }, null);
    assert.equal(pausedSchedule.enabled, false);
    const schedules = await listBackupSchedules();
    assert.ok(schedules.some((entry) => String(entry.schedule_id) === scheduleId && entry.next_run_at === null));
    const resumedSchedule = await updateBackupSchedule(scheduleId, { enabled: true }, null);
    assert.ok(resumedSchedule.next_run_at);
    const job = await queueBackupJob({ initiatedByUserId: null, sourceScheduleId: scheduleId, destinationIds: [destinationId] });
    jobId = String(job.job_id);
    assert.equal(job.status, "queued");
    await cancelQueuedBackupJob(jobId, null);
    const cancelled = await pool.query<{ status: string }>("select status from backup_jobs where job_id=$1::uuid", [jobId]);
    assert.equal(cancelled.rows[0]?.status, "cancelled");
    await assert.rejects(() => retryBackupJob(jobId!, { initiatedByUserId: null }), /No stored backup artifact/);

    const copyRetrySource = await queueBackupJob({ initiatedByUserId: null, sourceScheduleId: scheduleId, destinationIds: [destinationId] });
    copyRetrySourceJobId = String(copyRetrySource.job_id);
    const artifactId = crypto.randomUUID();
    const artifactRoot = path.join(root, "artifacts");
    await fs.mkdir(artifactRoot, { recursive: true });
    artifactPath = path.join(artifactRoot, `retry-${suffix}.rispro.zip`);
    await fs.writeFile(artifactPath, "canonical archive bytes");
    const digest = await sha256File(artifactPath);
    await pool.query("update backup_jobs set status='failed',archive_name=$2,staging_path=$3,archive_size_bytes=$4,archive_sha256=$5,completed_at=now() where job_id=$1::uuid", [copyRetrySourceJobId, path.basename(artifactPath), artifactPath, digest.byteSize, digest.sha256]);
    await pool.query("insert into backup_artifacts (artifact_id,job_id,archive_name,staging_path,byte_size,sha256,manifest) values ($1::uuid,$2::uuid,$3,$4,$5,$6,'{}'::jsonb)", [artifactId, copyRetrySourceJobId, path.basename(artifactPath), artifactPath, digest.byteSize, digest.sha256]);
    await recordBackupDestinationCopy({ jobId: copyRetrySourceJobId, artifactId, destinationId, status: "failed", failureMessage: "SMB archive transfer timed out." });
    const retried = await retryBackupJob(copyRetrySourceJobId, { initiatedByUserId: null });
    retryJobId = String((retried as Record<string, unknown>).job_id);
    assert.equal((retried as Record<string, unknown>).retry_of_job_id, copyRetrySourceJobId);
    assert.equal((retried as Record<string, unknown>).reused_artifact_id, artifactId);
    const retryDestinations = await pool.query<{ requested_destination_ids: string[] }>("select requested_destination_ids from backup_jobs where job_id=$1::uuid", [retryJobId]);
    assert.deepEqual(retryDestinations.rows[0]?.requested_destination_ids, [destinationId]);
    const downloadable = await getBackupArtifactForDownload(retryJobId);
    assert.equal(downloadable.filePath, artifactPath);
    await fs.writeFile(artifactPath, "corrupted archive bytes");
    await assert.rejects(() => retryBackupJob(copyRetrySourceJobId!, { initiatedByUserId: null }), /checksum does not match/);
  } finally {
    if (retryJobId) await pool.query("delete from backup_jobs where job_id=$1::uuid", [retryJobId]);
    if (copyRetrySourceJobId) await pool.query("delete from backup_jobs where job_id=$1::uuid", [copyRetrySourceJobId]);
    if (jobId) await pool.query("delete from backup_jobs where job_id=$1::uuid", [jobId]);
    if (artifactPath) await fs.rm(artifactPath, { force: true });
    if (scheduleId) await deleteBackupSchedule(scheduleId, null).catch(() => undefined);
    if (destinationId) await pool.query("delete from backup_destination_profiles where destination_id=$1::uuid", [destinationId]);
    await pool.query("delete from backup_control_secrets where secret_name='archive_passphrase'");
    if (originalMasterKey === undefined) delete process.env.BACKUP_V3_MASTER_KEY;
    else process.env.BACKUP_V3_MASTER_KEY = originalMasterKey;
  }
});

test("Backup V3 Control Center rejects unapproved local destination paths", async () => {
  await assert.rejects(
    () => createBackupDestinationProfile({ name: `Unsafe ${Date.now()}`, destinationType: "local", config: { rootPath: path.resolve(process.cwd(), "..") } }, null),
    /administrator-approved backup root/
  );
});

test("Backup V3 Control Center rejects malformed destination and passphrase requests before persistence", async () => {
  await assert.rejects(
    () => createBackupDestinationProfile({ name: "", destinationType: "local", config: {} }, null),
    /Destination name is required/
  );
  await assert.rejects(
    () => createBackupDestinationProfile({ name: "Unsupported", destinationType: "tape", config: {} }, null),
    /Unsupported backup destination type/
  );
  await assert.rejects(
    () => updateBackupDestinationProfile("not-a-uuid", {}, null),
    /Invalid backup destination identifier/
  );
  await assert.rejects(
    () => updateBackupArchivePassphrase("short", null),
    /at least 8 characters/
  );
});

test("Backup V3 worker heartbeat accepts both successful and failed ticks", async () => {
  await recordBackupWorkerHeartbeat(`backup-v3-test-${Date.now()}`);
  let state = await pool.query<{ last_failure_message: string | null; last_successful_tick_at: Date | null }>("select last_failure_message,last_successful_tick_at from backup_worker_state where singleton_key=true");
  assert.equal(state.rows[0]?.last_failure_message, null);
  assert.ok(state.rows[0]?.last_successful_tick_at);
  await recordBackupWorkerHeartbeat(`backup-v3-test-${Date.now()}`, "test worker failure");
  const failedState = await pool.query<{ last_failure_message: string | null }>("select last_failure_message from backup_worker_state where singleton_key=true");
  assert.equal(failedState.rows[0]?.last_failure_message, "test worker failure");
});

test("Backup V3 control summary exposes safe health and staging signals", async () => {
  const summary = await getBackupControlCenterSummary() as Record<string, unknown>;
  assert.ok(["healthy", "warning", "critical"].includes(String(summary.health)));
  assert.ok(summary.staging_free_bytes === null || Number(summary.staging_free_bytes) > 0);
  assert.ok(Object.hasOwn(summary, "last_verified_copy"));
  assert.ok(Object.hasOwn(summary, "last_successful_restore_verification"));
  assert.ok(Object.hasOwn(summary, "next_schedule"));
});
