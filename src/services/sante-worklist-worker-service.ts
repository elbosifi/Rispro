import {
  claimSanteOutboxBatch,
  monitorSantePendingImports,
  writeSanteOutboxJob,
} from "./sante-hl7-outbox-service.js";
import { resolveSanteWorklistSettings } from "./sante-worklist-settings-resolver.js";

export interface SanteWorklistWorker {
  stop(): Promise<void>;
}

let intervalHandle: NodeJS.Timeout | null = null;
let isTickRunning = false;
let stopped = false;

async function runSanteTick(batchSize: number): Promise<void> {
  if (isTickRunning || stopped) return;
  const settings = await resolveSanteWorklistSettings().catch((error) => {
    console.warn(JSON.stringify({ type: "sante_hl7_settings_error", error: (error as Error).message }));
    return null;
  });
  if (!settings?.enabled) return;

  isTickRunning = true;
  try {
    const jobs = await claimSanteOutboxBatch(batchSize);
    for (const job of jobs) {
      await writeSanteOutboxJob(job);
    }
    await monitorSantePendingImports(batchSize);
  } finally {
    isTickRunning = false;
  }
}

export async function startSanteWorklistWorker(options?: {
  intervalMs?: number;
  batchSize?: number;
}): Promise<SanteWorklistWorker> {
  const intervalMs = Math.max(1000, options?.intervalMs ?? 5000);
  const batchSize = Math.max(1, options?.batchSize ?? 20);
  stopped = false;

  await runSanteTick(batchSize);
  intervalHandle = setInterval(() => {
    void runSanteTick(batchSize);
  }, intervalMs);
  intervalHandle.unref();

  return {
    async stop() {
      stopped = true;
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      while (isTickRunning) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}

