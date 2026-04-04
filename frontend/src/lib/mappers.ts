import type { Patient, Modality, ExamType, ReportingPriority, Appointment, QueueSnapshot, User } from "@/types/api";

/**
 * Central field name mapping utility.
 * The backend API returns snake_case field names from PostgreSQL.
 * The frontend expects camelCase. This module provides mapping functions
 * for all entity types to ensure consistent data shapes across the app.
 */

// -- Patient Mapping --
export function mapPatient(raw: any): Patient {
  return {
    id: raw.id,
    mrn: raw.mrn ?? raw.patient_mrn ?? null,
    nationalId: raw.national_id ?? raw.nationalId ?? null,
    arabicFullName: raw.arabic_full_name ?? raw.arabicFullName ?? "",
    englishFullName: raw.english_full_name ?? raw.englishFullName ?? null,
    ageYears: raw.age_years ?? raw.ageYears ?? 0,
    estimatedDateOfBirth: raw.estimated_date_of_birth ?? raw.estimatedDateOfBirth ?? null,
    sex: raw.sex ?? "",
    phone1: raw.phone_1 ?? raw.phone1 ?? "",
    phone2: raw.phone_2 ?? raw.phone2 ?? null,
    address: raw.address ?? null
  };
}

export function mapPatients(rawArray: any[]): Patient[] {
  return rawArray.map(mapPatient);
}

// -- Modality Mapping --
export function mapModality(raw: any): Modality {
  return {
    id: raw.id,
    code: raw.code ?? "",
    nameAr: raw.name_ar ?? raw.nameAr ?? "",
    nameEn: raw.name_en ?? raw.nameEn ?? "",
    dailyCapacity: raw.daily_capacity ?? raw.dailyCapacity ?? null,
    generalInstructionAr: raw.general_instruction_ar ?? raw.generalInstructionAr ?? null,
    generalInstructionEn: raw.general_instruction_en ?? raw.generalInstructionEn ?? null,
    isActive: raw.is_active ?? raw.isActive ?? true
  };
}

export function mapModalities(rawArray: any[]): Modality[] {
  return rawArray.map(mapModality);
}

// -- ExamType Mapping --
export function mapExamType(raw: any): ExamType {
  return {
    id: raw.id,
    modalityId: raw.modality_id ?? raw.modalityId ?? null,
    nameAr: raw.name_ar ?? raw.nameAr ?? "",
    nameEn: raw.name_en ?? raw.nameEn ?? "",
    specificInstructionAr: raw.specific_instruction_ar ?? raw.specificInstructionAr ?? null,
    specificInstructionEn: raw.specific_instruction_en ?? raw.specificInstructionEn ?? null,
    isActive: raw.is_active ?? raw.isActive ?? true
  };
}

export function mapExamTypes(rawArray: any[]): ExamType[] {
  return rawArray.map(mapExamType);
}

// -- ReportingPriority Mapping --
export function mapPriority(raw: any): ReportingPriority {
  return {
    id: raw.id,
    code: raw.code ?? "",
    nameAr: raw.name_ar ?? raw.nameAr ?? "",
    nameEn: raw.name_en ?? raw.nameEn ?? "",
    sortOrder: raw.sort_order ?? raw.sortOrder ?? 0
  };
}

export function mapPriorities(rawArray: any[]): ReportingPriority[] {
  return rawArray.map(mapPriority);
}

