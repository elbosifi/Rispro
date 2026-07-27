import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { asUnknownRecord } from "../utils/records.js";
import { pool } from "../db/pool.js";
import { auditBulkRequestScanRetry, bulkDismissRequestScanJobs, bulkRetryRequestScanArchives, bulkRetryRequestScanJobs, dismissRequestScanJob, downloadRequestScanJobFile, getRequestScanJob, listRequestScanJobs, manuallyAssignRequestScan, prioritizePendingRequestScanJob, requestStopRequestScanJob, retryRequestScanArchive, retryRequestScanJob, restoreDismissedRequestScanJob, returnRequestScanToIncoming, withSafeRequestScanFilename } from "../services/request-scan-service.js";
import { testRequestScanSmb } from "../services/request-scan-smb-service.js";
import { readRequestScanSettings } from "../services/request-scan-settings-service.js";
import { isRequestScanWorkerHeartbeatFresh, readRequestScanWorkerRuntime, requestRequestScanWorkerRun as signalRequestScanWorkerRun } from "../services/request-scan-worker-control-service.js";
import type { RequestScanJob } from "../services/request-scan-service.js";
import { getTripoliToday } from "../utils/date.js";
import path from "node:path";
import { isRequestScanDevResetEnabled, previewRequestScanDevReset, resetRequestScanDevelopmentData } from "../services/request-scan-dev-reset-service.js";

