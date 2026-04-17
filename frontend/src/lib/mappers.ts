import type {
  Patient,
  Modality,
  ExamType,
  ReportingPriority,
  Appointment,
  QueueSnapshot,
  QueueEntry,
  User,
  AppointmentStatistics,
  DicomDevice,
  AuditEntry,
  IdentifierType
} from "@/types/api";
import type { DictionaryEntry } from "@/lib/name-generation";

type RawRecord = Record<string, unknown>;

// Type-safe accessors for RawRecord
function str(raw: RawRecord, key: string): string {
  const val = raw[key];
  return typeof val === 'string' ? val : String(val ?? '');
}

function strOrNull(raw: RawRecord, key: string): string | null {
  const val = raw[key];
  if (val === null || val === undefined) return null;
  return String(val);
}

function strOrUndefined(raw: RawRecord, key: string): string | undefined {
  const val = raw[key];
  if (val === null || val === undefined) return undefined;
  return String(val);
}

function num(raw: RawRecord, key: string): number {
  const val = raw[key];
  return typeof val === 'number' ? val : Number(val ?? 0);
}

function numOrNull(raw: RawRecord, key: string): number | null {
  const val = raw[key];
  if (val === null || val === undefined) return null;
  return Number(val);
}

function numOrUndefined(raw: RawRecord, key: string): number | undefined {
  const val = raw[key];
  if (val === null || val === undefined) return undefined;
  return Number(val);
}

function bool(raw: RawRecord, key: string, fallback = false): boolean {
  const val = raw[key];
  return typeof val === 'boolean' ? val : fallback;
}

function rawArray(raw: RawRecord, key: string): RawRecord[] {
  const val = raw[key];
  return Array.isArray(val) ? (val as RawRecord[]) : [];
}

function fallback<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return value as T;
}

export interface AppointmentWithDetails extends Appointment {
  patientId: number;
  arabicFullName: string;
  englishFullName: string | null;
  nationalId: string | null;
  mrn: string | null;
  ageYears: number;
  demographicsEstimated?: boolean;
  sex: string;
  phone1: string | null;
  modalityNameAr: string;
  modalityNameEn: string;
  modalityCode: string;
  modalityGeneralInstructionAr: string | null;
  modalityGeneralInstructionEn: string | null;
  examNameAr: string | null;
  examNameEn: string | null;
  priorityNameAr: string | null;
  priorityNameEn: string | null;
  modalitySlotNumber: number | null;
}

export interface NoShowCandidate {
  appointmentId: number;
  accessionNumber: string;
  appointmentDate: string;
  notes: string | null;
  patientId: number;
  arabicFullName: string;
  englishFullName: string | null;
  phone1: string | null;
  nationalId: string | null;
  identifierType: IdentifierType | null;
  identifierValue: string | null;
  modalityNameAr: string;
  modalityNameEn: string;
}

/**
 * Central field name mapping utility.
 * The backend API returns snake_case field names from PostgreSQL.
 * The frontend expects camelCase. This module provides mapping functions
 * for all entity types to ensure consistent data shapes across the app.
 */

// -- Patient Mapping --
function normalizeIsoDate(rawValue: unknown): string {
  const raw = String(rawValue ?? "");
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw;
}

