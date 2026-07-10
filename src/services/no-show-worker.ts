import { runAutomaticNoShowProcessing } from "../modules/appointments-v2/booking/services/no-show-review.service.js";

export interface NoShowWorker { stop(): Promise<void>; }
let intervalHandle: NodeJS.Timeout | null = null; let tickRunning = false; let stopped = false;
const intervalMs = () => Math.max(60_000, Number(process.env.NO_SHOW_WORKER_INTERVAL_MS || 300_000));

export async function runNoShowWorkerTick() {
  if (tickRunning || stopped) return { processedIds: [], skipped: 0 };
  tickRunning = true;
  try { return await runAutomaticNoShowProcessing(); }
  finally { tickRunning = false; }
}

export async function startNoShowWorker(): Promise<NoShowWorker> {
  stopped = false; console.info(JSON.stringify({ type: "no_show_worker_started", intervalMs: intervalMs(), timeZone: "Africa/Tripoli" }));
  await runNoShowWorkerTick().catch((error) => console.error(JSON.stringify({ type: "no_show_worker_failed", error: error instanceof Error ? error.message : String(error) })));
  intervalHandle = setInterval(() => { void runNoShowWorkerTick().catch((error) => console.error(JSON.stringify({ type: "no_show_worker_failed", error: error instanceof Error ? error.message : String(error) }))); }, intervalMs()); intervalHandle.unref();
  return { async stop() { stopped = true; if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; } while (tickRunning) await new Promise((resolve) => setTimeout(resolve, 50)); } };
}
