import { runRequestScanCycle, type RequestScanCycleResult } from "./request-scan-service.js";
import { readRequestScanSettings } from "./request-scan-settings-service.js";

export interface RequestScanWorker { stop(): Promise<void>; runNow(): Promise<RequestScanCycleResult>; status(): { lastRunAt: string | null; lastError: string | null; running: boolean }; }
export type RequestScanWorkerRunRequest = { status: "accepted" | "already_running" | "disabled" };
type RequestScanWorkerTriggerDependencies = {
  readSettings: typeof readRequestScanSettings;
  runTick: typeof runRequestScanWorkerTick;
};
let running = false; let lastRunAt: string | null = null; let lastError: string | null = null;
export function getRequestScanWorkerStatus() { return { lastRunAt, lastError, running }; }
export async function runRequestScanWorkerTick(runCycle: () => Promise<RequestScanCycleResult> = runRequestScanCycle): Promise<RequestScanCycleResult> { if (running) return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 }; running = true; lastRunAt = new Date().toISOString(); try { const result = await runCycle(); lastError = null; return result; } catch (error) { lastError = error instanceof Error ? error.message.slice(0, 300) : "Request scan worker failed"; throw error; } finally { running = false; } }
export async function requestRequestScanWorkerRun(dependencies: RequestScanWorkerTriggerDependencies = { readSettings: readRequestScanSettings, runTick: runRequestScanWorkerTick }): Promise<RequestScanWorkerRunRequest> {
  const settings = await dependencies.readSettings();
  if (!settings.enabled) return { status: "disabled" };
  if (running) return { status: "already_running" };
  void dependencies.runTick().catch(() => undefined);
  return { status: "accepted" };
}
export async function startRequestScanWorker(): Promise<RequestScanWorker> { const settings = await readRequestScanSettings(); const interval = Math.max(1_000, settings.pollingIntervalSeconds * 1_000); if (settings.enabled) await runRequestScanWorkerTick().catch(() => undefined); const timer = setInterval(() => { void runRequestScanWorkerTick().catch(() => undefined); }, interval); return { async stop() { clearInterval(timer); }, async runNow() { return runRequestScanWorkerTick(); }, status() { return getRequestScanWorkerStatus(); } }; }
