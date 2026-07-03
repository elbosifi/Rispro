import os from "node:os";
import { runDueScheduledReportingBoardBulkAssignmentJobs } from "../modules/doctor-portal/reporting-board-service.js";

const DEFAULT_WORKER_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 5;

export interface ReportingBoardBulkAssignmentWorker {
  stop(): Promise<void>;
}

let workerIntervalHandle: NodeJS.Timeout | null = null;
let workerTickRunning = false;
let workerStopped = false;

function workerId(): string {
  return `reporting-board-bulk-assignment:${os.hostname()}:${process.pid}`;
}

export async function runReportingBoardBulkAssignmentTick(options: { batchSize?: number } = {}): Promise<{
  checked: number;
  completed: number;
  failed: number;
}> {
  if (workerTickRunning || workerStopped) return { checked: 0, completed: 0, failed: 0 };
  workerTickRunning = true;
  try {
    return await runDueScheduledReportingBoardBulkAssignmentJobs({
      limit: Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 25)),
      lockedBy: workerId(),
    });
  } finally {
    workerTickRunning = false;
  }
}

export async function startReportingBoardBulkAssignmentWorker(options?: {
  intervalMs?: number;
  batchSize?: number;
}): Promise<ReportingBoardBulkAssignmentWorker> {
  const intervalMs = Math.max(10_000, options?.intervalMs ?? DEFAULT_WORKER_INTERVAL_MS);
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? DEFAULT_BATCH_SIZE, 25));
  workerStopped = false;

  await runReportingBoardBulkAssignmentTick({ batchSize }).catch((error) => {
    console.warn(JSON.stringify({
      type: "reporting_board_bulk_assignment_startup_tick_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  });

  workerIntervalHandle = setInterval(() => {
    void runReportingBoardBulkAssignmentTick({ batchSize }).catch((error) => {
      console.warn(JSON.stringify({
        type: "reporting_board_bulk_assignment_tick_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }, intervalMs);
  workerIntervalHandle.unref();

  return {
    async stop() {
      workerStopped = true;
      if (workerIntervalHandle) {
        clearInterval(workerIntervalHandle);
        workerIntervalHandle = null;
      }
      while (workerTickRunning) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}
