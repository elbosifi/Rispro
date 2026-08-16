import { beforeEach, describe, expect, it, vi } from "vitest";

const qzMocks = vi.hoisted(() => ({
  active: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
  find: vi.fn(),
  details: vi.fn(),
  create: vi.fn(),
  print: vi.fn(),
  setCertificatePromise: vi.fn(),
  setSignatureAlgorithm: vi.fn(),
  setSignaturePromise: vi.fn(),
}));

vi.mock("qz-tray", () => ({
  websocket: {
    isActive: () => qzMocks.active,
    connect: (...args: unknown[]) => qzMocks.connect(...args),
    disconnect: (...args: unknown[]) => qzMocks.disconnect(...args),
  },
  printers: {
    find: (...args: unknown[]) => qzMocks.find(...args),
    details: (...args: unknown[]) => qzMocks.details(...args),
  },
  configs: { create: (...args: unknown[]) => qzMocks.create(...args) },
  print: (...args: unknown[]) => qzMocks.print(...args),
  security: {
    setCertificatePromise: (...args: unknown[]) => qzMocks.setCertificatePromise(...args),
    setSignatureAlgorithm: (...args: unknown[]) => qzMocks.setSignatureAlgorithm(...args),
    setSignaturePromise: (...args: unknown[]) => qzMocks.setSignaturePromise(...args),
  },
}));

import {
  __qzTrayTestables,
  connectQzTray,
  getInstalledPrinters,
  printPdf,
  serializeQzRequest,
  stripPdfDataUrlPrefix,
} from "./qz-tray-service";
import { DEFAULT_PRINTER_PROFILES } from "./workstation-printer-settings";

const signingBodies: Array<{ request: string }> = [];

function mockApi(allowInsecureWebsocket = false): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/runtime-config")) return new Response(JSON.stringify({ allowInsecureWebsocket }), { status: 200 });
    if (url.endsWith("/qz-sign")) {
      const body = JSON.parse(String(init?.body)) as { request: string };
      signingBodies.push(body);
      return new Response(JSON.stringify({ signature: `signature:${body.request}` }), { status: 200 });
    }
    if (url.endsWith("/qz-certificate")) return new Response("certificate", { status: 200 });
    return new Response(null, { status: 404 });
  }));
}

function mockOrigin(protocol: "http:" | "https:"): void {
  vi.stubGlobal("window", { location: { protocol } });
}

