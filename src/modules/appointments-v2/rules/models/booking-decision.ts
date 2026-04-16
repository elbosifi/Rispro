/**
 * Appointments V2 — Booking decision model.
 *
 * Pure type definitions. No side effects.
 * See D008 for rule precedence.
 */

import type { DecisionStatus, ReasonCode, CaseCategory, CapacityResolutionMode } from "../../shared/types/common.js";

export interface BookingDecisionInput {
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

export interface BookingDecision {
  isAllowed: boolean;
  requiresSupervisorOverride: boolean;
  displayStatus: DecisionStatus;
  suggestedBookingMode: "standard" | "special" | "override";
  consumedCapacityMode: "standard" | "special" | "override" | null;
  remainingStandardCapacity: number | null;
  remainingSpecialQuota: number | null;
  matchedRuleIds: number[];
  reasons: ReasonCode[];
  policyVersionRef: {
    policySetKey: string;
    versionId: number;
    versionNo: number;
    configHash: string;
  };
  decisionTrace: {
    evaluatedAt: string;
    input: BookingDecisionInput;
  };
}
