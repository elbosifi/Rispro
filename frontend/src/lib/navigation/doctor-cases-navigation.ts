import { parsePositiveInteger } from "./patient-navigation";

export const DOCTOR_CASES_PATH = "/doctor/today-cases";

export const DOCTOR_CASES_STATUSES = ["active", "unassigned"] as const;
export const DOCTOR_CASES_CATEGORIES = ["oncology", "non_oncology"] as const;
export const DOCTOR_CASES_VIEWS = ["my", "team", "unassigned"] as const;

export type DoctorCasesStatus = "" | (typeof DOCTOR_CASES_STATUSES)[number];
export type DoctorCasesCategory = "" | (typeof DOCTOR_CASES_CATEGORIES)[number];
export type DoctorCasesView = (typeof DOCTOR_CASES_VIEWS)[number];
export type DoctorCasesRequiresReport = "" | "true" | "false";

export interface DoctorCasesNavigationContext {
  canManage: boolean;
  today?: string;
}

export interface DoctorCasesNavigationState {
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  status: DoctorCasesStatus;
  requiresReport: DoctorCasesRequiresReport;
  category: DoctorCasesCategory;
  view: DoctorCasesView;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

function defaultValues(context: DoctorCasesNavigationContext): Pick<DoctorCasesNavigationState, "dateFrom" | "dateTo" | "requiresReport" | "view"> {
  const dateFrom = isIsoDate(context.today) ? context.today : todayIso();
  return {
    dateFrom,
    dateTo: addDays(dateFrom, 7),
    requiresReport: "true",
    view: context.canManage ? "unassigned" : "my",
  };
}

function parseEnum<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return value !== null && values.includes(value as T) ? value as T : fallback;
}

function parseRequiresReport(value: string | null, fallback: DoctorCasesRequiresReport): DoctorCasesRequiresReport {
  if (value === "true" || value === "false") return value;
  return value === "" ? "" : fallback;
}

export function parseDoctorCasesNavigation(
  params: URLSearchParams,
  context: DoctorCasesNavigationContext,
): DoctorCasesNavigationState {
  const defaults = defaultValues(context);
  const dateFrom = isIsoDate(params.get("dateFrom")) ? params.get("dateFrom")! : defaults.dateFrom;
  const parsedDateTo = isIsoDate(params.get("dateTo")) ? params.get("dateTo")! : null;
  const dateTo = parsedDateTo
    ? (parsedDateTo < dateFrom ? dateFrom : parsedDateTo)
    : addDays(dateFrom, 7);
  const requestedView = parseEnum(params.get("view"), DOCTOR_CASES_VIEWS, defaults.view);

  return {
    dateFrom,
    dateTo,
    modalityId: parsePositiveInteger(params.get("modalityId"))?.toString() ?? "",
    status: parseEnum(params.get("status"), DOCTOR_CASES_STATUSES, ""),
    requiresReport: parseRequiresReport(params.get("requiresReport"), defaults.requiresReport),
    category: parseEnum(params.get("category"), DOCTOR_CASES_CATEGORIES, ""),
    view: context.canManage ? requestedView : "my",
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | null | undefined): void {
  if (!value) {
    params.delete(key);
    return;
  }
  params.set(key, value);
}

export function buildDoctorCasesSearch(
  current: URLSearchParams,
  patch: Partial<DoctorCasesNavigationState> = {},
  context: DoctorCasesNavigationContext,
): URLSearchParams {
  const defaults = defaultValues(context);
  const parsed = parseDoctorCasesNavigation(current, context);
  const state = { ...parsed, ...patch };
  const dateFrom = isIsoDate(state.dateFrom) ? state.dateFrom : defaults.dateFrom;
  const parsedDateTo = isIsoDate(state.dateTo) ? state.dateTo : addDays(dateFrom, 7);
  const dateTo = parsedDateTo < dateFrom ? dateFrom : parsedDateTo;
  const modalityId = parsePositiveInteger(state.modalityId)?.toString() ?? "";
  const status = DOCTOR_CASES_STATUSES.includes(state.status as (typeof DOCTOR_CASES_STATUSES)[number]) ? state.status : "";
  const requiresReport = state.requiresReport === "true" || state.requiresReport === "false" ? state.requiresReport : "";
  const category = DOCTOR_CASES_CATEGORIES.includes(state.category as (typeof DOCTOR_CASES_CATEGORIES)[number]) ? state.category : "";
  const view = context.canManage && DOCTOR_CASES_VIEWS.includes(state.view) ? state.view : defaults.view;
  const next = new URLSearchParams();

  setOrDelete(next, "dateFrom", dateFrom === defaults.dateFrom ? "" : dateFrom);
  setOrDelete(next, "dateTo", dateTo === addDays(dateFrom, 7) ? "" : dateTo);
  setOrDelete(next, "modalityId", modalityId);
  setOrDelete(next, "status", status);
  setOrDelete(next, "requiresReport", requiresReport);
  setOrDelete(next, "category", category);
  setOrDelete(next, "view", view === defaults.view ? "" : view);
  return next;
}

export function sanitizeDoctorCasesSearch(
  current: URLSearchParams,
  context: DoctorCasesNavigationContext,
): URLSearchParams {
  return buildDoctorCasesSearch(current, {}, context);
}
