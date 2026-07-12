import { logAuditEntry } from "../../services/audit-service.js";
import { createLogger } from "../../observability/logger.js";
import { redactDiagnosticText } from "../../services/system-diagnostics-service.js";
import { createImagingSourceAdapter, deleteOrthancCachedStudyByUid } from "./adapters.js";
import {
  claimQueuedRetrievalJobs,
  deleteRetrievalJob,
  listExpiredAvailableRetrievalJobs,
  listRetrievingJobs,
  readOhifViewerConfiguration,
  updateRetrievalJob,
} from "./repository.js";
import { cleanupOhifState } from "./service.js";

export interface OhifRetrievalWorker { stop(): Promise<void>; }

let interval: NodeJS.Timeout | null = null;
let running = false;
let stopped = false;
const logger = createLogger({ domain: "ohif_viewer" });
function safeError(error: unknown): string { return redactDiagnosticText(error instanceof Error ? error.message : String(error)); }

export async function runOhifRetrievalWorkerTick(): Promise<{ queued: number; monitored: number; available: number; failed: number; timedOut: number }> {
  if (running || stopped) return { queued: 0, monitored: 0, available: 0, failed: 0, timedOut: 0 };
  running = true;
  const summary = { queued: 0, monitored: 0, available: 0, failed: 0, timedOut: 0 };
  try {
    const configuration = await readOhifViewerConfiguration();
    if (!configuration.settings.enabled || configuration.settings.accessStrategy !== "orthanc_gateway") return summary;
    const adapter = await createImagingSourceAdapter(configuration);
    if (!adapter.requestStudyRetrieval) return summary;

    const queued = await claimQueuedRetrievalJobs(3);
    summary.queued = queued.length;
    for (const job of queued) {
      try {
        if (!job.studyInstanceUid) {
          await updateRetrievalJob(job.id, { status: "failed", lastError: "StudyInstanceUID is missing." });
          summary.failed += 1;
          continue;
        }
        const result = await adapter.requestStudyRetrieval(job.studyInstanceUid);
        await updateRetrievalJob(job.id, { status: "retrieving", orthancJobId: result.orthancJobId });
        await logAuditEntry({ entityType: "ohif_retrieval_job", entityId: job.id, actionType: "retrieval_requested", newValues: { status: "retrieving", appointmentId: job.appointmentId }, changedByUserId: job.requestedByUserId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Study retrieval failed.";
        await updateRetrievalJob(job.id, { status: "failed", lastError: message.slice(0, 1000) });
        await logAuditEntry({ entityType: "ohif_retrieval_job", entityId: job.id, actionType: "retrieval_failed", newValues: { status: "failed" }, changedByUserId: job.requestedByUserId }).catch(() => null);
        summary.failed += 1;
      }
    }

    const retrieving = await listRetrievingJobs(20);
    summary.monitored = retrieving.length;
    for (const job of retrieving) {
      if (!job.studyInstanceUid) continue;
      try {
        if (await adapter.verifyStudyAvailable(job.studyInstanceUid)) {
          await updateRetrievalJob(job.id, { status: "available" });
          await logAuditEntry({ entityType: "ohif_retrieval_job", entityId: job.id, actionType: "retrieval_completed", newValues: { status: "available", appointmentId: job.appointmentId }, changedByUserId: job.requestedByUserId });
          summary.available += 1;
          continue;
        }
      } catch {
        // A transient Orthanc verification failure remains retriable until timeout.
      }
      const startedAt = job.startedAt ? Date.parse(job.startedAt) : Date.now();
      if (Date.now() - startedAt > configuration.settings.retrievalTimeoutSeconds * 1000) {
        await updateRetrievalJob(job.id, { status: "timed_out", lastError: "Study retrieval timed out." });
        await logAuditEntry({ entityType: "ohif_retrieval_job", entityId: job.id, actionType: "retrieval_timed_out", newValues: { status: "timed_out", appointmentId: job.appointmentId }, changedByUserId: job.requestedByUserId }).catch(() => null);
        summary.timedOut += 1;
      }
    }
    const expired = await listExpiredAvailableRetrievalJobs(configuration.settings.cacheRetentionHours, 10);
    for (const job of expired) {
      if (!job.studyInstanceUid) continue;
      try {
        const deletedStudies = await deleteOrthancCachedStudyByUid(job.studyInstanceUid);
        await deleteRetrievalJob(job.id);
        await logAuditEntry({ entityType: "ohif_retrieval_job", entityId: job.id, actionType: "orthanc_cache_evicted", newValues: { status: "successful", deletedStudies }, changedByUserId: job.requestedByUserId });
      } catch (error) {
        logger.warn("ohif_cache_cleanup_failed", { jobId: job.id, error: safeError(error) });
      }
    }
    await cleanupOhifState();
    return summary;
  } finally {
    running = false;
  }
}

export async function startOhifRetrievalWorker(options: { intervalMs?: number } = {}): Promise<OhifRetrievalWorker> {
  const intervalMs = Math.max(1_000, options.intervalMs ?? Number(process.env.OHIF_RETRIEVAL_WORKER_INTERVAL_MS || 5_000));
  stopped = false;
  await runOhifRetrievalWorkerTick().catch((error) => logger.warn("ohif_retrieval_worker_startup_tick_failed", { error: safeError(error) }));
  interval = setInterval(() => {
    void runOhifRetrievalWorkerTick().catch((error) => logger.warn("ohif_retrieval_worker_tick_failed", { error: safeError(error) }));
  }, intervalMs);
  interval.unref();
  return { async stop() { stopped = true; if (interval) { clearInterval(interval); interval = null; } while (running) await new Promise((resolve) => setTimeout(resolve, 50)); } };
}
