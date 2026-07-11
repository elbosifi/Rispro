import test from "node:test";
import assert from "node:assert/strict";
import { __dicomRemapTestables } from "./dicom-remap-service.js";
import { runDicomRemapProcessingWorkerTick } from "./dicom-remap-processing-worker.js";

test.afterEach(() => {
  __dicomRemapTestables.resetTestOverrides();
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
