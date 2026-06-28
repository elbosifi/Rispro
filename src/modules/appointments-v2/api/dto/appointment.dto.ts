/**
 * Appointments V2 — Appointment DTOs.
 */

import type { BookingStatus, CaseCategory, CapacityResolutionMode, SchedulingOverrideType } from "../../shared/types/common.js";

export interface CreateAppointmentDto {
  patientId: number;
  modalityId: number;
  examTypeId?: number | null;
  reportingPriorityId?: number | null;
  bookingDate: string;
  bookingTime?: string | null;
  caseCategory?: CaseCategory;
  requiresReport?: boolean;
  intendedReportingDoctorId?: number | null;
  intendedReportingDoctorReason?: string | null;
  studyInstanceUid?: string | null;
  capacityResolutionMode?: CapacityResolutionMode;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  notes?: string | null;
  isWalkIn?: boolean;
  policySetKey?: string;
  noShowAuthorizationReason?: string | null;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
    overrideType?: SchedulingOverrideType;
  };
}

export interface UpdateAppointmentDto {
  bookingDate?: string;
  bookingTime?: string | null;
  examTypeId?: number | null;
  reportingPriorityId?: number | null;
  notes?: string | null;
  caseCategory?: CaseCategory;
  requiresReport?: boolean;
  studyInstanceUid?: string | null;
  capacityResolutionMode?: CapacityResolutionMode;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  rescheduleReason?: string | null;
  policySetKey?: string;
  noShowAuthorizationReason?: string | null;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
    overrideType?: SchedulingOverrideType;
  };
}

export interface AppointmentResponseDto {
  id: number;
  patientId: number;
  modalityId: number;
  examTypeId: number | null;
  reportingPriorityId: number | null;
  bookingDate: string;
  bookingTime: string | null;
  caseCategory: CaseCategory;
  requiresReport: boolean;
  studyInstanceUid: string | null;
  status: BookingStatus;
  notes: string | null;
  policyVersionId: number;
  capacityResolutionMode: CapacityResolutionMode;
  usesSpecialQuota: boolean;
  isWalkIn: boolean;
  createdAt: string;
  updatedAt: string;
}
