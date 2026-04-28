import { describe, expect, it, vi, beforeEach } from "vitest";
import { printAppointmentSlipById } from "./appointment-printing";

const mockGetAppointmentById = vi.fn();
const mockPrintAppointmentSlip = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  getAppointmentById: (...args: unknown[]) => mockGetAppointmentById(...args),
}));

vi.mock("@/lib/print-utils", () => ({
  printAppointmentSlip: (...args: unknown[]) => mockPrintAppointmentSlip(...args),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: (...args: unknown[]) => mockPushToast(...args),
}));

describe("printAppointmentSlipById", () => {
  beforeEach(() => {
    mockGetAppointmentById.mockReset();
    mockPrintAppointmentSlip.mockReset();
    mockPushToast.mockReset();
  });

  it("loads the appointment and prints it without navigation", async () => {
    mockGetAppointmentById.mockResolvedValue({
      id: 42,
      accessionNumber: "ACC-42",
    });

    await printAppointmentSlipById(42);

    expect(mockGetAppointmentById).toHaveBeenCalledWith(42);
    expect(mockPrintAppointmentSlip).toHaveBeenCalledTimes(1);
    expect(mockPrintAppointmentSlip).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, accessionNumber: "ACC-42" })
    );
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
