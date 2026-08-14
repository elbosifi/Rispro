import { api } from "@/lib/api-client";
import { fetchAppointmentSlipSettings } from "@/lib/api-hooks";
import { expectedOrientation } from "@/lib/printing-orientation";
import type { DirectPrintErrorCode, DirectPrintJobState, DirectPrintRequest, DirectPrintResult, PrinterDocumentType, PrinterProfile, ReportCenterRenderModel, StatisticsRenderModel } from "@/types/printing";
import { connectQzTray, getInstalledPrinters, printPdf, QzTrayError } from "./qz-tray-service";
import { loadQzPrinterSettings, normalizeQzPrinterSettings, resolvePrinterProfile } from "./workstation-printer-settings";
import { setGlobalPrintStatus } from "./global-print-status";

export const DIRECT_PRINT_TIMEOUTS = { connectionMs: 15_000, discoveryMs: 15_000, preparationMs: 60_000, submissionStatusMs: 30_000 };
const activeJobs = new Map<string, DirectPrintJobState>();

export class DirectPrintError extends Error {
  constructor(public readonly code: DirectPrintErrorCode, message: string, public readonly cause?: unknown) { super(message); this.name = "DirectPrintError"; }
}

export function validateProfilePageSize(profile: PrinterProfile): boolean {
  if (profile.orientation !== expectedOrientation(profile.paperWidthMm, profile.paperHeightMm)) return false;
  const matches = (width: number, height: number) => Math.abs(profile.paperWidthMm - width) <= 0.5 && Math.abs(profile.paperHeightMm - height) <= 0.5;
  if (profile.documentType === "A4_DOCUMENT") return matches(210, 297) && !profile.customPaperSize;
  if (profile.documentType === "A4_LANDSCAPE_DOCUMENT") return matches(297, 210) && !profile.customPaperSize;
  if (profile.documentType === "A5_DOCUMENT") return matches(148, 210) && !profile.customPaperSize;
  if (profile.documentType === "ACCESSION_LABEL") return profile.customPaperSize && profile.paperWidthMm >= 10 && profile.paperWidthMm <= 500 && profile.paperHeightMm >= 10 && profile.paperHeightMm <= 1000;
  return profile.customPaperSize && profile.paperWidthMm >= 10 && profile.paperWidthMm <= 500 && profile.paperHeightMm >= 10 && profile.paperHeightMm <= 1000;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new DirectPrintError("INVALID_PDF", "The generated PDF is invalid.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function fetchDocumentPdf(documentId: string): Promise<Blob> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/view`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", `Document generation failed (${response.status}).`);
  const blob = await response.blob();
  if (!/pdf/i.test(blob.type)) throw new DirectPrintError("INVALID_PDF", "The selected patient document is not a PDF.");
  return blob;
}

async function fetchAppointmentSlipPdf(appointmentId: string | number): Promise<Blob> {
  const response = await fetch(`/api/printing/appointment-slip/${encodeURIComponent(String(appointmentId))}/pdf`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "Appointment-slip rendering failed. You can use browser printing if it is enabled for this workstation.");
  const blob = await response.blob();
  if (!/application\/pdf/i.test(response.headers.get("content-type") || "") || !/pdf/i.test(blob.type)) throw new DirectPrintError("INVALID_PDF", "Appointment-slip rendering did not return a PDF.");
  return blob;
}

async function fetchAccessionLabelPdf(appointmentId: string | number, profile: PrinterProfile): Promise<Blob> {
  const params = new URLSearchParams({ widthMm: String(profile.paperWidthMm), heightMm: String(profile.paperHeightMm) });
  const response = await fetch(`/api/printing/accession-label/${encodeURIComponent(String(appointmentId))}/pdf?${params}`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "Accession-label PDF rendering failed.");
  const blob = await response.blob();
  if (!/application\/pdf/i.test(response.headers.get("content-type") || "") || !/pdf/i.test(blob.type)) throw new DirectPrintError("INVALID_PDF", "Accession-label rendering did not return a PDF.");
  return blob;
}

