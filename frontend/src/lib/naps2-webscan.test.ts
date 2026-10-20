import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNaps2WebScanStatus, normalizeNaps2Source, scanAppointmentRequest } from "./naps2-webscan";

function response(input: { ok?: boolean; status?: number; headers?: Record<string, string>; blob?: Blob; text?: string } = {}): Response {
  const headers = input.headers ?? {};
  return { ok: input.ok ?? ((input.status ?? 200) >= 200 && (input.status ?? 200) < 300), status: input.status ?? 200, headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null }, blob: async () => input.blob ?? new Blob(["%PDF-1.4"], { type: "application/pdf" }), text: async () => input.text ?? capabilities } as Response;
}

const capabilities = '<scan:ScannerCapabilities xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"><scan:DocumentFormatExt>application/pdf</scan:DocumentFormatExt><scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt></scan:ScannerCapabilities>';
const emptyFeederError = "<Error><Type>NAPS2.Scan.Exceptions.DeviceFeederEmptyException</Type></Error>";
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 2 }), destroy: vi.fn().mockResolvedValue(undefined) }) }));
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x11, 0x00, 0xff, 0xd9])], { type: "image/jpeg" });

function mockScanner(options: {
  nextDocument?: (jobId: string, index: number) => Response | Promise<Response>;
  errorDetails?: (jobId: string) => string;
  errorDetailsStatus?: number;
  failErrorDetails?: boolean;
  createJob?: (jobId: string, body: string) => Response | Promise<Response>;
  deleteJob?: (jobId: string) => void | Promise<void>;
} = {}) {
  let jobIndex = 0;
  const documentIndexes = new Map<string, number>();
  const jobBodies: string[] = [];
  const events: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("ScannerCapabilities")) return response();
    if (url.endsWith("ScanJobs")) {
      jobIndex += 1;
      const jobId = String(jobIndex);
      const body = String(init?.body);
      jobBodies.push(body);
      events.push(`POST ${jobId}`);
      return options.createJob?.(jobId, body) ?? response({ status: 201, headers: { Location: `/eSCL/ScanJobs/${jobId}` } });
    }
    const jobId = url.match(/ScanJobs\/([^/]+)/)?.[1] ?? "";
    if (url.endsWith("NextDocument")) {
      const index = documentIndexes.get(jobId) ?? 0;
      documentIndexes.set(jobId, index + 1);
      events.push(`NEXT ${jobId} ${index}`);
      return options.nextDocument?.(jobId, index) ?? response({ status: 404 });
    }
    if (url.endsWith("ErrorDetails")) {
      events.push(`ERROR ${jobId}`);
      if (options.failErrorDetails) throw new TypeError("ErrorDetails unavailable");
      return response({ status: options.errorDetailsStatus ?? 200, text: options.errorDetails?.(jobId) ?? "" });
    }
    if (init?.method === "DELETE") {
      events.push(`DELETE ${jobId}`);
      await options.deleteJob?.(jobId);
      return response();
    }
    return response();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, jobBodies, events };
}

