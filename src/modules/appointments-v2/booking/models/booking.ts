/**
 * Appointments V2 — Booking model.
 */

import type { BookingStatus, CaseCategory } from "../../shared/types/common.js";

export interface Booking {
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
  createdByUserId: number | null;
  updatedAt: string;
  updatedByUserId: number | null;
}

export interface CreateBookingPayload {
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
  override?: {
    supervisorUsername: string;
    supervisorPassword: string;
    reason: string;
  };
}
