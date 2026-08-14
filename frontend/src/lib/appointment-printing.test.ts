import { describe, expect, it, vi, beforeEach } from "vitest";
import { printAccessionLabelById, printAppointmentSlipById, printIrSpecimenLabelById } from "./appointment-printing";

const mockGetAppointmentById = vi.fn();
const mockPrintAppointmentSlip = vi.fn();
const mockPushToast = vi.fn();
const mockDirectPrint = vi.fn();
const mockDirectPrintIrSpecimenLabel = vi.fn();
const mockResolveAppointmentDocumentType = vi.fn();
let mockPrinterSettings: { browserPrintFallbackEnabled: boolean; profiles: Array<{ documentType: string; enabled: boolean }> };

vi.mock("@/lib/api-hooks", () => ({
  getAppointmentById: (...args: unknown[]) => mockGetAppointmentById(...args),
}));

vi.mock("@/lib/print-utils", () => ({
  printAppointmentSlip: (...args: unknown[]) => mockPrintAppointmentSlip(...args),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: (...args: unknown[]) => mockPushToast(...args),
}));

vi.mock("@/services/printing/direct-print-service", () => ({
  directPrint: (...args: unknown[]) => mockDirectPrint(...args),
  directPrintIrSpecimenLabel: (...args: unknown[]) => mockDirectPrintIrSpecimenLabel(...args),
  resolveAppointmentDocumentType: (...args: unknown[]) => mockResolveAppointmentDocumentType(...args),
}));

vi.mock("@/services/printing/workstation-printer-settings", () => ({
  loadQzPrinterSettings: () => mockPrinterSettings,
}));

