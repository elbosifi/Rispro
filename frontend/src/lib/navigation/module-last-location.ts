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
import { sanitizeDoctorCasesSearch } from "./doctor-cases-navigation";
import {
  sanitizeDoctorTeamWorkloadSearch,
} from "./doctor-team-workload-navigation";
import { REPORTING_BOARD_QUERY_KEYS } from "./reporting-board-navigation";
import { buildQueueSearch } from "./queue-navigation";
import { buildWorklistMonitorSearch } from "./worklist-monitor-navigation";
import { buildStatisticsSearch } from "./statistics-navigation";
import { buildComparisonsSearch } from "./comparisons-navigation";
import { sanitizeDoctorProtocolsSearch } from "./doctor-protocols-navigation";
import {
  buildDoctorAdvancedSetupSearch,
  parseDoctorAdvancedSetupNavigation,
} from "./doctor-advanced-setup-navigation";

export const MODULE_LAST_LOCATIONS_STORAGE_KEY = "rispro:navigation:last-locations:v1";

export const RESTORABLE_MODULE_PATHS = {
  patients: "/patients",
  registrations: "/registrations",
  calendar: "/calendar",
  settings: "/settings",
  modality: "/modality",
  doctorTodayCases: "/doctor/today-cases",
  doctorReportingBoard: "/doctor/reporting-board",
  doctorTeamWorkload: "/doctor/team-workload",
  queue: "/queue",
  worklistMonitor: "/worklist-monitor",
  statistics: "/statistics",
  comparisons: "/comparisons",
  doctorProtocols: "/doctor/protocols",
  doctorAdvancedSetup: "/doctor/advanced-setup",
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

function isDoctorSavedViewPath(pathname: string): boolean {
  return /^\/doctor\/reporting-board\/saved\/[A-Za-z0-9_-]+$/.test(pathname);
}

function canonicalizeDoctorReportingBoardSearch(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of REPORTING_BOARD_QUERY_KEYS) {
    const value = current.get(key);
    if (value !== null) next.set(key, value);
  }
  return next;
}

function doctorAdvancedSetupContext(role?: string): { canManageRoster: boolean; canManageDoctors: boolean } {
  const canManageRoster = role === "supervisor" || role === "super_admin" || role === "doctor_admin";
  const canManageDoctors = role === "super_admin" || role === "doctor_admin";
  return { canManageRoster, canManageDoctors };
}

export function restorableModuleForPath(pathname: string): RestorableModule | null {
  for (const [module, path] of Object.entries(RESTORABLE_MODULE_PATHS) as Array<[RestorableModule, string]>) {
    if (pathname === path) return module;
  }
  if (isDoctorSavedViewPath(pathname)) return "doctorReportingBoard";
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
    case "doctorTodayCases":
      canonicalSearch = sanitizeDoctorCasesSearch(current, { canManage: true });
      break;
    case "doctorReportingBoard":
      canonicalSearch = canonicalizeDoctorReportingBoardSearch(current);
      break;
    case "doctorTeamWorkload":
      canonicalSearch = sanitizeDoctorTeamWorkloadSearch(current);
      break;
    case "queue":
      canonicalSearch = buildQueueSearch(current);
      break;
    case "worklistMonitor":
      canonicalSearch = buildWorklistMonitorSearch(current);
      break;
    case "statistics":
      canonicalSearch = buildStatisticsSearch(current);
      break;
    case "comparisons":
      canonicalSearch = buildComparisonsSearch(current);
      break;
    case "doctorProtocols":
      canonicalSearch = sanitizeDoctorProtocolsSearch(current);
      break;
    case "doctorAdvancedSetup":
      canonicalSearch = buildDoctorAdvancedSetupSearch(new URLSearchParams(), parseDoctorAdvancedSetupNavigation(current, doctorAdvancedSetupContext(role)), doctorAdvancedSetupContext(role));
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
      && restorableModuleForPath(parsed.pathname) === module
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
