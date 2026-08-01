import { describe, expect, it, vi, beforeEach } from "vitest";
import { printAppointmentSlipById } from "./appointment-printing";

const mockGetAppointmentById = vi.fn();
const mockPrintAppointmentSlip = vi.fn();
const mockPushToast = vi.fn();
const mockDirectPrint = vi.fn();
const mockResolveAppointmentDocumentType = vi.fn();

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
  resolveAppointmentDocumentType: (...args: unknown[]) => mockResolveAppointmentDocumentType(...args),
}));

vi.mock("@/services/printing/workstation-printer-settings", () => ({
  loadQzPrinterSettings: () => ({ browserPrintFallbackEnabled: true }),
}));

describe("printAppointmentSlipById", () => {
  beforeEach(() => {
    mockGetAppointmentById.mockReset();
    mockPrintAppointmentSlip.mockReset();
    mockPushToast.mockReset();
    mockDirectPrint.mockReset();
    mockResolveAppointmentDocumentType.mockReset();
    mockResolveAppointmentDocumentType.mockResolvedValue("A5_DOCUMENT");
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
