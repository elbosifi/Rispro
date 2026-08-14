import * as qz from "qz-tray";
import type { PrinterProfile } from "@/types/printing";
import { expectedOrientation } from "@/lib/printing-orientation";

type ApprovedQzCall = "printers.find" | "print";
type RuntimeQzConfig = { getPrinter(): Record<string, unknown>; getOptions(): Record<string, unknown> };
type QzPrintData = Array<{ type: "pixel"; format: "pdf"; flavor: "base64"; data: string }>;

let connectionPromise: Promise<void> | null = null;
let runtimeConfigPromise: Promise<{ allowInsecureWebsocket: boolean }> | null = null;
let securityConfigured = false;
let certificateFailure: QzTrayError | null = null;

export type QzTrayErrorCode = "QZ_NOT_RUNNING" | "QZ_CSP_BLOCKED" | "LOCAL_NETWORK_PERMISSION_DENIED" | "CERTIFICATE_REJECTED" | "SIGNATURE_FAILED" | "SIGNING_PAYLOAD_TOO_LARGE" | "INVALID_PDF" | "PRINT_FAILED";
export class QzTrayError extends Error {
  constructor(public readonly code: QzTrayErrorCode, message: string, public readonly cause?: unknown) { super(message); this.name = "QzTrayError"; }
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error || ""); }

function connectionError(error: unknown): QzTrayError {
  const message = messageOf(error);
  if (error instanceof DOMException && error.name === "SecurityError") return new QzTrayError("LOCAL_NETWORK_PERMISSION_DENIED", "Browser permission to connect to QZ Tray was denied.", error);
  if (/content security policy|refused to connect|csp/i.test(message)) return new QzTrayError("QZ_CSP_BLOCKED", "The browser security policy blocked the QZ Tray connection.", error);
  return new QzTrayError("QZ_NOT_RUNNING", "Direct printing is unavailable because QZ Tray is not running or could not be reached.", error);
}

function configureSecurity(): void {
  if (securityConfigured) return;
  qz.security.setCertificatePromise((resolve, reject) => {
    fetch("/api/printing/qz-certificate", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (response.ok) { certificateFailure = null; resolve(await response.text()); return; }
        certificateFailure = new QzTrayError("CERTIFICATE_REJECTED", "RISpro could not load its QZ certificate.");
        reject(certificateFailure.message);
      })
      .catch((error) => { certificateFailure = new QzTrayError("CERTIFICATE_REJECTED", "RISpro could not load its QZ certificate.", error); reject(certificateFailure.message); });
  }, { rejectOnFailure: true });
  qz.security.setSignatureAlgorithm("SHA512");
  // All supported RISpro QZ operations are explicitly pre-signed. A callback
  // request therefore means a caller attempted an unapproved/non-deterministic operation.
  qz.security.setSignaturePromise(async () => { throw new QzTrayError("SIGNATURE_FAILED", "QZ requested a non-deterministic signature."); });
  securityConfigured = true;
}

async function getRuntimeConfig(): Promise<{ allowInsecureWebsocket: boolean }> {
  runtimeConfigPromise ??= fetch("/api/printing/runtime-config", { credentials: "include", cache: "default" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Unable to load QZ runtime configuration.");
      const body = await response.json() as { allowInsecureWebsocket?: unknown };
      return { allowInsecureWebsocket: body.allowInsecureWebsocket === true };
    })
    .catch((error) => { runtimeConfigPromise = null; throw error; });
  return runtimeConfigPromise;
}

export async function connectQzTray(): Promise<void> {
  configureSecurity();
  if (qz.websocket.isActive()) return;
  if (!connectionPromise) {
    connectionPromise = getRuntimeConfig()
      .then((runtime) => {
        const risproIsHttps = window.location.protocol === "https:";
        const usingSecure = risproIsHttps || !runtime.allowInsecureWebsocket;
        return qz.websocket.connect({ retries: 3, delay: 1, usingSecure });
      })
      .finally(() => { connectionPromise = null; });
  }
  try { await connectionPromise; } catch (error) { if (certificateFailure) throw certificateFailure; throw connectionError(error); }
}

export async function disconnectQzTray(): Promise<void> { if (qz.websocket.isActive()) await qz.websocket.disconnect(); }
export function isQzConnected(): boolean { return qz.websocket.isActive(); }

export function serializeQzRequest(call: ApprovedQzCall, params: unknown, timestamp: number): string {
  return JSON.stringify({ call, ...(params === undefined ? {} : { params }), timestamp });
}

export async function signQzRequest(call: ApprovedQzCall, params: unknown, timestamp: number): Promise<string> {
  const request = serializeQzRequest(call, params, timestamp);
  const response = await fetch("/api/printing/qz-sign", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) });
  if (response.status === 413) throw new QzTrayError("SIGNING_PAYLOAD_TOO_LARGE", "The PDF is too large for the configured QZ signing limit.");
  if (response.status === 503) {
    const failure = await response.json().catch(() => null) as { error?: { details?: { code?: unknown } } } | null;
    if (failure?.error?.details?.code === "QZ_SIGN_BUSY") {
      throw new QzTrayError("SIGNATURE_FAILED", "The RISpro signing service is busy. Try again shortly.");
    }
  }
  if (!response.ok) throw new QzTrayError("SIGNATURE_FAILED", "RISpro rejected the QZ signing request.");
  const result = await response.json() as { signature?: string };
  if (!result.signature) throw new QzTrayError("SIGNATURE_FAILED", "QZ signing response did not contain a signature.");
  return result.signature;
}

