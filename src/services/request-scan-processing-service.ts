import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import type { RequestScanJob } from "./request-scan-service.js";
import { REQUEST_SCAN_WORKER_STALE_MS } from "./request-scan-worker-control-service.js";

export const REQUEST_SCAN_HEARTBEAT_MS = 12_000;
export const REQUEST_SCAN_LEASE_MS = 60_000;
export const REQUEST_SCAN_MAX_RECOVERIES = 3;
export type RequestScanProcessingStage = "queued" | "downloading" | "checking_filename" | "rendering_300_dpi" | "scanning_original_300_dpi" | "extracting_native_pdf_image" | "scanning_native_pdf_image" | "scanning_qr_crops" | "scanning_enhanced_300_dpi" | "rendering_600_dpi" | "scanning_original_600_dpi" | "scanning_enhanced_600_dpi" | "verifying_identifier" | "resolving_appointment" | "checking_duplicate" | "attaching_document" | "moving_file" | "completed" | "failed";
export type RequestScanProgressUpdate = { stage: RequestScanProcessingStage; current?: number | null; total?: number | null };
export type RequestScanLease = { workerId: string; token: string };
export type ClaimedRequestScanJob = { job: RequestScanJob; lease: RequestScanLease };
export class RequestScanLeaseLostError extends Error { constructor() { super("Request Scan lease was lost."); this.name = "RequestScanLeaseLostError"; } }

