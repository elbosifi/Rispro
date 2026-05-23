import type { AvailabilityDayDto } from "../types";
import type { Language } from "@/lib/i18n";

export type AvailabilityRowStatus = "available" | "restricted" | "blocked" | "full";

export interface AvailabilityRowViewModel {
  date: string;
  dayLabel: string;
  status: AvailabilityRowStatus;
  bucketMode: "partitioned" | "total_only";
  remainingCapacity: number | null;
  dailyCapacity: number | null;
  oncologyReserved: number | null;
  oncologyFilled: number;
  oncologyRemaining: number | null;
  nonOncologyReserved: number | null;
  nonOncologyFilled: number;
  nonOncologyRemaining: number | null;
  specialQuotaRemaining: number | null;
  examMixQuotaSummaries?: Array<{
    ruleId: number;
    title: string | null;
    dailyLimit: number;
    consumed: number;
    remaining: number;
    isBlocking: boolean;
    isPrimaryBlocking: boolean;
  }>;
  primaryExamMixBlocking?: {
    ruleId: number;
    title: string | null;
    consumed: number;
    dailyLimit: number;
    remaining: number;
  } | null;
  matchedExamRuleSummary?: {
    ruleId: string;
    title: string;
    effectLabel: string;
    isBlocking: boolean;
  } | null;
  reasonText: string;
  requiresSupervisorOverride: boolean;
  reasonCodes?: string[];
  hideAlways?: boolean;
  isWeekend?: boolean;
}

export interface AvailabilityRowVisibilityOptions {
  showFullDays: boolean;
  showPolicyHiddenDays: boolean;
  selected?: boolean;
  requestableOverride?: boolean;
}

function toDayLabel(isoDate: string, language: Language): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString(language === "ar" ? "ar-LY" : "en-LY", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function isWeekendDate(isoDate: string): boolean {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay();
  return day === 5 || day === 6;
}

export function getAvailabilityRowStatus(day: AvailabilityDayDto): AvailabilityRowStatus {
  if (day.rowDisplayStatus && !(day.rowDisplayStatus === "full" && (day.remainingCapacity ?? 0) > 0)) {
    return day.rowDisplayStatus;
  }

  if (day.decision.displayStatus === "blocked") {
    const reasonCodes = new Set(day.decision.reasons.map((reason) => reason.code));
    if (reasonCodes.has("modality_daily_capacity_exhausted")) return "full";
    if (reasonCodes.has("category_capacity_exhausted")) return "restricted";
    return "blocked";
  }

  return day.decision.displayStatus;
}

export function mapAvailabilityRow(day: AvailabilityDayDto, language: Language): AvailabilityRowViewModel {
  const status = getAvailabilityRowStatus(day);
  const matchedExamRuleSummary =
    day.decision.matchedExamRuleSummaries && day.decision.matchedExamRuleSummaries.length > 0
      ? day.decision.matchedExamRuleSummaries[0]
      : null;
  const effectLabel =
    matchedExamRuleSummary?.effectMode === "hard_restriction"
      ? "Hard restriction"
      : matchedExamRuleSummary?.effectMode === "restriction_overridable"
      ? "Restricted unless supervisor approves"
      : matchedExamRuleSummary?.effectMode ?? "";
  const reasonText = matchedExamRuleSummary ? "" : day.decision.reasons[0]?.message ?? "";
  const reasonCodes = day.decision.reasons.map((reason) => reason.code);
  const isWeekend = isWeekendDate(day.date);
  const hideAlways = reasonCodes.includes("weekday_appointments_disabled");

  const hideRawCapacity = status === "blocked";

  return {
    date: day.date,
    dayLabel: toDayLabel(day.date, language),
    status,
    bucketMode: day.bucketMode ?? "total_only",
    remainingCapacity: hideRawCapacity ? null : Math.max(0, day.decision.remainingStandardCapacity ?? day.remainingCapacity ?? 0),
    dailyCapacity: hideRawCapacity ? null : (day.modalityTotalCapacity ?? day.dailyCapacity),
    oncologyReserved: day.oncology?.reserved ?? null,
    oncologyFilled: day.oncology?.filled ?? 0,
    oncologyRemaining: day.oncology?.remaining ?? null,
    nonOncologyReserved: day.nonOncology?.reserved ?? null,
    nonOncologyFilled: day.nonOncology?.filled ?? 0,
    nonOncologyRemaining: day.nonOncology?.remaining ?? null,
    specialQuotaRemaining: day.specialQuotaSummary?.remaining ?? null,
    examMixQuotaSummaries: day.examMixQuotaSummaries ?? [],
    primaryExamMixBlocking:
      (day.examMixQuotaSummaries ?? [])
        .filter((row) => row.isPrimaryBlocking)
        .map((row) => ({
          ruleId: row.ruleId,
          title: row.title,
          consumed: row.consumed,
          dailyLimit: row.dailyLimit,
          remaining: row.remaining,
        }))[0] ?? null,
    matchedExamRuleSummary: matchedExamRuleSummary
      ? {
          ruleId: matchedExamRuleSummary.ruleId,
          title: matchedExamRuleSummary.title,
          effectLabel,
          isBlocking: matchedExamRuleSummary.isBlocking,
        }
      : null,
    reasonText,
    requiresSupervisorOverride: day.decision.requiresSupervisorOverride,
    reasonCodes,
    hideAlways,
    isWeekend,
  };
}

export function isAvailabilityRowVisible(
  row: AvailabilityRowViewModel,
  options: AvailabilityRowVisibilityOptions
): boolean {
  if (options.selected) return true;
  if (row.status === "full") return options.showFullDays;
  if (row.hideAlways && !options.showPolicyHiddenDays) return false;
  return row.status === "available" || row.status === "restricted" || Boolean(options.requestableOverride);
}
