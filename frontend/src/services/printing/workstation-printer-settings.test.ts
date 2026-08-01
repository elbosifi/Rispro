import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QZ_PRINTER_SETTINGS_KEY, RISPRO_WORKSTATION_ID_KEY, createDefaultQzPrinterSettings, loadQzPrinterSettings, normalizeQzPrinterSettings, resolvePrinterProfile, saveQzPrinterSettings } from "./workstation-printer-settings";

describe("workstation printer settings", () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it("uses getRandomValues to generate a valid UUID v4 when randomUUID is unavailable", () => {
    vi.restoreAllMocks();
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      },
    });

    const workstationId = createDefaultQzPrinterSettings().workstationId;

    expect(workstationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(workstationId).toBe("abababab-abab-4bab-abab-abababababab");
  });

  it("preserves an existing valid workstation identifier without using browser crypto", () => {
    const existing = "4cc81e1f-d319-4e29-b3e2-403da70a079f";
    localStorage.setItem(RISPRO_WORKSTATION_ID_KEY, existing);
    vi.restoreAllMocks();
    vi.stubGlobal("crypto", {});

    expect(createDefaultQzPrinterSettings().workstationId).toBe(existing);
  });

  it("normalizes corrupt and unreasonable local values", () => {
    const defaults = createDefaultQzPrinterSettings();
    const corrupted = normalizeQzPrinterSettings({ profiles: defaults.profiles.map((profile) => ({ ...profile, copies: 1000, paperWidthMm: Infinity, paperHeightMm: 9999, marginsMm: { top: -1, right: NaN, bottom: Infinity, left: 9999 } })) });
    expect(corrupted.profiles.every((profile) => profile.copies === 1)).toBe(true);
    expect(corrupted.profiles[0]).toMatchObject({ paperWidthMm: 210, paperHeightMm: 297 });
    expect(corrupted.profiles[2]).toMatchObject({ paperWidthMm: 50, paperHeightMm: 30, customPaperSize: true });
    expect(Object.values(corrupted.profiles[2].marginsMm!)).toEqual([0, 0, 0, 0]);
  });

  it("uses each profile fallback when stored scaleContent is missing or corrupt", () => {
    const profiles = createDefaultQzPrinterSettings().profiles.map(({ scaleContent: _scaleContent, ...profile }) => profile);
    const missing = normalizeQzPrinterSettings({ profiles });
    expect(missing.profiles.find((profile) => profile.documentType === "A4_DOCUMENT")?.scaleContent).toBe(true);
    expect(missing.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")?.scaleContent).toBe(false);

    const explicit = normalizeQzPrinterSettings({ profiles: [
      { ...profiles[0], scaleContent: false },
      { ...profiles[2], scaleContent: true },
    ] });
    expect(explicit.profiles[0].scaleContent).toBe(false);
    expect(explicit.profiles[2].scaleContent).toBe(true);

    const corrupt = normalizeQzPrinterSettings({ profiles: [{ ...profiles[2], scaleContent: "true" }] });
    expect(corrupt.profiles[2].scaleContent).toBe(false);
  });

  it("preserves a normalized manual tray without driver-detail discovery", () => {
    const settings = createDefaultQzPrinterSettings();
    Object.assign(settings.profiles[0], { printerName: "A4", printerTray: "  Manual Tray 1  " });
    saveQzPrinterSettings(settings);
    expect(loadQzPrinterSettings().profiles[0].printerTray).toBe("Manual Tray 1");
    expect(normalizeQzPrinterSettings({ profiles: [{ ...settings.profiles[0], printerTray: "x".repeat(256) }] }).profiles[0].printerTray).toBeUndefined();
    expect(normalizeQzPrinterSettings({ profiles: [{ ...settings.profiles[0], printerTray: "Tray\u0000One" }] }).profiles[0].printerTray).toBeUndefined();
  });

  it("inherits orientation from each physical profile when saved orientation is missing or invalid", () => {
    const profiles = createDefaultQzPrinterSettings().profiles.map(({ orientation: _orientation, ...profile }) => profile);
    const missing = normalizeQzPrinterSettings({ profiles });
    expect(missing.profiles.map((profile) => profile.orientation)).toEqual(["portrait", "portrait", "landscape", "portrait"]);

    const invalid = normalizeQzPrinterSettings({ profiles: profiles.map((profile) => ({ ...profile, orientation: "sideways" })) });
    expect(invalid.profiles.map((profile) => profile.orientation)).toEqual(["portrait", "portrait", "landscape", "portrait"]);
  });

  it("preserves explicit portrait and landscape when they agree with physical dimensions", () => {
    const defaults = createDefaultQzPrinterSettings();
    const normalized = normalizeQzPrinterSettings({ profiles: [
      { ...defaults.profiles[0], orientation: "portrait" },
      { ...defaults.profiles[2], orientation: "landscape" },
    ] });
    expect(normalized.profiles[0].orientation).toBe("portrait");
    expect(normalized.profiles[2].orientation).toBe("landscape");
  });

  it("derives custom-media orientation after dimensions change", () => {
    const defaults = createDefaultQzPrinterSettings();
    const normalized = normalizeQzPrinterSettings({ profiles: [
      { ...defaults.profiles[2], paperWidthMm: 30, paperHeightMm: 50, orientation: "landscape" },
      { ...defaults.profiles[3], paperWidthMm: 200, paperHeightMm: 80, orientation: "portrait" },
    ] });
    expect(normalized.profiles[2].orientation).toBe("portrait");
    expect(normalized.profiles[3].orientation).toBe("landscape");
  });
});
