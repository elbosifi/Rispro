import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { recoverExpiredRequestScanJobs, createRequestScanWorkerId } from "../services/request-scan-processing-service.js";
import { runRequestScanCycle } from "../services/request-scan-service.js";
import { readRequestScanSettings } from "../services/request-scan-settings-service.js";
import { acquireRequestScanWorkerLeadership, heartbeatRequestScanWorker, readRequestScanWorkerRuntime, recordRequestScanWorkerCycleFailure, recordRequestScanWorkerCycleStart, recordRequestScanWorkerCycleSuccess, releaseRequestScanWorkerLeadership, REQUEST_SCAN_WORKER_HEARTBEAT_MS } from "../services/request-scan-worker-control-service.js";

const WAKE_INTERVAL_MS = 2_000;

export async function startDedicatedRequestScanWorker(): Promise<{ stop(): Promise<void> }> {
  if (!env.requestScanWorkerProcessEnabled) throw new Error("REQUEST_SCAN_WORKER_PROCESS_ENABLED must be true for the dedicated worker.");
  const workerId = createRequestScanWorkerId();
  let stopping = false; let running = false; let lastPollAt = 0;
  const wake = async () => {
    if (stopping || running) return;
    const leader = await acquireRequestScanWorkerLeadership(workerId);
    if (!leader) return; // standby until the fresh leader stops or becomes stale
    if (!(await heartbeatRequestScanWorker(workerId))) return;
    const runtime = await readRequestScanWorkerRuntime();
    const settings = await readRequestScanSettings();
    const dueForPoll = Date.now() - lastPollAt >= Math.max(1_000, settings.pollingIntervalSeconds * 1_000);
    if (!dueForPoll && BigInt(runtime.request_sequence) <= BigInt(runtime.acknowledged_sequence)) return;
    running = true; lastPollAt = Date.now();
    const started = await recordRequestScanWorkerCycleStart(workerId);
    if (!started) { running = false; return; }
    const capturedSequence = started.request_sequence;
    try {
      await recoverExpiredRequestScanJobs();
      await runRequestScanCycle(settings, undefined, workerId, { maxConcurrency: env.requestScanMaxConcurrency, shouldContinue: () => !stopping });
      await recordRequestScanWorkerCycleSuccess(workerId, capturedSequence);
    } catch (error) {
      await recordRequestScanWorkerCycleFailure(workerId, capturedSequence, error);
      console.error("Request Scan worker cycle failed.", error);
    } finally { running = false; }
  };
  await wake();
  const heartbeat = setInterval(() => { void heartbeatRequestScanWorker(workerId); }, REQUEST_SCAN_WORKER_HEARTBEAT_MS);
  const timer = setInterval(() => { void wake().catch((error) => console.error("Request Scan worker wake failed.", error)); }, WAKE_INTERVAL_MS);
  return { async stop() { if (stopping) return; stopping = true; clearInterval(timer); clearInterval(heartbeat); await releaseRequestScanWorkerLeadership(workerId); } };
}

async function main(): Promise<void> {
  let worker: Awaited<ReturnType<typeof startDedicatedRequestScanWorker>> | null = null;
  const shutdown = async (signal: string) => { console.log(`Received ${signal}; stopping Request Scan worker.`); await worker?.stop(); await pool.end(); process.exit(0); };
  process.once("SIGINT", () => { void shutdown("SIGINT"); }); process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  worker = await startDedicatedRequestScanWorker();
  console.log(`Request Scan dedicated worker started with max concurrency ${env.requestScanMaxConcurrency}.`);
}

main().catch(async (error) => { console.error("Request Scan worker initialization failed.", error); await pool.end(); process.exit(1); });
