import assert from "node:assert/strict";
import test from "node:test";
import { createRequestScanProgressCoalescer } from "./request-scan-progress-coalescer.js";

test("coalesces repeated progress while preserving stage changes and final values", async () => {
  const writes: Array<{ stage: string; current?: number | null; total?: number | null }> = [];
  const progress = createRequestScanProgressCoalescer(async (value) => { writes.push(value); }, 10_000);
  await progress.update({ stage: "scanning_qr_crops", current: 1, total: 400 });
  for (let current = 2; current < 400; current += 1) await progress.update({ stage: "scanning_qr_crops", current, total: 400 });
  await progress.update({ stage: "scanning_qr_crops", current: 400, total: 400 });
  await progress.update({ stage: "moving_file" });
  await progress.flush();
  assert.deepEqual(writes, [
    { stage: "scanning_qr_crops", current: 1, total: 400 },
    { stage: "scanning_qr_crops", current: 400, total: 400 },
    { stage: "moving_file" },
  ]);
  assert.ok(writes.length <= 80, "progress writes must be reduced by at least 80%");
});

test("cancel drops pending progress and prevents later writes", async () => {
  const writes: number[] = [];
  const progress = createRequestScanProgressCoalescer(async (value) => { writes.push(value.current ?? 0); }, 5);
  await progress.update({ stage: "scanning_qr_crops", current: 1, total: 10 });
  await progress.update({ stage: "scanning_qr_crops", current: 2, total: 10 });
  progress.cancel();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await progress.update({ stage: "scanning_qr_crops", current: 10, total: 10 });
  assert.deepEqual(writes, [1]);
});
