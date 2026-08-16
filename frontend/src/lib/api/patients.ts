import { api } from "@/lib/api-client";
import { mapPatient, mapPatients } from "@/lib/mappers";
import type {
  Patient,
  PatientDirectoryResponse,
  PatientDirectorySummary,
  PatientDuplicateDetailResponse,
  PatientDuplicateListResponse,
  PatientIdentifierTypeOption,
} from "@/types/api";

type RawRecord = Record<string, unknown>;

// -- Patient Search --
export async function searchPatients(query: string): Promise<Patient[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const raw = await api<{ patients: RawRecord[] }>(`/patients?${params.toString()}`);
  return mapPatients(raw.patients);
}

export async function fetchPatientIdentifierTypes(): Promise<PatientIdentifierTypeOption[]> {
  const raw = await api<{ items: RawRecord[] }>("/patients/identifier-types");
  return (raw.items || []).map((row) => ({
    code: String(row.code ?? ""),
    labelAr: String(row.label_ar ?? row.labelAr ?? row.code ?? ""),
    labelEn: String(row.label_en ?? row.labelEn ?? row.code ?? "")
  }));
}

export async function fetchPatientMrnPreview(): Promise<{ mrn: string }> {
  return api<{ mrn: string }>("/patients/mrn-preview");
}

// -- Patient CRUD --
export async function fetchPatientById(id: number): Promise<Patient> {
  const raw = await api<{ patient: RawRecord }>(`/patients/${id}`);
  return mapPatient(raw.patient);
}