export function mapPatient(raw: RawRecord): Patient {
  const rawIdentifiers = rawArray(raw, "identifiers");
  return {
    id: num(raw, 'id'),
    mrn: strOrNull(raw, 'mrn') ?? strOrNull(raw, 'patient_mrn'),
    nationalId: strOrNull(raw, 'national_id') ?? strOrNull(raw, 'nationalId'),
    identifierType: (strOrNull(raw, 'identifier_type') ?? strOrNull(raw, 'identifierType')) as IdentifierType | null,
    identifierValue: strOrNull(raw, 'identifier_value') ?? strOrNull(raw, 'identifierValue'),
    identifiers: rawIdentifiers.map((entry) => ({
      id: num(entry, "id"),
      typeId: num(entry, "type_id") || num(entry, "typeId"),
      typeCode: (str(entry, "type_code") || str(entry, "typeCode") || "other") as IdentifierType,
      value: str(entry, "value"),
      normalizedValue: strOrUndefined(entry, "normalized_value") ?? strOrUndefined(entry, "normalizedValue"),
      isPrimary: bool(entry, "is_primary", bool(entry, "isPrimary", false))
    })),
    arabicFullName: str(raw, 'arabic_full_name') || str(raw, 'arabicFullName'),
    englishFullName: strOrNull(raw, 'english_full_name') ?? strOrNull(raw, 'englishFullName'),
    ageYears: num(raw, 'age_years') || num(raw, 'ageYears'),
    demographicsEstimated: bool(raw, 'demographics_estimated', bool(raw, 'demographicsEstimated', false)),
    estimatedDateOfBirth: strOrNull(raw, 'estimated_date_of_birth') ?? strOrNull(raw, 'estimatedDateOfBirth'),
    sex: str(raw, 'sex'),
    phone1: str(raw, 'phone_1') || str(raw, 'phone1'),
    phone2: strOrNull(raw, 'phone_2') ?? strOrNull(raw, 'phone2'),
    address: strOrNull(raw, 'address')
  };
}

export function mapPatients(rawArray: RawRecord[]): Patient[] {
  return rawArray.map(mapPatient);
}

// -- Modality Mapping --
export function mapModality(raw: RawRecord): Modality {
  return {
    id: num(raw, 'id'),
    code: strOrUndefined(raw, 'code'),
    nameAr: str(raw, 'name_ar') || str(raw, 'nameAr'),
    nameEn: str(raw, 'name_en') || str(raw, 'nameEn'),
    dailyCapacity: numOrUndefined(raw, 'daily_capacity') ?? numOrUndefined(raw, 'dailyCapacity'),
    generalInstructionAr: strOrUndefined(raw, 'general_instruction_ar') ?? strOrUndefined(raw, 'generalInstructionAr'),
    generalInstructionEn: strOrUndefined(raw, 'general_instruction_en') ?? strOrUndefined(raw, 'generalInstructionEn'),
    safetyWarningAr: strOrNull(raw, 'safety_warning_ar') ?? strOrNull(raw, 'safetyWarningAr'),
    safetyWarningEn: strOrNull(raw, 'safety_warning_en') ?? strOrNull(raw, 'safetyWarningEn'),
    safetyWarningEnabled: bool(raw, 'safety_warning_enabled', bool(raw, 'safetyWarningEnabled', true)),
    isActive: bool(raw, 'is_active', bool(raw, 'isActive', true))
  };
}

export function mapModalities(rawArray: RawRecord[]): Modality[] {
  return rawArray.map(mapModality);
}

// -- ExamType Mapping --
export function mapExamType(raw: RawRecord): ExamType {
  return {
    id: num(raw, 'id'),
    modalityId: numOrNull(raw, 'modality_id') ?? numOrNull(raw, 'modalityId'),
    nameAr: str(raw, 'name_ar') || str(raw, 'nameAr'),
    nameEn: str(raw, 'name_en') || str(raw, 'nameEn'),
    specificInstructionAr: strOrUndefined(raw, 'specific_instruction_ar') ?? strOrUndefined(raw, 'specificInstructionAr'),
    specificInstructionEn: strOrUndefined(raw, 'specific_instruction_en') ?? strOrUndefined(raw, 'specificInstructionEn'),
    isActive: bool(raw, 'is_active', bool(raw, 'isActive', true))
  };
}

export function mapExamTypes(rawArray: RawRecord[]): ExamType[] {
  return rawArray.map(mapExamType);
}

// -- ReportingPriority Mapping --
export function mapPriority(raw: RawRecord): ReportingPriority {
  return {
    id: num(raw, 'id'),
    code: str(raw, 'code'),
    nameAr: str(raw, 'name_ar') || str(raw, 'nameAr'),
    nameEn: str(raw, 'name_en') || str(raw, 'nameEn'),
    sortOrder: num(raw, 'sort_order') || num(raw, 'sortOrder')
  };
}

export function mapPriorities(rawArray: RawRecord[]): ReportingPriority[] {
  return rawArray.map(mapPriority);
}

