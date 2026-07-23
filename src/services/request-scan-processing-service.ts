import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import type { RequestScanJob } from "./request-scan-service.js";

export const REQUEST_SCAN_HEARTBEAT_MS = 12_000;
export const REQUEST_SCAN_LEASE_MS = 60_000;
export const REQUEST_SCAN_MAX_RECOVERIES = 3;
export type RequestScanProcessingStage = "queued" | "downloading" | "checking_filename" | "rendering_300_dpi" | "scanning_original_300_dpi" | "extracting_native_pdf_image" | "scanning_native_pdf_image" | "scanning_qr_crops" | "scanning_enhanced_300_dpi" | "rendering_600_dpi" | "scanning_original_600_dpi" | "scanning_enhanced_600_dpi" | "verifying_identifier" | "resolving_appointment" | "checking_duplicate" | "attaching_document" | "moving_file" | "completed" | "failed";
export type RequestScanProgressUpdate = { stage: RequestScanProcessingStage; current?: number | null; total?: number | null };
export type RequestScanLease = { workerId: string; token: string };

export function createRequestScanWorkerId(): string { return `${process.env.COMPUTERNAME || process.env.HOSTNAME || "worker"}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`; }
export async function claimRequestScanJob(jobId: number, workerId: string): Promise<{ job: RequestScanJob; lease: RequestScanLease } | null> {
  const token = crypto.randomUUID();
  const { rows } = await pool.query(`update request_scan_jobs set status='processing',processing_stage='downloading',processing_started_at=coalesce(processing_started_at,now()),stage_started_at=now(),heartbeat_at=now(),worker_id=$2,lease_token=$3::uuid,lease_expires_at=now()+($4::int * interval '1 millisecond'),progress_current=null,progress_total=null,error_message=null,attempt_count=attempt_count+1,updated_at=now() where id=$1 and status='pending' returning *`, [jobId, workerId, token, REQUEST_SCAN_LEASE_MS]);
  return rows[0] ? { job: rows[0] as RequestScanJob, lease: { workerId, token } } : null;
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
  const failed = await pool.query(`update request_scan_jobs set status='failed',processing_stage='failed',error_message='Processing was interrupted repeatedly. Retry or assign the document manually.',completed_at=now(),worker_id=null,lease_token=null,lease_expires_at=null,progress_current=null,progress_total=null,updated_at=now() where status='processing' and lease_expires_at < now() and recovery_count >= $1`, [REQUEST_SCAN_MAX_RECOVERIES - 1]);
  const requeued = await pool.query(`update request_scan_jobs set status='pending',processing_stage='queued',stage_started_at=now(),worker_id=null,lease_token=null,lease_expires_at=null,progress_current=null,progress_total=null,recovery_count=recovery_count+1,completed_at=null,updated_at=now() where status='processing' and lease_expires_at < now() and recovery_count < $1`, [REQUEST_SCAN_MAX_RECOVERIES - 1]);
  return { requeued: requeued.rowCount ?? 0, failed: failed.rowCount ?? 0 };
}
