import { ApiError, api } from "@/lib/api-client";
import { normalizePageVisibilityMatrix, type PageVisibilityMatrix } from "@/lib/page-visibility";
import {
  mapPatient,
  mapPatients,
  mapAppointmentLookups,
  mapQueueSnapshot,
  mapUser,
  mapAppointmentWithDetails,
  mapAppointmentsWithDetails,
  mapStatistics,
  mapDicomDevices,
  mapSettings,
  mapNameDictionary,
  mapAuditEntries
} from "@/lib/mappers";
import type {
  Patient,
  AppointmentLookups,
  QueueSnapshot,
  User,
  AppointmentStatistics,
  DicomDevice,
  AuditEntry,
  SchedulingEngineConfig,
  PatientImportBatch,
  PatientImportStagingRow,
  PatientIdentifierTypeOption,
  PatientDirectoryResponse,
  PatientDirectorySummary,
  DoctorMe,
  DoctorProfile,
  DoctorRosterResponse,
  DoctorRosterAssignment,
  DoctorRosterMember,
  DoctorCase,
  DoctorCaseAssignmentSummary,
  DoctorCaseFilters,
  AppointmentProtocol,
  ProtocolDetails,
  ProtocolFilters,
  ProtocolPayload,
  ProtocolTask,
  RosterDutyType,
  RosterTeamRole
} from "@/types/api";
import type { DictionaryEntry } from "@/lib/name-generation";

// Generic raw response type for API responses that are passed through mappers
type RawRecord = Record<string, unknown>;
const IMPORT_WORKBOOK_TIMEOUT_MS = 180_000;
const IMPORT_PREVIEW_TIMEOUT_MS = 180_000;
const IMPORT_CONFIRM_TIMEOUT_MS = 180_000;
const CATALOG_IMPORT_TIMEOUT_MS = 180_000;

export type AppointmentRefType = "legacy_appointment" | "v2_booking" | "auto";

export interface RequestDocument {
  id: number;
  patientId: number | null;
  appointmentId: number | null;
  v2BookingId: number | null;
  documentType: string;
  originalFilename: string;
  storedPath: string;
  mimeType: string;
  fileSize: number;
  storageLocationType: "network" | "local_fallback";
  source: "manual_upload" | "naps2_webscan";
  lastMoveAttemptAt: string | null;
  lastMoveError: string | null;
  createdAt: string;
}

export interface IntegrationStatus {
  scanner: {
    referralUploadEnabled: boolean;
    allowedFileTypes: string[];
    documentLinkScope: string;
    scannerBridgeMode: string;
    scannerProfileName: string;
    scannerSource: string;
    scanDpi: string;
    scanColorMode: string;
    scanFileFormat: string;
    bridgeReady: boolean;
    naps2WebScanEnabled?: boolean;
    naps2WebScanEndpoint?: string;
  };
}

function mapRequestDocument(raw: RawRecord): RequestDocument {
  return {
    id: Number(raw.id ?? 0),
    patientId: raw.patient_id == null ? (raw.patientId == null ? null : Number(raw.patientId)) : Number(raw.patient_id),
    appointmentId:
      raw.appointment_id == null ? (raw.appointmentId == null ? null : Number(raw.appointmentId)) : Number(raw.appointment_id),
    v2BookingId:
      raw.v2_booking_id == null ? (raw.v2BookingId == null ? null : Number(raw.v2BookingId)) : Number(raw.v2_booking_id),
    documentType: String(raw.document_type ?? raw.documentType ?? ""),
    originalFilename: String(raw.original_filename ?? raw.originalFilename ?? ""),
    storedPath: String(raw.stored_path ?? raw.storedPath ?? ""),
    mimeType: String(raw.mime_type ?? raw.mimeType ?? ""),
    fileSize: Number(raw.file_size ?? raw.fileSize ?? 0),
    storageLocationType:
      String(raw.storage_location_type ?? raw.storageLocationType ?? "local_fallback") === "network"
        ? "network"
        : "local_fallback",
    source: String(raw.source ?? "manual_upload") === "naps2_webscan" ? "naps2_webscan" : "manual_upload",
    lastMoveAttemptAt: (raw.last_move_attempt_at ?? raw.lastMoveAttemptAt ?? null) as string | null,
    lastMoveError: (raw.last_move_error ?? raw.lastMoveError ?? null) as string | null,
    createdAt: String(raw.created_at ?? raw.createdAt ?? ""),
  };
}

// -- Auth --
export async function fetchCurrentSession(): Promise<User | null> {
  try {
    const res = await api<{ user: RawRecord }>("/auth/me");
    return mapUser(res.user);
  } catch {
    return null;
  }
}

// -- Documents --
export async function listAppointmentDocuments(
  appointmentId: number,
  appointmentRefType: AppointmentRefType = "auto"
): Promise<RequestDocument[]> {
  const params = new URLSearchParams();
  params.set("appointmentId", String(appointmentId));
  params.set("appointmentRefType", appointmentRefType);
  const raw = await api<{ documents: RawRecord[] }>(`/documents?${params.toString()}`);
  return (raw.documents ?? []).map(mapRequestDocument);
}

export async function uploadAppointmentDocument(payload: {
  patientId: number | null;
  appointmentId: number;
  appointmentRefType?: AppointmentRefType;
  documentType?: string;
  originalFilename: string;
  mimeType: string;
  fileContentBase64: string;
  source?: "manual_upload" | "naps2_webscan";
}): Promise<RequestDocument> {
  const raw = await api<{ document: RawRecord }>("/documents", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      appointmentRefType: payload.appointmentRefType || "auto",
    }),
  });
  return mapRequestDocument(raw.document);
}

export async function deleteAppointmentDocument(documentId: number): Promise<{ deleted: boolean; documentId: number }> {
  return api<{ deleted: boolean; documentId: number }>(`/documents/${documentId}`, {
    method: "DELETE",
  });
}

export async function fetchDoctorMe(): Promise<DoctorMe> {
  return api<DoctorMe>("/doctor/me");
}

export async function fetchDoctorRosterWeek(weekStart: string): Promise<DoctorRosterResponse> {
  const params = new URLSearchParams({ weekStart });
  return api<DoctorRosterResponse>(`/doctor/roster/weeks?${params.toString()}`);
}

export async function fetchMyDoctorRoster(weekStart: string): Promise<DoctorRosterResponse> {
  const params = new URLSearchParams({ weekStart });
  return api<DoctorRosterResponse>(`/doctor/roster/my?${params.toString()}`);
}

export async function fetchRosterDoctors(): Promise<DoctorProfile[]> {
  const raw = await api<{ profiles: DoctorProfile[] }>("/doctor/roster/doctors");
  return raw.profiles;
}

