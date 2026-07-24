import { pool } from "../db/pool.js";
import { readRequestScanWorkerRuntime } from "../services/request-scan-worker-control-service.js";
import { decideRequestScanWorkerHealth } from "./request-scan-worker-health-decision.js";

export async function checkRequestScanWorkerHealth(): Promise<{ healthy: boolean; message: string }> { return decideRequestScanWorkerHealth(await readRequestScanWorkerRuntime()); }

async function main(): Promise<void> {
  try {
    const result = await checkRequestScanWorkerHealth();
    console.log(result.message);
    process.exitCode = result.healthy ? 0 : 1;
  } catch {
    console.error("Request Scan worker health check could not read runtime state.");
    process.exitCode = 1;
  } finally { await pool.end(); }
}

if (process.argv[1]?.endsWith("request-scan-worker-health.ts")) void main();
