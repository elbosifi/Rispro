import { randomUUID } from "node:crypto";
import {
  claimNextDicomRemapProcessingJob,
  cleanupExpiredFailedDicomRemapStaging,
  processClaimedDicomRemapJob,
} from "./dicom-remap-service.js";

export interface DicomRemapProcessingWorker {
  stop(): Promise<void>;
}

let intervalHandle: NodeJS.Timeout | null = null;
let tickRunning = false;
let stopped = false;
const workerId = `dicom-remap-processing-${process.pid}-${randomUUID()}`;

export async function runDicomRemapProcessingWorkerTick(options: { batchSize?: number; leaseSeconds?: number; owner?: string } = {}): Promise<{ claimed: number; completed: number; failed: number }> {
  if (tickRunning || stopped) return { claimed: 0, completed: 0, failed: 0 };
  tickRunning = true;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 5, 25));
  const leaseSeconds = Math.max(30, Math.min(options.leaseSeconds ?? 120, 3600));
  const owner = options.owner || workerId;
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  try {
    await cleanupExpiredFailedDicomRemapStaging(Math.max(1, Number(process.env.DICOM_REMAP_FAILED_STAGING_RETENTION_HOURS || 72))).catch(() => 0);
    for (let index = 0; index < batchSize && !stopped; index += 1) {
      const claim = await claimNextDicomRemapProcessingJob(owner, leaseSeconds);
      if (!claim) break;
      claimed += 1;
      try {
        await processClaimedDicomRemapJob({ job: claim.job, leaseOwner: owner, leaseSeconds });
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
    return { claimed, completed, failed };
  } finally {
    tickRunning = false;
  }
}

export async function startDicomRemapProcessingWorker(options?: { intervalMs?: number; batchSize?: number; leaseSeconds?: number }): Promise<DicomRemapProcessingWorker> {
  const intervalMs = Math.max(1_000, options?.intervalMs ?? Number(process.env.DICOM_REMAP_PROCESSING_WORKER_INTERVAL_MS || 5_000));
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? Number(process.env.DICOM_REMAP_PROCESSING_BATCH_SIZE || 5), 25));
  const leaseSeconds = Math.max(30, Math.min(options?.leaseSeconds ?? Number(process.env.DICOM_REMAP_PROCESSING_LEASE_SECONDS || 120), 3600));
  stopped = false;
  console.info(JSON.stringify({ type: "dicom_remap_processing_worker_started", intervalMs, batchSize, leaseSeconds }));
  await runDicomRemapProcessingWorkerTick({ batchSize, leaseSeconds }).catch((error) => {
    console.warn(JSON.stringify({ type: "dicom_remap_processing_worker_startup_tick_failed", error: error instanceof Error ? error.message : "unknown" }));
  });
  intervalHandle = setInterval(() => {
    void runDicomRemapProcessingWorkerTick({ batchSize, leaseSeconds }).catch((error) => {
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