export async function updatePatient(id: number, payload: Partial<Patient>) {
  const raw = await api<{ patient: RawRecord }>(`/patients/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return mapPatient(raw.patient);
}

export async function deletePatient(id: number) {
  return api<{ ok: boolean }>(`/patients/${id}`, {
    method: "DELETE"
  });
}

export async function createPatient(payload: Partial<Patient>) {
  const raw = await api<{ patient: RawRecord }>("/patients", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return mapPatient(raw.patient);
}

export interface PatientDirectoryParams {
  q?: string;
  category?: "oncology" | "non_oncology";
  appointmentFilter?: "has_future" | "today" | "no_future";
  sex?: "male" | "female";
  ageMin?: number;
  ageMax?: number;
  sortBy?: "name" | "recent" | "mrn";
  page?: number;
  pageSize?: number;
}

export async function fetchPatientDirectory(params: PatientDirectoryParams): Promise<PatientDirectoryResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.category) query.set("category", params.category);
  if (params.appointmentFilter) query.set("appointmentFilter", params.appointmentFilter);
  if (params.sex) query.set("sex", params.sex);
  if (params.ageMin) query.set("ageMin", String(params.ageMin));
  if (params.ageMax) query.set("ageMax", String(params.ageMax));
  if (params.sortBy) query.set("sortBy", params.sortBy);
  query.set("page", String(params.page || 1));
  query.set("pageSize", String(params.pageSize || 25));

  const raw = await api<{
    patients: RawRecord[];
    pagination: RawRecord;
  }>(`/patients/directory?${query.toString()}`);

  return {
    patients: (raw.patients || []).map((row: RawRecord) => ({
      id: Number(row.id ?? 0),
      mrn: row.mrn as string | null,
      arabicFullName: String(row.arabicFullName ?? row.arabic_full_name ?? ""),
      englishFullName: row.englishFullName as string | null ?? row.english_full_name as string | null,
      sex: row.sex as string | null,
      ageYears: Number(row.ageYears ?? row.age_years ?? 0),
      demographicsEstimated: Boolean(row.demographicsEstimated ?? row.demographics_estimated),
      phone1: row.phone1 as string | null ?? row.phone_1 as string | null,
      category: row.category as "oncology" | "non_oncology" | null,
      lastAppointment: row.lastAppointment as PatientDirectoryResponse["patients"][0]["lastAppointment"],
      nextAppointment: row.nextAppointment as PatientDirectoryResponse["patients"][0]["nextAppointment"],
      warnings: row.warnings as PatientDirectoryResponse["patients"][0]["warnings"]
    })),
    pagination: {
      page: Number(raw.pagination?.page ?? 1),
      pageSize: Number(raw.pagination?.pageSize ?? 25),
      total: Number(raw.pagination?.total ?? 0),
      totalPages: Number(raw.pagination?.totalPages ?? 0)
    }
  };
}

export async function fetchPatientDirectorySummary(patientId: number): Promise<PatientDirectorySummary> {
  const raw = await api<{
    demographics: RawRecord;
    identifiers: RawRecord;
    contact: RawRecord;
    category: string | null;
    registration: RawRecord;
    warnings: RawRecord;
    lastAppointment: RawRecord | null;
    nextAppointment: RawRecord | null;
    recentAppointments: RawRecord[];
    noShow?: RawRecord;
  }>(`/patients/${patientId}/directory-summary`);
  const duplicateCounts = raw.warnings?.duplicateCounts as RawRecord | undefined;

  return {
    demographics: {
      id: Number(raw.demographics?.id ?? 0),
      mrn: raw.demographics?.mrn as string | null,
      arabicFullName: String(raw.demographics?.arabicFullName ?? raw.demographics?.arabic_full_name ?? ""),
      englishFullName: (raw.demographics?.englishFullName as string | null) ?? (raw.demographics?.english_full_name as string | null),
      sex: raw.demographics?.sex as string | null,
      ageYears: Number(raw.demographics?.ageYears ?? raw.demographics?.age_years ?? 0),
      demographicsEstimated: Boolean(raw.demographics?.demographicsEstimated ?? raw.demographics?.demographics_estimated),
      dateOfBirth: (raw.demographics?.dateOfBirth as string | null) ?? (raw.demographics?.estimated_date_of_birth as string | null)
    },
    identifiers: {
      nationalId: (raw.identifiers?.nationalId as string | null) ?? (raw.identifiers?.national_id as string | null),
      identifierType: (raw.identifiers?.identifierType as string | null) ?? (raw.identifiers?.identifier_type as string | null),
      identifierValue: (raw.identifiers?.identifierValue as string | null) ?? (raw.identifiers?.identifier_value as string | null),
      items: Array.isArray(raw.identifiers?.items)
        ? (raw.identifiers.items as RawRecord[]).map((entry) => ({
            id: Number(entry.id ?? 0),
            typeId: Number(entry.typeId ?? entry.type_id ?? 0),
            typeCode: String(entry.typeCode ?? entry.type_code ?? "other"),
            value: String(entry.value ?? ""),
            normalizedValue: (entry.normalizedValue as string | undefined) ?? (entry.normalized_value as string | undefined) ?? undefined,
            isPrimary: Boolean(entry.isPrimary ?? entry.is_primary)
          }))
        : []
    },
    contact: {
      phone1: (raw.contact?.phone1 as string | null) ?? (raw.contact?.phone_1 as string | null),
      phone2: (raw.contact?.phone2 as string | null) ?? (raw.contact?.phone_2 as string | null),
      address: raw.contact?.address as string | null
    },
    category: raw.category as "oncology" | "non_oncology" | null,
    registration: {
      createdAt: (raw.registration?.createdAt as string | null) ?? (raw.registration?.created_at as string | null) ?? null,
      createdByUserId: raw.registration?.createdByUserId || raw.registration?.created_by_user_id ? Number(raw.registration?.createdByUserId ?? raw.registration?.created_by_user_id) : null,
      createdByName: (raw.registration?.createdByName as string | null) ?? (raw.registration?.created_by_name as string | null) ?? null,
      createdByUsername: (raw.registration?.createdByUsername as string | null) ?? (raw.registration?.created_by_username as string | null) ?? null
    },
    warnings: {
      missingPhone: Boolean(raw.warnings?.missingPhone),
      missingDob: Boolean(raw.warnings?.missingDob),
      missingSex: Boolean(raw.warnings?.missingSex),
      missingName: Boolean(raw.warnings?.missingName),
      incompleteData: Boolean(raw.warnings?.incompleteData),
      possibleDuplicate: Boolean(raw.warnings?.possibleDuplicate),
      duplicateReasons: (raw.warnings?.duplicateReasons as string[]) || [],
      duplicateCounts: {
        phone1: Number(duplicateCounts?.phone1 ?? 0),
        nationalId: Number(duplicateCounts?.nationalId ?? 0)
      }
    },
    lastAppointment: raw.lastAppointment as PatientDirectorySummary["lastAppointment"],
    nextAppointment: raw.nextAppointment as PatientDirectorySummary["nextAppointment"],
    recentAppointments: (raw.recentAppointments as PatientDirectorySummary["recentAppointments"]) || [],
    noShow: {
      noShowCount: Number(raw.noShow?.noShowCount ?? 0),
      bookingRestricted: Boolean(raw.noShow?.bookingRestricted),
      lastNoShowAppointment: (raw.noShow?.lastNoShowAppointment as PatientDirectorySummary["noShow"]["lastNoShowAppointment"]) ?? null,
      lastAuthorizationUser: (raw.noShow?.lastAuthorizationUser as PatientDirectorySummary["noShow"]["lastAuthorizationUser"]) ?? null,
      lastAuthorizationDate: (raw.noShow?.lastAuthorizationDate as string | null) ?? null,
      lastAuthorizationReason: (raw.noShow?.lastAuthorizationReason as string | null) ?? null,
    }
  };
}

export async function mergePatients(targetPatientId: number, sourcePatientId: number, confirmationText = "MERGE") {
  return api<{ patient: RawRecord }>("/patients/merge", {
    method: "POST",
    body: JSON.stringify({ targetPatientId, sourcePatientId, confirmationText })
  });
}

export interface PatientDuplicateCandidateFilters {
  threshold?: number;
  mode?: "strict" | "balanced" | "broad";
  category?: "" | "oncology" | "non_oncology";
  sex?: string;
  dobProximity?: "" | "true" | "false";
  hasIdentifier?: "" | "true" | "false";
  hasPhone?: "" | "true" | "false";
}

export async function fetchPatientDuplicateCandidates(filters: PatientDuplicateCandidateFilters = {}): Promise<PatientDuplicateListResponse> {
  const params = new URLSearchParams();
  if (filters.threshold) params.set("threshold", String(filters.threshold));
  if (filters.mode) params.set("mode", filters.mode);
  if (filters.category) params.set("category", filters.category);
  if (filters.sex) params.set("sex", filters.sex);
  if (filters.dobProximity) params.set("dobProximity", filters.dobProximity);
  if (filters.hasIdentifier) params.set("hasIdentifier", filters.hasIdentifier);
  if (filters.hasPhone) params.set("hasPhone", filters.hasPhone);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return api<PatientDuplicateListResponse>(`/settings/patient-duplicates${suffix}`);
}

export async function fetchPatientDuplicateDetail(patientAId: number, patientBId: number): Promise<PatientDuplicateDetailResponse> {
  return api<PatientDuplicateDetailResponse>(`/settings/patient-duplicates/${patientAId}/${patientBId}`);
}

export async function searchPatientsForDuplicateResolver(query: string): Promise<Patient[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const raw = await api<{ patients: RawRecord[] }>(`/settings/patient-duplicates/search?${params.toString()}`);
  return mapPatients(raw.patients || []);
}

export async function dismissPatientDuplicate(patientAId: number, patientBId: number, reason: string) {
  return api<{ dismissal: RawRecord }>("/settings/patient-duplicates/dismiss", {
    method: "POST",
    body: JSON.stringify({ patientAId, patientBId, reason })
  });
}

export async function mergePatientDuplicate(targetPatientId: number, sourcePatientId: number, confirmationText = "MERGE") {
  const raw = await api<{ patient: RawRecord }>("/settings/patient-duplicates/merge", {
    method: "POST",
    body: JSON.stringify({ targetPatientId, sourcePatientId, confirmationText })
  });
  return mapPatient(raw.patient);
}

export async function mergePatientDuplicateGroup(targetPatientId: number, sourcePatientIds: number[], confirmationText = "MERGE", targetPayload?: Partial<Patient>) {
  const raw = await api<{ patient: RawRecord; mergedSourceIds: number[] }>("/settings/patient-duplicates/merge-group", {
    method: "POST",
    body: JSON.stringify({ targetPatientId, sourcePatientIds, confirmationText, targetPayload })
  });
  return { patient: mapPatient(raw.patient), mergedSourceIds: raw.mergedSourceIds || [] };
}

export async function safeDeleteDuplicatePatient(patientId: number, confirmationText = "DELETE") {
  return api<{ ok: boolean }>("/settings/patient-duplicates/safe-delete", {
    method: "POST",
    body: JSON.stringify({ patientId, confirmationText })
  });
}

export async function fetchPatientNoShowHistory(patientId: number) {
  return api<PatientDirectorySummary["noShow"] & { lastNoShowDate: string | null }>(`/patients/${patientId}/no-show`);
}

export async function authorizePatientNoShowBooking(patientId: number, reason: string) {
  return api<PatientDirectorySummary["noShow"]>(`/patients/${patientId}/no-show/authorize-booking`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}
