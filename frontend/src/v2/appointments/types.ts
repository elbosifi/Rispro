/**
 * Appointments V2 — Frontend types.
 *
 * Mirrors the backend V2 DTOs from `src/modules/appointments-v2/api/dto/`.
 */

export type CaseCategory = "oncology" | "non_oncology";
export type CapacityResolutionMode = "standard" | "category_override" | "total_capacity_override" | "special_quota_extra";
export type SchedulingOverrideRequestType = "create_booking" | "reschedule_booking";
export type SchedulingOverrideType = "closed_weekday_override" | "category_override" | "exam_mix_override" | "total_capacity_override";
export type SchedulingOverrideRequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "failed" | "expired";
export type DecisionStatus = "available" | "restricted" | "blocked";
export type BookingStatus =
  | "scheduled"
  | "arrived"
  | "waiting"
  | "completed"
  | "discontinued"
  | "no-show"
  | "cancelled"
  | "voided";

/**
 * Booking statuses that allow rescheduling.
 *
 * Mirrors the backend `RESCHEDULABLE_STATUSES` from
 * `src/modules/appointments-v2/shared/types/common.ts`.
 * Keep in sync — a unit test verifies both copies match.
 */
export const RESCHEDULABLE_STATUSES: readonly BookingStatus[] = [
  "scheduled",
  "arrived",
  "waiting",
];

/**
 * Booking statuses that allow cancellation.
 *
 * Mirrors the backend `CANCELLABLE_STATUSES` from
 * `src/modules/appointments-v2/shared/types/common.ts`.
 * Keep in sync — a unit test verifies both copies match.
 */
export const CANCELLABLE_STATUSES: readonly BookingStatus[] = [
  "scheduled",
  "arrived",
  "waiting",
];

export interface DecisionReason {
  code: string;
  severity: "error" | "warning";
  message: string;
  ruleRef?: { type: string; id: number };
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
  matchedExamRuleSummaries?: Array<{
    ruleId: string;
    title: string;
    ruleType: string;
    effectMode: string;
    isBlocking: boolean;
  }>;
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
  rowDisplayStatus?: "available" | "restricted" | "blocked" | "full";
  decision: SchedulingDecisionDto;
}

export interface AvailabilityResponse {
  items: AvailabilityDayDto[];
  meta?: {
    noPublishedPolicy?: boolean;
  };
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
  capacityResolutionMode?: CapacityResolutionMode;
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
  requiresReport?: boolean;
  studyInstanceUid?: string | null;
  capacityResolutionMode?: CapacityResolutionMode;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  notes: string | null;
  isWalkIn?: boolean;
  noShowAuthorizationReason?: string | null;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
    overrideType?: SchedulingOverrideType;
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
    requiresReport?: boolean;
    studyInstanceUid?: string | null;
    status: BookingStatus;
    notes: string | null;
    policyVersionId: number;
    capacityResolutionMode: CapacityResolutionMode;
    usesSpecialQuota: boolean;
    createdAt: string;
    updatedAt: string;
  };
  decision: unknown;
  wasOverride: boolean;
}

export interface ModalityDto {
  id: number;
  name: string;
  nameAr: string;
  nameEn: string;
  code: string;
  dailyCapacity?: number | null;
  isActive: boolean;
  safetyWarningEn: string | null;
  safetyWarningAr: string | null;
  safetyWarningEnabled: boolean;
}

export interface ExamTypeDto {
  id: number;
  name: string;
  nameAr?: string | null;
  nameEn?: string | null;
  code: string;
  modalityId: number | null;
  isActive: boolean;
}

export interface LookupsResponse {
  modalities: ModalityDto[];
  examTypes: ExamTypeDto[];
}

export interface SpecialReasonCodeDto {
  code: string;
  labelAr: string;
  labelEn: string;
  isActive: boolean;
}

export interface BookingWithPatientInfo {
  id: number;
  patientId: number;
  modalityId: number;
  examTypeId: number | null;
  reportingPriorityId: number | null;
  bookingDate: string;
  bookingTime: string | null;
  caseCategory: CaseCategory;
  requiresReport?: boolean;
  studyInstanceUid?: string | null;
  status: BookingStatus;
  notes: string | null;
  policyVersionId: number;
  createdAt: string;
  createdByUserId: number | null;
  createdByRole?: string | null;
  canBypassExamTypeChangeSupervisorAuth?: boolean;
  updatedAt: string;
  updatedByUserId: number | null;
  patientArabicName: string | null;
  patientEnglishName: string | null;
  patientNationalId: string | null;
  patientIdentifierValue: string | null;
  modalityName: string | null;
  examTypeName: string | null;
}

export interface ListBookingsResponse {
  bookings: BookingWithPatientInfo[];
}

export interface ListBookingsParams {
  modalityId: number;
  dateFrom: string;
  dateTo: string;
  limit?: number;
  offset?: number;
  includeCancelled?: boolean;
}

export interface RescheduleBookingRequest {
  bookingDate: string;
  bookingTime: string | null;
  examTypeId?: number | null;
  requiresReport?: boolean;
  studyInstanceUid?: string | null;
  capacityResolutionMode?: CapacityResolutionMode;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  rescheduleReason?: string | null;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
    overrideType?: SchedulingOverrideType;
  };
}

export interface RescheduleBookingResponse {
  booking: {
    id: number;
    patientId: number;
    modalityId: number;
    examTypeId: number | null;
    reportingPriorityId: number | null;
    bookingDate: string;
    bookingTime: string | null;
    caseCategory: CaseCategory;
    requiresReport?: boolean;
    studyInstanceUid?: string | null;
    status: BookingStatus;
    notes: string | null;
    policyVersionId: number;
    capacityResolutionMode: CapacityResolutionMode;
    usesSpecialQuota: boolean;
    createdAt: string;
    updatedAt: string;
  };
  decision: unknown;
  wasOverride: boolean;
  previousDate: string;
}

