import {
  claimOrthancOutboxBatch,
  isOrthancMwlEnabled,
  markOrthancOutboxFailure,
  markOrthancOutboxSuccess,
  type OrthancOutboxJob,
} from "./mwl-sync-service.js";
import {
  deleteBookingFromOrthanc,
  OrthancSyncError,
  probeOrthancWorklistApi,
  upsertBookingToOrthanc,
} from "./orthanc-mwl-adapter.js";

export interface OrthancMwlWorker {
  stop(): Promise<void>;
}

let intervalHandle: NodeJS.Timeout | null = null;
let isTickRunning = false;
let stopped = false;

function computeRetryDelaySeconds(attemptCount: number, retryable: boolean): number {
  if (!retryable) {
    return 15 * 60;
  }
  const attempt = Math.max(1, attemptCount);
  return Math.min(300, 15 * Math.pow(2, Math.max(0, attempt - 1)));
}

async function processOrthancOutboxJob(job: OrthancOutboxJob): Promise<void> {
  try {
    console.info(
      JSON.stringify({
        type: "orthanc_mwl_sync_attempt",
        outboxJobId: job.id,
        bookingId: job.bookingId,
        operation: job.operation,
        attemptCount: job.attemptCount,
      })
    );

    if (job.operation === "upsert") {
      const result = await upsertBookingToOrthanc(job.bookingId);
      await markOrthancOutboxSuccess(job.id, job.bookingId, "upsert", result.externalWorklistId);
      console.info(
        JSON.stringify({
          type: "orthanc_mwl_sync_succeeded",
          outboxJobId: job.id,
          bookingId: job.bookingId,
          operation: job.operation,
          strategy: result.strategy,
          externalWorklistId: result.externalWorklistId,
        })
      );
      return;
    }

    const result = await deleteBookingFromOrthanc(job.bookingId);
    await markOrthancOutboxSuccess(job.id, job.bookingId, "delete", result.externalWorklistId);
    console.info(
      JSON.stringify({
        type: "orthanc_mwl_sync_succeeded",
        outboxJobId: job.id,
        bookingId: job.bookingId,
        operation: job.operation,
        strategy: result.strategy,
        externalWorklistId: result.externalWorklistId,
      })
    );
  } catch (error) {
    const normalized = error instanceof OrthancSyncError
      ? error
      : new OrthancSyncError((error as Error).message || "orthanc_sync_failed", true, null);
    const retryDelaySeconds = computeRetryDelaySeconds(job.attemptCount, normalized.retryable);
    await markOrthancOutboxFailure(job.id, job.bookingId, normalized.message, retryDelaySeconds);
    console.warn(
      JSON.stringify({
        type: "orthanc_mwl_sync_failed",
        outboxJobId: job.id,
        bookingId: job.bookingId,
        operation: job.operation,
        attemptCount: job.attemptCount,
        retryable: normalized.retryable,
        retryDelaySeconds,
        statusCode: normalized.statusCode,
        error: normalized.message,
      })
    );
  }
}

async function runOrthancMwlSyncTick(batchSize: number): Promise<void> {
  if (isTickRunning || stopped) {
    return;
  }
  try {
    if (!(await isOrthancMwlEnabled())) {
      return;
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        type: "orthanc_mwl_settings_error",
        error: (error as Error).message || "settings_read_failed",
      })
    );
    return;
  }

  isTickRunning = true;
  try {
    const jobs = await claimOrthancOutboxBatch(batchSize);
    for (const job of jobs) {
      await processOrthancOutboxJob(job);
    }
  } finally {
    isTickRunning = false;
  }
}

export async function startOrthancMwlWorker(options?: {
  intervalMs?: number;
  batchSize?: number;
}): Promise<OrthancMwlWorker | null> {
  const intervalMs = Math.max(1000, options?.intervalMs ?? 5000);
  const batchSize = Math.max(1, options?.batchSize ?? 20);
  const enabled = await isOrthancMwlEnabled();

  stopped = false;
  const probe = enabled
    ? await probeOrthancWorklistApi().catch((error) => {
        console.warn(
          JSON.stringify({
            type: "orthanc_mwl_probe_failed",
            error: (error as Error).message || "probe_failed",
          })
        );
        return null;
      })
    : null;

  if (probe) {
    console.info(
      JSON.stringify({
        type: "orthanc_mwl_probe",
        ok: probe.ok,
        baseUrl: probe.baseUrl,
        orthancVersion: probe.orthancVersion,
        worklistsRouteReachable: probe.worklistsRouteReachable,
        worklistsPostSupported: probe.worklistsPostSupported,
        worklistsCreateSupported: probe.worklistsCreateSupported,
      })
    );
  }

  if (enabled) {
    await runOrthancMwlSyncTick(batchSize);
  }
  intervalHandle = setInterval(() => {
    void runOrthancMwlSyncTick(batchSize);
  }, intervalMs);
  intervalHandle.unref();

  return {
    async stop() {
      stopped = true;
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      while (isTickRunning) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}
