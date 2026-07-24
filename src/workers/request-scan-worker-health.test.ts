import assert from "node:assert/strict";
import test from "node:test";
import { decideRequestScanWorkerHealth } from "./request-scan-worker-health-decision.js";

const fresh = { request_sequence: "1", acknowledged_sequence: "1", run_requested_at: null, worker_id: "worker-test", worker_started_at: "2026-07-24T10:00:00.000Z", worker_heartbeat_at: new Date().toISOString(), cycle_started_at: null, cycle_completed_at: null, last_success_at: null, last_error_at: null, last_error: null };
test("Request Scan worker health accepts a registered fresh heartbeat", () => assert.equal(decideRequestScanWorkerHealth(fresh).healthy, true));
test("Request Scan worker health rejects missing and stale worker state without secrets", () => {
  const missing = decideRequestScanWorkerHealth({ ...fresh, worker_id: null });
  const stale = decideRequestScanWorkerHealth({ ...fresh, worker_heartbeat_at: "2020-01-01T00:00:00.000Z" });
  assert.equal(missing.healthy, false); assert.equal(stale.healthy, false);
  assert.equal(`${missing.message} ${stale.message}`.match(/password|database_url|postgresql:\/\//i), null);
});