async function fetchIrSpecimenLabelPdf(appointmentId: string | number, specimenText: string, profile: PrinterProfile): Promise<Blob> {
  const response = await fetch(`/api/printing/ir-specimen-label/${encodeURIComponent(String(appointmentId))}/pdf`, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ specimenText, widthMm: profile.paperWidthMm, heightMm: profile.paperHeightMm }) });
  if (!response.ok) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "IR specimen-label PDF rendering failed.");
  const blob = await response.blob();
  if (!/application\/pdf/i.test(response.headers.get("content-type") || "") || !/pdf/i.test(blob.type)) throw new DirectPrintError("INVALID_PDF", "IR specimen-label rendering did not return a PDF.");
  return blob;
}

async function fetchPrinterTestPdf(profile: PrinterProfile): Promise<Blob> {
  const response = await fetch("/api/printing/printer-test/pdf", { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
  if (!response.ok) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "Printer-test PDF rendering failed.");
  const blob = await response.blob();
  if (!/application\/pdf/i.test(response.headers.get("content-type") || "") || !/pdf/i.test(blob.type)) throw new DirectPrintError("INVALID_PDF", "Printer-test rendering did not return a PDF.");
  return blob;
}

export async function fetchReportCenterPdf(model: ReportCenterRenderModel): Promise<Blob> {
  const response = await fetch("/api/printing/report-center/pdf", { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model) });
  if (!response.ok) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "Report PDF generation failed.");
  const blob = await response.blob();
  if (!/application\/pdf/i.test(response.headers.get("content-type") || "") || !/pdf/i.test(blob.type)) throw new DirectPrintError("INVALID_PDF", "Report rendering did not return a PDF.");
  return blob;
}

async function fetchStatisticsPdf(model: StatisticsRenderModel): Promise<Blob> {
  const response = await fetch("/api/printing/statistics/pdf", { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model) });
  if (!response.ok) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "Statistics PDF generation failed.");
  const blob = await response.blob();
  if (!/application\/pdf/i.test(response.headers.get("content-type") || "") || !/pdf/i.test(blob.type)) throw new DirectPrintError("INVALID_PDF", "Statistics rendering did not return a PDF.");
  return blob;
}

async function generatePdf(request: DirectPrintRequest, profile: PrinterProfile): Promise<Blob> {
  if (request.documentId) return fetchDocumentPdf(request.documentId);
  if (request.appointmentId == null) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "An appointment or PDF document is required for printing.");
  if (request.documentType === "ACCESSION_LABEL") return fetchAccessionLabelPdf(request.appointmentId, profile);
  if (request.documentType === "A4_DOCUMENT" || request.documentType === "A5_DOCUMENT") {
    const slipSettings = await fetchAppointmentSlipSettings();
    const expectedType = slipSettings.paperSize === "a4" ? "A4_DOCUMENT" : "A5_DOCUMENT";
    if (request.documentType !== expectedType) throw new DirectPrintError("PAGE_SIZE_MISMATCH", "Appointment PDF page size does not match the selected printer profile.");
    return fetchAppointmentSlipPdf(request.appointmentId);
  }
  throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "No receipt generator is available for this document.");
}

function errorResult(code: DirectPrintErrorCode, message: string): DirectPrintResult { return { success: false, errorCode: code, message }; }

export function mapDirectPrintError(error: unknown): DirectPrintResult {
  if (error instanceof DirectPrintError || error instanceof QzTrayError) return errorResult(error.code, error.message);
  return errorResult("PRINT_FAILED", "The print job could not be submitted to QZ Tray.");
}

function jobKey(request: DirectPrintRequest): string { return [request.documentType, request.documentId, request.appointmentId, request.accessionNumber].join(":"); }
function jobName(request: DirectPrintRequest): string {
  const identity = request.accessionNumber || request.appointmentSnapshot?.accessionNumber || request.documentId || request.appointmentId || "document";
  return `RISpro ${request.documentType} - ${identity}`;
}