// -- Appointment Mapping (for lists) --
export function mapAppointment(raw: RawRecord): Appointment {
  return {
    id: num(raw, 'id'),
    patientId: num(raw, 'patient_id') || num(raw, 'patientId'),
    modalityId: num(raw, 'modality_id') || num(raw, 'modalityId'),
    examTypeId: numOrNull(raw, 'exam_type_id') ?? numOrNull(raw, 'examTypeId'),
    reportingPriorityId: numOrNull(raw, 'reporting_priority_id') ?? numOrNull(raw, 'reportingPriorityId'),
    accessionNumber: str(raw, 'accession_number') || str(raw, 'accessionNumber'),
    appointmentDate: normalizeIsoDate(raw.appointment_date ?? raw.appointmentDate ?? ""),
    dailySequence: num(raw, 'daily_sequence') || num(raw, 'dailySequence'),
    status: fallback(raw.status, "scheduled") as Appointment["status"],
    isWalkIn: bool(raw, 'is_walk_in', bool(raw, 'isWalkIn', false)),
    isOverbooked: bool(raw, 'is_overbooked', bool(raw, 'isOverbooked', false)),
    overbookingReason: strOrNull(raw, 'overbooking_reason') ?? strOrNull(raw, 'overbookingReason'),
    approvedByName: strOrNull(raw, 'approved_by_name') ?? strOrNull(raw, 'approvedByName'),
    demographicsEstimated: bool(raw, 'demographics_estimated', bool(raw, 'demographicsEstimated', false)),
    notes: strOrNull(raw, 'notes'),
    noShowReason: strOrNull(raw, 'no_show_reason') ?? strOrNull(raw, 'noShowReason'),
    cancelReason: strOrNull(raw, 'cancel_reason') ?? strOrNull(raw, 'cancelReason'),
    arrivedAt: strOrNull(raw, 'arrived_at') ?? strOrNull(raw, 'arrivedAt'),
    completedAt: strOrNull(raw, 'completed_at') ?? strOrNull(raw, 'completedAt'),
    createdAt: strOrUndefined(raw, 'created_at') ?? strOrUndefined(raw, 'createdAt'),
    updatedAt: strOrUndefined(raw, 'updated_at') ?? strOrUndefined(raw, 'updatedAt')
  };
}

export function mapAppointments(rawArray: RawRecord[]): Appointment[] {
  return rawArray.map(mapAppointment);
}

// -- Extended Appointment (with patient/modality details for lists) --
export function mapAppointmentWithDetails(raw: RawRecord): AppointmentWithDetails {
  return {
    ...mapAppointment(raw),
    // Patient fields
    patientId: num(raw, 'patient_id') || num(raw, 'patientId') || num(raw, 'id'),
    arabicFullName: str(raw, 'arabic_full_name') || str(raw, 'arabicFullName'),
    englishFullName: strOrNull(raw, 'english_full_name') ?? strOrNull(raw, 'englishFullName'),
    nationalId: strOrNull(raw, 'national_id') ?? strOrNull(raw, 'nationalId'),
    mrn: strOrNull(raw, 'mrn'),
    ageYears: num(raw, 'age_years') || num(raw, 'ageYears'),
    demographicsEstimated: bool(raw, 'demographics_estimated', bool(raw, 'demographicsEstimated', false)),
    sex: str(raw, 'sex'),
    phone1: strOrNull(raw, 'phone_1') ?? strOrNull(raw, 'phone1'),
    // Modality fields
    modalityNameAr: str(raw, 'modality_name_ar') || str(raw, 'modalityNameAr'),
    modalityNameEn: str(raw, 'modality_name_en') || str(raw, 'modalityNameEn'),
    modalityCode: str(raw, 'modality_code') || str(raw, 'modalityCode'),
    modalityGeneralInstructionAr: strOrNull(raw, 'modality_general_instruction_ar') ?? strOrNull(raw, 'modalityGeneralInstructionAr'),
    modalityGeneralInstructionEn: strOrNull(raw, 'modality_general_instruction_en') ?? strOrNull(raw, 'modalityGeneralInstructionEn'),
    // Exam type fields
    examNameAr: strOrNull(raw, 'exam_name_ar') ?? strOrNull(raw, 'examNameAr'),
    examNameEn: strOrNull(raw, 'exam_name_en') ?? strOrNull(raw, 'examNameEn'),
    // Priority fields
    priorityNameAr: strOrNull(raw, 'priority_name_ar') ?? strOrNull(raw, 'priorityNameAr'),
    priorityNameEn: strOrNull(raw, 'priority_name_en') ?? strOrNull(raw, 'priorityNameEn'),
    // Other
    modalitySlotNumber: numOrNull(raw, 'modality_slot_number') ?? numOrNull(raw, 'modalitySlotNumber'),
    dailySequence: num(raw, 'daily_sequence') || num(raw, 'dailySequence'),
    accessionNumber: str(raw, 'accession_number') || str(raw, 'accessionNumber'),
    appointmentDate: normalizeIsoDate(raw.appointment_date ?? raw.appointmentDate ?? ""),
    isWalkIn: bool(raw, 'is_walk_in', bool(raw, 'isWalkIn', false)),
    isOverbooked: bool(raw, 'is_overbooked', bool(raw, 'isOverbooked', false)),
    overbookingReason: strOrNull(raw, 'overbooking_reason') ?? strOrNull(raw, 'overbookingReason'),
    notes: strOrNull(raw, 'notes')
  };
}

