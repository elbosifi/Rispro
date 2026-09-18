import { parsePositiveInteger } from "./patient-navigation";

export const MODALITY_NAVIGATION_QUERY_KEYS = [
  "modalityId",
  "date",
  "scope",
  "view",
  "appointmentId",
] as const;

export const MODALITY_PRIVATE_QUERY_KEYS = ["q", "query", "search"] as const;

export const MODALITY_VIEWS = [
  "operational",
  "ready",
  "waiting",
  "arrived",
  "in-progress",
  "not-arrived",
  "completed",
  "problem",
  "all",
] as const;

export type ModalityView = (typeof MODALITY_VIEWS)[number];
export type ModalityScope = "day" | "all";

export interface ModalityNavigationState {
  modalityId: string;
  date: string | null;
  scope: ModalityScope;
  view: ModalityView;
  appointmentId: number | null;
}

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseView(value: string | null): ModalityView {
  return value && MODALITY_VIEWS.includes(value as ModalityView) ? value as ModalityView : "operational";
}

export function parseModalityNavigation(params: URLSearchParams): ModalityNavigationState {
  const modalityId = parsePositiveInteger(params.get("modalityId"));
  const appointmentId = parsePositiveInteger(params.get("appointmentId"));
  return {
    modalityId: modalityId?.toString() ?? "",
    date: isIsoDate(params.get("date")) ? params.get("date") : null,
    scope: params.get("scope") === "all" ? "all" : "day",
    view: parseView(params.get("view")),
    appointmentId,
  };
}

export function sanitizeModalitySearch(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of MODALITY_PRIVATE_QUERY_KEYS) next.delete(key);
  return next;
}

function setOrDelete(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    params.delete(key);
    return;
  }
  params.set(key, String(value));
}

/** Builds a shareable Modality query while retaining unrelated safe parameters. */
export function buildModalitySearch(
  current: URLSearchParams,
  patch: Partial<ModalityNavigationState> = {},
  defaultDate?: string,
): URLSearchParams {
  const state = { ...parseModalityNavigation(current), ...patch };
  const next = sanitizeModalitySearch(current);
  for (const key of MODALITY_NAVIGATION_QUERY_KEYS) next.delete(key);

  const modalityId = parsePositiveInteger(String(state.modalityId))?.toString() ?? "";
  const date = isIsoDate(state.date) ? state.date : null;
  const scope: ModalityScope = state.scope === "all" ? "all" : "day";
  const view = MODALITY_VIEWS.includes(state.view as ModalityView) ? state.view : "operational";
  const appointmentId = typeof state.appointmentId === "number" && Number.isSafeInteger(state.appointmentId) && state.appointmentId > 0
    ? state.appointmentId
    : null;

  setOrDelete(next, "modalityId", modalityId);
  const dateWasPatched = Object.prototype.hasOwnProperty.call(patch, "date");
  if (date && (!dateWasPatched || date !== defaultDate)) setOrDelete(next, "date", date);
  setOrDelete(next, "scope", scope === "all" ? "all" : null);
  setOrDelete(next, "view", view === "operational" ? null : view);
  setOrDelete(next, "appointmentId", appointmentId);
  return next;
}