export async function createDoctorRosterWeek(payload: { weekStartDate: string; weekEndDate: string }) {
  return api<{ week: DoctorRosterResponse["week"] }>("/doctor/roster/weeks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function copyPreviousDoctorRosterWeek(weekId: number): Promise<DoctorRosterResponse> {
  return api<DoctorRosterResponse>(`/doctor/roster/weeks/${weekId}/copy-previous`, { method: "POST" });
}

export async function publishDoctorRosterWeek(weekId: number) {
  return api<{ week: DoctorRosterResponse["week"] }>(`/doctor/roster/weeks/${weekId}/publish`, { method: "POST" });
}

export async function createDoctorRosterAssignment(payload: {
  rosterWeekId: number;
  date: string;
  modalityId: number | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
  startTime: string | null;
  endTime: string | null;
  teamName: string;
}): Promise<DoctorRosterAssignment> {
  const raw = await api<{ assignment: DoctorRosterAssignment }>("/doctor/roster/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.assignment;
}

export async function deleteDoctorRosterAssignment(assignmentId: number): Promise<void> {
  await api(`/doctor/roster/assignments/${assignmentId}`, { method: "DELETE" });
}

export async function addDoctorRosterMember(assignmentId: number, payload: { doctorId: number; teamRole: RosterTeamRole }): Promise<DoctorRosterMember> {
  const raw = await api<{ member: DoctorRosterMember }>(`/doctor/roster/assignments/${assignmentId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.member;
}

export async function deleteDoctorRosterMember(assignmentId: number, memberId: number): Promise<void> {
  await api(`/doctor/roster/assignments/${assignmentId}/members/${memberId}`, { method: "DELETE" });
}

function doctorCaseParams(filters: DoctorCaseFilters): URLSearchParams {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.modalityId) params.set("modalityId", String(filters.modalityId));
  if (filters.status) params.set("status", filters.status);
  if (filters.requiresReport !== null && filters.requiresReport !== undefined) {
    params.set("requiresReport", String(filters.requiresReport));
  }
  if (filters.caseCategory) params.set("caseCategory", filters.caseCategory);
  if (filters.rosterAssignmentId) params.set("rosterAssignmentId", String(filters.rosterAssignmentId));
  return params;
}

export async function fetchMyDoctorCases(filters: DoctorCaseFilters): Promise<DoctorCase[]> {
  const raw = await api<{ cases: DoctorCase[] }>(`/doctor/cases/my?${doctorCaseParams(filters).toString()}`);
  return raw.cases;
}

export async function fetchTeamDoctorCases(filters: DoctorCaseFilters): Promise<DoctorCase[]> {
  const raw = await api<{ cases: DoctorCase[] }>(`/doctor/cases/team?${doctorCaseParams(filters).toString()}`);
  return raw.cases;
}

export async function fetchUnassignedDoctorCases(filters: DoctorCaseFilters): Promise<DoctorCase[]> {
  const raw = await api<{ cases: DoctorCase[] }>(`/doctor/cases/unassigned?${doctorCaseParams(filters).toString()}`);
  return raw.cases;
}

export async function runDoctorCaseAssignment(payload: { dateFrom: string; dateTo: string; modalityId?: number | null }): Promise<DoctorCaseAssignmentSummary> {
  const raw = await api<{ summary: DoctorCaseAssignmentSummary }>("/doctor/cases/assign", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.summary;
}

function protocolParams(filters: ProtocolFilters): URLSearchParams {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.modalityId) params.set("modalityId", String(filters.modalityId));
  if (filters.protocolStatus) params.set("protocolStatus", filters.protocolStatus);
  if (filters.unprotocolledOnly) params.set("unprotocolledOnly", "true");
  if (filters.requiresReport !== null && filters.requiresReport !== undefined) params.set("requiresReport", String(filters.requiresReport));
  if (filters.caseCategory) params.set("caseCategory", filters.caseCategory);
  return params;
}

export async function fetchProtocolTasks(filters: ProtocolFilters): Promise<ProtocolTask[]> {
  const raw = await api<{ tasks: ProtocolTask[] }>(`/doctor/protocols/tasks?${protocolParams(filters).toString()}`);
  return raw.tasks;
}

export async function fetchProtocolDetails(appointmentId: number): Promise<ProtocolDetails> {
  return api<ProtocolDetails>(`/doctor/protocols/${appointmentId}`);
}

export async function saveProtocolDraft(appointmentId: number, payload: ProtocolPayload): Promise<AppointmentProtocol> {
  const raw = await api<{ protocol: AppointmentProtocol }>(`/doctor/protocols/${appointmentId}`, {
    method: "POST",
    body: JSON.stringify({ ...payload, protocolStatus: payload.protocolStatus ?? "draft" }),
  });
  return raw.protocol;
}

export async function assignProtocol(appointmentId: number, payload: ProtocolPayload): Promise<AppointmentProtocol> {
  const raw = await api<{ protocol: AppointmentProtocol }>(`/doctor/protocols/${appointmentId}/assign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.protocol;
}

export async function requestProtocolClarification(appointmentId: number, payload: ProtocolPayload): Promise<AppointmentProtocol> {
  const raw = await api<{ protocol: AppointmentProtocol }>(`/doctor/protocols/${appointmentId}/clarification`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.protocol;
}

export async function cancelProtocol(appointmentId: number, payload: ProtocolPayload): Promise<AppointmentProtocol> {
  const raw = await api<{ protocol: AppointmentProtocol }>(`/doctor/protocols/${appointmentId}/cancel`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return raw.protocol;
}

export async function fetchIntegrationStatus(): Promise<IntegrationStatus> {
  const raw = await api<{ status: IntegrationStatus }>("/integrations/status");
  return raw.status;
}

export async function prepareScanSession(payload: {
  appointmentId: number;
  patientId?: number | null;
  documentType?: string;
  appointmentRefType?: AppointmentRefType;
}) {
  return api<{ preparation: RawRecord }>("/integrations/scan-prepare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function adminBulkDeleteDocuments(payload: {
  mode: "all" | "appointment_date_range";
  dateFrom?: string;
  dateTo?: string;
}) {
  return api<{ deletedCount: number; failedCount: number; failures: Array<{ documentId: number; reason: string }> }>(
    "/admin/documents/delete",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export async function adminMoveDocumentsToStorage(payload: {
  mode: "all" | "appointment_date_range";
  dateFrom?: string;
  dateTo?: string;
}) {
  return api<{
    movedCount: number;
    failedCount: number;
    skippedCount: number;
    failures: Array<{ documentId: number; reason: string }>;
  }>("/admin/documents/move-storage", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function adminTestDocumentStorageConnectivity() {
  return api<{ ok: boolean; path: string; authUsername: string; message: string }>(
    "/admin/documents/storage-test",
    { method: "POST" }
  );
}

export async function login(username: string, password: string): Promise<User> {
  const res = await api<{ user: RawRecord }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return mapUser(res.user);
}

export async function reAuthSupervisor(password: string): Promise<User> {
  const res = await api<{ user: RawRecord }>("/auth/re-auth", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  return mapUser(res.user);
}

export async function logout() {
  await api("/auth/logout", { method: "POST" });
}

// -- Lookups --
export async function fetchAppointmentLookups(): Promise<AppointmentLookups> {
  const [modalitiesRes, prioritiesRes, specialReasonsRes] = await Promise.all([
    api<{ items: RawRecord[] }>("/v2/lookups/modalities"),
    api<{ items: RawRecord[] }>("/v2/lookups/priorities"),
    api<{ items: RawRecord[] }>("/v2/lookups/special-reason-codes"),
  ]);
  return mapAppointmentLookups({
    modalities: modalitiesRes.items ?? [],
    examTypes: [],
    priorities: (prioritiesRes.items ?? []).map((p) => ({
      id: p.id,
      code: p.code ?? String(p.nameEn ?? p.name ?? "priority"),
      name_en: p.nameEn ?? p.name,
      name_ar: p.nameAr ?? p.name,
      sort_order: 0,
    })),
    specialReasons: specialReasonsRes.items ?? [],
  });
}

// -- Dashboard Data --
export async function fetchQueueSnapshot(): Promise<QueueSnapshot> {
  const raw = await api<RawRecord>("/v2/read/queue");
  return mapQueueSnapshot(raw);
}

export async function fetchDaySettings() {
  return api<RawRecord>("/appointments/day-settings");
}

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
    warnings: RawRecord;
    lastAppointment: RawRecord | null;
    nextAppointment: RawRecord | null;
    recentAppointments: RawRecord[];
  }>(`/patients/${patientId}/directory-summary`);

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
      identifierValue: (raw.identifiers?.identifierValue as string | null) ?? (raw.identifiers?.identifier_value as string | null)
    },
    contact: {
      phone1: (raw.contact?.phone1 as string | null) ?? (raw.contact?.phone_1 as string | null),
      phone2: (raw.contact?.phone2 as string | null) ?? (raw.contact?.phone_2 as string | null),
      address: raw.contact?.address as string | null
    },
    category: raw.category as "oncology" | "non_oncology" | null,
    warnings: {
      missingPhone: Boolean(raw.warnings?.missingPhone),
      missingDob: Boolean(raw.warnings?.missingDob),
      missingSex: Boolean(raw.warnings?.missingSex),
      missingName: Boolean(raw.warnings?.missingName),
      incompleteData: Boolean(raw.warnings?.incompleteData),
      possibleDuplicate: Boolean(raw.warnings?.possibleDuplicate),
      duplicateReasons: (raw.warnings?.duplicateReasons as string[]) || []
    },
    lastAppointment: raw.lastAppointment as PatientDirectorySummary["lastAppointment"],
    nextAppointment: raw.nextAppointment as PatientDirectorySummary["nextAppointment"],
    recentAppointments: (raw.recentAppointments as PatientDirectorySummary["recentAppointments"]) || []
  };
}

export async function mergePatients(targetPatientId: number, sourcePatientId: number, confirmationText = "MERGE") {
  return api<{ patient: RawRecord }>("/patients/merge", {
    method: "POST",
    body: JSON.stringify({ targetPatientId, sourcePatientId, confirmationText })
  });
}

export async function fetchPatientNoShowHistory(patientId: number) {
  return api<{ noShowCount: number; lastNoShowDate: string | null }>(`/patients/${patientId}/no-show`);
}

// -- Appointments --
export async function getAppointmentAvailability(
  modalityId: number,
  days = 14,
  offset = 0,
  options: {
    examTypeId?: number;
    caseCategory?: string;
    useSpecialQuota?: boolean;
    specialReasonCode?: string;
    includeOverrideCandidates?: boolean;
  } = {}
) {
  const params = new URLSearchParams();
  params.set("modalityId", String(modalityId));
  params.set("days", String(days));
  params.set("offset", String(offset));
  if (options.examTypeId) params.set("examTypeId", String(options.examTypeId));
  if (options.caseCategory) params.set("caseCategory", options.caseCategory);
  if (options.useSpecialQuota) params.set("useSpecialQuota", "true");
  if (options.specialReasonCode) params.set("specialReasonCode", options.specialReasonCode);
  if (options.includeOverrideCandidates) params.set("includeOverrideCandidates", "true");
  const raw = await api<{ availability: RawRecord[] }>(`/appointments/availability?${params.toString()}`);
  return raw.availability;
}

export async function getAppointmentSuggestions(params: {
  modalityId: number;
  examTypeId?: number | null;
  caseCategory?: string;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  includeOverrideCandidates?: boolean;
  days?: number;
}) {
  const query = new URLSearchParams();
  query.set("modalityId", String(params.modalityId));
  query.set("days", String(params.days || 30));
  if (params.examTypeId) query.set("examTypeId", String(params.examTypeId));
  if (params.caseCategory) query.set("caseCategory", params.caseCategory);
  if (params.useSpecialQuota) query.set("useSpecialQuota", "true");
  if (params.specialReasonCode) query.set("specialReasonCode", params.specialReasonCode);
  if (params.includeOverrideCandidates) query.set("includeOverrideCandidates", "true");
  const raw = await api<{ suggestions: RawRecord[] }>(`/appointments/suggestions?${query.toString()}`);
  return raw.suggestions;
}

export async function getAppointmentById(id: number) {
  const raw = await api<{ appointment: RawRecord }>(`/v2/read/appointments/${id}`);
  return mapAppointmentWithDetails(raw.appointment);
}

export async function getV2AppointmentPrintDetails(bookingId: number) {
  const raw = await api<{ appointment: RawRecord }>(`/v2/read/appointments/${bookingId}`);
  return mapAppointmentWithDetails(raw.appointment);
}

export interface PublicAppointmentCancelPreview {
  bookingId: number;
  patientDisplayName: string;
  bookingDate: string;
  bookingTime?: string;
  requiresReport?: boolean;
  reportFeature?: {
    allowReportAccess: boolean;
    allowImageAccess: boolean;
    reportAccessAllowedForModality?: boolean;
    imageAccessAllowedForModality?: boolean;
    showReportPendingCard: boolean;
    reportAccessRequiresCompletedAppointment: boolean;
    imageAccessRequiresCompletedAppointment: boolean;
    imageAccessRequiresReportRequiredFlag: boolean;
    showReportNotRequiredMessage: boolean;
    qrReportCheckingMessage: string;
    qrReportCheckButtonLabel: string;
    qrReportViewButtonLabel: string;
    qrImageViewButtonLabel: string;
    qrReportNotRequiredMessage: string;
    qrReportNotCompletedMessage: string;
    qrImageUnavailableMessage: string;
    qrReportStudyNotFoundMessage: string;
    qrImageStudyNotFoundMessage: string;
  };
  modalityName?: string;
  modalityId?: number;
  modalityNameAr?: string;
  modalityNameEn?: string;
  examName?: string;
  examNameAr?: string;
  examNameEn?: string;
  modalityInstructionAr?: string;
  modalityInstructionEn?: string;
  examInstructionAr?: string;
  examInstructionEn?: string;
  currentStatus: string;
  patientQrSettings?: PatientQrSettings;
}

export interface PublicAppointmentCancelResult {
  ok: boolean;
  alreadyCancelled: boolean;
  bookingId: number;
  status: string;
  previousStatus?: string;
}

export async function fetchPublicAppointmentCancelPreview(token: string): Promise<PublicAppointmentCancelPreview> {
  const query = new URLSearchParams({ t: token });
  const raw = await api<{ preview: RawRecord; settings?: RawRecord | RawRecord[] }>(`/public/appointments/cancel-preview?${query.toString()}`);
  const preview = raw.preview ?? {};

  // Handle both array format (raw records) and object format from the public endpoint.
  let patientQrSettings: PatientQrSettings | undefined;
  if (raw.settings) {
    if (Array.isArray(raw.settings)) {
      patientQrSettings = raw.settings.length > 0 ? sanitizePatientQrTextEncoding(normalizePatientQrSettings(raw.settings[0])) : undefined;
    } else {
      patientQrSettings = sanitizePatientQrTextEncoding(normalizePatientQrSettings(raw.settings));
    }
  }

  return {
    bookingId: Number(preview.bookingId ?? preview.booking_id ?? 0),
    patientDisplayName: String(preview.patientDisplayName ?? preview.patient_display_name ?? ""),
    bookingDate: String(preview.bookingDate ?? preview.booking_date ?? ""),
    bookingTime: String(preview.bookingTime ?? preview.booking_time ?? ""),
    requiresReport: Boolean(preview.requiresReport ?? preview.requires_report),
    reportFeature: preview.reportFeature as PublicAppointmentCancelPreview["reportFeature"],
    modalityId: Number(preview.modalityId ?? preview.modality_id ?? 0) || undefined,
    modalityName: String(preview.modalityName ?? preview.modality_name ?? preview.modalityNameAr ?? preview.modality_name_ar ?? "—"),
    modalityNameAr: String(preview.modalityNameAr ?? preview.modality_name_ar ?? ""),
    modalityNameEn: String(preview.modalityNameEn ?? preview.modality_name_en ?? ""),
    examName: String(preview.examName ?? preview.exam_name ?? preview.examNameAr ?? preview.exam_name_ar ?? "—"),
    examNameAr: String(preview.examNameAr ?? preview.exam_name_ar ?? ""),
    examNameEn: String(preview.examNameEn ?? preview.exam_name_en ?? ""),
    modalityInstructionAr: String(preview.modalityInstructionAr ?? preview.modality_instruction_ar ?? ""),
    modalityInstructionEn: String(preview.modalityInstructionEn ?? preview.modality_instruction_en ?? ""),
    examInstructionAr: String(preview.examInstructionAr ?? preview.exam_instruction_ar ?? ""),
    examInstructionEn: String(preview.examInstructionEn ?? preview.exam_instruction_en ?? ""),
    currentStatus: String(preview.currentStatus ?? preview.current_status ?? ""),
    patientQrSettings,
  };
}

export async function cancelPublicAppointment(token: string): Promise<PublicAppointmentCancelResult> {
  const query = new URLSearchParams({ t: token });
  const raw = await api<RawRecord>(`/public/appointments/cancel?${query.toString()}`, {
    method: "POST",
  });

  return {
    ok: Boolean(raw.ok),
    alreadyCancelled: Boolean(raw.alreadyCancelled ?? raw.already_cancelled),
    bookingId: Number(raw.bookingId ?? raw.booking_id ?? 0),
    status: String(raw.status ?? ""),
    previousStatus: raw.previousStatus == null ? undefined : String(raw.previousStatus),
  };
}

export interface PublicReportStatusResponse {
  enabled: boolean;
  state: "final" | "draft" | "no_report" | "study_not_found" | "unavailable" | "not_required" | "not_completed" | "disabled";
  canViewReport: boolean;
  message: string;
  checkButtonLabel: string;
  viewButtonLabel: string;
}

export async function fetchPublicAppointmentReportStatus(token: string): Promise<PublicReportStatusResponse> {
  const query = new URLSearchParams({ t: token });
  return api<PublicReportStatusResponse>(`/public/appointments/report-status?${query.toString()}`);
}

export interface PatientPushPreferences {
  appointmentReminder24h: boolean;
  appointmentRescheduled: boolean;
  appointmentCancelled: boolean;
  appointmentChanged: boolean;
  reportReady: boolean;
  imageReady: boolean;
}

export interface PublicPushConfigResponse {
  enabled: boolean;
  vapidPublicKey: string;
  defaults: PatientPushPreferences;
  labels: {
    cardTitleAr: string;
    cardTitleEn: string;
    cardBodyAr: string;
    cardBodyEn: string;
    subscribeButtonAr: string;
    subscribeButtonEn: string;
    unsubscribeButtonAr: string;
    unsubscribeButtonEn: string;
    testButtonAr: string;
    testButtonEn: string;
    unsupportedMessageAr: string;
    unsupportedMessageEn: string;
    iosHelpButtonAr: string;
    iosHelpButtonEn: string;
    iosHelpTitleAr: string;
    iosHelpTitleEn: string;
    iosHelpBodyAr: string;
    iosHelpBodyEn: string;
    deniedMessageAr: string;
    deniedMessageEn: string;
  };
}

export async function fetchPublicPushConfig(token: string): Promise<PublicPushConfigResponse> {
  const query = new URLSearchParams({ t: token });
  return api<PublicPushConfigResponse>(`/public/appointments/push-config?${query.toString()}`);
}

export async function subscribePublicPush(token: string, subscription: PushSubscriptionJSON, preferences: PatientPushPreferences) {
  const query = new URLSearchParams({ t: token });
  return api<{ ok: true; subscriptionId: number; bookingSubscriptionId: number }>(`/public/appointments/push-subscribe?${query.toString()}`, {
    method: "POST",
    body: JSON.stringify({ subscription, preferences }),
  });
}

export async function unsubscribePublicPush(token: string, subscription: PushSubscriptionJSON) {
  const query = new URLSearchParams({ t: token });
  return api<{ ok: true; disabled: boolean }>(`/public/appointments/push-unsubscribe?${query.toString()}`, {
    method: "POST",
    body: JSON.stringify({ subscription }),
  });
}

export async function testPublicPush(token: string) {
  const query = new URLSearchParams({ t: token });
  return api<{ ok: true; eventId: number | null; attempted: number; sent: number }>(`/public/appointments/push-test?${query.toString()}`, {
    method: "POST",
  });
}

export interface PatientQrContactSettings {
  primaryPhone: string;
  secondaryPhone: string;
  whatsapp: string;
  whatsappEnabled: boolean;
  workingHoursAr: string;
  workingHoursEn: string;
  noteAr: string;
  noteEn: string;
}

export interface PatientQrLocationSettings {
  centerNameAr: string;
  centerNameEn: string;
  departmentLocationAr: string;
  departmentLocationEn: string;
  roomUnitFloorAr: string;
  roomUnitFloorEn: string;
  addressAr: string;
  addressEn: string;
  arrivalInstructionsAr: string;
  arrivalInstructionsEn: string;
  googleMapsUrl: string;
  parkingNoteAr: string;
  parkingNoteEn: string;
}

export interface PatientQrSettings {
  enabled: boolean;
  risproPublicBaseUrl: string;
  printQrOnAppointmentSlip: boolean;
  allowCancellation: boolean;
  allowAddToCalendar: boolean;
  showBookingTime: boolean;
  showPreparationInstructions: boolean;
  showDocumentsChecklist: boolean;
  showDepartmentContact: boolean;
  showLocationDirections: boolean;
  allowReportAccess: boolean;
  reportAccessModalityMode: "all" | "include" | "exclude";
  reportAccessModalityIds: number[];
  allowImageAccess: boolean;
  imageAccessModalityMode: "all" | "include" | "exclude";
  imageAccessModalityIds: number[];
  showReportPendingCard: boolean;
  reportAccessRequiresCompletedAppointment: boolean;
  imageAccessRequiresCompletedAppointment: boolean;
  imageAccessRequiresReportRequiredFlag: boolean;
  showReportNotRequiredMessage: boolean;
  defaultReportRequiredForOncology: boolean;
  defaultReportRequiredForNonOncology: boolean;
  qrReportCheckingMessage: string;
  qrReportFinalMessage: string;
  qrReportDraftMessage: string;
  qrReportNoReportMessage: string;
  qrReportUnavailableMessage: string;
  qrReportNotRequiredMessage: string;
  qrReportNotCompletedMessage: string;
  qrReportCheckButtonLabel: string;
  qrReportViewButtonLabel: string;
  qrImageViewButtonLabel: string;
  qrImageUnavailableMessage: string;
  qrReportStudyNotFoundMessage: string;
  qrImageStudyNotFoundMessage: string;
  webPushEnabled: boolean;
  webPushDefaultReminder24h: boolean;
  webPushDefaultRescheduled: boolean;
  webPushDefaultCancelled: boolean;
  webPushDefaultChanged: boolean;
  webPushDefaultReportReady: boolean;
  webPushDefaultImageReady: boolean;
  webPushCardTitleAr: string;
  webPushCardTitleEn: string;
  webPushCardBodyAr: string;
  webPushCardBodyEn: string;
  webPushSubscribeButtonAr: string;
  webPushSubscribeButtonEn: string;
  webPushUnsubscribeButtonAr: string;
  webPushUnsubscribeButtonEn: string;
  webPushTestButtonAr: string;
  webPushTestButtonEn: string;
  webPushUnsupportedMessageAr: string;
  webPushUnsupportedMessageEn: string;
  webPushIosHelpButtonAr: string;
  webPushIosHelpButtonEn: string;
  webPushIosHelpTitleAr: string;
  webPushIosHelpTitleEn: string;
  webPushIosHelpBodyAr: string;
  webPushIosHelpBodyEn: string;
  webPushDeniedMessageAr: string;
  webPushDeniedMessageEn: string;
  webPushAppointmentReminder24hTitle: string;
  webPushAppointmentReminder24hBody: string;
  webPushAppointmentReminder24hTitleAr: string;
  webPushAppointmentReminder24hBodyAr: string;
  webPushAppointmentRescheduledTitle: string;
  webPushAppointmentRescheduledBody: string;
  webPushAppointmentRescheduledTitleAr: string;
  webPushAppointmentRescheduledBodyAr: string;
  webPushAppointmentCancelledTitle: string;
  webPushAppointmentCancelledBody: string;
  webPushAppointmentCancelledTitleAr: string;
  webPushAppointmentCancelledBodyAr: string;
  webPushAppointmentChangedTitle: string;
  webPushAppointmentChangedBody: string;
  webPushAppointmentChangedTitleAr: string;
  webPushAppointmentChangedBodyAr: string;
  webPushReportReadyTitle: string;
  webPushReportReadyBody: string;
  webPushReportReadyTitleAr: string;
  webPushReportReadyBodyAr: string;
  webPushImageReadyTitle: string;
  webPushImageReadyBody: string;
  webPushImageReadyTitleAr: string;
  webPushImageReadyBodyAr: string;
  webPushTestTitle: string;
  webPushTestBody: string;
  webPushTestTitleAr: string;
  webPushTestBodyAr: string;
  whatsappQrLinkMessageAr: string;
  whatsappQrLinkMessageEn: string;
  whatsappReminderMessageAr: string;
  whatsappReminderMessageEn: string;
  whatsappRescheduledMessageAr: string;
  whatsappRescheduledMessageEn: string;
  whatsappChangedMessageAr: string;
  whatsappChangedMessageEn: string;
  whatsappCancelledMessageAr: string;
  whatsappCancelledMessageEn: string;
  pageTitleAr: string;
  pageTitleEn: string;
  introTextAr: string;
  introTextEn: string;
  genericPreparationTextAr: string;
  genericPreparationTextEn: string;
  documentsChecklistAr: string[];
  documentsChecklistEn: string[];
  contact: PatientQrContactSettings;
  location: PatientQrLocationSettings;
}

export const DEFAULT_PATIENT_QR_SETTINGS: PatientQrSettings = {
  enabled: true,
  risproPublicBaseUrl: "https://rispro.nccb.com.ly",
  printQrOnAppointmentSlip: true,
  allowCancellation: true,
  allowAddToCalendar: true,
  showBookingTime: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: false,
  showLocationDirections: false,
  allowReportAccess: false,
  reportAccessModalityMode: "all",
  reportAccessModalityIds: [],
  allowImageAccess: false,
  imageAccessModalityMode: "all",
  imageAccessModalityIds: [],
  showReportPendingCard: true,
  reportAccessRequiresCompletedAppointment: true,
  imageAccessRequiresCompletedAppointment: true,
  imageAccessRequiresReportRequiredFlag: false,
  showReportNotRequiredMessage: false,
  defaultReportRequiredForOncology: true,
  defaultReportRequiredForNonOncology: false,
  qrReportCheckingMessage: "Checking report status...",
  qrReportFinalMessage: "Your report is ready.",
  qrReportDraftMessage: "Your report is still under review and is not finalized yet.",
  qrReportNoReportMessage: "No report is available for this appointment yet.",
  qrReportUnavailableMessage: "The report system is temporarily unavailable. Please try again later.",
  qrReportNotRequiredMessage: "",
  qrReportNotCompletedMessage: "Report access becomes available after the examination is completed.",
  qrReportCheckButtonLabel: "Check report",
  qrReportViewButtonLabel: "View report",
  qrImageViewButtonLabel: "View images",
  qrImageUnavailableMessage: "Image viewing is currently unavailable. Please try again later.",
  qrReportStudyNotFoundMessage: "Your study is not available in the report system yet. Please try again later.",
  qrImageStudyNotFoundMessage: "Your study images are not available yet. Please try again later.",
  pageTitleAr: "خدمة المريض عبر رمز QR",
  webPushEnabled: false,
  webPushDefaultReminder24h: true,
  webPushDefaultRescheduled: true,
  webPushDefaultCancelled: true,
  webPushDefaultChanged: true,
  webPushDefaultReportReady: true,
  webPushDefaultImageReady: false,
  webPushCardTitleAr: "تذكير وتنبيهات الموعد",
  webPushCardTitleEn: "Appointment reminders and alerts",
  webPushCardBodyAr: "يمكنك تفعيل تنبيهات المتصفح لهذا الموعد.",
  webPushCardBodyEn: "You can enable browser notifications for this appointment.",
  webPushSubscribeButtonAr: "تفعيل التنبيهات",
  webPushSubscribeButtonEn: "Enable notifications",
  webPushUnsubscribeButtonAr: "إيقاف التنبيهات",
  webPushUnsubscribeButtonEn: "Disable notifications",
  webPushTestButtonAr: "إرسال تنبيه تجريبي",
  webPushTestButtonEn: "Send test notification",
  webPushUnsupportedMessageAr: "تنبيهات المتصفح غير مدعومة على هذا الجهاز.",
  webPushUnsupportedMessageEn: "Browser notifications are not supported on this device.",
  webPushIosHelpButtonAr: "طريقة التفعيل على iPhone",
  webPushIosHelpButtonEn: "How to enable on iPhone",
  webPushIosHelpTitleAr: "لتفعيل التنبيهات على iPhone",
  webPushIosHelpTitleEn: "To enable notifications on iPhone",
  webPushIosHelpBodyAr: "افتح هذه الصفحة في Safari، اضغط زر المشاركة، اختر إضافة إلى الشاشة الرئيسية، ثم افتح RISpro من الأيقونة الجديدة وفعّل التنبيهات من هناك. يتطلب ذلك iOS 16.4 أو أحدث.",
  webPushIosHelpBodyEn: "Open this page in Safari, tap Share, choose Add to Home Screen, then open RISpro from the new icon and enable notifications there. This requires iOS 16.4 or later.",
  webPushDeniedMessageAr: "تم رفض إذن التنبيهات من المتصفح.",
  webPushDeniedMessageEn: "Notification permission was denied in this browser.",
  webPushAppointmentReminder24hTitle: "Appointment reminder",
  webPushAppointmentReminder24hBody: "You have an appointment soon. Open your appointment page for details.",
  webPushAppointmentReminder24hTitleAr: "تذكير بالموعد",
  webPushAppointmentReminder24hBodyAr: "لديك موعد قريب. افتح صفحة الموعد للاطلاع على التفاصيل.",
  webPushAppointmentRescheduledTitle: "Appointment updated",
  webPushAppointmentRescheduledBody: "Your appointment date or time changed. Open your appointment page for details.",
  webPushAppointmentRescheduledTitleAr: "تم تحديث الموعد",
  webPushAppointmentRescheduledBodyAr: "تم تغيير تاريخ أو وقت الموعد. افتح صفحة الموعد للاطلاع على التفاصيل.",
  webPushAppointmentCancelledTitle: "Appointment cancelled",
  webPushAppointmentCancelledBody: "Your appointment has been cancelled. Open your appointment page for details.",
  webPushAppointmentCancelledTitleAr: "تم إلغاء الموعد",
  webPushAppointmentCancelledBodyAr: "تم إلغاء موعدك. افتح صفحة الموعد للاطلاع على التفاصيل.",
  webPushAppointmentChangedTitle: "Appointment updated",
  webPushAppointmentChangedBody: "Your appointment details changed. Open your appointment page for details.",
  webPushAppointmentChangedTitleAr: "تم تحديث الموعد",
  webPushAppointmentChangedBodyAr: "تم تحديث تفاصيل الموعد. افتح صفحة الموعد للاطلاع على التفاصيل.",
  webPushReportReadyTitle: "Report ready",
  webPushReportReadyBody: "Your report is ready. Open your appointment page for access options.",
  webPushReportReadyTitleAr: "التقرير جاهز",
  webPushReportReadyBodyAr: "تقريرك جاهز. افتح صفحة الموعد للاطلاع على خيارات الوصول.",
  webPushImageReadyTitle: "Images ready",
  webPushImageReadyBody: "Your images are ready. Open your appointment page for access options.",
  webPushImageReadyTitleAr: "الصور جاهزة",
  webPushImageReadyBodyAr: "صورك جاهزة. افتح صفحة الموعد للاطلاع على خيارات الوصول.",
  webPushTestTitle: "Notifications enabled",
  webPushTestBody: "Browser notifications are enabled for this appointment.",
  webPushTestTitleAr: "تم تفعيل التنبيهات",
  webPushTestBodyAr: "تم تفعيل تنبيهات المتصفح لهذا الموعد.",
  whatsappQrLinkMessageAr: "يرجى فتح صفحة الموعد من هنا:\n{link}",
  whatsappQrLinkMessageEn: "Please open your appointment page here:\n{link}",
  whatsappReminderMessageAr: "تذكير: لديك موعد بتاريخ {date}. يرجى فتح صفحة الموعد للاطلاع على التفاصيل:\n{link}",
  whatsappReminderMessageEn: "Reminder: you have an appointment on {date}. Please open your appointment page for details:\n{link}",
  whatsappRescheduledMessageAr: "تم تغيير موعدك. يرجى فتح صفحة الموعد لمعرفة التاريخ والوقت المحدثين:\n{link}",
  whatsappRescheduledMessageEn: "Your appointment has been rescheduled. Please open your appointment page for the updated date and time:\n{link}",
  whatsappChangedMessageAr: "تم تحديث تفاصيل موعدك. يرجى فتح صفحة الموعد لمعرفة آخر المعلومات:\n{link}",
  whatsappChangedMessageEn: "Your appointment details have been updated. Please open your appointment page for the latest information:\n{link}",
  whatsappCancelledMessageAr: "تم إلغاء موعدك. يرجى فتح صفحة الموعد للاطلاع على التفاصيل:\n{link}",
  whatsappCancelledMessageEn: "Your appointment has been cancelled. Please open your appointment page for details:\n{link}",
  pageTitleEn: "Patient QR Service",
  introTextAr: "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة.",
  introTextEn: "You can review appointment details, instructions, and department information from this page.",
  genericPreparationTextAr: "",
  genericPreparationTextEn: "",
  documentsChecklistAr: [
    "ورقة الإحالة",
    "إثبات الهوية",
    "صور أو تقارير سابقة إن وجدت",
    "تحاليل حديثة إذا طُلبت من القسم",
  ],
  documentsChecklistEn: [
    "Referral paper",
    "ID proof",
    "Previous images or reports if available",
    "Recent tests if requested by the department",
  ],
  contact: {
    primaryPhone: "",
    secondaryPhone: "",
    whatsapp: "",
    whatsappEnabled: false,
    workingHoursAr: "",
    workingHoursEn: "",
    noteAr: "",
    noteEn: "",
  },
  location: {
    centerNameAr: "المركز الوطني للأورام بنغازي",
    centerNameEn: "National Cancer Center Benghazi",
    departmentLocationAr: "",
    departmentLocationEn: "",
    roomUnitFloorAr: "",
    roomUnitFloorEn: "",
    addressAr: "",
    addressEn: "",
    arrivalInstructionsAr: "",
    arrivalInstructionsEn: "",
    googleMapsUrl: "",
    parkingNoteAr: "",
    parkingNoteEn: "",
  },
};

export type AppointmentSlipPaperMode = "blank" | "preprinted";
export type AppointmentSlipLanguageMode = "ar" | "en" | "bilingual";
export type AppointmentSlipBarcodeValueMode = "accessionNumber" | "appointmentNumber" | "bookingId";
export type AppointmentSlipQrModalityMode = "all" | "include" | "exclude";

export interface AppointmentSlipSettings {
  paperMode: AppointmentSlipPaperMode;
  languageMode: AppointmentSlipLanguageMode;
  safeTopMm: number;
  safeBottomMm: number;
  safeLeftMm: number;
  safeRightMm: number;
  contentPaddingMm: number;
  fontScale: number;
  qrSizeMm: number;
  barcodeHeightMm: number;
  barcodeWidthMm: number;
  hospitalNameAr: string;
  hospitalNameEn: string;
  departmentNameAr: string;
  departmentNameEn: string;
  slipTitleAr: string;
  slipTitleEn: string;
  patientDetailsHeadingAr: string;
  patientDetailsHeadingEn: string;
  appointmentDetailsHeadingAr: string;
  appointmentDetailsHeadingEn: string;
  instructionsHeadingAr: string;
  instructionsHeadingEn: string;
  modalityInstructionsHeadingAr: string;
  modalityInstructionsHeadingEn: string;
  examInstructionsHeadingAr: string;
  examInstructionsHeadingEn: string;
  locationHeadingAr: string;
  locationHeadingEn: string;
  showPatientCategory: boolean;
  showPatientName: boolean;
  showMrn: boolean;
  showNationalId: boolean;
  showPhone: boolean;
  showAgeSex: boolean;
  showAppointmentNumber: boolean;
  showAccessionNumber: boolean;
  showModality: boolean;
  showExamName: boolean;
  showDate: boolean;
  showTime: boolean;
  showWalkIn: boolean;
  showSpecialReason: boolean;
  showLocation: boolean;
  showArrivalNote: boolean;
  boldAppointmentSlipText: boolean;
  showQrCode: boolean;
  qrModalityMode: AppointmentSlipQrModalityMode;
  qrModalityIds: number[];
  qrCaptionAr: string;
  qrCaptionEn: string;
  qrHelperTextAr: string;
  qrHelperTextEn: string;
  showAccessionBarcode: boolean;
  barcodeValueMode: AppointmentSlipBarcodeValueMode;
  barcodeCaptionAr: string;
  barcodeCaptionEn: string;
  showModalityInstructions: boolean;
  showExamSpecificInstructions: boolean;
  maxInstructionLinesOnSlip: number;
  fallbackInstructionTextAr: string;
  fallbackInstructionTextEn: string;
  locationTextAr: string;
  locationTextEn: string;
}

export const DEFAULT_APPOINTMENT_SLIP_SETTINGS: AppointmentSlipSettings = {
  paperMode: "preprinted",
  languageMode: "bilingual",
  safeTopMm: 58,
  safeBottomMm: 56,
  safeLeftMm: 10,
  safeRightMm: 10,
  contentPaddingMm: 3,
  fontScale: 1,
  qrSizeMm: 24,
  barcodeHeightMm: 12,
  barcodeWidthMm: 100,
  hospitalNameAr: "المركز الوطني للأورام بنغازي",
  hospitalNameEn: "National Cancer Center Benghazi",
  departmentNameAr: "قسم الأشعة التشخيصية",
  departmentNameEn: "Diagnostic Radiology Department",
  slipTitleAr: "وصل الموعد",
  slipTitleEn: "Appointment Slip",
  patientDetailsHeadingAr: "بيانات المريض",
  patientDetailsHeadingEn: "Patient Details",
  appointmentDetailsHeadingAr: "بيانات الموعد",
  appointmentDetailsHeadingEn: "Appointment Details",
  instructionsHeadingAr: "التعليمات",
  instructionsHeadingEn: "Instructions",
  modalityInstructionsHeadingAr: "تعليمات حسب نوع الجهاز",
  modalityInstructionsHeadingEn: "Modality Instructions",
  examInstructionsHeadingAr: "تعليمات خاصة بالفحص",
  examInstructionsHeadingEn: "Exam Instructions",
  locationHeadingAr: "موقع الفحص",
  locationHeadingEn: "Exam Location",
  showPatientCategory: false,
  showPatientName: true,
  showMrn: true,
  showNationalId: false,
  showPhone: true,
  showAgeSex: true,
  showAppointmentNumber: true,
  showAccessionNumber: true,
  showModality: true,
  showExamName: true,
  showDate: true,
  showTime: true,
  showWalkIn: true,
  showSpecialReason: false,
  showLocation: true,
  showArrivalNote: true,
  boldAppointmentSlipText: false,
  showQrCode: true,
  qrModalityMode: "all",
  qrModalityIds: [],
  qrCaptionAr: "امسح للاطلاع على تفاصيل الموعد",
  qrCaptionEn: "Scan for appointment details",
  qrHelperTextAr: "استخدم الرمز لعرض تعليمات الفحص والموقع وخدمات الموعد.",
  qrHelperTextEn: "Use this QR code to open your appointment page, instructions, and location details.",
  showAccessionBarcode: true,
  barcodeValueMode: "accessionNumber",
  barcodeCaptionAr: "امسح للدخول إلى قائمة الانتظار",
  barcodeCaptionEn: "Scan to Enter The Queue",
  showModalityInstructions: true,
  showExamSpecificInstructions: true,
  maxInstructionLinesOnSlip: 4,
  fallbackInstructionTextAr: "يرجى مسح رمز QR للاطلاع على تعليمات الجهاز والفحص والموقع.",
  fallbackInstructionTextEn: "Scan the QR code for modality instructions, exam-specific instructions, and location details.",
  locationTextAr: "",
  locationTextEn: "",
};


function normalizePatientQrSettings(raw: RawRecord): PatientQrSettings {
  const candidate = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rawValue =
    "setting_value" in candidate
      ? (candidate as RawRecord).setting_value
      : "value" in candidate
        ? (candidate as RawRecord).value
        : candidate;
  const config =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && "value" in rawValue
      ? (rawValue as RawRecord).value
      : rawValue;
  const record = (config && typeof config === "object" && !Array.isArray(config) ? config : {}) as RawRecord;
  const contact = (record.contact && typeof record.contact === "object" && !Array.isArray(record.contact) ? record.contact : {}) as RawRecord;
  const location = (record.location && typeof record.location === "object" && !Array.isArray(record.location) ? record.location : {}) as RawRecord;

  const bool = (value: unknown, fallback: boolean) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "enabled", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "disabled", "no", "off"].includes(normalized)) return false;
    }
    return fallback;
  };
  const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value).trim());
  const mode = (value: unknown): "all" | "include" | "exclude" => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "include" || normalized === "exclude") return normalized;
    return "all";
  };
  const numArray = (value: unknown): number[] =>
    Array.isArray(value)
      ? value
          .map((item) => Number(item))
          .filter((item, index, list) => Number.isFinite(item) && item > 0 && list.indexOf(item) === index)
      : [];

  return {
    enabled: bool(record.enabled, true),
    risproPublicBaseUrl: str(record.risproPublicBaseUrl, DEFAULT_PATIENT_QR_SETTINGS.risproPublicBaseUrl),
    printQrOnAppointmentSlip: bool(record.printQrOnAppointmentSlip, true),
    allowCancellation: bool(record.allowCancellation, true),
    allowAddToCalendar: bool(record.allowAddToCalendar, true),
    showBookingTime: bool(record.showBookingTime, true),
    showPreparationInstructions: bool(record.showPreparationInstructions, true),
    showDocumentsChecklist: bool(record.showDocumentsChecklist, true),
    showDepartmentContact: bool(record.showDepartmentContact, false),
    showLocationDirections: bool(record.showLocationDirections, false),
    allowReportAccess: bool(record.allowReportAccess, false),
    reportAccessModalityMode: mode(record.reportAccessModalityMode),
    reportAccessModalityIds: numArray(record.reportAccessModalityIds),
    allowImageAccess: bool(record.allowImageAccess, false),
    imageAccessModalityMode: mode(record.imageAccessModalityMode),
    imageAccessModalityIds: numArray(record.imageAccessModalityIds),
    showReportPendingCard: bool(record.showReportPendingCard, true),
    reportAccessRequiresCompletedAppointment: bool(record.reportAccessRequiresCompletedAppointment, true),
    imageAccessRequiresCompletedAppointment: bool(record.imageAccessRequiresCompletedAppointment, true),
    imageAccessRequiresReportRequiredFlag: bool(record.imageAccessRequiresReportRequiredFlag, false),
    showReportNotRequiredMessage: bool(record.showReportNotRequiredMessage, false),
    defaultReportRequiredForOncology: bool(record.defaultReportRequiredForOncology, true),
    defaultReportRequiredForNonOncology: bool(record.defaultReportRequiredForNonOncology, false),
    qrReportCheckingMessage: str(record.qrReportCheckingMessage, "Checking report status..."),
    qrReportFinalMessage: str(record.qrReportFinalMessage, "Your report is ready."),
    qrReportDraftMessage: str(record.qrReportDraftMessage, "Your report is still under review and is not finalized yet."),
    qrReportNoReportMessage: str(record.qrReportNoReportMessage, "No report is available for this appointment yet."),
    qrReportUnavailableMessage: str(record.qrReportUnavailableMessage, "The report system is temporarily unavailable. Please try again later."),
    qrReportNotRequiredMessage: str(record.qrReportNotRequiredMessage, ""),
    qrReportNotCompletedMessage: str(record.qrReportNotCompletedMessage, "Report access becomes available after the examination is completed."),
    qrReportCheckButtonLabel: str(record.qrReportCheckButtonLabel, "Check report"),
    qrReportViewButtonLabel: str(record.qrReportViewButtonLabel, "View report"),
    qrImageViewButtonLabel: str(record.qrImageViewButtonLabel, "View images"),
    qrImageUnavailableMessage: str(record.qrImageUnavailableMessage, "Image viewing is currently unavailable. Please try again later."),
    qrReportStudyNotFoundMessage: str(record.qrReportStudyNotFoundMessage, "Your study is not available in the report system yet. Please try again later."),
    qrImageStudyNotFoundMessage: str(record.qrImageStudyNotFoundMessage, "Your study images are not available yet. Please try again later."),
    webPushEnabled: bool(record.webPushEnabled, DEFAULT_PATIENT_QR_SETTINGS.webPushEnabled),
    webPushDefaultReminder24h: bool(record.webPushDefaultReminder24h, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultReminder24h),
    webPushDefaultRescheduled: bool(record.webPushDefaultRescheduled, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultRescheduled),
    webPushDefaultCancelled: bool(record.webPushDefaultCancelled, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultCancelled),
    webPushDefaultChanged: bool(record.webPushDefaultChanged, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultChanged),
    webPushDefaultReportReady: bool(record.webPushDefaultReportReady, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultReportReady),
    webPushDefaultImageReady: bool(record.webPushDefaultImageReady, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultImageReady),
    webPushCardTitleAr: str(record.webPushCardTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushCardTitleAr),
    webPushCardTitleEn: str(record.webPushCardTitleEn, DEFAULT_PATIENT_QR_SETTINGS.webPushCardTitleEn),
    webPushCardBodyAr: str(record.webPushCardBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushCardBodyAr),
    webPushCardBodyEn: str(record.webPushCardBodyEn, DEFAULT_PATIENT_QR_SETTINGS.webPushCardBodyEn),
    webPushSubscribeButtonAr: str(record.webPushSubscribeButtonAr, DEFAULT_PATIENT_QR_SETTINGS.webPushSubscribeButtonAr),
    webPushSubscribeButtonEn: str(record.webPushSubscribeButtonEn, DEFAULT_PATIENT_QR_SETTINGS.webPushSubscribeButtonEn),
    webPushUnsubscribeButtonAr: str(record.webPushUnsubscribeButtonAr, DEFAULT_PATIENT_QR_SETTINGS.webPushUnsubscribeButtonAr),
    webPushUnsubscribeButtonEn: str(record.webPushUnsubscribeButtonEn, DEFAULT_PATIENT_QR_SETTINGS.webPushUnsubscribeButtonEn),
    webPushTestButtonAr: str(record.webPushTestButtonAr, DEFAULT_PATIENT_QR_SETTINGS.webPushTestButtonAr),
    webPushTestButtonEn: str(record.webPushTestButtonEn, DEFAULT_PATIENT_QR_SETTINGS.webPushTestButtonEn),
    webPushUnsupportedMessageAr: str(record.webPushUnsupportedMessageAr, DEFAULT_PATIENT_QR_SETTINGS.webPushUnsupportedMessageAr),
    webPushUnsupportedMessageEn: str(record.webPushUnsupportedMessageEn, DEFAULT_PATIENT_QR_SETTINGS.webPushUnsupportedMessageEn),
    webPushIosHelpButtonAr: str(record.webPushIosHelpButtonAr, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpButtonAr),
    webPushIosHelpButtonEn: str(record.webPushIosHelpButtonEn, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpButtonEn),
    webPushIosHelpTitleAr: str(record.webPushIosHelpTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpTitleAr),
    webPushIosHelpTitleEn: str(record.webPushIosHelpTitleEn, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpTitleEn),
    webPushIosHelpBodyAr: str(record.webPushIosHelpBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpBodyAr),
    webPushIosHelpBodyEn: str(record.webPushIosHelpBodyEn, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpBodyEn),
    webPushDeniedMessageAr: str(record.webPushDeniedMessageAr, DEFAULT_PATIENT_QR_SETTINGS.webPushDeniedMessageAr),
    webPushDeniedMessageEn: str(record.webPushDeniedMessageEn, DEFAULT_PATIENT_QR_SETTINGS.webPushDeniedMessageEn),
    webPushAppointmentReminder24hTitle: str(record.webPushAppointmentReminder24hTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentReminder24hTitle),
    webPushAppointmentReminder24hBody: str(record.webPushAppointmentReminder24hBody, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentReminder24hBody),
    webPushAppointmentReminder24hTitleAr: str(record.webPushAppointmentReminder24hTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentReminder24hTitleAr),
    webPushAppointmentReminder24hBodyAr: str(record.webPushAppointmentReminder24hBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentReminder24hBodyAr),
    webPushAppointmentRescheduledTitle: str(record.webPushAppointmentRescheduledTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentRescheduledTitle),
    webPushAppointmentRescheduledBody: str(record.webPushAppointmentRescheduledBody, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentRescheduledBody),
    webPushAppointmentRescheduledTitleAr: str(record.webPushAppointmentRescheduledTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentRescheduledTitleAr),
    webPushAppointmentRescheduledBodyAr: str(record.webPushAppointmentRescheduledBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentRescheduledBodyAr),
    webPushAppointmentCancelledTitle: str(record.webPushAppointmentCancelledTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentCancelledTitle),
    webPushAppointmentCancelledBody: str(record.webPushAppointmentCancelledBody, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentCancelledBody),
    webPushAppointmentCancelledTitleAr: str(record.webPushAppointmentCancelledTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentCancelledTitleAr),
    webPushAppointmentCancelledBodyAr: str(record.webPushAppointmentCancelledBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentCancelledBodyAr),
    webPushAppointmentChangedTitle: str(record.webPushAppointmentChangedTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentChangedTitle),
    webPushAppointmentChangedBody: str(record.webPushAppointmentChangedBody, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentChangedBody),
    webPushAppointmentChangedTitleAr: str(record.webPushAppointmentChangedTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentChangedTitleAr),
    webPushAppointmentChangedBodyAr: str(record.webPushAppointmentChangedBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentChangedBodyAr),
    webPushReportReadyTitle: str(record.webPushReportReadyTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushReportReadyTitle),
    webPushReportReadyBody: str(record.webPushReportReadyBody, DEFAULT_PATIENT_QR_SETTINGS.webPushReportReadyBody),
    webPushReportReadyTitleAr: str(record.webPushReportReadyTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushReportReadyTitleAr),
    webPushReportReadyBodyAr: str(record.webPushReportReadyBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushReportReadyBodyAr),
    webPushImageReadyTitle: str(record.webPushImageReadyTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushImageReadyTitle),
    webPushImageReadyBody: str(record.webPushImageReadyBody, DEFAULT_PATIENT_QR_SETTINGS.webPushImageReadyBody),
    webPushImageReadyTitleAr: str(record.webPushImageReadyTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushImageReadyTitleAr),
    webPushImageReadyBodyAr: str(record.webPushImageReadyBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushImageReadyBodyAr),
    webPushTestTitle: str(record.webPushTestTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushTestTitle),
    webPushTestBody: str(record.webPushTestBody, DEFAULT_PATIENT_QR_SETTINGS.webPushTestBody),
    webPushTestTitleAr: str(record.webPushTestTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushTestTitleAr),
    webPushTestBodyAr: str(record.webPushTestBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushTestBodyAr),
    whatsappQrLinkMessageAr: str(record.whatsappQrLinkMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappQrLinkMessageAr),
    whatsappQrLinkMessageEn: str(record.whatsappQrLinkMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappQrLinkMessageEn),
    whatsappReminderMessageAr: str(record.whatsappReminderMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappReminderMessageAr),
    whatsappReminderMessageEn: str(record.whatsappReminderMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappReminderMessageEn),
    whatsappRescheduledMessageAr: str(record.whatsappRescheduledMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappRescheduledMessageAr),
    whatsappRescheduledMessageEn: str(record.whatsappRescheduledMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappRescheduledMessageEn),
    whatsappChangedMessageAr: str(record.whatsappChangedMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappChangedMessageAr),
    whatsappChangedMessageEn: str(record.whatsappChangedMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappChangedMessageEn),
    whatsappCancelledMessageAr: str(record.whatsappCancelledMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappCancelledMessageAr),
    whatsappCancelledMessageEn: str(record.whatsappCancelledMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappCancelledMessageEn),
    pageTitleAr: str(record.pageTitleAr, DEFAULT_PATIENT_QR_SETTINGS.pageTitleAr),
    pageTitleEn: str(record.pageTitleEn, DEFAULT_PATIENT_QR_SETTINGS.pageTitleEn),
    introTextAr: str(record.introTextAr, DEFAULT_PATIENT_QR_SETTINGS.introTextAr),
    introTextEn: str(record.introTextEn, DEFAULT_PATIENT_QR_SETTINGS.introTextEn),
    genericPreparationTextAr: str(record.genericPreparationTextAr, ""),
    genericPreparationTextEn: str(record.genericPreparationTextEn, ""),
    documentsChecklistAr: Array.isArray(record.documentsChecklistAr)
      ? record.documentsChecklistAr.map((item) => String(item).trim()).filter(Boolean)
      : [],
    documentsChecklistEn: Array.isArray(record.documentsChecklistEn)
      ? record.documentsChecklistEn.map((item) => String(item).trim()).filter(Boolean)
      : [],
    contact: {
      primaryPhone: str(contact.primaryPhone, ""),
      secondaryPhone: str(contact.secondaryPhone, ""),
      whatsapp: str(contact.whatsapp, ""),
      whatsappEnabled: bool(contact.whatsappEnabled, false),
      workingHoursAr: str(contact.workingHoursAr, ""),
      workingHoursEn: str(contact.workingHoursEn, ""),
      noteAr: str(contact.noteAr, ""),
      noteEn: str(contact.noteEn, ""),
    },
    location: {
      centerNameAr: str(location.centerNameAr, DEFAULT_PATIENT_QR_SETTINGS.location.centerNameAr),
      centerNameEn: str(location.centerNameEn, DEFAULT_PATIENT_QR_SETTINGS.location.centerNameEn),
      departmentLocationAr: str(location.departmentLocationAr, ""),
      departmentLocationEn: str(location.departmentLocationEn, ""),
      roomUnitFloorAr: str(location.roomUnitFloorAr, ""),
      roomUnitFloorEn: str(location.roomUnitFloorEn, ""),
      addressAr: str(location.addressAr, ""),
      addressEn: str(location.addressEn, ""),
      arrivalInstructionsAr: str(location.arrivalInstructionsAr, ""),
      arrivalInstructionsEn: str(location.arrivalInstructionsEn, ""),
      googleMapsUrl: str(location.googleMapsUrl, ""),
      parkingNoteAr: str(location.parkingNoteAr, ""),
      parkingNoteEn: str(location.parkingNoteEn, ""),
    },
  };
}

