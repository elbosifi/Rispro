/**
 * Appointments V2 — Rule type definitions.
 *
 * Mirrors the legacy rule concepts but scoped to a policy version.
 */

export type ModalityRuleType =
  | "specific_date"
  | "date_range"
  | "yearly_recurrence";

export type ExamRuleType =
  | "specific_date"
  | "date_range"
  | "weekly_recurrence";

export type ExamMixQuotaRuleType =
  | "specific_date"
  | "date_range"
  | "weekly_recurrence";

export type ExamRuleEffectMode =
  | "hard_restriction"
  | "restriction_overridable";

export interface ModalityBlockedRuleRow {
  id: number;
  policyVersionId: number;
  modalityId: number;
  ruleType: ModalityRuleType;
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  recurStartMonth: number | null;
  recurStartDay: number | null;
  recurEndMonth: number | null;
  recurEndDay: number | null;
  isOverridable: boolean;
  isActive: boolean;
  title: string | null;
  notes: string | null;
}

export interface ExamTypeRuleRow {
  id: number;
  policyVersionId: number;
  modalityId: number;
  ruleType: ExamRuleType;
  effectMode: ExamRuleEffectMode;
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  title: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface ExamTypeRuleItemRow {
  ruleId: number;
  examTypeId: number;
}

export interface CategoryDailyLimitRow {
  id: number;
  policyVersionId: number;
  modalityId: number;
  caseCategory: "oncology" | "non_oncology";
  dailyLimit: number;
  isActive: boolean;
}

export interface ExamTypeSpecialQuotaRow {
  id: number;
  policyVersionId: number;
  examTypeId: number;
  dailyExtraSlots: number;
  isActive: boolean;
}

export interface ExamMixQuotaRuleRow {
  id: number;
  policyVersionId: number;
  modalityId: number;
  title: string | null;
  ruleType: ExamMixQuotaRuleType;
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  dailyLimit: number;
  isActive: boolean;
}

export interface ExamMixQuotaRuleItemRow {
  ruleId: number;
  examTypeId: number;
}