async function audit(request: DirectPrintRequest, profile: PrinterProfile | null, result: DirectPrintResult, outcome?: "submitted" | "failed" | "status_unknown", testPrint = false, auditMetadata?: { printPurpose: "ir_specimen"; specimenText: string }): Promise<void> {
  const settings = loadQzPrinterSettings();
  const resolvedOutcome = outcome ?? (result.success ? "submitted" : result.errorCode === "PRINT_STATUS_UNKNOWN" ? "status_unknown" : "failed");
  try {
    await api("/printing/audit", { method: "POST", body: JSON.stringify({ workstationId: settings.workstationId, documentType: request.documentType, documentId: request.documentId, appointmentId: request.appointmentId, accessionNumber: request.accessionNumber || request.appointmentSnapshot?.accessionNumber, printerName: profile?.printerName || null, paperWidthMm: profile?.paperWidthMm || null, paperHeightMm: profile?.paperHeightMm || null, outcome: resolvedOutcome, failureCode: resolvedOutcome === "submitted" ? null : result.success ? "PRINT_STATUS_UNKNOWN" : result.errorCode, testPrint, ...auditMetadata }) });
  } catch (error) { console.error("Unable to record direct-print audit", { error }); }
}

async function withStageTimeout<T>(promise: Promise<T>, milliseconds: number, error: DirectPrintError): Promise<T> {
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(error), milliseconds); });
  try { return await Promise.race([promise, timeout]); } finally { window.clearTimeout(timeoutId); }
}

export function getDirectPrintJobState(request: DirectPrintRequest): DirectPrintJobState | undefined { return activeJobs.get(jobKey(request)); }

interface DirectPrintExecutionOptions {
  profile?: PrinterProfile | null;
  generate?: (profile: PrinterProfile) => Promise<Blob>;
  key?: string;
  name?: string;
  testPrint?: boolean;
  preservePdfPageGeometry?: boolean;
  diagnostics?: { documentKind: string; rowCount?: number };
  auditMetadata?: { printPurpose: "ir_specimen"; specimenText: string };
}