function normalizeAppointmentSlipSettings(raw: RawRecord): AppointmentSlipSettings {
  const candidate = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rawValue =
    "setting_value" in candidate
      ? (candidate as RawRecord).setting_value
      : "value" in candidate
        ? (candidate as RawRecord).value
        : candidate;
  const config =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && "value" in rawValue
      ? (rawValue as RawRecord).value
      : rawValue;
  const record = (config && typeof config === "object" && !Array.isArray(config) ? config : {}) as RawRecord;

  const bool = (value: unknown, fallback: boolean) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "enabled", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "disabled", "no", "off"].includes(normalized)) return false;
    }
    return fallback;
  };
  const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value).trim());
  const num = (value: unknown, fallback: number, min?: number, max?: number) => {
    const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
    if (!raw) return fallback;
    const parsed = typeof value === "number" ? value : Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    let next = parsed;
    if (typeof min === "number" && next < min) next = min;
    if (typeof max === "number" && next > max) next = max;
    return next;
  };

  const paperMode = str(record.paperMode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.paperMode);
  const languageMode = str(record.languageMode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.languageMode);
  const barcodeValueMode = str(record.barcodeValueMode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeValueMode);
  const qrModalityMode = str(record.qrModalityMode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrModalityMode);
  const qrModalityIds = Array.isArray(record.qrModalityIds)
    ? record.qrModalityIds
        .map((value) => Number(value))
        .filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index)
    : [];

  return {
    paperMode: paperMode === "blank" ? "blank" : "preprinted",
    languageMode: languageMode === "ar" || languageMode === "en" ? languageMode : "bilingual",
    safeTopMm: num(record.safeTopMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.safeTopMm, 0, 120),
    safeBottomMm: num(record.safeBottomMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.safeBottomMm, 0, 120),
    safeLeftMm: num(record.safeLeftMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.safeLeftMm, 0, 80),
    safeRightMm: num(record.safeRightMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.safeRightMm, 0, 80),
    contentPaddingMm: num(record.contentPaddingMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.contentPaddingMm, 0, 20),
    fontScale: num(record.fontScale, DEFAULT_APPOINTMENT_SLIP_SETTINGS.fontScale, 0.7, 1.6),
    qrSizeMm: num(record.qrSizeMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrSizeMm, 12, 48),
    barcodeHeightMm: num(record.barcodeHeightMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeHeightMm, 6, 28),
    barcodeWidthMm: num(record.barcodeWidthMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeWidthMm, 40, 130),
    /* legacy literal fallback removed; use centralized defaults */
    hospitalNameAr: str(record.hospitalNameAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.hospitalNameAr),
    hospitalNameEn: str(record.hospitalNameEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.hospitalNameEn),
    departmentNameAr: str(record.departmentNameAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.departmentNameAr),
    departmentNameEn: str(record.departmentNameEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.departmentNameEn),
    slipTitleAr: str(record.slipTitleAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.slipTitleAr),
    slipTitleEn: str(record.slipTitleEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.slipTitleEn),
    patientDetailsHeadingAr: str(record.patientDetailsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.patientDetailsHeadingAr),
    patientDetailsHeadingEn: str(record.patientDetailsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.patientDetailsHeadingEn),
    appointmentDetailsHeadingAr: str(record.appointmentDetailsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.appointmentDetailsHeadingAr),
    appointmentDetailsHeadingEn: str(record.appointmentDetailsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.appointmentDetailsHeadingEn),
    instructionsHeadingAr: str(record.instructionsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.instructionsHeadingAr),
    instructionsHeadingEn: str(record.instructionsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.instructionsHeadingEn),
    modalityInstructionsHeadingAr: str(record.modalityInstructionsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.modalityInstructionsHeadingAr),
    modalityInstructionsHeadingEn: str(record.modalityInstructionsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.modalityInstructionsHeadingEn),
    examInstructionsHeadingAr: str(record.examInstructionsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.examInstructionsHeadingAr),
    examInstructionsHeadingEn: str(record.examInstructionsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.examInstructionsHeadingEn),
    locationHeadingAr: str(record.locationHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.locationHeadingAr),
    locationHeadingEn: str(record.locationHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.locationHeadingEn),
    showPatientCategory: bool(record.showPatientCategory, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showPatientCategory),
    showPatientName: bool(record.showPatientName, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showPatientName),
    showMrn: bool(record.showMrn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showMrn),
    showNationalId: bool(record.showNationalId, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showNationalId),
    showPhone: bool(record.showPhone, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showPhone),
    showAgeSex: bool(record.showAgeSex, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showAgeSex),
    showAppointmentNumber: bool(record.showAppointmentNumber, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showAppointmentNumber),
    showAccessionNumber: bool(record.showAccessionNumber, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showAccessionNumber),
    showModality: bool(record.showModality, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showModality),
    showExamName: bool(record.showExamName, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showExamName),
    showDate: bool(record.showDate, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showDate),
    showTime: bool(record.showTime, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showTime),
    showWalkIn: bool(record.showWalkIn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showWalkIn),
    showSpecialReason: bool(record.showSpecialReason, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showSpecialReason),
    showLocation: bool(record.showLocation, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showLocation),
    showArrivalNote: bool(record.showArrivalNote, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showArrivalNote),
    boldAppointmentSlipText: bool(record.boldAppointmentSlipText, DEFAULT_APPOINTMENT_SLIP_SETTINGS.boldAppointmentSlipText),
    showQrCode: bool(record.showQrCode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showQrCode),
    qrModalityMode: qrModalityMode === "include" || qrModalityMode === "exclude" ? qrModalityMode : "all",
    qrModalityIds,
    qrCaptionAr: str(record.qrCaptionAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrCaptionAr),
    qrCaptionEn: str(record.qrCaptionEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrCaptionEn),
    qrHelperTextAr: str(record.qrHelperTextAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrHelperTextAr),
    qrHelperTextEn: str(record.qrHelperTextEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrHelperTextEn),
    showAccessionBarcode: bool(record.showAccessionBarcode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showAccessionBarcode),
    barcodeValueMode:
      barcodeValueMode === "appointmentNumber" || barcodeValueMode === "bookingId" ? barcodeValueMode : "accessionNumber",
    barcodeCaptionAr: str(record.barcodeCaptionAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeCaptionAr),
    barcodeCaptionEn: str(record.barcodeCaptionEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeCaptionEn),
    showModalityInstructions: bool(record.showModalityInstructions, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showModalityInstructions),
    showExamSpecificInstructions: bool(record.showExamSpecificInstructions, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showExamSpecificInstructions),
    maxInstructionLinesOnSlip: num(record.maxInstructionLinesOnSlip, DEFAULT_APPOINTMENT_SLIP_SETTINGS.maxInstructionLinesOnSlip, 1, 8),
    fallbackInstructionTextAr: str(record.fallbackInstructionTextAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.fallbackInstructionTextAr),
    fallbackInstructionTextEn: str(record.fallbackInstructionTextEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.fallbackInstructionTextEn),
    locationTextAr: str(record.locationTextAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.locationTextAr),
    locationTextEn: str(record.locationTextEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.locationTextEn),
  };
}

