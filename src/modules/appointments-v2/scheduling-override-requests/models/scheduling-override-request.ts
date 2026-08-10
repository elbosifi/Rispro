import type { CapacityResolutionMode, SchedulingOverrideType } from "../../shared/types/common.js";
import type { CreateAppointmentDto, UpdateAppointmentDto } from "../../api/dto/appointment.dto.js";

export type SchedulingOverrideRequestType = "create_booking" | "reschedule_booking";
export type SchedulingOverrideRequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "failed" | "expired";

export interface SchedulingOverrideRequestRow {
  id: number;
  requestType: SchedulingOverrideRequestType;
  overrideType: SchedulingOverrideType;
  status: SchedulingOverrideRequestStatus;
  requesterUserId: number;
  approverUserId: number | null;
  patientId: number;
  modalityId: number;
  examTypeId: number | null;
  requestedBookingDate: string;
  requestedBookingTime: string | null;
  bookingId: number | null;
  requestedPolicyVersionId: number | null;
  approvedPolicyVersionId: number | null;
  patientIdentityVerificationFingerprint: string | null;
  requestPayloadJson: SchedulingOverrideStoredPayload;
  originalDecisionSnapshotJson: unknown;
  approvalDecisionSnapshotJson: unknown | null;
  requesterReason: string;
  approverReason: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  expiresAt: string;
  supersededByRequestId: number | null;
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
  /** Notification-only, explicitly-primary identifier; never falls back to MRN or legacy columns. */
  patientPrimaryIdentifier?: string | null;
  modalityName?: string | null;
  modalityCode?: string | null;
  examTypeName?: string | null;
  requesterDisplayName?: string | null;
  requesterUsername?: string | null;
  requesterRole?: string | null;
  approverDisplayName?: string | null;
  approverUsername?: string | null;
  decisionContext?: SchedulingOverrideDecisionContext | null;
}

export interface SchedulingOverrideDecisionContext {
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
    quotaRuleId: number;
    quotaLogicalKey: string;
    quotaTitle: string | null;
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
}

export interface SchedulingOverrideStoredPayload {
  version: 1;
  requestType: SchedulingOverrideRequestType;
  policySetKey: string;
  bookingId: number | null;
  createPayload?: CreateAppointmentDto;
  reschedulePayload?: UpdateAppointmentDto;
}

export interface CreateSchedulingOverrideRequestInput {
  requestType: unknown;
  bookingId?: number | null;
  requestPayload: Record<string, unknown>;
  requesterReason: string;
  createdFromContext?: string | null;
}

export type SchedulingOverrideApprovalMode = "as_requested" | "changed_date";

export interface ApproveSchedulingOverrideRequestInput {
  approverReason: string | null;
  approvalMode?: SchedulingOverrideApprovalMode | null;
  changedBookingDate?: string | null;
  changedBookingTime?: string | null;
}

export interface SchedulingOverrideRequestFilters {
  status?: SchedulingOverrideRequestStatus;
  requestType?: SchedulingOverrideRequestType;
  overrideType?: SchedulingOverrideType;
  modalityId?: number;
  requestedBookingDate?: string;
}

export type ApprovalCapacityMode = Extract<CapacityResolutionMode, "category_override" | "total_capacity_override"> | "standard";
