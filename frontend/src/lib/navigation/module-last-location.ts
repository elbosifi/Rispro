import {
  buildPatientDirectorySearch,
  parsePatientDirectoryNavigation,
  patientDirectoryLocation,
} from "./patient-navigation";
import { buildCalendarSearch, parseCalendarNavigation } from "./calendar-navigation";
import { buildModalitySearch, parseModalityNavigation } from "./modality-navigation";
import { buildRegistrationLastLocationSearch } from "@/pages/registrations/registration-query";
import {
  buildSettingsSectionSearch,
  settingsSectionFromSearch,
  type SettingsSection,
} from "@/pages/settings/settings-page.composition";

export const MODULE_LAST_LOCATIONS_STORAGE_KEY = "rispro:navigation:last-locations:v1";

export const RESTORABLE_MODULE_PATHS = {
  patients: "/patients",
  registrations: "/registrations",
  calendar: "/calendar",
  settings: "/settings",
  modality: "/modality",
} as const;

export type RestorableModule = keyof typeof RESTORABLE_MODULE_PATHS;
type StoredModuleLocations = Partial<Record<RestorableModule, string>>;

const INTERNAL_ORIGIN = "https://rispro.invalid";

function searchParamsFromSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function canonicalizeSettingsSearch(current: URLSearchParams, role?: string): URLSearchParams {
  const section: SettingsSection = settingsSectionFromSearch(current, role);
  return buildSettingsSectionSearch(new URLSearchParams(), section);
}

export function restorableModuleForPath(pathname: string): RestorableModule | null {
  for (const [module, path] of Object.entries(RESTORABLE_MODULE_PATHS) as Array<[RestorableModule, string]>) {
    if (pathname === path) return module;
  }
  return null;
}

export function canonicalizeModuleLocation(pathname: string, search = "", role?: string): string | null {
  const module = restorableModuleForPath(pathname);
  if (!module) return null;

  const current = searchParamsFromSearch(search);
  let canonicalSearch: URLSearchParams;

  switch (module) {
    case "patients":
      canonicalSearch = buildPatientDirectorySearch(
        new URLSearchParams(),
        parsePatientDirectoryNavigation(current),
      );
      return patientDirectoryLocation(pathname, canonicalSearch);
    case "registrations":
      canonicalSearch = buildRegistrationLastLocationSearch(current);
      break;
    case "calendar":
      canonicalSearch = buildCalendarSearch(new URLSearchParams(), parseCalendarNavigation(current));
      break;
    case "settings":
      canonicalSearch = canonicalizeSettingsSearch(current, role);
      break;
    case "modality":
      canonicalSearch = buildModalitySearch(new URLSearchParams(), parseModalityNavigation(current));
      break;
  }

  const query = canonicalSearch.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

function isSafeStoredLocation(value: string, module: RestorableModule): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return false;

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    return parsed.origin === INTERNAL_ORIGIN
      && parsed.pathname === RESTORABLE_MODULE_PATHS[module]
      && parsed.hash === "";
  } catch {
    return false;
  }
}

function readStoredLocations(): StoredModuleLocations {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.sessionStorage.getItem(MODULE_LAST_LOCATIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as StoredModuleLocations;
  } catch {
    return {};
  }
}

export function readModuleLastLocation(module: RestorableModule, role?: string): string | null {
  const stored = readStoredLocations()[module];
  if (typeof stored !== "string" || !isSafeStoredLocation(stored, module)) return null;

  try {
    const parsed = new URL(stored, INTERNAL_ORIGIN);
    return canonicalizeModuleLocation(parsed.pathname, parsed.search, role);
  } catch {
    return null;
  }
}

export function readModuleLastLocationForPath(pathname: string, role?: string): string | null {
  const module = restorableModuleForPath(pathname);
  return module ? readModuleLastLocation(module, role) : null;
}

export function resolveModuleNavigationTarget(pathname: string, search: string | undefined, role?: string): string {
  if (search !== undefined) return search ? `${pathname}?${search}` : pathname;
  return readModuleLastLocationForPath(pathname, role) ?? pathname;
}

export function saveModuleLastLocation(pathname: string, search = "", role?: string): void {
  if (typeof window === "undefined") return;

  const module = restorableModuleForPath(pathname);
  const location = canonicalizeModuleLocation(pathname, search, role);
  if (!module || !location) return;

  try {
    const next: StoredModuleLocations = {};
    for (const candidate of Object.keys(RESTORABLE_MODULE_PATHS) as RestorableModule[]) {
      const stored = readModuleLastLocation(candidate, role);
      if (stored) next[candidate] = stored;
    }
    next[module] = location;
    window.sessionStorage.setItem(MODULE_LAST_LOCATIONS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function clearModuleLastLocations(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(MODULE_LAST_LOCATIONS_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}
