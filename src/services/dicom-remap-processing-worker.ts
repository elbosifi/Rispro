import { randomUUID } from "node:crypto";
import {
  claimNextDicomRemapProcessingJob,
  cleanupExpiredDicomRemapStaging,
  releaseExpiredDicomRemapOrthancRecoveryClaims,
  processClaimedDicomRemapJob,
} from "./dicom-remap-service.js";
import type { DicomRemapJobRow } from "./dicom-remap-service.js";
import { readDicomRemapRetentionSettings } from "./dicom-remap-retention-settings-service.js";

export interface DicomRemapProcessingWorker {
  stop(): Promise<void>;
}

let intervalHandle: NodeJS.Timeout | null = null;
let tickRunning = false;
let stopped = false;
const workerId = `dicom-remap-processing-${process.pid}-${randomUUID()}`;
type ClaimJob = { job: DicomRemapJobRow; recovered: boolean } | null;
let claimJob = claimNextDicomRemapProcessingJob;
let processJob = processClaimedDicomRemapJob;
let cleanupStaging = cleanupExpiredDicomRemapStaging;
let releaseExpiredRecoveries = releaseExpiredDicomRemapOrthancRecoveryClaims;
let readRetentionSettings = readDicomRemapRetentionSettings;

function databaseNameFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

function assertWorkerDatabaseIsolation(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV === "test") return;
  if (databaseNameFromUrl(environment.DATABASE_URL) !== "rispro_test") return;
  throw new Error("DICOM remap processing worker cannot run against the disposable rispro_test database outside NODE_ENV=test.");
}

function normalizeProcessingConcurrency(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), 8)) : 4;
}

export async function runDicomRemapProcessingWorkerTick(options: { batchSize?: number; concurrency?: number; leaseSeconds?: number; owner?: string } = {}): Promise<{ claimed: number; completed: number; failed: number }> {
  assertWorkerDatabaseIsolation();
  if (tickRunning || stopped) return { claimed: 0, completed: 0, failed: 0 };
  tickRunning = true;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 5, 25));
  const concurrency = normalizeProcessingConcurrency(options.concurrency);
  const leaseSeconds = Math.max(30, Math.min(options.leaseSeconds ?? 120, 3600));
  const owner = options.owner || workerId;
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  try {
    await releaseExpiredRecoveries().catch(() => 0);
    const failedRetentionHours = Math.max(1, Number(process.env.DICOM_REMAP_FAILED_STAGING_RETENTION_HOURS || 72));
    const awaitingConfirmationRetentionHours = Math.max(1, Number(process.env.DICOM_REMAP_AWAITING_CONFIRMATION_RETENTION_HOURS || 24));
    let sentRetentionHours: number | undefined;
    try {
      sentRetentionHours = (await readRetentionSettings()).sentSourceRetentionDays * 24;
    } catch {
      console.warn(JSON.stringify({ type: "dicom_remap_sent_retention_settings_read_failed" }));
    }
    await cleanupStaging(failedRetentionHours, awaitingConfirmationRetentionHours, sentRetentionHours).catch(() => 0);
    let queueExhausted = false;
    let claimAttempts = 0;
    const runLane = async (): Promise<void> => {
      while (!stopped && !queueExhausted && claimAttempts < batchSize) {
        claimAttempts += 1;
        const claim = await claimJob(owner, leaseSeconds);
        if (!claim) {
          queueExhausted = true;
          return;
        }
        claimed += 1;
        try {
          await processJob({ job: claim.job, leaseOwner: owner, leaseSeconds });
          completed += 1;
        } catch (error) {
          failed += 1;
          console.warn(JSON.stringify({
            type: "dicom_remap_processing_failed",
            remapJobId: claim.job.id,
            errorCode: (error as { details?: { code?: string } })?.details?.code || "DICOM_REMAP_PROCESSING_FAILED",
          }));
        }
      }
    };
    await Promise.allSettled(Array.from({ length: Math.min(concurrency, batchSize) }, () => runLane()));
    return { claimed, completed, failed };
  } finally {
    tickRunning = false;
  }
}

export const __dicomRemapProcessingWorkerTestables = {
  setDependencies(dependencies: {
    claim?: (owner: string, leaseSeconds: number) => Promise<ClaimJob>;
    process?: typeof processClaimedDicomRemapJob;
    cleanup?: (failedRetentionHours: number, awaitingConfirmationRetentionHours: number, sentRetentionHours?: number | null) => Promise<number>;
    releaseRecoveries?: () => Promise<number>;
    readRetentionSettings?: typeof readDicomRemapRetentionSettings;
  }): void {
    if (dependencies.claim) claimJob = dependencies.claim;
    if (dependencies.process) processJob = dependencies.process;
    if (dependencies.cleanup) cleanupStaging = dependencies.cleanup;
    if (dependencies.releaseRecoveries) releaseExpiredRecoveries = dependencies.releaseRecoveries;
    if (dependencies.readRetentionSettings) readRetentionSettings = dependencies.readRetentionSettings;
  },
  resetDependencies(): void {
    claimJob = claimNextDicomRemapProcessingJob;
    processJob = processClaimedDicomRemapJob;
    cleanupStaging = cleanupExpiredDicomRemapStaging;
    releaseExpiredRecoveries = releaseExpiredDicomRemapOrthancRecoveryClaims;
    readRetentionSettings = readDicomRemapRetentionSettings;
    stopped = false;
  },
  normalizeProcessingConcurrency,
  assertWorkerDatabaseIsolation,
};

export async function startDicomRemapProcessingWorker(options?: { intervalMs?: number; batchSize?: number; concurrency?: number; leaseSeconds?: number }): Promise<DicomRemapProcessingWorker> {
  assertWorkerDatabaseIsolation();
  const intervalMs = Math.max(1_000, options?.intervalMs ?? Number(process.env.DICOM_REMAP_PROCESSING_WORKER_INTERVAL_MS || 5_000));
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? Number(process.env.DICOM_REMAP_PROCESSING_BATCH_SIZE || 5), 25));
  const concurrency = normalizeProcessingConcurrency(options?.concurrency ?? process.env.DICOM_REMAP_PROCESSING_CONCURRENCY);
  const leaseSeconds = Math.max(30, Math.min(options?.leaseSeconds ?? Number(process.env.DICOM_REMAP_PROCESSING_LEASE_SECONDS || 120), 3600));
  stopped = false;
  console.info(JSON.stringify({ type: "dicom_remap_processing_worker_started", intervalMs, batchSize, concurrency, leaseSeconds }));
  await runDicomRemapProcessingWorkerTick({ batchSize, concurrency, leaseSeconds }).catch((error) => {
    console.warn(JSON.stringify({ type: "dicom_remap_processing_worker_startup_tick_failed", error: error instanceof Error ? error.message : "unknown" }));
  });
  intervalHandle = setInterval(() => {
    void runDicomRemapProcessingWorkerTick({ batchSize, concurrency, leaseSeconds }).catch((error) => {
      console.warn(JSON.stringify({ type: "dicom_remap_processing_worker_tick_failed", error: error instanceof Error ? error.message : "unknown" }));
    });
  }, intervalMs);
  intervalHandle.unref();
  return {
    async stop() {
      stopped = true;
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      while (tickRunning) await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}
