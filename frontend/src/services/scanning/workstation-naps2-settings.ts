import type { Naps2ScanSource } from "@/lib/naps2-webscan";

export const WORKSTATION_NAPS2_SETTINGS_KEY = "rispro.naps2WebScanWorkstation.v1";
export const WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY = "rispro.naps2ScanPreferences.v1";

export type Naps2ScanPreferences = {
  source: Naps2ScanSource;
  dpi: number;
  colorMode: "grayscale" | "color";
};

export type Naps2ScanPreferenceOverrides = Partial<Naps2ScanPreferences>;

export type Naps2ScanPreferenceDefaults = {
  source?: unknown;
  dpi?: unknown;
  colorMode?: unknown;
};

export interface StoredNaps2ScanPreferences {
  version: 1;
  overrides: Naps2ScanPreferenceOverrides;
  updatedAt: string;
}

export interface WorkstationNaps2Settings {
  version: 1;
  endpoint: string;
  updatedAt: string;
}

export type EffectiveNaps2Endpoint =
  | { endpoint: string; source: "workstation" | "system" }
  | { endpoint: undefined; source: "localhost" };

export function normalizeNaps2Origin(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error("NAPS2 eSCL endpoint is required.");
  if (candidate.includes("*")) throw new Error("NAPS2 eSCL endpoint must be one exact origin without wildcards.");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("NAPS2 eSCL endpoint must be a valid HTTP or HTTPS origin.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("NAPS2 eSCL endpoint must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("NAPS2 eSCL endpoint must not include credentials.");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("NAPS2 eSCL endpoint must be an origin without a path, query, or fragment.");
  return url.origin;
}

export function loadWorkstationNaps2Settings(storage: Storage = window.localStorage): WorkstationNaps2Settings | null {
  try {
    const raw = JSON.parse(storage.getItem(WORKSTATION_NAPS2_SETTINGS_KEY) || "null") as Partial<WorkstationNaps2Settings> | null;
    if (!raw || raw.version !== 1 || typeof raw.endpoint !== "string" || typeof raw.updatedAt !== "string" || Number.isNaN(Date.parse(raw.updatedAt))) return null;
    return { version: 1, endpoint: normalizeNaps2Origin(raw.endpoint), updatedAt: raw.updatedAt };
  } catch {
    return null;
  }
}

export function saveWorkstationNaps2Settings(endpoint: string, storage: Storage = window.localStorage, now = new Date()): WorkstationNaps2Settings {
  const settings: WorkstationNaps2Settings = { version: 1, endpoint: normalizeNaps2Origin(endpoint), updatedAt: now.toISOString() };
  storage.setItem(WORKSTATION_NAPS2_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export function resetWorkstationNaps2Settings(storage: Storage = window.localStorage): void {
  storage.removeItem(WORKSTATION_NAPS2_SETTINGS_KEY);
}

export function resolveEffectiveNaps2Endpoint(globalEndpoint?: string | null, storage: Storage = window.localStorage): EffectiveNaps2Endpoint {
  const local = loadWorkstationNaps2Settings(storage);
  if (local) return { endpoint: local.endpoint, source: "workstation" };
  const systemEndpoint = globalEndpoint?.trim();
  if (systemEndpoint) return { endpoint: normalizeNaps2Origin(systemEndpoint), source: "system" };
  return { endpoint: undefined, source: "localhost" };
}

function availableStorage(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function validScanSource(value: unknown): value is Naps2ScanSource {
  return value === "auto" || value === "feeder" || value === "flatbed" || value === "duplex";
}

function validColorMode(value: unknown): value is "grayscale" | "color" {
  return value === "grayscale" || value === "color";
}

function validDpi(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 50 && value <= 1200;
}

function globalDpi(value: unknown): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  return validDpi(parsed) ? parsed : 200;
}

function normalizeScanPreferenceOverrides(value: unknown): Naps2ScanPreferenceOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const normalized: Naps2ScanPreferenceOverrides = {};
  if (validScanSource(raw.source)) normalized.source = raw.source;
  if (validDpi(raw.dpi)) normalized.dpi = raw.dpi;
  if (validColorMode(raw.colorMode)) normalized.colorMode = raw.colorMode;
  return normalized;
}

export function loadWorkstationNaps2ScanPreferences(storage?: Storage): StoredNaps2ScanPreferences | null {
  try {
    const target = availableStorage(storage);
    if (!target) return null;
    const raw = JSON.parse(target.getItem(WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY) || "null") as Partial<StoredNaps2ScanPreferences> | null;
    if (!raw || raw.version !== 1 || typeof raw.updatedAt !== "string" || Number.isNaN(Date.parse(raw.updatedAt))) return null;
    return { version: 1, overrides: normalizeScanPreferenceOverrides(raw.overrides), updatedAt: raw.updatedAt };
  } catch {
    return null;
  }
}

export function saveWorkstationNaps2ScanPreferences(
  overrides: Naps2ScanPreferenceOverrides,
  storage?: Storage,
  now = new Date(),
): StoredNaps2ScanPreferences {
  const target = availableStorage(storage);
  if (!target) throw new Error("Browser storage is unavailable. Workstation scan preferences were not saved.");
  const saved: StoredNaps2ScanPreferences = {
    version: 1,
    overrides: normalizeScanPreferenceOverrides(overrides),
    updatedAt: now.toISOString(),
  };
  target.setItem(WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY, JSON.stringify(saved));
  return saved;
}

export function resetWorkstationNaps2ScanPreferences(storage?: Storage): void {
  const target = availableStorage(storage);
  if (!target) throw new Error("Browser storage is unavailable. Workstation scan preferences were not reset.");
  target.removeItem(WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY);
}

export function resolveEffectiveNaps2ScanPreferences(
  globalPreferences: Naps2ScanPreferenceDefaults,
  oneTimeOverrides: Naps2ScanPreferenceOverrides = {},
  workstationOverrides?: Naps2ScanPreferenceOverrides,
  storage?: Storage,
): Naps2ScanPreferences {
  const globalSource = validScanSource(globalPreferences.source) ? globalPreferences.source : "feeder";
  const globalColor = validColorMode(globalPreferences.colorMode) ? globalPreferences.colorMode : "grayscale";
  const defaults: Naps2ScanPreferences = {
    source: globalSource,
    dpi: globalDpi(globalPreferences.dpi),
    colorMode: globalColor,
  };
  const savedOverrides = workstationOverrides ?? loadWorkstationNaps2ScanPreferences(storage)?.overrides ?? {};
  return {
    ...defaults,
    ...normalizeScanPreferenceOverrides(savedOverrides),
    ...normalizeScanPreferenceOverrides(oneTimeOverrides),
  };
}
