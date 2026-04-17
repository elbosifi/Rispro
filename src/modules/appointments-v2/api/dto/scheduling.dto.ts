/**
 * Appointments V2 — Scheduling DTOs.
 *
 * These DTOs follow D005: every scheduling response includes explicit status.
 */

import type {
  DecisionStatus,
  CaseCategory,
  ReasonCode,
  CapacityResolutionMode,
} from "../../shared/types/common.js";

// --- Request DTOs ---

export interface AvailabilityQueryDto {
  modalityId: number;
  days: number;
  offset?: number;
  examTypeId?: number | null;
  caseCategory: CaseCategory;
  capacityResolutionMode?: CapacityResolutionMode;
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
  capacityResolutionMode?: CapacityResolutionMode;
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
  matchedExamRuleSummaries?: Array<{
    ruleId: string;
    title: string;
    ruleType: string;
    effectMode: string;
    isBlocking: boolean;
  }>;
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
  bucketMode: "partitioned" | "total_only";
  modalityTotalCapacity: number;
  bookedTotal: number;
  oncology: {
    reserved: number | null;
    filled: number;
    remaining: number | null;
  };
  nonOncology: {
    reserved: number | null;
    filled: number;
    remaining: number | null;
  };
  specialQuotaSummary: {
    examTypeId: number;
    configured: number;
    consumed: number;
    remaining: number;
  } | null;
  examMixQuotaSummaries?: Array<{
    ruleId: number;
    title: string | null;
    dailyLimit: number;
    consumed: number;
    remaining: number;
    isBlocking: boolean;
    isPrimaryBlocking: boolean;
  }>;
  // Backward-compatible fields retained for existing clients.
  dailyCapacity: number;
  bookedCount: number;
  remainingCapacity: number;
  isFull: boolean;
  // UI-only row status for create/reschedule panels. Decision logic remains
  // authoritative in `decision.displayStatus`.
  rowDisplayStatus?: "available" | "restricted" | "blocked" | "full";
  decision: SchedulingDecisionDto;
}

export interface SuggestionDto {
  date: string;
  modalityId: number;
  decision: SchedulingDecisionDto;
}
