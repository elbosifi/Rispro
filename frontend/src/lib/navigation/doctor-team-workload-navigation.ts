import { parsePositiveInteger } from "./patient-navigation";

export const DOCTOR_TEAM_WORKLOAD_PATH = "/doctor/team-workload";
export const DOCTOR_TEAM_WORKLOAD_CATEGORIES = ["oncology", "non_oncology"] as const;

export type DoctorTeamWorkloadCategory = "" | (typeof DOCTOR_TEAM_WORKLOAD_CATEGORIES)[number];
export type DoctorTeamWorkloadRequiresReport = "" | "true" | "false";

export interface DoctorTeamWorkloadNavigationContext {
  today?: string;
}

export interface DoctorTeamWorkloadNavigationState {
  startDate: string;
  endDate: string;
  modalityId: string;
  requiresReport: DoctorTeamWorkloadRequiresReport;
  category: DoctorTeamWorkloadCategory;
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

function defaultValues(context: DoctorTeamWorkloadNavigationContext): Pick<DoctorTeamWorkloadNavigationState, "startDate" | "endDate"> {
  const startDate = isIsoDate(context.today) ? context.today : todayIso();
  return { startDate, endDate: addDays(startDate, 7) };
}

function parseRequiresReport(value: string | null): DoctorTeamWorkloadRequiresReport {
  return value === "true" || value === "false" ? value : "";
}

function parseCategory(value: string | null): DoctorTeamWorkloadCategory {
  return value !== null && DOCTOR_TEAM_WORKLOAD_CATEGORIES.includes(value as (typeof DOCTOR_TEAM_WORKLOAD_CATEGORIES)[number])
    ? value as (typeof DOCTOR_TEAM_WORKLOAD_CATEGORIES)[number]
    : "";
}

export function parseDoctorTeamWorkloadNavigation(
  params: URLSearchParams,
  context: DoctorTeamWorkloadNavigationContext = {},
): DoctorTeamWorkloadNavigationState {
  const defaults = defaultValues(context);
  const startDate = isIsoDate(params.get("startDate")) ? params.get("startDate")! : defaults.startDate;
  const requestedEndDate = isIsoDate(params.get("endDate")) ? params.get("endDate")! : defaults.endDate;

  return {
    startDate,
    endDate: requestedEndDate < startDate ? startDate : requestedEndDate,
    modalityId: parsePositiveInteger(params.get("modalityId"))?.toString() ?? "",
    requiresReport: parseRequiresReport(params.get("requiresReport")),
    category: parseCategory(params.get("category")),
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string): void {
  if (value) params.set(key, value);
  else params.delete(key);
}

export function buildDoctorTeamWorkloadSearch(
  current: URLSearchParams,
  patch: Partial<DoctorTeamWorkloadNavigationState> = {},
  context: DoctorTeamWorkloadNavigationContext = {},
): URLSearchParams {
  const defaults = defaultValues(context);
  const state = { ...parseDoctorTeamWorkloadNavigation(current, context), ...patch };
  const startDate = isIsoDate(state.startDate) ? state.startDate : defaults.startDate;
  const hasExplicitEndDate = current.has("endDate") || Object.prototype.hasOwnProperty.call(patch, "endDate");
  const requestedEndDate = hasExplicitEndDate && isIsoDate(state.endDate) ? state.endDate : addDays(startDate, 7);
  const endDate = requestedEndDate < startDate ? startDate : requestedEndDate;
  const modalityId = parsePositiveInteger(state.modalityId)?.toString() ?? "";
  const requiresReport = state.requiresReport === "true" || state.requiresReport === "false" ? state.requiresReport : "";
  const category = DOCTOR_TEAM_WORKLOAD_CATEGORIES.includes(state.category as (typeof DOCTOR_TEAM_WORKLOAD_CATEGORIES)[number]) ? state.category : "";
  const next = new URLSearchParams();

  setOrDelete(next, "startDate", startDate === defaults.startDate ? "" : startDate);
  setOrDelete(next, "endDate", endDate === addDays(startDate, 7) ? "" : endDate);
  setOrDelete(next, "modalityId", modalityId);
  setOrDelete(next, "requiresReport", requiresReport);
  setOrDelete(next, "category", category);
  return next;
}

export function sanitizeDoctorTeamWorkloadSearch(
  current: URLSearchParams,
  context: DoctorTeamWorkloadNavigationContext = {},
): URLSearchParams {
  return buildDoctorTeamWorkloadSearch(current, {}, context);
}
