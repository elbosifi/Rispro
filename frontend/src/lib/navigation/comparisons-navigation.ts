import { IR_REFERRAL_STATUSES, type IrReferralStatus } from "@/lib/ir-referral-display";

export const COMPARISONS_SEARCH_STORAGE_KEY = "rispro:comparisons:search";
export const COMPARISON_REQUEST_KINDS = ["all", "comparisons", "ir"] as const;
export const COMPARISON_STATUS_OPTIONS = ["active", "pending", "ready", "assigned", "finalized", "cancelled", "all"] as const;
export const IR_STATUS_OPTIONS = ["all", ...IR_REFERRAL_STATUSES] as const;

export type ComparisonRequestKind = (typeof COMPARISON_REQUEST_KINDS)[number];
export type ComparisonStatus = (typeof COMPARISON_STATUS_OPTIONS)[number];
export type ComparisonIrStatus = "all" | IrReferralStatus;

export interface ComparisonsNavigationState {
  requestKind: ComparisonRequestKind;
  comparisonStatus: ComparisonStatus;
  irStatus: ComparisonIrStatus;
}

export function parseComparisonsNavigation(
  params: URLSearchParams,
  defaultComparisonStatus: ComparisonStatus = "active",
): ComparisonsNavigationState {
  const comparisonStatus = params.get("comparisonStatus");
  const irStatus = params.get("irStatus");
  return {
    requestKind: COMPARISON_REQUEST_KINDS.includes(params.get("kind") as ComparisonRequestKind) ? params.get("kind") as ComparisonRequestKind : "all",
    comparisonStatus: comparisonStatus && COMPARISON_STATUS_OPTIONS.includes(comparisonStatus as ComparisonStatus)
      ? comparisonStatus as ComparisonStatus
      : defaultComparisonStatus,
    irStatus: irStatus && IR_STATUS_OPTIONS.includes(irStatus as ComparisonIrStatus) ? irStatus as ComparisonIrStatus : "all",
  };
}

export function buildComparisonsSearch(
  current: URLSearchParams,
  patch: Partial<ComparisonsNavigationState> = {},
  defaultComparisonStatus: ComparisonStatus = "active",
): URLSearchParams {
  const state = { ...parseComparisonsNavigation(current, defaultComparisonStatus), ...patch };
  const next = new URLSearchParams();
  const kind = COMPARISON_REQUEST_KINDS.includes(state.requestKind as ComparisonRequestKind) ? state.requestKind : "all";
  const comparisonStatus = COMPARISON_STATUS_OPTIONS.includes(state.comparisonStatus as ComparisonStatus) ? state.comparisonStatus : defaultComparisonStatus;
  const irStatus = IR_STATUS_OPTIONS.includes(state.irStatus as ComparisonIrStatus) ? state.irStatus : "all";
  if (kind !== "all") next.set("kind", kind);
  if (comparisonStatus !== defaultComparisonStatus) next.set("comparisonStatus", comparisonStatus);
  if (irStatus !== "all") next.set("irStatus", irStatus);
  return next;
}

export function sanitizeComparisonsSearch(current: URLSearchParams, defaultComparisonStatus: ComparisonStatus = "active"): URLSearchParams {
  return buildComparisonsSearch(current, {}, defaultComparisonStatus);
}

export function readComparisonsSearch(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(COMPARISONS_SEARCH_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeComparisonsSearch(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(COMPARISONS_SEARCH_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(COMPARISONS_SEARCH_STORAGE_KEY);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

export function clearComparisonsSearch(): void {
  writeComparisonsSearch("");
}
