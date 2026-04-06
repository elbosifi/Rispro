/* Re-export backend types so the frontend has a single source of truth */
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
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  recentSupervisorReauth?: boolean;
}

export interface AuthSession {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  recentSupervisorReauth?: boolean;
}

export type IdentifierType = 'national_id' | 'passport' | 'other';

export interface Patient {
  id: number;
  mrn?: string | null;
  nationalId?: string | null;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
  arabicFullName: string;
  englishFullName?: string | null;
  ageYears: number;
  estimatedDateOfBirth?: string | null;
  sex: string;
  phone1: string;
  phone2?: string | null;
  address?: string | null;
}

export interface Modality {
  id: number;
  code?: string;
  nameAr: string;
  nameEn: string;
  dailyCapacity?: number;
  generalInstructionAr?: string;
  generalInstructionEn?: string;
  safetyWarningAr?: string | null;
  safetyWarningEn?: string | null;
  safetyWarningEnabled?: boolean;
  isActive?: boolean;
}

export interface ExamType {
  id: number;
  modalityId?: number | null;
  nameAr: string;
  nameEn: string;
  specificInstructionAr?: string;
  specificInstructionEn?: string;
  isActive?: boolean;
}

export interface ReportingPriority {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
}

export interface Appointment {
  id: number;
  patientId: number;
  modalityId: number;
  examTypeId?: number | null;
  reportingPriorityId?: number | null;
  accessionNumber: string;
  appointmentDate: string;
  dailySequence: number;
  status: AppointmentStatus;
  isWalkIn?: boolean;
  isOverbooked?: boolean;
  overbookingReason?: string | null;
  approvedByName?: string | null;
  notes?: string | null;
  modalityGeneralInstructionAr?: string | null;
  modalityGeneralInstructionEn?: string | null;
  noShowReason?: string | null;
  cancelReason?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppointmentLookups {
  modalities: Modality[];
  examTypes: ExamType[];
  priorities: ReportingPriority[];
}

export interface QueueSummary {
  total_appointments: number;
  scheduled_count: number;
  waiting_count: number;
  no_show_count: number;
  arrived_count: number;
}

export interface QueueEntry {
  id: number;
  queueDate: string;
  queueNumber: number;
  queueStatus: QueueStatus;
  scannedAt?: string | null;
  appointmentId: number;
  accessionNumber: string;
  appointmentStatus: AppointmentStatus;
  isWalkIn: boolean;
  notes?: string | null;
  patientId: number;
  arabicFullName: string;
  englishFullName?: string | null;
  phone1?: string | null;
  nationalId?: string | null;
  modalityNameAr: string;
  modalityNameEn: string;
  examNameAr?: string | null;
  examNameEn?: string | null;
}

export interface QueueSnapshot {
  queueDate: string;
  reviewTime: string;
  reviewActive: boolean;
  summary: QueueSummary;
  queueEntries: QueueEntry[];
  noShowCandidates: {
    appointmentId: number;
    accessionNumber: string;
    appointmentDate: string;
    notes?: string | null;
    patientId: number;
    arabicFullName: string;
    englishFullName?: string | null;
    phone1?: string | null;
    modalityNameAr: string;
    modalityNameEn: string;
  }[];
}

export interface AppointmentStatisticsSummary {
  totalAppointments: number;
  uniquePatients: number;
  uniqueModalities: number;
  scheduledCount: number;
  inQueueCount: number;
  completedCount: number;
  noShowCount: number;
  cancelledCount: number;
  walkInCount: number;
}

export interface AppointmentStatisticsStatusRow {
  status: AppointmentStatus | string;
  count: number;
}

export interface AppointmentStatisticsModalityRow {
  modalityId: number;
  modalityCode: string;
  modalityNameEn: string;
  modalityNameAr: string;
  totalCount: number;
  scheduledCount: number;
  inQueueCount: number;
  completedCount: number;
  noShowCount: number;
  cancelledCount: number;
}

export interface AppointmentStatisticsDailyRow {
  appointmentDate: string;
  totalCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
}

export interface AppointmentStatistics {
  summary: AppointmentStatisticsSummary;
  statusBreakdown: AppointmentStatisticsStatusRow[];
  modalityBreakdown: AppointmentStatisticsModalityRow[];
  dailyBreakdown: AppointmentStatisticsDailyRow[];
}

export interface AuditEntry {
  id: number;
  entityType: string;
  entityId?: number | string | null;
  actionType: string;
  oldValues?: unknown;
  newValues?: unknown;
  changedByUserId?: number | string | null;
  createdAt?: string;
}

export interface DicomDevice {
  id: number;
  modalityId: number;
  deviceName: string;
  modalityAeTitle: string;
  scheduledStationAeTitle: string;
  stationName: string;
  stationLocation: string;
  sourceIp?: string | null;
  mwlEnabled: boolean;
  mppsEnabled: boolean;
  isActive: boolean;
}

export interface ApiResponse<T> {
  data?: T;
  error?: {
    message: string;
    details?: unknown;
  };
}
