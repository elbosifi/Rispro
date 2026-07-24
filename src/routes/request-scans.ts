import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { asUnknownRecord } from "../utils/records.js";
import { pool } from "../db/pool.js";
import { auditBulkRequestScanRetry, bulkDismissRequestScanJobs, bulkRetryRequestScanJobs, dismissRequestScanJob, downloadRequestScanJobFile, getRequestScanJob, listRequestScanJobs, manuallyAssignRequestScan, prioritizePendingRequestScanJob, retryRequestScanJob, restoreDismissedRequestScanJob, returnRequestScanToIncoming, withSafeRequestScanFilename } from "../services/request-scan-service.js";
import { readRequestScanSettings } from "../services/request-scan-settings-service.js";
import { isRequestScanWorkerHeartbeatFresh, readRequestScanWorkerRuntime, requestRequestScanWorkerRun as signalRequestScanWorkerRun } from "../services/request-scan-worker-control-service.js";
import type { RequestScanJob } from "../services/request-scan-service.js";
import { getTripoliToday } from "../utils/date.js";
import path from "node:path";

const allowed = ["receptionist", "supervisor", "super_admin", "doctor"] as const;
export const requestScansRouter = express.Router();
requestScansRouter.use(requireAuth, requireAnyRole([...allowed]));
function positive(value: unknown, name: string): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, `${name} must be a positive integer.`); return parsed; }
function jobIds(value: unknown): number[] { if (!Array.isArray(value)) throw new HttpError(400, "jobIds must be an array."); const ids = [...new Set(value.map((id) => positive(id, "jobId")))]; if (!ids.length || ids.length > 50) throw new HttpError(400, "Select between 1 and 50 request scans."); return ids; }
export function buildInlineContentDisposition(filename: string, mimeType: string): string {
  const basename = path.win32.basename(path.posix.basename(String(filename))).normalize("NFC").replace(/[\u0000-\u001f\u007f"\\]/g, "");
  const extension = mimeType === "application/pdf" ? ".pdf" : mimeType === "image/jpeg" ? ".jpg" : /\.(pdf|jpe?g)$/i.test(basename) ? path.extname(basename).toLowerCase() : "";
  const safeUnicode = basename || `request-scan${extension}`;
  const encoded = encodeURIComponent(safeUnicode).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="request-scan${extension}"; filename*=UTF-8''${encoded}`;
}
export function setRequestScanFileHeaders(res: Response, job: Pick<RequestScanJob, "mime_type" | "filename">): void { const safeJob = withSafeRequestScanFilename(job); res.setHeader("Content-Type", job.mime_type); res.setHeader("Content-Disposition", buildInlineContentDisposition(safeJob.filename, job.mime_type)); res.setHeader("Cache-Control", "private, no-store"); }
export function sendRequestScanFileResponse(res: Response, job: Pick<RequestScanJob, "mime_type" | "filename">, buffer: Buffer): void { setRequestScanFileHeaders(res, job); res.status(200).send(buffer); }
type RequestScanStatusCounts = { pending: number; processing: number; processed_today: number; duplicates_today: number; failed: number; dismissed?: number };
type RequestScanStatusDependencies = { readSettings: typeof readRequestScanSettings; readRuntime?: typeof readRequestScanWorkerRuntime; query: (text: string, values?: unknown[]) => Promise<{ rows: RequestScanStatusCounts[] }> };
const requestScanStatusDependencies: RequestScanStatusDependencies = { readSettings: readRequestScanSettings, readRuntime: readRequestScanWorkerRuntime, query: (text, values) => pool.query<RequestScanStatusCounts>(text, values) };
export async function getRequestScanStatus(now = new Date(), dependencies: RequestScanStatusDependencies = requestScanStatusDependencies) {
  const [settings, countResult, runtime] = await Promise.all([
    dependencies.readSettings(),
    dependencies.query(`select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'processing')::int as processing, count(*) filter (where status = 'processed' and completed_at >= ($1::date::timestamp at time zone 'Africa/Tripoli') and completed_at < (($1::date + 1)::timestamp at time zone 'Africa/Tripoli'))::int as processed_today, count(*) filter (where status = 'duplicate' and completed_at >= ($1::date::timestamp at time zone 'Africa/Tripoli') and completed_at < (($1::date + 1)::timestamp at time zone 'Africa/Tripoli'))::int as duplicates_today, count(*) filter (where status = 'failed' and dismissed_at is null)::int as failed, count(*) filter (where status = 'failed' and dismissed_at is not null)::int as dismissed from request_scan_jobs`, [getTripoliToday(now)]),
    dependencies.readRuntime ? dependencies.readRuntime() : Promise.resolve({ request_sequence: "0", acknowledged_sequence: "0", run_requested_at: null, worker_id: null, worker_started_at: null, worker_heartbeat_at: null, cycle_started_at: null, cycle_completed_at: null, last_success_at: null, last_error_at: null, last_error: null }),
  ]);
  const counts = countResult.rows[0] || { pending: 0, processing: 0, processed_today: 0, duplicates_today: 0, failed: 0, dismissed: 0 };
  const workerOnline = isRequestScanWorkerHeartbeatFresh(runtime, now);
  const running = workerOnline && Boolean(runtime.cycle_started_at && (!runtime.cycle_completed_at || new Date(runtime.cycle_started_at) > new Date(runtime.cycle_completed_at)));
  return { enabled: settings.enabled, running, lastRunAt: runtime.last_success_at, lastError: runtime.last_error, workerOnline, workerId: runtime.worker_id, workerStartedAt: runtime.worker_started_at, workerHeartbeatAt: runtime.worker_heartbeat_at, cycleStartedAt: runtime.cycle_started_at, cycleCompletedAt: runtime.cycle_completed_at, pending: Number(counts.pending), processing: Number(counts.processing), processedToday: Number(counts.processed_today), duplicatesToday: Number(counts.duplicates_today), failed: Number(counts.failed), dismissed: Number(counts.dismissed ?? 0) };
}

type RequestScanTriggerRouteDependencies = {
  triggerWorker: () => Promise<{ status: "accepted" | "already_running" | "disabled" }>;
};
type RequestScanRetryRouteDependencies = RequestScanTriggerRouteDependencies & {
  retryJob: typeof retryRequestScanJob;
};
async function durableRequestScanTrigger(): Promise<{ status: "accepted" | "already_running" | "disabled" }> {
  const settings = await readRequestScanSettings();
  if (!settings.enabled) return { status: "disabled" };
  const runtime = await signalRequestScanWorkerRun();
  const running = isRequestScanWorkerHeartbeatFresh(runtime) && Boolean(runtime.cycle_started_at && (!runtime.cycle_completed_at || new Date(runtime.cycle_started_at) > new Date(runtime.cycle_completed_at)));
  return { status: running ? "already_running" : "accepted" };
}
export async function requestRequestScanRunNow(dependencies: RequestScanTriggerRouteDependencies = { triggerWorker: durableRequestScanTrigger }) {
  return dependencies.triggerWorker();
}
export async function queueRequestScanRetry(id: number, dependencies: RequestScanRetryRouteDependencies = { retryJob: retryRequestScanJob, triggerWorker: durableRequestScanTrigger }) {
  const job = await dependencies.retryJob(id);
  const trigger = await dependencies.triggerWorker();
  return { job: withSafeRequestScanFilename(job), trigger };
}

requestScansRouter.get("/", asyncRoute(async (req: Request, res: Response) => { res.json({ jobs: (await listRequestScanJobs(req.query.status, req.query.category)).map(withSafeRequestScanFilename) }); }));
requestScansRouter.get("/status", asyncRoute(async (_req: Request, res: Response) => { res.json(await getRequestScanStatus()); }));
requestScansRouter.get("/eligible-appointments", asyncRoute(async (req: Request, res: Response) => { const q = String(req.query.q || "").trim(); const { rows } = await pool.query(`select b.id, ('V2-' || lpad(b.id::text,6,'0')) as accession_number, coalesce(p.english_full_name,p.arabic_full_name) as patient_name from appointments_v2.bookings b join patients p on p.id=b.patient_id where b.status not in ('cancelled','discontinued','voided') and ($1='' or ('V2-' || lpad(b.id::text,6,'0')) ilike $2 or p.english_full_name ilike $2 or p.arabic_full_name ilike $2) order by b.booking_date desc,b.id desc limit 20`, [q, `%${q}%`]); res.json({ appointments: rows }); }));
requestScansRouter.get("/:id/file", asyncRoute(async (req: Request, res: Response) => { const { job, buffer } = await downloadRequestScanJobFile(positive(req.params.id, "id")); sendRequestScanFileResponse(res, job, buffer); }));
requestScansRouter.post("/run-now", asyncRoute(async (_req: Request, res: Response) => { res.status(202).json({ ok: true, trigger: await requestRequestScanRunNow() }); }));
requestScansRouter.post("/bulk-retry", asyncRoute(async (req: Request, res: Response) => { const result = await bulkRetryRequestScanJobs(jobIds(asUnknownRecord(req.body).jobIds)); const trigger = result.queued.length ? await requestRequestScanRunNow() : null; await auditBulkRequestScanRetry(result, Number(req.user!.sub), trigger?.status ?? "not_triggered"); res.status(202).json({ queued: result.queued.map(withSafeRequestScanFilename), failed: result.failed, trigger }); }));
requestScansRouter.post("/bulk-dismiss", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ jobs: (await bulkDismissRequestScanJobs(jobIds(body.jobIds), Number(req.user!.sub), body.reason)).map(withSafeRequestScanFilename) }); }));
requestScansRouter.post("/:id/start-now", asyncRoute(async (req: Request, res: Response) => { const job = await prioritizePendingRequestScanJob(positive(req.params.id, "id")); res.status(202).json({ job: withSafeRequestScanFilename(job), trigger: await requestRequestScanRunNow() }); }));
requestScansRouter.post("/:id/retry", asyncRoute(async (req: Request, res: Response) => { res.status(202).json(await queueRequestScanRetry(positive(req.params.id, "id"))); }));
requestScansRouter.post("/:id/dismiss", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ job: withSafeRequestScanFilename(await dismissRequestScanJob(positive(req.params.id, "id"), Number(req.user!.sub), body.reason)) }); }));
requestScansRouter.post("/:id/restore-dismissed", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await restoreDismissedRequestScanJob(positive(req.params.id, "id"), Number(req.user!.sub)) )}); }));
requestScansRouter.post("/:id/return-to-incoming", asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await returnRequestScanToIncoming(positive(req.params.id, "id"))) }); }));
requestScansRouter.post("/:id/manual-assign", asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ job: withSafeRequestScanFilename(await manuallyAssignRequestScan(positive(req.params.id, "id"), positive(body.appointmentId ?? body.appointment_id, "appointmentId"), Number(req.user!.sub))) }); }));
requestScansRouter.get("/:id", asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await getRequestScanJob(positive(req.params.id, "id"))) }); }));
