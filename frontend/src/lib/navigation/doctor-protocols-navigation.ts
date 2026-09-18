import { todayIsoDateLy } from "@/lib/date-format";
import { parsePositiveInteger } from "./patient-navigation";

export const DOCTOR_PROTOCOLING_SEARCH_STORAGE_KEY = "rispro:doctor:protocoling:search";
export const DOCTOR_PROTOCOL_LIBRARY_SEARCH_STORAGE_KEY = "rispro:doctor:protocol-library:search";

export const DOCTOR_PROTOCOLS_AREAS = ["protocoling", "library"] as const;
export const DOCTOR_PROTOCOL_LIBRARY_SECTIONS = ["protocols", "importExport", "anatomy", "scanners", "ctPhases", "mriSequences"] as const;
export const DOCTOR_PROTOCOL_LIBRARY_FILTERS = ["all", "CT", "MRI", "active", "draft"] as const;
export const DOCTOR_PROTOCOL_STATUSES = ["NOT_PROTOCOLLED", "ASSIGNED", "ALL"] as const;
export const DOCTOR_APPOINTMENT_STATUSES = ["scheduled", "arrived", "waiting", "completed", "no-show"] as const;

export type DoctorProtocolsArea = (typeof DOCTOR_PROTOCOLS_AREAS)[number];
export type DoctorProtocolLibrarySection = (typeof DOCTOR_PROTOCOL_LIBRARY_SECTIONS)[number];
export type DoctorProtocolLibraryFilter = (typeof DOCTOR_PROTOCOL_LIBRARY_FILTERS)[number];
export type DoctorProtocolStatus = (typeof DOCTOR_PROTOCOL_STATUSES)[number];
export type DoctorAppointmentStatus = (typeof DOCTOR_APPOINTMENT_STATUSES)[number];

export interface DoctorProtocolsNavigationState {
  area: DoctorProtocolsArea;
  section: DoctorProtocolLibrarySection;
  protocolFilter: DoctorProtocolLibraryFilter;
  dateFrom: string;
  dateTo: string;
  modality: "" | "CT" | "MRI";
  protocolStatus: DoctorProtocolStatus;
  appointmentStatus: "" | DoctorAppointmentStatus;
  waitingFirst: boolean;
  appointmentId: number | null;
}

export interface DoctorProtocolsNavigationPermissions {
  canAssign: boolean;
  canManageLibrary: boolean;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function defaults(today: string): Pick<DoctorProtocolsNavigationState, "dateFrom" | "dateTo"> {
  return { dateFrom: today, dateTo: addDays(today, 7) };
}

function defaultArea(permissions: DoctorProtocolsNavigationPermissions): DoctorProtocolsArea {
  return permissions.canAssign ? "protocoling" : "library";
}

function allowedArea(value: string | null, permissions: DoctorProtocolsNavigationPermissions): DoctorProtocolsArea {
  const fallback = defaultArea(permissions);
  if (value === "protocoling" && permissions.canAssign) return "protocoling";
  if (value === "library" && permissions.canManageLibrary) return "library";
  return fallback;
}

function parseEnum<T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]): T[number] {
  return value && allowed.includes(value) ? value as T[number] : fallback;
}

export function parseDoctorProtocolsNavigation(
  params: URLSearchParams,
  permissions: DoctorProtocolsNavigationPermissions,
  today = todayIsoDateLy(),
): DoctorProtocolsNavigationState {
  const defaultsForDate = defaults(today);
  const rawFrom = params.get("dateFrom");
  const rawTo = params.get("dateTo");
  const dateFrom = isIsoDate(rawFrom) ? rawFrom : defaultsForDate.dateFrom;
  const dateTo = isIsoDate(rawTo) ? rawTo : defaultsForDate.dateTo;
  const area = allowedArea(params.get("area"), permissions);
  const appointmentStatus = params.get("appointmentStatus") && DOCTOR_APPOINTMENT_STATUSES.includes(params.get("appointmentStatus") as DoctorAppointmentStatus)
    ? params.get("appointmentStatus") as DoctorAppointmentStatus
    : "";

  return {
    area,
    section: parseEnum(params.get("section"), DOCTOR_PROTOCOL_LIBRARY_SECTIONS, "protocols"),
    protocolFilter: parseEnum(params.get("filter"), DOCTOR_PROTOCOL_LIBRARY_FILTERS, "all"),
    dateFrom,
    dateTo,
    modality: parseEnum(params.get("modality"), ["", "CT", "MRI"] as const, ""),
    protocolStatus: parseEnum(params.get("protocolStatus"), DOCTOR_PROTOCOL_STATUSES, "NOT_PROTOCOLLED"),
    appointmentStatus,
    waitingFirst: appointmentStatus === "" && params.get("waitingFirst") === "true",
    appointmentId: parsePositiveInteger(params.get("appointmentId")),
  };
}

