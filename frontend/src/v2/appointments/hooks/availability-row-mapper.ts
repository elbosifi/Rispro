import type { AvailabilityDayDto } from "../types";

export type AvailabilityRowStatus = "available" | "restricted" | "blocked" | "full";

export interface AvailabilityRowViewModel {
  date: string;
  dayLabel: string;
  status: AvailabilityRowStatus;
  remainingCapacity: number | null;
  dailyCapacity: number | null;
  reasonText: string;
  requiresSupervisorOverride: boolean;
}

function toDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-LY", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function getAvailabilityRowStatus(day: AvailabilityDayDto): AvailabilityRowStatus {
  if (day.rowDisplayStatus) return day.rowDisplayStatus;

  if (day.decision.displayStatus === "blocked") {
    const hasCapacityExhaustedReason = day.decision.reasons.some((r) => r.code === "standard_capacity_exhausted");
    return hasCapacityExhaustedReason ? "full" : "blocked";
  }

  return day.decision.displayStatus;
}

export function mapAvailabilityRow(day: AvailabilityDayDto): AvailabilityRowViewModel {
  const status = getAvailabilityRowStatus(day);
  const reasonText = day.decision.reasons[0]?.message ?? "";

  const hideRawCapacity = status === "blocked";

  return {
    date: day.date,
    dayLabel: toDayLabel(day.date),
    status,
    remainingCapacity: hideRawCapacity ? null : Math.max(0, day.remainingCapacity ?? day.decision.remainingStandardCapacity ?? 0),
    dailyCapacity: hideRawCapacity ? null : day.dailyCapacity,
    reasonText,
    requiresSupervisorOverride: day.decision.requiresSupervisorOverride,
  };
}
