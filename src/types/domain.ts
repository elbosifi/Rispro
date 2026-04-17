import type { NullableUserId } from "./http.js";

export type Role = "receptionist" | "supervisor" | "modality_staff";
export type AppointmentStatus =
  | "scheduled"
  | "arrived"
  | "waiting"
  | "in-progress"
  | "completed"
  | "discontinued"
  | "no-show"
  | "cancelled";
export type QueueStatus = "waiting" | "called" | "in-progress" | "removed";

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Patient {
  id: number;
  mrn?: string | null;
  nationalId?: string | null;
  identifierType?: string | null;
  identifierValue?: string | null;
  identifiers?: Array<{
    id?: number;
    typeId?: number;
    typeCode?: string;
    value: string;
    normalizedValue?: string;
    isPrimary: boolean;
  }>;
  arabicFullName: string;
  englishFullName?: string | null;
  ageYears: number;
  demographicsEstimated?: boolean;
  estimatedDateOfBirth?: string | null;
  sex: string;
  phone1: string;
  phone2?: string | null;
  address?: string | null;
}

export interface Modality {
  id: number;
  nameAr: string;
  nameEn: string;
  isActive?: boolean;
}

export interface ExamType {
  id: number;
  nameAr: string;
  nameEn: string;
  modalityId?: number | null;
  isActive?: boolean;
}

export interface Appointment {
  id: number;
  patientId: number;
  modalityId: number;
  examTypeId?: number | null;
  accessionNumber: string;
  appointmentDate: string;
  status: AppointmentStatus;
  isWalkIn?: boolean;
  caseCategory?: "oncology" | "non_oncology";
  usesSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  specialReasonNote?: string | null;
  notes?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
}

export interface QueueItem {
  id: number;
  appointmentId: number;
  queueDate: string;
  queueNumber: number;
  queueStatus: QueueStatus;
  scannedAt?: string | null;
}

export interface AuditEvent {
  id?: number;
  entityType: string;
  entityId?: NullableUserId;
  actionType: string;
  oldValues?: unknown;
  newValues?: unknown;
  changedByUserId?: NullableUserId;
  createdAt?: string;
}
