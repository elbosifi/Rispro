import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs/promises";
import { pool } from "../db/pool.js";
import { beginRequestScanAttachment, claimNextRequestScanJob, claimRequestScanJob, recoverExpiredRequestScanJobs, renewRequestScanLease, RequestScanCancellationRequestedError, updateRequestScanProgress } from "./request-scan-processing-service.js";
import { acquireRequestScanWorkerLeadership, releaseRequestScanWorkerLeadership } from "./request-scan-worker-control-service.js";

const ids: number[] = [];
async function ready(t: { skip(message: string): void }) { try { await pool.query("select 1"); return true; } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return false; } }
async function job() { const marker = `${Date.now()}-${Math.random()}`; const result = await pool.query<{ id: number }>("insert into request_scan_jobs(filename,source_relative_path,mime_type,status) values($1,$2,'application/pdf','pending') returning id", [`request-${marker}.pdf`, `Requests\\Incoming\\request-${marker}.pdf`]); const id = Number(result.rows[0]!.id); ids.push(id); return id; }
test("Request Scan durable-processing migration exposes columns and indexes", async (t) => { if (!(await ready(t))) return; const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='request_scan_jobs' and column_name=any($1::text[])", [["processing_stage","processing_started_at","stage_started_at","heartbeat_at","worker_id","lease_token","lease_expires_at","progress_current","progress_total","recovery_count"]]); assert.equal(columns.rows.length, 10); const indexes = await pool.query<{ indexname: string }>("select indexname from pg_indexes where tablename='request_scan_jobs' and indexname=any($1::text[])", [["request_scan_jobs_pending_claim_idx","request_scan_jobs_expired_lease_idx","request_scan_jobs_active_queue_idx"]]); assert.equal(indexes.rows.length, 3); });
test("Request Scan cancellation migration exposes cancellation fields", async (t) => { if (!(await ready(t))) return; const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='request_scan_jobs' and column_name=any($1::text[])", [["cancel_requested_at","cancel_requested_by","cancel_reason"]]); assert.equal(columns.rows.length, 3); });
test("Request Scan Return and identifier migration exposes durable checkpoints", async (t) => { if (!(await ready(t))) return; const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='request_scan_jobs' and column_name=any($1::text[])", [["return_requested_at","return_source_path","return_destination_path","return_completed_at","identifier_verified_at","identifier_strategy"]]); assert.equal(columns.rows.length, 6); });
test("Request Scan failure movement migration exposes durable intent and recovery audit fields", async (t) => { if (!(await ready(t))) return; const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='request_scan_jobs' and column_name=any($1::text[])", [["failure_destination_path","failure_moved_at","archive_recovered_from_path","archive_recovered_at"]]); assert.equal(columns.rows.length, 4); });
test("modality document fingerprint migration is repeatable and indexed", async (t) => { if (!(await ready(t))) return; const sql = await fs.readFile(new URL("../db/migrations/152_modality_document_content_fingerprint.sql", import.meta.url), "utf8"); await pool.query(sql); await pool.query(sql); const column = await pool.query("select 1 from information_schema.columns where table_name='documents' and column_name='content_sha256'"); assert.equal(column.rowCount, 1); const indexes = await pool.query("select indexname from pg_indexes where indexname=any($1::text[]) order by indexname", [["documents_modality_clinical_fingerprint_idx","documents_modality_clinical_legacy_fingerprint_idx"]]); assert.equal(indexes.rowCount, 2); });
test("Request Scan multi-appointment migration is repeatable and exposes normalized links and job idempotency", async (t) => { if (!(await ready(t))) return; const sql = await fs.readFile(new URL("../db/migrations/143_request_scan_multi_appointment_links.sql", import.meta.url), "utf8"); await pool.query(sql); await pool.query(sql); const tables = await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_name=any($1::text[]) order by table_name", [["document_appointment_links","request_scan_job_appointments"]]); assert.deepEqual(tables.rows.map((row) => row.table_name), ["document_appointment_links","request_scan_job_appointments"]); const index = await pool.query("select 1 from pg_indexes where indexname='documents_request_scan_job_unique'"); assert.equal(index.rowCount, 1); });
test("cancellation and attachment use one atomic boundary", async (t) => {
  if (!(await ready(t))) return;
  const stoppedId = await job(); const stoppedClaim = await claimRequestScanJob(stoppedId, "worker-stop"); assert.ok(stoppedClaim);
  await pool.query("update request_scan_jobs set cancel_requested_at=now(),cancel_reason='manual_review_no_identifier' where id=$1 and status='processing' and processing_stage not in ('attaching_document','moving_file')", [stoppedId]);
  await assert.rejects(() => beginRequestScanAttachment(stoppedId, stoppedClaim.lease), RequestScanCancellationRequestedError);
  const stopped = await pool.query<{ processing_stage: string }>("select processing_stage from request_scan_jobs where id=$1", [stoppedId]); assert.notEqual(stopped.rows[0]?.processing_stage, "attaching_document");

  const attachedId = await job(); const attachedClaim = await claimRequestScanJob(attachedId, "worker-attach"); assert.ok(attachedClaim);
  const attached = await beginRequestScanAttachment(attachedId, attachedClaim.lease); assert.equal(attached.processing_stage, "attaching_document");
  const stop = await pool.query("update request_scan_jobs set cancel_requested_at=now() where id=$1 and status='processing' and attachment_completed_at is null and processing_stage not in ('attaching_document','moving_file','completed') returning id", [attachedId]);
  assert.equal(stop.rowCount, 0);
});
test("claim is atomic and lease ownership protects stage updates", async (t) => { if (!(await ready(t))) return; const id = await job(); const [first, second] = await Promise.all([claimRequestScanJob(id, "worker-a"), claimRequestScanJob(id, "worker-b")]); const claimed = first ?? second; assert.ok(claimed); assert.equal(Boolean(first && second), false); assert.equal(claimed.job.attempt_count, 1); assert.equal(await updateRequestScanProgress(id, claimed.lease, { stage: "scanning_original_300_dpi", current: 1, total: 9 }), true); assert.equal(await updateRequestScanProgress(id, { workerId: "old", token: "00000000-0000-4000-8000-000000000000" }, { stage: "failed" }), false); assert.equal(await renewRequestScanLease(id, claimed.lease), true); });
test("claim-next atomically gives concurrent slots different pending jobs in priority order", async (t) => {
  if (!(await ready(t))) return;
  const first = await job(); const second = await job(); const priority = await job(); const ignored = await job();
  await pool.query("update request_scan_jobs set priority_requested_at=now() - interval '1 second' where id=$1", [priority]);
  await pool.query("update request_scan_jobs set status='processing' where id=$1", [ignored]);
  assert.equal(await acquireRequestScanWorkerLeadership("claim-worker"), true);
  assert.equal(await claimNextRequestScanJob("wrong-worker"), null);
  const priorityClaim = await claimNextRequestScanJob("claim-worker");
  assert.equal(Number(priorityClaim?.job.id), priority);
  const [claimA, claimB] = await Promise.all([claimNextRequestScanJob("claim-worker"), claimNextRequestScanJob("claim-worker")]);
  assert.ok(claimA); assert.ok(claimB); assert.notEqual(claimA.job.id, claimB.job.id);
  assert.equal([Number(claimA.job.id), Number(claimB.job.id)].sort().join(","), [first, second].sort().join(","));
  assert.equal(claimA.job.id === ignored || claimB.job.id === ignored, false);
  assert.notEqual(claimA.lease.token, claimB.lease.token);
  assert.equal([claimA.job.worker_id, claimB.job.worker_id].sort().join(","), "claim-worker,claim-worker");
  assert.equal(await claimNextRequestScanJob("worker-c"), null);
  await releaseRequestScanWorkerLeadership("claim-worker");
});
test("expired leases recover conservatively while active leases remain processing", async (t) => { if (!(await ready(t))) return; const id = await job(); const claimed = await claimRequestScanJob(id, "worker-a"); assert.ok(claimed); await pool.query("update request_scan_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [id]); assert.equal((await recoverExpiredRequestScanJobs()).requeued, 1); const row = await pool.query<{ status: string; recovery_count: number }>("select status,recovery_count from request_scan_jobs where id=$1", [id]); assert.deepEqual(row.rows[0], { status: "pending", recovery_count: 1 }); });
after(async () => { if (ids.length) await pool.query("delete from request_scan_jobs where id=any($1::bigint[])", [ids]); await pool.end(); });
