import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { createConcurrencyLimiter } from "../middleware/concurrency-limit.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { getQzCertificate, qzSigningRequestLimitBytes, signQzRequest } from "../services/qz-signing-service.js";
import { logAuditEntry } from "../services/audit-service.js";
import { HttpError } from "../utils/http-error.js";
import { allowInsecureQzWebsocket } from "../config/env.js";
import { requirePageAccess } from "../middleware/page-access.js";
import { issueAppointmentSlipRenderToken } from "../services/appointment-slip-render-token-service.js";
import { AppointmentSlipRenderError, renderAppointmentSlipPdf } from "../services/appointment-slip-chromium-service.js";
import { env } from "../config/env.js";

const PRINTING_ROLES = ["receptionist", "supervisor", "modality_staff", "doctor", "super_admin"] as const;
const DOCUMENT_TYPES = new Set(["A4_DOCUMENT", "A5_DOCUMENT", "ACCESSION_LABEL", "RECEIPT"]);
const OUTCOMES = new Set(["submitted", "failed", "status_unknown"]);
const FAILURE_CODES = new Set(["QZ_NOT_INSTALLED", "QZ_NOT_RUNNING", "QZ_CONNECTION_FAILED", "PRINTER_DISCOVERY_FAILED", "QZ_CSP_BLOCKED", "LOCAL_NETWORK_PERMISSION_DENIED", "PRINTER_NOT_CONFIGURED", "PRINTER_NOT_FOUND", "PRINTER_SETTINGS_INVALID", "DOCUMENT_GENERATION_FAILED", "PAGE_SIZE_MISMATCH", "INVALID_PDF", "DUPLICATE_PRINT", "PRINT_TIMEOUT", "PRINT_STATUS_UNKNOWN", "CERTIFICATE_REJECTED", "SIGNATURE_FAILED", "SIGNING_PAYLOAD_TOO_LARGE", "PRINT_FAILED"]);
const signingLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60, message: "Too many QZ signing requests. Try again shortly.", errorCode: "QZ_SIGN_RATE_LIMIT", key: (req) => String(req.user?.sub ?? req.ip) });
const qzSigningConcurrencyLimiter = createConcurrencyLimiter({ maxConcurrent: 4, message: "The QZ signing service is busy. Try again shortly.", errorCode: "QZ_SIGN_BUSY" });
const qzSigningJsonParser = express.json({ limit: qzSigningRequestLimitBytes() + 64 * 1024 });

function optionalString(value: unknown, max: number, pattern?: RegExp): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "Print audit field has an invalid type.");
  const text = value.trim();
  if (!text || text.length > max || (pattern && !pattern.test(text))) throw new HttpError(400, "Print audit field has an invalid format.");
  return text;
}

function dimension(value: unknown, max: number): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 10 || value > max) throw new HttpError(400, "Print audit paper dimensions are invalid.");
  return value;
}

function parseAudit(body: unknown) {
  const raw = asUnknownRecord(body);
  const documentType = String(raw.documentType || "");
  const outcome = String(raw.outcome || "");
  if (!DOCUMENT_TYPES.has(documentType) || !OUTCOMES.has(outcome)) throw new HttpError(400, "Print audit document type or outcome is invalid.");
  const workstationId = optionalString(raw.workstationId, 36, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  if (!workstationId) throw new HttpError(400, "A valid workstation identifier is required.");
  const appointmentId = raw.appointmentId == null ? null : Number(raw.appointmentId);
  if (appointmentId != null && (!Number.isSafeInteger(appointmentId) || appointmentId <= 0)) throw new HttpError(400, "Appointment identifier is invalid.");
  const failureCode = optionalString(raw.failureCode, 80);
  if (failureCode && !FAILURE_CODES.has(failureCode)) throw new HttpError(400, "Print audit failure code is invalid.");
  if (outcome === "submitted" && failureCode) throw new HttpError(400, "Submitted print audits cannot include a failure code.");
  if (outcome !== "submitted" && !failureCode) throw new HttpError(400, "Failed or unknown print audits require a failure code.");
  if (raw.testPrint != null && typeof raw.testPrint !== "boolean") throw new HttpError(400, "Print audit test marker is invalid.");
  return { workstationId, documentType, outcome, documentId: optionalString(raw.documentId, 100, /^(?:[1-9]\d{0,19}|[0-9a-f]{8}-[0-9a-f-]{27})$/i), appointmentId, accessionNumber: optionalString(raw.accessionNumber, 100), printerName: optionalString(raw.printerName, 255), paperWidthMm: dimension(raw.paperWidthMm, 500), paperHeightMm: dimension(raw.paperHeightMm, 1000), failureCode, testPrint: raw.testPrint === true };
}

export const printingRouter = express.Router();
printingRouter.use(requireAuth, requireAnyRole([...PRINTING_ROLES]));
printingRouter.get("/qz-certificate", (_req: Request, res: Response) => { res.type("text/plain").send(getQzCertificate()); });
printingRouter.get("/runtime-config", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "private, max-age=60");
  res.json({ allowInsecureWebsocket: allowInsecureQzWebsocket() });
});
const qzSignHandler = (req: Request, res: Response): void => {
  const body = asUnknownRecord(req.body);
  res.json({ signature: signQzRequest(body.request, body.digest) });
};
const qzSignMiddlewares = [signingLimiter, qzSigningConcurrencyLimiter, qzSigningJsonParser, qzSignHandler] as const;
printingRouter.post("/qz-sign", ...qzSignMiddlewares);
printingRouter.get("/appointment-slip/:appointmentId/pdf", requirePageAccess("print"), asyncRoute(async (req: Request, res: Response) => {
  const appointmentId = Number(req.params.appointmentId);
  if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) throw new HttpError(400, "Appointment identifier is invalid.");
  const token = issueAppointmentSlipRenderToken(appointmentId);
  // Chromium only follows this loopback URL. It receives no user cookie or credentials.
  const renderUrl = `http://127.0.0.1:${env.port}/print/internal/appointment-slip?token=${encodeURIComponent(token)}`;
  let pdf: Buffer;
  try { pdf = await renderAppointmentSlipPdf(renderUrl); }
  catch (error) {
    if (error instanceof AppointmentSlipRenderError) throw new HttpError(502, "Appointment-slip PDF rendering failed.", { code: "APPOINTMENT_SLIP_RENDER_FAILED" });
    throw error;
  }
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new HttpError(502, "Appointment-slip rendering returned an invalid PDF.", { code: "APPOINTMENT_SLIP_RENDER_FAILED" });
  res.setHeader("Cache-Control", "no-store, private");
  res.type("application/pdf").send(pdf);
}));
printingRouter.post("/audit", asyncRoute(async (req: Request, res: Response) => {
  const audit = parseAudit(req.body);
  const actionType = audit.outcome === "submitted" ? "print_job_submitted" : audit.outcome === "status_unknown" ? "print_job_status_unknown" : "print_job_failed";
  await logAuditEntry({ entityType: "print_job", entityId: audit.appointmentId, actionType, changedByUserId: req.user!.sub, newValues: { ...audit, clientReported: true } });
  res.status(201).json({ ok: true });
}));

export const __printingRouteTestables = {
  parseAudit,
  qzSignMiddlewares,
  signingLimiter,
  qzSigningConcurrencyLimiter,
  qzSigningJsonParser,
  qzSignHandler,
};
