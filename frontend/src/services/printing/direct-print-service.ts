import { api } from "@/lib/api-client";
import { getAppointmentById, fetchAppointmentSlipSettings } from "@/lib/api-hooks";
import { createAccessionLabelPdfBlob } from "@/lib/accession-label-printing";
import { createAppointmentSlipPdfBlob } from "@/lib/print-utils";
import type { DirectPrintErrorCode, DirectPrintRequest, DirectPrintResult, PrinterDocumentType, PrinterProfile } from "@/types/printing";
import { getInstalledPrinters, printPdf } from "./qz-tray-service";
import { loadQzPrinterSettings, resolvePrinterProfile } from "./workstation-printer-settings";

const activeJobs = new Set<string>();
const PRINT_TIMEOUT_MS = 30_000;

export function validateProfilePageSize(profile: PrinterProfile): boolean {
  const matches = (width: number, height: number) =>
    Math.abs(profile.paperWidthMm - width) <= 0.5 && Math.abs(profile.paperHeightMm - height) <= 0.5;
  if (profile.documentType === "A4_DOCUMENT") return matches(210, 297);
  if (profile.documentType === "A5_DOCUMENT") return matches(148, 210);
  if (profile.documentType === "ACCESSION_LABEL") return profile.paperWidthMm >= 20 && profile.paperHeightMm >= 15;
  return profile.paperWidthMm >= 40 && profile.paperHeightMm > 0;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("Invalid PDF document");
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function fetchDocumentPdf(documentId: string): Promise<Blob> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/view`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(`Document generation failed (${response.status})`);
  const blob = await response.blob();
  if (!/pdf/i.test(blob.type)) throw new Error("The selected patient document is not a PDF");
  return blob;
}

async function generatePdf(request: DirectPrintRequest, profile: PrinterProfile): Promise<Blob> {
  if (request.documentId) return fetchDocumentPdf(request.documentId);
  if (request.appointmentId == null) throw new Error("An appointment or PDF document is required for printing");
  const appointment = await getAppointmentById(Number(request.appointmentId));
  if (request.documentType === "ACCESSION_LABEL") {
    return createAccessionLabelPdfBlob(appointment, { widthMm: profile.paperWidthMm, heightMm: profile.paperHeightMm });
  }
  if (request.documentType === "A4_DOCUMENT" || request.documentType === "A5_DOCUMENT") {
    const slipSettings = await fetchAppointmentSlipSettings();
    const expectedType = slipSettings.paperSize === "a4" ? "A4_DOCUMENT" : "A5_DOCUMENT";
    if (request.documentType !== expectedType) throw new Error("Appointment PDF page size does not match the selected printer profile");
    return createAppointmentSlipPdfBlob(appointment, undefined, { slipSettings });
  }
  throw new Error("No receipt generator is available for this document");
}

function errorResult(errorCode: DirectPrintErrorCode, message: string): DirectPrintResult {
  return { success: false, errorCode, message };
}

export function mapDirectPrintError(error: unknown): DirectPrintResult {
  const message = error instanceof Error ? error.message : String(error || "Printing failed");
  const lower = message.toLowerCase();
  if (lower.includes("qz tray") && lower.includes("not installed")) return errorResult("QZ_NOT_INSTALLED", "Direct printing is unavailable because QZ Tray is not installed.");
  if (lower.includes("timeout")) return errorResult("PRINT_TIMEOUT", "The print request timed out before QZ Tray accepted it.");
  if (lower.includes("certificate")) return errorResult("CERTIFICATE_REJECTED", "QZ Tray rejected the RISpro certificate.");
  if (lower.includes("sign")) return errorResult("SIGNATURE_FAILED", "RISpro could not sign the QZ Tray request.");
  if (lower.includes("invalid pdf") || lower.includes("base64")) return errorResult("INVALID_PDF", "The generated PDF could not be sent to QZ Tray.");
  if (lower.includes("page size") || lower.includes("paper size")) return errorResult("PAGE_SIZE_MISMATCH", "The generated document page size does not match the selected printer profile.");
  if (lower.includes("document") || lower.includes("appointment") || lower.includes("receipt")) return errorResult("DOCUMENT_GENERATION_FAILED", message);
  if (lower.includes("websocket") || lower.includes("connect") || lower.includes("qz tray")) return errorResult("QZ_CONNECTION_FAILED", "Direct printing is unavailable because QZ Tray is not connected.");
  return errorResult("PRINT_FAILED", message);
}

function jobKey(request: DirectPrintRequest): string {
  return [request.documentType, request.documentId, request.appointmentId, request.accessionNumber].join(":");
}

function jobName(request: DirectPrintRequest): string {
  const identity = request.accessionNumber || request.documentId || request.appointmentId || "document";
  return `RISpro ${request.documentType} - ${identity}`;
}

async function audit(request: DirectPrintRequest, profile: PrinterProfile | null, result: DirectPrintResult): Promise<void> {
  const settings = loadQzPrinterSettings();
  try {
    await api("/printing/audit", {
      method: "POST",
      body: JSON.stringify({
        workstationId: settings.workstationId,
        documentType: request.documentType,
        documentId: request.documentId,
        appointmentId: request.appointmentId,
        accessionNumber: request.accessionNumber,
        printerName: profile?.printerName || null,
        paperWidthMm: profile?.paperWidthMm || null,
        paperHeightMm: profile?.paperHeightMm || null,
        success: result.success,
        failureCode: result.success ? null : result.errorCode,
      }),
    });
  } catch (error) {
    console.error("Unable to record direct-print audit", error);
  }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("Print timeout")), PRINT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function directPrint(request: DirectPrintRequest): Promise<DirectPrintResult> {
  const key = jobKey(request);
  if (activeJobs.has(key)) {
    const duplicate = errorResult("DUPLICATE_PRINT", "This print job is already being prepared.");
    await audit(request, resolvePrinterProfile(request.documentType), duplicate);
    return duplicate;
  }
  activeJobs.add(key);
  let profile: PrinterProfile | null = null;
  let result: DirectPrintResult;
  try {
    profile = resolvePrinterProfile(request.documentType);
    if (!profile?.printerName) {
      result = errorResult("PRINTER_NOT_CONFIGURED", `No ${request.documentType.toLowerCase().replaceAll("_", " ")} printer is configured for this workstation.`);
    } else if (!validateProfilePageSize(profile)) {
      result = errorResult("PAGE_SIZE_MISMATCH", `The ${request.documentType} printer profile has an incompatible paper size.`);
    } else {
      const printers = await withTimeout(getInstalledPrinters());
      if (!printers.includes(profile.printerName)) {
        result = errorResult("PRINTER_NOT_FOUND", `The configured printer “${profile.printerName}” is not installed on this workstation.`);
      } else {
        const blob = await withTimeout(generatePdf(request, profile));
        const base64 = await blobToBase64(blob);
        const name = jobName(request);
        await withTimeout(printPdf(profile, base64, { copies: request.copies ?? profile.copies, jobName: name }));
        result = { success: true, printerName: profile.printerName, jobName: name };
      }
    }
  } catch (error) {
    console.error("Direct print failed", { documentType: request.documentType, documentId: request.documentId, appointmentId: request.appointmentId, error });
    result = mapDirectPrintError(error);
  } finally {
    activeJobs.delete(key);
  }
  await audit(request, profile, result);
  return result;
}

export async function resolveAppointmentDocumentType(): Promise<Extract<PrinterDocumentType, "A4_DOCUMENT" | "A5_DOCUMENT">> {
  const settings = await fetchAppointmentSlipSettings();
  return settings.paperSize === "a4" ? "A4_DOCUMENT" : "A5_DOCUMENT";
}
