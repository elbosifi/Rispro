/**
 * Appointments V2 — Booking model.
 */

import type { BookingStatus, CaseCategory, CapacityResolutionMode } from "../../shared/types/common.js";

export interface Booking {
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
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  isWalkIn: boolean;
  createdAt: string;
  createdByUserId: number | null;
  updatedAt: string;
  updatedByUserId: number | null;
  voidedAt?: string | null;
  voidedByUserId?: number | null;
  voidReason?: string | null;
}

export interface CreateBookingPayload {
  patientId: number;
  modalityId: number;
  examTypeId?: number | null;
  reportingPriorityId?: number | null;
  bookingDate: string;
  bookingTime?: string | null;
  caseCategory?: CaseCategory;
  requiresReport?: boolean;
  studyInstanceUid?: string | null;
  capacityResolutionMode?: CapacityResolutionMode;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  notes?: string | null;
  isWalkIn?: boolean;
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
  };
}
