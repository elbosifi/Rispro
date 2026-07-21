import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { pool } from "../db/pool.js";
import { recordDiagnosticEvent } from "./system-diagnostics-service.js";
import { sha256File } from "./backup-v3-checksums.js";
import { streamBackupV3Archive } from "./backup-v3-service.js";
import { copyBackupV3ToLocalDestination } from "./backup-v3-local-destination.js";
import { copyBackupV3ToWebDavDestination } from "./backup-v3-webdav-destination.js";
import { copyBackupV3ToSftpDestination } from "./backup-v3-sftp-destination.js";
import { copyBackupV3ToSmbDestination } from "./backup-v3-smb-destination.js";
import { runAutomaticBackupV3Retention } from "./backup-v3-retention-service.js";
import { queueScheduledBackupV3RestoreVerification, runNextBackupV3RestoreVerification } from "./backup-v3-restore-verification-queue-service.js";
import { cleanupBackupV3RestoreJobs, recoverInterruptedBackupV3RestorePreviewJobs, runNextBackupV3RestorePreviewJob } from "./backup-v3-restore-jobs-service.js";
import { runNextBackupV3MigrationRehearsal } from "./backup-v3-migration-rehearsal-service.js";
import { backupV3ScheduleSlot, nextBackupV3ScheduleRun } from "./backup-v3-scheduling.js";
import {
  claimNextBackupJob,
  completeBackupJobAfterCopies,
  ensureBackupStagingDirectory,
  ensureBackupArtifactDirectory,
  failBackupJob,
  getBackupArchivePassphrase,
  getBackupArtifactForCopyOnlyRetry,
  getBackupDestinationCredentials,
  getBackupJobDestinations,
  markBackupJobGenerated,
  recordBackupDestinationCopy,
  recordBackupWorkerHeartbeat,
  recoverStaleBackupJobs,
  queueBackupJob,
  updateBackupJobHeartbeat,
} from "./backup-v3-control-center-service.js";

export interface BackupV3Worker {
  stop(): Promise<void>;
}

