import assert from "node:assert/strict";
import test from "node:test";
import { startRequestScanWorkerRuntime, type RequestScanWorkerRuntimeDependencies } from "./request-scan-worker-runtime.js";
import type { RequestScanWorkerRuntime as ControlRuntime } from "./request-scan-worker-control-service.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";
import type { runRequestScanCycle } from "./request-scan-service.js";

const settings = { enabled: true, pollingIntervalSeconds: 5 } as RequestScanSettings;
const emptyResult = { discovered: 0, processed: 0, failed: 0, duplicates: 0, skipped: 0 };

function controlState(requestSequence: number, acknowledgedSequence: number): ControlRuntime {
  return {
    request_sequence: String(requestSequence), acknowledged_sequence: String(acknowledgedSequence), run_requested_at: null,
    worker_id: "runtime-test-worker", worker_started_at: null, worker_heartbeat_at: null,
    cycle_started_at: null, cycle_completed_at: null, last_success_at: null, last_error_at: null, last_error: null,
  };
}

function nextTurn(): Promise<void> { return new Promise((resolve) => setImmediate(resolve)); }

function runtimeHarness(options: { cycleDurationMs?: number; acquireLeadership?: boolean; blockCycleNumber?: number; readRuntimeFailures?: number } = {}) {
  let now = 0;
  let requestSequence = 0;
  let acknowledgedSequence = 0;
  let heartbeatOwned = true;
  let readRuntimeFailures = options.readRuntimeFailures ?? 0;
  let settingsReads = 0;
  let releaseBlockedCycle: (() => void) | null = null;
  let activeCycles = 0;
  let maximumActiveCycles = 0;
  let leadershipReleases = 0;
  let fatalCalls = 0;
  const cycles: Array<{ startedAt: number; reason: string | undefined }> = [];
  const timers = new Map<number, { callback: () => void; interval: number }>();
  let nextTimerId = 1;

  const dependencies: Partial<RequestScanWorkerRuntimeDependencies> = {
    createWorkerId: () => "runtime-test-worker",
    acquireLeadership: async () => options.acquireLeadership ?? true,
    heartbeat: async () => heartbeatOwned,
    readRuntime: async () => {
      if (readRuntimeFailures > 0) {
        readRuntimeFailures -= 1;
        throw new Error("control plane unavailable");
      }
      return controlState(requestSequence, acknowledgedSequence);
    },
    readSettings: async () => { settingsReads += 1; return settings; },
    recordCycleStart: async () => controlState(requestSequence, acknowledgedSequence),
    recordCycleSuccess: async (_workerId, capturedSequence) => {
      acknowledgedSequence = Math.max(acknowledgedSequence, Math.min(Number(capturedSequence), requestSequence));
      return heartbeatOwned;
    },
    recordCycleFailure: async () => heartbeatOwned,
    releaseLeadership: async () => { leadershipReleases += 1; return true; },
    recoverExpiredJobs: async () => ({ requeued: 0, failed: 0 }),
    now: () => now,
    setInterval: ((callback: () => void, interval: number) => {
      const id = nextTimerId++;
      timers.set(id, { callback, interval });
      return id as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearInterval: ((timer: NodeJS.Timeout) => { timers.delete(Number(timer)); }) as typeof clearInterval,
  };
  const runCycle = (async (_settings, _dependencies, _workerId, cycleOptions) => {
    cycles.push({ startedAt: now, reason: cycleOptions?.cycleReason });
    activeCycles += 1;
    maximumActiveCycles = Math.max(maximumActiveCycles, activeCycles);
    if (cycles.length === options.blockCycleNumber) await new Promise<void>((resolve) => { releaseBlockedCycle = resolve; });
    now += options.cycleDurationMs ?? 0;
    activeCycles -= 1;
    return emptyResult;
  }) as typeof runRequestScanCycle;

  return {
    dependencies,
    runCycle,
    now: (value: number) => { now = value; },
    request: (sequence: number) => { requestSequence = sequence; },
    cycles,
    timers,
    settingsReads: () => settingsReads,
    maximumActiveCycles: () => maximumActiveCycles,
    acknowledgedSequence: () => acknowledgedSequence,
    releaseBlockedCycle: () => releaseBlockedCycle?.(),
    setHeartbeatOwned: (value: boolean) => { heartbeatOwned = value; },
    leadershipReleases: () => leadershipReleases,
    onFatal: () => { fatalCalls += 1; },
    fatalCalls: () => fatalCalls,
  };
}

test("routine Request Scan polling is measured from long-cycle completion", async () => {
  const harness = runtimeHarness({ cycleDurationMs: 7_000 });
  const worker = await startRequestScanWorkerRuntime(harness.runCycle, harness.onFatal, harness.dependencies);
  assert.deepEqual(harness.cycles, [{ startedAt: 0, reason: "scheduled" }]);
  harness.now(11_999);
  await worker.requestWake();
  assert.equal(harness.cycles.length, 1);
  harness.now(12_000);
  await worker.requestWake();
  assert.deepEqual(harness.cycles.map(({ startedAt }) => startedAt), [0, 12_000]);
  await worker.stop();
});

test("fast routine Request Scan cycles wait a full interval after completion", async () => {
  const harness = runtimeHarness({ cycleDurationMs: 1_000 });
  const worker = await startRequestScanWorkerRuntime(harness.runCycle, harness.onFatal, harness.dependencies);
  harness.now(5_999);
  await worker.requestWake();
  assert.equal(harness.cycles.length, 1);
  harness.now(6_000);
  await worker.requestWake();
  assert.deepEqual(harness.cycles.map(({ startedAt }) => startedAt), [0, 6_000]);
  await worker.stop();
});

test("idle wakes read durable requests but do not reread settings or write heartbeats", async () => {
  const harness = runtimeHarness();
  const worker = await startRequestScanWorkerRuntime(harness.runCycle, harness.onFatal, harness.dependencies);
  assert.equal(harness.settingsReads(), 1);
  harness.now(1_000);
  await worker.requestWake();
  assert.equal(harness.settingsReads(), 1);
  assert.equal(harness.cycles.length, 1);
  await worker.stop();
});

test("an explicit durable Request Scan request bypasses the routine wait", async () => {
  const harness = runtimeHarness();
  const worker = await startRequestScanWorkerRuntime(harness.runCycle, harness.onFatal, harness.dependencies);
  harness.now(1);
  harness.request(1);
  await worker.requestWake();
  assert.deepEqual(harness.cycles.map(({ reason }) => reason), ["scheduled", "explicit"]);
  assert.equal(harness.acknowledgedSequence(), 1);
  await worker.stop();
});

test("durable requests received during an active Request Scan cycle coalesce into one follow-up", async () => {
  const harness = runtimeHarness({ blockCycleNumber: 2 });
  const worker = await startRequestScanWorkerRuntime(harness.runCycle, harness.onFatal, harness.dependencies);
  harness.request(1);
  const active = worker.requestWake();
  await nextTurn();
  assert.equal(harness.cycles.length, 2);
  harness.request(3);
  await worker.requestWake();
  assert.equal(harness.maximumActiveCycles(), 1);
  harness.releaseBlockedCycle();
  await active;
  for (let attempt = 0; attempt < 10 && harness.cycles.length < 3; attempt += 1) await nextTurn();
  assert.equal(harness.cycles.length, 3);
  assert.equal(harness.cycles[2]?.reason, "explicit");
  assert.equal(harness.acknowledgedSequence(), 3);
  assert.equal(harness.maximumActiveCycles(), 1);
  await worker.stop();
});

test("only the leadership owner runs Request Scan cycles and heartbeat loss stops later work", async () => {
  const nonLeader = runtimeHarness({ acquireLeadership: false });
  const nonLeaderWorker = await startRequestScanWorkerRuntime(nonLeader.runCycle, nonLeader.onFatal, nonLeader.dependencies);
  assert.equal(nonLeader.cycles.length, 0);
  await nonLeaderWorker.stop();

  const leader = runtimeHarness();
  const worker = await startRequestScanWorkerRuntime(leader.runCycle, leader.onFatal, leader.dependencies);
  const heartbeat = [...leader.timers.values()].find((timer) => timer.interval === 12_000);
  assert.ok(heartbeat);
  leader.setHeartbeatOwned(false);
  heartbeat.callback();
  await nextTurn();
  leader.now(5_000);
  await worker.requestWake();
  assert.equal(leader.cycles.length, 1);
  await worker.stop();
});

test("Request Scan control-plane failures retain the fatal threshold", async () => {
  const harness = runtimeHarness({ readRuntimeFailures: 3 });
  const worker = await startRequestScanWorkerRuntime(harness.runCycle, harness.onFatal, harness.dependencies);
  await worker.requestWake();
  await worker.requestWake();
  assert.equal(harness.fatalCalls(), 1);
  assert.equal(harness.cycles.length, 0);
  await worker.stop();
});

test("Request Scan stop prevents a new cycle and releases leadership after an active cycle completes", async () => {
  const harness = runtimeHarness({ blockCycleNumber: 2 });
  const worker = await startRequestScanWorkerRuntime(harness.runCycle, harness.onFatal, harness.dependencies);
  harness.now(5_000);
  const active = worker.requestWake();
  await nextTurn();
  const stopping = worker.stop();
  harness.releaseBlockedCycle();
  await active;
  assert.equal(await stopping, true);
  harness.now(10_000);
  await worker.requestWake();
  assert.equal(harness.cycles.length, 2);
  assert.equal(harness.leadershipReleases(), 1);
});
