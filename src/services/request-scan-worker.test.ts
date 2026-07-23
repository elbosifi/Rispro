import assert from "node:assert/strict";
import test from "node:test";
import { getRequestScanWorkerStatus, requestRequestScanWorkerRun, runRequestScanWorkerTick } from "./request-scan-worker.js";

test("Request Scan worker tick returns the completed cycle result", async () => {
  const expected = { discovered: 3, processed: 1, failed: 1, duplicates: 0, skipped: 1 };
  assert.deepEqual(await runRequestScanWorkerTick(async () => expected), expected);
  assert.equal(getRequestScanWorkerStatus().running, false);
});

test("Request Scan worker running state resets after a failed cycle", async () => {
  await assert.rejects(
    () => runRequestScanWorkerTick(async () => { throw new Error("cycle failed"); }),
    /cycle failed/
  );
  assert.equal(getRequestScanWorkerStatus().running, false);
  assert.equal(getRequestScanWorkerStatus().lastError, "cycle failed");
});

test("two simultaneous Request Scan worker ticks execute only one cycle", async () => {
  let releaseCycle!: () => void;
  const cycleBlocked = new Promise<void>((resolve) => { releaseCycle = resolve; });
  let cycleCalls = 0;
  let activeCycles = 0;
  let maximumActiveCycles = 0;
  const cycle = async () => {
    cycleCalls += 1;
    activeCycles += 1;
    maximumActiveCycles = Math.max(maximumActiveCycles, activeCycles);
    await cycleBlocked;
    activeCycles -= 1;
    return { discovered: 1, processed: 1, failed: 0, duplicates: 0, skipped: 0 };
  };

  const first = runRequestScanWorkerTick(cycle);
  assert.equal(getRequestScanWorkerStatus().running, true);
  const second = runRequestScanWorkerTick(cycle);
  assert.deepEqual(await second, { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 });
  assert.equal(cycleCalls, 1);
  assert.equal(maximumActiveCycles, 1);
  releaseCycle();
  await first;
  assert.equal(getRequestScanWorkerStatus().running, false);
});

test("controlled Request Scan trigger returns accepted before the cycle completes", async () => {
  let releaseCycle!: () => void;
  const cycleBlocked = new Promise<void>((resolve) => { releaseCycle = resolve; });
  let completed = false;
  const trigger = await requestRequestScanWorkerRun({
    readSettings: async () => ({ enabled: true } as never),
    runTick: () => runRequestScanWorkerTick(async () => {
      await cycleBlocked;
      completed = true;
      return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 };
    }),
  });

  assert.deepEqual(trigger, { status: "accepted" });
  assert.equal(completed, false);
  assert.equal(getRequestScanWorkerStatus().running, true);
  assert.deepEqual(await requestRequestScanWorkerRun({
    readSettings: async () => ({ enabled: true } as never),
    runTick: runRequestScanWorkerTick,
  }), { status: "already_running" });
  releaseCycle();
  while (getRequestScanWorkerStatus().running) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, true);
});

test("controlled Request Scan trigger reports disabled without starting a cycle", async () => {
  let calls = 0;
  assert.deepEqual(await requestRequestScanWorkerRun({
    readSettings: async () => ({ enabled: false } as never),
    runTick: async () => {
      calls += 1;
      return { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 };
    },
  }), { status: "disabled" });
  assert.equal(calls, 0);
});
