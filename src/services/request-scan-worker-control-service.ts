import { pool } from "../db/pool.js";

export const REQUEST_SCAN_WORKER_HEARTBEAT_MS = 12_000;
// Five 12-second heartbeats allow ordinary scheduler jitter while matching the existing 60-second job lease.
export const REQUEST_SCAN_WORKER_STALE_MS = 60_000;

export type RequestScanWorkerRuntime = {
  request_sequence: string;
  acknowledged_sequence: string;
  run_requested_at: string | null;
  worker_id: string | null;
  worker_started_at: string | null;
  worker_heartbeat_at: string | null;
  cycle_started_at: string | null;
  cycle_completed_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
};

function runtime(row: unknown): RequestScanWorkerRuntime {
  const source = row as Record<string, unknown>;
  const date = (name: string): string | null => {
    const value = source[name];
    return value instanceof Date ? value.toISOString() : value == null ? null : String(value);
  };
  return {
    request_sequence: String(source.request_sequence), acknowledged_sequence: String(source.acknowledged_sequence),
    run_requested_at: date("run_requested_at"), worker_id: source.worker_id == null ? null : String(source.worker_id),
    worker_started_at: date("worker_started_at"), worker_heartbeat_at: date("worker_heartbeat_at"),
    cycle_started_at: date("cycle_started_at"), cycle_completed_at: date("cycle_completed_at"),
    last_success_at: date("last_success_at"), last_error_at: date("last_error_at"), last_error: source.last_error == null ? null : String(source.last_error),
  };
}

export function isRequestScanWorkerHeartbeatFresh(state: Pick<RequestScanWorkerRuntime, "worker_heartbeat_at">, now = new Date(), staleMs = REQUEST_SCAN_WORKER_STALE_MS): boolean {
  return Boolean(state.worker_heartbeat_at && now.getTime() - new Date(state.worker_heartbeat_at).getTime() < staleMs);
}

export async function readRequestScanWorkerRuntime(): Promise<RequestScanWorkerRuntime> {
  const { rows } = await pool.query("select request_sequence,acknowledged_sequence,run_requested_at,worker_id,worker_started_at,worker_heartbeat_at,cycle_started_at,cycle_completed_at,last_success_at,last_error_at,last_error from request_scan_worker_runtime where singleton_key=1");
  if (!rows[0]) throw new Error("Request Scan worker runtime row is missing.");
  return runtime(rows[0]);
}

export async function requestRequestScanWorkerRun(): Promise<RequestScanWorkerRuntime> {
  const { rows } = await pool.query("update request_scan_worker_runtime set request_sequence=request_sequence+1,run_requested_at=now(),updated_at=now() where singleton_key=1 returning request_sequence,acknowledged_sequence,run_requested_at,worker_id,worker_started_at,worker_heartbeat_at,cycle_started_at,cycle_completed_at,last_success_at,last_error_at,last_error");
  if (!rows[0]) throw new Error("Request Scan worker runtime row is missing.");
  return runtime(rows[0]);
}

export async function acquireRequestScanWorkerLeadership(workerId: string): Promise<boolean> {
  const result = await pool.query("update request_scan_worker_runtime set worker_id=$1,worker_started_at=case when worker_id=$1 then worker_started_at else now() end,worker_heartbeat_at=now(),cycle_started_at=case when worker_id=$1 then cycle_started_at else null end,cycle_completed_at=case when worker_id=$1 then cycle_completed_at else now() end,updated_at=now() where singleton_key=1 and (worker_id is null or worker_id=$1 or worker_heartbeat_at is null or worker_heartbeat_at < now()-($2::int * interval '1 millisecond'))", [workerId, REQUEST_SCAN_WORKER_STALE_MS]);
  return result.rowCount === 1;
}

// Acquiring the singleton lease also registers startup identity and timestamp.
export const registerRequestScanWorker = acquireRequestScanWorkerLeadership;

export async function heartbeatRequestScanWorker(workerId: string): Promise<boolean> {
  const result = await pool.query("update request_scan_worker_runtime set worker_heartbeat_at=now(),updated_at=now() where singleton_key=1 and worker_id=$1", [workerId]);
  return result.rowCount === 1;
}

export async function recordRequestScanWorkerCycleStart(workerId: string): Promise<RequestScanWorkerRuntime | null> {
  const { rows } = await pool.query("update request_scan_worker_runtime set cycle_started_at=now(),cycle_completed_at=null,updated_at=now() where singleton_key=1 and worker_id=$1 returning request_sequence,acknowledged_sequence,run_requested_at,worker_id,worker_started_at,worker_heartbeat_at,cycle_started_at,cycle_completed_at,last_success_at,last_error_at,last_error", [workerId]);
  return rows[0] ? runtime(rows[0]) : null;
}

export async function acknowledgeRequestScanWorkerSequence(workerId: string, capturedSequence: string): Promise<boolean> {
  const result = await pool.query("update request_scan_worker_runtime set acknowledged_sequence=greatest(acknowledged_sequence,least($2::bigint,request_sequence)),updated_at=now() where singleton_key=1 and worker_id=$1", [workerId, capturedSequence]);
  return result.rowCount === 1;
}

async function recordCycleCompletion(workerId: string, capturedSequence: string, error: string | null): Promise<boolean> {
  const result = await pool.query("update request_scan_worker_runtime set acknowledged_sequence=greatest(acknowledged_sequence,least($2::bigint,request_sequence)),cycle_completed_at=now(),last_success_at=case when $3::text is null then now() else last_success_at end,last_error_at=case when $3::text is null then last_error_at else now() end,last_error=$3,updated_at=now() where singleton_key=1 and worker_id=$1", [workerId, capturedSequence, error]);
  return result.rowCount === 1;
}

export async function recordRequestScanWorkerCycleSuccess(workerId: string, capturedSequence: string): Promise<boolean> { return recordCycleCompletion(workerId, capturedSequence, null); }
export async function recordRequestScanWorkerCycleFailure(workerId: string, capturedSequence: string, error: unknown): Promise<boolean> {
  const message = error instanceof Error ? error.message : "Request Scan worker cycle failed";
  return recordCycleCompletion(workerId, capturedSequence, message.slice(0, 300));
}
export async function releaseRequestScanWorkerLeadership(workerId: string): Promise<boolean> {
  const result = await pool.query("update request_scan_worker_runtime set worker_id=null,worker_started_at=null,worker_heartbeat_at=null,cycle_started_at=null,updated_at=now() where singleton_key=1 and worker_id=$1", [workerId]);
  return result.rowCount === 1;
}
