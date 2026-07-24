import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pool } from "../db/pool.js";
import { isRequestScanDevResetEnabled, previewRequestScanDevReset, REQUEST_SCAN_RESET_ADVISORY_LOCK, resetRequestScanDevelopmentData } from "./request-scan-dev-reset-service.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";

const originalNodeEnv = process.env.NODE_ENV; const originalFlag = process.env.RISPRO_REQUEST_SCAN_DEV_RESET_ENABLED;
const ids: number[] = []; const documentIds: number[] = []; const temp = await fs.mkdtemp(path.join(os.tmpdir(), "request-scan-reset-test-"));
const settings = { enabled: true, server: "test", share: "test", domain: "", username: "u", password: "p", incomingSubfolder: "Requests\\Incoming", processedSubfolder: "Requests\\Processed", failedSubfolder: "Requests\\Failed", pollingIntervalSeconds: 15, fileReadyDelaySeconds: 0 } as RequestScanSettings;
const dependencies = {
  readSettings: async () => settings,
  listFiles: async () => [],
  reconcileMove: async () => "moved" as const,
  documentRoots: async () => [temp],
  removeFile: async (value: string) => { await fs.rm(value, { force: true }); },
  audit: async () => null,
};
async function job(status = "failed", filename = `reset-${Date.now()}-${Math.random()}.pdf`): Promise<number> {
  const result = await pool.query<{ id: number }>("insert into request_scan_jobs(filename,source_relative_path,mime_type,status) values($1,$2,'application/pdf',$3) returning id", [filename, `Requests\\Failed\\${filename}`, status]);
  const id = Number(result.rows[0]!.id); ids.push(id); return id;
}
before(async () => { process.env.NODE_ENV = "test"; process.env.RISPRO_REQUEST_SCAN_DEV_RESET_ENABLED = "true"; await pool.query("update request_scan_worker_runtime set worker_id=null,worker_started_at=null,worker_heartbeat_at=null,cycle_started_at=null,cycle_completed_at=null where singleton_key=1"); });

test("development reset is disabled without its flag and always disabled in production", async () => {
  delete process.env.RISPRO_REQUEST_SCAN_DEV_RESET_ENABLED; assert.equal(isRequestScanDevResetEnabled(), false); await assert.rejects(() => previewRequestScanDevReset(dependencies), /disabled/);
  process.env.RISPRO_REQUEST_SCAN_DEV_RESET_ENABLED = "true"; process.env.NODE_ENV = "production"; assert.equal(isRequestScanDevResetEnabled(), false);
  process.env.NODE_ENV = "test"; assert.equal(isRequestScanDevResetEnabled(), true);
});
test("development reset preview is aggregate-only and exact confirmation is required", async () => {
  await job("failed");
  const preview = await previewRequestScanDevReset(dependencies);
  assert.equal(preview.enabled, true); assert.ok(preview.jobs >= 1); assert.deepEqual(Object.keys(preview).sort(), ["automatedDocuments","duplicates","enabled","failed","filesFailed","filesIncoming","filesProcessed","jobs","pathConflicts","pending","processed","processing"].sort());
  await assert.rejects(() => resetRequestScanDevelopmentData(1, "reset request scans", dependencies), /exactly/);
});
test("development reset rejects processing and parallel reset ownership", async () => {
  const processing = await job("processing");
  await assert.rejects(() => resetRequestScanDevelopmentData(1, "RESET REQUEST SCANS", dependencies), /idle/);
  await pool.query("delete from request_scan_jobs where id=$1", [processing]); ids.splice(ids.indexOf(processing), 1);
  const client = await pool.connect();
  try { await client.query("select pg_advisory_lock($1)", [REQUEST_SCAN_RESET_ADVISORY_LOCK]); await assert.rejects(() => resetRequestScanDevelopmentData(1, "RESET REQUEST SCANS", dependencies), /already running/); }
  finally { await client.query("select pg_advisory_unlock($1)", [REQUEST_SCAN_RESET_ADVISORY_LOCK]); client.release(); }
});
test("development reset returns originals, deletes only linked automation documents, resets jobs/runtime, and audits aggregates", async () => {
  const resetJob = await job("failed", "original.pdf");
  const linkedPath = path.join(temp, "linked.pdf"); const unrelatedPath = path.join(temp, "unrelated.pdf"); await fs.writeFile(linkedPath, "linked"); await fs.writeFile(unrelatedPath, "unrelated");
  const linked = await pool.query<{ id: number }>(`insert into documents(document_type,original_filename,stored_path,mime_type,file_size,storage_location_type,source,request_scan_job_id) values('appointment_request','linked.pdf',$1,'application/pdf',6,'local_fallback','request_scan_automation',$2) returning id`, [linkedPath, resetJob]);
  const unrelated = await pool.query<{ id: number }>(`insert into documents(document_type,original_filename,stored_path,mime_type,file_size,storage_location_type,source) values('other','unrelated.pdf',$1,'application/pdf',9,'local_fallback','manual_upload') returning id`, [unrelatedPath]);
  documentIds.push(Number(linked.rows[0]!.id), Number(unrelated.rows[0]!.id));
  const reconciled: string[] = []; let auditValues: unknown;
  const result = await resetRequestScanDevelopmentData(1, "RESET REQUEST SCANS", { ...dependencies, reconcileMove: async (_settings, source) => { reconciled.push(source); return "moved"; }, audit: async (entry) => { auditValues = entry.newValues; return null; } });
  assert.equal(result.completed, true); assert.ok(reconciled.length > 0); assert.equal(await fs.stat(linkedPath).then(() => true, () => false), false); assert.equal(await fs.stat(unrelatedPath).then(() => true, () => false), true);
  assert.equal((await pool.query("select 1 from documents where id=$1", [linked.rows[0]!.id])).rowCount, 0); assert.equal((await pool.query("select 1 from documents where id=$1", [unrelated.rows[0]!.id])).rowCount, 1);
  assert.equal((await pool.query("select 1 from request_scan_jobs where id=$1", [resetJob])).rowCount, 0); assert.deepEqual(Object.keys(auditValues as object).sort(), ["documentsDeleted","filesReturned","jobsDeleted","redundantCopiesRemoved"].sort());
  const runtime = await pool.query("select request_sequence,acknowledged_sequence,worker_id,last_error from request_scan_worker_runtime where singleton_key=1"); assert.equal(String(runtime.rows[0].request_sequence), "0"); assert.equal(runtime.rows[0].worker_id, null);
});
test("different reset copies are preserved and database rows remain", async () => {
  const conflictJob = await job("failed", "conflict.pdf");
  await assert.rejects(() => resetRequestScanDevelopmentData(1, "RESET REQUEST SCANS", { ...dependencies, reconcileMove: async () => "conflict" }), /different contents/);
  assert.equal((await pool.query("select 1 from request_scan_jobs where id=$1", [conflictJob])).rowCount, 1);
});
after(async () => {
  if (ids.length) await pool.query("delete from request_scan_jobs where id=any($1::bigint[])", [ids]);
  if (documentIds.length) await pool.query("delete from documents where id=any($1::bigint[])", [documentIds]);
  await fs.rm(temp, { recursive: true, force: true }); process.env.NODE_ENV = originalNodeEnv; if (originalFlag == null) delete process.env.RISPRO_REQUEST_SCAN_DEV_RESET_ENABLED; else process.env.RISPRO_REQUEST_SCAN_DEV_RESET_ENABLED = originalFlag; await pool.end();
});
