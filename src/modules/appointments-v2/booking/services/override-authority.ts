import type { BookingDecision } from "../../rules/models/booking-decision.js";
import type { CapacityResolutionMode, SchedulingOverrideType } from "../../shared/types/common.js";
import type { Role } from "../../../../types/domain.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

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

  return [...required];
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
