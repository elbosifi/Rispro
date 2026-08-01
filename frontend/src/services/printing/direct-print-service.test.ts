import { beforeEach, describe, expect, it, vi } from "vitest";
import { directPrint, mapDirectPrintError, validateProfilePageSize } from "./direct-print-service";
import { createDefaultQzPrinterSettings, saveQzPrinterSettings } from "./workstation-printer-settings";

const getInstalledPrinters = vi.fn();
const printPdf = vi.fn();
const createAppointmentSlipPdfBlob = vi.fn();

vi.mock("./qz-tray-service", () => ({
  getInstalledPrinters: (...args: unknown[]) => getInstalledPrinters(...args),
  printPdf: (...args: unknown[]) => printPdf(...args),
}));
vi.mock("@/lib/api-client", () => ({ api: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/api-hooks", () => ({
  getAppointmentById: vi.fn().mockResolvedValue({ id: 7, accessionNumber: "ACC-7" }),
  fetchAppointmentSlipSettings: vi.fn().mockResolvedValue({ paperSize: "a4" }),
}));
vi.mock("@/lib/print-utils", () => ({ createAppointmentSlipPdfBlob: (...args: unknown[]) => createAppointmentSlipPdfBlob(...args) }));
vi.mock("@/lib/accession-label-printing", () => ({ createAccessionLabelPdfBlob: vi.fn() }));

const pdf = () => new Blob([new TextEncoder().encode("%PDF-1.4 test")], { type: "application/pdf" });

describe("direct print service", () => {
  beforeEach(() => {
    localStorage.clear();
    getInstalledPrinters.mockReset();
    printPdf.mockReset();
    createAppointmentSlipPdfBlob.mockReset();
    createAppointmentSlipPdfBlob.mockResolvedValue(pdf());
  });

  it("returns a structured missing-configuration failure", async () => {
    await expect(directPrint({ documentType: "A4_DOCUMENT", appointmentId: 7 })).resolves.toMatchObject({ success: false, errorCode: "PRINTER_NOT_CONFIGURED" });
    expect(getInstalledPrinters).not.toHaveBeenCalled();
  });

  it("does not route to another queue when the configured printer is missing", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "Removed Queue";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["Other Queue"]);
    await expect(directPrint({ documentType: "A4_DOCUMENT", appointmentId: 7 })).resolves.toMatchObject({ success: false, errorCode: "PRINTER_NOT_FOUND" });
    expect(printPdf).not.toHaveBeenCalled();
  });

  it("rejects an A4 profile with label-sized paper", async () => {
    const settings = createDefaultQzPrinterSettings();
    Object.assign(settings.profiles[0], { printerName: "A4", paperWidthMm: 50, paperHeightMm: 30 });
    saveQzPrinterSettings(settings);
    await expect(directPrint({ documentType: "A4_DOCUMENT", appointmentId: 7 })).resolves.toMatchObject({ success: false, errorCode: "PAGE_SIZE_MISMATCH" });
  });

  it("prevents duplicate in-flight clicks", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "A4";
    saveQzPrinterSettings(settings);
    let release!: (printers: string[]) => void;
    getInstalledPrinters.mockReturnValue(new Promise<string[]>((resolve) => { release = resolve; }));
    const first = directPrint({ documentType: "A4_DOCUMENT", appointmentId: 7 });
    await Promise.resolve();
    await expect(directPrint({ documentType: "A4_DOCUMENT", appointmentId: 7 })).resolves.toMatchObject({ success: false, errorCode: "DUPLICATE_PRINT" });
    release(["A4"]);
    await expect(first).resolves.toMatchObject({ success: true, printerName: "A4" });
  });

  it("maps signing and timeout failures to stable codes", () => {
    expect(mapDirectPrintError(new Error("Unable to sign QZ request"))).toMatchObject({ errorCode: "SIGNATURE_FAILED" });
    expect(mapDirectPrintError(new Error("Print timeout"))).toMatchObject({ errorCode: "PRINT_TIMEOUT" });
    expect(mapDirectPrintError(new Error("QZ Tray is not installed"))).toMatchObject({ errorCode: "QZ_NOT_INSTALLED" });
  });

  it("validates standard page dimensions", () => {
    const profile = createDefaultQzPrinterSettings().profiles[1];
    expect(validateProfilePageSize(profile)).toBe(true);
    expect(validateProfilePageSize({ ...profile, paperWidthMm: 210 })).toBe(false);
  });
});