export function mapAppointmentsWithDetails(rawArray: RawRecord[]): AppointmentWithDetails[] {
  return rawArray.map(mapAppointmentWithDetails);
}

// -- Queue Snapshot Mapping --
export function mapQueueSnapshot(raw: RawRecord): QueueSnapshot {
  const summary = (raw.summary ?? {}) as RawRecord;
  return {
    queueDate: str(raw, 'queue_date') || str(raw, 'queueDate'),
    reviewTime: str(raw, 'review_time') || str(raw, 'reviewTime'),
    reviewActive: bool(raw, 'review_active', bool(raw, 'reviewActive', false)),
    summary: {
      total_appointments: num(summary, 'total_appointments') || num(summary, 'totalAppointments'),
      scheduled_count: num(summary, 'scheduled_count') || num(summary, 'scheduledCount'),
      waiting_count: num(summary, 'waiting_count') || num(summary, 'waitingCount'),
      no_show_count: num(summary, 'no_show_count') || num(summary, 'noShowCount'),
      arrived_count: num(summary, 'arrived_count') || num(summary, 'arrivedCount')
    },
    queueEntries: rawArray(raw, 'queue_entries').length > 0
      ? rawArray(raw, 'queue_entries').map(mapQueueEntry)
      : rawArray(raw, 'queueEntries').map(mapQueueEntry),
    noShowCandidates: rawArray(raw, 'no_show_candidates').length > 0
      ? rawArray(raw, 'no_show_candidates').map(mapNoShowCandidate)
      : rawArray(raw, 'noShowCandidates').map(mapNoShowCandidate)
  };
}

function mapQueueEntry(raw: RawRecord): QueueEntry {
  return {
    id: num(raw, 'id'),
    queueDate: str(raw, 'queue_date') || str(raw, 'queueDate'),
    queueNumber: num(raw, 'queue_number') || num(raw, 'queueNumber'),
    queueStatus: fallback(raw.queue_status ?? raw.queueStatus, "waiting") as QueueEntry["queueStatus"],
    scannedAt: strOrNull(raw, 'scanned_at') ?? strOrNull(raw, 'scannedAt'),
    appointmentId: num(raw, 'appointment_id') || num(raw, 'appointmentId'),
    accessionNumber: str(raw, 'accession_number') || str(raw, 'accessionNumber'),
    appointmentStatus: fallback(raw.appointment_status ?? raw.appointmentStatus, "scheduled") as QueueEntry["appointmentStatus"],
    isWalkIn: bool(raw, 'is_walk_in', bool(raw, 'isWalkIn', false)),
    notes: strOrNull(raw, 'notes'),
    patientId: num(raw, 'patient_id') || num(raw, 'patientId'),
    arabicFullName: str(raw, 'arabic_full_name') || str(raw, 'arabicFullName'),
    englishFullName: strOrNull(raw, 'english_full_name') ?? strOrNull(raw, 'englishFullName'),
    phone1: strOrNull(raw, 'phone_1') ?? strOrNull(raw, 'phone1'),
    nationalId: strOrNull(raw, 'national_id') ?? strOrNull(raw, 'nationalId'),
    modalityNameAr: str(raw, 'modality_name_ar') || str(raw, 'modalityNameAr'),
    modalityNameEn: str(raw, 'modality_name_en') || str(raw, 'modalityNameEn'),
    examNameAr: strOrNull(raw, 'exam_name_ar') ?? strOrNull(raw, 'examNameAr'),
    examNameEn: strOrNull(raw, 'exam_name_en') ?? strOrNull(raw, 'examNameEn')
  };
}

