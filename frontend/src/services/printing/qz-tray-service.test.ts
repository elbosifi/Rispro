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

import { connectQzTray, getInstalledPrinters, getPrinterDetails, printPdf, stripPdfDataUrlPrefix } from "./qz-tray-service";
import { DEFAULT_PRINTER_PROFILES } from "./workstation-printer-settings";

describe("QZ Tray service", () => {
  beforeEach(() => {
    qzMocks.active = false;
    vi.clearAllMocks();
    qzMocks.connect.mockImplementation(async () => { qzMocks.active = true; });
    qzMocks.disconnect.mockResolvedValue(undefined);
    qzMocks.create.mockReturnValue({ config: true });
    qzMocks.print.mockResolvedValue(undefined);
  });

  it("shares one simultaneous WebSocket connection attempt", async () => {
    let release!: () => void;
    qzMocks.connect.mockReturnValue(new Promise<void>((resolve) => { release = () => { qzMocks.active = true; resolve(); }; }));
    const first = connectQzTray();
    const second = connectQzTray();
    expect(qzMocks.connect).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(qzMocks.connect).toHaveBeenCalledWith({ retries: 3, delay: 1 });
  });

  it("returns exact installed queue names and driver trays", async () => {
    qzMocks.find.mockResolvedValue(["RISPRO A4", "RISPRO LABEL"]);
    qzMocks.details.mockResolvedValue([{ name: "RISPRO A4", trays: ["Tray 1", "Manual Feed"] }]);
    await expect(getInstalledPrinters()).resolves.toEqual(["RISPRO A4", "RISPRO LABEL"]);
    await expect(getPrinterDetails()).resolves.toMatchObject([{ name: "RISPRO A4", trays: ["Tray 1", "Manual Feed"] }]);
  });

  it("creates a millimetre pixel-PDF job with raw Base64", async () => {
    const profile = { ...DEFAULT_PRINTER_PROFILES[0], printerName: "RISPRO A4", printerTray: "Tray 1" };
    await printPdf(profile, "data:application/pdf;base64,JVBERi0xLjQ=", { copies: 2, jobName: "RISpro test" });
    expect(qzMocks.create).toHaveBeenCalledWith("RISPRO A4", expect.objectContaining({ units: "mm", size: { width: 210, height: 297 }, copies: 2, printerTray: "Tray 1", jobName: "RISpro test" }));
    expect(qzMocks.print).toHaveBeenCalledWith({ config: true }, [{ type: "pixel", format: "pdf", flavor: "base64", data: "JVBERi0xLjQ=" }]);
  });

  it("removes a PDF data URL prefix and leaves raw Base64", () => {
    expect(stripPdfDataUrlPrefix("data:application/pdf;base64,JVBERi0xLjQ=")).toBe("JVBERi0xLjQ=");
  });
});
