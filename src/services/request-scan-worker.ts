import { runRequestScanCycle } from "./request-scan-service.js";
import { readRequestScanSettings } from "./request-scan-settings-service.js";

export interface RequestScanWorker { stop(): Promise<void>; runNow(): Promise<void>; status(): { lastRunAt: string | null; lastError: string | null; running: boolean }; }
let running = false; let lastRunAt: string | null = null; let lastError: string | null = null;
export function getRequestScanWorkerStatus() { return { lastRunAt, lastError, running }; }
export async function runRequestScanWorkerTick(): Promise<void> { if (running) return; running = true; lastRunAt = new Date().toISOString(); try { await runRequestScanCycle(); lastError = null; } catch (error) { lastError = error instanceof Error ? error.message.slice(0, 300) : "Request scan worker failed"; throw error; } finally { running = false; } }
export async function startRequestScanWorker(): Promise<RequestScanWorker> { const settings = await readRequestScanSettings(); const interval = Math.max(1_000, settings.pollingIntervalSeconds * 1_000); if (settings.enabled) await runRequestScanWorkerTick().catch(() => undefined); const timer = setInterval(() => { void runRequestScanWorkerTick().catch(() => undefined); }, interval); return { async stop() { clearInterval(timer); }, async runNow() { await runRequestScanWorkerTick(); }, status() { return getRequestScanWorkerStatus(); } }; }
