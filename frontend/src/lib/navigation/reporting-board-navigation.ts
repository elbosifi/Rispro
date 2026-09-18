import { parsePositiveInteger } from "./patient-navigation";
import type {
  ReportingBoardAssignmentMatch,
  ReportingBoardCaseSource,
  ReportingBoardFilters,
  ReportingBoardReportStatus,
  ReportingBoardSortBy,
  ReportingBoardSortDirection,
} from "@/types/api";

export const REPORTING_BOARD_QUERY_KEYS = [
  "dateFrom",
  "dateTo",
  "modalityId",
  "modalityCode",
  "assignedDoctorId",
  "finalizedByDoctorId",
  "assignmentStatus",
  "assignmentMatch",
  "reportStatus",
  "caseSource",
  "category",
  "priorityCode",
  "sortBy",
  "sortDirection",
  "pinUrgentToTop",
  "limit",
] as const;

const ASSIGNMENT_STATUSES = ["all", "unassigned", "assigned"] as const;
const ASSIGNMENT_MATCHES: readonly ReportingBoardAssignmentMatch[] = ["all", "matched", "mismatch", "finalized_unassigned", "unmapped_finalizer"];
const REPORT_STATUSES: readonly ReportingBoardReportStatus[] = ["required_not_final", "final", "draft", "no_report", "study_not_found", "unavailable", "all"];
const CASE_SOURCES: readonly ReportingBoardCaseSource[] = ["all", "appointments", "comparisons"];
const CATEGORIES = ["oncology", "non_oncology"] as const;
const SORT_BY: readonly ReportingBoardSortBy[] = [
  "priority_study_date",
  "study_date",
  "accession",
  "patient_name",
  "mrn",
  "exam_type",
  "modality",
  "assigned_doctor",
  "longest_unassigned",
  "longest_assigned_not_final",
  "oldest_completed",
];
const SORT_DIRECTIONS: readonly ReportingBoardSortDirection[] = ["asc", "desc"];

export interface ReportingBoardNavigationContext {
  defaultFilters: ReportingBoardFilters;
  savedViewFilters?: ReportingBoardFilters | null;
}

export interface ReportingBoardNavigationState {
  filters: ReportingBoardFilters;
  urlOverrides: Partial<ReportingBoardFilters>;
}

function isOneOf<T extends string>(value: string | null, values: readonly T[]): value is T {
  return value !== null && values.includes(value as T);
}

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function safeCode(value: string | null, uppercase: boolean): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(trimmed)) return null;
  return uppercase ? trimmed.toUpperCase() : trimmed.toLowerCase();
}

function parseLimit(value: string | null): number | null {
  const parsed = parsePositiveInteger(value);
  return parsed !== null && parsed <= 300 ? parsed : null;
}

function normalizeModality(filters: ReportingBoardFilters): ReportingBoardFilters {
  const next = { ...filters };
  const modalityId = typeof next.modalityId === "number" && Number.isSafeInteger(next.modalityId) && next.modalityId > 0 ? next.modalityId : null;
  const modalityCode = safeCode(typeof next.modalityCode === "string" ? next.modalityCode : null, true);
  if (modalityId !== null) {
    next.modalityId = modalityId;
    next.modalityCode = null;
  } else {
    next.modalityId = null;
    next.modalityCode = modalityCode;
  }
  return next;
}

function normalizeDateRange(filters: ReportingBoardFilters): ReportingBoardFilters {
  const next = { ...filters };
  if (!isIsoDate(next.dateFrom)) next.dateFrom = next.dateFrom == null ? next.dateFrom : null;
  if (!isIsoDate(next.dateTo)) next.dateTo = next.dateTo == null ? next.dateTo : null;
  if (isIsoDate(next.dateFrom) && isIsoDate(next.dateTo) && next.dateTo < next.dateFrom) next.dateTo = next.dateFrom;
  return next;
}

function normalizeFilters(filters: ReportingBoardFilters): ReportingBoardFilters {
  const next = normalizeDateRange(normalizeModality(filters));
  if (next.assignedDoctorId === undefined) next.assignedDoctorId = null;
  if (next.finalizedByDoctorId === undefined) next.finalizedByDoctorId = null;
  return next;
}

