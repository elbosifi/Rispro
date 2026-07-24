import assert from "node:assert/strict";
import test from "node:test";
import { runRequestScanJobPool, type RequestScanJob } from "./request-scan-service.js";
import type { ClaimedRequestScanJob } from "./request-scan-processing-service.js";

function claim(id: number): ClaimedRequestScanJob {
  return { job: { id, filename: `${id}.pdf`, status: "processing" } as RequestScanJob, lease: { workerId: "pool-test", token: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}` } };
}

test("Request Scan job pool keeps one slot sequential when concurrency is one", async () => {
  const pending = [claim(1), claim(2), claim(3)]; let active = 0; let maximum = 0;
  const result = await runRequestScanJobPool({
    limit: 100, maxConcurrency: 1,
    claimNext: async () => pending.shift() ?? null,
    processClaimed: async (current) => { active += 1; maximum = Math.max(maximum, active); await Promise.resolve(); active -= 1; return { ...current.job, status: "processed" }; },
  });
  assert.equal(maximum, 1); assert.equal(result.claimed, 3); assert.equal(result.result.processed, 3);
});

test("Request Scan job pool uses at most two slots and starts the third only after a slot completes", async () => {
  const pending = [claim(1), claim(2), claim(3)]; const release = new Map<number, () => void>(); let active = 0; let maximum = 0; const started: number[] = [];
  const pool = runRequestScanJobPool({
    limit: 100, maxConcurrency: 2,
    claimNext: async () => pending.shift() ?? null,
    processClaimed: async (current) => {
      active += 1; maximum = Math.max(maximum, active); started.push(current.job.id);
      await new Promise<void>((resolve) => release.set(current.job.id, resolve));
      active -= 1; return { ...current.job, status: "processed" };
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), [1, 2]); assert.equal(maximum, 2); assert.equal(pending.length, 1);
  release.get(1)!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(started.includes(3), true); assert.equal(maximum, 2);
  release.get(2)!(); release.get(3)!();
  const result = await pool;
  assert.equal(result.claimed, 3); assert.equal(result.result.processed, 3);
});

test("Request Scan job pool isolates a normal failed job and uses one global claim budget", async () => {
  const pending = [claim(1), claim(2), claim(3), claim(4)];
  const result = await runRequestScanJobPool({
    limit: 3, maxConcurrency: 2,
    claimNext: async () => pending.shift() ?? null,
    processClaimed: async (current) => ({ ...current.job, status: current.job.id === 1 ? "failed" : "processed" }),
  });
  assert.equal(result.claimed, 3); assert.equal(result.result.failed, 1); assert.equal(result.result.processed, 2); assert.equal(pending.length, 1);
});
