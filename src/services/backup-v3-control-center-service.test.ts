import assert from "node:assert/strict";
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
  recordBackupWorkerHeartbeat,
  retryBackupJob,
  testBackupDestinationProfile,
  updateBackupArchivePassphrase,
  updateBackupDestinationProfile,
  updateBackupSchedule,
} from "./backup-v3-control-center-service.js";

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
    const retried = await retryBackupJob(jobId, { initiatedByUserId: null });
    retryJobId = String((retried as Record<string, unknown>).job_id);
    assert.equal((retried as Record<string, unknown>).retry_of_job_id, jobId);
  } finally {
    if (retryJobId) await pool.query("delete from backup_jobs where job_id=$1::uuid", [retryJobId]);
    if (jobId) await pool.query("delete from backup_jobs where job_id=$1::uuid", [jobId]);
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