const ADVISORY_LOCK_KEY = 9_274_001;
let intervalHandle: NodeJS.Timeout | null = null;
let running = false;
let stopped = false;
const instanceId = `backup-v3-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;

function intervalMs(): number {
  const value = Number(process.env.BACKUP_V3_WORKER_INTERVAL_MS || 60_000);
  return Number.isInteger(value) && value >= 10_000 ? Math.min(value, 300_000) : 60_000;
}

async function queueDueSchedules(now = new Date()): Promise<void> {
  const { rows } = await pool.query<{
    schedule_id: string; frequency: "daily" | "weekdays" | "weekly" | "monthly"; time_of_day: string; timezone: string;
    selected_weekdays: number[]; selected_day_of_month: number | null; destination_ids: string[]; last_scheduled_slot: string | null; next_run_at: Date | null;
  }>("select schedule_id,frequency,time_of_day,timezone,selected_weekdays,selected_day_of_month,destination_ids,last_scheduled_slot,next_run_at from backup_schedules where enabled=true and (next_run_at is null or next_run_at <= $1) order by next_run_at nulls first", [now]);
  for (const schedule of rows) {
    const timing = { frequency: schedule.frequency, timeOfDay: schedule.time_of_day, timezone: schedule.timezone, selectedWeekdays: schedule.selected_weekdays, selectedDayOfMonth: schedule.selected_day_of_month };
    const dueAt = schedule.next_run_at || now;
    const slot = backupV3ScheduleSlot(timing, dueAt);
    const nextRunAt = nextBackupV3ScheduleRun(timing, dueAt);
    const claimed = await pool.query(
      "update backup_schedules set last_scheduled_slot=$2,last_run_at=$3,next_run_at=$4,updated_at=now() where schedule_id=$1::uuid and enabled=true and coalesce(last_scheduled_slot,'') <> $2 returning schedule_id",
      [schedule.schedule_id, slot, dueAt, nextRunAt]
    );
    if (claimed.rowCount) await queueBackupJob({ initiatedByUserId: null, sourceScheduleId: schedule.schedule_id, destinationIds: schedule.destination_ids });
  }
}

async function generateAndCopyJob(): Promise<void> {
  const lockClient = await pool.connect();
  let acquired = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [ADVISORY_LOCK_KEY]);
    acquired = lock.rows[0]?.locked === true;
    if (!acquired) return;
    const job = await claimNextBackupJob();
    if (!job) return;
    let temporaryArchivePath: string | null = null;
    try {
      let archiveName: string;
      let archivePath: string;
      let artifactId: string;
      let digest: Awaited<ReturnType<typeof sha256File>>;
      if (job.reused_artifact_id) {
        const artifact = await getBackupArtifactForCopyOnlyRetry(job.job_id);
        archiveName = artifact.archiveName;
        archivePath = artifact.stagingPath;
        artifactId = artifact.artifactId;
        digest = { byteSize: artifact.byteSize, sha256: artifact.sha256, crc32: 0 };
      } else {
        const stagingDir = await ensureBackupStagingDirectory();
        const artifactDir = await ensureBackupArtifactDirectory();
        archiveName = `rispro-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${job.job_id}.rispro.zip`;
        temporaryArchivePath = path.join(stagingDir, `.${archiveName}.${crypto.randomUUID()}.part`);
        archivePath = path.join(artifactDir, archiveName);
        const output = fs.createWriteStream(temporaryArchivePath, { flags: "wx" });
        const passphrase = await getBackupArchivePassphrase();
        const result = await streamBackupV3Archive({
          currentUserId: job.initiated_by_user_id,
          passphrase,
          output,
          backupName: archiveName,
          includePostgresDump: true,
        });
        await fsp.rename(temporaryArchivePath, archivePath);
        temporaryArchivePath = null;
        await updateBackupJobHeartbeat(job.job_id);
        digest = await sha256File(archivePath);
        artifactId = await markBackupJobGenerated({ jobId: job.job_id, archiveName, stagingPath: archivePath, byteSize: digest.byteSize, sha256: digest.sha256, manifest: result.manifest });
      }
      const destinations = await getBackupJobDestinations(job.job_id);
      for (const destination of destinations) {
        await recordBackupDestinationCopy({ jobId: job.job_id, artifactId, destinationId: destination.destination_id, status: "copying" });
        try {
          if (!destination.enabled) throw new Error("Backup destination is disabled.");
          const copy = destination.destination_type === "local"
            ? await copyBackupV3ToLocalDestination({ sourcePath: archivePath, archiveName, rootPath: typeof destination.config.rootPath === "string" ? destination.config.rootPath : "", expectedSha256: digest.sha256, expectedByteSize: digest.byteSize })
            : destination.destination_type === "nextcloud"
              ? await copyBackupV3ToWebDavDestination({ sourcePath: archivePath, archiveName, expectedSha256: digest.sha256, expectedByteSize: digest.byteSize, config: destination.config, credentials: getNextcloudCredentials(await getBackupDestinationCredentials(destination.destination_id)) })
              : destination.destination_type === "sftp"
                ? await copyBackupV3ToSftpDestination({ sourcePath: archivePath, archiveName, expectedSha256: digest.sha256, expectedByteSize: digest.byteSize, config: destination.config, credentials: getSftpCredentials(await getBackupDestinationCredentials(destination.destination_id)) })
                : destination.destination_type === "smb"
                  ? await copyBackupV3ToSmbDestination({ sourcePath: archivePath, archiveName, expectedSha256: digest.sha256, expectedByteSize: digest.byteSize, config: destination.config, credentials: getSmbCredentials(await getBackupDestinationCredentials(destination.destination_id)) })
                : await Promise.reject(new Error(`Backup destination type ${destination.destination_type} is not available in this worker.`));
          await recordBackupDestinationCopy({ jobId: job.job_id, artifactId, destinationId: destination.destination_id, status: "verified", remotePath: copy.remotePath, byteSize: copy.byteSize, sha256: copy.sha256 });
        } catch (error) {
          await recordBackupDestinationCopy({ jobId: job.job_id, artifactId, destinationId: destination.destination_id, status: "failed", failureMessage: error instanceof Error ? error.message : "Destination copy failed." });
        }
      }
      const status = await completeBackupJobAfterCopies(job.job_id);
      recordDiagnosticEvent({ severity: status === "completed" ? "info" : "error", source: "backup_restore", component: "backup_worker", operation: status, message: status === "completed" ? "Automated Backup V3 completed." : "Automated Backup V3 generated but one or more destination copies failed.", metadata: { jobId: job.job_id, destinationCount: destinations.length } });
      if (status === "completed") {
        await queueScheduledBackupV3RestoreVerification(job.job_id).catch((error) => recordDiagnosticEvent({ severity: "warning", source: "backup_restore", component: "restore_verification", operation: "queue_failed", message: "Restore verification could not be queued.", technicalDetails: error instanceof Error ? error.message : error, metadata: { jobId: job.job_id } }));
        try {
          const retention = await runAutomaticBackupV3Retention(job.job_id);
          if (retention.deleted) recordDiagnosticEvent({ severity: "info", source: "backup_restore", component: "backup_retention", operation: "completed", message: "Backup retention completed.", metadata: { jobId: job.job_id, deleted: retention.deleted, retained: retention.retained } });
        } catch (error) {
          recordDiagnosticEvent({ severity: "warning", source: "backup_restore", component: "backup_retention", operation: "failed", message: "Backup retention failed; existing verified backups were preserved.", technicalDetails: error instanceof Error ? error.message : error, metadata: { jobId: job.job_id } });
        }
      }
    } catch (error) {
      if (temporaryArchivePath) await fsp.rm(temporaryArchivePath, { force: true }).catch(() => undefined);
      await failBackupJob(job.job_id, error);
      recordDiagnosticEvent({ severity: "error", source: "backup_restore", component: "backup_worker", operation: "failed", message: "Automated Backup V3 failed.", technicalDetails: error instanceof Error ? error.message : error, metadata: { jobId: job.job_id } });
    }
  } finally {
    if (acquired) await lockClient.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    lockClient.release();
  }
}

function getNextcloudCredentials(credentials: Record<string, unknown>): { appPassword: string } {
  const appPassword = typeof credentials.appPassword === "string" ? credentials.appPassword : "";
  if (!appPassword) throw new Error("Nextcloud app password is missing.");
  return { appPassword };
}

function getSftpCredentials(credentials: Record<string, unknown>): { password?: string; privateKey?: string; passphrase?: string } {
  return {
    ...(typeof credentials.password === "string" ? { password: credentials.password } : {}),
    ...(typeof credentials.privateKey === "string" ? { privateKey: credentials.privateKey } : {}),
    ...(typeof credentials.passphrase === "string" ? { passphrase: credentials.passphrase } : {}),
  };
}

function getSmbCredentials(credentials: Record<string, unknown>): { username: string; password: string } {
  const username = typeof credentials.username === "string" ? credentials.username : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (!username || !password) throw new Error("SMB username and password are missing.");
  return { username, password };
}

export async function runBackupV3WorkerTick(): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    await recordBackupWorkerHeartbeat(instanceId);
    await recoverStaleBackupJobs();
    await queueDueSchedules();
    await generateAndCopyJob();
    await runNextBackupV3RestoreVerification();
    await runNextBackupV3RestorePreviewJob();
    await runNextBackupV3MigrationRehearsal();
    await cleanupBackupV3RestoreJobs();
    await recordBackupWorkerHeartbeat(instanceId);
  } catch (error) {
    await recordBackupWorkerHeartbeat(instanceId, error instanceof Error ? error.message.slice(0, 1_000) : "Backup worker tick failed.").catch(() => undefined);
    throw error;
  } finally {
    running = false;
  }
}

export async function startBackupV3Worker(): Promise<BackupV3Worker> {
  stopped = false;
  await recoverInterruptedBackupV3RestorePreviewJobs();
  await runBackupV3WorkerTick().catch((error) => console.error("Backup V3 worker startup tick failed.", error));
  intervalHandle = setInterval(() => { void runBackupV3WorkerTick().catch((error) => console.error("Backup V3 worker tick failed.", error)); }, intervalMs());
  intervalHandle.unref();
  return {
    async stop() {
      stopped = true;
      if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
      while (running) await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}
