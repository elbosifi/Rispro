import { todayIsoDateLy } from "@/lib/date-format";
import { parsePositiveInteger } from "./patient-navigation";

export const WORKLIST_MONITOR_SEARCH_STORAGE_KEY = "rispro:worklist-monitor:search";
export const WORKLIST_MONITOR_TABS = ["orthanc", "sante"] as const;
export const WORKLIST_MONITOR_STATUSES = ["all", "failed", "pending", "synced", "waiting_for_protocol", "waiting_for_queue"] as const;

export type WorklistMonitorTab = (typeof WORKLIST_MONITOR_TABS)[number];
export type WorklistMonitorStatus = (typeof WORKLIST_MONITOR_STATUSES)[number];

export interface WorklistMonitorNavigationState {
  tab: WorklistMonitorTab;
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  status: WorklistMonitorStatus;
}

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseEnum<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return value && values.includes(value as T) ? value as T : fallback;
}

export function parseWorklistMonitorNavigation(
  params: URLSearchParams,
  today = todayIsoDateLy(),
): WorklistMonitorNavigationState {
  const dateFrom = isIsoDate(params.get("dateFrom")) ? params.get("dateFrom")! : today;
  const requestedDateTo = isIsoDate(params.get("dateTo")) ? params.get("dateTo")! : today;
  return {
    tab: parseEnum(params.get("tab"), WORKLIST_MONITOR_TABS, "orthanc"),
    dateFrom,
    dateTo: requestedDateTo < dateFrom ? dateFrom : requestedDateTo,
    modalityId: parsePositiveInteger(params.get("modalityId"))?.toString() ?? "",
    status: parseEnum(params.get("status"), WORKLIST_MONITOR_STATUSES, "all"),
  };
}

export function buildWorklistMonitorSearch(
  current: URLSearchParams,
  patch: Partial<WorklistMonitorNavigationState> = {},
  today = todayIsoDateLy(),
): URLSearchParams {
  const parsed = parseWorklistMonitorNavigation(current, today);
  const state = { ...parsed, ...patch };
  const dateFrom = isIsoDate(state.dateFrom) ? state.dateFrom : today;
  const requestedDateTo = isIsoDate(state.dateTo) ? state.dateTo : today;
  const dateTo = requestedDateTo < dateFrom ? dateFrom : requestedDateTo;
  const next = new URLSearchParams();
  if (state.tab !== "orthanc") next.set("tab", state.tab);
  if (dateFrom !== today) next.set("dateFrom", dateFrom);
  if (dateTo !== today || dateFrom !== today) next.set("dateTo", dateTo);
  const modalityId = parsePositiveInteger(state.modalityId);
  if (modalityId !== null) next.set("modalityId", String(modalityId));
  if (state.status !== "all") next.set("status", state.status);
  return next;
}

export function sanitizeWorklistMonitorSearch(current: URLSearchParams, today = todayIsoDateLy()): URLSearchParams {
  return buildWorklistMonitorSearch(current, {}, today);
}

export function readWorklistMonitorSearch(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(WORKLIST_MONITOR_SEARCH_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeWorklistMonitorSearch(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(WORKLIST_MONITOR_SEARCH_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(WORKLIST_MONITOR_SEARCH_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function clearWorklistMonitorSearch(): void {
  writeWorklistMonitorSearch("");
}
