import { isoDateDaysFromNow, todayIsoDateLy } from "@/lib/date-format";
import { parsePositiveInteger } from "./patient-navigation";

export interface StatisticsNavigationState {
  dateFrom: string;
  dateTo: string;
  modalityId: string;
}

const MAX_RANGE_DAYS = 366;

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isRangeValid(dateFrom: string, dateTo: string): boolean {
  const from = new Date(`${dateFrom}T00:00:00Z`).getTime();
  const to = new Date(`${dateTo}T00:00:00Z`).getTime();
  return from <= to && (to - from) / 86_400_000 + 1 <= MAX_RANGE_DAYS;
}

export function parseStatisticsNavigation(params: URLSearchParams, today = todayIsoDateLy()): StatisticsNavigationState {
  const legacyDate = params.get("date");
  const requestedFrom = legacyDate ?? params.get("dateFrom");
  const requestedTo = legacyDate ?? params.get("dateTo");
  const suppliedDates = [legacyDate, params.get("dateFrom"), params.get("dateTo")].filter((value): value is string => Boolean(value));
  if (suppliedDates.some((value) => !isIsoDate(value))) {
    return { dateFrom: today, dateTo: today, modalityId: "" };
  }
  const dateFrom = isIsoDate(requestedFrom) ? requestedFrom : (isIsoDate(requestedTo) ? requestedTo : today);
  const dateTo = isIsoDate(requestedTo) ? requestedTo : dateFrom;
  return {
    dateFrom,
    dateTo,
    modalityId: parsePositiveInteger(params.get("modalityId"))?.toString() ?? "",
  };
}

export function buildStatisticsSearch(
  current: URLSearchParams,
  patch: Partial<StatisticsNavigationState> = {},
  today = todayIsoDateLy(),
): URLSearchParams {
  const state = { ...parseStatisticsNavigation(current, today), ...patch };
  const dateFrom = isIsoDate(state.dateFrom) ? state.dateFrom : today;
  const dateTo = isIsoDate(state.dateTo) ? state.dateTo : dateFrom;
  const next = new URLSearchParams();
  if (dateFrom !== today) next.set("dateFrom", dateFrom);
  if (dateTo !== today || dateFrom !== today) next.set("dateTo", dateTo);
  const modalityId = parsePositiveInteger(state.modalityId);
  if (modalityId !== null) next.set("modalityId", String(modalityId));
  return next;
}

export function sanitizeStatisticsSearch(current: URLSearchParams, today = todayIsoDateLy()): URLSearchParams {
  return buildStatisticsSearch(current, {}, today);
}

export function statisticsRangeIsSafe(state: StatisticsNavigationState): boolean {
  return isIsoDate(state.dateFrom) && isIsoDate(state.dateTo) && isRangeValid(state.dateFrom, state.dateTo);
}

export function statisticsTodayRange(today = todayIsoDateLy()): StatisticsNavigationState {
  return { dateFrom: today, dateTo: today, modalityId: "" };
}

export function statisticsPresetRange(range: "today" | "yesterday" | "last7" | "last31" | "month", today = todayIsoDateLy()): Pick<StatisticsNavigationState, "dateFrom" | "dateTo"> {
  if (range === "yesterday") {
    const yesterday = isoDateDaysFromNow(-1);
    return { dateFrom: yesterday, dateTo: yesterday };
  }
  if (range === "last7") return { dateFrom: isoDateDaysFromNow(-6), dateTo: today };
  if (range === "last31") return { dateFrom: isoDateDaysFromNow(-30), dateTo: today };
  if (range === "month") return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
  return { dateFrom: today, dateTo: today };
}
