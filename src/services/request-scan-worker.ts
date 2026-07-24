import { runRequestScanCycle, type RequestScanCycleResult } from "./request-scan-service.js";
import { readRequestScanSettings } from "./request-scan-settings-service.js";
import { recoverExpiredRequestScanJobs } from "./request-scan-processing-service.js";
import { requestRequestScanWorkerRun as signalDurableRun } from "./request-scan-worker-control-service.js";
import { startRequestScanWorkerRuntime } from "./request-scan-worker-runtime.js";

export interface RequestScanWorker { stop(): Promise<void>; runNow(): Promise<RequestScanCycleResult>; status(): { lastRunAt: string | null; lastError: string | null; running: boolean }; }
export type RequestScanWorkerRunRequest = { status: "accepted" | "already_running" | "disabled" };
type RequestScanWorkerTriggerDependencies = {
  readSettings: typeof readRequestScanSettings;
  runTick: typeof runRequestScanWorkerTick;
  signalRun?: typeof signalDurableRun;
};
let running = false; let lastRunAt: string | null = null; let lastError: string | null = null;
export function getRequestScanWorkerStatus() { return { lastRunAt, lastError, running }; }
export async function runRequestScanWorkerTick(runCycle: () => Promise<RequestScanCycleResult> = runRequestScanCycle): Promise<RequestScanCycleResult> { if (running) return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 }; running = true; lastRunAt = new Date().toISOString(); try { if (runCycle === runRequestScanCycle) await recoverExpiredRequestScanJobs(); const result = await runCycle(); lastError = null; return result; } catch (error) { lastError = error instanceof Error ? error.message.slice(0, 300) : "Request scan worker failed"; throw error; } finally { running = false; } }
export async function requestRequestScanWorkerRun(dependencies: RequestScanWorkerTriggerDependencies = { readSettings: readRequestScanSettings, runTick: runRequestScanWorkerTick, signalRun: signalDurableRun }): Promise<RequestScanWorkerRunRequest> {
  const settings = await dependencies.readSettings();
  if (!settings.enabled) return { status: "disabled" };
  // Routes always create durable work; injected test callers may omit the database signal.
  if (dependencies.signalRun) await dependencies.signalRun();
  if (running) return { status: "already_running" };
  if (process.env.REQUEST_SCAN_WORKER_PROCESS_ENABLED !== "false") void dependencies.runTick().catch(() => undefined);
  return { status: "accepted" };
}
export async function startRequestScanWorker(): Promise<RequestScanWorker> {
  const runtime = await startRequestScanWorkerRuntime();
  return { async stop() { await runtime.stop(); }, async runNow() { await runtime.requestWake(); return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 }; }, status() { return getRequestScanWorkerStatus(); } };
}
