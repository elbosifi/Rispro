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
  getPrinterDetails,
  printPdf,
  serializeQzRequest,
  sha256Hex,
  stripPdfDataUrlPrefix,
} from "./qz-tray-service";
import { DEFAULT_PRINTER_PROFILES } from "./workstation-printer-settings";

const signingBodies: Array<{ request: string; digest: string }> = [];

function mockApi(allowInsecureWebsocket = false): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/runtime-config")) return new Response(JSON.stringify({ allowInsecureWebsocket }), { status: 200 });
    if (url.endsWith("/qz-sign")) {
      const body = JSON.parse(String(init?.body)) as { request: string; digest: string };
      signingBodies.push(body);
      return new Response(JSON.stringify({ signature: `signature:${body.digest}` }), { status: 200 });
    }
    if (url.endsWith("/qz-certificate")) return new Response("certificate", { status: 200 });
    return new Response(null, { status: 404 });
  }));
}

describe("QZ Tray service", () => {
  beforeEach(() => {
    qzMocks.active = false;
    vi.clearAllMocks();
    signingBodies.length = 0;
    __qzTrayTestables.resetRuntimeConfig();
    mockApi();
    qzMocks.connect.mockImplementation(async () => { qzMocks.active = true; });
    qzMocks.disconnect.mockResolvedValue(undefined);
    qzMocks.create.mockImplementation((printer: string, options: Record<string, unknown>) => ({ config: true, getPrinter: () => ({ name: printer }), getOptions: () => options }));
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

  it("uses insecure WebSockets only when the authenticated runtime configuration enables them", async () => {
    __qzTrayTestables.resetRuntimeConfig();
    mockApi(true);
    await connectQzTray();
    expect(qzMocks.connect).toHaveBeenCalledWith({ retries: 3, delay: 1, usingSecure: false });
  });

  it("pre-signs printer discovery with its exact params and timestamp", async () => {
    const originalDateNow = Date.now;
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_123);
    await expect(getInstalledPrinters()).resolves.toEqual(["RISPRO A4", "RISPRO LABEL"]);
    const expectedRequest = serializeQzRequest("printers.find", {}, 1_725_000_000_123);
    expect(signingBodies).toEqual([{ request: expectedRequest, digest: await sha256Hex(expectedRequest) }]);
    expect(qzMocks.find).toHaveBeenCalledWith(undefined, `signature:${await sha256Hex(expectedRequest)}`, 1_725_000_000_123);
    expect(Date.now).toBe(dateNowSpy);
    dateNowSpy.mockRestore();
    expect(Date.now).toBe(originalDateNow);
  });

  it("does not invoke nondeterministic printer-details signing in QZ 2.2.6", async () => {
    await expect(getPrinterDetails()).resolves.toEqual([]);
    expect(qzMocks.details).not.toHaveBeenCalled();
    expect(signingBodies).toHaveLength(0);
  });

  it("creates and deterministically signs a millimetre pixel-PDF job", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_456);
    const profile = { ...DEFAULT_PRINTER_PROFILES[0], printerName: "RISPRO A4", printerTray: "Tray 1" };
    await printPdf(profile, "data:application/pdf;base64,JVBERi0xLjQ=", { copies: 2, jobName: "RISpro test" });
    const options = expect.objectContaining({ units: "mm", size: { width: 210, height: 297, custom: false }, copies: 2, printerTray: "Tray 1", jobName: "RISpro test", rasterize: false });
    expect(qzMocks.create).toHaveBeenCalledWith("RISPRO A4", options);
    const config = qzMocks.create.mock.results[0].value;
    const data = [{ type: "pixel", format: "pdf", flavor: "base64", data: "JVBERi0xLjQ=" }];
    const request = signingBodies[0].request;
    expect(JSON.parse(request)).toEqual({ call: "print", params: { printer: config.getPrinter(), options: config.getOptions(), data }, timestamp: 1_725_000_000_456 });
    expect(signingBodies[0].digest).toBe(await sha256Hex(request));
    expect(qzMocks.print).toHaveBeenCalledWith(config, data, `signature:${signingBodies[0].digest}`, 1_725_000_000_456);
    vi.mocked(Date.now).mockRestore();
  });

  it("keeps concurrent print signatures associated with their own request", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(101).mockReturnValueOnce(202);
    const a4 = { ...DEFAULT_PRINTER_PROFILES[0], printerName: "A4" };
    const label = { ...DEFAULT_PRINTER_PROFILES[2], printerName: "Label" };
    await Promise.all([
      printPdf(a4, "JVBERi0xLjQ=", { jobName: "a4" }),
      printPdf(label, "JVBERi0xLjU=", { jobName: "label" }),
    ]);
    expect(signingBodies).toHaveLength(2);
    for (const body of signingBodies) expect(body.digest).toBe(await sha256Hex(body.request));
    const calls = qzMocks.print.mock.calls;
    expect(calls.map((call) => call[2])).toEqual(signingBodies.map((body) => `signature:${body.digest}`));
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

  it("uses custom media and profile-controlled rasterization for a 50 x 30 mm label", async () => {
    const profile = { ...DEFAULT_PRINTER_PROFILES[2], printerName: "Xprinter" };
    await printPdf(profile, "JVBERi0xLjQ=", { jobName: "label" });
    expect(qzMocks.create).toHaveBeenCalledWith("Xprinter", expect.objectContaining({ size: { width: 50, height: 30, custom: true }, rasterize: true }));
  });

  it("removes a PDF data URL prefix and leaves raw Base64", () => {
    expect(stripPdfDataUrlPrefix("data:application/pdf;base64,JVBERi0xLjQ=")).toBe("JVBERi0xLjQ=");
  });
});
