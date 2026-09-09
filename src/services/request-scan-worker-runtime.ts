import { env } from "../config/env.js";
import { createRequestScanWorkerId, recoverExpiredRequestScanJobs } from "./request-scan-processing-service.js";
import { runRequestScanCycle } from "./request-scan-service.js";
import { readRequestScanSettings } from "./request-scan-settings-service.js";
import { acquireRequestScanWorkerLeadership, heartbeatRequestScanWorker, readRequestScanWorkerRuntime, recordRequestScanWorkerCycleFailure, recordRequestScanWorkerCycleStart, recordRequestScanWorkerCycleSuccess, releaseRequestScanWorkerLeadership, REQUEST_SCAN_WORKER_HEARTBEAT_MS, type RequestScanWorkerRuntime as RequestScanWorkerControlRuntime } from "./request-scan-worker-control-service.js";

const WAKE_INTERVAL_MS = 2_000;
export const REQUEST_SCAN_WORKER_SHUTDOWN_GRACE_MS = 60_000;
export const REQUEST_SCAN_WORKER_MAX_CONTROL_PLANE_FAILURES = 3;
export type RequestScanWorkerRuntime = { workerId: string; requestWake(): Promise<void>; stop(): Promise<boolean> };

export type RequestScanWorkerRuntimeDependencies = {
  createWorkerId: typeof createRequestScanWorkerId;
  acquireLeadership: typeof acquireRequestScanWorkerLeadership;
  heartbeat: typeof heartbeatRequestScanWorker;
  readRuntime: typeof readRequestScanWorkerRuntime;
  readSettings: typeof readRequestScanSettings;
  recordCycleStart: typeof recordRequestScanWorkerCycleStart;
  recordCycleSuccess: typeof recordRequestScanWorkerCycleSuccess;
  recordCycleFailure: typeof recordRequestScanWorkerCycleFailure;
  releaseLeadership: typeof releaseRequestScanWorkerLeadership;
  recoverExpiredJobs: typeof recoverExpiredRequestScanJobs;
  now: () => number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

const defaultDependencies: RequestScanWorkerRuntimeDependencies = {
  createWorkerId: createRequestScanWorkerId,
  acquireLeadership: acquireRequestScanWorkerLeadership,
  heartbeat: heartbeatRequestScanWorker,
  readRuntime: readRequestScanWorkerRuntime,
  readSettings: readRequestScanSettings,
  recordCycleStart: recordRequestScanWorkerCycleStart,
  recordCycleSuccess: recordRequestScanWorkerCycleSuccess,
  recordCycleFailure: recordRequestScanWorkerCycleFailure,
  releaseLeadership: releaseRequestScanWorkerLeadership,
  recoverExpiredJobs: recoverExpiredRequestScanJobs,
  now: Date.now,
  setInterval,
  clearInterval,
};

function hasUnacknowledgedRequest(runtime: Pick<RequestScanWorkerControlRuntime, "request_sequence" | "acknowledged_sequence">): boolean {
  return BigInt(runtime.request_sequence) > BigInt(runtime.acknowledged_sequence);
}

export async function startRequestScanWorkerRuntime(
  runCycle: typeof runRequestScanCycle = runRequestScanCycle,
  onFatal: () => void = () => process.exit(1),
  overrides: Partial<RequestScanWorkerRuntimeDependencies> = {},
): Promise<RequestScanWorkerRuntime> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const workerId = dependencies.createWorkerId();
  let stopping = false;
  let ownsLeadership = false;
  let leadershipLost = false;
  let lastRoutineCycleCompletedAt: number | null = null;
  let pollingIntervalMs: number | null = null;
  let wakePromise: Promise<void> | null = null;
  let heartbeatBusy = false;
  let controlPlaneFailures = 0;
  let followUpRequested = false;

  const recordControlPlaneSuccess = () => { controlPlaneFailures = 0; };
  const recordControlPlaneFailure = () => {
    controlPlaneFailures += 1;
    if (controlPlaneFailures >= REQUEST_SCAN_WORKER_MAX_CONTROL_PLANE_FAILURES) onFatal();
  };
  const heartbeat = async (): Promise<boolean> => {
    if (!ownsLeadership || heartbeatBusy || leadershipLost) return !leadershipLost;
    heartbeatBusy = true;
    try {
      const owned = await dependencies.heartbeat(workerId);
      if (!owned) leadershipLost = true;
      else recordControlPlaneSuccess();
      return owned;
    } catch {
      recordControlPlaneFailure();
      return false;
    } finally {
      heartbeatBusy = false;
    }
  };
  const checkForFollowUpRequest = async (): Promise<void> => {
    try {
      const runtime = await dependencies.readRuntime();
      recordControlPlaneSuccess();
      followUpRequested = hasUnacknowledgedRequest(runtime);
    } catch {
      recordControlPlaneFailure();
    }
  };
  const performWake = async (): Promise<void> => {
    if (stopping || leadershipLost) return;
    if (!ownsLeadership) {
      try {
        ownsLeadership = await dependencies.acquireLeadership(workerId);
        if (ownsLeadership) recordControlPlaneSuccess();
      } catch {
        recordControlPlaneFailure();
        return;
      }
      if (!ownsLeadership) return;
    }

    let runtime: RequestScanWorkerControlRuntime;
    try {
      runtime = await dependencies.readRuntime();
      recordControlPlaneSuccess();
    } catch {
      recordControlPlaneFailure();
      return;
    }
    const explicit = hasUnacknowledgedRequest(runtime);
    const routineDue = lastRoutineCycleCompletedAt === null
      || (pollingIntervalMs !== null && dependencies.now() - lastRoutineCycleCompletedAt >= pollingIntervalMs);
    if (!explicit && !routineDue) return;

    let settings;
    try {
      settings = await dependencies.readSettings();
      pollingIntervalMs = Math.max(1_000, settings.pollingIntervalSeconds * 1_000);
      recordControlPlaneSuccess();
    } catch {
      recordControlPlaneFailure();
      return;
    }
    const reason = explicit ? "explicit" : "scheduled";
    let started: RequestScanWorkerControlRuntime | null;
    try {
      started = await dependencies.recordCycleStart(workerId);
      recordControlPlaneSuccess();
    } catch {
      recordControlPlaneFailure();
      return;
    }
    if (!started) {
      leadershipLost = true;
      return;
    }
    try {
      await dependencies.recoverExpiredJobs();
      await runCycle(settings, undefined, workerId, {
        maxConcurrency: env.requestScanMaxConcurrency,
        shouldContinue: () => !stopping && !leadershipLost,
        cycleReason: reason,
      });
      const recorded = await dependencies.recordCycleSuccess(workerId, started.request_sequence);
      if (!recorded) leadershipLost = true;
      else recordControlPlaneSuccess();
    } catch (error) {
      try {
        const recorded = await dependencies.recordCycleFailure(workerId, started.request_sequence, error);
        if (!recorded) leadershipLost = true;
        else recordControlPlaneSuccess();
      } catch {
        recordControlPlaneFailure();
      }
    } finally {
      if (reason === "scheduled") lastRoutineCycleCompletedAt = dependencies.now();
      if (!stopping && !leadershipLost) await checkForFollowUpRequest();
    }
  };
  const requestWake = (): Promise<void> => {
    if (!wakePromise) {
      wakePromise = performWake().finally(() => {
        wakePromise = null;
        if (followUpRequested && !stopping && !leadershipLost) {
          followUpRequested = false;
          void requestWake();
        }
      });
    }
    return wakePromise;
  };
  const heartbeatTimer = dependencies.setInterval(() => { void heartbeat(); }, REQUEST_SCAN_WORKER_HEARTBEAT_MS);
  const wakeTimer = dependencies.setInterval(() => { void requestWake(); }, WAKE_INTERVAL_MS);
  await requestWake();
  return {
    workerId,
    requestWake,
    async stop() {
      stopping = true;
      dependencies.clearInterval(wakeTimer);
      const active = wakePromise;
      if (active) await Promise.race([active, new Promise<void>((resolve) => setTimeout(resolve, REQUEST_SCAN_WORKER_SHUTDOWN_GRACE_MS))]);
      const graceful = !wakePromise;
      if (graceful && ownsLeadership && !leadershipLost) await dependencies.releaseLeadership(workerId);
      dependencies.clearInterval(heartbeatTimer);
      return graceful;
    },
  };
}
