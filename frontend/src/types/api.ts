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
  | "cancelled"
  | "voided";

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

export type IdentifierType = string;

export interface PatientIdentifier {
  id?: number;
  typeId?: number;
  typeCode: IdentifierType;
  value: string;
  normalizedValue?: string;
  isPrimary: boolean;
}

export interface Patient {
  id: number;
  mrn?: string | null;
  nationalId?: string | null;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
  category?: "oncology" | "non_oncology" | null;
  identifiers?: PatientIdentifier[];
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

export interface PatientDirectoryRow {
  id: number;
  mrn: string | null;
  arabicFullName: string;
  englishFullName: string | null;
  sex: string | null;
  ageYears: number;
  demographicsEstimated: boolean;
  phone1: string | null;
  category: "oncology" | "non_oncology" | null;
  lastAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
  } | null;
  nextAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
  } | null;
  warnings: {
    missingPhone: boolean;
    missingDob: boolean;
    missingSex: boolean;
    missingName: boolean;
    noAppointment: boolean;
    possibleDuplicate: boolean;
    duplicateReasons: string[];
  };
}

export interface PatientDirectoryResponse {
  patients: PatientDirectoryRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PatientDirectorySummary {
  demographics: {
    id: number;
    mrn: string | null;
    arabicFullName: string;
    englishFullName: string | null;
    sex: string | null;
    ageYears: number;
    demographicsEstimated: boolean;
    dateOfBirth: string | null;
  };
  identifiers: {
    nationalId: string | null;
    identifierType: string | null;
    identifierValue: string | null;
  };
  contact: {
    phone1: string | null;
    phone2: string | null;
    address: string | null;
  };
  category: "oncology" | "non_oncology" | null;
  warnings: {
    missingPhone: boolean;
    missingDob: boolean;
    missingSex: boolean;
    missingName: boolean;
    incompleteData: boolean;
    possibleDuplicate: boolean;
    duplicateReasons: string[];
  };
  lastAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  } | null;
  nextAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  } | null;
  recentAppointments: Array<{
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  }>;
}

export interface PatientIdentifierTypeOption {
  code: string;
  labelAr: string;
  labelEn: string;
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
  requiresReport?: boolean;
  studyInstanceUid?: string | null;
  appointmentDate: string;
  bookingTime?: string | null;
  dailySequence: number;
  status: AppointmentStatus;
  isWalkIn?: boolean;
  isOverbooked?: boolean;
  overbookingReason?: string | null;
  approvedByName?: string | null;
  demographicsEstimated?: boolean;
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
  specialReasons?: SchedulingSpecialReason[];
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
  totalRegisteredPatients: number;
  oncologyPatients: number;
  nonOncologyPatients: number;
  uncategorizedPatients: number;
  totalAppointments: number;
  oncologyAppointments: number;
  nonOncologyAppointments: number;
  uniquePatients: number;
  uniqueModalities: number;
  scheduledCount: number;
  inQueueCount: number;
  completedCount: number;
  discontinuedCount: number;
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
  discontinuedCount: number;
  noShowCount: number;
  cancelledCount: number;
}

export interface AppointmentStatisticsDailyRow {
  appointmentDate: string;
  totalCount: number;
  completedCount: number;
  discontinuedCount: number;
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
  isActive: boolean;
}

export interface ApiResponse<T> {
  data?: T;
  error?: {
    message: string;
    details?: unknown;
  };
}

export interface SchedulingCategoryLimit {
  id?: number;
  modality_id?: number;
  modalityId?: number;
  case_category?: "oncology" | "non_oncology";
  caseCategory?: "oncology" | "non_oncology";
  daily_limit?: number;
  dailyLimit?: number;
  is_active?: boolean;
  isActive?: boolean;
}

export interface SchedulingBlockedRule {
  id?: number;
  modality_id?: number;
  modalityId?: number;
  rule_type?: "specific_date" | "date_range" | "yearly_recurrence";
  ruleType?: "specific_date" | "date_range" | "yearly_recurrence";
  specific_date?: string | null;
  specificDate?: string | null;
  start_date?: string | null;
  startDate?: string | null;
  end_date?: string | null;
  endDate?: string | null;
  recur_start_month?: number | null;
  recurStartMonth?: number | null;
  recur_start_day?: number | null;
  recurStartDay?: number | null;
  recur_end_month?: number | null;
  recurEndMonth?: number | null;
  recur_end_day?: number | null;
  recurEndDay?: number | null;
  is_overridable?: boolean;
  isOverridable?: boolean;
  is_active?: boolean;
  isActive?: boolean;
  title?: string;
  notes?: string;
}

export interface SchedulingExamRule {
  id?: number;
  modality_id?: number;
  modalityId?: number;
  rule_type?: "specific_date" | "date_range" | "weekly_recurrence";
  ruleType?: "specific_date" | "date_range" | "weekly_recurrence";
  effect_mode?: "hard_restriction" | "restriction_overridable";
  effectMode?: "hard_restriction" | "restriction_overridable";
  specific_date?: string | null;
  specificDate?: string | null;
  start_date?: string | null;
  startDate?: string | null;
  end_date?: string | null;
  endDate?: string | null;
  weekday?: number | null;
  alternate_weeks?: boolean;
  alternateWeeks?: boolean;
  recurrence_anchor_date?: string | null;
  recurrenceAnchorDate?: string | null;
  exam_type_ids?: number[];
  examTypeIds?: number[];
  is_active?: boolean;
  isActive?: boolean;
  title?: string;
  notes?: string;
}

export interface SchedulingSpecialQuota {
  id?: number;
  exam_type_id?: number;
  examTypeId?: number;
  daily_extra_slots?: number;
  dailyExtraSlots?: number;
  is_active?: boolean;
  isActive?: boolean;
}

export interface SchedulingSpecialReason {
  code: string;
  label_en?: string;
  labelEn?: string;
  label_ar?: string;
  labelAr?: string;
  is_active?: boolean;
  isActive?: boolean;
}

export interface SchedulingIdentifierType {
  id?: number;
  code: string;
  label_en?: string;
  labelEn?: string;
  label_ar?: string;
  labelAr?: string;
  is_active?: boolean;
  isActive?: boolean;
}

export interface SchedulingEngineConfig {
  categoryLimits: SchedulingCategoryLimit[];
  blockedRules: SchedulingBlockedRule[];
  examRules: SchedulingExamRule[];
  specialQuotas: SchedulingSpecialQuota[];
  specialReasons: SchedulingSpecialReason[];
  identifierTypes: SchedulingIdentifierType[];
}

export interface PatientImportBatch {
  id: number;
  source_filename: string;
  source_sheet_name?: string | null;
  patient_category?: "oncology" | "non_oncology" | null;
  imported_by_user_id?: number | null;
  imported_at: string;
  status: "uploaded" | "staged" | "reviewed" | "migrated" | "failed";
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  migrated_rows: number;
  created_at: string;
  updated_at: string;
}

export interface PatientImportStagingRow {
  id: number;
  batch_id: number;
  row_number: number;
  arabic_full_name?: string | null;
  english_full_name?: string | null;
  national_id?: string | null;
  phone?: string | null;
  derived_birth_date?: string | null;
  derived_age_years?: number | null;
  derived_sex?: string | null;
  validation_status: "valid" | "invalid" | "duplicate" | "migrated" | "skipped";
  validation_message?: string | null;
  matched_existing_patient_id?: number | null;
  is_selected_for_migration: boolean;
  migrated_patient_id?: number | null;
  raw_row_json?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
