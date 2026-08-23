export type RegistrationSort = "booking-desc" | "booking-asc" | "patient-asc" | "time-asc";

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
      if (status) seen.add(status);
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
  const query = firstTrimmed(params, "q");
  const statuses = readStatuses(params);
  const dateMode = firstTrimmed(params, "dateMode");
  const date = firstTrimmed(params, "date");
  const dateFrom = firstTrimmed(params, "dateFrom");
  const dateTo = firstTrimmed(params, "dateTo");
  const sort = firstTrimmed(params, "sort");

  if (modalityId && /^\d+$/.test(modalityId)) {
    next.modalityId = modalityId;
  }
  if (query) {
    next.query = query;
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