export function buildDoctorProtocolsSearch(
  current: URLSearchParams,
  patch: Partial<DoctorProtocolsNavigationState> = {},
  permissions: DoctorProtocolsNavigationPermissions = { canAssign: true, canManageLibrary: true },
  today = todayIsoDateLy(),
): URLSearchParams {
  const state = { ...parseDoctorProtocolsNavigation(current, permissions, today), ...patch };
  const fallbackArea = defaultArea(permissions);
  const area = allowedArea(state.area, permissions);
  const section = DOCTOR_PROTOCOL_LIBRARY_SECTIONS.includes(state.section as DoctorProtocolLibrarySection) ? state.section : "protocols";
  const filter = DOCTOR_PROTOCOL_LIBRARY_FILTERS.includes(state.protocolFilter as DoctorProtocolLibraryFilter) ? state.protocolFilter : "all";
  const dateDefaults = defaults(today);
  const dateFrom = isIsoDate(state.dateFrom) ? state.dateFrom : dateDefaults.dateFrom;
  const dateTo = isIsoDate(state.dateTo) ? state.dateTo : dateDefaults.dateTo;
  const next = new URLSearchParams();

  if (area !== fallbackArea) next.set("area", area);
  if (area === "library") {
    if (section !== "protocols") next.set("section", section);
    if (section === "protocols" && filter !== "all") next.set("filter", filter);
    return next;
  }

  if (dateFrom !== dateDefaults.dateFrom || dateTo !== dateDefaults.dateTo) {
    next.set("dateFrom", dateFrom);
    next.set("dateTo", dateTo);
  }
  if (state.modality === "CT" || state.modality === "MRI") next.set("modality", state.modality);
  if (state.protocolStatus !== "NOT_PROTOCOLLED") next.set("protocolStatus", state.protocolStatus);
  if (state.appointmentStatus && DOCTOR_APPOINTMENT_STATUSES.includes(state.appointmentStatus)) next.set("appointmentStatus", state.appointmentStatus);
  if (!state.appointmentStatus && state.waitingFirst) next.set("waitingFirst", "true");
  const appointmentId = typeof state.appointmentId === "number" && Number.isSafeInteger(state.appointmentId) && state.appointmentId > 0
    ? state.appointmentId
    : null;
  if (appointmentId !== null) next.set("appointmentId", String(appointmentId));
  return next;
}

export function sanitizeDoctorProtocolsSearch(
  current: URLSearchParams,
  permissions: DoctorProtocolsNavigationPermissions = { canAssign: true, canManageLibrary: true },
  today = todayIsoDateLy(),
): URLSearchParams {
  return buildDoctorProtocolsSearch(current, {}, permissions, today);
}

function readStorage(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function readDoctorProtocolingSearch(): string {
  return readStorage(DOCTOR_PROTOCOLING_SEARCH_STORAGE_KEY);
}

export function writeDoctorProtocolingSearch(value: string): void {
  writeStorage(DOCTOR_PROTOCOLING_SEARCH_STORAGE_KEY, value);
}

export function readDoctorProtocolLibrarySearch(): string {
  return readStorage(DOCTOR_PROTOCOL_LIBRARY_SEARCH_STORAGE_KEY);
}

export function writeDoctorProtocolLibrarySearch(value: string): void {
  writeStorage(DOCTOR_PROTOCOL_LIBRARY_SEARCH_STORAGE_KEY, value);
}

export function clearDoctorProtocolsSearch(): void {
  writeStorage(DOCTOR_PROTOCOLING_SEARCH_STORAGE_KEY, "");
  writeStorage(DOCTOR_PROTOCOL_LIBRARY_SEARCH_STORAGE_KEY, "");
}
