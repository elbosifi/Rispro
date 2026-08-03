import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECT_PRINT_TIMEOUTS, DirectPrintError, directPrint, directTestPrint, getDirectPrintJobState, mapDirectPrintError, validateProfilePageSize } from "./direct-print-service";
import { createDefaultQzPrinterSettings, loadQzPrinterSettings, saveQzPrinterSettings } from "./workstation-printer-settings";

const getInstalledPrinters = vi.fn();
const printPdf = vi.fn();
const createAppointmentSlipPdfBlob = vi.fn();
const createAccessionLabelPdfBlob = vi.fn();
const connectQzTray = vi.fn();
const auditApi = vi.fn();

vi.mock("./qz-tray-service", () => ({
  QzTrayError: class QzTrayError extends Error { constructor(public code: string, message: string) { super(message); } },
  connectQzTray: (...args: unknown[]) => connectQzTray(...args),
  getInstalledPrinters: (...args: unknown[]) => getInstalledPrinters(...args),
  printPdf: (...args: unknown[]) => printPdf(...args),
}));
vi.mock("@/lib/api-client", () => ({ api: (...args: unknown[]) => auditApi(...args) }));
vi.mock("@/lib/api-hooks", () => ({
  getAppointmentById: vi.fn().mockResolvedValue({ id: 7, accessionNumber: "ACC-7" }),
  fetchAppointmentSlipSettings: vi.fn().mockResolvedValue({ paperSize: "a4" }),
}));
vi.mock("@/lib/print-utils", () => ({ createAppointmentSlipPdfBlob: (...args: unknown[]) => createAppointmentSlipPdfBlob(...args) }));
vi.mock("@/lib/accession-label-printing", () => ({ createAccessionLabelPdfBlob: (...args: unknown[]) => createAccessionLabelPdfBlob(...args) }));

const pdf = () => new Blob([new TextEncoder().encode("%PDF-1.4 test")], { type: "application/pdf" });

