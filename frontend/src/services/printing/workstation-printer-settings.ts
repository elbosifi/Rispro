import type { PrinterDocumentType, PrinterProfile, QzPrinterSettings } from "@/types/printing";

export const QZ_PRINTER_SETTINGS_KEY = "rispro.qzPrinterSettings.v1";
export const RISPRO_WORKSTATION_ID_KEY = "rispro.workstationId.v1";

export const DEFAULT_PRINTER_PROFILES: PrinterProfile[] = [
  profile("A4_DOCUMENT", 210, 297),
  profile("A5_DOCUMENT", 148, 210),
  profile("ACCESSION_LABEL", 50, 30, false),
  profile("RECEIPT", 80, 200),
];

function profile(documentType: PrinterDocumentType, width: number, height: number, scaleContent = true): PrinterProfile {
  return {
    id: documentType,
    documentType,
    printerName: "",
    paperWidthMm: width,
    paperHeightMm: height,
    orientation: "portrait",
    copies: 1,
    scaleContent,
    marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
    enabled: true,
  };
}

export function getWorkstationId(storage: Storage = window.localStorage): string {
  const existing = storage.getItem(RISPRO_WORKSTATION_ID_KEY)?.trim();
  if (existing) return existing;
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

function finitePositive(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
      return {
        ...fallback,
        id: String(saved.id || fallback.id),
        printerName: String(saved.printerName || "").trim(),
        paperWidthMm: finitePositive(saved.paperWidthMm, fallback.paperWidthMm),
        paperHeightMm: finitePositive(saved.paperHeightMm, fallback.paperHeightMm),
        orientation: saved.orientation === "landscape" ? "landscape" : "portrait",
        copies: Math.max(1, Math.floor(finitePositive(saved.copies, 1))),
        scaleContent: saved.scaleContent !== false,
        marginsMm: saved.marginsMm ? {
          top: Math.max(0, Number(saved.marginsMm.top) || 0),
          right: Math.max(0, Number(saved.marginsMm.right) || 0),
          bottom: Math.max(0, Number(saved.marginsMm.bottom) || 0),
          left: Math.max(0, Number(saved.marginsMm.left) || 0),
        } : fallback.marginsMm,
        printerTray: String(saved.printerTray || "").trim() || undefined,
        enabled: saved.enabled !== false,
      };
    }),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : defaults.updatedAt,
  };
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