export async function getInstalledPrinters(): Promise<string[]> {
  await connectQzTray();
  const timestamp = Date.now();
  const params = {};
  const signature = await signQzRequest("printers.find", params, timestamp);
  const result = await qz.printers.find(undefined, signature, timestamp);
  return Array.isArray(result) ? result.map(String) : [String(result)];
}

export interface PrintPdfOptions {
  copies?: number;
  jobName: string;
  preservePdfPageGeometry?: boolean;
  diagnostics?: { documentKind: string; rowCount?: number; pdfBytes?: number };
}

function qzConfig(profile: PrinterProfile, copies: number, jobName: string, preservePdfPageGeometry = false) {
  const standardA4 = profile.customPaperSize === false
    && ((profile.paperWidthMm === 210 && profile.paperHeightMm === 297)
      || (profile.paperWidthMm === 297 && profile.paperHeightMm === 210));
  const standardA4Landscape = standardA4 && profile.paperWidthMm === 297 && profile.paperHeightMm === 210;
  const finalizedA4Landscape = standardA4Landscape && preservePdfPageGeometry;
  const accessionLabelCustomMedia = profile.documentType === "ACCESSION_LABEL" && profile.customPaperSize;
  const size = {
    width: standardA4 ? 210 : profile.paperWidthMm,
    height: standardA4 ? 297 : profile.paperHeightMm,
    custom: profile.customPaperSize,
  } as qz.Size & { custom: boolean };
  return qz.configs.create(profile.printerName, {
    units: "mm",
    ...(!finalizedA4Landscape && standardA4Landscape ? {} : { size }),
    orientation: finalizedA4Landscape ? "landscape" : preservePdfPageGeometry || accessionLabelCustomMedia ? null : expectedOrientation(profile.paperWidthMm, profile.paperHeightMm),
    copies,
    scaleContent: preservePdfPageGeometry ? false : profile.scaleContent,
    margins: preservePdfPageGeometry ? { top: 0, right: 0, bottom: 0, left: 0 } : profile.marginsMm ?? 0,
    printerTray: profile.printerTray || null,
    jobName,
    rasterize: profile.rasterize,
  });
}

interface PrintSubmissionDiagnostics {
  serialized(requestBytes: number): void;
  signed(): void;
  submitted(): void;
}

async function submitApprovedPrint(config: unknown, data: QzPrintData, diagnostics?: PrintSubmissionDiagnostics): Promise<void> {
  const runtime = config as RuntimeQzConfig;
  const params = { printer: runtime.getPrinter(), options: runtime.getOptions(), data };
  const timestamp = Date.now();
  diagnostics?.serialized(new TextEncoder().encode(serializeQzRequest("print", params, timestamp)).byteLength);
  const signature = await signQzRequest("print", params, timestamp);
  diagnostics?.signed();
  const deterministicPrint = qz.print as unknown as (config: unknown, data: QzPrintData, signature: string, timestamp: number) => Promise<void>;
  await deterministicPrint(config, data, signature, timestamp);
  diagnostics?.submitted();
}

export function stripPdfDataUrlPrefix(value: string): string { return value.replace(/^data:application\/pdf;base64,/i, "").trim(); }

export async function printPdf(profile: PrinterProfile, pdfBase64: string, options: PrintPdfOptions): Promise<void> {
  const data = stripPdfDataUrlPrefix(pdfBase64);
  if (!data || !/^[A-Za-z0-9+/=\r\n]+$/.test(data)) throw new QzTrayError("INVALID_PDF", "Invalid PDF Base64 data.");
  await connectQzTray();
  const printData: QzPrintData = [{ type: "pixel", format: "pdf", flavor: "base64", data }];
  const startedAt = performance.now();
  try {
    const config = qzConfig(profile, options.copies ?? profile.copies, options.jobName, options.preservePdfPageGeometry === true);
    await submitApprovedPrint(config, printData, options.diagnostics ? {
      serialized: (signingRequestBytes) => console.info("Direct print stage", { ...options.diagnostics, stage: "signing_request", signingRequestBytes, elapsedMs: Math.round(performance.now() - startedAt) }),
      signed: () => console.info("Direct print stage", { ...options.diagnostics, stage: "signing_complete", elapsedMs: Math.round(performance.now() - startedAt) }),
      submitted: () => console.info("Direct print stage", { ...options.diagnostics, stage: "qz_submitted", elapsedMs: Math.round(performance.now() - startedAt) }),
    } : undefined);
  }
  catch (error) { if (error instanceof QzTrayError) throw error; throw new QzTrayError("PRINT_FAILED", "QZ Tray rejected the print submission.", error); }
}

export const __qzTrayTestables = {
  resetRuntimeConfig() { runtimeConfigPromise = null; },
};