// -- Appointment Mapping (for lists) --
export function mapAppointment(raw: any): Appointment {
  return {
    id: raw.id,
    patientId: raw.patient_id ?? raw.patientId ?? 0,
    modalityId: raw.modality_id ?? raw.modalityId ?? 0,
    examTypeId: raw.exam_type_id ?? raw.examTypeId ?? null,
    reportingPriorityId: raw.reporting_priority_id ?? raw.reportingPriorityId ?? null,
    accessionNumber: raw.accession_number ?? raw.accessionNumber ?? "",
    appointmentDate: raw.appointment_date ?? raw.appointmentDate ?? "",
    dailySequence: raw.daily_sequence ?? raw.dailySequence ?? 0,
    status: raw.status ?? "scheduled",
    isWalkIn: raw.is_walk_in ?? raw.isWalkIn ?? false,
    isOverbooked: raw.is_overbooked ?? raw.isOverbooked ?? false,
    overbookingReason: raw.overbooking_reason ?? raw.overbookingReason ?? null,
    approvedByName: raw.approved_by_name ?? raw.approvedByName ?? null,
    notes: raw.notes ?? null,
    noShowReason: raw.no_show_reason ?? raw.noShowReason ?? null,
    cancelReason: raw.cancel_reason ?? raw.cancelReason ?? null,
    arrivedAt: raw.arrived_at ?? raw.arrivedAt ?? null,
    completedAt: raw.completed_at ?? raw.completedAt ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    updatedAt: raw.updated_at ?? raw.updatedAt ?? null
  };
}

export function mapAppointments(rawArray: any[]): Appointment[] {
  return rawArray.map(mapAppointment);
}

// -- Extended Appointment (with patient/modality details for lists) --
export function mapAppointmentWithDetails(raw: any): any {
  return {
    ...mapAppointment(raw),
    // Patient fields
    patientId: raw.patient_id ?? raw.patientId ?? raw.id,
    arabicFullName: raw.arabic_full_name ?? raw.arabicFullName ?? "",
    englishFullName: raw.english_full_name ?? raw.englishFullName ?? null,
    nationalId: raw.national_id ?? raw.nationalId ?? null,
    mrn: raw.mrn ?? null,
    ageYears: raw.age_years ?? raw.ageYears ?? 0,
    sex: raw.sex ?? "",
    phone1: raw.phone_1 ?? raw.phone1 ?? null,
    // Modality fields
    modalityNameAr: raw.modality_name_ar ?? raw.modalityNameAr ?? "",
    modalityNameEn: raw.modality_name_en ?? raw.modalityNameEn ?? "",
    modalityCode: raw.modality_code ?? raw.modalityCode ?? "",
    // Exam type fields
    examNameAr: raw.exam_name_ar ?? raw.examNameAr ?? null,
    examNameEn: raw.exam_name_en ?? raw.examNameEn ?? null,
    // Priority fields
    priorityNameAr: raw.priority_name_ar ?? raw.priorityNameAr ?? null,
    priorityNameEn: raw.priority_name_en ?? raw.priorityNameEn ?? null,
    // Other
    modalitySlotNumber: raw.modality_slot_number ?? raw.modalitySlotNumber ?? null,
    dailySequence: raw.daily_sequence ?? raw.dailySequence ?? 0,
    accessionNumber: raw.accession_number ?? raw.accessionNumber ?? "",
    appointmentDate: raw.appointment_date ?? raw.appointmentDate ?? "",
    isWalkIn: raw.is_walk_in ?? raw.isWalkIn ?? false,
    isOverbooked: raw.is_overbooked ?? raw.isOverbooked ?? false,
    overbookingReason: raw.overbooking_reason ?? raw.overbookingReason ?? null,
    notes: raw.notes ?? null
  };
}

export function mapAppointmentsWithDetails(rawArray: any[]): any[] {
  return rawArray.map(mapAppointmentWithDetails);
}

// -- Queue Snapshot Mapping --
export function mapQueueSnapshot(raw: any): QueueSnapshot {
  return {
    queueDate: raw.queue_date ?? raw.queueDate ?? "",
    reviewTime: raw.review_time ?? raw.reviewTime ?? "",
    reviewActive: raw.review_active ?? raw.reviewActive ?? false,
    summary: {
      total_appointments: raw.summary?.total_appointments ?? raw.summary?.totalAppointments ?? 0,
      scheduled_count: raw.summary?.scheduled_count ?? raw.summary?.scheduledCount ?? 0,
      waiting_count: raw.summary?.waiting_count ?? raw.summary?.waitingCount ?? 0,
      no_show_count: raw.summary?.no_show_count ?? raw.summary?.noShowCount ?? 0,
      arrived_count: raw.summary?.arrived_count ?? raw.summary?.arrivedCount ?? 0
    },
    queueEntries: (raw.queue_entries ?? raw.queueEntries ?? []).map(mapQueueEntry),
    noShowCandidates: (raw.no_show_candidates ?? raw.noShowCandidates ?? []).map(mapNoShowCandidate)
  };
}

