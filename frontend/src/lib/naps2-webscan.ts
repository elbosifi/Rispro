export interface Naps2WebScanStatus {
  available: boolean;
  endpoint?: string;
  kind?: "rispro_bridge" | "naps2_direct";
  message?: string;
}

export interface Naps2ScanOptions {
  endpoint?: string;
  dpi?: number;
  colorMode?: "grayscale" | "color";
  source?: "feeder" | "flatbed" | "duplex";
  fileName?: string;
}

export interface Naps2ScanResult {
  file: File;
  files?: File[];
  pageCount: number;
  source: "naps2_webscan";
}

type EsclDocumentFormat = "application/pdf" | "image/jpeg";

const DEFAULT_ENDPOINTS = ["http://127.0.0.1:9801", "http://localhost:9801"];
const REQUEST_TIMEOUT_MS = 15_000;
const SCAN_TIMEOUT_MS = 120_000;
const MAX_DOCUMENTS = 100;
const DEFAULT_RETRY_MS = 2_000;
const NAPS2_UNAVAILABLE_MESSAGE = "NAPS2 Scanner Sharing is not available on this workstation. Upload PDF/image instead.";

function normalizeEndpoint(endpoint: string): string {
  const value = endpoint.trim().replace(/\/+$/, "");
  if (!value) throw new Error("NAPS2 eSCL endpoint is required.");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("NAPS2 eSCL endpoint must use HTTP or HTTPS.");
  return value;
}

function candidateEndpoints(customEndpoint?: string): string[] {
  return customEndpoint?.trim() ? [normalizeEndpoint(customEndpoint)] : DEFAULT_ENDPOINTS;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizeNaps2Error(error: unknown): Error {
  if (error instanceof Error && error.name !== "AbortError") return new Error(error.message || NAPS2_UNAVAILABLE_MESSAGE);
  return new Error(NAPS2_UNAVAILABLE_MESSAGE);
}

export async function getNaps2WebScanStatus(endpoint?: string): Promise<Naps2WebScanStatus> {
  if (typeof window === "undefined" || typeof fetch === "undefined") return { available: false, message: NAPS2_UNAVAILABLE_MESSAGE };
  for (const candidate of candidateEndpoints(endpoint)) {
    try {
      const response = await fetchWithTimeout(`${candidate}/eSCL/ScannerCapabilities`, { method: "GET" }, 3_000);
      if (response.ok) return { available: true, endpoint: candidate, kind: "naps2_direct" };
    } catch {
      // Only the built-in loopback candidates are probes. A configured endpoint remains authoritative.
    }
  }
  return { available: false, message: NAPS2_UNAVAILABLE_MESSAGE };
}

export async function isNaps2WebScanAvailable(endpoint?: string): Promise<boolean> {
  return (await getNaps2WebScanStatus(endpoint)).available;
}

function normalizeDpi(dpi: number | undefined): number {
  const value = dpi ?? 200;
  if (!Number.isInteger(value) || value < 50 || value > 1200) throw new Error("Scan DPI must be a whole number between 50 and 1200.");
  return value;
}

function buildScanSettings(options: Required<Pick<Naps2ScanOptions, "dpi" | "colorMode" | "source">>, documentFormat: EsclDocumentFormat): string {
  const inputSource = options.source === "flatbed" ? "Platen" : "Feeder";
  const duplex = options.source === "duplex" ? "\n  <scan:Duplex>true</scan:Duplex>" : "";
  const colorMode = options.colorMode === "color" ? "RGB24" : "Grayscale8";
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm" xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03">
  <pwg:Version>2.6</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:InputSource>${inputSource}</pwg:InputSource>${duplex}
  <pwg:DocumentFormat>${documentFormat}</pwg:DocumentFormat>
  <scan:DocumentFormatExt>${documentFormat}</scan:DocumentFormatExt>
  <scan:XResolution>${options.dpi}</scan:XResolution>
  <scan:YResolution>${options.dpi}</scan:YResolution>
  <scan:ColorMode>${colorMode}</scan:ColorMode>
</scan:ScanSettings>`;
}

class ScanJobCreationError extends Error {
  constructor(readonly status: number, readonly format: EsclDocumentFormat) {
    super(status === 400 ? "NAPS2 rejected the scan settings." : status === 409 || status === 503 ? "The scanner is busy. Try again when the current scan finishes." : `NAPS2 scan job creation failed with HTTP ${status}.`);
  }
}

async function createScanJob(endpoint: string, options: Required<Pick<Naps2ScanOptions, "dpi" | "colorMode" | "source">>, documentFormat: EsclDocumentFormat): Promise<URL> {
  const response = await fetchWithTimeout(`${endpoint}/eSCL/ScanJobs`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: buildScanSettings(options, documentFormat),
  });
  if (response.status !== 201) throw new ScanJobCreationError(response.status, documentFormat);
  const location = response.headers.get("Location") || response.headers.get("location");
  if (!location) throw new Error("NAPS2 did not return a scan job Location header.");
  try {
    return new URL(location, `${endpoint}/`);
  } catch {
    throw new Error("NAPS2 returned an invalid scan job Location header.");
  }
}

function retryAfterMs(value: string | null): number {
  if (!value) return DEFAULT_RETRY_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? DEFAULT_RETRY_MS : Math.min(Math.max(0, date - Date.now()), 30_000);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readErrorDetails(jobUrl: URL): Promise<string> {
  try {
    const response = await fetchWithTimeout(new URL("ErrorDetails", `${jobUrl.toString().replace(/\/?$/, "/")}`).toString(), { method: "GET" }, 5_000);
    const body = (await response.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return body ? ` NAPS2 details: ${body.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}

function responseMimeType(response: Response, blob: Blob): string {
  return (response.headers.get("Content-Type") || blob.type || "").split(";", 1)[0].trim().toLowerCase();
}

async function readScannedDocuments(jobUrl: URL): Promise<Blob[]> {
  const documents: Blob[] = [];
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (documents.length < MAX_DOCUMENTS) {
    if (Date.now() >= deadline) throw new Error("NAPS2 scan timed out while waiting for pages.");
    const response = await fetchWithTimeout(new URL("NextDocument", `${jobUrl.toString().replace(/\/?$/, "/")}`).toString(), { method: "GET" });
    if (response.status === 503) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("NAPS2 scan timed out while waiting for pages.");
      await wait(Math.min(retryAfterMs(response.headers.get("Retry-After")), remaining));
      continue;
    }
    if (response.status === 404) {
      if (!documents.length) throw new Error("NAPS2 completed the scan without returning any pages.");
      return documents;
    }
    if (response.status === 500) throw new Error(`NAPS2 reported a scanner error.${await readErrorDetails(jobUrl)}`);
    if (!response.ok) throw new Error(`NAPS2 failed while reading scanned pages with HTTP ${response.status}.`);
    const blob = await response.blob();
    const mimeType = responseMimeType(response, blob);
    if (!blob.size) throw new Error("NAPS2 returned an empty scanned document.");
    if (mimeType !== "application/pdf" && mimeType !== "image/jpeg") throw new Error(`NAPS2 returned an unexpected document type (${mimeType || "unknown"}).`);
    documents.push(new Blob([blob], { type: mimeType }));
  }
  throw new Error(`NAPS2 returned more than ${MAX_DOCUMENTS} documents; scan was stopped.`);
}

async function deleteScanJob(jobUrl: URL): Promise<void> {
  try { await fetchWithTimeout(jobUrl.toString(), { method: "DELETE" }, 5_000); } catch { /* Best effort cleanup. */ }
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> { return new Uint8Array(await blob.arrayBuffer()); }

function readJpegSize(bytes: Uint8Array): { width: number; height: number; colorSpace: "/DeviceGray" | "/DeviceRGB" } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("NAPS2 returned an invalid JPEG document.");
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]; const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) return { height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8], colorSpace: bytes[offset + 9] === 1 ? "/DeviceGray" : "/DeviceRGB" };
    offset += 2 + length;
  }
  throw new Error("NAPS2 returned a JPEG without page dimensions.");
}

