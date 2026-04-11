/**
 * Appointments V2 — Scheduling DTOs.
 *
 * These DTOs follow D005: every scheduling response includes explicit status.
 */

import type {
  DecisionStatus,
  CaseCategory,
  ReasonCode,
} from "../../shared/types/common.js";

// --- Request DTOs ---

export interface AvailabilityQueryDto {
  modalityId: number;
  days: number;
  offset?: number;
  examTypeId?: number | null;
  caseCategory: CaseCategory;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  includeOverrideCandidates?: boolean;
}

export interface SuggestionsQueryDto {
  modalityId: number;
  days: number;
  examTypeId?: number | null;
  caseCategory?: CaseCategory;
  includeOverrideCandidates?: boolean;
}

export interface EvaluateRequestDto {
  patientId: number;
  modalityId: number;
  examTypeId?: number | null;
  scheduledDate: string;
  caseCategory: CaseCategory;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  includeOverrideEvaluation?: boolean;
}

// --- Response DTOs ---

export interface SchedulingDecisionDto {
  isAllowed: boolean;
  requiresSupervisorOverride: boolean;
  displayStatus: DecisionStatus;
  suggestedBookingMode: "standard" | "special" | "override";
  consumedCapacityMode: "standard" | "special" | "override" | null;
  remainingStandardCapacity: number | null;
  remainingSpecialQuota: number | null;
  matchedRuleIds: number[];
  reasons: ReasonCode[];
  policy: {
    policySetKey: string;
    versionId: number;
    versionNo: number;
    configHash: string;
  };
  decisionTrace: {
    evaluatedAt: string;
    input: EvaluateRequestDto;
  };
}

export interface AvailabilityDayDto {
  date: string;
  dailyCapacity: number;
  bookedCount: number;
  remainingCapacity: number;
  isFull: boolean;
  decision: SchedulingDecisionDto;
}

export interface SuggestionDto {
  date: string;
  modalityId: number;
  decision: SchedulingDecisionDto;
}
