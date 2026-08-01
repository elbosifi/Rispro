import { beforeEach, describe, expect, it, vi } from "vitest";
import { QZ_PRINTER_SETTINGS_KEY, clearUnavailablePrinterTrays, createDefaultQzPrinterSettings, loadQzPrinterSettings, normalizeQzPrinterSettings, resolvePrinterProfile, saveQzPrinterSettings } from "./workstation-printer-settings";

describe("workstation printer settings", () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001"); });

  it("creates all required document-type profiles with physical defaults", () => {
    const settings = createDefaultQzPrinterSettings();
    expect(settings.profiles.map((profile) => profile.documentType)).toEqual(["A4_DOCUMENT", "A5_DOCUMENT", "ACCESSION_LABEL", "RECEIPT"]);
    expect(resolvePrinterProfile("A4_DOCUMENT", settings)).toMatchObject({ paperWidthMm: 210, paperHeightMm: 297 });
    expect(resolvePrinterProfile("ACCESSION_LABEL", settings)).toMatchObject({ paperWidthMm: 50, paperHeightMm: 30 });
    expect(settings.profiles[0]).toMatchObject({ customPaperSize: false, rasterize: false });
    expect(settings.profiles[1]).toMatchObject({ customPaperSize: false, rasterize: false });
    expect(settings.profiles[2]).toMatchObject({ customPaperSize: true, rasterize: true, orientation: "landscape" });
  });

  it("persists exact queue names per browser workstation", () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "RISPRO A4 Queue";
    saveQzPrinterSettings(settings);
    expect(JSON.parse(localStorage.getItem(QZ_PRINTER_SETTINGS_KEY) || "{}").workstationId).toBe("00000000-0000-4000-8000-000000000001");
    expect(loadQzPrinterSettings().profiles[0].printerName).toBe("RISPRO A4 Queue");
  });

  it("replaces a corrupted workstation identifier with a stable UUID", () => {
    localStorage.setItem("rispro.workstationId.v1", "user-agent-not-an-id");
    expect(createDefaultQzPrinterSettings().workstationId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("normalizes corrupt and unreasonable local values", () => {
    const defaults = createDefaultQzPrinterSettings();
    const corrupted = normalizeQzPrinterSettings({ profiles: defaults.profiles.map((profile) => ({ ...profile, copies: 1000, paperWidthMm: Infinity, paperHeightMm: 9999, marginsMm: { top: -1, right: NaN, bottom: Infinity, left: 9999 } })) });
    expect(corrupted.profiles.every((profile) => profile.copies === 1)).toBe(true);
    expect(corrupted.profiles[0]).toMatchObject({ paperWidthMm: 210, paperHeightMm: 297 });
    expect(corrupted.profiles[2]).toMatchObject({ paperWidthMm: 50, paperHeightMm: 30, customPaperSize: true });
    expect(Object.values(corrupted.profiles[2].marginsMm!)).toEqual([0, 0, 0, 0]);
  });

  it("clears a tray that the refreshed driver no longer exposes", () => {
    const settings = createDefaultQzPrinterSettings();
    Object.assign(settings.profiles[0], { printerName: "A4", printerTray: "Old tray" });
    expect(clearUnavailablePrinterTrays(settings, [{ name: "A4", trays: ["Tray 1"] }]).profiles[0].printerTray).toBeUndefined();
  });
});
