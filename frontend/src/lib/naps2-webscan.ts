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
