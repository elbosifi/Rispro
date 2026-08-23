import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECT_PRINT_TIMEOUTS, DirectPrintError, directPrint, directPrintIrSpecimenLabel, directPrintRegistrationList, directPrintReportCenter, directPrintStatistics, directTestPrint, getDirectPrintJobState, mapDirectPrintError, validateProfilePageSize } from "./direct-print-service";
import { createDefaultQzPrinterSettings as createStoredQzPrinterSettings, loadQzPrinterSettings, saveQzPrinterSettings } from "./workstation-printer-settings";
import { getGlobalPrintStatus, resetGlobalPrintStatusForTests, subscribeToGlobalPrintStatus } from "./global-print-status";

const getInstalledPrinters = vi.fn();
const printPdf = vi.fn();
const connectQzTray = vi.fn();
const auditApi = vi.fn();
const appointmentSlipFetch = vi.fn();
const fetchAppointmentSlipSettings = vi.fn();

function createDefaultQzPrinterSettings() {
  const settings = createStoredQzPrinterSettings();
  settings.profiles.forEach((profile) => { profile.enabled = true; });
  return settings;
}

vi.mock("./qz-tray-service", () => ({
  QzTrayError: class QzTrayError extends Error { constructor(public code: string, message: string) { super(message); } },
  connectQzTray: (...args: unknown[]) => connectQzTray(...args),
  getInstalledPrinters: (...args: unknown[]) => getInstalledPrinters(...args),
  printPdf: (...args: unknown[]) => printPdf(...args),
}));
vi.mock("@/lib/api-client", () => ({ api: (...args: unknown[]) => auditApi(...args) }));
vi.mock("@/lib/api-hooks", () => ({
  fetchAppointmentSlipSettings: (...args: unknown[]) => fetchAppointmentSlipSettings(...args),
}));