function looksLikeMojibake(value: string): boolean {
  return /Ã|Â|Ø|Ù|ï¿½|þ/.test(value);
}

function sanitizePatientQrTextEncoding(settings: PatientQrSettings): PatientQrSettings {
  const fixed: PatientQrSettings = {
    ...settings,
    contact: { ...settings.contact },
    location: { ...settings.location },
  };

  const sanitize = (value: string, fallback: string): string =>
    looksLikeMojibake(String(value ?? "")) ? fallback : value;

  fixed.pageTitleAr = sanitize(fixed.pageTitleAr, DEFAULT_PATIENT_QR_SETTINGS.pageTitleAr);
  fixed.introTextAr = sanitize(fixed.introTextAr, DEFAULT_PATIENT_QR_SETTINGS.introTextAr);
  fixed.location.centerNameAr = sanitize(
    fixed.location.centerNameAr,
    DEFAULT_PATIENT_QR_SETTINGS.location.centerNameAr
  );

  fixed.documentsChecklistAr = (fixed.documentsChecklistAr ?? []).map((item, index) =>
    sanitize(item, DEFAULT_PATIENT_QR_SETTINGS.documentsChecklistAr[index] ?? item)
  );

  return fixed;
}

function sanitizeAppointmentSlipTextEncoding(settings: AppointmentSlipSettings): AppointmentSlipSettings {
  const fixed = { ...settings };
  const keys: Array<keyof AppointmentSlipSettings> = [
    "hospitalNameAr",
    "departmentNameAr",
    "slipTitleAr",
    "patientDetailsHeadingAr",
    "appointmentDetailsHeadingAr",
    "instructionsHeadingAr",
    "modalityInstructionsHeadingAr",
    "examInstructionsHeadingAr",
    "locationHeadingAr",
    "qrCaptionAr",
    "qrHelperTextAr",
    "barcodeCaptionAr",
    "fallbackInstructionTextAr",
    "locationTextAr",
  ];
  for (const key of keys) {
    const value = String(fixed[key] ?? "");
    if (looksLikeMojibake(value)) {
      fixed[key] = DEFAULT_APPOINTMENT_SLIP_SETTINGS[key] as never;
    }
  }
  return fixed;
}

