import { env } from "../config/env.js";
import { createRequestScanWorkerId, recoverExpiredRequestScanJobs } from "./request-scan-processing-service.js";
import { runRequestScanCycle, type RequestScanCycleResult } from "./request-scan-service.js";
import { readRequestScanSettings } from "./request-scan-settings-service.js";
import { acquireRequestScanWorkerLeadership, heartbeatRequestScanWorker, readRequestScanWorkerRuntime, recordRequestScanWorkerCycleFailure, recordRequestScanWorkerCycleStart, recordRequestScanWorkerCycleSuccess, releaseRequestScanWorkerLeadership, REQUEST_SCAN_WORKER_HEARTBEAT_MS } from "./request-scan-worker-control-service.js";

const WAKE_INTERVAL_MS = 2_000;
export const REQUEST_SCAN_WORKER_SHUTDOWN_GRACE_MS = 60_000;
export type RequestScanWorkerRuntime = { workerId: string; requestWake(): Promise<void>; stop(): Promise<boolean> };

export async function startRequestScanWorkerRuntime(runCycle: typeof runRequestScanCycle = runRequestScanCycle): Promise<RequestScanWorkerRuntime> {
  const workerId = createRequestScanWorkerId(); let stopping = false; let ownsLeadership = false; let leadershipLost = false; let lastPollAt = 0; let wakePromise: Promise<void> | null = null; let heartbeatBusy = false;
  const heartbeat = async (): Promise<boolean> => {
    if (!ownsLeadership || heartbeatBusy || leadershipLost) return !leadershipLost;
    heartbeatBusy = true;
    try { const owned = await heartbeatRequestScanWorker(workerId); if (!owned) leadershipLost = true; return owned; }
    catch { leadershipLost = true; return false; }
    finally { heartbeatBusy = false; }
  };
  const performWake = async (): Promise<void> => {
    if (stopping || leadershipLost) return;
    if (!ownsLeadership) { ownsLeadership = await acquireRequestScanWorkerLeadership(workerId); if (!ownsLeadership) return; }
    if (!(await heartbeat())) return;
    const runtime = await readRequestScanWorkerRuntime(); const settings = await readRequestScanSettings();
    const due = Date.now() - lastPollAt >= Math.max(1_000, settings.pollingIntervalSeconds * 1_000);
    if (!due && BigInt(runtime.request_sequence) <= BigInt(runtime.acknowledged_sequence)) return;
    lastPollAt = Date.now(); const started = await recordRequestScanWorkerCycleStart(workerId); if (!started) { leadershipLost = true; return; }
    try { await recoverExpiredRequestScanJobs(); await runCycle(settings, undefined, workerId, { maxConcurrency: env.requestScanMaxConcurrency, shouldContinue: () => !stopping && !leadershipLost }); await recordRequestScanWorkerCycleSuccess(workerId, started.request_sequence); }
    catch (error) { await recordRequestScanWorkerCycleFailure(workerId, started.request_sequence, error); }
  };
  const requestWake = (): Promise<void> => {
    if (!wakePromise) wakePromise = performWake().finally(() => { wakePromise = null; });
    return wakePromise;
  };
  const heartbeatTimer = setInterval(() => { void heartbeat(); }, REQUEST_SCAN_WORKER_HEARTBEAT_MS);
  const wakeTimer = setInterval(() => { void requestWake(); }, WAKE_INTERVAL_MS);
  await requestWake();
  return { workerId, requestWake, async stop() { stopping = true; clearInterval(wakeTimer); const active = wakePromise; if (active) await Promise.race([active, new Promise<void>((resolve) => setTimeout(resolve, REQUEST_SCAN_WORKER_SHUTDOWN_GRACE_MS))]); const graceful = !wakePromise; if (graceful && ownsLeadership && !leadershipLost) await releaseRequestScanWorkerLeadership(workerId); clearInterval(heartbeatTimer); return graceful; } };
}