describe("QZ Tray service", () => {
  beforeEach(() => {
    qzMocks.active = false;
    vi.clearAllMocks();
    signingBodies.length = 0;
    __qzTrayTestables.resetRuntimeConfig();
    mockOrigin("http:");
    mockApi();
    qzMocks.connect.mockImplementation(async () => { qzMocks.active = true; });
    qzMocks.disconnect.mockResolvedValue(undefined);
    qzMocks.create.mockImplementation((printer: string, options: Record<string, unknown>) => ({ config: true, getPrinter: () => ({ name: printer }), getOptions: () => ({ rotation: 0, spool: null, size: options.size ?? null, ...options }) }));
    qzMocks.find.mockResolvedValue(["RISPRO A4", "RISPRO LABEL"]);
    qzMocks.print.mockResolvedValue(undefined);
  });

  it("shares one simultaneous secure WebSocket connection attempt by default", async () => {
    let release!: () => void;
    qzMocks.connect.mockReturnValue(new Promise<void>((resolve) => { release = () => { qzMocks.active = true; resolve(); }; }));
    const first = connectQzTray();
    const second = connectQzTray();
    await vi.waitFor(() => expect(qzMocks.connect).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(qzMocks.connect).toHaveBeenCalledWith({ retries: 3, delay: 1, usingSecure: true });
  });

  it("uses secure WebSockets on an HTTPS origin when insecure mode is enabled", async () => {
    mockOrigin("https:");
    __qzTrayTestables.resetRuntimeConfig();
    mockApi(true);
    await connectQzTray();
    expect(qzMocks.connect).toHaveBeenCalledWith({ retries: 3, delay: 1, usingSecure: true });
  });

  it("uses insecure WebSockets on an HTTP origin when insecure mode is enabled", async () => {
    mockOrigin("http:");
    __qzTrayTestables.resetRuntimeConfig();
    mockApi(true);
    await connectQzTray();
    expect(qzMocks.connect).toHaveBeenCalledWith({ retries: 3, delay: 1, usingSecure: false });
  });

  it("uses secure WebSockets on an HTTP origin when insecure mode is disabled", async () => {
    mockOrigin("http:");
    __qzTrayTestables.resetRuntimeConfig();
    mockApi(false);
    await connectQzTray();
    expect(qzMocks.connect).toHaveBeenCalledWith({ retries: 3, delay: 1, usingSecure: true });
  });

  it("pre-signs printer discovery without requiring crypto.subtle", async () => {
    vi.stubGlobal("crypto", {});
    const originalDateNow = Date.now;
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_123);
    await expect(getInstalledPrinters()).resolves.toEqual(["RISPRO A4", "RISPRO LABEL"]);
    const expectedRequest = serializeQzRequest("printers.find", {}, 1_725_000_000_123);
    expect(signingBodies).toEqual([{ request: expectedRequest }]);
    expect(qzMocks.find).toHaveBeenCalledWith(undefined, `signature:${expectedRequest}`, 1_725_000_000_123);
    expect(Date.now).toBe(dateNowSpy);
    dateNowSpy.mockRestore();
    expect(Date.now).toBe(originalDateNow);
  });

  it("creates and deterministically signs a millimetre pixel-PDF job", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_456);
    const profile = { ...DEFAULT_PRINTER_PROFILES[0], printerName: "RISPRO A4", printerTray: "Tray 1" };
    await printPdf(profile, "data:application/pdf;base64,JVBERi0xLjQ=", { copies: 2, jobName: "RISpro test" });
    const options = expect.objectContaining({ units: "mm", size: { width: 210, height: 297, custom: false }, orientation: "portrait", copies: 2, printerTray: "Tray 1", jobName: "RISpro test", rasterize: false });
    expect(qzMocks.create).toHaveBeenCalledWith("RISPRO A4", options);
    const config = qzMocks.create.mock.results[0].value;
    const data = [{ type: "pixel", format: "pdf", flavor: "base64", data: "JVBERi0xLjQ=" }];
    const request = signingBodies[0].request;
    expect(JSON.parse(request)).toEqual({ call: "print", params: { printer: config.getPrinter(), options: config.getOptions(), data }, timestamp: 1_725_000_000_456 });
    expect(signingBodies[0]).toEqual({ request });
    expect(qzMocks.print).toHaveBeenCalledWith(config, data, `signature:${request}`, 1_725_000_000_456);
    vi.mocked(Date.now).mockRestore();
  });

  it("omits explicit driver media for the logical A4 landscape profile", async () => {
    const profile = { ...DEFAULT_PRINTER_PROFILES[1], printerName: "RISPRO A4 Landscape", printerTray: "Landscape Tray", copies: 2, rasterize: true, scaleContent: false, marginsMm: { top: 1, right: 2, bottom: 3, left: 4 } };
    await printPdf(profile, "JVBERi0xLjQ=", { jobName: "RISpro registration list" });
    expect(qzMocks.create).toHaveBeenCalledWith("RISPRO A4 Landscape", expect.not.objectContaining({ size: expect.anything() }));
    expect(qzMocks.create).toHaveBeenCalledWith("RISPRO A4 Landscape", expect.objectContaining({ orientation: "landscape", printerTray: "Landscape Tray", copies: 2, rasterize: true, scaleContent: false, margins: { top: 1, right: 2, bottom: 3, left: 4 } }));
  });

  it.each([
    ["portrait", 0, 210, 297],
    ["landscape", 1, 297, 210],
  ] as const)("serializes finalized A4 %s PDF options with the approved media/orientation configuration", async (orientation, profileIndex, width, height) => {
    vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_789);
    const profile = { ...DEFAULT_PRINTER_PROFILES[profileIndex], printerName: `Finalized ${width}x${height}`, scaleContent: true, marginsMm: { top: 4, right: 4, bottom: 4, left: 4 } };
    await printPdf(profile, "JVBERi0xLjQ=", { jobName: "Finalized report", preservePdfPageGeometry: true });

    expect(qzMocks.create).toHaveBeenCalledTimes(1);
    const config = qzMocks.create.mock.results[0].value;
    expect(config.getOptions()).toEqual(expect.objectContaining({
      orientation: orientation === "landscape" ? "landscape" : null,
      size: { width: 210, height: 297, custom: false },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      scaleContent: false,
      rotation: 0,
      spool: null,
    }));
    const parsed = JSON.parse(signingBodies[0].request);
    expect(parsed.params.options).toEqual(config.getOptions());
    expect(parsed.params.data).toEqual([{ type: "pixel", format: "pdf", flavor: "base64", data: "JVBERi0xLjQ=" }]);
    expect(qzMocks.print).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockRestore();
  });

  it("keeps concurrent print signatures associated with their own request", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(101).mockReturnValueOnce(202);
    const a4 = { ...DEFAULT_PRINTER_PROFILES[0], printerName: "A4" };
    const label = { ...DEFAULT_PRINTER_PROFILES[3], printerName: "Label" };
    await Promise.all([
      printPdf(a4, "JVBERi0xLjQ=", { jobName: "a4" }),
      printPdf(label, "JVBERi0xLjU=", { jobName: "label" }),
    ]);
    expect(signingBodies).toHaveLength(2);
    const calls = qzMocks.print.mock.calls;
    expect(calls.map((call) => call[2])).toEqual(signingBodies.map((body) => `signature:${body.request}`));
    expect(calls.map((call) => call[3])).toEqual([101, 202]);
    vi.mocked(Date.now).mockRestore();
  });

  it("maps signing rejection and oversized signing requests to typed errors", async () => {
    const profile = { ...DEFAULT_PRINTER_PROFILES[0], printerName: "A4" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("runtime-config")
      ? new Response(JSON.stringify({ allowInsecureWebsocket: false }), { status: 200 })
      : new Response(null, { status: 403 })));
    __qzTrayTestables.resetRuntimeConfig();
    await expect(printPdf(profile, "JVBERi0=", { jobName: "rejected" })).rejects.toMatchObject({ code: "SIGNATURE_FAILED" });
    qzMocks.active = false;
    __qzTrayTestables.resetRuntimeConfig();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("runtime-config")
      ? new Response(JSON.stringify({ allowInsecureWebsocket: false }), { status: 200 })
      : new Response(null, { status: 413 })));
    await expect(printPdf(profile, "JVBERi0=", { jobName: "large" })).rejects.toMatchObject({ code: "SIGNING_PAYLOAD_TOO_LARGE" });
  });

  it("maps a typed busy signing response to the existing retryable signature failure", async () => {
    const profile = { ...DEFAULT_PRINTER_PROFILES[0], printerName: "A4" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("runtime-config")
      ? new Response(JSON.stringify({ allowInsecureWebsocket: false }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "busy", details: { code: "QZ_SIGN_BUSY" } } }), { status: 503 })));
    __qzTrayTestables.resetRuntimeConfig();
    await expect(printPdf(profile, "JVBERi0=", { jobName: "busy" })).rejects.toMatchObject({
      code: "SIGNATURE_FAILED",
      message: "The RISpro signing service is busy. Try again shortly.",
    });
  });

  it("uses custom media, auto orientation, profile-controlled rasterization, and printer compensation margins for a 50 x 30 mm label", async () => {
    const profile = { ...DEFAULT_PRINTER_PROFILES[3], printerName: "Xprinter", marginsMm: { top: 1, right: 0, bottom: 0, left: 4 } };
    await printPdf(profile, "JVBERi0xLjQ=", { jobName: "label" });
    expect(qzMocks.create).toHaveBeenCalledWith("Xprinter", expect.objectContaining({ size: { width: 50, height: 30, custom: true }, orientation: null, rasterize: true, margins: { top: 1, right: 0, bottom: 0, left: 4 } }));
    expect(qzMocks.create).not.toHaveBeenCalledWith("Xprinter", expect.objectContaining({ size: { width: 30, height: 50, custom: true } }));
  });

  it("keeps the A5 standard profile unchanged", async () => {
    const profile = { ...DEFAULT_PRINTER_PROFILES[2], printerName: "A5" };
    await printPdf(profile, "JVBERi0xLjQ=", { jobName: "A5 appointment slip" });
    expect(qzMocks.create).toHaveBeenCalledWith("A5", expect.objectContaining({ size: { width: 148, height: 210, custom: false }, orientation: "portrait" }));
  });

  it("derives QZ orientation from final physical dimensions", async () => {
    const receipt = { ...DEFAULT_PRINTER_PROFILES[4], printerName: "Receipt", orientation: "landscape" as const };
    await printPdf(receipt, "JVBERi0xLjQ=", { jobName: "receipt" });
    expect(qzMocks.create).toHaveBeenCalledWith("Receipt", expect.objectContaining({ size: { width: 80, height: 200, custom: true }, orientation: "portrait" }));
  });

  it("removes a PDF data URL prefix and leaves raw Base64", () => {
    expect(stripPdfDataUrlPrefix("data:application/pdf;base64,JVBERi0xLjQ=")).toBe("JVBERi0xLjQ=");
  });
});
