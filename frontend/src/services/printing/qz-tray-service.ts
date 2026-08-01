import * as qz from "qz-tray";
import type { PrinterProfile, QzPrinterDetail } from "@/types/printing";

let connectionPromise: Promise<void> | null = null;
let securityConfigured = false;

function configureSecurity(): void {
  if (securityConfigured) return;
  qz.security.setCertificatePromise((resolve, reject) => {
    fetch("/api/printing/qz-certificate", { credentials: "include", cache: "no-store" })
      .then(async (response) => response.ok ? resolve(await response.text()) : reject("Unable to load QZ certificate"))
      .catch((error) => reject(error instanceof Error ? error.message : "Unable to load QZ certificate"));
  }, { rejectOnFailure: true });
  qz.security.setSignatureAlgorithm("SHA512");
  qz.security.setSignaturePromise(async (request) => {
    const response = await fetch("/api/printing/qz-sign", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    });
    if (!response.ok) throw new Error("Unable to sign QZ request");
    const result = await response.json() as { signature?: string };
    if (!result.signature) throw new Error("QZ signing response did not contain a signature");
    return result.signature;
  });
  securityConfigured = true;
}

export async function connectQzTray(): Promise<void> {
  configureSecurity();
  if (qz.websocket.isActive()) return;
  if (!connectionPromise) {
    connectionPromise = qz.websocket.connect({ retries: 3, delay: 1 })
      .finally(() => { connectionPromise = null; });
  }
  await connectionPromise;
}

export async function disconnectQzTray(): Promise<void> {
  if (qz.websocket.isActive()) await qz.websocket.disconnect();
}

export function isQzConnected(): boolean {
  return qz.websocket.isActive();
}

export async function getInstalledPrinters(): Promise<string[]> {
  await connectQzTray();
  const result = await qz.printers.find();
  return Array.isArray(result) ? result.map(String) : [String(result)];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export async function getPrinterDetails(): Promise<QzPrinterDetail[]> {
  await connectQzTray();
  const result = await qz.printers.details();
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
  return qz.configs.create(profile.printerName, {
    units: "mm",
    size: { width: profile.paperWidthMm, height: profile.paperHeightMm },
    orientation: profile.orientation,
    copies,
    scaleContent: profile.scaleContent,
    margins: profile.marginsMm ?? 0,
    printerTray: profile.printerTray || null,
    jobName,
    rasterize: true,
  });
}

export function stripPdfDataUrlPrefix(value: string): string {
  return value.replace(/^data:application\/pdf;base64,/i, "").trim();
}

export async function printPdf(profile: PrinterProfile, pdfBase64: string, options: { copies?: number; jobName: string }): Promise<void> {
  const data = stripPdfDataUrlPrefix(pdfBase64);
  if (!data || !/^[A-Za-z0-9+/=\r\n]+$/.test(data)) throw new Error("Invalid PDF Base64 data");
  await connectQzTray();
  await qz.print(qzConfig(profile, options.copies ?? profile.copies, options.jobName), [{ type: "pixel", format: "pdf", flavor: "base64", data }]);
}

export async function printHtml(profile: PrinterProfile, html: string, options: { copies?: number; jobName: string }): Promise<void> {
  await connectQzTray();
  await qz.print(qzConfig(profile, options.copies ?? profile.copies, options.jobName), [{ type: "pixel", format: "html", flavor: "plain", data: html }]);
}

export async function testPrinter(profile: PrinterProfile): Promise<void> {
  const html = `<html><body style="font-family:Arial,sans-serif;padding:4mm"><strong>RISpro QZ Tray test</strong><br>${profile.documentType}<br>${profile.paperWidthMm} x ${profile.paperHeightMm} mm<br>${new Date().toISOString()}</body></html>`;
  await printHtml(profile, html, { copies: 1, jobName: `RISpro test - ${profile.documentType}` });
}

