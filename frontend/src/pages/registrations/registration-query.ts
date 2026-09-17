export type RegistrationSort = "booking-desc" | "booking-asc" | "patient-asc" | "time-asc";

export const REGISTRATIONS_SEARCH_STORAGE_KEY = "rispro:registrations:search";

export const REGISTRATION_FILTER_QUERY_KEYS = [
  "dateMode",
  "date",
  "dateFrom",
  "dateTo",
  "modalityId",
  "status",
  "status[]",
  "sort",
] as const;

export interface RegistrationsFilters {
  dateMode: "all" | "single" | "range";
  date: string;
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  patientId?: string;
  query: string;
  statuses: string[];
  sort: RegistrationSort;
}

export const REGISTRATION_DEFAULT_STATUSES = [
  "scheduled",
  "arrived",
  "waiting",
  "in-progress",
] as const;

export const REGISTRATION_FILTER_STATUSES = [
  ...REGISTRATION_DEFAULT_STATUSES,
  "completed",
  "no-show",
  "cancelled",
  "discontinued",
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string | null): value is string {
  if (!value || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function firstTrimmed(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? "";
}

function readStatuses(params: URLSearchParams): string[] {
  const seen = new Set<string>();
  const values = [
    ...params.getAll("status"),
    ...params.getAll("status[]"),
  ];

  for (const rawValue of values) {
    for (const rawStatus of rawValue.split(",")) {
      const status = rawStatus.trim();
      if (REGISTRATION_FILTER_STATUSES.includes(status as (typeof REGISTRATION_FILTER_STATUSES)[number]) || status === "voided") {
        seen.add(status);
      }
    }
  }

  return Array.from(seen);
}

export function parseRegistrationFiltersFromSearchParams(
  params: URLSearchParams,
  defaults: RegistrationsFilters,
): RegistrationsFilters {
  const next: RegistrationsFilters = { ...defaults, statuses: [...defaults.statuses] };
  const modalityId = firstTrimmed(params, "modalityId");
  const statuses = readStatuses(params);
  const dateMode = firstTrimmed(params, "dateMode");
  const date = firstTrimmed(params, "date");
  const dateFrom = firstTrimmed(params, "dateFrom");
  const dateTo = firstTrimmed(params, "dateTo");
  const sort = firstTrimmed(params, "sort");

  if (/^[1-9]\d*$/.test(modalityId)) {
    next.modalityId = modalityId;
  }
  if (statuses.length > 0) {
    next.statuses = statuses;
  }
  if (sort === "booking-desc" || sort === "booking-asc" || sort === "patient-asc" || sort === "time-asc") {
    next.sort = sort;
  }

  if (dateMode === "all") {
    return { ...next, dateMode: "all", date: "", dateFrom: "", dateTo: "" };
  }
  if (dateMode === "single" && isIsoDate(date)) {
    return { ...next, dateMode: "single", date, dateFrom: "", dateTo: "" };
  }
  if (dateMode === "range" && isIsoDate(dateFrom) && isIsoDate(dateTo) && dateFrom <= dateTo) {
    return { ...next, dateMode: "range", date: "", dateFrom, dateTo };
  }
  if (!dateMode && isIsoDate(date)) {
    return { ...next, dateMode: "single", date, dateFrom: "", dateTo: "" };
  }
  if (!dateMode && isIsoDate(dateFrom) && isIsoDate(dateTo) && dateFrom <= dateTo) {
    return { ...next, dateMode: "range", date: "", dateFrom, dateTo };
  }

  return next;
}

export function sanitizeRegistrationSearch(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("q");
  return next;
}

export function readRegistrationSearch(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(REGISTRATIONS_SEARCH_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeRegistrationSearch(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(REGISTRATIONS_SEARCH_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(REGISTRATIONS_SEARCH_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function clearRegistrationSearch(): void {
  writeRegistrationSearch("");
}

function sameStatuses(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((status, index) => status === right[index]);
}

/** Builds a shareable Registration query while retaining unrelated deep-link state. */
export function buildRegistrationSearch(
  current: URLSearchParams,
  filters: RegistrationsFilters,
  defaults: RegistrationsFilters,
): URLSearchParams {
  const next = sanitizeRegistrationSearch(current);
  for (const key of REGISTRATION_FILTER_QUERY_KEYS) next.delete(key);

  if (filters.dateMode === "all") {
    next.set("dateMode", "all");
  } else if (filters.dateMode === "range" && isIsoDate(filters.dateFrom) && isIsoDate(filters.dateTo) && filters.dateFrom <= filters.dateTo) {
    next.set("dateMode", "range");
    next.set("dateFrom", filters.dateFrom);
    next.set("dateTo", filters.dateTo);
  } else if (filters.dateMode === "single" && isIsoDate(filters.date) && filters.date !== defaults.date) {
    next.set("date", filters.date);
  }

  if (/^[1-9]\d*$/.test(filters.modalityId)) next.set("modalityId", filters.modalityId);
  if (!sameStatuses(filters.statuses, defaults.statuses)) {
    for (const status of filters.statuses) next.append("status", status);
  }
  if (filters.sort !== defaults.sort) next.set("sort", filters.sort);
  return next;
}

export function buildRegistrationAppointmentQuery(filters: RegistrationsFilters) {
  const query: Record<string, string | string[]> = {
    modalityId: filters.modalityId,
    q: filters.query,
    status: filters.statuses,
    sort: filters.sort,
  };

  if (filters.patientId) {
    query.patientId = filters.patientId;
  }

  if (filters.dateMode === "single") {
    query.dateFrom = filters.date;
    query.dateTo = filters.date;
  } else if (filters.dateMode === "range") {
    query.dateFrom = filters.dateFrom;
    query.dateTo = filters.dateTo;
  }

  return query;
}
