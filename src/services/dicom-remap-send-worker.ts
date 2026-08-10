import {
  failStaleDicomRemapSendEnqueues,
  listDicomRemapSendMonitoringJobs,
  monitorDicomRemapSendJob,
} from "./dicom-remap-service.js";
import { monitorCdRobotDeliveries } from "./cd-robot-delivery-service.js";

export interface DicomRemapSendWorker {
  stop(): Promise<void>;
}

let intervalHandle: NodeJS.Timeout | null = null;
let tickRunning = false;
let stopped = false;

export async function runDicomRemapSendWorkerTick(options: { batchSize?: number; staleEnqueueMinutes?: number } = {}): Promise<{
  checked: number;
  staleFailed: number;
}> {
  if (tickRunning || stopped) return { checked: 0, staleFailed: 0 };
  tickRunning = true;
  try {
    const staleFailed = await failStaleDicomRemapSendEnqueues(options.staleEnqueueMinutes ?? 10);
    const jobs = await listDicomRemapSendMonitoringJobs(Math.max(1, Math.min(options.batchSize ?? 25, 100)));
    for (const job of jobs) {
      try {
        // Terminal writes are conditional on the persisted Orthanc ID, so concurrent app instances
        // can poll safely without ever creating another C-STORE.
        await monitorDicomRemapSendJob(job);
      } catch (error) {
        console.warn(JSON.stringify({
          type: "dicom_remap_send_monitor_failed",
          remapJobId: job.id,
          orthancJobId: job.orthanc_send_job_id,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    await monitorCdRobotDeliveries(Math.max(1, Math.min(options.batchSize ?? 25, 100))).catch((error) => {
      console.warn(JSON.stringify({ type: "cd_robot_delivery_monitor_failed", error: error instanceof Error ? error.message : String(error) }));
    });
    return { checked: jobs.length, staleFailed };
  } finally {
    tickRunning = false;
  }
}

export async function startDicomRemapSendWorker(options?: {
  intervalMs?: number;
  batchSize?: number;
  staleEnqueueMinutes?: number;
}): Promise<DicomRemapSendWorker> {
  const intervalMs = Math.max(1_000, options?.intervalMs ?? Number(process.env.DICOM_REMAP_SEND_WORKER_INTERVAL_MS || 5_000));
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? 25, 100));
  const staleEnqueueMinutes = Math.max(1, options?.staleEnqueueMinutes ?? Number(process.env.DICOM_REMAP_SEND_STALE_ENQUEUE_MINUTES || 10));
  stopped = false;
  console.info(JSON.stringify({ type: "dicom_remap_send_worker_started", intervalMs, batchSize, staleEnqueueMinutes }));
  await runDicomRemapSendWorkerTick({ batchSize, staleEnqueueMinutes }).catch((error) => {
    console.warn(JSON.stringify({ type: "dicom_remap_send_worker_startup_tick_failed", error: error instanceof Error ? error.message : String(error) }));
  });
  intervalHandle = setInterval(() => {
    void runDicomRemapSendWorkerTick({ batchSize, staleEnqueueMinutes }).catch((error) => {
      console.warn(JSON.stringify({ type: "dicom_remap_send_worker_tick_failed", error: error instanceof Error ? error.message : String(error) }));
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
