import { normalizeNaps2Origin } from "@/services/scanning/workstation-naps2-settings";

export interface Naps2WebScanStatus {
  available: boolean;
  endpoint?: string;
  kind?: "rispro_bridge" | "naps2_direct";
  message?: string;
}

export interface Naps2ScanOptions {
  endpoint?: string;
  allowedOrigins?: string[];
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

const REQUEST_TIMEOUT_MS = 15_000;
const SCAN_TIMEOUT_MS = 120_000;
const MAX_DOCUMENTS = 100;
const DEFAULT_RETRY_MS = 1_000;
const CONFIRMED_ENDPOINT_KEY = "rispro.naps2ConfirmedEndpoint.v1";
const CONNECTION_HELP = "Check NAPS2 installation, Scanner Sharing and its HTTP endpoint. Run RISpro-NAPS2-Setup.cmd, then check Edge policy, NAPS2 CORS, server CSP and the scanner-host firewall. Browser JavaScript cannot distinguish a blocked request from a disconnected scanner. Manual PDF/image upload remains available.";
let scanInProgress = false;

export function assertNaps2EndpointApproved(endpoint: string, allowedOrigins?: string[]): string {
  const origin = normalizeNaps2Origin(endpoint);
  if (allowedOrigins && !allowedOrigins.includes(origin)) {
    throw new Error(`Scanner origin ${origin} is not approved by server CSP. Ask an administrator to add this exact origin to NAPS2_WEBSCAN_ALLOWED_ORIGINS and restart RISpro.`);
  }
  return origin;
}

async function request<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store" });
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`NAPS2 request timed out. ${CONNECTION_HELP}`);
    if (error instanceof TypeError) throw new Error(`Unable to reach NAPS2. ${CONNECTION_HELP}`);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function capabilitiesXml(text: string): Document {
  const document = new DOMParser().parseFromString(text, "application/xml");
  const root = document.documentElement;
  const formats = [...document.getElementsByTagNameNS("*", "DocumentFormat"), ...document.getElementsByTagNameNS("*", "DocumentFormatExt")].map((node) => node.textContent);
  if (document.getElementsByTagName("parsererror").length || root.localName !== "ScannerCapabilities" || root.namespaceURI !== "http://schemas.hp.com/imaging/escl/2011/05/03" || !formats.some((value) => value === "application/pdf" || value === "image/jpeg")) {
    throw new Error("The endpoint did not return compatible eSCL ScannerCapabilities with PDF or JPEG support. Check the scanner endpoint.");
  }
  return document;
}

async function probe(endpoint: string, timeoutMs: number): Promise<Naps2WebScanStatus> {
  return request(`${endpoint}/eSCL/ScannerCapabilities`, { method: "GET" }, async (response) => {
    if (!response.ok) throw new Error(response.status === 409 || response.status === 503 ? "The scanner is busy. Wait for the current scan to finish." : `NAPS2 connection test failed with HTTP ${response.status}. ${CONNECTION_HELP}`);
    capabilitiesXml(await response.text());
    return { available: true, endpoint, kind: "naps2_direct" };
  }, timeoutMs);
}

export async function getNaps2WebScanStatus(endpoint?: string, allowedOrigins?: string[]): Promise<Naps2WebScanStatus> {
  try {
    if (endpoint?.trim()) return await probe(assertNaps2EndpointApproved(endpoint, allowedOrigins), 3_000);
    // Prioritize a previously confirmed local device, then 9801, then bounded parallel probes.
    let confirmed: string | null = null;
    try { confirmed = localStorage.getItem(CONFIRMED_ENDPOINT_KEY); } catch { /* Storage is optional. */ }
    const local = (value: string) => /^http:\/\/(127\.0\.0\.1|localhost):98(0[1-9]|[1-4][0-9]|50)$/.test(value);
    const candidates = [...new Set([...(confirmed && local(confirmed) ? [confirmed] : []), "http://127.0.0.1:9801", ...Array.from({ length: 49 }, (_, index) => `http://127.0.0.1:${9802 + index}`), "http://localhost:9801"])];
    const deadline = Date.now() + 6_500;
    let found: Naps2WebScanStatus | undefined;
    const attempt = async (candidate: string) => {
      if (found || Date.now() >= deadline) return;
      try { const status = await probe(assertNaps2EndpointApproved(candidate, allowedOrigins), Math.min(700, deadline - Date.now())); if (!found) found = status; } catch { /* Only automatic loopback discovery may try another endpoint. */ }
    };
    await attempt(candidates.shift()!);
    await Promise.all(Array.from({ length: 8 }, async () => { while (!found && candidates.length && Date.now() < deadline) await attempt(candidates.shift()!); }));
    if (found) {
      try { localStorage.setItem(CONFIRMED_ENDPOINT_KEY, found.endpoint!); } catch { /* Storage is optional. */ }
      return found;
    }
    return { available: false, message: `No compatible local scanner found on HTTP ports 9801–9850. ${CONNECTION_HELP}` };
  } catch (error) {
    return { available: false, endpoint, message: error instanceof Error ? error.message : CONNECTION_HELP };
  }
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
    super([400, 406, 415, 422].includes(status) ? `NAPS2 rejected unsupported scan settings (HTTP ${status}). Check feeder/flatbed, duplex, DPI, color and PDF/JPEG support.` : status === 409 || status === 503 ? "The scanner is busy. Try again when the current scan finishes." : `NAPS2 scan job creation failed with HTTP ${status}.`);
  }
}

