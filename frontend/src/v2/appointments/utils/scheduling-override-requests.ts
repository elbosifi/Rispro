import type { Role } from "@/types/api";
import type { SchedulingDecisionDto, SchedulingOverrideType } from "../types";

const SUPPORTED_OVERRIDE_TYPES = new Set<SchedulingOverrideType>([
  "closed_weekday_override",
  "category_override",
  "exam_mix_override",
  "total_capacity_override",
]);

export function inferSupportedOverrideType(reasonCodes: readonly string[] | undefined): SchedulingOverrideType | null {
  const codes = new Set(reasonCodes ?? []);
  const closed =
    codes.has("closed_weekday_override_required") ||
    codes.has("closed_weekday_override_forbidden");
  const total =
    codes.has("total_capacity_override_required") ||
    codes.has("total_capacity_override_forbidden") ||
    codes.has("modality_daily_capacity_exhausted");
  const category =
    codes.has("category_override_required") ||
    codes.has("category_override_forbidden") ||
    codes.has("category_capacity_exhausted");
  const examMix = codes.has("exam_mix_quota_exhausted");

  if ([closed, total, category, examMix].filter(Boolean).length > 1) return null;
  if (total) return "total_capacity_override";
  if (category) return "category_override";
  if (examMix) return "exam_mix_override";
  if (closed) return "closed_weekday_override";
  return null;
}

export function inferSupportedOverrideTypeFromDecision(decision: SchedulingDecisionDto | null | undefined): SchedulingOverrideType | null {
  return inferSupportedOverrideType(decision?.reasons?.map((reason) => reason.code));
}

export function formatOverrideType(type: SchedulingOverrideType | string | null | undefined): string {
  switch (type) {
    case "closed_weekday_override":
      return "Closed weekday override";
    case "category_override":
      return "Category capacity override";
    case "exam_mix_override":
      return "Exam mix override";
    case "total_capacity_override":
      return "Total modality capacity override";
    default:
      return "Scheduling override";
  }
}

export function formatRequestType(type: string): string {
  return type === "reschedule_booking" ? "Reschedule booking" : "Create booking";
}

export function canRoleApproveSchedulingOverride(role: Role | undefined, overrideType: SchedulingOverrideType): boolean {
  if (role === "super_admin") return true;
  if (role !== "supervisor") return false;
  return overrideType === "closed_weekday_override" || overrideType === "category_override" || overrideType === "exam_mix_override";
}

export function approvalNoteRequiredForOverride(type: SchedulingOverrideType | string | null | undefined): boolean {
  return type === "total_capacity_override" || type === "closed_weekday_override";
}

export function isSupportedOverrideType(value: string | null | undefined): value is SchedulingOverrideType {
  return SUPPORTED_OVERRIDE_TYPES.has(value as SchedulingOverrideType);
}

export function overrideFailureMessage(message?: string | null): string {
  const text = String(message ?? "").trim();
  if (text.toLowerCase().includes("different or stronger override") || text.toLowerCase().includes("state has changed")) {
    return "The scheduling state has changed. This request can no longer be approved with the original override type.";
  }
  return text || "The request could not be completed.";
}
