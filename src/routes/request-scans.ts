import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { asUnknownRecord } from "../utils/records.js";
import { pool } from "../db/pool.js";
import { downloadRequestScanJobFile, getRequestScanJob, listRequestScanJobs, manuallyAssignRequestScan, retryRequestScanJob, returnRequestScanToIncoming, withSafeRequestScanFilename } from "../services/request-scan-service.js";
import { readRequestScanSettings } from "../services/request-scan-settings-service.js";
import { getRequestScanWorkerStatus, runRequestScanWorkerTick } from "../services/request-scan-worker.js";
import type { RequestScanJob } from "../services/request-scan-service.js";
import { getTripoliToday } from "../utils/date.js";

const allowed = ["receptionist", "supervisor", "super_admin", "doctor"] as const;
export const requestScansRouter = express.Router();
requestScansRouter.use(requireAuth, requireAnyRole([...allowed]));
function positive(value: unknown, name: string): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, `${name} must be a positive integer.`); return parsed; }
export function setRequestScanFileHeaders(res: Response, job: Pick<RequestScanJob, "mime_type" | "filename">): void { const safeJob = withSafeRequestScanFilename(job); res.setHeader("Content-Type", job.mime_type); res.setHeader("Content-Disposition", `inline; filename="${safeJob.filename.replace(/"/g, "")}"`); res.setHeader("Cache-Control", "private, no-store"); }
type RequestScanStatusCounts = { pending: number; processing: number; processed_today: number; duplicates_today: number; failed: number };
type RequestScanStatusDependencies = { readSettings: typeof readRequestScanSettings; workerStatus: typeof getRequestScanWorkerStatus; query: (text: string, values?: unknown[]) => Promise<{ rows: RequestScanStatusCounts[] }> };
const requestScanStatusDependencies: RequestScanStatusDependencies = { readSettings: readRequestScanSettings, workerStatus: getRequestScanWorkerStatus, query: (text, values) => pool.query<RequestScanStatusCounts>(text, values) };
export async function getRequestScanStatus(now = new Date(), dependencies: RequestScanStatusDependencies = requestScanStatusDependencies) {
  const [settings, countResult] = await Promise.all([
    dependencies.readSettings(),
    dependencies.query(`select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'processing')::int as processing, count(*) filter (where status = 'processed' and completed_at >= ($1::date::timestamp at time zone 'Africa/Tripoli') and completed_at < (($1::date + 1)::timestamp at time zone 'Africa/Tripoli'))::int as processed_today, count(*) filter (where status = 'duplicate' and completed_at >= ($1::date::timestamp at time zone 'Africa/Tripoli') and completed_at < (($1::date + 1)::timestamp at time zone 'Africa/Tripoli'))::int as duplicates_today, count(*) filter (where status = 'failed')::int as failed from request_scan_jobs`, [getTripoliToday(now)])
  ]);
  const counts = countResult.rows[0] || { pending: 0, processing: 0, processed_today: 0, duplicates_today: 0, failed: 0 };
  return { enabled: settings.enabled, ...dependencies.workerStatus(), pending: Number(counts.pending), processing: Number(counts.processing), processedToday: Number(counts.processed_today), duplicatesToday: Number(counts.duplicates_today), failed: Number(counts.failed) };
}

requestScansRouter.get("/", asyncRoute(async (req: Request, res: Response) => { const status = typeof req.query.status === "string" ? req.query.status : undefined; res.json({ jobs: (await listRequestScanJobs(status)).map(withSafeRequestScanFilename) }); }));
requestScansRouter.get("/status", asyncRoute(async (_req: Request, res: Response) => { res.json(await getRequestScanStatus()); }));
requestScansRouter.get("/eligible-appointments", asyncRoute(async (req: Request, res: Response) => { const q = String(req.query.q || "").trim(); const { rows } = await pool.query(`select b.id, ('V2-' || lpad(b.id::text,6,'0')) as accession_number, coalesce(p.english_full_name,p.arabic_full_name) as patient_name from appointments_v2.bookings b join patients p on p.id=b.patient_id where b.status not in ('cancelled','discontinued','voided') and ($1='' or ('V2-' || lpad(b.id::text,6,'0')) ilike $2 or p.english_full_name ilike $2 or p.arabic_full_name ilike $2) order by b.booking_date desc,b.id desc limit 20`, [q, `%${q}%`]); res.json({ appointments: rows }); }));
requestScansRouter.get("/:id/file", asyncRoute(async (req: Request, res: Response) => { const { job, buffer } = await downloadRequestScanJobFile(positive(req.params.id, "id")); setRequestScanFileHeaders(res, job); res.send(buffer); }));
requestScansRouter.post("/run-now", asyncRoute(async (_req: Request, res: Response) => { res.json({ ok: true, result: await runRequestScanWorkerTick() }); }));
requestScansRouter.post("/:id/retry", asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await retryRequestScanJob(positive(req.params.id, "id"))) }); }));
requestScansRouter.post("/:id/return-to-incoming", asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await returnRequestScanToIncoming(positive(req.params.id, "id"))) }); }));
requestScansRouter.post("/:id/manual-assign", asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ job: withSafeRequestScanFilename(await manuallyAssignRequestScan(positive(req.params.id, "id"), positive(body.appointmentId ?? body.appointment_id, "appointmentId"), Number(req.user!.sub))) }); }));
requestScansRouter.get("/:id", asyncRoute(async (req: Request, res: Response) => { res.json({ job: withSafeRequestScanFilename(await getRequestScanJob(positive(req.params.id, "id"))) }); }));
