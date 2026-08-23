import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QZ_PRINTER_SETTINGS_KEY, RISPRO_WORKSTATION_ID_KEY, createDefaultQzPrinterSettings, loadQzPrinterSettings, normalizeQzPrinterSettings, resolvePrinterProfile, saveQzPrinterSettings } from "./workstation-printer-settings";

describe("workstation printer settings", () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("creates all required document-type profiles with physical defaults", () => {
    const settings = createDefaultQzPrinterSettings();
    expect(settings.profiles.map((profile) => profile.documentType)).toEqual(["A4_DOCUMENT", "A4_LANDSCAPE_DOCUMENT", "A5_DOCUMENT", "ACCESSION_LABEL", "RECEIPT"]);
    expect(settings.profiles[0]).toMatchObject({ paperWidthMm: 210, paperHeightMm: 297, orientation: "portrait", customPaperSize: false });
    expect(settings.profiles[1]).toMatchObject({ paperWidthMm: 297, paperHeightMm: 210, orientation: "landscape", customPaperSize: false });
    expect(settings.profiles[3]).toMatchObject({ paperWidthMm: 50, paperHeightMm: 30 });
    expect(settings.profiles[0]).toMatchObject({ customPaperSize: false, rasterize: false });
    expect(settings.profiles[1]).toMatchObject({ customPaperSize: false, rasterize: false });
    expect(settings.profiles[3]).toMatchObject({ customPaperSize: true, rasterize: true, orientation: "landscape" });
    expect(settings.profiles.every((profile) => profile.enabled === false)).toBe(true);
  });

  it("persists exact queue names per browser workstation", () => {
    const settings = createDefaultQzPrinterSettings();
    settings.profiles[0].printerName = "RISPRO A4 Queue";
    saveQzPrinterSettings(settings);
    expect(JSON.parse(localStorage.getItem(QZ_PRINTER_SETTINGS_KEY) || "{}").workstationId).toBe("00000000-0000-4000-8000-000000000001");
    expect(loadQzPrinterSettings().profiles[0].printerName).toBe("RISPRO A4 Queue");
  });

  it("persists and resolves an accession-label queue without the settings page", () => {
    const settings = createDefaultQzPrinterSettings();
    const labelProfile = settings.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")!;
    labelProfile.printerName = "RISPRO Label Queue";
    labelProfile.enabled = true;
    saveQzPrinterSettings(settings);

    const freshlyLoaded = loadQzPrinterSettings();
    expect(freshlyLoaded.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")).toMatchObject({
      enabled: true,
      printerName: "RISPRO Label Queue",
    });
    expect(resolvePrinterProfile("ACCESSION_LABEL")).toMatchObject({
      documentType: "ACCESSION_LABEL",
      printerName: "RISPRO Label Queue",
    });
  });

  it("persists accession-label printer compensation margins with its physical dimensions", () => {
    const settings = createDefaultQzPrinterSettings();
    const labelProfile = settings.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")!;
    const { paperWidthMm, paperHeightMm } = labelProfile;
    labelProfile.marginsMm = { top: 1, right: 0, bottom: 0, left: 4 };

    saveQzPrinterSettings(settings);

    expect(loadQzPrinterSettings().profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")).toMatchObject({
      marginsMm: { top: 1, right: 0, bottom: 0, left: 4 },
      paperWidthMm,
      paperHeightMm,
    });
  });

  it("keeps a missing legacy A4 landscape mapping empty and preserves an explicitly saved landscape queue", () => {
    const portrait = { ...createDefaultQzPrinterSettings().profiles[0], printerName: "Shared A4", printerTray: "Tray 2", copies: 3, scaleContent: false, rasterize: true, marginsMm: { top: 2, right: 3, bottom: 4, left: 5 }, enabled: false };
    const migrated = normalizeQzPrinterSettings({ profiles: [portrait] });
    expect(migrated.profiles.find((profile) => profile.documentType === "A4_LANDSCAPE_DOCUMENT")).toMatchObject({
      id: "A4_LANDSCAPE_DOCUMENT", printerName: "", copies: 1, scaleContent: true, rasterize: false,
      marginsMm: { top: 0, right: 0, bottom: 0, left: 0 }, enabled: false, paperWidthMm: 297, paperHeightMm: 210, orientation: "landscape", customPaperSize: false,
    });
    expect(migrated.profiles.find((profile) => profile.documentType === "A4_DOCUMENT")).toMatchObject({ printerName: "Shared A4", printerTray: "Tray 2", copies: 3, enabled: false });

    const landscape = migrated.profiles.find((profile) => profile.documentType === "A4_LANDSCAPE_DOCUMENT")!;
    landscape.printerName = "Independent Landscape";
    const saved = normalizeQzPrinterSettings(migrated);
    expect(saved.profiles.find((profile) => profile.documentType === "A4_DOCUMENT")?.printerName).toBe("Shared A4");
    expect(saved.profiles.find((profile) => profile.documentType === "A4_LANDSCAPE_DOCUMENT")?.printerName).toBe("Independent Landscape");
  });

  it("preserves explicit enabled choices and legacy profiles without the enabled flag", () => {
    const defaults = createDefaultQzPrinterSettings();
    const enabled = normalizeQzPrinterSettings({ profiles: [{ ...defaults.profiles[0], enabled: true }] });
    const disabled = normalizeQzPrinterSettings({ profiles: [{ ...defaults.profiles[0], enabled: false }] });
    const legacy = normalizeQzPrinterSettings({ profiles: [{ ...defaults.profiles[0], enabled: undefined }] });

    expect(enabled.profiles[0].enabled).toBe(true);
    expect(disabled.profiles[0].enabled).toBe(false);
    expect(legacy.profiles[0].enabled).toBe(true);
    expect(createDefaultQzPrinterSettings().profiles.every((profile) => !profile.enabled)).toBe(true);
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
    expect(corrupted.profiles[3]).toMatchObject({ paperWidthMm: 50, paperHeightMm: 30, customPaperSize: true });
    expect(Object.values(corrupted.profiles[3].marginsMm!)).toEqual([0, 0, 0, 0]);
  });

  it("uses each profile fallback when stored scaleContent is missing or corrupt", () => {
    const profiles = createDefaultQzPrinterSettings().profiles.map((profile) => ({ ...profile, scaleContent: undefined }));
    const missing = normalizeQzPrinterSettings({ profiles });
    expect(missing.profiles.find((profile) => profile.documentType === "A4_DOCUMENT")?.scaleContent).toBe(true);
    expect(missing.profiles.find((profile) => profile.documentType === "ACCESSION_LABEL")?.scaleContent).toBe(false);

    const explicit = normalizeQzPrinterSettings({ profiles: [
      { ...profiles[0], scaleContent: false },
      { ...profiles[3], scaleContent: true },
    ] });
    expect(explicit.profiles[0].scaleContent).toBe(false);
    expect(explicit.profiles[3].scaleContent).toBe(true);

    const corrupt = normalizeQzPrinterSettings({ profiles: [{ ...profiles[3], scaleContent: "true" }] });
    expect(corrupt.profiles[3].scaleContent).toBe(false);
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
    const profiles = createDefaultQzPrinterSettings().profiles.map((profile) => ({ ...profile, orientation: undefined }));
    const missing = normalizeQzPrinterSettings({ profiles });
    expect(missing.profiles.map((profile) => profile.orientation)).toEqual(["portrait", "landscape", "portrait", "landscape", "portrait"]);

    const invalid = normalizeQzPrinterSettings({ profiles: profiles.map((profile) => ({ ...profile, orientation: "sideways" })) });
    expect(invalid.profiles.map((profile) => profile.orientation)).toEqual(["portrait", "landscape", "portrait", "landscape", "portrait"]);
  });

  it("preserves explicit portrait and landscape when they agree with physical dimensions", () => {
    const defaults = createDefaultQzPrinterSettings();
    const normalized = normalizeQzPrinterSettings({ profiles: [
      { ...defaults.profiles[0], orientation: "portrait" },
      { ...defaults.profiles[3], orientation: "landscape" },
    ] });
    expect(normalized.profiles[0].orientation).toBe("portrait");
    expect(normalized.profiles[3].orientation).toBe("landscape");
  });

  it("derives custom-media orientation after dimensions change", () => {
    const defaults = createDefaultQzPrinterSettings();
    const normalized = normalizeQzPrinterSettings({ profiles: [
      { ...defaults.profiles[3], paperWidthMm: 30, paperHeightMm: 50, orientation: "landscape" },
      { ...defaults.profiles[4], paperWidthMm: 200, paperHeightMm: 80, orientation: "portrait" },
    ] });
    expect(normalized.profiles[3].orientation).toBe("portrait");
    expect(normalized.profiles[4].orientation).toBe("landscape");
  });
});