describe("direct print service", () => {
  beforeEach(() => {
    resetGlobalPrintStatusForTests();
    localStorage.clear();
    getInstalledPrinters.mockReset();
    printPdf.mockReset();
    printPdf.mockResolvedValue(undefined);
    appointmentSlipFetch.mockReset();
    appointmentSlipFetch.mockImplementation(() => Promise.resolve(new Response("%PDF-1.4 test", { status: 200, headers: { "content-type": "application/pdf" } })));
    fetchAppointmentSlipSettings.mockReset();
    fetchAppointmentSlipSettings.mockResolvedValue({ paperSize: "a4" });
    vi.stubGlobal("fetch", appointmentSlipFetch);
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
    expect(appointmentSlipFetch).toHaveBeenCalledWith("/api/printing/accession-label/7/pdf?widthMm=50&heightMm=30", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  });

  it("prints an IR specimen label through the existing accession-label profile and records normalized audit metadata", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")!.printerName = "RISPRO Label Queue";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["RISPRO Label Queue"]);

    await expect(directPrintIrSpecimenLabel(7, "V2-000007", "Liver\n lesion  biopsy")).resolves.toMatchObject({ success: true, printerName: "RISPRO Label Queue" });
    expect(appointmentSlipFetch).toHaveBeenCalledWith("/api/printing/ir-specimen-label/7/pdf", expect.objectContaining({ method: "POST", body: JSON.stringify({ specimenText: "Liver lesion biopsy", widthMm: 50, heightMm: 30 }) }));
    expect(printPdf).toHaveBeenCalledWith(expect.objectContaining({ documentType: "ACCESSION_LABEL" }), expect.any(String), expect.objectContaining({ jobName: "RISpro IR specimen label - V2-000007" }));
    expect(auditApi).toHaveBeenCalledWith("/printing/audit", expect.objectContaining({ body: expect.stringContaining('"printPurpose":"ir_specimen"') }));
    expect(auditApi.mock.calls[0][1].body).toContain('"specimenText":"Liver lesion biopsy"');
  });

  it("keeps duplicate protection active for IR specimen labels", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")!.printerName = "RISPRO Label Queue";
    saveQzPrinterSettings(settings);
    let release!: (printers: string[]) => void;
    getInstalledPrinters.mockReturnValue(new Promise<string[]>((resolve) => { release = resolve; }));
    const first = directPrintIrSpecimenLabel(7, "V2-000007", "Liver");
    await Promise.resolve();
    await expect(directPrintIrSpecimenLabel(7, "V2-000007", "Liver")).resolves.toMatchObject({ success: false, errorCode: "DUPLICATE_PRINT" });
    release(["RISPRO Label Queue"]);
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it("publishes the direct-print lifecycle", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "A4";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["A4"]);
    const states: string[] = [];
    const unsubscribe = subscribeToGlobalPrintStatus(() => states.push(getGlobalPrintStatus().state));

    await expect(directPrint({ documentType: "A4_DOCUMENT", appointmentId: 7 })).resolves.toMatchObject({ success: true });
    unsubscribe();
    expect(states).toEqual(expect.arrayContaining(["preparing", "submitting", "submitted"]));
  });

  it("fetches the backend Chromium PDF for appointment slips and never calls the former jsPDF renderer", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "A4";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["A4"]);

    await expect(directPrint({ documentType: "A4_DOCUMENT", appointmentId: 7 })).resolves.toMatchObject({ success: true, printerName: "A4" });
    expect(appointmentSlipFetch).toHaveBeenCalledWith("/api/printing/appointment-slip/7/pdf", expect.objectContaining({ credentials: "include", cache: "no-store" }));
    expect(printPdf).toHaveBeenCalledTimes(1);
  });

  it("prints a registration list through the physical A4 landscape profile without a job override", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles.find((profile) => profile.documentType === "A4_LANDSCAPE_DOCUMENT")!.printerName = "A4 Landscape";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["A4 Landscape"]);
    await expect(directPrintRegistrationList([7, 9], "Current filters")).resolves.toMatchObject({ success: true, printerName: "A4 Landscape" });
    expect(appointmentSlipFetch).toHaveBeenCalledWith("/api/printing/registration-list/pdf", expect.objectContaining({ method: "POST", body: JSON.stringify({ appointmentIds: [7, 9], label: "Current filters" }) }));
    expect(printPdf).toHaveBeenCalledWith(expect.objectContaining({ documentType: "A4_LANDSCAPE_DOCUMENT", paperWidthMm: 297, paperHeightMm: 210, orientation: "landscape", customPaperSize: false }), expect.any(String), expect.objectContaining({ copies: 1, jobName: "RISpro registration list", preservePdfPageGeometry: true }));
  });

  it("fetches the backend Chromium PDF for A5 appointment slips", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles.find((profile) => profile.documentType === "A5_DOCUMENT")!.printerName = "A5";
    saveQzPrinterSettings(settings);
    fetchAppointmentSlipSettings.mockResolvedValue({ paperSize: "a5" });
    getInstalledPrinters.mockResolvedValue(["A5"]);

    await expect(directPrint({ documentType: "A5_DOCUMENT", appointmentId: 7 })).resolves.toMatchObject({ success: true, printerName: "A5" });
    expect(appointmentSlipFetch).toHaveBeenCalledWith("/api/printing/appointment-slip/7/pdf", expect.objectContaining({ credentials: "include", cache: "no-store" }));
  });

  it.each([
    ["portrait", "A4_DOCUMENT", "Portrait Queue"],
    ["landscape", "A4_LANDSCAPE_DOCUMENT", "Landscape Queue"],
  ] as const)("routes a finalized Report Center %s PDF through the matching A4 profile", async (orientation, documentType, printerName) => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles.find((profile) => profile.documentType === documentType)!.printerName = printerName;
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue([printerName]);
    const model = { templateId: "daily-appointments", source: "appointments" as const, orientation, title: "Daily appointments", dateLabel: "2026-08-07", columns: [{ key: "patient", label: "Patient" }], rows: [{ patient: "One" }], summaryRows: [] };
    await expect(directPrintReportCenter(model)).resolves.toMatchObject({ success: true, printerName });
    expect(appointmentSlipFetch).toHaveBeenCalledWith("/api/printing/report-center/pdf", expect.objectContaining({ method: "POST", body: JSON.stringify(model) }));
    expect(printPdf).toHaveBeenCalledTimes(1);
    expect(printPdf).toHaveBeenCalledWith(expect.objectContaining({ documentType }), expect.any(String), expect.objectContaining({ preservePdfPageGeometry: true }));
  });

  it("routes one finalized Statistics PDF through the A4 landscape profile", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles.find((profile) => profile.documentType === "A4_LANDSCAPE_DOCUMENT")!.printerName = "Landscape Queue";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["Landscape Queue"]);
    const model = { dateFrom: "2026-08-01", dateTo: "2026-08-07", modalityLabel: "All", summary: [], operational: [], statusBreakdown: [], modalityBreakdown: [], dailyBreakdown: [] };
    await expect(directPrintStatistics(model)).resolves.toMatchObject({ success: true, printerName: "Landscape Queue" });
    expect(appointmentSlipFetch).toHaveBeenCalledWith("/api/printing/statistics/pdf", expect.objectContaining({ method: "POST", body: JSON.stringify(model) }));
    expect(printPdf).toHaveBeenCalledTimes(1);
    expect(printPdf).toHaveBeenCalledWith(expect.objectContaining({ documentType: "A4_LANDSCAPE_DOCUMENT" }), expect.any(String), expect.objectContaining({ preservePdfPageGeometry: true }));
  });

  it("keeps stored PDFs on their original document endpoint", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "A4";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["A4"]);

    await expect(directPrint({ documentType: "A4_DOCUMENT", documentId: "55" })).resolves.toMatchObject({ success: true, printerName: "A4" });
    expect(appointmentSlipFetch).toHaveBeenCalledWith("/api/documents/55/view", expect.objectContaining({ credentials: "include", cache: "no-store" }));
    expect(appointmentSlipFetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/printing/appointment-slip/"), expect.anything());
  });

  it("maps a Chromium endpoint failure to the existing clear generation failure and preserves explicit browser fallback", async () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "A4";
    saveQzPrinterSettings(settings);
    getInstalledPrinters.mockResolvedValue(["A4"]);
    appointmentSlipFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "APPOINTMENT_SLIP_RENDER_FAILED" } }), { status: 502, headers: { "content-type": "application/json" } }));

    await expect(directPrint({ documentType: "A4_DOCUMENT", appointmentId: 7 })).resolves.toMatchObject({ success: false, errorCode: "DOCUMENT_GENERATION_FAILED" });
    expect(printPdf).not.toHaveBeenCalled();
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
    const states: string[] = [];
    const unsubscribe = subscribeToGlobalPrintStatus(() => states.push(getGlobalPrintStatus().state));
    const first = directPrint(request);
    await vi.advanceTimersByTimeAsync(21);
    await expect(first).resolves.toMatchObject({ success: false, errorCode: "PRINT_STATUS_UNKNOWN" });
    expect(getDirectPrintJobState(request)).toBe("status_unknown");
    expect(getGlobalPrintStatus()).toMatchObject({ state: "status_unknown", printerName: "A4" });
    await expect(directPrint(request)).resolves.toMatchObject({ errorCode: "DUPLICATE_PRINT" });
    release();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(getDirectPrintJobState(request)).toBeUndefined();
    expect(states).toContain("submitted");
    unsubscribe();
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
    expect(getGlobalPrintStatus()).toMatchObject({ state: "failed", printerName: "A4" });
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
    const profile = { ...createDefaultQzPrinterSettings().profiles[3], printerName: "Label Queue" };
    getInstalledPrinters.mockReturnValue(new Promise<string[]>(() => undefined));

    const result = directTestPrint(profile);
    await vi.advanceTimersByTimeAsync(21);
    await expect(result).resolves.toMatchObject({ success: false, errorCode: "PRINTER_DISCOVERY_FAILED" });
    expect(printPdf).not.toHaveBeenCalled();

    DIRECT_PRINT_TIMEOUTS.discoveryMs = previous;
    vi.useRealTimers();
  });

  it("validates standard page dimensions", () => {
    const profile = createDefaultQzPrinterSettings().profiles.find((candidate) => candidate.documentType === "A5_DOCUMENT")!;
    expect(validateProfilePageSize(profile)).toBe(true);
    expect(validateProfilePageSize({ ...profile, paperWidthMm: 210 })).toBe(false);
    expect(validateProfilePageSize({ ...profile, orientation: "landscape" })).toBe(false);
    const label = createDefaultQzPrinterSettings().profiles[3];
    expect(validateProfilePageSize({ ...label, orientation: "portrait" })).toBe(false);
  });

  it("routes a PDF test print through validation, installed-printer checking, and audit", async () => {
    const profile = { ...createDefaultQzPrinterSettings().profiles[3], printerName: "Label Queue" };
    getInstalledPrinters.mockResolvedValue(["Label Queue"]);
    await expect(directTestPrint(profile)).resolves.toMatchObject({ success: true, printerName: "Label Queue", jobName: "RISpro printer test - ACCESSION_LABEL" });
    expect(printPdf).toHaveBeenCalledWith(expect.objectContaining({ paperWidthMm: 50, paperHeightMm: 30, customPaperSize: true }), expect.any(String), expect.not.objectContaining({ preservePdfPageGeometry: true }));
    const auditBody = JSON.parse(auditApi.mock.calls[0][1].body);
    expect(auditBody).toMatchObject({ documentType: "ACCESSION_LABEL", outcome: "submitted", testPrint: true, printerName: "Label Queue" });
  });

  it("routes an A4 landscape printer test with physical dimensions and test-print audit semantics", async () => {
    const profile = { ...createDefaultQzPrinterSettings().profiles[1], printerName: "Landscape Queue" };
    getInstalledPrinters.mockResolvedValue(["Landscape Queue"]);
    await expect(directTestPrint(profile)).resolves.toMatchObject({ success: true, printerName: "Landscape Queue" });
    const request = appointmentSlipFetch.mock.calls.find(([url]) => url === "/api/printing/printer-test/pdf");
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ documentType: "A4_LANDSCAPE_DOCUMENT", paperWidthMm: 297, paperHeightMm: 210, orientation: "landscape", customPaperSize: false });
    expect(JSON.parse(auditApi.mock.calls[0][1].body)).toMatchObject({ documentType: "A4_LANDSCAPE_DOCUMENT", paperWidthMm: 297, paperHeightMm: 210, testPrint: true });
    expect(printPdf).toHaveBeenCalledWith(expect.any(Object), expect.any(String), expect.objectContaining({ preservePdfPageGeometry: true }));
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
