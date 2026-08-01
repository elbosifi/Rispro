import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QzTrayPrintingSection from "./qz-tray-printing-section";
import { createDefaultQzPrinterSettings } from "@/services/printing/workstation-printer-settings";

const mockConnectQzTray = vi.fn();
const mockGetInstalledPrinters = vi.fn();
const mockIsQzConnected = vi.fn();
const mockSaveQzPrinterSettings = vi.fn();
const mockPushToast = vi.fn();
let mockSettings = createDefaultQzPrinterSettings();

vi.mock("@/services/printing/qz-tray-service", () => ({
  connectQzTray: (...args: unknown[]) => mockConnectQzTray(...args),
  getInstalledPrinters: (...args: unknown[]) => mockGetInstalledPrinters(...args),
  isQzConnected: (...args: unknown[]) => mockIsQzConnected(...args),
}));

vi.mock("@/services/printing/direct-print-service", () => ({
  directTestPrint: vi.fn(),
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
  });

  afterEach(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: undefined });
  });

  it("renders controls without connecting to QZ on an insecure origin", () => {
    setSecureContext(false);

    render(<QzTrayPrintingSection />);

    expect(screen.getByRole("alert").textContent).toContain("QZ direct printing requires RISpro to be opened through HTTPS. Browser printing remains available on this address.");
    expect(mockConnectQzTray).not.toHaveBeenCalled();
    expect(mockGetInstalledPrinters).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Refresh printers/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: /Test print/i }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Allow browser-print fallback/i }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Reset local printer settings" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps secure-context printer refresh behavior", async () => {
    setSecureContext(true);

    render(<QzTrayPrintingSection />);

    await waitFor(() => expect(mockConnectQzTray).toHaveBeenCalledTimes(1));
    expect(mockGetInstalledPrinters).toHaveBeenCalledTimes(1);
    expect((await screen.findAllByRole("option", { name: "RISPRO A4" })).length).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(mockSaveQzPrinterSettings).toHaveBeenCalled();
  });
});
