import * as qz from "qz-tray";
import type { PrinterProfile, QzPrinterDetail } from "@/types/printing";

let connectionPromise: Promise<void> | null = null;
let securityConfigured = false;
const approvedSigningRequests = new Map<string, string>();
const signingFailures = new Map<string, QzTrayError>();
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
  qz.security.setSignaturePromise(async (digest) => {
    const key = String(digest).toLowerCase();
    try {
      const request = approvedSigningRequests.get(key);
      if (!request) throw new QzTrayError("SIGNATURE_FAILED", "QZ requested a signature for an unapproved operation.");
      const response = await fetch("/api/printing/qz-sign", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request, digest }) });
      if (response.status === 413) throw new QzTrayError("SIGNING_PAYLOAD_TOO_LARGE", "The PDF is too large for the configured QZ signing limit.");
      if (!response.ok) throw new QzTrayError("SIGNATURE_FAILED", "RISpro rejected the QZ signing request.");
      const result = await response.json() as { signature?: string };
      if (!result.signature) throw new QzTrayError("SIGNATURE_FAILED", "QZ signing response did not contain a signature.");
      return result.signature;
    } catch (error) {
      const typed = error instanceof QzTrayError ? error : new QzTrayError("SIGNATURE_FAILED", "RISpro could not sign the QZ request.", error);
      signingFailures.set(key, typed);
      throw typed;
    }
  });
  securityConfigured = true;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function approvedQzCall<T>(call: "printers.find" | "printers.detail" | "print", params: unknown, invoke: () => Promise<T>): Promise<T> {
  const timestamp = Date.now();
  const request = JSON.stringify({ call, ...(params === undefined ? {} : { params }), timestamp });
  const digest = await sha256Hex(request);
  approvedSigningRequests.set(digest, request);
  const originalNow = Date.now;
  let operation: Promise<T>;
  try {
    Date.now = () => timestamp;
    operation = invoke();
  } finally { Date.now = originalNow; }
  try { return await operation; }
  catch (error) {
    const signingFailure = signingFailures.get(digest);
    if (signingFailure) throw signingFailure;
    if (error instanceof QzTrayError) throw error;
    if (!qz.websocket.isActive()) throw new QzTrayError("QZ_NOT_RUNNING", "QZ Tray disconnected before the request completed.", error);
    throw error;
  } finally { approvedSigningRequests.delete(digest); signingFailures.delete(digest); }
}

export async function connectQzTray(): Promise<void> {
  configureSecurity();
  if (qz.websocket.isActive()) return;
  if (!connectionPromise) {
    connectionPromise = qz.websocket.connect({ retries: 3, delay: 1 })
      .finally(() => { connectionPromise = null; });
  }
  try { await connectionPromise; } catch (error) { if (certificateFailure) throw certificateFailure; throw connectionError(error); }
}

export async function disconnectQzTray(): Promise<void> {
  if (qz.websocket.isActive()) await qz.websocket.disconnect();
}

export function isQzConnected(): boolean {
  return qz.websocket.isActive();
}

export async function getInstalledPrinters(): Promise<string[]> {
  await connectQzTray();
  const result = await approvedQzCall("printers.find", {}, () => qz.printers.find());
  return Array.isArray(result) ? result.map(String) : [String(result)];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export async function getPrinterDetails(): Promise<QzPrinterDetail[]> {
  await connectQzTray();
  const result = await approvedQzCall("printers.detail", undefined, () => qz.printers.details());
  const rows = Array.isArray(result) ? result : [result];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const name = String(raw.name || raw.printer || "").trim();
    if (!name) return [];
    return [{ name, trays: stringArray(raw.trays ?? raw.paperTrays ?? raw.printerTrays), raw }];
  });
}

function qzConfig(profile: PrinterProfile, copies: number, jobName: string) {
  const size = { width: profile.paperWidthMm, height: profile.paperHeightMm, custom: profile.customPaperSize } as qz.Size & { custom: boolean };
  return qz.configs.create(profile.printerName, {
    units: "mm",
    size,
    orientation: profile.orientation,
    copies,
    scaleContent: profile.scaleContent,
    margins: profile.marginsMm ?? 0,
    printerTray: profile.printerTray || null,
    jobName,
    rasterize: profile.rasterize,
  });
}

type RuntimeQzConfig = { getPrinter(): Record<string, unknown>; getOptions(): Record<string, unknown> };
async function submitApprovedPrint(config: unknown, data: Array<Record<string, unknown>>): Promise<void> {
  const runtime = config as RuntimeQzConfig;
  const params = { printer: runtime.getPrinter(), options: runtime.getOptions(), data };
  await approvedQzCall("print", params, () => qz.print(config as never, data as never));
}

export function stripPdfDataUrlPrefix(value: string): string {
  return value.replace(/^data:application\/pdf;base64,/i, "").trim();
}

export async function printPdf(profile: PrinterProfile, pdfBase64: string, options: { copies?: number; jobName: string }): Promise<void> {
  const data = stripPdfDataUrlPrefix(pdfBase64);
  if (!data || !/^[A-Za-z0-9+/=\r\n]+$/.test(data)) throw new QzTrayError("INVALID_PDF", "Invalid PDF Base64 data.");
  await connectQzTray();
  const printData = [{ type: "pixel", format: "pdf", flavor: "base64", data }];
  try { await submitApprovedPrint(qzConfig(profile, options.copies ?? profile.copies, options.jobName), printData); }
  catch (error) { if (error instanceof QzTrayError) throw error; throw new QzTrayError("PRINT_FAILED", "QZ Tray rejected the print submission.", error); }
}

export async function printHtml(profile: PrinterProfile, html: string, options: { copies?: number; jobName: string }): Promise<void> {
  await connectQzTray();
  const printData = [{ type: "pixel", format: "html", flavor: "plain", data: html }];
  await submitApprovedPrint(qzConfig(profile, options.copies ?? profile.copies, options.jobName), printData);
}

export async function testPrinter(profile: PrinterProfile): Promise<void> {
  const html = `<html><body style="font-family:Arial,sans-serif;padding:4mm"><strong>RISpro QZ Tray test</strong><br>${profile.documentType}<br>${profile.paperWidthMm} x ${profile.paperHeightMm} mm<br>${new Date().toISOString()}</body></html>`;
  await printHtml(profile, html, { copies: 1, jobName: `RISpro test - ${profile.documentType}` });
}
