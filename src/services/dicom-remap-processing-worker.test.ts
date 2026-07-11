import test from "node:test";
import assert from "node:assert/strict";
import { __dicomRemapTestables } from "./dicom-remap-service.js";
import { __dicomRemapProcessingWorkerTestables, runDicomRemapProcessingWorkerTick, startDicomRemapProcessingWorker } from "./dicom-remap-processing-worker.js";

test.afterEach(() => {
  __dicomRemapTestables.resetTestOverrides();
  __dicomRemapProcessingWorkerTestables.resetDependencies();
});

test("processing worker uses the durable claim path and is idle when no job is queued", async () => {
  const calls: string[] = [];
  __dicomRemapTestables.setQueryForTests(async (sql: unknown) => {
    calls.push(String(sql));
    return { rows: [] } as never;
  });
  const result = await runDicomRemapProcessingWorkerTick({ owner: "test-worker", batchSize: 1, leaseSeconds: 120 });
  assert.deepEqual(result, { claimed: 0, completed: 0, failed: 0 });
  assert.ok(calls.some((sql) => /for update skip locked/i.test(sql)));
});

test("processing worker continues after one claimed job fails", async () => {
  const jobs = [
    { job: { id: 11 } as never, recovered: false },
    { job: { id: 12 } as never, recovered: false },
    null,
  ];
  const processed: number[] = [];
  __dicomRemapProcessingWorkerTestables.setDependencies({
    cleanup: async () => 0,
    claim: async () => jobs.shift() as never,
    process: async ({ job }) => {
      processed.push(Number(job.id));
      if (job.id === 11) throw new Error("simulated processing failure");
      return job as never;
    },
  });
  const result = await runDicomRemapProcessingWorkerTick({ owner: "test-worker", batchSize: 3, leaseSeconds: 120 });
  assert.deepEqual(result, { claimed: 2, completed: 1, failed: 1 });
  assert.deepEqual(processed, [11, 12]);
});

test("graceful worker stop prevents interval claims", async () => {
  let claims = 0;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    cleanup: async () => 0,
    claim: async () => {
      claims += 1;
      return null;
    },
  });
  const worker = await startDicomRemapProcessingWorker({ intervalMs: 10_000, batchSize: 1, leaseSeconds: 120 });
  const startupClaims = claims;
  await worker.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(claims, startupClaims);
});

test("cleanup failure does not prevent processing claims", async () => {
  let claimed = false;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    cleanup: async () => { throw new Error("cleanup unavailable"); },
    claim: async () => {
      if (claimed) return null;
      claimed = true;
      return { job: { id: 13 } as never, recovered: false };
    },
    process: async ({ job }) => job as never,
  });
  const result = await runDicomRemapProcessingWorkerTick({ owner: "test-worker", batchSize: 1, leaseSeconds: 120 });
  assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0 });
});
