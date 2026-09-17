export const PATIENTS_SEARCH_STORAGE_KEY = "rispro:patients:search";

export const PATIENTS_QUERY_KEYS = [
  "category",
  "appointment",
  "sex",
  "ageMin",
  "ageMax",
  "sort",
  "page",
  "patientId",
] as const;

export type PatientCategoryFilter = "" | "oncology" | "non_oncology";
export type PatientAppointmentFilter = "" | "has_future" | "today" | "no_future";
export type PatientSexFilter = "" | "male" | "female";
export type PatientSort = "name" | "recent" | "mrn";

export interface PatientDirectoryNavigationState {
  category: PatientCategoryFilter;
  appointment: PatientAppointmentFilter;
  sex: PatientSexFilter;
  ageMin: number | "";
  ageMax: number | "";
  sort: PatientSort;
  page: number;
  patientId: number | null;
}

export const DEFAULT_PATIENT_DIRECTORY_NAVIGATION: PatientDirectoryNavigationState = {
  category: "",
  appointment: "",
  sex: "",
  ageMin: "",
  ageMax: "",
  sort: "recent",
  page: 1,
  patientId: null,
};

function parseEnum<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return value !== null && values.includes(value as T) ? (value as T) : fallback;
}

function isPatientsDirectoryPath(pathname: string): boolean {
  return pathname === "/patients" || pathname === "/patients/";
}

export function sanitizePatientDirectorySearch(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("q");
  return next;
}

export function readPatientDirectorySearch(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(PATIENTS_SEARCH_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writePatientDirectorySearch(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(PATIENTS_SEARCH_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(PATIENTS_SEARCH_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function clearPatientDirectorySearch(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PATIENTS_SEARCH_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseNonNegativeInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parsePatientDirectoryNavigation(params: URLSearchParams): PatientDirectoryNavigationState {
  return {
    category: parseEnum(params.get("category"), ["", "oncology", "non_oncology"], ""),
    appointment: parseEnum(params.get("appointment"), ["", "has_future", "today", "no_future"], ""),
    sex: parseEnum(params.get("sex"), ["", "male", "female"], ""),
    ageMin: parseNonNegativeInteger(params.get("ageMin")) ?? "",
    ageMax: parseNonNegativeInteger(params.get("ageMax")) ?? "",
    sort: parseEnum(params.get("sort"), ["name", "recent", "mrn"], "recent"),
    page: parsePositiveInteger(params.get("page")) ?? 1,
    patientId: parsePositiveInteger(params.get("patientId")),
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | number | null | undefined, defaultValue?: string | number) {
  if (value === null || value === undefined || value === "" || value === defaultValue) {
    params.delete(key);
    return;
  }
  params.set(key, String(value));
}

/** Builds a Patients URL query while retaining unrelated parameters owned by other features. */
export function buildPatientDirectorySearch(
  current: URLSearchParams,
  patch: Partial<PatientDirectoryNavigationState>,
): URLSearchParams {
  const next = sanitizePatientDirectorySearch(current);
  const state = { ...parsePatientDirectoryNavigation(current), ...patch };

  const ageMin = typeof state.ageMin === "number" && Number.isSafeInteger(state.ageMin) && state.ageMin >= 0 ? state.ageMin : "";
  const ageMax = typeof state.ageMax === "number" && Number.isSafeInteger(state.ageMax) && state.ageMax >= 0 ? state.ageMax : "";
  const page = typeof state.page === "number" && Number.isSafeInteger(state.page) && state.page > 0 ? state.page : 1;
  const patientId = typeof state.patientId === "number" && Number.isSafeInteger(state.patientId) && state.patientId > 0 ? state.patientId : null;

  setOrDelete(next, "category", state.category);
  setOrDelete(next, "appointment", state.appointment);
  setOrDelete(next, "sex", state.sex);
  setOrDelete(next, "ageMin", ageMin);
  setOrDelete(next, "ageMax", ageMax);
  setOrDelete(next, "sort", state.sort, DEFAULT_PATIENT_DIRECTORY_NAVIGATION.sort);
  setOrDelete(next, "page", page, DEFAULT_PATIENT_DIRECTORY_NAVIGATION.page);
  setOrDelete(next, "patientId", patientId);
  return next;
}

export function globalPatientSearchLocation(currentPathname: string, currentSearch: string, patientId: number): string {
  const current = currentPathname === "/patients" ? new URLSearchParams(currentSearch) : new URLSearchParams();
  return patientDirectoryLocation("/patients", buildPatientDirectorySearch(current, { patientId }));
}

export function patientDirectoryLocation(pathname: string, params: URLSearchParams): string {
  const search = (isPatientsDirectoryPath(pathname) ? sanitizePatientDirectorySearch(params) : params).toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

/** Accepts only same-origin, absolute-path targets suitable for in-app navigation. */
export function safeInternalReturnTo(value: string | null | undefined, fallback = "/patients"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://rispro.invalid");
    if (
      parsed.origin !== "https://rispro.invalid" ||
      !parsed.pathname.startsWith("/") ||
      parsed.pathname.startsWith("//")
    ) return fallback;
    const search = isPatientsDirectoryPath(parsed.pathname)
      ? sanitizePatientDirectorySearch(new URLSearchParams(parsed.search)).toString()
      : parsed.search.slice(1);
    return `${parsed.pathname}${search ? `?${search}` : ""}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function patientEditPath(patientId: number, returnTo: string): string {
  return `/patients/${patientId}/edit?${new URLSearchParams({ returnTo: safeInternalReturnTo(returnTo) }).toString()}`;
}
