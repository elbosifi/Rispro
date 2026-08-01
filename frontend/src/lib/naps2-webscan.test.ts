import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNaps2WebScanStatus, scanAppointmentRequest } from "./naps2-webscan";

function response(input: { ok?: boolean; status?: number; headers?: Record<string, string>; blob?: Blob; text?: string } = {}): Response {
  const headers = input.headers ?? {};
  return { ok: input.ok ?? ((input.status ?? 200) >= 200 && (input.status ?? 200) < 300), status: input.status ?? 200, headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null }, blob: async () => input.blob ?? new Blob(["%PDF-1.4"], { type: "application/pdf" }), text: async () => input.text ?? "" } as Response;
}

const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x11, 0x00, 0xff, 0xd9])], { type: "image/jpeg" });

describe("naps2 direct eSCL adapter", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it("reports ScannerCapabilities as an available direct scanner and normalizes trailing slashes", async () => {
    const fetchMock = vi.fn(async () => response()); vi.stubGlobal("fetch", fetchMock);
    await expect(getNaps2WebScanStatus("http://192.9.101.45:9801/")).resolves.toEqual({ available: true, endpoint: "http://192.9.101.45:9801", kind: "naps2_direct" });
    expect(fetchMock).toHaveBeenCalledWith("http://192.9.101.45:9801/eSCL/ScannerCapabilities", expect.any(Object));
  });

  it("probes only the direct loopback endpoints when no endpoint is configured", async () => {
    const fetchMock = vi.fn(async (url: string) => url.startsWith("http://localhost:9801") ? response() : response({ status: 404 })); vi.stubGlobal("fetch", fetchMock);
    await expect(getNaps2WebScanStatus()).resolves.toMatchObject({ available: true, endpoint: "http://localhost:9801", kind: "naps2_direct" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(":9810"))).toBe(false);
  });

  it("creates a PDF scan job with NAPS2-compatible feeder duplex color XML", async () => {
    let xml = "";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("ScannerCapabilities")) return response();
      if (url.endsWith("ScanJobs")) { xml = String(init?.body); return response({ status: 201, headers: { Location: "/eSCL/ScanJobs/42" } }); }
      if (url.endsWith("NextDocument")) return response({ status: 404 });
      return response();
    }); vi.stubGlobal("fetch", fetchMock);
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "duplex", colorMode: "color", dpi: 200 })).rejects.toThrow("without returning any pages");
    expect(xml).toContain("<pwg:InputSource>Feeder</pwg:InputSource>"); expect(xml).toContain("<scan:Duplex>true</scan:Duplex>"); expect(xml).toContain("<scan:ColorMode>RGB24</scan:ColorMode>"); expect(xml).toContain("<scan:XResolution>200</scan:XResolution>"); expect(xml).toContain("<pwg:DocumentFormat>application/pdf</pwg:DocumentFormat>");
  });

  it("uses Platen, omits duplex, and maps grayscale when requested", async () => {
    let xml = ""; const fetchMock = vi.fn(async (url: string, init?: RequestInit) => { if (url.endsWith("ScannerCapabilities")) return response(); if (url.endsWith("ScanJobs")) { xml = String(init?.body); return response({ status: 201, headers: { Location: "http://scanner:9801/eSCL/ScanJobs/1" } }); } return response({ status: 404 }); }); vi.stubGlobal("fetch", fetchMock);
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "flatbed", colorMode: "grayscale" })).rejects.toThrow();
    expect(xml).toContain("<pwg:InputSource>Platen</pwg:InputSource>"); expect(xml).not.toContain("<scan:Duplex>"); expect(xml).toContain("<scan:ColorMode>Grayscale8</scan:ColorMode>");
  });

  it("follows 503 retries then receives a PDF and finishes on 404", async () => {
    vi.useFakeTimers(); let next = 0;
    const fetchMock = vi.fn(async (url: string) => { if (url.endsWith("ScannerCapabilities")) return response(); if (url.endsWith("ScanJobs")) return response({ status: 201, headers: { Location: "/eSCL/ScanJobs/42" } }); if (url.endsWith("NextDocument")) { next += 1; return next < 3 ? response({ status: 503 }) : next === 3 ? response({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } }) : response({ status: 404 }); } return response(); }); vi.stubGlobal("fetch", fetchMock);
    const pending = scanAppointmentRequest({ endpoint: "http://scanner:9801" }); await vi.runAllTimersAsync(); const result = await pending;
    expect(result.file.type).toBe("application/pdf"); expect(result.pageCount).toBe(1); expect(fetchMock.mock.calls.some(([url]) => String(url).includes(":9810"))).toBe(false);
  });

  it("falls back to JPEG only when PDF job creation is rejected and creates one PDF", async () => {
    let jobs = 0; let next = 0; const scanJobBodies: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => { if (url.endsWith("ScannerCapabilities")) return response(); if (url.endsWith("ScanJobs")) { scanJobBodies.push(String(init?.body)); jobs += 1; return jobs === 1 ? response({ status: 400 }) : response({ status: 201, headers: { Location: "/eSCL/ScanJobs/9" } }); } if (url.endsWith("NextDocument")) { next += 1; return next <= 2 ? response({ blob: jpeg, headers: { "Content-Type": "image/jpeg" } }) : response({ status: 404 }); } return response(); }); vi.stubGlobal("fetch", fetchMock);
    const result = await scanAppointmentRequest({ endpoint: "http://scanner:9801" });
    expect(jobs).toBe(2); expect(result.pageCount).toBe(2); expect(await result.file.text()).toContain("/Count 2"); expect(scanJobBodies[1]).toContain("image/jpeg");
  });

  it("uses ErrorDetails after a NAPS2 500 and deletes a failed job", async () => {
    const fetchMock = vi.fn(async (url: string) => { if (url.endsWith("ScannerCapabilities")) return response(); if (url.endsWith("ScanJobs")) return response({ status: 201, headers: { Location: "/eSCL/ScanJobs/9" } }); if (url.endsWith("NextDocument")) return response({ status: 500 }); if (url.endsWith("ErrorDetails")) return response({ text: "Empty feeder" }); return response(); }); vi.stubGlobal("fetch", fetchMock);
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801" })).rejects.toThrow("Empty feeder");
    expect(fetchMock).toHaveBeenCalledWith("http://scanner:9801/eSCL/ScanJobs/9", expect.objectContaining({ method: "DELETE" }));
  });

  it("times out a scan that keeps returning 503 and cleans up the job", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => { if (url.endsWith("ScannerCapabilities")) return response(); if (url.endsWith("ScanJobs")) return response({ status: 201, headers: { Location: "/eSCL/ScanJobs/timeout" } }); if (url.endsWith("NextDocument")) return response({ status: 503 }); return response(); }); vi.stubGlobal("fetch", fetchMock);
    const pending = scanAppointmentRequest({ endpoint: "http://scanner:9801" }); const assertion = expect(pending).rejects.toThrow("timed out"); await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledWith("http://scanner:9801/eSCL/ScanJobs/timeout", expect.objectContaining({ method: "DELETE" }));
  });
});