function buffer(bytes: Uint8Array): ArrayBuffer { const result = new Uint8Array(bytes.byteLength); result.set(bytes); return result.buffer; }

async function buildPdfFromJpegPages(pages: Blob[]): Promise<Blob> {
  const encoder = new TextEncoder(); const chunks: BlobPart[] = []; const offsets: number[] = []; let length = 0; let nextId = 3;
  const append = (value: string | Uint8Array) => { const bytes = typeof value === "string" ? encoder.encode(value) : value; chunks.push(buffer(bytes)); length += bytes.length; };
  const object = (id: number) => { offsets[id] = length; append(`${id} 0 obj\n`); };
  const infos = (await Promise.all(pages.map(blobToBytes))).map((bytes) => ({ bytes, ...readJpegSize(bytes), pageId: nextId++, imageId: nextId++ }));
  append("%PDF-1.4\n"); object(1); append("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"); object(2); append(`<< /Type /Pages /Count ${infos.length} /Kids [${infos.map(({ pageId }) => `${pageId} 0 R`).join(" ")}] >>\nendobj\n`);
  for (const info of infos) {
    const contentId = nextId++; const content = `q\n${info.width} 0 0 ${info.height} 0 0 cm\n/Im${info.imageId} Do\nQ\n`;
    object(info.pageId); append(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${info.width} ${info.height}] /Resources << /XObject << /Im${info.imageId} ${info.imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);
    object(contentId); append(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    object(info.imageId); append(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${info.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${info.bytes.length} >>\nstream\n`); append(info.bytes); append("\nendstream\nendobj\n");
  }
  const xref = length; append(`xref\n0 ${nextId}\n0000000000 65535 f \n`); for (let id = 1; id < nextId; id += 1) append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`); append(`trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export async function scanAppointmentRequest(options: Naps2ScanOptions = {}): Promise<Naps2ScanResult> {
  const status = await getNaps2WebScanStatus(options.endpoint);
  if (!status.available || !status.endpoint) throw new Error(status.message || NAPS2_UNAVAILABLE_MESSAGE);
  const scanOptions = { dpi: normalizeDpi(options.dpi), colorMode: options.colorMode || "grayscale", source: options.source || "feeder" } as const;
  let jobUrl: URL | undefined;
  try {
    try { jobUrl = await createScanJob(status.endpoint, scanOptions, "application/pdf"); }
    catch (error) {
      if (!(error instanceof ScanJobCreationError) || error.format !== "application/pdf" || ![400, 406, 415, 422].includes(error.status)) throw error;
      jobUrl = await createScanJob(status.endpoint, scanOptions, "image/jpeg");
    }
    const documents = await readScannedDocuments(jobUrl);
    const pdf = documents.length === 1 && documents[0].type === "application/pdf" ? documents[0] : await buildPdfFromJpegPages(documents);
    if (!pdf.size) throw new Error("NAPS2 returned an empty PDF.");
    const baseName = (options.fileName?.trim() || "appointment-request.pdf").replace(/\.[a-z0-9]+$/i, "");
    return { file: new File([pdf], `${baseName}.pdf`, { type: "application/pdf" }), pageCount: documents.length, source: "naps2_webscan" };
  } catch (error) {
    if (jobUrl) await deleteScanJob(jobUrl);
    throw normalizeNaps2Error(error);
  }
}
