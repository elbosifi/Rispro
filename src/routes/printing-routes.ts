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
import { pool } from "../db/pool.js";
import { renderChromiumPdf, ChromiumPdfRenderError } from "../services/chromium-pdf-service.js";
import { createRegistrationListRenderContext, deleteRegistrationListRenderContext, issueRegistrationListRenderToken } from "../services/registration-list-render-context-service.js";
import { buildAccessionLabelHtml, buildPrinterTestHtml } from "../services/generated-print-html-service.js";
import { buildReportCenterHtml, parseReportCenterRenderModel } from "../services/report-center-pdf-service.js";
import { buildStatisticsHtml, parseStatisticsRenderModel } from "../services/statistics-pdf-service.js";

const PRINTING_ROLES = ["receptionist", "supervisor", "modality_staff", "doctor", "super_admin"] as const;
const DOCUMENT_TYPES = new Set(["A4_DOCUMENT", "A4_LANDSCAPE_DOCUMENT", "A5_DOCUMENT", "ACCESSION_LABEL", "RECEIPT"]);
const OUTCOMES = new Set(["submitted", "failed", "status_unknown"]);
const FAILURE_CODES = new Set(["QZ_NOT_INSTALLED", "QZ_NOT_RUNNING", "QZ_CONNECTION_FAILED", "PRINTER_DISCOVERY_FAILED", "QZ_CSP_BLOCKED", "LOCAL_NETWORK_PERMISSION_DENIED", "PRINTER_NOT_CONFIGURED", "PRINTER_NOT_FOUND", "PRINTER_SETTINGS_INVALID", "DOCUMENT_GENERATION_FAILED", "PAGE_SIZE_MISMATCH", "INVALID_PDF", "DUPLICATE_PRINT", "PRINT_TIMEOUT", "PRINT_STATUS_UNKNOWN", "CERTIFICATE_REJECTED", "SIGNATURE_FAILED", "SIGNING_PAYLOAD_TOO_LARGE", "PRINT_FAILED"]);
const signingLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60, message: "Too many QZ signing requests. Try again shortly.", errorCode: "QZ_SIGN_RATE_LIMIT", key: (req) => String(req.user?.sub ?? req.ip) });
const qzSigningConcurrencyLimiter = createConcurrencyLimiter({ maxConcurrent: 4, message: "The QZ signing service is busy. Try again shortly.", errorCode: "QZ_SIGN_BUSY" });
const chromiumRenderConcurrencyLimiter = createConcurrencyLimiter({ maxConcurrent: 4, message: "The Chromium PDF renderer is busy. Try again shortly.", errorCode: "CHROMIUM_RENDER_BUSY" });
const finalizedPdfMargins = { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" } as const;
const compactFooterTemplate = `<div style="width:100%;padding:0 8mm;font:6px Arial,sans-serif;color:#6b7280;text-align:right;box-sizing:border-box">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

function escapeTemplateText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function compactHeaderTemplate(title: string, label: string): string {
  return `<div style="width:100%;padding:0 8mm;font:600 6px Arial,sans-serif;color:#374151;display:flex;justify-content:space-between;box-sizing:border-box"><span>National Cancer Center Benghazi · ${escapeTemplateText(title)}</span><span>${escapeTemplateText(label)}</span></div>`;
}
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

function requiredDimension(value: unknown, max: number, label: string): number {
  const parsed = dimension(value, max);
  if (parsed == null) throw new HttpError(400, `${label} is required.`);
  return parsed;
}

function assertValidRenderProfile(raw: Record<string, unknown>) {
  const documentType = String(raw.documentType || "");
  if (!DOCUMENT_TYPES.has(documentType)) throw new HttpError(400, "Printer-test document type is invalid.");
  const widthMm = requiredDimension(raw.paperWidthMm, 500, "Paper width");
  const heightMm = requiredDimension(raw.paperHeightMm, 1000, "Paper height");
  const orientation = raw.orientation;
  if (orientation !== "portrait" && orientation !== "landscape") throw new HttpError(400, "Printer-test orientation is invalid.");
  if (typeof raw.customPaperSize !== "boolean" || typeof raw.rasterize !== "boolean") throw new HttpError(400, "Printer-test media settings are invalid.");
  const standardA4 = (widthMm === 210 && heightMm === 297) || (widthMm === 297 && heightMm === 210);
  const standardA5 = widthMm === 148 && heightMm === 210;
  if (raw.customPaperSize === (standardA4 || standardA5)) throw new HttpError(400, "Printer-test custom-media setting is inconsistent.");
  if (documentType === "A4_DOCUMENT" && (widthMm !== 210 || heightMm !== 297)) throw new HttpError(400, "A4 portrait printer-test media is invalid.");
  if (documentType === "A4_LANDSCAPE_DOCUMENT" && (widthMm !== 297 || heightMm !== 210)) throw new HttpError(400, "A4 landscape printer-test media is invalid.");
  if (documentType === "A5_DOCUMENT" && !standardA5) throw new HttpError(400, "A5 printer-test media is invalid.");
  if (orientation !== (widthMm > heightMm ? "landscape" : "portrait")) throw new HttpError(400, "Printer-test orientation does not match its media.");
  if (standardA5 && orientation !== "portrait") throw new HttpError(400, "A5 printer-test orientation is invalid.");
  const printerName = optionalString(raw.printerName, 255);
  if (!printerName) throw new HttpError(400, "Printer name is required.");
  return { documentType, printerName, widthMm, heightMm, orientation, customPaperSize: raw.customPaperSize, rasterize: raw.rasterize } as const;
}

async function renderTrustedHtmlPdf(html: string, documentKind: string): Promise<Buffer> {
  let pdf: Buffer;
  try { pdf = await renderChromiumPdf({ source: { kind: "html", html }, documentKind }); }
  catch (error) {
    if (error instanceof ChromiumPdfRenderError) throw new HttpError(502, "PDF rendering failed.", { code: "DOCUMENT_RENDER_FAILED" });
    throw error;
  }
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new HttpError(502, "Chromium returned an invalid PDF.", { code: "DOCUMENT_RENDER_FAILED" });
  return pdf;
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
printingRouter.post("/registration-list/pdf", chromiumRenderConcurrencyLimiter, requirePageAccess("registrations"), asyncRoute(async (req: Request, res: Response) => {
  const raw = asUnknownRecord(req.body);
  const appointmentIds = Array.isArray(raw.appointmentIds) && raw.appointmentIds.every((value) => typeof value === "number") ? raw.appointmentIds : [];
  const label = typeof raw.label === "string" ? raw.label : "";
  const context = createRegistrationListRenderContext(appointmentIds, label);
  try {
    const token = issueRegistrationListRenderToken(context.id);
    const renderUrl = `http://127.0.0.1:${env.port}/print/internal/registration-list?token=${encodeURIComponent(token)}`;
    const startedAt = performance.now();
    const pdf = await renderChromiumPdf({
      source: { kind: "url", url: renderUrl, readySelector: '[data-registration-list-document="true"]' },
      documentKind: "registration-list",
      pdfOptions: {
        displayHeaderFooter: true,
        margin: finalizedPdfMargins,
        headerTemplate: compactHeaderTemplate("Registration / Appointment List", label),
        footerTemplate: compactFooterTemplate,
      },
    });
    console.info("Chromium PDF generated", { documentKind: "registration-list", rowCount: appointmentIds.length, pdfBytes: pdf.length, stage: "pdf", elapsedMs: Math.round(performance.now() - startedAt) });
    if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new HttpError(502, "Registration-list rendering returned an invalid PDF.", { code: "REGISTRATION_LIST_RENDER_FAILED" });
    res.setHeader("Cache-Control", "no-store, private");
    res.type("application/pdf").send(pdf);
  } catch (error) {
    if (error instanceof ChromiumPdfRenderError) throw new HttpError(502, "Registration-list PDF rendering failed.", { code: "REGISTRATION_LIST_RENDER_FAILED" });
    throw error;
  } finally {
    deleteRegistrationListRenderContext(context.id);
  }
}));
printingRouter.post("/report-center/pdf", chromiumRenderConcurrencyLimiter, requirePageAccess("print"), asyncRoute(async (req: Request, res: Response) => {
  const role = req.user!.role;
  if (role !== "receptionist" && role !== "supervisor" && role !== "super_admin" && role !== "modality_staff" && role !== "doctor") throw new HttpError(403, "This role cannot render reports.");
  const model = parseReportCenterRenderModel(req.body, role);
  const html = buildReportCenterHtml(model);
  const startedAt = performance.now();
  let pdf: Buffer;
  try {
    pdf = await renderChromiumPdf({
      source: { kind: "html", html },
      documentKind: "report-center",
      pdfOptions: {
        displayHeaderFooter: true,
        margin: finalizedPdfMargins,
        headerTemplate: compactHeaderTemplate("RISpro Report", `${model.title} · ${model.dateLabel}`),
        footerTemplate: compactFooterTemplate,
      },
    });
  } catch (error) {
    if (error instanceof ChromiumPdfRenderError) throw new HttpError(502, "Report PDF rendering failed.", { code: "REPORT_RENDER_FAILED" });
    throw error;
  }
  console.info("Chromium PDF generated", { documentKind: "report-center", rowCount: model.rows.length, pdfBytes: pdf.length, stage: "pdf", elapsedMs: Math.round(performance.now() - startedAt) });
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new HttpError(502, "Report rendering returned an invalid PDF.", { code: "REPORT_RENDER_FAILED" });
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Content-Disposition", `inline; filename="${model.templateId}.pdf"`);
  res.type("application/pdf").send(pdf);
}));
printingRouter.post("/statistics/pdf", chromiumRenderConcurrencyLimiter, requirePageAccess("statistics"), asyncRoute(async (req: Request, res: Response) => {
  const model = parseStatisticsRenderModel(req.body);
  const startedAt = performance.now();
  let pdf: Buffer;
  try {
    pdf = await renderChromiumPdf({ source: { kind: "html", html: buildStatisticsHtml(model) }, documentKind: "statistics", pdfOptions: { displayHeaderFooter: true, margin: finalizedPdfMargins, headerTemplate: compactHeaderTemplate("RISpro Statistics", `${model.dateFrom} to ${model.dateTo}`), footerTemplate: compactFooterTemplate } });
  } catch (error) {
    if (error instanceof ChromiumPdfRenderError) throw new HttpError(502, "Statistics PDF rendering failed.", { code: "STATISTICS_RENDER_FAILED" });
    throw error;
  }
  console.info("Chromium PDF generated", { documentKind: "statistics", rowCount: model.statusBreakdown.length + model.modalityBreakdown.length + model.dailyBreakdown.length, pdfBytes: pdf.length, stage: "pdf", elapsedMs: Math.round(performance.now() - startedAt) });
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new HttpError(502, "Statistics rendering returned an invalid PDF.", { code: "STATISTICS_RENDER_FAILED" });
  res.setHeader("Cache-Control", "no-store, private");
  res.type("application/pdf").send(pdf);
}));
printingRouter.get("/accession-label/:appointmentId/pdf", chromiumRenderConcurrencyLimiter, asyncRoute(async (req: Request, res: Response) => {
  const appointmentId = Number(req.params.appointmentId);
  if (!Number.isSafeInteger(appointmentId) || appointmentId <= 0) throw new HttpError(400, "Appointment identifier is invalid.");
  const widthMm = requiredDimension(Number(req.query.widthMm), 500, "Label width");
  const heightMm = requiredDimension(Number(req.query.heightMm), 1000, "Label height");
  const result = await pool.query(`
    select ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
           b.booking_date::text as appointment_date, p.arabic_full_name, p.english_full_name, p.mrn,
           m.code as modality_code, m.name_en as modality_name_en
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
     where b.id = $1 limit 1`, [appointmentId]);
  const appointment = result.rows[0];
  if (!appointment) throw new HttpError(404, "Appointment not found.");
  const html = await buildAccessionLabelHtml({
    patientName: appointment.arabic_full_name || appointment.english_full_name || "Patient",
    accessionNumber: appointment.accession_number,
    modality: appointment.modality_code || appointment.modality_name_en || "",
    appointmentDate: appointment.appointment_date,
    mrn: appointment.mrn || "",
  }, widthMm, heightMm);
  const pdf = await renderTrustedHtmlPdf(html, "accession-label");
  res.setHeader("Cache-Control", "no-store, private");
  res.type("application/pdf").send(pdf);
}));
printingRouter.post("/printer-test/pdf", chromiumRenderConcurrencyLimiter, asyncRoute(async (req: Request, res: Response) => {
  const profile = assertValidRenderProfile(asUnknownRecord(req.body));
  const html = buildPrinterTestHtml({ ...profile, generatedAt: new Date().toISOString() });
  const pdf = await renderTrustedHtmlPdf(html, "printer-test");
  res.setHeader("Cache-Control", "no-store, private");
  res.type("application/pdf").send(pdf);
}));
printingRouter.get("/appointment-slip/:appointmentId/pdf", chromiumRenderConcurrencyLimiter, requirePageAccess("print"), asyncRoute(async (req: Request, res: Response) => {
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
  chromiumRenderConcurrencyLimiter,
  qzSigningJsonParser,
  qzSignHandler,
  assertValidRenderProfile,
  compactHeaderTemplate,
  compactFooterTemplate,
  finalizedPdfMargins,
};
