import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { startRequestScanWorkerRuntime } from "../services/request-scan-worker-runtime.js";

export async function startDedicatedRequestScanWorker(): Promise<{ stop(): Promise<boolean> }> {
  if (!env.requestScanWorkerProcessEnabled) throw new Error("REQUEST_SCAN_WORKER_PROCESS_ENABLED must be true for the dedicated worker.");
  return startRequestScanWorkerRuntime();
}

async function main(): Promise<void> {
  let worker: Awaited<ReturnType<typeof startDedicatedRequestScanWorker>> | null = null;
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; stopping Request Scan worker.`);
    const graceful = await worker?.stop() ?? true;
    if (graceful) await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", () => { void shutdown("SIGINT"); }); process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  worker = await startDedicatedRequestScanWorker();
  console.log(`Request Scan dedicated worker started with max concurrency ${env.requestScanMaxConcurrency}.`);
}

main().catch(async (error) => { console.error("Request Scan worker initialization failed.", error); await pool.end(); process.exit(1); });
