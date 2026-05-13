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
  pageCount: number;
  source: "naps2_webscan";
}

type EsclDocumentFormat = "application/pdf" | "image/jpeg";

const DEFAULT_ENDPOINTS = [
  "http://127.0.0.1:9810",
  "http://localhost:9810",
  "http://127.0.0.1:9801",
  "http://localhost:9801",
];

const NAPS2_UNAVAILABLE_MESSAGE =
  "NAPS2.WebScan is not available on this workstation. Upload PDF/image instead.";
const BRIDGE_NOT_RUNNING_MESSAGE = "NAPS2 is working, but RISpro Scanner Bridge is not running.";
const BRIDGE_BLOCKED_MESSAGE = "Scanner bridge blocked by browser security; use manual upload.";

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

function candidateEndpoints(customEndpoint?: string): string[] {
  if (customEndpoint?.trim()) return [normalizeEndpoint(customEndpoint)];
  return DEFAULT_ENDPOINTS;
}

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function normalizeNaps2Error(error: unknown): Error {
  if (error instanceof Error && error.name !== "AbortError") {
    return new Error(error.message || NAPS2_UNAVAILABLE_MESSAGE);
  }
  return new Error(NAPS2_UNAVAILABLE_MESSAGE);
}

function isBridgeEndpoint(endpoint: string): boolean {
  return /:9810($|\/)/.test(endpoint);
}

async function fetchBridgeHealth(endpoint: string): Promise<Response> {
  return fetch(`${endpoint}/health`, {
    method: "GET",
    signal: withTimeout(3000),
  });
}

async function fetchDirectCapabilities(endpoint: string): Promise<Response> {
  return fetch(`${endpoint}/eSCL/ScannerCapabilities`, {
    method: "GET",
    signal: withTimeout(3000),
  });
}

export async function getNaps2WebScanStatus(endpoint?: string): Promise<Naps2WebScanStatus> {
  if (typeof window === "undefined" || typeof fetch === "undefined") {
    return { available: false, message: NAPS2_UNAVAILABLE_MESSAGE };
  }

  let directNaps2Reachable = false;
  let browserBlockedBridge = false;

  for (const candidate of candidateEndpoints(endpoint)) {
    try {
      if (isBridgeEndpoint(candidate)) {
        const response = await fetchBridgeHealth(candidate);
        if (response.ok) {
          return { available: true, endpoint: candidate, kind: "rispro_bridge" };
        }
        continue;
      }

      const response = await fetchDirectCapabilities(candidate);
      if (response.ok) {
        directNaps2Reachable = true;
      }
    } catch (error) {
      if (error instanceof TypeError && isBridgeEndpoint(candidate)) {
        browserBlockedBridge = true;
      }
      // Try the next loopback candidate.
    }
  }

  if (directNaps2Reachable) {
    return { available: false, kind: "naps2_direct", message: BRIDGE_NOT_RUNNING_MESSAGE };
  }
  if (browserBlockedBridge) {
    return { available: false, message: BRIDGE_BLOCKED_MESSAGE };
  }
  return { available: false, message: NAPS2_UNAVAILABLE_MESSAGE };
}

export async function isNaps2WebScanAvailable(endpoint?: string): Promise<boolean> {
  return (await getNaps2WebScanStatus(endpoint)).available;
}

function toEsclInputSource(source: Naps2ScanOptions["source"]): string {
  if (source === "flatbed") return "Platen";
  if (source === "duplex") return "Feeder";
  return "Feeder";
}

function toEsclColorMode(colorMode: Naps2ScanOptions["colorMode"]): string {
  return colorMode === "color" ? "RGB24" : "Grayscale8";
}

