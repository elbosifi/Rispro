import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { getQzCertificate, qzSigningRequestLimitBytes, signQzRequest } from "../services/qz-signing-service.js";
import { logAuditEntry } from "../services/audit-service.js";
import { HttpError } from "../utils/http-error.js";

const PRINTING_ROLES = ["receptionist", "supervisor", "modality_staff", "doctor", "super_admin"] as const;
const DOCUMENT_TYPES = new Set(["A4_DOCUMENT", "A5_DOCUMENT", "ACCESSION_LABEL", "RECEIPT"]);
const OUTCOMES = new Set(["submitted", "failed", "status_unknown"]);
const FAILURE_CODES = new Set(["QZ_NOT_INSTALLED", "QZ_NOT_RUNNING", "QZ_CONNECTION_FAILED", "QZ_CSP_BLOCKED", "LOCAL_NETWORK_PERMISSION_DENIED", "PRINTER_NOT_CONFIGURED", "PRINTER_NOT_FOUND", "PRINTER_SETTINGS_INVALID", "DOCUMENT_GENERATION_FAILED", "PAGE_SIZE_MISMATCH", "INVALID_PDF", "DUPLICATE_PRINT", "PRINT_TIMEOUT", "PRINT_STATUS_UNKNOWN", "CERTIFICATE_REJECTED", "SIGNATURE_FAILED", "SIGNING_PAYLOAD_TOO_LARGE", "PRINT_FAILED"]);
const signingLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60, message: "Too many QZ signing requests. Try again shortly.", errorCode: "QZ_SIGN_RATE_LIMIT", key: (req) => String(req.user?.sub ?? req.ip) });

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
  return { workstationId, documentType, outcome, documentId: optionalString(raw.documentId, 100, /^(?:[1-9]\d{0,19}|[0-9a-f]{8}-[0-9a-f-]{27})$/i), appointmentId, accessionNumber: optionalString(raw.accessionNumber, 100), printerName: optionalString(raw.printerName, 255), paperWidthMm: dimension(raw.paperWidthMm, 500), paperHeightMm: dimension(raw.paperHeightMm, 1000), failureCode };
}

export const printingRouter = express.Router();
printingRouter.use(requireAuth, requireAnyRole([...PRINTING_ROLES]));
printingRouter.get("/qz-certificate", (_req: Request, res: Response) => { res.type("text/plain").send(getQzCertificate()); });
printingRouter.post("/qz-sign", express.json({ limit: qzSigningRequestLimitBytes() + 64 * 1024 }), signingLimiter, (req: Request, res: Response) => { const body = asUnknownRecord(req.body); res.json({ signature: signQzRequest(body.request, body.digest) }); });
printingRouter.post("/audit", asyncRoute(async (req: Request, res: Response) => {
  const audit = parseAudit(req.body);
  const actionType = audit.outcome === "submitted" ? "print_job_submitted" : audit.outcome === "status_unknown" ? "print_job_status_unknown" : "print_job_failed";
  await logAuditEntry({ entityType: "print_job", entityId: audit.appointmentId, actionType, changedByUserId: req.user!.sub, newValues: { ...audit, clientReported: true } });
  res.status(201).json({ ok: true });
}));

export const __printingRouteTestables = { parseAudit };
