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
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en" }) }));

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
    expect(screen.getByText("Select the normal Windows queue configured for A4 Portrait.")).toBeTruthy();
    expect(screen.getByText("Select a Windows printer queue configured with A4 paper and Landscape as its default orientation. You can create a second Windows queue for the same physical printer.")).toBeTruthy();
    expect((screen.getAllByRole("checkbox", { name: "Enabled" }) as HTMLInputElement[]).every((checkbox) => !checkbox.checked)).toBe(true);
    await waitFor(() => expect((screen.getByRole("button", { name: /Refresh printers/i }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("checkbox", { name: /Allow browser-print fallback/i }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Reset local printer settings" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not block test printing solely because the origin is HTTP", async () => {
    setSecureContext(false);
    mockSettings = {
      ...mockSettings,
      profiles: mockSettings.profiles.map((profile, index) => index === 0 ? { ...profile, printerName: "RISPRO A4", enabled: true } : profile),
    };

    render(<QzTrayPrintingSection />);

    const testButtons = screen.getAllByRole("button", { name: /Test print/i }) as HTMLButtonElement[];
    const enabledTestButton = testButtons.find((button) => !button.disabled);
    expect(enabledTestButton).toBeTruthy();
    fireEvent.click(enabledTestButton!);
    await waitFor(() => expect(mockDirectTestPrint).toHaveBeenCalledWith(expect.objectContaining({ printerName: "RISPRO A4" })));
  });

  it("saves accession-label printer compensation margins without changing its other print settings", async () => {
    const original = mockSettings.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")!;
    render(<QzTrayPrintingSection />);
    await waitFor(() => expect(mockConnectQzTray).toHaveBeenCalledTimes(1));

    expect((screen.getByLabelText("Accession label top margin") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Accession label right margin") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Accession label bottom margin") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Accession label left margin") as HTMLInputElement).value).toBe("0");

    fireEvent.change(screen.getByLabelText("Accession label left margin"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Accession label top margin"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(mockSaveQzPrinterSettings).toHaveBeenCalledWith(expect.objectContaining({
      profiles: expect.arrayContaining([expect.objectContaining({
        documentType: "ACCESSION_LABEL",
        marginsMm: { top: 1.5, right: 0, bottom: 0, left: 4 },
        paperWidthMm: original.paperWidthMm,
        paperHeightMm: original.paperHeightMm,
        orientation: original.orientation,
        scaleContent: original.scaleContent,
        rasterize: original.rasterize,
      })]),
    }));
  });

  it("clamps an out-of-range accession-label margin before saving", async () => {
    render(<QzTrayPrintingSection />);
    await waitFor(() => expect(mockConnectQzTray).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Accession label right margin"), { target: { value: "49" } });
    fireEvent.change(screen.getByLabelText("Accession label left margin"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(mockSaveQzPrinterSettings).toHaveBeenCalledWith(expect.objectContaining({
      profiles: expect.arrayContaining([expect.objectContaining({
        documentType: "ACCESSION_LABEL",
        marginsMm: { top: 0, right: 49, bottom: 0, left: 0.99 },
      })]),
    }));
  });
});