export interface SchedulingOverrideStoredPayload {
  version: 1;
  requestType: SchedulingOverrideRequestType;
  policySetKey?: string;
  bookingId?: number | null;
  createPayload?: Partial<CreateBookingRequest>;
  reschedulePayload?: Partial<RescheduleBookingRequest>;
}

export interface SchedulingOverrideRequestDto {
  id: number | string;
  requestType: SchedulingOverrideRequestType;
  overrideType: SchedulingOverrideType;
  status: SchedulingOverrideRequestStatus;
  requesterUserId: number | string;
  approverUserId: number | string | null;
  patientId: number | string;
  modalityId: number | string;
  examTypeId: number | string | null;
  requestedBookingDate: string;
  requestedBookingTime: string | null;
  bookingId: number | string | null;
  requestedPolicyVersionId: number | string | null;
  approvedPolicyVersionId: number | string | null;
  requestPayloadJson: SchedulingOverrideStoredPayload;
  originalDecisionSnapshotJson: SchedulingDecisionDto | Record<string, unknown>;
  approvalDecisionSnapshotJson: SchedulingDecisionDto | Record<string, unknown> | null;
  requesterReason: string;
  approverReason: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  expiresAt: string;
  createdFromContext: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  patientDisplayName?: string | null;
  patientIdentifier?: string | null;
  modalityName?: string | null;
  modalityCode?: string | null;
  examTypeName?: string | null;
  requesterDisplayName?: string | null;
  requesterUsername?: string | null;
  approverDisplayName?: string | null;
  approverUsername?: string | null;
}

export interface CreateSchedulingOverrideRequestInput {
  requestType: SchedulingOverrideRequestType;
  bookingId?: number | null;
  requestPayload: Record<string, unknown>;
  requesterReason: string;
  createdFromContext?: string | null;
}

export interface SchedulingOverrideRequestFilters {
  status?: SchedulingOverrideRequestStatus;
  requestType?: SchedulingOverrideRequestType;
  overrideType?: SchedulingOverrideType;
  modalityId?: number;
  requestedBookingDate?: string;
}

export interface FieldValidationErrorDto {
  field: string;
  code: string;
  message: string;
}

export interface PolicyCategoryDailyLimitDto {
  id: number;
  modalityId: number;
  caseCategory: "oncology" | "non_oncology";
  dailyLimit: number;
  isActive: boolean;
}

export interface PolicyModalityBlockedRuleDto {
  id: number;
  modalityId: number;
  ruleType: "specific_date" | "date_range" | "yearly_recurrence";
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

export interface PolicyExamTypeRuleDto {
  id: number;
  modalityId: number;
  ruleType: "specific_date" | "date_range" | "weekly_recurrence";
  effectMode: "hard_restriction" | "restriction_overridable";
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  examTypeIds: number[];
  title: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface PolicyExamTypeSpecialQuotaDto {
  id: number;
  examTypeId: number;
  dailyExtraSlots: number;
  allowedUserIds: number[];
  isActive: boolean;
}

export interface PolicyUserDto {
  id: number;
  username: string;
  fullName: string;
  role: import("@/types/api").Role;
  isActive?: boolean;
}

export interface PolicyExamMixQuotaRuleDto {
  id: number;
  modalityId: number;
  title: string | null;
  ruleType: "specific_date" | "date_range" | "weekly_recurrence";
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  dailyLimit: number;
  examTypeIds: number[];
  isActive: boolean;
}

export interface PolicySpecialReasonCodeDto {
  code: string;
  labelAr: string;
  labelEn: string;
  isActive: boolean;
}

export interface PolicySnapshotDto {
  categoryDailyLimits: PolicyCategoryDailyLimitDto[];
  modalityBlockedRules: PolicyModalityBlockedRuleDto[];
  examTypeRules: PolicyExamTypeRuleDto[];
  examTypeSpecialQuotas: PolicyExamTypeSpecialQuotaDto[];
  examMixQuotaRules?: PolicyExamMixQuotaRuleDto[];
  specialReasonCodes: PolicySpecialReasonCodeDto[];
}

export interface PolicySetDto {
  id: number;
  key: string;
  name: string;
}

export interface PolicyVersionDto {
  id: number;
  policySetId: number;
  versionNo: number;
  status: "draft" | "published" | "archived";
  configHash: string;
  changeNote: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface PolicyDisplayLookupsDto {
  modalities: Array<Pick<ModalityDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "isActive">>;
  examTypes: Array<Pick<ExamTypeDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "modalityId" | "isActive">>;
  users: Array<PolicyUserDto & { isActive: boolean }>;
}

export interface PolicyStatusDto {
  policySet: PolicySetDto | null;
  published: PolicyVersionDto | null;
  draft: PolicyVersionDto | null;
  publishedSnapshot: PolicySnapshotDto;
  draftSnapshot: PolicySnapshotDto;
  displayLookups: PolicyDisplayLookupsDto;
}

export interface PolicyRuleDiffDto {
  id: number;
  ruleType: string;
  modalityId: number | null;
  caseCategory: string | null;
  dailyLimit: number | null;
  isActive: boolean;
}

export interface PolicyPreviewDto {
  draftVersionId: number;
  publishedVersionId: number | null;
  addedRulesCount: number;
  removedRulesCount: number;
  modifiedRulesCount: number;
  addedRules: PolicyRuleDiffDto[];
  removedRules: PolicyRuleDiffDto[];
  modifiedRules: Array<{ draft: PolicyRuleDiffDto; published: PolicyRuleDiffDto }>;
  warnings: string[];
}