function mapQueueEntry(raw: any): any {
  return {
    id: raw.id,
    queueDate: raw.queue_date ?? raw.queueDate ?? "",
    queueNumber: raw.queue_number ?? raw.queueNumber ?? 0,
    queueStatus: raw.queue_status ?? raw.queueStatus ?? "waiting",
    scannedAt: raw.scanned_at ?? raw.scannedAt ?? null,
    appointmentId: raw.appointment_id ?? raw.appointmentId ?? 0,
    accessionNumber: raw.accession_number ?? raw.accessionNumber ?? "",
    appointmentStatus: raw.appointment_status ?? raw.appointmentStatus ?? "scheduled",
    isWalkIn: raw.is_walk_in ?? raw.isWalkIn ?? false,
    notes: raw.notes ?? null,
    patientId: raw.patient_id ?? raw.patientId ?? 0,
    arabicFullName: raw.arabic_full_name ?? raw.arabicFullName ?? "",
    englishFullName: raw.english_full_name ?? raw.englishFullName ?? null,
    phone1: raw.phone_1 ?? raw.phone1 ?? null,
    nationalId: raw.national_id ?? raw.nationalId ?? null,
    modalityNameAr: raw.modality_name_ar ?? raw.modalityNameAr ?? "",
    modalityNameEn: raw.modality_name_en ?? raw.modalityNameEn ?? "",
    examNameAr: raw.exam_name_ar ?? raw.examNameAr ?? null,
    examNameEn: raw.exam_name_en ?? raw.examNameEn ?? null
  };
}

function mapNoShowCandidate(raw: any): any {
  return {
    appointmentId: raw.appointment_id ?? raw.appointmentId ?? 0,
    accessionNumber: raw.accession_number ?? raw.accessionNumber ?? "",
    appointmentDate: raw.appointment_date ?? raw.appointmentDate ?? "",
    notes: raw.notes ?? null,
    patientId: raw.patient_id ?? raw.patientId ?? 0,
    arabicFullName: raw.arabic_full_name ?? raw.arabicFullName ?? "",
    englishFullName: raw.english_full_name ?? raw.englishFullName ?? null,
    phone1: raw.phone_1 ?? raw.phone1 ?? null,
    modalityNameAr: raw.modality_name_ar ?? raw.modalityNameAr ?? "",
    modalityNameEn: raw.modality_name_en ?? raw.modalityNameEn ?? ""
  };
}

// -- User/Session Mapping --
export function mapUser(raw: any): User {
  return {
    id: raw.id,
    username: raw.username ?? "",
    fullName: raw.full_name ?? raw.fullName ?? "",
    role: raw.role ?? "receptionist",
    isActive: raw.is_active ?? raw.isActive ?? true,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    updatedAt: raw.updated_at ?? raw.updatedAt ?? null,
    recentSupervisorReauth: raw.recent_supervisor_reauth ?? raw.recentSupervisorReauth ?? false
  };
}

// -- Appointment Lookups Mapping --
export function mapAppointmentLookups(raw: any): { modalities: Modality[]; examTypes: ExamType[]; priorities: ReportingPriority[] } {
  return {
    modalities: mapModalities(raw.modalities ?? []),
    examTypes: mapExamTypes(raw.exam_types ?? raw.examTypes ?? []),
    priorities: mapPriorities(raw.priorities ?? [])
  };
}

