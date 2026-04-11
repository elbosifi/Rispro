/**
 * Appointments V2 — Frontend types.
 *
 * Mirrors the backend V2 DTOs from `src/modules/appointments-v2/api/dto/`.
 */

export type CaseCategory = "oncology" | "non_oncology";
export type DecisionStatus = "available" | "restricted" | "blocked";
export type BookingStatus =
  | "scheduled"
  | "arrived"
  | "waiting"
  | "completed"
  | "no-show"
  | "cancelled";

export interface DecisionReason {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface SchedulingDecisionDto {
  isAllowed: boolean;
  requiresSupervisorOverride: boolean;
  displayStatus: DecisionStatus;
  suggestedBookingMode: "standard" | "special" | "override";
  consumedCapacityMode: "standard" | "special" | "override" | null;
  remainingStandardCapacity: number | null;
  remainingSpecialQuota: number | null;
  matchedRuleIds: number[];
  reasons: DecisionReason[];
  policy: {
    policySetKey: string;
    versionId: number;
    versionNo: number;
    configHash: string;
  };
  decisionTrace: {
    evaluatedAt: string;
    input: unknown;
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

export interface AvailabilityResponse {
  items: AvailabilityDayDto[];
}

export interface SuggestionDto {
  date: string;
  modalityId: number;
  decision: SchedulingDecisionDto;
}

export interface SuggestionsResponse {
  items: SuggestionDto[];
}

export interface EvaluateRequest {
  patientId: number;
  modalityId: number;
  examTypeId: number | null;
  scheduledDate: string;
  caseCategory: CaseCategory;
  useSpecialQuota: boolean;
  specialReasonCode: string | null;
  includeOverrideEvaluation: boolean;
}

export interface CreateBookingRequest {
  patientId: number;
  modalityId: number;
  examTypeId: number | null;
  reportingPriorityId: number | null;
  bookingDate: string;
  bookingTime: string | null;
  caseCategory: CaseCategory;
  notes: string | null;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
  };
}

export interface BookingResponse {
  booking: {
    id: number;
    patientId: number;
    modalityId: number;
    examTypeId: number | null;
    reportingPriorityId: number | null;
    bookingDate: string;
    bookingTime: string | null;
    caseCategory: CaseCategory;
    status: BookingStatus;
    notes: string | null;
    policyVersionId: number;
    createdAt: string;
    updatedAt: string;
  };
  decision: unknown;
  wasOverride: boolean;
}

export interface ModalityDto {
  id: number;
  name: string;
  code: string;
  isActive: boolean;
}

export interface ExamTypeDto {
  id: number;
  name: string;
  code: string;
  modalityId: number | null;
  isActive: boolean;
}

export interface LookupsResponse {
  modalities: ModalityDto[];
  examTypes: ExamTypeDto[];
}
