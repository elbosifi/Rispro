export type CaseCategory = "oncology" | "non_oncology";
export type SuggestedBookingMode = "standard" | "special" | "override" | null;
export type DisplayStatus = "available" | "restricted" | "blocked";
export type RuleType = "specific_date" | "date_range" | "yearly_recurrence" | "weekly_recurrence";

export interface SchedulingCandidateInput {
  patientId: number | null;
  modalityId: number;
  examTypeId: number | null;
  scheduledDate: string;
  scheduledTime?: string | null;
  caseCategory: CaseCategory;
  requestedByUserId: number;
  useSpecialQuota: boolean;
  specialReasonCode: string | null;
  specialReasonNote?: string | null;
  includeOverrideEvaluation: boolean;
  appointmentId?: number | null;
}

export interface SchedulingIntegrity {
  modalityExists: boolean;
  examTypeExists: boolean;
  examTypeBelongsToModality: boolean;
  malformedRuleConfig: boolean;
}

export interface ModalityBlockedRule {
  id: number;
  ruleType: "specific_date" | "date_range" | "yearly_recurrence";
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  recurStartMonth: number | null;
  recurStartDay: number | null;
  recurEndMonth: number | null;
  recurEndDay: number | null;
  isOverridable: boolean;
}

export interface ExamTypeScheduleRule {
  id: number;
  ruleType: "specific_date" | "date_range" | "weekly_recurrence";
  effectMode: "hard_restriction" | "restriction_overridable";
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  allowedExamTypeIds: number[];
}

export interface SchedulingCapacityContext {
  standardDailyCapacity: number | null;
  categoryLimits: {
    oncology: number | null;
    nonOncology: number | null;
  };
  bookedTotals: {
    total: number;
    oncology: number;
    nonOncology: number;
  };
  specialQuotaLimit: number | null;
  specialQuotaConsumed: number;
}

export interface SchedulingDecisionContext {
  integrity: SchedulingIntegrity;
  blockedRules: ModalityBlockedRule[];
  examTypeRules: ExamTypeScheduleRule[];
  capacity: SchedulingCapacityContext;
}

export interface SchedulingResult {
  isAllowed: boolean;
  requiresSupervisorOverride: boolean;
  blockReasons: string[];
  matchedRuleIds: number[];
  remainingCategoryCapacity: {
    oncology: number | null;
    nonOncology: number | null;
  };
  remainingSpecialQuota: number | null;
  consumedCapacityMode: SuggestedBookingMode;
  suggestedBookingMode: SuggestedBookingMode;
  displayStatus: DisplayStatus;
  evaluationSnapshot: Record<string, unknown>;
}
