import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QzTrayPrintingSection from "./qz-tray-printing-section";
import { createDefaultQzPrinterSettings } from "@/services/printing/workstation-printer-settings";

const mockConnectQzTray = vi.fn();
const mockGetInstalledPrinters = vi.fn();
const mockIsQzConnected = vi.fn();
const mockSaveQzPrinterSettings = vi.fn();
const mockPushToast = vi.fn();
const mockDirectTestPrint = vi.fn();
let mockSettings = createDefaultQzPrinterSettings();

vi.mock("@/services/printing/qz-tray-service", () => ({
  connectQzTray: (...args: unknown[]) => mockConnectQzTray(...args),
  getInstalledPrinters: (...args: unknown[]) => mockGetInstalledPrinters(...args),
  isQzConnected: (...args: unknown[]) => mockIsQzConnected(...args),
}));

vi.mock("@/services/printing/direct-print-service", () => ({
  directTestPrint: (...args: unknown[]) => mockDirectTestPrint(...args),
}));

vi.mock("@/services/printing/workstation-printer-settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/printing/workstation-printer-settings")>();
  return {
    ...original,
    loadQzPrinterSettings: () => mockSettings,
    saveQzPrinterSettings: (...args: unknown[]) => mockSaveQzPrinterSettings(...args),
  };
});

vi.mock("@/lib/toast", () => ({ pushToast: (...args: unknown[]) => mockPushToast(...args) }));

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
}

describe("QzTrayPrintingSection", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSettings = createDefaultQzPrinterSettings();
    mockConnectQzTray.mockReset().mockResolvedValue(undefined);
    mockGetInstalledPrinters.mockReset().mockResolvedValue(["RISPRO A4"]);
    mockIsQzConnected.mockReset().mockReturnValue(false);
    mockSaveQzPrinterSettings.mockReset().mockImplementation((settings) => settings);
    mockPushToast.mockReset();
    mockDirectTestPrint.mockReset().mockResolvedValue({ success: true, printerName: "RISPRO A4" });
  });

  afterEach(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: undefined });
  });

  it("connects, enables refresh, and populates printers on an HTTP origin", async () => {
    setSecureContext(false);

    render(<QzTrayPrintingSection />);

    await waitFor(() => expect(mockConnectQzTray).toHaveBeenCalledTimes(1));
    expect(mockGetInstalledPrinters).toHaveBeenCalledTimes(1);
    expect((await screen.findAllByRole("option", { name: "RISPRO A4" })).length).toBe(5);
    expect(screen.getByRole("heading", { name: "A4 Portrait" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "A4 Landscape" })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: /Refresh printers/i }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("checkbox", { name: /Allow browser-print fallback/i }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Reset local printer settings" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not block test printing solely because the origin is HTTP", async () => {
    setSecureContext(false);
    mockSettings = {
      ...mockSettings,
      profiles: mockSettings.profiles.map((profile, index) => index === 0 ? { ...profile, printerName: "RISPRO A4" } : profile),
    };

    render(<QzTrayPrintingSection />);

    const testButtons = screen.getAllByRole("button", { name: /Test print/i }) as HTMLButtonElement[];
    const enabledTestButton = testButtons.find((button) => !button.disabled);
    expect(enabledTestButton).toBeTruthy();
    fireEvent.click(enabledTestButton!);
    await waitFor(() => expect(mockDirectTestPrint).toHaveBeenCalledWith(expect.objectContaining({ printerName: "RISPRO A4" })));
  });
});