function buildScanSettings(
  options: Required<Pick<Naps2ScanOptions, "dpi" | "colorMode" | "source">>,
  documentFormat: EsclDocumentFormat
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm" xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03">
  <pwg:Version>2.6</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <scan:InputSource>${toEsclInputSource(options.source)}</scan:InputSource>
  <pwg:DocumentFormat>${documentFormat}</pwg:DocumentFormat>
  <scan:DocumentFormatExt>${documentFormat}</scan:DocumentFormatExt>
  <scan:XResolution>${options.dpi}</scan:XResolution>
  <scan:YResolution>${options.dpi}</scan:YResolution>
  <scan:ColorMode>${toEsclColorMode(options.colorMode)}</scan:ColorMode>
</scan:ScanSettings>`;
}

function resolveJobId(location: string): string {
  const normalized = location.trim().replace(/\/+$/, "");
  const jobId = normalized.split("/").pop();
  if (!jobId) throw new Error("NAPS2.WebScan did not return a scan job id.");
  return jobId;
}

async function createScanJob(
  endpoint: string,
  options: Required<Pick<Naps2ScanOptions, "dpi" | "colorMode" | "source">>,
  documentFormat: EsclDocumentFormat
): Promise<string> {
  const response = await fetch(`${endpoint}/eSCL/ScanJobs`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: buildScanSettings(options, documentFormat),
    signal: withTimeout(8000),
  });

  if (!response.ok) {
    throw new Error(`NAPS2.WebScan capabilities were reachable at ${endpoint}, but scan job creation failed with HTTP ${response.status} for ${documentFormat}.`);
  }

  const location = response.headers.get("Location") || response.headers.get("location") || "";
  return resolveJobId(location);
}

async function scanViaBridge(
  endpoint: string,
  options: Required<Pick<Naps2ScanOptions, "dpi" | "colorMode" | "source">>,
  fileName?: string
): Promise<Naps2ScanResult> {
  const response = await fetch(`${endpoint}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal: withTimeout(90000),
  });
  if (!response.ok) {
    let message = "RISpro Scanner Bridge could not complete the scan.";
    try {
      const body = await response.json();
      if (body?.error) message = String(body.error);
    } catch {
      // Keep generic message.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const normalizedFileName = (fileName?.trim() || "appointment-request.pdf").replace(/\.[a-z0-9]+$/i, "");
  return {
    file: new File([blob], `${normalizedFileName}.pdf`, { type: "application/pdf" }),
    pageCount: Number(response.headers.get("X-RISpro-Page-Count") || 1),
    source: "naps2_webscan",
  };
}

async function readScannedPages(endpoint: string, jobId: string): Promise<Blob[]> {
  const pages: Blob[] = [];

  for (let page = 0; page < 100; page += 1) {
    const response = await fetch(`${endpoint}/eSCL/ScanJobs/${encodeURIComponent(jobId)}/NextDocument`, {
      method: "GET",
      signal: withTimeout(45000),
    });

    if (response.status === 404) break;
    if (!response.ok) throw new Error("NAPS2.WebScan failed while reading scanned pages.");

    const blob = await response.blob();
    if (blob.size > 0) {
      pages.push(blob.type ? blob : new Blob([blob], { type: "image/jpeg" }));
    }
  }

  return pages;
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readJpegSize(bytes: Uint8Array): { width: number; height: number; colorSpace: "/DeviceGray" | "/DeviceRGB" } {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[offset + 5] << 8) + bytes[offset + 6],
        width: (bytes[offset + 7] << 8) + bytes[offset + 8],
        colorSpace: bytes[offset + 9] === 1 ? "/DeviceGray" : "/DeviceRGB",
      };
    }
    offset += 2 + length;
  }
  return { width: 612, height: 792, colorSpace: "/DeviceRGB" };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function buildPdfFromJpegPages(pages: Blob[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const chunks: BlobPart[] = [];
  const offsets: number[] = [];
  let byteLength = 0;
  let nextObjectId = 3;
  const pageObjectIds: number[] = [];
  const imageObjectIds: number[] = [];
  const jpegPages = await Promise.all(pages.map(blobToBytes));

  function appendText(text: string) {
    const bytes = encoder.encode(text);
    chunks.push(toArrayBuffer(bytes));
    byteLength += bytes.length;
  }

  function appendBytes(bytes: Uint8Array) {
    chunks.push(toArrayBuffer(bytes));
    byteLength += bytes.length;
  }

  function beginObject(id: number) {
    offsets[id] = byteLength;
    appendText(`${id} 0 obj\n`);
  }

  appendText("%PDF-1.4\n");
  beginObject(1);
  appendText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const pageInfos = jpegPages.map((bytes) => {
    const size = readJpegSize(bytes);
    const pageObjectId = nextObjectId++;
    const imageObjectId = nextObjectId++;
    pageObjectIds.push(pageObjectId);
    imageObjectIds.push(imageObjectId);
    return { bytes, ...size, pageObjectId, imageObjectId };
  });

  beginObject(2);
  appendText(`<< /Type /Pages /Count ${pageInfos.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`);

  for (const page of pageInfos) {
    beginObject(page.pageObjectId);
    appendText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im${page.imageObjectId} ${page.imageObjectId} 0 R >> >> /Contents ${nextObjectId} 0 R >>\nendobj\n`
    );
    const contentObjectId = nextObjectId++;
    const content = `q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im${page.imageObjectId} Do\nQ\n`;
    beginObject(contentObjectId);
    appendText(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    beginObject(page.imageObjectId);
    appendText(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace ${page.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`
    );
    appendBytes(page.bytes);
    appendText("\nendstream\nendobj\n");
  }

  const xrefOffset = byteLength;
  appendText(`xref\n0 ${nextObjectId}\n0000000000 65535 f \n`);
  for (let id = 1; id < nextObjectId; id += 1) {
    appendText(`${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`);
  }
  appendText(`trailer\n<< /Size ${nextObjectId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}

export async function scanAppointmentRequest(options: Naps2ScanOptions = {}): Promise<Naps2ScanResult> {
  const status = await getNaps2WebScanStatus(options.endpoint);
  if (!status.available || !status.endpoint || status.kind !== "rispro_bridge") {
    throw new Error(status.message || NAPS2_UNAVAILABLE_MESSAGE);
  }

  try {
    const scanOptions = {
      dpi: options.dpi || 200,
      colorMode: options.colorMode || "grayscale",
      source: options.source || "feeder",
    } as const;
    return await scanViaBridge(status.endpoint, scanOptions, options.fileName);
  } catch (error) {
    throw normalizeNaps2Error(error);
  }
}
