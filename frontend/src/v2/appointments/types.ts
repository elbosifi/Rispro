/**
 * Appointments V2 — Frontend types.
 *
 * Mirrors the backend V2 DTOs from `src/modules/appointments-v2/api/dto/`.
 */

export type CaseCategory = "oncology" | "non_oncology";
export type CapacityResolutionMode = "standard" | "category_override" | "total_capacity_override" | "special_quota_extra";
export type SchedulingOverrideRequestType = "create_booking" | "reschedule_booking";
export type SchedulingOverrideType = "closed_weekday_override" | "category_override" | "exam_mix_override" | "exam_restriction_override" | "total_capacity_override";
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
export type PatientIdentityRisk = "none" | "ambiguous";
export type PatientIdentityVerificationMethod = "primary_identifier" | "exact_dob" | "phone_suffix";

export interface AppointmentPatientSelection {
  id: number;
  arabicFullName: string;
  englishFullName: string | null;
  mrn: string | null;
  category: "oncology" | "non_oncology" | null;
  sex: string | null;
  estimatedDateOfBirth: string | null;
  demographicsEstimated: boolean;
  primaryIdentifierType: string | null;
  maskedPrimaryIdentifier: string | null;
  maskedPhone1: string | null;
  identityRisk: PatientIdentityRisk;
  similarPatientCount: number;
  availableVerificationMethods: PatientIdentityVerificationMethod[];
  ambiguityRuleVersion: "name_first_three_v1";
}

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
  matchedSpecialQuota?: {
    ruleId: number;
    logicalKey: string;
    title: string | null;
    modalityId: number;
    configured: number;
    consumed: number;
    remaining: number;
  } | null;
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
    ruleId: number;
    logicalKey: string;
    title: string | null;
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
  intendedReportingDoctorId?: number | null;
  intendedReportingDoctorReason?: string | null;
  studyInstanceUid?: string | null;
  capacityResolutionMode?: CapacityResolutionMode;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  notes: string | null;
  isWalkIn?: boolean;
  noShowAuthorizationReason?: string | null;
  patientIdentityVerificationProof?: string | null;
  patientIdentitySelectionSource?: "search" | "url_preselect";
  modalitySafetyAcknowledged?: boolean;
  mriPrimaryScreening?: { result: "no_known_implant_reported" | "implant_reported_review_required"; implantSite: string | null; implantDescription: string | null; previousReviewerNameReported: string | null } | null;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
    overrideType?: SchedulingOverrideType;
  };
}

export interface IntendedReportingDoctorOption {
  id: number;
  displayName: string;
  canFinalizeReports: boolean;
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
  safetyWorkflowType?: "standard_acknowledgement" | "mri_primary_implant_screening";
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
  requesterRole?: string | null;
  approverDisplayName?: string | null;
  approverUsername?: string | null;
  decisionContext?: {
    violatedRuleLabel: string | null;
    violatedRuleType: string | null;
    currentCapacity: number | null;
    totalCapacity: number | null;
    remainingCapacity: number | null;
    afterApprovalCapacity: number | null;
    overbookAmount: number | null;
    modalityCapacityBreakdown: {
      modalityId: number;
      modalityName: string | null;
      modalityCode: string | null;
      bookedTotal: number;
      totalCapacity: number | null;
    } | null;
    categoryBreakdown: Array<{
      caseCategory: "oncology" | "non_oncology";
      booked: number;
      limit: number | null;
      remaining: number | null;
    }> | null;
    specialQuotaBreakdown: {
      examTypeId: number;
      configured: number;
      consumed: number;
      remaining: number;
    } | null;
    sameDayAppointmentCount: number | null;
    sameDayAppointmentSummary: Array<{
      id: number;
      patientDisplayName: string | null;
      examTypeName: string | null;
      bookingTime: string | null;
      status: string;
      caseCategory: string | null;
    }> | null;
    patientPreviousNoShowCount: number | null;
    patientPreviousCancelledCount: number | null;
    patientFutureAppointmentCount: number | null;
    duplicateFutureAppointmentWarning: string | null;
    requester: {
      userId: number;
      name: string | null;
      username: string | null;
      role: string | null;
    };
    submittedAt: string;
    requestAgeMinutes: number | null;
    approvalNoteRequired: boolean;
    approvalConsequenceText: string | null;
  } | null;
}

export type SchedulingOverrideApprovalMode = "as_requested" | "changed_date";

export interface ApproveSchedulingOverrideRequestInput {
  approverReason?: string | null;
  approvalMode?: SchedulingOverrideApprovalMode;
  changedBookingDate?: string | null;
  changedBookingTime?: string | null;
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

export interface PolicySpecialQuotaRuleDto {
  id: number;
  logicalKey: string;
  modalityId: number;
  title: string | null;
  examTypeIds: number[];
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
  specialQuotaRules: PolicySpecialQuotaRuleDto[];
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