function baselineFilters(context: ReportingBoardNavigationContext): ReportingBoardFilters {
  return normalizeFilters({ ...context.defaultFilters, ...(context.savedViewFilters ?? {}) });
}

function setOverride(
  state: ReportingBoardFilters,
  overrides: Partial<ReportingBoardFilters>,
  key: keyof ReportingBoardFilters,
  value: ReportingBoardFilters[keyof ReportingBoardFilters],
): void {
  state[key] = value as never;
  overrides[key] = value as never;
}

export function parseReportingBoardNavigation(
  params: URLSearchParams,
  context: ReportingBoardNavigationContext,
): ReportingBoardNavigationState {
  const filters = baselineFilters(context);
  const urlOverrides: Partial<ReportingBoardFilters> = {};
  let hasSafeOverride = false;

  const dateFrom = isIsoDate(params.get("dateFrom")) ? params.get("dateFrom")! : null;
  const dateTo = isIsoDate(params.get("dateTo")) ? params.get("dateTo")! : null;
  const dateFromCleared = params.has("dateFrom") && params.get("dateFrom") === "";
  const dateToCleared = params.has("dateTo") && params.get("dateTo") === "";
  if (dateFromCleared) {
    filters.dateFrom = null;
    filters.cutoffDate = null;
    urlOverrides.dateFrom = null;
    hasSafeOverride = true;
  }
  if (dateToCleared) {
    filters.dateTo = null;
    urlOverrides.dateTo = null;
    hasSafeOverride = true;
  }
  if (dateFrom) {
    setOverride(filters, urlOverrides, "dateFrom", dateFrom);
    hasSafeOverride = true;
  }
  if (dateTo) {
    setOverride(filters, urlOverrides, "dateTo", dateTo);
    hasSafeOverride = true;
  }

  const modalityId = parsePositiveInteger(params.get("modalityId"));
  const modalityCode = safeCode(params.get("modalityCode"), true);
  const modalityIdCleared = params.has("modalityId") && params.get("modalityId") === "";
  const modalityCodeCleared = params.has("modalityCode") && params.get("modalityCode") === "";
  if (modalityId !== null) {
    setOverride(filters, urlOverrides, "modalityId", modalityId);
    filters.modalityCode = null;
    urlOverrides.modalityCode = null;
    hasSafeOverride = true;
  } else if (modalityCode !== null) {
    setOverride(filters, urlOverrides, "modalityCode", modalityCode);
    filters.modalityId = null;
    urlOverrides.modalityId = null;
    hasSafeOverride = true;
  } else if (modalityIdCleared || modalityCodeCleared) {
    filters.modalityId = null;
    filters.modalityCode = null;
    urlOverrides.modalityId = null;
    urlOverrides.modalityCode = null;
    hasSafeOverride = true;
  }

  const assignmentStatus = isOneOf(params.get("assignmentStatus"), ASSIGNMENT_STATUSES) ? params.get("assignmentStatus")! as ReportingBoardFilters["assignmentStatus"] : null;
  const assignedDoctorId = parsePositiveInteger(params.get("assignedDoctorId"));
  const assignedDoctorIdCleared = params.has("assignedDoctorId") && params.get("assignedDoctorId") === "";
  if (assignmentStatus) {
    setOverride(filters, urlOverrides, "assignmentStatus", assignmentStatus);
    if (assignmentStatus !== "assigned") {
      filters.assignedDoctorId = null;
      urlOverrides.assignedDoctorId = null;
    } else if (filters.assignedDoctorId == null) {
      filters.assignedDoctorId = null;
    }
    hasSafeOverride = true;
  }
  if (assignedDoctorId !== null) {
    setOverride(filters, urlOverrides, "assignedDoctorId", assignedDoctorId);
    filters.assignmentStatus = "assigned";
    urlOverrides.assignmentStatus = "assigned";
    hasSafeOverride = true;
  } else if (assignedDoctorIdCleared) {
    setOverride(filters, urlOverrides, "assignedDoctorId", null);
    hasSafeOverride = true;
  }

  const finalizedByDoctorId = parsePositiveInteger(params.get("finalizedByDoctorId"));
  const finalizedByDoctorIdCleared = params.has("finalizedByDoctorId") && params.get("finalizedByDoctorId") === "";
  if (finalizedByDoctorId !== null) {
    setOverride(filters, urlOverrides, "finalizedByDoctorId", finalizedByDoctorId);
    hasSafeOverride = true;
  } else if (finalizedByDoctorIdCleared) {
    setOverride(filters, urlOverrides, "finalizedByDoctorId", null);
    hasSafeOverride = true;
  }

  const parsedAssignmentMatch = isOneOf(params.get("assignmentMatch"), ASSIGNMENT_MATCHES) ? params.get("assignmentMatch")! : null;
  if (parsedAssignmentMatch) {
    setOverride(filters, urlOverrides, "assignmentMatch", parsedAssignmentMatch);
    hasSafeOverride = true;
  }

  const parsedReportStatus = isOneOf(params.get("reportStatus"), REPORT_STATUSES) ? params.get("reportStatus")! : null;
  if (parsedReportStatus) {
    setOverride(filters, urlOverrides, "reportStatus", parsedReportStatus);
    hasSafeOverride = true;
  }

  const parsedCaseSource = isOneOf(params.get("caseSource"), CASE_SOURCES) ? params.get("caseSource")! : null;
  if (parsedCaseSource) {
    setOverride(filters, urlOverrides, "caseSource", parsedCaseSource);
    hasSafeOverride = true;
  }

  const category = isOneOf(params.get("category"), CATEGORIES) ? params.get("category")! : null;
  if (category) {
    setOverride(filters, urlOverrides, "caseCategory", category);
    hasSafeOverride = true;
  } else if (params.has("category") && params.get("category") === "") {
    setOverride(filters, urlOverrides, "caseCategory", null);
    hasSafeOverride = true;
  }

  const priorityCode = safeCode(params.get("priorityCode"), false);
  if (priorityCode) {
    setOverride(filters, urlOverrides, "priorityCode", priorityCode);
    hasSafeOverride = true;
  } else if (params.has("priorityCode") && params.get("priorityCode") === "") {
    setOverride(filters, urlOverrides, "priorityCode", null);
    hasSafeOverride = true;
  }

  const parsedSortBy = isOneOf(params.get("sortBy"), SORT_BY) ? params.get("sortBy")! : null;
  if (parsedSortBy) {
    setOverride(filters, urlOverrides, "sortBy", parsedSortBy);
    hasSafeOverride = true;
  }

  const parsedSortDirection = isOneOf(params.get("sortDirection"), SORT_DIRECTIONS) ? params.get("sortDirection")! : null;
  if (parsedSortDirection) {
    setOverride(filters, urlOverrides, "sortDirection", parsedSortDirection);
    hasSafeOverride = true;
  }

  const pinUrgentToTop = params.get("pinUrgentToTop");
  if (pinUrgentToTop === "true" || pinUrgentToTop === "false") {
    setOverride(filters, urlOverrides, "pinUrgentToTop", pinUrgentToTop === "true");
    hasSafeOverride = true;
  }

  const limit = parseLimit(params.get("limit"));
  if (limit !== null) {
    setOverride(filters, urlOverrides, "limit", limit);
    hasSafeOverride = true;
  }

  const normalized = normalizeFilters(filters);
  if (hasSafeOverride) normalized.offset = 0;
  return { filters: normalized, urlOverrides };
}