describe("direct print service", () => {
  beforeEach(() => {
    localStorage.clear();
    getInstalledPrinters.mockReset();
    printPdf.mockReset();
    printPdf.mockResolvedValue(undefined);
    createAppointmentSlipPdfBlob.mockReset();
    createAppointmentSlipPdfBlob.mockResolvedValue(pdf());
    createAccessionLabelPdfBlob.mockReset();
    createAccessionLabelPdfBlob.mockResolvedValue(pdf());
    connectQzTray.mockReset();
    connectQzTray.mockResolvedValue(undefined);
    auditApi.mockReset();
    auditApi.mockResolvedValue({ ok: true });
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

  it("connects and prints a persisted accession label without the settings page mounting", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")!.printerName = "RISPRO Label Queue";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["RISPRO Label Queue"]);

    await expect(directPrint({ documentType: "ACCESSION_LABEL", appointmentId: 7, accessionNumber: "ACC-7" })).resolves.toMatchObject({
      success: true,
      printerName: "RISPRO Label Queue",
    });
    expect(connectQzTray).toHaveBeenCalledTimes(1);
    expect(connectQzTray).toHaveBeenCalledBefore(getInstalledPrinters);
    expect(printPdf).toHaveBeenCalledTimes(1);
  });

  it("rejects an A4 profile with label-sized paper", async () => {
    const settings = createDefaultQzPrinterSettings();
    expect(validateProfilePageSize({ ...settings.profiles[0], printerName: "A4", paperWidthMm: 50, paperHeightMm: 30 })).toBe(false);
    Object.assign(settings.profiles[0], { printerName: "A4", paperWidthMm: 50, paperHeightMm: 30 });
    saveQzPrinterSettings(settings);
    expect(loadQzPrinterSettings().profiles[0]).toMatchObject({ paperWidthMm: 210, paperHeightMm: 297 });
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

  it("maps typed service failures without unsafe substring guessing", () => {
    expect(mapDirectPrintError(new DirectPrintError("SIGNATURE_FAILED", "Signing rejected"))).toMatchObject({ errorCode: "SIGNATURE_FAILED" });
    expect(mapDirectPrintError(new Error("document connect sign"))).toMatchObject({ errorCode: "PRINT_FAILED" });
  });

  it("keeps a timed-out submission locked until the underlying QZ promise settles", async () => {
    vi.useFakeTimers();
    const previous = DIRECT_PRINT_TIMEOUTS.submissionStatusMs;
    DIRECT_PRINT_TIMEOUTS.submissionStatusMs = 20;
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "A4";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["A4"]);
    let release!: () => void;
    printPdf.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const request = { documentType: "A4_DOCUMENT" as const, appointmentId: 7 };
    const first = directPrint(request);
    await vi.advanceTimersByTimeAsync(21);
    await expect(first).resolves.toMatchObject({ success: false, errorCode: "PRINT_STATUS_UNKNOWN" });
    expect(getDirectPrintJobState(request)).toBe("status_unknown");
    await expect(directPrint(request)).resolves.toMatchObject({ errorCode: "DUPLICATE_PRINT" });
    release();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(getDirectPrintJobState(request)).toBeUndefined();
    printPdf.mockResolvedValue(undefined);
    await expect(directPrint(request)).resolves.toMatchObject({ success: true, printerName: "A4" });
    DIRECT_PRINT_TIMEOUTS.submissionStatusMs = previous;
    vi.useRealTimers();
  });

  it("releases the duplicate lock after a normal submission failure", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "A4";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["A4"]);
    printPdf.mockRejectedValueOnce(new DirectPrintError("PRINT_FAILED", "Queue rejected the job"));
    const request = { documentType: "A4_DOCUMENT" as const, appointmentId: 7 };
    await expect(directPrint(request)).resolves.toMatchObject({ success: false, errorCode: "PRINT_FAILED" });
    expect(getDirectPrintJobState(request)).toBeUndefined();
    await expect(directPrint(request)).resolves.toMatchObject({ success: true, printerName: "A4" });
  });

  it("times out printer discovery, releases the job lock, prevents submission, and allows retry", async () => {
    vi.useFakeTimers();
    const previous = DIRECT_PRINT_TIMEOUTS.discoveryMs;
    DIRECT_PRINT_TIMEOUTS.discoveryMs = 20;
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "A4";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockReturnValueOnce(new Promise<string[]>(() => undefined)).mockResolvedValueOnce(["A4"]);
    const request = { documentType: "A4_DOCUMENT" as const, appointmentId: 7 };

    const first = directPrint(request);
    await vi.advanceTimersByTimeAsync(21);
    await expect(first).resolves.toMatchObject({ success: false, errorCode: "PRINTER_DISCOVERY_FAILED" });
    expect(getDirectPrintJobState(request)).toBeUndefined();
    expect(printPdf).not.toHaveBeenCalled();
    await expect(directPrint(request)).resolves.toMatchObject({ success: true, printerName: "A4" });

    DIRECT_PRINT_TIMEOUTS.discoveryMs = previous;
    vi.useRealTimers();
  });

  it("applies the same discovery timeout to test prints", async () => {
    vi.useFakeTimers();
    const previous = DIRECT_PRINT_TIMEOUTS.discoveryMs;
    DIRECT_PRINT_TIMEOUTS.discoveryMs = 20;
    const profile = { ...createDefaultQzPrinterSettings().profiles[2], printerName: "Label Queue" };
    getInstalledPrinters.mockReturnValue(new Promise<string[]>(() => undefined));

    const result = directTestPrint(profile);
    await vi.advanceTimersByTimeAsync(21);
    await expect(result).resolves.toMatchObject({ success: false, errorCode: "PRINTER_DISCOVERY_FAILED" });
    expect(printPdf).not.toHaveBeenCalled();

    DIRECT_PRINT_TIMEOUTS.discoveryMs = previous;
    vi.useRealTimers();
  });

  it("validates standard page dimensions", () => {
    const profile = createDefaultQzPrinterSettings().profiles[1];
    expect(validateProfilePageSize(profile)).toBe(true);
    expect(validateProfilePageSize({ ...profile, paperWidthMm: 210 })).toBe(false);
    expect(validateProfilePageSize({ ...profile, orientation: "landscape" })).toBe(false);
    const label = createDefaultQzPrinterSettings().profiles[2];
    expect(validateProfilePageSize({ ...label, orientation: "portrait" })).toBe(false);
  });

  it("routes a PDF test print through validation, installed-printer checking, and audit", async () => {
    const profile = { ...createDefaultQzPrinterSettings().profiles[2], printerName: "Label Queue" };
    getInstalledPrinters.mockResolvedValue(["Label Queue"]);
    await expect(directTestPrint(profile)).resolves.toMatchObject({ success: true, printerName: "Label Queue", jobName: "RISpro printer test - ACCESSION_LABEL" });
    expect(printPdf).toHaveBeenCalledWith(expect.objectContaining({ paperWidthMm: 50, paperHeightMm: 30, customPaperSize: true }), expect.any(String), expect.objectContaining({ jobName: "RISpro printer test - ACCESSION_LABEL" }));
    const auditBody = JSON.parse(auditApi.mock.calls[0][1].body);
    expect(auditBody).toMatchObject({ documentType: "ACCESSION_LABEL", outcome: "submitted", testPrint: true, printerName: "Label Queue" });
  });

  it("rejects a test print when its exact printer queue is not installed", async () => {
    const profile = { ...createDefaultQzPrinterSettings().profiles[0], printerName: "Missing Queue" };
    getInstalledPrinters.mockResolvedValue(["Other Queue"]);
    await expect(directTestPrint(profile)).resolves.toMatchObject({ success: false, errorCode: "PRINTER_NOT_FOUND" });
    expect(printPdf).not.toHaveBeenCalled();
  });

  it("keeps a timed-out test print locked until QZ settles", async () => {
    vi.useFakeTimers();
    const previous = DIRECT_PRINT_TIMEOUTS.submissionStatusMs;
    DIRECT_PRINT_TIMEOUTS.submissionStatusMs = 20;
    const profile = { ...createDefaultQzPrinterSettings().profiles[0], printerName: "A4" };
    getInstalledPrinters.mockResolvedValue(["A4"]);
    let release!: () => void;
    printPdf.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const first = directTestPrint(profile);
    await vi.advanceTimersByTimeAsync(21);
    await expect(first).resolves.toMatchObject({ success: false, errorCode: "PRINT_STATUS_UNKNOWN" });
    await expect(directTestPrint(profile)).resolves.toMatchObject({ success: false, errorCode: "DUPLICATE_PRINT" });
    release();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    printPdf.mockResolvedValue(undefined);
    await expect(directTestPrint(profile)).resolves.toMatchObject({ success: true });
    DIRECT_PRINT_TIMEOUTS.submissionStatusMs = previous;
    vi.useRealTimers();
  });
});
