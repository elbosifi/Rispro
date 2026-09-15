import { t, type Language, type TranslationKey } from "./i18n";

export const IR_REFERRAL_STATUSES = [
  "preparing",
  "ready_for_review",
  "needs_information",
  "appointment_requested",
  "scheduled",
  "not_suitable",
  "completed",
  "cancelled",
] as const;

export type IrReferralStatus = (typeof IR_REFERRAL_STATUSES)[number];

const STATUS_KEYS: Record<IrReferralStatus, TranslationKey> = {
  preparing: "irReferral.status.preparing",
  ready_for_review: "irReferral.status.readyForReview",
  needs_information: "irReferral.status.needsInformation",
  appointment_requested: "irReferral.status.appointmentRequested",
  scheduled: "irReferral.status.scheduled",
  not_suitable: "irReferral.status.notSuitable",
  completed: "irReferral.status.completed",
  cancelled: "irReferral.status.cancelled",
};

export function irReferralStatusLabel(language: Language, status: string): string {
  const key = STATUS_KEYS[status as IrReferralStatus];
  return key ? t(language, key) : t(language, "irReferral.status.unknown");
}

export function irReferralStatusVariant(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "completed" || status === "scheduled") return "success";
  if (status === "ready_for_review") return "info";
  if (status === "preparing" || status === "needs_information" || status === "appointment_requested") return "warning";
  if (status === "not_suitable" || status === "cancelled") return status === "not_suitable" ? "error" : "neutral";
  return "neutral";
}

const DECISION_KEYS: Record<string, TranslationKey> = {
  eligible_for_intervention: "irReferral.decision.eligibleForIntervention",
  needs_information: "irReferral.decision.needsInformation",
  not_suitable: "irReferral.decision.notSuitable",
};

export function irDecisionLabel(language: Language, decision: string | null): string {
  if (!decision) return t(language, "irReferral.decision.none");
  return t(language, DECISION_KEYS[decision] ?? "irReferral.decision.recorded");
}