function mapNoShowCandidate(raw: RawRecord): NoShowCandidate {
  return {
    appointmentId: num(raw, 'appointment_id') || num(raw, 'appointmentId'),
    accessionNumber: str(raw, 'accession_number') || str(raw, 'accessionNumber'),
    appointmentDate: normalizeIsoDate(raw.appointment_date ?? raw.appointmentDate ?? ""),
    notes: strOrNull(raw, 'notes'),
    patientId: num(raw, 'patient_id') || num(raw, 'patientId'),
    arabicFullName: str(raw, 'arabic_full_name') || str(raw, 'arabicFullName'),
    englishFullName: strOrNull(raw, 'english_full_name') ?? strOrNull(raw, 'englishFullName'),
    phone1: strOrNull(raw, 'phone_1') ?? strOrNull(raw, 'phone1'),
    nationalId: strOrNull(raw, 'national_id') ?? strOrNull(raw, 'nationalId'),
    identifierType: (strOrNull(raw, 'identifier_type') ?? strOrNull(raw, 'identifierType')) as IdentifierType | null,
    identifierValue: strOrNull(raw, 'identifier_value') ?? strOrNull(raw, 'identifierValue'),
    modalityNameAr: str(raw, 'modality_name_ar') || str(raw, 'modalityNameAr'),
    modalityNameEn: str(raw, 'modality_name_en') || str(raw, 'modalityNameEn')
  };
}

// -- User/Session Mapping --
export function mapUser(raw: RawRecord): User {
  return {
    id: num(raw, 'id'),
    username: str(raw, 'username'),
    fullName: str(raw, 'full_name') || str(raw, 'fullName'),
    role: fallback(raw.role, "receptionist") as User["role"],
    isActive: bool(raw, 'is_active', bool(raw, 'isActive', true)),
    createdAt: strOrUndefined(raw, 'created_at') ?? strOrUndefined(raw, 'createdAt'),
    updatedAt: strOrUndefined(raw, 'updated_at') ?? strOrUndefined(raw, 'updatedAt'),
    recentSupervisorReauth: bool(raw, 'recent_supervisor_reauth', bool(raw, 'recentSupervisorReauth', false))
  };
}

// -- Appointment Lookups Mapping --
export function mapAppointmentLookups(raw: RawRecord): { modalities: Modality[]; examTypes: ExamType[]; priorities: ReportingPriority[]; specialReasons: Array<{ code: string; labelEn: string; labelAr: string; isActive: boolean }> } {
  return {
    modalities: rawArray(raw, 'modalities').map(mapModality),
    examTypes: rawArray(raw, 'exam_types').length > 0 ? rawArray(raw, 'exam_types').map(mapExamType) : rawArray(raw, 'examTypes').map(mapExamType),
    priorities: rawArray(raw, 'priorities').map(mapPriority),
    specialReasons: (rawArray(raw, "special_reasons").length > 0 ? rawArray(raw, "special_reasons") : rawArray(raw, "specialReasons")).map((reason: RawRecord) => ({
      code: str(reason, "code"),
      labelEn: str(reason, "label_en") || str(reason, "labelEn"),
      labelAr: str(reason, "label_ar") || str(reason, "labelAr"),
      isActive: bool(reason, "is_active", bool(reason, "isActive", true))
    }))
  };
}

