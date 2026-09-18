import { parsePositiveInteger } from "./patient-navigation";

export const CALENDAR_SEARCH_STORAGE_KEY = "rispro:calendar:search";

export const CALENDAR_NAVIGATION_QUERY_KEYS = [
  "month",
  "date",
  "modalityId",
  "category",
  "status",
  "patientId",
] as const;

export const CALENDAR_CATEGORIES = ["oncology", "non_oncology"] as const;
export const CALENDAR_STATUSES = ["scheduled", "arrived", "waiting", "completed", "no-show", "cancelled", "discontinued", "voided"] as const;

export type CalendarCategory = "" | (typeof CALENDAR_CATEGORIES)[number];
export type CalendarStatus = "" | (typeof CALENDAR_STATUSES)[number];

export interface CalendarNavigationState {
  month: string | null;
  date: string | null;
  modalityId: string;
  category: CalendarCategory;
  status: CalendarStatus;
  patientId: number | null;
}

function isCalendarMonth(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return Number.isInteger(year) && month >= 1 && month <= 12;
}

function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseEnum<T extends string>(value: string | null, values: readonly T[]): T | "" {
  return value !== null && values.includes(value as T) ? (value as T) : "";
}

export function calendarMonthForDate(date: string): string {
  return date.slice(0, 7);
}

export function calendarMonthToDate(month: string): Date {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1);
}

export function parseCalendarNavigation(params: URLSearchParams): CalendarNavigationState {
  const date = isCalendarDate(params.get("date")) ? params.get("date")! : null;
  const month = date
    ? calendarMonthForDate(date)
    : (isCalendarMonth(params.get("month")) ? params.get("month")! : null);
  const modalityId = parsePositiveInteger(params.get("modalityId"));

  return {
    month,
    date,
    modalityId: modalityId?.toString() ?? "",
    category: parseEnum(params.get("category"), CALENDAR_CATEGORIES),
    status: parseEnum(params.get("status"), CALENDAR_STATUSES),
    patientId: parsePositiveInteger(params.get("patientId")),
  };
}

export function sanitizeCalendarSearch(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("q");
  return next;
}

function setOrDelete(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    params.delete(key);
    return;
  }
  params.set(key, String(value));
}

/** Builds a shareable Calendar query while retaining unrelated non-Calendar state. */
export function buildCalendarSearch(
  current: URLSearchParams,
  patch: Partial<CalendarNavigationState> = {},
): URLSearchParams {
  const state = { ...parseCalendarNavigation(current), ...patch };
  const date = isCalendarDate(state.date) ? state.date : null;
  const month = date
    ? calendarMonthForDate(date)
    : (isCalendarMonth(state.month) ? state.month : null);
  const modalityId = parsePositiveInteger(state.modalityId) ?? null;
  const category = CALENDAR_CATEGORIES.includes(state.category as (typeof CALENDAR_CATEGORIES)[number]) ? state.category : "";
  const status = CALENDAR_STATUSES.includes(state.status as (typeof CALENDAR_STATUSES)[number]) ? state.status : "";
  const patientId = typeof state.patientId === "number" && Number.isSafeInteger(state.patientId) && state.patientId > 0
    ? state.patientId
    : null;
  const next = sanitizeCalendarSearch(current);

  for (const key of CALENDAR_NAVIGATION_QUERY_KEYS) next.delete(key);
  setOrDelete(next, "month", month);
  setOrDelete(next, "date", date);
  setOrDelete(next, "modalityId", modalityId);
  setOrDelete(next, "category", category);
  setOrDelete(next, "status", status);
  setOrDelete(next, "patientId", patientId);
  return next;
}

export function readCalendarSearch(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(CALENDAR_SEARCH_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeCalendarSearch(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(CALENDAR_SEARCH_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(CALENDAR_SEARCH_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function clearCalendarSearch(): void {
  writeCalendarSearch("");
}