async function executeDirectPrint(request: DirectPrintRequest, options: DirectPrintExecutionOptions = {}): Promise<DirectPrintResult> {
  const key = options.key ?? jobKey(request);
  if (activeJobs.has(key)) return errorResult("DUPLICATE_PRINT", "This print job is already being processed.");
  activeJobs.set(key, "preparing");
  setGlobalPrintStatus({ state: "preparing" }, key);
  let profile: PrinterProfile | null = null;
  let retainLock = false;
  try {
    profile = options.profile === undefined ? resolvePrinterProfile(request.documentType) : options.profile;
    if (!profile?.printerName) throw new DirectPrintError("PRINTER_NOT_CONFIGURED", `No ${request.documentType.toLowerCase().replaceAll("_", " ")} printer is configured for this workstation.`);
    if (!profile.enabled) throw new DirectPrintError("PRINTER_SETTINGS_INVALID", `The ${request.documentType} printer profile is disabled.`);
    if (!validateProfilePageSize(profile)) throw new DirectPrintError("PRINTER_SETTINGS_INVALID", `The ${request.documentType} printer profile has invalid paper or custom-media settings.`);
    await withStageTimeout(connectQzTray(), DIRECT_PRINT_TIMEOUTS.connectionMs, new DirectPrintError("QZ_CONNECTION_FAILED", "QZ Tray did not connect within 15 seconds."));
    const printers = await withStageTimeout(getInstalledPrinters(), DIRECT_PRINT_TIMEOUTS.discoveryMs, new DirectPrintError("PRINTER_DISCOVERY_FAILED", "RISpro could not retrieve the installed printers from QZ Tray."));
    if (!printers.includes(profile.printerName)) throw new DirectPrintError("PRINTER_NOT_FOUND", `The configured printer “${profile.printerName}” is not installed on this workstation.`);
    const preparationStartedAt = performance.now();
    const blob = await withStageTimeout(options.generate ? options.generate(profile) : generatePdf(request, profile), DIRECT_PRINT_TIMEOUTS.preparationMs, new DirectPrintError("DOCUMENT_GENERATION_FAILED", "Document preparation exceeded 60 seconds."));
    if (options.diagnostics) console.info("Direct print stage", { ...options.diagnostics, stage: "pdf_prepared", pdfBytes: blob.size, elapsedMs: Math.round(performance.now() - preparationStartedAt) });
    const base64 = await blobToBase64(blob);
    const name = options.name ?? jobName(request);
    activeJobs.set(key, "submitting");
    setGlobalPrintStatus({ state: "submitting", printerName: profile.printerName }, key);
    const submission = printPdf(profile, base64, { copies: request.copies ?? profile.copies, jobName: name, preservePdfPageGeometry: options.preservePdfPageGeometry, diagnostics: options.diagnostics ? { ...options.diagnostics, pdfBytes: blob.size } : undefined });
    pendingSubmissions.set(key, submission);
    const settled = submission.then(() => ({ ok: true as const })).catch((error: unknown) => ({ ok: false as const, error }));
    const status = await withStageTimeout(settled, DIRECT_PRINT_TIMEOUTS.submissionStatusMs, new DirectPrintError("PRINT_STATUS_UNKNOWN", "The original print request is still being processed. Do not retry or use browser printing yet."));
    if (!status.ok) throw status.error;
    pendingSubmissions.delete(key);
    activeJobs.set(key, "submitted");
    setGlobalPrintStatus({ state: "submitted", printerName: profile.printerName }, key);
    const result: DirectPrintResult = { success: true, printerName: profile.printerName, jobName: name };
    await audit(request, profile, result, undefined, options.testPrint, options.auditMetadata);
    return result;
  } catch (error) {
    const result = mapDirectPrintError(error);
    if (!result.success && result.errorCode === "PRINT_STATUS_UNKNOWN" && profile) {
      retainLock = true;
      activeJobs.set(key, "status_unknown");
      setGlobalPrintStatus({ state: "status_unknown", printerName: profile.printerName }, key);
      await audit(request, profile, result, "status_unknown", options.testPrint, options.auditMetadata);
      // The underlying QZ promise owns the lock after the UI stops waiting.
      void printStatusSettlement(key, request, profile, options.testPrint === true, nameForSettlement(options, request), options.auditMetadata);
      return result;
    }
    activeJobs.set(key, "failed");
    setGlobalPrintStatus({ state: "failed", printerName: profile?.printerName }, key);
    console.error("Direct print failed", { code: result.success ? null : result.errorCode, documentType: request.documentType, documentId: request.documentId, appointmentId: request.appointmentId, technicalError: error instanceof Error ? { name: error.name, message: error.message.slice(0, 500) } : { name: "UnknownError" } });
    await audit(request, profile, result, undefined, options.testPrint, options.auditMetadata);
    return result;
  } finally {
    if (!retainLock) { pendingSubmissions.delete(key); activeJobs.delete(key); }
  }
}

function nameForSettlement(options: DirectPrintExecutionOptions, request: DirectPrintRequest): string { return options.name ?? jobName(request); }

export async function directPrint(request: DirectPrintRequest): Promise<DirectPrintResult> { return executeDirectPrint(request); }

export async function directPrintIrSpecimenLabel(appointmentId: number, accessionNumber: string, specimenText: string): Promise<DirectPrintResult> {
  const normalizedSpecimenText = specimenText.replace(/\s+/g, " ").trim();
  const request: DirectPrintRequest = { documentType: "ACCESSION_LABEL", appointmentId, accessionNumber };
  return executeDirectPrint(request, { key: `ir-specimen-label:${appointmentId}`, name: `RISpro IR specimen label - ${accessionNumber}`, generate: (profile) => fetchIrSpecimenLabelPdf(appointmentId, normalizedSpecimenText, profile), auditMetadata: { printPurpose: "ir_specimen", specimenText: normalizedSpecimenText } });
}