// -- Statistics Mapping --
export function mapStatistics(raw: RawRecord): AppointmentStatistics {
  const summaryRaw: RawRecord = (raw.summary ?? {}) as RawRecord;
  return {
    summary: {
      totalAppointments: num(summaryRaw, 'total_appointments') || num(summaryRaw, 'totalAppointments'),
      uniquePatients: num(summaryRaw, 'unique_patients') || num(summaryRaw, 'uniquePatients'),
      uniqueModalities: num(summaryRaw, 'unique_modalities') || num(summaryRaw, 'uniqueModalities'),
      scheduledCount: num(summaryRaw, 'scheduled_count') || num(summaryRaw, 'scheduledCount'),
      inQueueCount: num(summaryRaw, 'in_queue_count') || num(summaryRaw, 'inQueueCount'),
      completedCount: num(summaryRaw, 'completed_count') || num(summaryRaw, 'completedCount'),
      noShowCount: num(summaryRaw, 'no_show_count') || num(summaryRaw, 'noShowCount'),
      cancelledCount: num(summaryRaw, 'cancelled_count') || num(summaryRaw, 'cancelledCount'),
      walkInCount: num(summaryRaw, 'walk_in_count') || num(summaryRaw, 'walkInCount')
    },
    statusBreakdown: rawArray(raw, 'status_breakdown').length > 0
      ? rawArray(raw, 'status_breakdown').map((item: RawRecord) => ({
          status: str(item, 'status'),
          count: num(item, 'total_count') || num(item, 'count')
        }))
      : rawArray(raw, 'statusBreakdown').map((item: RawRecord) => ({
          status: str(item, 'status'),
          count: num(item, 'total_count') || num(item, 'count')
        })),
    modalityBreakdown: rawArray(raw, 'modality_breakdown').length > 0
      ? rawArray(raw, 'modality_breakdown').map((item: RawRecord) => ({
          modalityId: num(item, 'modality_id') || num(item, 'modalityId'),
          modalityCode: str(item, 'modality_code') || str(item, 'modalityCode'),
          modalityNameEn: str(item, 'modality_name_en') || str(item, 'modalityNameEn'),
          modalityNameAr: str(item, 'modality_name_ar') || str(item, 'modalityNameAr'),
          totalCount: num(item, 'total_count') || num(item, 'totalCount') || num(item, 'count'),
          scheduledCount: num(item, 'scheduled_count') || num(item, 'scheduledCount'),
          inQueueCount: num(item, 'in_queue_count') || num(item, 'inQueueCount'),
          completedCount: num(item, 'completed_count') || num(item, 'completedCount'),
          noShowCount: num(item, 'no_show_count') || num(item, 'noShowCount'),
          cancelledCount: num(item, 'cancelled_count') || num(item, 'cancelledCount')
        }))
      : rawArray(raw, 'modalityBreakdown').map((item: RawRecord) => ({
          modalityId: num(item, 'modality_id') || num(item, 'modalityId'),
          modalityCode: str(item, 'modality_code') || str(item, 'modalityCode'),
          modalityNameEn: str(item, 'modality_name_en') || str(item, 'modalityNameEn'),
          modalityNameAr: str(item, 'modality_name_ar') || str(item, 'modalityNameAr'),
          totalCount: num(item, 'total_count') || num(item, 'totalCount') || num(item, 'count'),
          scheduledCount: num(item, 'scheduled_count') || num(item, 'scheduledCount'),
          inQueueCount: num(item, 'in_queue_count') || num(item, 'inQueueCount'),
          completedCount: num(item, 'completed_count') || num(item, 'completedCount'),
          noShowCount: num(item, 'no_show_count') || num(item, 'noShowCount'),
          cancelledCount: num(item, 'cancelled_count') || num(item, 'cancelledCount')
        })),
    dailyBreakdown: rawArray(raw, 'daily_breakdown').length > 0
      ? rawArray(raw, 'daily_breakdown').map((item: RawRecord) => ({
          appointmentDate: normalizeIsoDate(item.appointment_date ?? item.appointmentDate ?? ""),
          totalCount: num(item, 'total_count') || num(item, 'totalCount'),
          completedCount: num(item, 'completed_count') || num(item, 'completedCount'),
          cancelledCount: num(item, 'cancelled_count') || num(item, 'cancelledCount'),
          noShowCount: num(item, 'no_show_count') || num(item, 'noShowCount')
        }))
      : rawArray(raw, 'dailyBreakdown').map((item: RawRecord) => ({
          appointmentDate: normalizeIsoDate(item.appointment_date ?? item.appointmentDate ?? ""),
          totalCount: num(item, 'total_count') || num(item, 'totalCount'),
          completedCount: num(item, 'completed_count') || num(item, 'completedCount'),
          cancelledCount: num(item, 'cancelled_count') || num(item, 'cancelledCount'),
          noShowCount: num(item, 'no_show_count') || num(item, 'noShowCount')
        }))
  } as AppointmentStatistics;
}