// -- Statistics Mapping --
export function mapStatistics(raw: any): any {
  return {
    summary: raw.summary ?? {},
    statusBreakdown: (raw.status_breakdown ?? raw.statusBreakdown ?? []).map((item: any) => ({
      status: item.status ?? "",
      count: item.count ?? 0
    })),
    modalityBreakdown: (raw.modality_breakdown ?? raw.modalityBreakdown ?? []).map((item: any) => ({
      modalityId: item.modality_id ?? item.modalityId ?? 0,
      modalityNameEn: item.modality_name_en ?? item.modalityNameEn ?? "",
      modalityNameAr: item.modality_name_ar ?? item.modalityNameAr ?? "",
      count: item.count ?? 0
    })),
    dailyBreakdown: (raw.daily_breakdown ?? raw.dailyBreakdown ?? []).map((item: any) => ({
      appointmentDate: item.appointment_date ?? item.appointmentDate ?? "",
      scheduledCount: item.scheduled_count ?? item.scheduledCount ?? 0,
      arrivedCount: item.arrived_count ?? item.arrivedCount ?? 0,
      waitingCount: item.waiting_count ?? item.waitingCount ?? 0,
      completedCount: item.completed_count ?? item.completedCount ?? 0,
      noShowCount: item.no_show_count ?? item.noShowCount ?? 0,
      cancelledCount: item.cancelled_count ?? item.cancelledCount ?? 0
    }))
  };
}

// -- DICOM Device Mapping --
export function mapDicomDevice(raw: any): any {
  return {
    id: raw.id,
    modalityId: raw.modality_id ?? raw.modalityId ?? 0,
    deviceName: raw.device_name ?? raw.deviceName ?? "",
    modalityAeTitle: raw.modality_ae_title ?? raw.modalityAeTitle ?? "",
    scheduledStationAeTitle: raw.scheduled_station_ae_title ?? raw.scheduledStationAeTitle ?? "",
    stationName: raw.station_name ?? raw.stationName ?? "",
    stationLocation: raw.station_location ?? raw.stationLocation ?? "",
    sourceIp: raw.source_ip ?? raw.sourceIp ?? null,
    mwlEnabled: raw.mwl_enabled ?? raw.mwlEnabled ?? false,
    mppsEnabled: raw.mpps_enabled ?? raw.mppsEnabled ?? false,
    isActive: raw.is_active ?? raw.isActive ?? true
  };
}

export function mapDicomDevices(rawArray: any[]): any[] {
  return rawArray.map(mapDicomDevice);
}

// -- Settings Mapping --
export function mapSettings(raw: any): any {
  const result: any = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const key = entry.setting_key ?? entry.key ?? "";
      const valueObj = entry.setting_value ?? entry.value ?? {};
      result[key] = valueObj.value ?? valueObj ?? "";
    }
  }
  return result;
}

// -- Name Dictionary Mapping --
export function mapNameDictionaryEntry(raw: any): any {
  return {
    id: raw.id,
    arabicText: raw.arabic_text ?? raw.arabicText ?? "",
    englishText: raw.english_text ?? raw.englishText ?? "",
    isActive: raw.is_active ?? raw.isActive ?? true,
    createdAt: raw.created_at ?? raw.createdAt ?? null
  };
}

export function mapNameDictionary(rawArray: any[]): any[] {
  return rawArray.map(mapNameDictionaryEntry);
}

// -- Audit Entry Mapping --
export function mapAuditEntry(raw: any): any {
  return {
    id: raw.id,
    entityType: raw.entity_type ?? raw.entityType ?? "",
    entityId: raw.entity_id ?? raw.entityId ?? null,
    actionType: raw.action_type ?? raw.actionType ?? "",
    oldValues: raw.old_values ?? raw.oldValues ?? null,
    newValues: raw.new_values ?? raw.newValues ?? null,
    changedByUserId: raw.changed_by_user_id ?? raw.changedByUserId ?? null,
    createdAt: raw.created_at ?? raw.createdAt ?? null
  };
}

export function mapAuditEntries(rawArray: any[]): any[] {
  return rawArray.map(mapAuditEntry);
}