export async function directPrintRegistrationList(appointmentIds: number[], label: string): Promise<DirectPrintResult> {
  const request: DirectPrintRequest = { documentType: "A4_LANDSCAPE_DOCUMENT" };
  return executeDirectPrint(request, {
    key: `registration-list:${appointmentIds.join(",")}`,
    name: "RISpro registration list",
    preservePdfPageGeometry: true,
    diagnostics: { documentKind: "registration-list", rowCount: appointmentIds.length },
    generate: async () => {
      const response = await fetch("/api/printing/registration-list/pdf", { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointmentIds, label }) });
      if (!response.ok) throw new DirectPrintError("DOCUMENT_GENERATION_FAILED", "Registration-list PDF rendering failed.");
      const blob = await response.blob();
      if (!/application\/pdf/i.test(response.headers.get("content-type") || "") || !/pdf/i.test(blob.type)) throw new DirectPrintError("INVALID_PDF", "Registration-list rendering did not return a PDF.");
      return blob;
    },
  });
}

export async function directPrintReportCenter(model: ReportCenterRenderModel): Promise<DirectPrintResult> {
  const documentType: Extract<PrinterDocumentType, "A4_DOCUMENT" | "A4_LANDSCAPE_DOCUMENT"> = model.orientation === "portrait" ? "A4_DOCUMENT" : "A4_LANDSCAPE_DOCUMENT";
  return executeDirectPrint({ documentType }, {
    key: `report-center:${model.templateId}:${model.orientation}:${model.dateLabel}`,
    name: `RISpro report - ${model.title}`,
    generate: () => fetchReportCenterPdf(model),
    preservePdfPageGeometry: true,
    diagnostics: { documentKind: "report-center", rowCount: model.rows.length },
  });
}

export async function directPrintStatistics(model: StatisticsRenderModel): Promise<DirectPrintResult> {
  return executeDirectPrint({ documentType: "A4_LANDSCAPE_DOCUMENT" }, {
    key: `statistics:${model.dateFrom}:${model.dateTo}:${model.modalityLabel}`,
    name: `RISpro statistics - ${model.dateFrom} to ${model.dateTo}`,
    generate: () => fetchStatisticsPdf(model),
    preservePdfPageGeometry: true,
    diagnostics: { documentKind: "statistics", rowCount: model.statusBreakdown.length + model.modalityBreakdown.length + model.dailyBreakdown.length },
  });
}

export async function directTestPrint(profile: PrinterProfile): Promise<DirectPrintResult> {
  const normalized = normalizeQzPrinterSettings({ profiles: [profile] }).profiles.find((candidate) => candidate.documentType === profile.documentType) ?? null;
  const request: DirectPrintRequest = { documentType: profile.documentType };
  return executeDirectPrint(request, {
    profile: normalized,
    generate: fetchPrinterTestPdf,
    key: `printer-test:${profile.documentType}:${profile.printerName}`,
    name: `RISpro printer test - ${profile.documentType}`,
    testPrint: true,
    preservePdfPageGeometry: profile.documentType === "A4_LANDSCAPE_DOCUMENT",
  });
}

const pendingSubmissions = new Map<string, Promise<void>>();
async function printStatusSettlement(key: string, request: DirectPrintRequest, profile: PrinterProfile, testPrint: boolean, submittedJobName: string, auditMetadata?: { printPurpose: "ir_specimen"; specimenText: string }): Promise<void> {
  const pending = pendingSubmissions.get(key);
  if (!pending) { activeJobs.delete(key); return; }
  try { await pending; setGlobalPrintStatus({ state: "submitted", printerName: profile.printerName }, key); await audit(request, profile, { success: true, printerName: profile.printerName, jobName: submittedJobName }, "submitted", testPrint, auditMetadata); }
  catch (error) { setGlobalPrintStatus({ state: "failed", printerName: profile.printerName }, key); await audit(request, profile, mapDirectPrintError(error), "failed", testPrint, auditMetadata); }
  finally { pendingSubmissions.delete(key); activeJobs.delete(key); }
}

export async function resolveAppointmentDocumentType(): Promise<Extract<PrinterDocumentType, "A4_DOCUMENT" | "A5_DOCUMENT">> {
  const settings = await fetchAppointmentSlipSettings();
  return settings.paperSize === "a4" ? "A4_DOCUMENT" : "A5_DOCUMENT";
}