// -- DICOM Device Mapping --
export function mapDicomDevice(raw: RawRecord): DicomDevice {
  return {
    id: num(raw, 'id'),
    modalityId: num(raw, 'modality_id') || num(raw, 'modalityId'),
    deviceName: str(raw, 'device_name') || str(raw, 'deviceName'),
    modalityAeTitle: str(raw, 'modality_ae_title') || str(raw, 'modalityAeTitle'),
    scheduledStationAeTitle: str(raw, 'scheduled_station_ae_title') || str(raw, 'scheduledStationAeTitle'),
    stationName: str(raw, 'station_name') || str(raw, 'stationName'),
    stationLocation: str(raw, 'station_location') || str(raw, 'stationLocation'),
    sourceIp: strOrNull(raw, 'source_ip') ?? strOrNull(raw, 'sourceIp'),
    mwlEnabled: bool(raw, 'mwl_enabled', bool(raw, 'mwlEnabled', false)),
    isActive: bool(raw, 'is_active', bool(raw, 'isActive', true))
  };
}

export function mapDicomDevices(rawArray: RawRecord[]): DicomDevice[] {
  return rawArray.map(mapDicomDevice);
}

// -- Settings Mapping --
export function mapSettings(raw: RawRecord[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const key = str(entry, 'setting_key') || str(entry, 'key');
      const valueObj = entry.setting_value ?? entry.value ?? {};
      const typedValueObj = valueObj as RawRecord;
      result[key] = typeof typedValueObj.value === 'string' ? typedValueObj.value : String(typedValueObj.value ?? valueObj ?? "");
    }
  }
  return result;
}

// -- Name Dictionary Mapping --
export function mapNameDictionaryEntry(raw: RawRecord): DictionaryEntry {
  return {
    id: num(raw, 'id'),
    arabicText: str(raw, 'arabic_text') || str(raw, 'arabicText'),
    englishText: str(raw, 'english_text') || str(raw, 'englishText'),
    isActive: bool(raw, 'is_active', bool(raw, 'isActive', true)),
    createdAt: strOrNull(raw, 'created_at') ?? strOrNull(raw, 'createdAt')
  };
}

export function mapNameDictionary(rawArray: RawRecord[]): DictionaryEntry[] {
  return rawArray.map(mapNameDictionaryEntry);
}

// -- Audit Entry Mapping --
export function mapAuditEntry(raw: RawRecord): AuditEntry {
  return {
    id: num(raw, 'id'),
    entityType: str(raw, 'entity_type') || str(raw, 'entityType'),
    entityId: strOrNull(raw, 'entity_id') ?? strOrNull(raw, 'entityId') ?? numOrNull(raw, 'entity_id') ?? numOrNull(raw, 'entityId'),
    actionType: str(raw, 'action_type') || str(raw, 'actionType'),
    oldValues: raw.old_values ?? raw.oldValues ?? null,
    newValues: raw.new_values ?? raw.newValues ?? null,
    changedByUserId: strOrNull(raw, 'changed_by_user_id') ?? strOrNull(raw, 'changedByUserId') ?? numOrNull(raw, 'changed_by_user_id') ?? numOrNull(raw, 'changedByUserId'),
    createdAt: strOrUndefined(raw, 'created_at') ?? strOrUndefined(raw, 'createdAt')
  };
}

export function mapAuditEntries(rawArray: RawRecord[]): AuditEntry[] {
  return rawArray.map(mapAuditEntry);
}
