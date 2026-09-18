import { parsePositiveInteger } from "./patient-navigation";

export const QUEUE_SEARCH_STORAGE_KEY = "rispro:queue:search";

export const QUEUE_VIEWS = ["all", "entered", "not_entered", "walk_in"] as const;

export type QueueView = (typeof QUEUE_VIEWS)[number];

export interface QueueNavigationState {
  view: QueueView;
  modalityId: string;
  patientId: number | null;
}

function parseQueueView(value: string | null): QueueView {
  return value && QUEUE_VIEWS.includes(value as QueueView) ? value as QueueView : "all";
}

export function parseQueueNavigation(params: URLSearchParams): QueueNavigationState {
  return {
    view: parseQueueView(params.get("view")),
    modalityId: parsePositiveInteger(params.get("modalityId"))?.toString() ?? "",
    patientId: parsePositiveInteger(params.get("patientId")),
  };
}

export function sanitizeQueueSearch(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  const navigation = parseQueueNavigation(current);
  if (navigation.view !== "all") next.set("view", navigation.view);
  if (navigation.modalityId) next.set("modalityId", navigation.modalityId);
  if (navigation.patientId) next.set("patientId", String(navigation.patientId));
  return next;
}

export function buildQueueSearch(
  current: URLSearchParams,
  patch: Partial<QueueNavigationState> = {},
): URLSearchParams {
  const state = { ...parseQueueNavigation(current), ...patch };
  const next = new URLSearchParams();
  const view = QUEUE_VIEWS.includes(state.view as QueueView) ? state.view : "all";
  const modalityId = parsePositiveInteger(state.modalityId) ?? null;
  const patientId = typeof state.patientId === "number" && Number.isSafeInteger(state.patientId) && state.patientId > 0
    ? state.patientId
    : null;

  if (view !== "all") next.set("view", view);
  if (modalityId !== null) next.set("modalityId", String(modalityId));
  if (patientId !== null) next.set("patientId", String(patientId));
  return next;
}

export function readQueueSearch(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(QUEUE_SEARCH_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeQueueSearch(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(QUEUE_SEARCH_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(QUEUE_SEARCH_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function clearQueueSearch(): void {
  writeQueueSearch("");
}