async function createScanJob(endpoint: string, options: Required<Pick<Naps2ScanOptions, "dpi" | "colorMode" | "source">>, documentFormat: EsclDocumentFormat): Promise<URL> {
  return request(`${endpoint}/eSCL/ScanJobs`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: buildScanSettings(options, documentFormat),
  }, async (response) => {
    if (response.status !== 201) throw new ScanJobCreationError(response.status, documentFormat);
    const location = response.headers.get("Location");
    if (!location) throw new Error("NAPS2 created a job but its Location header is missing or inaccessible. Check Access-Control-Expose-Headers: Location in NAPS2; wait for the orphan job to expire before retrying.");
    const job = new URL(location, `${endpoint}/`);
    if (job.origin !== endpoint || job.username || job.password || job.search || job.hash || !/^\/eSCL\/ScanJobs\/[^/]+\/?$/.test(job.pathname)) throw new Error("NAPS2 returned an unsafe scan job Location header.");
    return job;
  });
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
    const details = await request(new URL("ErrorDetails", `${jobUrl.toString().replace(/\/?$/, "/")}`).toString(), { method: "GET" }, async (response) => response.text(), 5_000);
    const body = details.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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
  while (true) {
    if (Date.now() >= deadline) throw new Error("NAPS2 scan timed out while waiting for pages.");
    const { response, blob } = await request(new URL("NextDocument", `${jobUrl.toString().replace(/\/?$/, "/")}`).toString(), { method: "GET" }, async (response) => ({ response, blob: response.ok ? await response.blob() : new Blob() }), Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
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
    if (!response.ok) throw new Error(response.status === 409 ? "The scanner is busy. Wait for the current scan to finish." : `NAPS2 failed while reading scanned pages with HTTP ${response.status}.`);
    const mimeType = responseMimeType(response, blob);
    if (!blob.size) throw new Error("NAPS2 returned an empty scanned document.");
    if (mimeType !== "application/pdf" && mimeType !== "image/jpeg") throw new Error(`NAPS2 returned an unexpected document type (${mimeType || "unknown"}).`);
    if (documents.length >= MAX_DOCUMENTS) throw new Error(`NAPS2 returned more than ${MAX_DOCUMENTS} documents; scan was stopped.`);
    documents.push(new Blob([blob], { type: mimeType }));
  }
}

async function deleteScanJob(jobUrl: URL): Promise<void> {
  try { await request(jobUrl.toString(), { method: "DELETE" }, async () => undefined, 3_000); } catch { /* Best effort cleanup. */ }
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

async function scannedFiles(documents: Blob[], baseName: string): Promise<{ files: File[]; pageCount: number }> {
  const files: File[] = [];
  let pageCount = 0;
  let jpegPages: Blob[] = [];
  const flushJpegs = async () => {
    if (!jpegPages.length) return;
    files.push(new File([await buildPdfFromJpegPages(jpegPages)], `${baseName}-${files.length + 1}.pdf`, { type: "application/pdf" }));
    pageCount += jpegPages.length;
    jpegPages = [];
  };
  for (const document of documents) {
    if (document.type === "image/jpeg") { jpegPages.push(document); continue; }
    await flushJpegs();
    // Preserve PDF responses as PDF, including multipage PDFs and multiple PDF documents.
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const task = pdfjs.getDocument({ data: await blobToBytes(document), isEvalSupported: false });
    try { const pdf = await task.promise; pageCount += pdf.numPages; }
    finally { await task.destroy(); }
    files.push(new File([document], `${baseName}-${files.length + 1}.pdf`, { type: "application/pdf" }));
  }
  await flushJpegs();
  if (files.length === 1) files[0] = new File([files[0]], `${baseName}.pdf`, { type: "application/pdf" });
  return { files, pageCount };
}

export async function scanAppointmentRequest(options: Naps2ScanOptions = {}): Promise<Naps2ScanResult> {
  if (scanInProgress) throw new Error("A scan is already in progress in this browser. Wait for it to finish.");
  scanInProgress = true;
  let jobUrl: URL | undefined;
  try {
    const status = await getNaps2WebScanStatus(options.endpoint, options.allowedOrigins);
    if (!status.available || !status.endpoint) throw new Error(status.message || CONNECTION_HELP);
    const scanOptions = { dpi: normalizeDpi(options.dpi), colorMode: options.colorMode || "grayscale", source: options.source || "feeder" } as const;
    try { jobUrl = await createScanJob(status.endpoint, scanOptions, "application/pdf"); }
    catch (error) {
      if (!(error instanceof ScanJobCreationError) || ![400, 406, 415, 422].includes(error.status)) throw error;
      jobUrl = await createScanJob(status.endpoint, scanOptions, "image/jpeg");
    }
    const documents = await readScannedDocuments(jobUrl);
    const baseName = (options.fileName?.trim() || "appointment-request.pdf").replace(/\.[a-z0-9]+$/i, "");
    const { files, pageCount } = await scannedFiles(documents, baseName);
    return { file: files[0], files, pageCount, source: "naps2_webscan" };
  } finally {
    if (jobUrl) await deleteScanJob(jobUrl);
    scanInProgress = false;
  }
}