const allowed = ["receptionist", "supervisor", "super_admin", "doctor", "modality_staff"] as const;
export const requestScansRouter = express.Router();
requestScansRouter.use(requireAuth, requireAnyRole([...allowed]));
function positive(value: unknown, name: string): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, `${name} must be a positive integer.`); return parsed; }
export function requestScanScope(req: Request): { workflowSource: "reception" | "modality"; modalityId: number | null } {
  const requested = String(req.query.workflowSource || (req.user!.role === "modality_staff" ? "modality" : "reception"));
  if (!["reception", "modality"].includes(requested)) throw new HttpError(400, "Invalid Request Scan workflow source.");
  if (req.user!.role === "modality_staff" && requested !== "modality") throw new HttpError(403, "Modality staff cannot access Reception ingestion jobs.");
  if (!["modality_staff", "supervisor", "super_admin"].includes(req.user!.role) && requested !== "reception") throw new HttpError(403, "This role cannot access modality ingestion jobs.");
  const modalityId = req.query.modalityId == null || req.query.modalityId === "" ? null : positive(req.query.modalityId, "modalityId");
  if (requested === "modality" && modalityId == null) throw new HttpError(400, "modalityId is required for modality ingestion.");
  if (requested === "reception" && modalityId != null) throw new HttpError(400, "modalityId is only valid for modality ingestion.");
  return { workflowSource: requested as "reception" | "modality", modalityId };
}
export function assertRequestScanJobScope(
  role: string,
  scope: { workflowSource: "reception" | "modality"; modalityId: number | null },
  job: RequestScanJob & { workflow_source?: "reception" | "modality"; modality_id?: number | null },
): void {
  if (role === "supervisor" || role === "super_admin") return;
  if ((job.workflow_source ?? "reception") !== scope.workflowSource) throw new HttpError(403, "This Request Scan job is outside the requested workflow scope.");
  if (scope.workflowSource === "modality" && Number(job.modality_id) !== scope.modalityId) throw new HttpError(403, "This ingestion job belongs to another modality.");
}
async function requireRequestScanJobAccess(req: Request, id: number): Promise<void> {
  const scope = requestScanScope(req);
  const job = await getRequestScanJob(id) as RequestScanJob & { workflow_source?: "reception" | "modality"; modality_id?: number | null };
  assertRequestScanJobScope(req.user!.role, scope, job);
}
async function requireRequestScanJobsAccess(req: Request, ids: number[]): Promise<void> {
  if (req.user!.role === "supervisor" || req.user!.role === "super_admin") return;
  await Promise.all(ids.map((id) => requireRequestScanJobAccess(req, id)));
}
requestScansRouter.param("id", (req, _res, next, value) => {
  requireRequestScanJobAccess(req, positive(value, "id")).then(() => next(), next);
});
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
type RequestScanStatusCounts = { pending: number; processing: number; processed_today: number; duplicates_today: number; failed: number; dismissed?: number; archive_pending?: number; archive_last_attempt?: string | null; archive_last_success?: string | null; archive_last_error?: string | null; archive_next_retry?: string | null };
type RequestScanStatusDependencies = { readSettings: typeof readRequestScanSettings; readRuntime?: typeof readRequestScanWorkerRuntime; query: (text: string, values?: unknown[]) => Promise<{ rows: RequestScanStatusCounts[] }> };
const requestScanStatusDependencies: RequestScanStatusDependencies = { readSettings: readRequestScanSettings, readRuntime: readRequestScanWorkerRuntime, query: (text, values) => pool.query<RequestScanStatusCounts>(text, values) };
export async function getRequestScanStatus(now = new Date(), dependencies: RequestScanStatusDependencies = requestScanStatusDependencies) {
  const [settings, countResult, runtime] = await Promise.all([
    dependencies.readSettings(),
    dependencies.query(`select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'processing')::int as processing, count(*) filter (where status = 'processed' and completed_at >= ($1::date::timestamp at time zone 'Africa/Tripoli') and completed_at < (($1::date + 1)::timestamp at time zone 'Africa/Tripoli'))::int as processed_today, count(*) filter (where status = 'duplicate' and completed_at >= ($1::date::timestamp at time zone 'Africa/Tripoli') and completed_at < (($1::date + 1)::timestamp at time zone 'Africa/Tripoli'))::int as duplicates_today, count(*) filter (where status = 'failed' and dismissed_at is null)::int as failed, count(*) filter (where status = 'failed' and dismissed_at is not null)::int as dismissed, count(*) filter (where status='failed' and attachment_completed_at is not null and document_id is not null and source_moved_at is null)::int as archive_pending, max(last_archive_attempt_at) as archive_last_attempt, max(source_moved_at) as archive_last_success, (array_agg(archive_last_error order by last_archive_attempt_at desc) filter (where archive_last_error is not null))[1] as archive_last_error, min(archive_next_retry_at) filter (where archive_next_retry_at is not null) as archive_next_retry from request_scan_jobs`, [getTripoliToday(now)]),
    dependencies.readRuntime ? dependencies.readRuntime() : Promise.resolve({ request_sequence: "0", acknowledged_sequence: "0", run_requested_at: null, worker_id: null, worker_started_at: null, worker_heartbeat_at: null, cycle_started_at: null, cycle_completed_at: null, last_success_at: null, last_error_at: null, last_error: null }),
  ]);
  const counts = countResult.rows[0] || { pending: 0, processing: 0, processed_today: 0, duplicates_today: 0, failed: 0, dismissed: 0, archive_pending: 0 };
  const workerOnline = isRequestScanWorkerHeartbeatFresh(runtime, now);
  const running = workerOnline && Boolean(runtime.cycle_started_at && (!runtime.cycle_completed_at || new Date(runtime.cycle_started_at) > new Date(runtime.cycle_completed_at)));
  const archivePending = Number(counts.archive_pending ?? 0);
  return { enabled: settings.enabled, running, lastRunAt: runtime.last_success_at, lastError: runtime.last_error, workerOnline, workerId: runtime.worker_id, workerStartedAt: runtime.worker_started_at, workerHeartbeatAt: runtime.worker_heartbeat_at, cycleStartedAt: runtime.cycle_started_at, cycleCompletedAt: runtime.cycle_completed_at, pending: Number(counts.pending), processing: Number(counts.processing), processedToday: Number(counts.processed_today), duplicatesToday: Number(counts.duplicates_today), failed: Number(counts.failed), dismissed: Number(counts.dismissed ?? 0), archiveDestination: { name: settings.server && settings.share ? `${settings.server}/${settings.share}` : null, state: archivePending ? "unavailable" : "unknown", affectedCount: archivePending, lastConnectionCheck: counts.archive_last_attempt ?? null, lastSuccessfulArchive: counts.archive_last_success ?? null, nextRetryAt: counts.archive_next_retry ?? null, lastError: counts.archive_last_error ?? null } };
}
async function getScopedRequestScanStatus(scope: { workflowSource: "reception" | "modality"; modalityId: number | null }, now = new Date()) {
  const base = await getRequestScanStatus(now);
  const { rows } = await pool.query<RequestScanStatusCounts>(`select count(*) filter (where status='pending')::int pending,count(*) filter (where status='processing')::int processing,count(*) filter (where status='processed' and completed_at >= ($1::date::timestamp at time zone 'Africa/Tripoli') and completed_at < (($1::date + 1)::timestamp at time zone 'Africa/Tripoli'))::int processed_today,count(*) filter (where status='duplicate' and completed_at >= ($1::date::timestamp at time zone 'Africa/Tripoli') and completed_at < (($1::date + 1)::timestamp at time zone 'Africa/Tripoli'))::int duplicates_today,count(*) filter (where status='failed' and dismissed_at is null)::int failed,count(*) filter (where status='failed' and dismissed_at is not null)::int dismissed,count(*) filter (where status='failed' and attachment_completed_at is not null and document_id is not null and source_moved_at is null)::int archive_pending,max(last_archive_attempt_at) archive_last_attempt,max(source_moved_at) archive_last_success,(array_agg(archive_last_error order by last_archive_attempt_at desc) filter (where archive_last_error is not null))[1] archive_last_error,min(archive_next_retry_at) filter (where archive_next_retry_at is not null) archive_next_retry from request_scan_jobs where workflow_source=$2 and ($3::bigint is null or modality_id=$3)`, [getTripoliToday(now), scope.workflowSource, scope.modalityId]);
  const counts = rows[0]!;
  return { ...base, lastError: scope.workflowSource === "modality" ? null : base.lastError, pending: Number(counts.pending), processing: Number(counts.processing), processedToday: Number(counts.processed_today), duplicatesToday: Number(counts.duplicates_today), failed: Number(counts.failed), dismissed: Number(counts.dismissed ?? 0), archiveDestination: { ...base.archiveDestination, affectedCount: Number(counts.archive_pending ?? 0), state: Number(counts.archive_pending ?? 0) ? "unavailable" : "unknown", lastConnectionCheck: counts.archive_last_attempt ?? null, lastSuccessfulArchive: counts.archive_last_success ?? null, nextRetryAt: counts.archive_next_retry ?? null, lastError: counts.archive_last_error ?? null } };
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

requestScansRouter.get("/", asyncRoute(async (req: Request, res: Response) => { const scope = requestScanScope(req); res.json({ jobs: (await listRequestScanJobs(req.query.status, req.query.category, scope.workflowSource, scope.modalityId)).map(withSafeRequestScanFilename) }); }));
requestScansRouter.get("/status", asyncRoute(async (req: Request, res: Response) => { const scope = requestScanScope(req); res.json({ ...(await getScopedRequestScanStatus(scope)), canRetryArchives: ["supervisor", "super_admin"].includes(req.user!.role), devResetEnabled: isRequestScanDevResetEnabled() && req.user!.role === "super_admin" }); }));
requestScansRouter.get("/dev-reset/preview", requireAnyRole(["super_admin"]), asyncRoute(async (_req: Request, res: Response) => { res.json(await previewRequestScanDevReset()); }));
requestScansRouter.get("/eligible-appointments", asyncRoute(async (req: Request, res: Response, next) => {
  const scope = requestScanScope(req);
  if (scope.workflowSource === "reception") { next(); return; }
  const q = String(req.query.q || "").trim();
  const { rows } = await pool.query(`select b.id,b.patient_id,b.modality_id,('V2-' || lpad(b.id::text,6,'0')) accession_number,coalesce(p.english_full_name,p.arabic_full_name) patient_name,p.arabic_full_name patient_name_ar,p.english_full_name patient_name_en,p.mrn patient_mrn,nullif(trim(p.national_id),'') national_id,p.estimated_date_of_birth patient_date_of_birth,p.sex,b.booking_date appointment_date,b.booking_time::text appointment_time,b.status appointment_status,m.name_en modality_name,m.name_ar modality_name_ar,m.name_en modality_name_en,e.name_en exam_name,e.name_ar exam_name_ar,e.name_en exam_name_en from appointments_v2.bookings b join patients p on p.id=b.patient_id left join modalities m on m.id=b.modality_id left join exam_types e on e.id=b.exam_type_id where b.modality_id=$1 and b.status not in ('cancelled','discontinued','voided') and ($2='' or ('V2-' || lpad(b.id::text,6,'0')) ilike $3 or p.english_full_name ilike $3 or p.arabic_full_name ilike $3 or p.mrn ilike $3 or p.national_id ilike $3) order by b.booking_date desc,b.booking_time desc nulls last,b.id desc limit 20`, [scope.modalityId, q, `%${q}%`]);
  res.json({ appointments: rows });
}));
requestScansRouter.get("/eligible-appointments", asyncRoute(async (req: Request, res: Response) => { const q = String(req.query.q || "").trim(); const { rows } = await pool.query(`select b.id,b.patient_id,b.modality_id,('V2-' || lpad(b.id::text,6,'0')) as accession_number,coalesce(p.english_full_name,p.arabic_full_name) as patient_name,p.arabic_full_name as patient_name_ar,p.english_full_name as patient_name_en,p.mrn as patient_mrn,nullif(trim(p.national_id),'') as national_id,p.estimated_date_of_birth as patient_date_of_birth,p.sex,b.booking_date as appointment_date,b.booking_time::text as appointment_time,b.status as appointment_status,m.name_en as modality_name,m.name_ar as modality_name_ar,m.name_en as modality_name_en,e.name_en as exam_name,e.name_ar as exam_name_ar,e.name_en as exam_name_en from appointments_v2.bookings b join patients p on p.id=b.patient_id left join modalities m on m.id=b.modality_id left join exam_types e on e.id=b.exam_type_id where b.status not in ('cancelled','discontinued','voided') and ($1='' or ('V2-' || lpad(b.id::text,6,'0')) ilike $2 or p.english_full_name ilike $2 or p.arabic_full_name ilike $2 or p.mrn ilike $2 or p.national_id ilike $2) order by b.booking_date desc,b.booking_time desc nulls last,b.id desc limit 20`, [q, `%${q}%`]); res.json({ appointments: rows }); }));
requestScansRouter.get("/:id/file", asyncRoute(async (req: Request, res: Response) => { const { job, buffer } = await downloadRequestScanJobFile(positive(req.params.id, "id")); sendRequestScanFileResponse(res, job, buffer); }));
requestScansRouter.post("/run-now", asyncRoute(async (req: Request, res: Response) => { requestScanScope(req); res.status(202).json({ ok: true, trigger: await requestRequestScanRunNow() }); }));
requestScansRouter.post("/dev-reset", requireAnyRole(["super_admin"]), asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json(await resetRequestScanDevelopmentData(Number(req.user!.sub), body.confirmation)); }));
requestScansRouter.post("/bulk-retry", asyncRoute(async (req: Request, res: Response) => { const ids = jobIds(asUnknownRecord(req.body).jobIds); await requireRequestScanJobsAccess(req, ids); const result = await bulkRetryRequestScanJobs(ids); const trigger = result.queued.length ? await requestRequestScanRunNow() : null; await auditBulkRequestScanRetry(result, Number(req.user!.sub), trigger?.status ?? "not_triggered"); res.status(202).json({ queued: result.queued.map(withSafeRequestScanFilename), failed: result.failed, trigger }); }));
requestScansRouter.post("/bulk-retry-archives", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const result = await bulkRetryRequestScanArchives(jobIds(asUnknownRecord(req.body).jobIds), Number(req.user!.sub)); const trigger = result.queued.length ? await requestRequestScanRunNow() : null; res.status(202).json({ ...result, queued: result.queued.map(withSafeRequestScanFilename), trigger }); }));
requestScansRouter.post("/archive-destination/test", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (_req: Request, res: Response) => { const settings = await readRequestScanSettings(); await testRequestScanSmb(settings); res.json({ state: "connected", archiveWorkflowVerified: true, checkedAt: new Date().toISOString() }); }));
requestScansRouter.post("/bulk-dismiss", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ jobs: (await bulkDismissRequestScanJobs(jobIds(body.jobIds), Number(req.user!.sub), body.reason)).map(withSafeRequestScanFilename) }); }));
requestScansRouter.post("/:id/start-now", asyncRoute(async (req: Request, res: Response) => { const job = await prioritizePendingRequestScanJob(positive(req.params.id, "id")); res.status(202).json({ job: withSafeRequestScanFilename(job), trigger: await requestRequestScanRunNow() }); }));
requestScansRouter.post("/:id/stop", asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await requestStopRequestScanJob(positive(req.params.id, "id"), Number(req.user!.sub))) }); }));
requestScansRouter.post("/:id/retry", asyncRoute(async (req: Request, res: Response) => { res.status(202).json(await queueRequestScanRetry(positive(req.params.id, "id"))); }));
requestScansRouter.post("/:id/retry-archive", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const job = await retryRequestScanArchive(positive(req.params.id, "id"), Number(req.user!.sub)); res.status(202).json({ job: withSafeRequestScanFilename(job), trigger: await requestRequestScanRunNow() }); }));
requestScansRouter.post("/:id/dismiss", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ job: withSafeRequestScanFilename(await dismissRequestScanJob(positive(req.params.id, "id"), Number(req.user!.sub), body.reason)) }); }));
requestScansRouter.post("/:id/restore-dismissed", requireAnyRole(["supervisor", "super_admin"]), asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await restoreDismissedRequestScanJob(positive(req.params.id, "id"), Number(req.user!.sub)) )}); }));
requestScansRouter.post("/:id/return-to-incoming", asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await returnRequestScanToIncoming(positive(req.params.id, "id"))) }); }));
requestScansRouter.post("/:id/manual-assign", asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); if (body.patientIdentityConfirmed !== true) throw new HttpError(400, "Confirm the scanned document belongs to the selected patient and appointment."); const job = await manuallyAssignRequestScan(positive(req.params.id, "id"), positive(body.appointmentId ?? body.appointment_id, "appointmentId"), Number(req.user!.sub)); res.status(202).json({ job: withSafeRequestScanFilename(job), trigger: await requestRequestScanRunNow() }); }));
requestScansRouter.get("/:id", asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await getRequestScanJob(positive(req.params.id, "id"))) }); }));
