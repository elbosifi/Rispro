/**
 * Appointments V2 — Appointment DTOs.
 */

import type { BookingStatus, CaseCategory } from "../../shared/types/common.js";

export interface CreateAppointmentDto {
  patientId: number;
  modalityId: number;
  examTypeId?: number | null;
  reportingPriorityId?: number | null;
  bookingDate: string;
  bookingTime?: string | null;
  caseCategory: CaseCategory;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  notes?: string | null;
  isWalkIn?: boolean;
  policySetKey?: string;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
  };
}

export interface UpdateAppointmentDto {
  bookingDate?: string;
  bookingTime?: string | null;
  examTypeId?: number | null;
  reportingPriorityId?: number | null;
  notes?: string | null;
  caseCategory?: CaseCategory;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  rescheduleReason?: string | null;
  policySetKey?: string;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
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
  status: BookingStatus;
  notes: string | null;
  policyVersionId: number;
  usesSpecialQuota: boolean;
  isWalkIn: boolean;
  createdAt: string;
  updatedAt: string;
}
