import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { asUnknownRecord } from "../utils/records.js";
import { pool } from "../db/pool.js";
import { downloadRequestScanJobFile, getRequestScanJob, listRequestScanJobs, manuallyAssignRequestScan, retryRequestScanJob, returnRequestScanToIncoming } from "../services/request-scan-service.js";
import { readRequestScanSettings } from "../services/request-scan-settings-service.js";
import { getRequestScanWorkerStatus, runRequestScanWorkerTick } from "../services/request-scan-worker.js";

const allowed = ["receptionist", "supervisor", "super_admin", "doctor"] as const;
export const requestScansRouter = express.Router();
requestScansRouter.use(requireAuth, requireAnyRole([...allowed]));
function positive(value: unknown, name: string): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, `${name} must be a positive integer.`); return parsed; }

requestScansRouter.get("/", asyncRoute(async (req: Request, res: Response) => { const status = typeof req.query.status === "string" ? req.query.status : undefined; res.json({ jobs: await listRequestScanJobs(status) }); }));
requestScansRouter.get("/status", asyncRoute(async (_req: Request, res: Response) => { const settings = await readRequestScanSettings(); const jobs = await listRequestScanJobs(); const today = new Date().toISOString().slice(0, 10); res.json({ enabled: settings.enabled, ...getRequestScanWorkerStatus(), pending: jobs.filter((job) => job.status === "pending").length, failed: jobs.filter((job) => job.status === "failed").length, processedToday: jobs.filter((job) => job.status === "processed" && job.completed_at?.slice(0, 10) === today).length }); }));
requestScansRouter.get("/eligible-appointments", asyncRoute(async (req: Request, res: Response) => { const q = String(req.query.q || "").trim(); const { rows } = await pool.query(`select b.id, ('V2-' || lpad(b.id::text,6,'0')) as accession_number, coalesce(p.english_full_name,p.arabic_full_name) as patient_name from appointments_v2.bookings b join patients p on p.id=b.patient_id where b.status not in ('cancelled','discontinued','voided') and ($1='' or ('V2-' || lpad(b.id::text,6,'0')) ilike $2 or p.english_full_name ilike $2 or p.arabic_full_name ilike $2) order by b.booking_date desc,b.id desc limit 20`, [q, `%${q}%`]); res.json({ appointments: rows }); }));
requestScansRouter.get("/:id/file", asyncRoute(async (req: Request, res: Response) => { const { job, buffer } = await downloadRequestScanJobFile(positive(req.params.id, "id")); res.setHeader("Content-Type", job.mime_type); res.setHeader("Content-Disposition", `inline; filename="${job.filename.replace(/"/g, "")}"`); res.send(buffer); }));
requestScansRouter.post("/run-now", asyncRoute(async (_req: Request, res: Response) => { res.json({ ok: true, result: await runRequestScanWorkerTick() }); }));
requestScansRouter.post("/:id/retry", asyncRoute(async (req: Request, res: Response) => { res.json({ job: await retryRequestScanJob(positive(req.params.id, "id")) }); }));
requestScansRouter.post("/:id/return-to-incoming", asyncRoute(async (req: Request, res: Response) => { res.json({ job: await returnRequestScanToIncoming(positive(req.params.id, "id")) }); }));
requestScansRouter.post("/:id/manual-assign", asyncRoute(async (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ job: await manuallyAssignRequestScan(positive(req.params.id, "id"), positive(body.appointmentId ?? body.appointment_id, "appointmentId"), Number(req.user!.sub)) }); }));
requestScansRouter.get("/:id", asyncRoute(async (req: Request, res: Response) => { res.json({ job: await getRequestScanJob(positive(req.params.id, "id")) }); }));
