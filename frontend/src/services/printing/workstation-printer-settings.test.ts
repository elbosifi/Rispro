import { beforeEach, describe, expect, it, vi } from "vitest";
import { QZ_PRINTER_SETTINGS_KEY, createDefaultQzPrinterSettings, loadQzPrinterSettings, resolvePrinterProfile, saveQzPrinterSettings } from "./workstation-printer-settings";

describe("workstation printer settings", () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001"); });

  it("creates all required document-type profiles with physical defaults", () => {
    const settings = createDefaultQzPrinterSettings();
    expect(settings.profiles.map((profile) => profile.documentType)).toEqual(["A4_DOCUMENT", "A5_DOCUMENT", "ACCESSION_LABEL", "RECEIPT"]);
    expect(resolvePrinterProfile("A4_DOCUMENT", settings)).toMatchObject({ paperWidthMm: 210, paperHeightMm: 297 });
    expect(resolvePrinterProfile("ACCESSION_LABEL", settings)).toMatchObject({ paperWidthMm: 50, paperHeightMm: 30 });
  });

  it("persists exact queue names per browser workstation", () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "RISPRO A4 Queue";
    saveQzPrinterSettings(settings);
    expect(JSON.parse(localStorage.getItem(QZ_PRINTER_SETTINGS_KEY) || "{}").workstationId).toBe("00000000-0000-4000-8000-000000000001");
    expect(loadQzPrinterSettings().profiles[0].printerName).toBe("RISPRO A4 Queue");
  });
});

