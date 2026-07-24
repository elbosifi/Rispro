import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { acknowledgeRequestScanWorkerSequence, acquireRequestScanWorkerLeadership, heartbeatRequestScanWorker, isRequestScanWorkerHeartbeatFresh, readRequestScanWorkerRuntime, recordRequestScanWorkerCycleFailure, recordRequestScanWorkerCycleStart, recordRequestScanWorkerCycleSuccess, releaseRequestScanWorkerLeadership, requestRequestScanWorkerRun } from "./request-scan-worker-control-service.js";

async function resetRuntime(): Promise<void> {
  await pool.query("update request_scan_worker_runtime set request_sequence=0,acknowledged_sequence=0,run_requested_at=null,worker_id=null,worker_started_at=null,worker_heartbeat_at=null,cycle_started_at=null,cycle_completed_at=null,last_success_at=null,last_error_at=null,last_error=null,updated_at=now() where singleton_key=1");
}

test("Request Scan worker control preserves a run request raised while two Request Scan slots are active", async () => {
  await resetRuntime();
  const first = await requestRequestScanWorkerRun();
  assert.equal(first.request_sequence, "1");
  assert.equal(await acquireRequestScanWorkerLeadership("control-test-a"), true);
  const started = await recordRequestScanWorkerCycleStart("control-test-a");
  assert.equal(started?.request_sequence, "1");
  let releaseFirst!: () => void; let releaseSecond!: () => void;
  const activeSlots = [new Promise<void>((resolve) => { releaseFirst = resolve; }), new Promise<void>((resolve) => { releaseSecond = resolve; })];
  const second = await requestRequestScanWorkerRun();
  assert.equal(second.request_sequence, "2");
  releaseFirst(); releaseSecond(); await Promise.all(activeSlots);
  assert.equal(await recordRequestScanWorkerCycleSuccess("control-test-a", started!.request_sequence), true);
  const after = await readRequestScanWorkerRuntime();
  assert.equal(after.acknowledged_sequence, "1");
  assert.equal(after.request_sequence, "2");
  await releaseRequestScanWorkerLeadership("control-test-a");
});

test("Request Scan worker ownership protects heartbeat and supports graceful release", async () => {
  await resetRuntime();
  assert.equal(await acquireRequestScanWorkerLeadership("control-test-a"), true);
  assert.equal(await acquireRequestScanWorkerLeadership("control-test-b"), false);
  assert.equal(await heartbeatRequestScanWorker("control-test-b"), false);
  assert.equal(await heartbeatRequestScanWorker("control-test-a"), true);
  const state = await readRequestScanWorkerRuntime();
  assert.equal(state.worker_id, "control-test-a");
  assert.equal(isRequestScanWorkerHeartbeatFresh(state), true);
  assert.equal(await acquireRequestScanWorkerLeadership("control-test-a"), true);
  assert.equal((await readRequestScanWorkerRuntime()).worker_started_at, state.worker_started_at);
  assert.equal(await releaseRequestScanWorkerLeadership("control-test-b"), false);
  assert.equal(await releaseRequestScanWorkerLeadership("control-test-a"), true);
  assert.equal((await readRequestScanWorkerRuntime()).worker_id, null);
});

test("Request Scan acknowledgement cannot advance past a later durable request", async () => {
  await resetRuntime();
  await requestRequestScanWorkerRun(); await requestRequestScanWorkerRun();
  assert.equal(await acquireRequestScanWorkerLeadership("control-test-a"), true);
  assert.equal(await acknowledgeRequestScanWorkerSequence("control-test-b", "2"), false);
  assert.equal(await acknowledgeRequestScanWorkerSequence("control-test-a", "1"), true);
  const state = await readRequestScanWorkerRuntime();
  assert.equal(state.acknowledged_sequence, "1");
  assert.equal(state.request_sequence, "2");
  await releaseRequestScanWorkerLeadership("control-test-a");
});

test("a stale Request Scan worker can be taken over while a fresh owner protects completion fields", async () => {
  await resetRuntime();
  await requestRequestScanWorkerRun();
  assert.equal(await acquireRequestScanWorkerLeadership("control-test-a"), true);
  const started = await recordRequestScanWorkerCycleStart("control-test-a");
  assert.ok(started);
  assert.equal(await recordRequestScanWorkerCycleFailure("control-test-b", started!.request_sequence, new Error("must not write")), false);
  assert.equal((await readRequestScanWorkerRuntime()).last_error, null);
  await pool.query("update request_scan_worker_runtime set worker_heartbeat_at=now() - interval '61 seconds' where singleton_key=1");
  assert.equal(await acquireRequestScanWorkerLeadership("control-test-b"), true);
  const takenOver = await readRequestScanWorkerRuntime();
  assert.equal(takenOver.worker_id, "control-test-b");
  assert.equal(takenOver.cycle_started_at, null);
  assert.equal(await recordRequestScanWorkerCycleSuccess("control-test-a", started!.request_sequence), false);
  await releaseRequestScanWorkerLeadership("control-test-b");
});