export async function fetchPatientQrSettings(): Promise<PatientQrSettings> {
  const response = await api<{ settings: RawRecord[] }>("/settings/patient_qr_self_service");
  const configRow = response.settings?.find((row) => row.setting_key === "config");
  return sanitizePatientQrTextEncoding(normalizePatientQrSettings(configRow ?? {}));
}

export async function savePatientQrSettings(payload: PatientQrSettings) {
  const result = await api<RawRecord>("/settings/patient_qr_self_service", {
    method: "PUT",
    body: JSON.stringify({
      entries: [{ key: "config", value: payload }],
    }),
  });
  if (payload.webPushEnabled) {
    await api<RawRecord>("/settings/patient-web-push/ensure-config", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
  return result;
}

export async function fetchAppointmentSlipSettings(): Promise<AppointmentSlipSettings> {
  const response = await api<{ settings: RawRecord[] }>("/settings/appointment_slip");
  const configRow = response.settings?.find((row) => row.setting_key === "config");
  const normalized = sanitizeAppointmentSlipTextEncoding(normalizeAppointmentSlipSettings(configRow ?? {}));
  return {
    ...DEFAULT_APPOINTMENT_SLIP_SETTINGS,
    ...normalized,
  };
}

export async function saveAppointmentSlipSettings(payload: AppointmentSlipSettings) {
  return api<RawRecord>("/settings/appointment_slip", {
    method: "PUT",
    body: JSON.stringify({
      entries: [{ key: "config", value: payload }],
    }),
  });
}

export async function updateAppointment(id: number, payload: RawRecord) {
  await api<{ booking: RawRecord }>(`/v2/appointments/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  const details = await api<{ appointment: RawRecord }>(`/v2/read/appointments/${id}`);
  return mapAppointmentWithDetails(details.appointment);
}

export async function cancelAppointment(id: number, _cancelReason: string) {
  const raw = await api<{ booking: RawRecord; previousStatus: string }>(`/v2/appointments/${id}/cancel`, {
    method: "POST"
  });
  return { appointment: raw.booking };
}

export async function deleteAppointment(id: number, voidReason: string) {
  await api<{ booking: RawRecord; previousStatus: string }>(`/v2/appointments/${id}/void`, {
    method: "POST",
    body: JSON.stringify({ voidReason })
  });
  return { ok: true };
}

export async function sendPatientWebPushNotification(
  id: number,
  payload: { title?: string; message?: string; templateEventType?: string }
) {
  return api<{ eventId: number | null; created: boolean }>(`/v2/appointments/${id}/patient-notification`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

// -- Registrations / Calendar / Modality / Doctor / Print (shared) --
export async function fetchAppointments(params: Record<string, string | string[]>) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (v) query.append(`${key}[]`, v);
      });
    } else if (value) {
      query.set(key, value);
    }
  });

  const raw = await api<{ appointments: RawRecord[] }>(`/v2/read/appointments?${query.toString()}`);
  return mapAppointmentsWithDetails(raw.appointments);
}

// -- Statistics --
export async function fetchStatistics(date: string, modalityId: string): Promise<AppointmentStatistics> {
  const params = new URLSearchParams();
  params.set("date", date);
  if (modalityId) params.set("modalityId", modalityId);
  const raw = await api<RawRecord>(`/v2/read/statistics?${params.toString()}`);
  return mapStatistics(raw);
}

// -- Queue --
export async function scanIntoQueue(scanValue: string) {
  return api<{ ok: true; bookingId: number }>("/v2/read/queue/scan", {
    method: "POST",
    body: JSON.stringify({ scanValue })
  });
}

export async function addWalkIn(payload: RawRecord) {
  return api<RawRecord>("/v2/read/queue/walk-in", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function confirmNoShow(appointmentId: number, reason: string) {
  return api<RawRecord>(`/v2/read/appointments/${appointmentId}/no-show`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

// -- Modality --
export async function fetchModalityWorklist(modalityId: string, date: string, scope: string) {
  const params = new URLSearchParams();
  params.set("modalityId", modalityId);
  if (scope === "day") {
    params.set("date", date);
  } else {
    params.set("scope", "all");
  }
  const raw = await api<{ appointments: RawRecord[] }>(`/v2/read/modality/worklist?${params.toString()}`);
  return mapAppointmentsWithDetails(raw.appointments);
}

export async function completeAppointment(id: number) {
  return api<RawRecord>(`/v2/read/appointments/${id}/complete`, { method: "POST" });
}

// -- Settings --
export async function fetchSettings(category: string) {
  const raw = await api<{ settings: RawRecord[] }>(`/settings/${category}`);
  return mapSettings(raw.settings ?? []);
}

export async function fetchPageVisibilityMatrix(): Promise<PageVisibilityMatrix> {
  const raw = await api<{ matrix?: unknown }>("/settings/users-and-roles/page-visibility");
  return normalizePageVisibilityMatrix(raw.matrix ?? {});
}

export async function savePageVisibilityMatrix(matrix: PageVisibilityMatrix): Promise<PageVisibilityMatrix> {
  const raw = await api<{ matrix?: unknown }>("/settings/users-and-roles/page-visibility", {
    method: "PUT",
    body: JSON.stringify({ matrix }),
  });
  return normalizePageVisibilityMatrix(raw.matrix ?? {});
}

export async function fetchSonicDicomSettings(): Promise<Record<string, unknown>> {
  const raw = await api<{ settings: RawRecord[] }>(`/settings/sonicdicom_reports`);
  const settings = raw.settings ?? [];
  const configRow = settings.find((row) => row.setting_key === "config");
  if (configRow?.setting_value && typeof configRow.setting_value === "object" && !Array.isArray(configRow.setting_value)) {
    const value = (configRow.setting_value as { value?: unknown }).value;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }
  return {};
}

export interface SonicDicomSqlReadinessResponse {
  ok: boolean;
  foundStudy: boolean;
  foundReport: boolean;
  normalizedState: "final" | "draft" | "no_report" | "unavailable" | "not_required" | "not_completed" | "disabled";
  canViewReport: boolean;
  statusCode: number | null;
  diagnostic: string;
}

export async function testSonicDicomSqlReadiness(payload: {
  mode: "sql_connection" | "accession_to_study" | "report_status" | "full_readiness";
  accessionNumber?: string;
  reportNo?: string;
}): Promise<SonicDicomSqlReadinessResponse> {
  return api<SonicDicomSqlReadinessResponse>("/settings/sonicdicom_reports/test-readiness", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function saveSettings(category: string, payload: Record<string, unknown>) {
  return api<{ settings: RawRecord }>(`/settings/${category}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function fetchSettingsCatalog() {
  const raw = await api<{ settings: Record<string, unknown[]> }>("/settings/");
  return raw.settings ?? {};
}

export async function fetchSchedulingEngineConfig(): Promise<SchedulingEngineConfig> {
  const raw = await api<{ config: SchedulingEngineConfig }>("/settings/scheduling-engine-config");
  return raw.config;
}

export async function saveSchedulingEngineConfig(payload: SchedulingEngineConfig) {
  const raw = await api<{ config: SchedulingEngineConfig }>("/settings/scheduling-engine-config", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return raw.config;
}

export async function fetchUsers(): Promise<{ users: User[] }> {
  const raw = await api<{ users: RawRecord[] }>("/users");
  return {
    users: (raw.users ?? []).map(mapUser)
  };
}

export async function createUser(payload: { username: string; fullName: string; password: string; role: string }) {
  return api<{ user: RawRecord }>("/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function deleteUser(userId: number) {
  return api<{ user: RawRecord }>(`/users/${userId}`, { method: "DELETE" });
}

export async function updateUserPassword(userId: number, password: string) {
  return api<{ user: RawRecord }>(`/users/${userId}/password`, {
    method: "PUT",
    body: JSON.stringify({ password })
  });
}

export async function fetchAuditEntries(limit: number): Promise<{ entries: AuditEntry[]; meta: RawRecord }> {
  const raw = await api<{ entries: RawRecord[]; meta: RawRecord }>(`/audit?limit=${limit}`);
  return {
    entries: mapAuditEntries(raw.entries ?? []),
    meta: raw.meta ?? {}
  };
}

export async function exportAuditCSV() {
  // Use fetch directly for blob download
  const response = await fetch(`/api/audit/export`, { credentials: "include" });
  if (!response.ok) throw new Error("Audit export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchExamTypes(includeInactive = false): Promise<{ modalities: RawRecord[]; examTypes: RawRecord[] }> {
  const query = includeInactive ? "?includeInactive=true" : "";
  const raw = await api<{ modalities: RawRecord[]; examTypes: RawRecord[] }>(`/settings/exam-types${query}`);
  return raw;
}

export async function fetchModalitiesSettings(includeInactive = false): Promise<{ modalities: RawRecord[] }> {
  const query = includeInactive ? "?includeInactive=true" : "";
  const raw = await api<{ modalities: RawRecord[] }>(`/settings/modalities${query}`);
  return raw;
}

export async function fetchNameDictionary(): Promise<{ entries: DictionaryEntry[]; meta: RawRecord }> {
  const raw = await api<{ entries: RawRecord[]; meta?: RawRecord }>("/settings/name-dictionary");
  return {
    entries: mapNameDictionary(raw.entries ?? []),
    meta: raw.meta ?? {}
  };
}

export async function upsertNameDictionaryEntry(arabicText: string, englishText: string) {
  return api<{ entry: RawRecord }>("/settings/name-dictionary", {
    method: "POST",
    body: JSON.stringify({ arabicText, englishText })
  });
}

export async function deleteNameDictionaryEntry(entryId: number) {
  return api<{ entry: RawRecord }>(`/settings/name-dictionary/${entryId}`, { method: "DELETE" });
}

export async function importNameDictionary(entries: { arabicText: string; englishText: string }[]) {
  return api<{ entries: RawRecord[] }>("/name-dictionary/import", {
    method: "POST",
    body: JSON.stringify({ entries })
  });
}

export async function fetchDicomDevices(): Promise<{ devices: DicomDevice[]; meta: RawRecord }> {
  const raw = await api<{ devices: RawRecord[]; meta?: RawRecord }>("/settings/dicom-devices");
  return {
    devices: mapDicomDevices(raw.devices ?? []),
    meta: raw.meta ?? {}
  };
}

export async function createModality(payload: RawRecord) {
  return api<{ modality: RawRecord }>("/settings/modalities", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateModality(id: number, payload: RawRecord) {
  return api<{ modality: RawRecord }>(`/settings/modalities/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deactivateModality(id: number) {
  return api<{ modality: RawRecord }>(`/settings/modalities/${id}/deactivate`, {
    method: "POST"
  });
}

export async function deleteModality(id: number) {
  return api<{ modality: RawRecord }>(`/settings/modalities/${id}`, { method: "DELETE" });
}

export async function createExamType(payload: RawRecord) {
  return api<{ examType: RawRecord }>("/settings/exam-types", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateExamType(id: number, payload: RawRecord) {
  return api<{ examType: RawRecord }>(`/settings/exam-types/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteExamType(id: number) {
  return api<{ examType: RawRecord }>(`/settings/exam-types/${id}`, { method: "DELETE" });
}

export async function hardDeleteExamType(id: number) {
  return api<{ examType: RawRecord }>(`/settings/exam-types/${id}/hard-delete`, { method: "DELETE" });
}

export async function exportCatalogWorkbook() {
  const response = await fetch("/api/settings/catalog-import-export.xlsx", { credentials: "include" });
  if (!response.ok) throw new Error("Catalog export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const disposition = response.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
  const filename = filenameMatch?.[1] || "rispro-modalities-exam-types.xlsx";
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importCatalogWorkbook(payload: { fileContentBase64: string }) {
  return api<{
    summary: {
      modalitiesCreated: number;
      modalitiesUpdated: number;
      examTypesCreated: number;
      examTypesUpdated: number;
      skipped: number;
      errors: Array<{ sheet: string; rowNumber: number; column: string | null; message: string }>;
    };
  }>("/settings/catalog-import-export", {
    method: "POST",
    body: JSON.stringify(payload)
  }, CATALOG_IMPORT_TIMEOUT_MS);
}

export async function previewCatalogWorkbookImport(payload: { fileContentBase64: string }) {
  return api<{
    preview: {
      workbook: { sheetNames: string[]; requiredSheets: string[] };
      progressNotes: string[];
      canApply: boolean;
      modalities: Array<Record<string, unknown>>;
      examTypes: Array<Record<string, unknown>>;
      summary: {
        modalitiesTotal: number;
        examTypesTotal: number;
        selectedModalities: number;
        selectedExamTypes: number;
        errors: number;
        warnings: number;
      };
      errors: Array<{ sheet: string; rowNumber: number; column: string | null; message: string; errorType?: string; severity?: string }>;
    };
  }>("/settings/catalog-import-export/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  }, CATALOG_IMPORT_TIMEOUT_MS);
}

export async function applyCatalogWorkbookImport(payload: {
  modalities: Array<Record<string, unknown>>;
  examTypes: Array<Record<string, unknown>>;
}) {
  return api<{
    summary: {
      modalitiesCreated: number;
      modalitiesUpdated: number;
      examTypesCreated: number;
      examTypesUpdated: number;
      skipped: number;
      errors: Array<{ sheet: string; rowNumber: number; column: string | null; message: string }>;
    };
  }>("/settings/catalog-import-export/apply", {
    method: "POST",
    body: JSON.stringify(payload)
  }, CATALOG_IMPORT_TIMEOUT_MS);
}

export async function createDicomDevice(payload: RawRecord) {
  return api<{ device: RawRecord }>("/settings/dicom-devices", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateDicomDevice(id: number, payload: RawRecord) {
  return api<{ device: RawRecord }>(`/settings/dicom-devices/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteDicomDevice(id: number) {
  return api<{ device: RawRecord }>(`/settings/dicom-devices/${id}`, { method: "DELETE" });
}

export async function fetchPacsConnection(): Promise<RawRecord> {
  const raw = await api<RawRecord>("/settings/pacs_connection");
  return raw;
}

export async function previewPatientImport(payload: {
  fileName: string;
  fileContentBase64: string;
  sheetName?: string;
  patientCategory?: "oncology" | "non_oncology";
  mapping: {
    arabic_full_name: string;
    national_id: string;
    phone?: string;
  };
}): Promise<{
  batch: PatientImportBatch;
  summary: Record<string, number>;
  workbook: { sheetNames: string[]; selectedSheetName: string; headers: string[] };
}> {
  return api("/settings/patient-import/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  }, IMPORT_PREVIEW_TIMEOUT_MS);
}

export async function inspectPatientImportWorkbook(payload: {
  fileContentBase64: string;
  sheetName?: string;
}): Promise<{ workbook: { sheetNames: string[]; selectedSheetName: string; headers: string[] } }> {
  return api("/settings/patient-import/workbook", {
    method: "POST",
    body: JSON.stringify(payload)
  }, IMPORT_WORKBOOK_TIMEOUT_MS);
}

export async function fetchPatientImportBatch(batchId: number): Promise<PatientImportBatch> {
  const raw = await api<{ batch: PatientImportBatch }>(`/settings/patient-import/batches/${batchId}`);
  return raw.batch;
}

export async function fetchPatientImportRows(batchId: number): Promise<PatientImportStagingRow[]> {
  const raw = await api<{ rows: PatientImportStagingRow[] }>(`/settings/patient-import/batches/${batchId}/rows`);
  return raw.rows || [];
}

export async function selectPatientImportRows(batchId: number, rowIds: number[], selected: boolean): Promise<{ updated: number }> {
  return api<{ updated: number }>(`/settings/patient-import/batches/${batchId}/select`, {
    method: "POST",
    body: JSON.stringify({ rowIds, selected })
  });
}

export async function confirmPatientImportBatch(batchId: number): Promise<{ migrated: number; skipped: number }> {
  return api<{ migrated: number; skipped: number }>(`/settings/patient-import/batches/${batchId}/confirm`, {
    method: "POST"
  }, IMPORT_CONFIRM_TIMEOUT_MS);
}

// -- PACS --
export async function searchPacs(patientNationalId: string) {
  return api<RawRecord>("/integrations/pacs-search", {
    method: "POST",
    body: JSON.stringify({ patientNationalId })
  });
}
