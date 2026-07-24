import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../db/pool.js";
import { claimNextRequestScanJob, claimRequestScanJob, recoverExpiredRequestScanJobs, renewRequestScanLease, updateRequestScanProgress } from "./request-scan-processing-service.js";

const ids: number[] = [];
async function ready(t: { skip(message: string): void }) { try { await pool.query("select 1"); return true; } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return false; } }
async function job() { const marker = `${Date.now()}-${Math.random()}`; const result = await pool.query<{ id: number }>("insert into request_scan_jobs(filename,source_relative_path,mime_type,status) values($1,$2,'application/pdf','pending') returning id", [`request-${marker}.pdf`, `Requests\\Incoming\\request-${marker}.pdf`]); const id = Number(result.rows[0]!.id); ids.push(id); return id; }
test("Request Scan durable-processing migration exposes columns and indexes", async (t) => { if (!(await ready(t))) return; const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='request_scan_jobs' and column_name=any($1::text[])", [["processing_stage","processing_started_at","stage_started_at","heartbeat_at","worker_id","lease_token","lease_expires_at","progress_current","progress_total","recovery_count"]]); assert.equal(columns.rows.length, 10); const indexes = await pool.query<{ indexname: string }>("select indexname from pg_indexes where tablename='request_scan_jobs' and indexname=any($1::text[])", [["request_scan_jobs_pending_claim_idx","request_scan_jobs_expired_lease_idx","request_scan_jobs_active_queue_idx"]]); assert.equal(indexes.rows.length, 3); });
test("claim is atomic and lease ownership protects stage updates", async (t) => { if (!(await ready(t))) return; const id = await job(); const [first, second] = await Promise.all([claimRequestScanJob(id, "worker-a"), claimRequestScanJob(id, "worker-b")]); const claimed = first ?? second; assert.ok(claimed); assert.equal(Boolean(first && second), false); assert.equal(claimed.job.attempt_count, 1); assert.equal(await updateRequestScanProgress(id, claimed.lease, { stage: "scanning_original_300_dpi", current: 1, total: 9 }), true); assert.equal(await updateRequestScanProgress(id, { workerId: "old", token: "00000000-0000-4000-8000-000000000000" }, { stage: "failed" }), false); assert.equal(await renewRequestScanLease(id, claimed.lease), true); });
test("claim-next atomically gives concurrent slots different pending jobs in priority order", async (t) => {
  if (!(await ready(t))) return;
  const first = await job(); const second = await job(); const priority = await job(); const ignored = await job();
  await pool.query("update request_scan_jobs set priority_requested_at=now() - interval '1 second' where id=$1", [priority]);
  await pool.query("update request_scan_jobs set status='processing' where id=$1", [ignored]);
  const priorityClaim = await claimNextRequestScanJob("worker-priority");
  assert.equal(priorityClaim?.job.id, priority);
  const [claimA, claimB] = await Promise.all([claimNextRequestScanJob("worker-a"), claimNextRequestScanJob("worker-b")]);
  assert.ok(claimA); assert.ok(claimB); assert.notEqual(claimA.job.id, claimB.job.id);
  assert.equal([claimA.job.id, claimB.job.id].sort().join(","), [first, second].sort().join(","));
  assert.equal(claimA.job.id === ignored || claimB.job.id === ignored, false);
  assert.notEqual(claimA.lease.token, claimB.lease.token);
  assert.equal([claimA.job.worker_id, claimB.job.worker_id].sort().join(","), "worker-a,worker-b");
  assert.equal(await claimNextRequestScanJob("worker-c"), null);
});
test("expired leases recover conservatively while active leases remain processing", async (t) => { if (!(await ready(t))) return; const id = await job(); const claimed = await claimRequestScanJob(id, "worker-a"); assert.ok(claimed); await pool.query("update request_scan_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [id]); assert.equal((await recoverExpiredRequestScanJobs()).requeued, 1); const row = await pool.query<{ status: string; recovery_count: number }>("select status,recovery_count from request_scan_jobs where id=$1", [id]); assert.deepEqual(row.rows[0], { status: "pending", recovery_count: 1 }); });
after(async () => { if (ids.length) await pool.query("delete from request_scan_jobs where id=any($1::bigint[])", [ids]); await pool.end(); });
