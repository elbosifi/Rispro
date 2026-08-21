import type { BookingDecision } from "../../rules/models/booking-decision.js";
import type { CapacityResolutionMode, SchedulingOverrideType } from "../../shared/types/common.js";
import type { Role } from "../../../../types/domain.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

const SCHEDULING_OVERRIDE_TYPE_ORDER: readonly SchedulingOverrideType[] = [
  "total_capacity_override",
  "category_override",
  "exam_mix_override",
  "closed_weekday_override",
  "modality_block_override",
  "exam_restriction_override",
];

export function normalizeSchedulingOverrideTypes(
  types: readonly SchedulingOverrideType[]
): SchedulingOverrideType[] {
  const normalized = new Set(types);
  if (normalized.has("total_capacity_override")) normalized.delete("category_override");
  return SCHEDULING_OVERRIDE_TYPE_ORDER.filter((type) => normalized.has(type));
}

export function resolveRequiredOverrideTypes(
  decision: BookingDecision,
  capacityResolutionMode: CapacityResolutionMode
): SchedulingOverrideType[] {
  const reasonCodes = new Set(decision.reasons.map((reason) => reason.code));
  const required = new Set<SchedulingOverrideType>();

  if (reasonCodes.has("closed_weekday_override_required")) {
    required.add("closed_weekday_override");
  }
  if (capacityResolutionMode === "category_override") {
    required.add("category_override");
  }
  if (capacityResolutionMode === "total_capacity_override") {
    required.add("total_capacity_override");
  }
  if (reasonCodes.has("exam_mix_quota_exhausted")) {
    required.add("exam_mix_override");
  }
  if (reasonCodes.has("modality_blocked_overridable")) {
    required.add("modality_block_override");
  }
  if (
    decision.requiresSupervisorOverride &&
    decision.matchedExamRuleSummaries?.some((summary) => summary.effectMode === "restriction_overridable")
  ) {
    required.add("exam_restriction_override");
  }

  return normalizeSchedulingOverrideTypes([...required]);
}

export function validateFinalOverrideTypesConsistency(
  requiredOverrideTypes: readonly SchedulingOverrideType[],
  requestedOverrideTypes: readonly SchedulingOverrideType[]
): void {
  const finalTypes = normalizeSchedulingOverrideTypes(requiredOverrideTypes);
  const requestedTypes = normalizeSchedulingOverrideTypes(requestedOverrideTypes);

  if (finalTypes.length > 0 && requestedTypes.length === 0) {
    throw new SchedulingError(
      409,
      "The current scheduling state requires an explicit override type.",
      ["override_type_required"]
    );
  }

  if (finalTypes.length !== requestedTypes.length || finalTypes.some((type, index) => type !== requestedTypes[index])) {
    throw new SchedulingError(
      409,
      "The scheduling state has changed and requires a different override type.",
      ["override_type_mismatch"]
    );
  }
}

/** @deprecated Prefer the array-based validator. */
export function validateFinalOverrideTypeConsistency(
  requiredOverrideTypes: readonly SchedulingOverrideType[],
  requestedOverrideType: SchedulingOverrideType | null
): void {
  validateFinalOverrideTypesConsistency(requiredOverrideTypes, requestedOverrideType ? [requestedOverrideType] : []);
}

export function validateFinalOverrideRoleAuthority(
  requiredOverrideTypes: readonly SchedulingOverrideType[],
  role: Role | undefined
): void {
  const types = normalizeSchedulingOverrideTypes(requiredOverrideTypes);
  if (types.includes("total_capacity_override") && role !== "super_admin") {
    throw new SchedulingError(403, "Total capacity override requires Super Admin approval.", ["total_capacity_override_forbidden"]);
  }
  if (types.includes("exam_mix_override") && role !== "super_admin") {
    throw new SchedulingError(403, "Exam mix overbooking requires Super Admin approval.", ["exam_mix_override_forbidden"]);
  }
}

export function canRoleApproveSchedulingOverrideTypes(
  role: Role | undefined,
  types: readonly SchedulingOverrideType[]
): boolean {
  if (role === "super_admin") return true;
  if (role !== "supervisor") return false;
  return normalizeSchedulingOverrideTypes(types).every((type) =>
    type === "closed_weekday_override" || type === "category_override" || type === "exam_restriction_override" || type === "modality_block_override"
  );
}

export function validateCapacityModeAuthority(
  role: Role | undefined,
  capacityResolutionMode: CapacityResolutionMode
): void {
  if (capacityResolutionMode === "category_override") {
    if (role !== "supervisor" && role !== "super_admin") {
      throw new SchedulingError(403, "Category override is forbidden for this role.", ["category_override_forbidden"]);
    }
  }

  if (capacityResolutionMode === "total_capacity_override") {
    if (role !== "super_admin") {
      throw new SchedulingError(403, "Total capacity override is forbidden for this role.", ["total_capacity_override_forbidden"]);
    }
  }
}

export function validateDecisionAuthority(
  decision: BookingDecision,
  role: Role | undefined,
  capacityResolutionMode: CapacityResolutionMode
): void {
  const reasonCodes = new Set(decision.reasons.map((reason) => reason.code));

  if (reasonCodes.has("special_quota_forbidden")) {
    throw new SchedulingError(403, "Special quota is forbidden for this user.", ["special_quota_forbidden"]);
  }

  if (reasonCodes.has("closed_weekday_override_required")) {
    if (role !== "supervisor" && role !== "super_admin") {
      throw new SchedulingError(403, "Closed weekday override is forbidden for this role.", ["closed_weekday_override_forbidden"]);
    }
  }

  if (reasonCodes.has("category_capacity_exhausted")) {
    if (capacityResolutionMode !== "category_override" && capacityResolutionMode !== "total_capacity_override") {
      if (role !== "supervisor" && role !== "super_admin") {
        throw new SchedulingError(
          403,
          "Category override is forbidden for this role.",
          ["category_override_forbidden"]
        );
      }
      throw new SchedulingError(
        409,
        "Category capacity is exhausted. Category override is required.",
        ["category_override_required"]
      );
    }
  }

  if (reasonCodes.has("modality_daily_capacity_exhausted")) {
    if (capacityResolutionMode !== "total_capacity_override") {
      const code = role === "super_admin" ? "total_capacity_override_required" : "total_capacity_override_forbidden";
      throw new SchedulingError(
        role === "super_admin" ? 409 : 403,
        "Modality daily capacity is exhausted.",
        [code]
      );
    }
  }
}