function isSameValue(left: unknown, right: unknown): boolean {
  return left === right || (left == null && right == null);
}

function setIfDifferent(
  params: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
  baseline: unknown,
): void {
  if (value === null || value === undefined || value === "" || isSameValue(value, baseline)) {
    params.delete(key);
    return;
  }
  params.set(key, String(value));
}

function setNullableOverride(
  params: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
  baseline: unknown,
  explicitClear: boolean,
): void {
  if (explicitClear && (value === null || value === undefined)) {
    params.set(key, "");
    return;
  }
  setIfDifferent(params, key, value, baseline);
}

export function buildReportingBoardSearch(
  current: URLSearchParams,
  patch: Partial<ReportingBoardFilters> = {},
  context: ReportingBoardNavigationContext,
): URLSearchParams {
  const parsed = parseReportingBoardNavigation(current, context);
  const next = { ...parsed.filters, ...patch };
  if (patch.modalityId != null) next.modalityCode = null;
  else if (patch.modalityCode != null) next.modalityId = null;
  else if (Object.prototype.hasOwnProperty.call(patch, "modalityId") || Object.prototype.hasOwnProperty.call(patch, "modalityCode")) {
    next.modalityId = null;
    next.modalityCode = null;
  }
  const filters = normalizeFilters(next);
  const baseline = baselineFilters(context);
  const output = new URLSearchParams();
  const patchHas = (key: keyof ReportingBoardFilters) => Object.prototype.hasOwnProperty.call(patch, key);
  const currentHasEmpty = (key: string) => current.has(key) && current.get(key) === "";

  setNullableOverride(output, "dateFrom", filters.dateFrom, baseline.dateFrom, currentHasEmpty("dateFrom") || (patchHas("dateFrom") && patch.dateFrom == null && baseline.dateFrom != null));
  setNullableOverride(output, "dateTo", filters.dateTo, baseline.dateTo, currentHasEmpty("dateTo") || (patchHas("dateTo") && patch.dateTo == null && baseline.dateTo != null));
  setNullableOverride(output, "modalityId", filters.modalityId, baseline.modalityId, currentHasEmpty("modalityId") || (patchHas("modalityId") && patch.modalityId == null && baseline.modalityId != null));
  setNullableOverride(output, "modalityCode", filters.modalityCode, baseline.modalityCode, currentHasEmpty("modalityCode") || (patchHas("modalityCode") && patch.modalityCode == null && baseline.modalityCode != null));
  setNullableOverride(output, "assignedDoctorId", filters.assignedDoctorId, baseline.assignedDoctorId, currentHasEmpty("assignedDoctorId") || (patchHas("assignedDoctorId") && patch.assignedDoctorId == null && baseline.assignedDoctorId != null));
  setNullableOverride(output, "finalizedByDoctorId", filters.finalizedByDoctorId, baseline.finalizedByDoctorId, currentHasEmpty("finalizedByDoctorId") || (patchHas("finalizedByDoctorId") && patch.finalizedByDoctorId == null && baseline.finalizedByDoctorId != null));
  setIfDifferent(output, "assignmentStatus", filters.assignmentStatus, baseline.assignmentStatus);
  setIfDifferent(output, "assignmentMatch", filters.assignmentMatch, baseline.assignmentMatch);
  setIfDifferent(output, "reportStatus", filters.reportStatus, baseline.reportStatus);
  setIfDifferent(output, "caseSource", filters.caseSource, baseline.caseSource);
  setNullableOverride(output, "category", filters.caseCategory, baseline.caseCategory, currentHasEmpty("category") || (patchHas("caseCategory") && patch.caseCategory == null && baseline.caseCategory != null));
  setNullableOverride(output, "priorityCode", filters.priorityCode, baseline.priorityCode, currentHasEmpty("priorityCode") || (patchHas("priorityCode") && patch.priorityCode == null && baseline.priorityCode != null));
  setIfDifferent(output, "sortBy", filters.sortBy, baseline.sortBy);
  setIfDifferent(output, "sortDirection", filters.sortDirection, baseline.sortDirection);
  setIfDifferent(output, "pinUrgentToTop", filters.pinUrgentToTop, baseline.pinUrgentToTop);
  setIfDifferent(output, "limit", filters.limit, baseline.limit);
  return output;
}

export function sanitizeReportingBoardSearch(
  current: URLSearchParams,
  context: ReportingBoardNavigationContext,
): URLSearchParams {
  return buildReportingBoardSearch(current, {}, context);
}