describe("printAppointmentSlipById", () => {
  beforeEach(() => {
    mockGetAppointmentById.mockReset();
    mockPrintAppointmentSlip.mockReset();
    mockPushToast.mockReset();
    mockDirectPrint.mockReset();
    mockDirectPrintIrSpecimenLabel.mockReset();
    mockResolveAppointmentDocumentType.mockReset();
    mockResolveAppointmentDocumentType.mockResolvedValue("A5_DOCUMENT");
    mockPrinterSettings = { browserPrintFallbackEnabled: true, profiles: [{ documentType: "A5_DOCUMENT", enabled: true }] };
  });

  it.each(["A4_DOCUMENT", "A5_DOCUMENT"])("uses browser printing directly when the %s profile is disabled and fallback is enabled", async (documentType) => {
    const appointment = { id: 42, accessionNumber: "ACC-42" };
    mockGetAppointmentById.mockResolvedValue(appointment);
    mockResolveAppointmentDocumentType.mockResolvedValue(documentType);
    mockPrinterSettings = { browserPrintFallbackEnabled: true, profiles: [{ documentType, enabled: false }] };

    await printAppointmentSlipById(42);

    expect(mockPrintAppointmentSlip).toHaveBeenCalledWith(appointment);
    expect(mockDirectPrint).not.toHaveBeenCalled();
    expect(mockPushToast).not.toHaveBeenCalled();
  });

  it("keeps the settings action when a disabled profile has browser fallback disabled", async () => {
    mockGetAppointmentById.mockResolvedValue({ id: 42, accessionNumber: "ACC-42" });
    mockPrinterSettings = { browserPrintFallbackEnabled: false, profiles: [{ documentType: "A5_DOCUMENT", enabled: false }] };

    await printAppointmentSlipById(42);

    expect(mockPrintAppointmentSlip).not.toHaveBeenCalled();
    expect(mockDirectPrint).not.toHaveBeenCalled();
    expect(mockPushToast.mock.calls[0][0].action.label).toBe("Open Printing settings");
  });

  it("loads the appointment and submits it through direct printing without navigation", async () => {
    mockGetAppointmentById.mockResolvedValue({
      id: 42,
      accessionNumber: "ACC-42",
    });
    mockDirectPrint.mockResolvedValue({ success: true, printerName: "RISPRO-A5", jobName: "test" });

    await printAppointmentSlipById(42);

    expect(mockGetAppointmentById).toHaveBeenCalledWith(42);
    expect(mockDirectPrint).toHaveBeenCalledWith({ documentType: "A5_DOCUMENT", appointmentId: 42, accessionNumber: "ACC-42", appointmentSnapshot: expect.objectContaining({ id: 42 }) });
    expect(mockGetAppointmentById).toHaveBeenCalledTimes(1);
    expect(mockPrintAppointmentSlip).not.toHaveBeenCalled();
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success", message: "Print job sent to RISPRO-A5." }));
  });

  it("offers browser printing only as an explicit action when QZ is unavailable", async () => {
    const appointment = { id: 42, accessionNumber: "ACC-42" };
    mockGetAppointmentById.mockResolvedValue(appointment);
    mockDirectPrint.mockResolvedValue({ success: false, errorCode: "QZ_CONNECTION_FAILED", message: "Direct printing is unavailable because QZ Tray is not connected." });
    await printAppointmentSlipById(42);
    expect(mockPrintAppointmentSlip).not.toHaveBeenCalled();
    const toast = mockPushToast.mock.calls[0][0];
    expect(toast.action.label).toBe("Use browser printing");
    toast.action.onClick();
    expect(mockPrintAppointmentSlip).toHaveBeenCalledWith(appointment);
  });

  it.each([
    ["PRINT_STATUS_UNKNOWN", "The original print request is still being processed. Do not retry or use browser printing yet."],
    ["DUPLICATE_PRINT", "This print job is already being processed."],
  ])("does not offer browser printing for %s", async (errorCode, message) => {
    mockGetAppointmentById.mockResolvedValue({ id: 42, accessionNumber: "ACC-42" });
    mockDirectPrint.mockResolvedValue({ success: false, errorCode, message });
    await printAppointmentSlipById(42);
    expect(mockPrintAppointmentSlip).not.toHaveBeenCalled();
    expect(mockPushToast.mock.calls[0][0]).not.toHaveProperty("action");
  });

  it("opens workstation settings for a label configuration error because labels have no browser fallback", async () => {
    mockGetAppointmentById.mockResolvedValue({ id: 42, accessionNumber: "ACC-42" });
    mockDirectPrint.mockResolvedValue({ success: false, errorCode: "PRINTER_NOT_CONFIGURED", message: "No accession label printer is configured." });

    await printAccessionLabelById(42);

    expect(mockPrintAppointmentSlip).not.toHaveBeenCalled();
    expect(mockPushToast.mock.calls[0][0].action.label).toBe("Open Printing settings");
  });

  it("loads the appointment and sends normalized IR specimen text through the accession label printer", async () => {
    mockGetAppointmentById.mockResolvedValue({ id: 42, accessionNumber: "V2-000042" });
    mockDirectPrintIrSpecimenLabel.mockResolvedValue({ success: true, printerName: "Label Queue", jobName: "test" });
    await printIrSpecimenLabelById(42, "Liver\n lesion  biopsy");
    expect(mockGetAppointmentById).toHaveBeenCalledWith(42);
    expect(mockDirectPrintIrSpecimenLabel).toHaveBeenCalledWith(42, "V2-000042", "Liver lesion biopsy");
  });

  it("uses the existing printing-settings failure action for an IR specimen label printer error", async () => {
    mockGetAppointmentById.mockResolvedValue({ id: 42, accessionNumber: "V2-000042" });
    mockDirectPrintIrSpecimenLabel.mockResolvedValue({ success: false, errorCode: "PRINTER_NOT_CONFIGURED", message: "No label printer." });
    await printIrSpecimenLabelById(42, "Liver");
    expect(mockPushToast.mock.calls[0][0].action.label).toBe("Open Printing settings");
  });

  it("shows a small toast when the appointment cannot be loaded", async () => {
    mockGetAppointmentById.mockRejectedValue(new Error("Network down"));

    await printAppointmentSlipById(42, "ar");

    expect(mockGetAppointmentById).toHaveBeenCalledWith(42);
    expect(mockPrintAppointmentSlip).not.toHaveBeenCalled();
    expect(mockPushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "فشلت الطباعة",
      }),
    );
  });
});
