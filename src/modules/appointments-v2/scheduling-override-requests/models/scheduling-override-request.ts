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
  modalityName?: string | null;
  modalityCode?: string | null;
  examTypeName?: string | null;
  requesterDisplayName?: string | null;
  requesterUsername?: string | null;
  approverDisplayName?: string | null;
  approverUsername?: string | null;
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

export interface SchedulingOverrideRequestFilters {
  status?: SchedulingOverrideRequestStatus;
  requestType?: SchedulingOverrideRequestType;
  overrideType?: SchedulingOverrideType;
  modalityId?: number;
  requestedBookingDate?: string;
}

export type ApprovalCapacityMode = Extract<CapacityResolutionMode, "category_override" | "total_capacity_override"> | "standard";