describe("naps2 direct eSCL adapter", () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("reports ScannerCapabilities as an available direct scanner and normalizes trailing slashes", async () => {
    const fetchMock = vi.fn(async () => response()); vi.stubGlobal("fetch", fetchMock);
    await expect(getNaps2WebScanStatus("http://192.9.101.45:9801/")).resolves.toEqual({ available: true, endpoint: "http://192.9.101.45:9801", kind: "naps2_direct" });
    expect(fetchMock).toHaveBeenCalledWith("http://192.9.101.45:9801/eSCL/ScannerCapabilities", expect.any(Object));
  });

  it("discovers ports throughout the documented HTTP range when no endpoint is configured", async () => {
    const fetchMock = vi.fn(async (url: string) => url.startsWith("http://127.0.0.1:9850") ? response() : response({ status: 404 })); vi.stubGlobal("fetch", fetchMock);
    await expect(getNaps2WebScanStatus()).resolves.toMatchObject({ available: true, endpoint: "http://127.0.0.1:9850", kind: "naps2_direct" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(":9810"))).toBe(true);
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

  it("normalizes supported sources and keeps the existing feeder fallback", () => {
    expect(["auto", "feeder", "flatbed", "duplex"].map(normalizeNaps2Source)).toEqual(["auto", "feeder", "flatbed", "duplex"]);
    expect(normalizeNaps2Source("unknown")).toBe("feeder");
    expect(normalizeNaps2Source(undefined)).toBe("feeder");
  });

  it.each([150, 200, 300, 400, 600])("sends %s DPI unchanged in both eSCL resolution fields", async (dpi) => {
    const scanner = mockScanner();
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", dpi })).rejects.toThrow("without returning any pages");
    expect(scanner.jobBodies[0]).toContain(`<scan:XResolution>${dpi}</scan:XResolution>`);
    expect(scanner.jobBodies[0]).toContain(`<scan:YResolution>${dpi}</scan:YResolution>`);
  });

  it.each([
    { source: "feeder" as const, input: "Feeder", duplex: false },
    { source: "flatbed" as const, input: "Platen", duplex: false },
    { source: "duplex" as const, input: "Feeder", duplex: true },
  ])("keeps the explicit $source selection in physical eSCL XML", async ({ source, input, duplex }) => {
    const scanner = mockScanner();
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source })).rejects.toThrow("without returning any pages");
    expect(scanner.jobBodies).toHaveLength(1);
    expect(scanner.jobBodies[0]).toContain(`<pwg:InputSource>${input}</pwg:InputSource>`);
    expect(scanner.jobBodies[0]).toContain(duplex ? "<scan:Duplex>true</scan:Duplex>" : "<scan:ColorMode>");
    expect(scanner.jobBodies[0]).not.toContain("Auto");
  });

  it("tries Auto on Feeder first and returns a successful feeder result without a Flatbed job", async () => {
    const scanner = mockScanner({
      nextDocument: (_jobId, index) => index === 0
        ? response({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } })
        : response({ status: 404 }),
    });
    const result = await scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" });

    expect(scanner.jobBodies).toHaveLength(1);
    expect(scanner.jobBodies[0]).toContain("<pwg:InputSource>Feeder</pwg:InputSource>");
    expect(scanner.jobBodies[0]).not.toContain("Platen");
    expect(result.paperSourceUsed).toBe("feeder");
    expect(result.source).toBe("naps2_webscan");
  });

  it.each(["feeder", "flatbed", "duplex"] as const)("reports the explicit %s paper source used", async (source) => {
    const scanner = mockScanner({
      nextDocument: (_jobId, index) => index === 0
        ? response({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } })
        : response({ status: 404 }),
    });
    const result = await scanAppointmentRequest({ endpoint: "http://scanner:9801", source });

    expect(result.paperSourceUsed).toBe(source);
    expect(scanner.jobBodies).toHaveLength(1);
  });

  it("cleans up a confirmed empty feeder job before one Flatbed fallback and returns its PDF", async () => {
    const scanner = mockScanner({
      nextDocument: (jobId, index) => jobId === "1"
        ? response({ status: 500 })
        : index === 0
          ? response({ blob: new Blob(["%PDF-1.4 flatbed"], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } })
          : response({ status: 404 }),
      errorDetails: () => emptyFeederError,
    });
    const result = await scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto", fileName: "test-page.pdf" });

    expect(scanner.jobBodies).toHaveLength(2);
    expect(scanner.jobBodies[0]).toContain("<pwg:InputSource>Feeder</pwg:InputSource>");
    expect(scanner.jobBodies[1]).toContain("<pwg:InputSource>Platen</pwg:InputSource>");
    expect(scanner.events.indexOf("DELETE 1")).toBeLessThan(scanner.events.indexOf("POST 2"));
    expect(result.file.name).toBe("test-page.pdf");
    expect(await result.file.text()).toContain("flatbed");
    expect(result.pageCount).toBe(2);
    expect(result.paperSourceUsed).toBe("flatbed");
    expect(result.source).toBe("naps2_webscan");
  });

  it.each(["feeder", "flatbed", "duplex"] as const)("does not switch an explicit %s selection after a confirmed empty-feeder error", async (source) => {
    const scanner = mockScanner({ nextDocument: () => response({ status: 500 }), errorDetails: () => emptyFeederError });
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source })).rejects.toThrow(source === "feeder" ? "document feeder is empty" : "scanner error");
    expect(scanner.jobBodies).toHaveLength(1);
    expect(scanner.jobBodies[0]).toContain(source === "flatbed" ? "<pwg:InputSource>Platen</pwg:InputSource>" : "<pwg:InputSource>Feeder</pwg:InputSource>");
    expect(scanner.jobBodies[0]).toContain(source === "duplex" ? "<scan:Duplex>true</scan:Duplex>" : "<scan:ColorMode>");
  });

  it.each([
    "Empty feeder",
    "<Error><Type>NAPS2.Scan.Exceptions.DeviceCommunicationException</Type></Error>",
    "<Error><Type>NAPS2.Scan.Exceptions.DevicePaperJamException</Type></Error>",
    "<Error><Type>NAPS2.Scan.Exceptions.DeviceOfflineException</Type></Error>",
    "<Error><Message>empty feeder</Message><Type>NAPS2.Scan.Exceptions.DeviceFeederEmptyException</Type",
    "<Error><Details><Type>NAPS2.Scan.Exceptions.DeviceFeederEmptyException</Type></Details></Error>",
    "<ErrorDetails><Type>NAPS2.Scan.Exceptions.DeviceFeederEmptyException</Type></ErrorDetails>",
    "<Error><Type>NAPS2.Scan.Exceptions.DeviceFeederEmptyException</Type></Error>",
    "",
  ])("does not infer an empty feeder from untrusted ErrorDetails: %s", async (details) => {
    const scanner = mockScanner({ nextDocument: () => response({ status: 500 }), errorDetails: () => details, errorDetailsStatus: details.includes("DeviceFeederEmptyException") ? 404 : 200 });
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" })).rejects.toThrow("scanner error");
    expect(scanner.jobBodies).toHaveLength(1);
  });

  it("does not fall back when ErrorDetails cannot be read", async () => {
    const scanner = mockScanner({ nextDocument: () => response({ status: 500 }), failErrorDetails: true });
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" })).rejects.toThrow("scanner error");
    expect(scanner.jobBodies).toHaveLength(1);
  });

  it.each([400, 403, 404, 409])("does not fall back on HTTP %s responses without a typed error", async (status) => {
    const scanner = mockScanner({ nextDocument: () => response({ status }) });
    const expectedMessage = status === 404 ? "without returning any pages" : status === 409 ? "busy" : `HTTP ${status}`;
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" })).rejects.toThrow(expectedMessage);
    expect(scanner.jobBodies).toHaveLength(1);
  });

  it("does not fall back when a scan job is rejected with HTTP 503", async () => {
    const scanner = mockScanner({ createJob: () => response({ status: 503 }) });
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" })).rejects.toThrow("busy");
    expect(scanner.jobBodies).toHaveLength(1);
  });

  it("does not fall back when a feeder request fails at the network layer", async () => {
    const scanner = mockScanner({ nextDocument: () => { throw new TypeError("network unavailable"); } });
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" })).rejects.toThrow("Unable to reach NAPS2");
    expect(scanner.jobBodies).toHaveLength(1);
  });

  it("does not fall back when the feeder scan times out", async () => {
    vi.useFakeTimers();
    const scanner = mockScanner({ nextDocument: () => response({ status: 503 }) });
    const pending = scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" });
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(scanner.jobBodies).toHaveLength(1);
  });

  it("does not fall back after a document was returned before the feeder error", async () => {
    const scanner = mockScanner({
      nextDocument: (_jobId, index) => index === 0
        ? response({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } })
        : response({ status: 500 }),
      errorDetails: () => emptyFeederError,
    });
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" })).rejects.toThrow("scanner error");
    expect(scanner.jobBodies).toHaveLength(1);
  });

  it("does not start a third physical job when the Flatbed fallback fails", async () => {
    const scanner = mockScanner({
      nextDocument: () => response({ status: 500 }),
      errorDetails: (jobId) => jobId === "1" ? emptyFeederError : "<Error><Type>NAPS2.Scan.Exceptions.DeviceCommunicationException</Type></Error>",
    });
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" })).rejects.toThrow("scanner error");
    expect(scanner.jobBodies).toHaveLength(2);
    expect(scanner.events.filter((event) => event.startsWith("DELETE "))).toHaveLength(2);
  });

  it("continues after failed best-effort cleanup without masking the fallback result", async () => {
    const scanner = mockScanner({
      nextDocument: (jobId, index) => jobId === "1"
        ? response({ status: 500 })
        : index === 0
          ? response({ blob: new Blob(["%PDF-1.4 fallback"], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } })
          : response({ status: 404 }),
      errorDetails: () => emptyFeederError,
      deleteJob: async (jobId) => { if (jobId === "1") throw new TypeError("cleanup unavailable"); },
    });
    const result = await scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" });

    expect(result.paperSourceUsed).toBe("flatbed");
    expect(scanner.jobBodies).toHaveLength(2);
    expect(scanner.events.indexOf("DELETE 1")).toBeLessThan(scanner.events.indexOf("POST 2"));
  });

  it("keeps the concurrency guard active while the Flatbed attempt is being created and releases it after failure", async () => {
    let releaseFlatbed!: (value: Response) => void;
    const scanner = mockScanner({
      nextDocument: () => response({ status: 500 }),
      errorDetails: () => emptyFeederError,
      createJob: (jobId, body) => body.includes("<pwg:InputSource>Platen</pwg:InputSource>")
        ? new Promise<Response>((resolve) => { releaseFlatbed = resolve; })
        : response({ status: 201, headers: { Location: `/eSCL/ScanJobs/${jobId}` } }),
    });
    const first = scanAppointmentRequest({ endpoint: "http://scanner:9801", source: "auto" });
    await vi.waitFor(() => expect(releaseFlatbed).toBeTypeOf("function"));
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801" })).rejects.toThrow("already in progress");
    releaseFlatbed(response({ status: 201, headers: { Location: "/eSCL/ScanJobs/2" } }));
    await expect(first).rejects.toThrow("scanner error");
    expect(scanner.jobBodies).toHaveLength(2);

    vi.stubGlobal("fetch", vi.fn(async () => response({ status: 503 })));
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801" })).rejects.toThrow("busy");
  });

  it("follows 503 retries then receives a PDF and finishes on 404", async () => {
    vi.useFakeTimers(); let next = 0;
    const fetchMock = vi.fn(async (url: string) => { if (url.endsWith("ScannerCapabilities")) return response(); if (url.endsWith("ScanJobs")) return response({ status: 201, headers: { Location: "/eSCL/ScanJobs/42" } }); if (url.endsWith("NextDocument")) { next += 1; return next < 3 ? response({ status: 503 }) : next === 3 ? response({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } }) : response({ status: 404 }); } return response(); }); vi.stubGlobal("fetch", fetchMock);
    const pending = scanAppointmentRequest({ endpoint: "http://scanner:9801" }); await vi.runAllTimersAsync(); const result = await pending;
    expect(result.file.type).toBe("application/pdf"); expect(result.pageCount).toBe(2); expect(fetchMock.mock.calls.some(([url]) => String(url).includes(":9810"))).toBe(false);
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
  it("rejects HTML or invalid capabilities even when HTTP is 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ text: "<html>login</html>" })));
    expect(await getNaps2WebScanStatus("http://scanner:9801")).toMatchObject({ available: false, message: expect.stringContaining("compatible eSCL") });
  });
  it("keeps an explicit remote endpoint authoritative and reports network restrictions honestly", async () => {
    const mock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")); vi.stubGlobal("fetch", mock);
    const result = await getNaps2WebScanStatus("http://192.9.101.45:9814");
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("cannot distinguish");
    expect(result.message).toContain("CSP");
  });
  it("rejects an origin not in the server CSP without making a request", async () => {
    const mock = vi.fn(); vi.stubGlobal("fetch", mock);
    expect(await getNaps2WebScanStatus("http://192.9.101.45:9801", [])).toMatchObject({ available: false, message: expect.stringContaining("not approved by server CSP") });
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([409, 503])("reports scanner busy on job creation HTTP %s without a second job", async (status) => {
    const mock = vi.fn(async (url: string) => url.endsWith("ScannerCapabilities") ? response() : response({ status })); vi.stubGlobal("fetch", mock);
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801" })).rejects.toThrow("busy");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("reports an inaccessible Location header without guessing a job URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("ScannerCapabilities") ? response() : response({ status: 201 })));
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801" })).rejects.toThrow("Access-Control-Expose-Headers: Location");
  });
  it("rejects cross-origin job locations", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("ScannerCapabilities") ? response() : response({ status: 201, headers: { Location: "http://attacker/eSCL/ScanJobs/1" } })));
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801" })).rejects.toThrow("unsafe");
  });
  it("returns multiple PDF responses intact and cleans up successful jobs even if DELETE fails", async () => {
    let next = 0;
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") throw new TypeError("cleanup unavailable");
      if (url.endsWith("ScannerCapabilities")) return response();
      if (url.endsWith("ScanJobs")) return response({ status: 201, headers: { Location: "/eSCL/ScanJobs/multi" } });
      return ++next <= 2 ? response() : response({ status: 404 });
    }); vi.stubGlobal("fetch", mock);
    const result = await scanAppointmentRequest({ endpoint: "http://scanner:9801" });
    expect(result.files).toHaveLength(2);
    expect(result.pageCount).toBe(4);
    expect(await result.files![1].text()).toContain("%PDF");
    expect(mock).toHaveBeenCalledWith("http://scanner:9801/eSCL/ScanJobs/multi", expect.objectContaining({ method: "DELETE" }));
  });
  it("prevents duplicate concurrent scans and releases the guard after failure", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const first = scanAppointmentRequest({ endpoint: "http://scanner:9801" });
    await expect(scanAppointmentRequest()).rejects.toThrow("already in progress");
    resolve(response({ status: 500 }));
    await expect(first).rejects.toThrow("HTTP 500");
    vi.stubGlobal("fetch", vi.fn(async () => response({ status: 503 })));
    await expect(scanAppointmentRequest({ endpoint: "http://scanner:9801" })).rejects.toThrow("busy");
  });
  it("bounds discovery time and concurrency when every port hangs", async () => {
    vi.useFakeTimers();
    let active = 0, max = 0;
    const mock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      active++; max = Math.max(max, active);
      init.signal!.addEventListener("abort", () => { active--; reject(new DOMException("aborted", "AbortError")); });
    })); vi.stubGlobal("fetch", mock);
    const pending = getNaps2WebScanStatus();
    await vi.advanceTimersByTimeAsync(6500);
    expect((await pending).available).toBe(false);
    expect(max).toBeLessThanOrEqual(8);
    expect(mock).toHaveBeenCalledTimes(51);
  });
  it("times out while reading a stalled response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({ ...response(), text: () => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) })));
    const pending = getNaps2WebScanStatus("http://scanner:9801");
    await vi.advanceTimersByTimeAsync(3000);
    expect((await pending).message).toContain("timed out");
  });

});