export function createRequestScanWorkerId(): string { return `${process.env.COMPUTERNAME || process.env.HOSTNAME || "worker"}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`; }
export async function claimRequestScanJob(jobId: number, workerId: string): Promise<ClaimedRequestScanJob | null> {
  const token = crypto.randomUUID();
  const { rows } = await pool.query(`update request_scan_jobs set status='processing',processing_stage='downloading',processing_started_at=coalesce(processing_started_at,now()),stage_started_at=now(),heartbeat_at=now(),worker_id=$2,lease_token=$3::uuid,lease_expires_at=now()+($4::int * interval '1 millisecond'),priority_requested_at=null,progress_current=null,progress_total=null,error_message=null,attempt_count=attempt_count+1,updated_at=now() where id=$1 and status='pending' returning *`, [jobId, workerId, token, REQUEST_SCAN_LEASE_MS]);
  return rows[0] ? { job: rows[0] as RequestScanJob, lease: { workerId, token } } : null;
}
export async function claimNextRequestScanJob(workerId: string): Promise<ClaimedRequestScanJob | null> {
  const token = crypto.randomUUID();
  const { rows } = await pool.query(`with active_owner as (
    select 1 from request_scan_worker_runtime
    where singleton_key=1 and worker_id=$1 and worker_heartbeat_at >= now()-($4::int * interval '1 millisecond')
  ), candidate as (
    select id from request_scan_jobs
    where status='pending' and exists (select 1 from active_owner)
    order by priority_requested_at asc nulls last,created_at asc,id asc
    for update skip locked
    limit 1
  )
  update request_scan_jobs job set
    status='processing',processing_stage='downloading',processing_started_at=coalesce(job.processing_started_at,now()),stage_started_at=now(),heartbeat_at=now(),worker_id=$1,lease_token=$2::uuid,lease_expires_at=now()+($3::int * interval '1 millisecond'),priority_requested_at=null,progress_current=null,progress_total=null,error_message=null,attempt_count=job.attempt_count+1,updated_at=now()
  from candidate where job.id=candidate.id
  returning job.*`, [workerId, token, REQUEST_SCAN_LEASE_MS, REQUEST_SCAN_WORKER_STALE_MS]);
  return rows[0] ? { job: rows[0] as RequestScanJob, lease: { workerId, token } } : null;
}
export async function assertRequestScanLeaseOwned(jobId: number, lease: RequestScanLease): Promise<void> {
  const result = await pool.query(`select 1 from request_scan_jobs where id=$1 and status='processing' and worker_id=$2 and lease_token=$3::uuid and lease_expires_at >= now()`, [jobId, lease.workerId, lease.token]);
  if (!result.rowCount) throw new RequestScanLeaseLostError();
}
export async function updateRequestScanCheckpoint(jobId: number, lease: RequestScanLease, values: Record<string, unknown>): Promise<RequestScanJob> {
  const allowed = new Set(["appointment_id", "document_id", "barcode_value", "attachment_completed_at", "attachment_created", "intended_destination_path", "source_relative_path", "source_moved_at"]);
  const names = Object.keys(values);
  if (!names.length || names.some((name) => !allowed.has(name))) throw new Error("Invalid Request Scan checkpoint update.");
  const params = names.map((name) => values[name]);
  const sets = names.map((name, index) => `${name}=$${index + 3}`).join(",");
  const { rows } = await pool.query(`update request_scan_jobs set ${sets},heartbeat_at=now(),lease_expires_at=now()+($${params.length + 3}::int * interval '1 millisecond'),updated_at=now() where id=$1 and status='processing' and worker_id=$2 and lease_token=$${params.length + 4}::uuid and lease_expires_at >= now() returning *`, [jobId, lease.workerId, ...params, REQUEST_SCAN_LEASE_MS, lease.token]);
  if (!rows[0]) throw new RequestScanLeaseLostError();
  return rows[0] as RequestScanJob;
}
export async function renewRequestScanLease(jobId: number, lease: RequestScanLease): Promise<boolean> {
  const result = await pool.query(`update request_scan_jobs set heartbeat_at=now(),lease_expires_at=now()+($3::int * interval '1 millisecond'),updated_at=now() where id=$1 and status='processing' and lease_token=$2::uuid`, [jobId, lease.token, REQUEST_SCAN_LEASE_MS]); return result.rowCount === 1;
}
export async function updateRequestScanProgress(jobId: number, lease: RequestScanLease, update: RequestScanProgressUpdate): Promise<boolean> {
  if ((update.current != null && update.current < 0) || (update.total != null && update.total < 0) || (update.current != null && update.total != null && update.current > update.total)) throw new Error("Invalid Request Scan progress.");
  const result = await pool.query(`update request_scan_jobs set processing_stage=$3,stage_started_at=case when processing_stage is distinct from $3 then now() else stage_started_at end,progress_current=$4,progress_total=$5,heartbeat_at=now(),lease_expires_at=now()+($6::int * interval '1 millisecond'),updated_at=now() where id=$1 and status='processing' and lease_token=$2::uuid and (processing_stage is distinct from $3 or progress_current is distinct from $4 or progress_total is distinct from $5)`, [jobId, lease.token, update.stage, update.current ?? null, update.total ?? null, REQUEST_SCAN_LEASE_MS]);
  if (result.rowCount === 1) return true;
  const ownership = await pool.query(`select 1 from request_scan_jobs where id=$1 and status='processing' and lease_token=$2::uuid`, [jobId, lease.token]);
  return Boolean(ownership.rowCount);
}
export async function finishRequestScanJob(jobId: number, lease: RequestScanLease, values: Record<string, unknown>): Promise<RequestScanJob | null> {
  const terminalValues = { ...values }; delete terminalValues.completed_at;
  const names = Object.keys(terminalValues); const params = names.map((name) => terminalValues[name]);
  const sets = names.map((name, index) => `${name}=$${index + 3}`).join(", ");
  const finalStage = terminalValues.status === "processed" || terminalValues.status === "duplicate" ? "completed" : "failed";
  const { rows } = await pool.query(`update request_scan_jobs set ${sets},processing_stage=$${params.length + 3},stage_started_at=now(),completed_at=coalesce(completed_at,now()),worker_id=null,lease_token=null,lease_expires_at=null,updated_at=now() where id=$1 and lease_token=$2::uuid returning *`, [jobId, lease.token, ...params, finalStage]);
  return rows[0] as RequestScanJob | undefined ?? null;
}
export async function recoverExpiredRequestScanJobs(): Promise<{ requeued: number; failed: number }> {
  const failed = await pool.query(`update request_scan_jobs set status='failed',processing_stage='failed',error_message='Processing was interrupted repeatedly. Retry or assign the document manually.',failure_category='processing_interrupted',completed_at=now(),worker_id=null,lease_token=null,lease_expires_at=null,progress_current=null,progress_total=null,updated_at=now() where status='processing' and lease_expires_at < now() and recovery_count >= $1`, [REQUEST_SCAN_MAX_RECOVERIES - 1]);
  const requeued = await pool.query(`update request_scan_jobs set status='pending',processing_stage='queued',stage_started_at=now(),worker_id=null,lease_token=null,lease_expires_at=null,progress_current=null,progress_total=null,recovery_count=recovery_count+1,completed_at=null,updated_at=now() where status='processing' and lease_expires_at < now() and recovery_count < $1`, [REQUEST_SCAN_MAX_RECOVERIES - 1]);
  return { requeued: requeued.rowCount ?? 0, failed: failed.rowCount ?? 0 };
}
