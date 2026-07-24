import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { getDocumentAbsolutePath, type DocumentRow } from "./document-service.js";
import { resolveStorageBasePath } from "./document-storage-path.js";
import { logAuditEntry } from "./audit-service.js";
import { listRequestScanFiles, reconcileRequestScanMove, validateRequestScanRemoteFilename } from "./request-scan-smb-service.js";
import { readRequestScanSettings, type RequestScanSettings } from "./request-scan-settings-service.js";
import { loadSettingsMap } from "./settings-service.js";
import type { RequestScanJob } from "./request-scan-service.js";

export const REQUEST_SCAN_RESET_ADVISORY_LOCK = 1_421_421;
export const REQUEST_SCAN_RESET_CONFIRMATION = "RESET REQUEST SCANS";
export function isRequestScanDevResetEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.RISPRO_REQUEST_SCAN_DEV_RESET_ENABLED === "true";
}
function requireEnabled(): void { if (!isRequestScanDevResetEnabled()) throw new HttpError(404, "Request Scan development reset is disabled."); }
function folderSettings(settings: RequestScanSettings, folder: string): RequestScanSettings { return { ...settings, incomingSubfolder: folder }; }
export type RequestScanDevResetPreview = {
  enabled: boolean; jobs: number; pending: number; processing: number; failed: number; processed: number; duplicates: number;
  automatedDocuments: number; filesIncoming: number; filesProcessed: number; filesFailed: number; pathConflicts: number;
};
type RequestScanDevResetDependencies = {
  readSettings: typeof readRequestScanSettings;
  listFiles: typeof listRequestScanFiles;
  reconcileMove: typeof reconcileRequestScanMove;
  removeFile: (absolutePath: string) => Promise<void>;
  documentRoots: () => Promise<string[]>;
  audit: typeof logAuditEntry;
};
const defaultDependencies: RequestScanDevResetDependencies = { readSettings: readRequestScanSettings, listFiles: listRequestScanFiles, reconcileMove: reconcileRequestScanMove, removeFile: (absolutePath) => fs.rm(absolutePath, { force: true }), documentRoots: allowedDocumentRoots, audit: logAuditEntry };
export async function previewRequestScanDevReset(overrides: Partial<RequestScanDevResetDependencies> = {}): Promise<RequestScanDevResetPreview> {
  requireEnabled();
  const dependencies = { ...defaultDependencies, ...overrides }; const settings = await dependencies.readSettings();
  const { rows } = await pool.query(`select count(*)::int jobs,count(*) filter(where status='pending')::int pending,count(*) filter(where status='processing')::int processing,count(*) filter(where status='failed')::int failed,count(*) filter(where status='processed')::int processed,count(*) filter(where status='duplicate')::int duplicates,count(distinct d.id)::int automated_documents
    from request_scan_jobs j left join documents d on d.source='request_scan_automation' and (d.request_scan_job_id=j.id or d.id=j.document_id)`);
  const conflicts = await pool.query(`select count(*)::int count from (select filename from request_scan_jobs group by filename having count(*)>1) duplicates`);
  const [filesIncoming, filesProcessed, filesFailed] = await Promise.all([
    dependencies.listFiles(folderSettings(settings, settings.incomingSubfolder)).then((files) => files.length),
    dependencies.listFiles(folderSettings(settings, settings.processedSubfolder)).then((files) => files.length),
    dependencies.listFiles(folderSettings(settings, settings.failedSubfolder)).then((files) => files.length),
  ]);
  const value = rows[0] || {};
  return { enabled: true, jobs: Number(value.jobs || 0), pending: Number(value.pending || 0), processing: Number(value.processing || 0), failed: Number(value.failed || 0), processed: Number(value.processed || 0), duplicates: Number(value.duplicates || 0), automatedDocuments: Number(value.automated_documents || 0), filesIncoming, filesProcessed, filesFailed, pathConflicts: Number(conflicts.rows[0]?.count || 0) };
}
function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
async function allowedDocumentRoots(): Promise<string[]> {
  const settings = (await loadSettingsMap(["documents_and_uploads"])).documents_and_uploads || {};
  return [env.uploadsDir, String(settings.storage_path || "").trim()].filter(Boolean).map(resolveStorageBasePath);
}
export async function resetRequestScanDevelopmentData(userId: number, confirmation: unknown, overrides: Partial<RequestScanDevResetDependencies> = {}): Promise<{ completed: true; jobsDeleted: number; documentsDeleted: number; filesReturned: number; redundantCopiesRemoved: number }> {
  requireEnabled();
  const dependencies = { ...defaultDependencies, ...overrides };
  if (confirmation !== REQUEST_SCAN_RESET_CONFIRMATION) throw new HttpError(400, `Type ${REQUEST_SCAN_RESET_CONFIRMATION} exactly to continue.`);
  const client = await pool.connect(); let locked = false;
  try {
    const lock = await client.query<{ acquired: boolean }>("select pg_try_advisory_lock($1) acquired", [REQUEST_SCAN_RESET_ADVISORY_LOCK]);
    if (!lock.rows[0]?.acquired) throw new HttpError(409, "Another Request Scan development reset is already running.");
    locked = true;
    const active = await client.query(`select count(*)::int count from request_scan_jobs where status='processing'`);
    const runtime = await client.query(`select cycle_started_at,cycle_completed_at from request_scan_worker_runtime where singleton_key=1`);
    const state = runtime.rows[0]; const cycleActive = Boolean(state?.cycle_started_at && (!state.cycle_completed_at || new Date(state.cycle_started_at) > new Date(state.cycle_completed_at)));
    if (Number(active.rows[0]?.count || 0) > 0 || cycleActive) throw new HttpError(409, "Request Scan worker must be idle before development data can be reset.");
    const settings = await dependencies.readSettings();
    const jobs = (await client.query<RequestScanJob>("select * from request_scan_jobs order by id")).rows;
    const incomingPaths = new Set((await dependencies.listFiles(settings)).map(({ relativePath }) => relativePath));
    const destinations = new Set<string>(); let filesReturned = 0; let redundantCopiesRemoved = 0;
    for (const job of jobs) {
      const filename = validateRequestScanRemoteFilename(path.basename(job.filename));
      const incoming = `${settings.incomingSubfolder.replace(/[\\/]+$/g, "")}\\${filename}`;
      if (destinations.has(incoming)) throw new HttpError(409, "Request Scan reset found conflicting Incoming destinations. Conflicting files were preserved.");
      destinations.add(incoming);
      const candidates = [...new Set([job.source_relative_path, job.return_destination_path, job.return_source_path, job.intended_destination_path].filter((value): value is string => Boolean(value)))];
      let recovered = false;
      for (const source of candidates) {
        if (source === incoming) { if (incomingPaths.has(incoming)) recovered = true; if (recovered) break; continue; }
        const outcome = await dependencies.reconcileMove(settings, source, incoming, undefined, { jobId: Number(job.id) });
        if (outcome === "conflict") throw new HttpError(409, "Request Scan reset found files with different contents. Both copies were preserved.");
        if (outcome === "moved") { filesReturned += 1; recovered = true; break; }
        if (outcome === "identical_source_removed") { redundantCopiesRemoved += 1; recovered = true; break; }
        if (outcome === "already_moved") { recovered = true; break; }
      }
      if (!recovered) throw new HttpError(409, "A Request Scan original file could not be located. No database data was deleted.");
    }
    const jobIds = jobs.map(({ id }) => Number(id));
    const documents = jobIds.length ? (await client.query<DocumentRow>(`select distinct d.* from documents d where d.source='request_scan_automation' and (d.request_scan_job_id=any($1::bigint[]) or d.id in (select document_id from request_scan_jobs where id=any($1::bigint[]) and document_id is not null))`, [jobIds])).rows : [];
    const roots = await dependencies.documentRoots();
    for (const document of documents) {
      const absolutePath = getDocumentAbsolutePath(document);
      if (!roots.some((root) => isWithin(root, absolutePath))) throw new HttpError(409, "A Request Scan document path is outside configured storage. No document data was deleted.");
    }
    for (const document of documents) await dependencies.removeFile(getDocumentAbsolutePath(document));
    await client.query("begin");
    if (documents.length) await client.query("delete from documents where id=any($1::bigint[])", [documents.map(({ id }) => Number(id))]);
    if (jobIds.length) await client.query("delete from request_scan_jobs where id=any($1::bigint[])", [jobIds]);
    await client.query(`update request_scan_worker_runtime set request_sequence=0,acknowledged_sequence=0,run_requested_at=null,worker_id=null,worker_started_at=null,worker_heartbeat_at=null,cycle_started_at=null,cycle_completed_at=null,last_success_at=null,last_error_at=null,last_error=null,updated_at=now() where singleton_key=1`);
    await dependencies.audit({ entityType: "request_scan_job", actionType: "request_scan_development_reset", newValues: { jobsDeleted: jobIds.length, documentsDeleted: documents.length, filesReturned, redundantCopiesRemoved }, changedByUserId: userId }, client);
    await client.query("commit");
    return { completed: true, jobsDeleted: jobIds.length, documentsDeleted: documents.length, filesReturned, redundantCopiesRemoved };
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { if (locked) await client.query("select pg_advisory_unlock($1)", [REQUEST_SCAN_RESET_ADVISORY_LOCK]).catch(() => undefined); client.release(); }
}
