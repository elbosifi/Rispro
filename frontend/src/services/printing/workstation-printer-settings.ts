import type { PrinterDocumentType, PrinterProfile, QzPrinterSettings } from "@/types/printing";

export const QZ_PRINTER_SETTINGS_KEY = "rispro.qzPrinterSettings.v1";
export const RISPRO_WORKSTATION_ID_KEY = "rispro.workstationId.v1";
export const PRINTER_SETTING_LIMITS = { copies: { min: 1, max: 99 }, widthMm: { min: 10, max: 500 }, heightMm: { min: 10, max: 1000 } } as const;

export const DEFAULT_PRINTER_PROFILES: PrinterProfile[] = [
  profile("A4_DOCUMENT", 210, 297, true, false, false),
  profile("A5_DOCUMENT", 148, 210, true, false, false),
  profile("ACCESSION_LABEL", 50, 30, false, true, true),
  profile("RECEIPT", 80, 200, true, true, false),
];

function profile(documentType: PrinterDocumentType, width: number, height: number, scaleContent: boolean, customPaperSize: boolean, rasterize: boolean): PrinterProfile {
  return {
    id: documentType,
    documentType,
    printerName: "",
    paperWidthMm: width,
    paperHeightMm: height,
    orientation: width > height ? "landscape" : "portrait",
    copies: 1,
    scaleContent,
    customPaperSize,
    rasterize,
    marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
    enabled: true,
  };
}

export function getWorkstationId(storage: Storage = window.localStorage): string {
  const existing = storage.getItem(RISPRO_WORKSTATION_ID_KEY)?.trim();
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  storage.setItem(RISPRO_WORKSTATION_ID_KEY, id);
  return id;
}

export function createDefaultQzPrinterSettings(storage: Storage = window.localStorage): QzPrinterSettings {
  return {
    version: 1,
    workstationId: getWorkstationId(storage),
    browserPrintFallbackEnabled: true,
    profiles: DEFAULT_PRINTER_PROFILES.map((item) => ({ ...item, marginsMm: item.marginsMm ? { ...item.marginsMm } : undefined })),
    updatedAt: new Date(0).toISOString(),
  };
}

function finiteBounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function normalizedMargins(value: PrinterProfile["marginsMm"], fallback: NonNullable<PrinterProfile["marginsMm"]>, width: number, height: number) {
  if (!value) return fallback;
  const side = (candidate: unknown, related: number) => finiteBounded(candidate, 0, 0, Math.max(0, related - 0.01));
  const result = { top: side(value.top, height), right: side(value.right, width), bottom: side(value.bottom, height), left: side(value.left, width) };
  if (result.left + result.right >= width) { result.left = 0; result.right = 0; }
  if (result.top + result.bottom >= height) { result.top = 0; result.bottom = 0; }
  return result;
}

export function normalizeQzPrinterSettings(value: unknown, storage: Storage = window.localStorage): QzPrinterSettings {
  const defaults = createDefaultQzPrinterSettings(storage);
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const raw = value as Partial<QzPrinterSettings>;
  const savedProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  return {
    ...defaults,
    browserPrintFallbackEnabled: raw.browserPrintFallbackEnabled !== false,
    profiles: defaults.profiles.map((fallback) => {
      const saved = savedProfiles.find((candidate) => candidate?.documentType === fallback.documentType);
      if (!saved) return fallback;
      const standard = fallback.documentType === "A4_DOCUMENT" || fallback.documentType === "A5_DOCUMENT";
      const width = standard ? fallback.paperWidthMm : finiteBounded(saved.paperWidthMm, fallback.paperWidthMm, PRINTER_SETTING_LIMITS.widthMm.min, PRINTER_SETTING_LIMITS.widthMm.max);
      const height = standard ? fallback.paperHeightMm : finiteBounded(saved.paperHeightMm, fallback.paperHeightMm, PRINTER_SETTING_LIMITS.heightMm.min, PRINTER_SETTING_LIMITS.heightMm.max);
      return {
        ...fallback,
        id: String(saved.id || fallback.id),
        printerName: String(saved.printerName || "").trim(),
        paperWidthMm: width,
        paperHeightMm: height,
        orientation: saved.orientation === "landscape" ? "landscape" : "portrait",
        copies: Math.floor(finiteBounded(saved.copies, 1, PRINTER_SETTING_LIMITS.copies.min, PRINTER_SETTING_LIMITS.copies.max)),
        scaleContent: saved.scaleContent == null ? fallback.scaleContent : saved.scaleContent === true,
        marginsMm: normalizedMargins(saved.marginsMm, fallback.marginsMm!, width, height),
        printerTray: String(saved.printerTray || "").trim() || undefined,
        customPaperSize: standard ? false : true,
        rasterize: saved.rasterize == null ? fallback.rasterize : saved.rasterize === true,
        enabled: saved.enabled !== false,
      };
    }),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : defaults.updatedAt,
  };
}

export function clearUnavailablePrinterTrays(settings: QzPrinterSettings, details: Array<{ name: string; trays: string[] }>): QzPrinterSettings {
  const byName = new Map(details.map((detail) => [detail.name, detail.trays]));
  return { ...settings, profiles: settings.profiles.map((profile) => profile.printerTray && byName.has(profile.printerName) && !byName.get(profile.printerName)!.includes(profile.printerTray) ? { ...profile, printerTray: undefined } : profile) };
}

export function loadQzPrinterSettings(storage: Storage = window.localStorage): QzPrinterSettings {
  try {
    return normalizeQzPrinterSettings(JSON.parse(storage.getItem(QZ_PRINTER_SETTINGS_KEY) || "null"), storage);
  } catch {
    return createDefaultQzPrinterSettings(storage);
  }
}

export function saveQzPrinterSettings(settings: QzPrinterSettings, storage: Storage = window.localStorage): QzPrinterSettings {
  const normalized = normalizeQzPrinterSettings({ ...settings, updatedAt: new Date().toISOString() }, storage);
  normalized.updatedAt = new Date().toISOString();
  storage.setItem(QZ_PRINTER_SETTINGS_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("rispro-qz-settings-changed"));
  return normalized;
}

export function resolvePrinterProfile(documentType: PrinterDocumentType, settings = loadQzPrinterSettings()): PrinterProfile | null {
  const profile = settings.profiles.find((item) => item.documentType === documentType && item.enabled);
  return profile ?? null;
}
