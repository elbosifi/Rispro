import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import type { CapacityResolutionMode, CaseCategory } from "../../shared/types/common.js";

export interface ParsedEvaluateBookingDecisionRequestBody {
  patientId: number;
  modalityId: number;
  examTypeId: number | null;
  scheduledDate: string;
  caseCategory: CaseCategory;
  capacityResolutionMode: CapacityResolutionMode;
  useSpecialQuota: boolean;
  specialReasonCode: string | null;
  includeOverrideEvaluation: boolean;
  policySetKey: string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SchedulingError(400, "Request body must be an object");
  }
  return value as Record<string, unknown>;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (value === null || value === undefined || value === "") {
    throw new SchedulingError(400, `${fieldName} is required`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SchedulingError(400, `${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SchedulingError(400, `${fieldName} must be a positive integer or null`);
  }
  return parsed;
}

function parseScheduledDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SchedulingError(400, "scheduledDate must be a valid YYYY-MM-DD calendar date");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new SchedulingError(400, "scheduledDate must be a valid YYYY-MM-DD calendar date");
  }
  return value;
}

function parseCaseCategory(value: unknown): CaseCategory {
  if (value === "oncology" || value === "non_oncology") return value;
  throw new SchedulingError(400, "caseCategory must be oncology or non_oncology");
}

function parseStrictBoolean(value: unknown, fieldName: string): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new SchedulingError(400, `${fieldName} must be a boolean`);
}

function parseCapacityResolutionMode(value: unknown, useSpecialQuota: boolean): CapacityResolutionMode {
  if (value === undefined || value === null) {
    return useSpecialQuota ? "special_quota_extra" : "standard";
  }
  if (
    value === "standard" ||
    value === "category_override" ||
    value === "total_capacity_override" ||
    value === "special_quota_extra"
  ) {
    return value;
  }
  throw new SchedulingError(400, "capacityResolutionMode is invalid");
}

export function parseEvaluateBookingDecisionRequestBody(body: unknown): ParsedEvaluateBookingDecisionRequestBody {
  const record = asRecord(body);
  const useSpecialQuota = parseStrictBoolean(record.useSpecialQuota, "useSpecialQuota");

  return {
    patientId: parsePositiveInteger(record.patientId, "patientId"),
    modalityId: parsePositiveInteger(record.modalityId, "modalityId"),
    examTypeId: parseOptionalPositiveInteger(record.examTypeId, "examTypeId"),
    scheduledDate: parseScheduledDate(record.scheduledDate),
    caseCategory: parseCaseCategory(record.caseCategory),
    capacityResolutionMode: parseCapacityResolutionMode(record.capacityResolutionMode, useSpecialQuota),
    useSpecialQuota,
    specialReasonCode: record.specialReasonCode ? String(record.specialReasonCode) : null,
    includeOverrideEvaluation: parseStrictBoolean(record.includeOverrideEvaluation, "includeOverrideEvaluation"),
    policySetKey: record.policySetKey as string | undefined,
  };
}
