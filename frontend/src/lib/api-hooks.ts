import { ApiError, api } from "@/lib/api-client";
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
  PatientIdentifierTypeOption
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
  lastMoveAttemptAt: string | null;
  lastMoveError: string | null;
  createdAt: string;
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
    showReportPendingCard: boolean;
    reportAccessRequiresCompletedAppointment: boolean;
    showReportNotRequiredMessage: boolean;
    qrReportCheckingMessage: string;
    qrReportCheckButtonLabel: string;
    qrReportViewButtonLabel: string;
    qrReportNotRequiredMessage: string;
    qrReportNotCompletedMessage: string;
  };
  modalityName?: string;
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
  const raw = await api<{ preview: RawRecord; settings?: PatientQrSettings | RawRecord[] }>(`/public/appointments/cancel-preview?${query.toString()}`);
  const preview = raw.preview ?? {};

  // Handle both array format (raw records) and object format (already normalized)
  let patientQrSettings: PatientQrSettings | undefined;
  if (raw.settings) {
    if (Array.isArray(raw.settings)) {
      patientQrSettings = raw.settings.length > 0 ? normalizePatientQrSettings(raw.settings[0]) : undefined;
    } else {
      patientQrSettings = raw.settings as PatientQrSettings;
    }
  }

  return {
    bookingId: Number(preview.bookingId ?? preview.booking_id ?? 0),
    patientDisplayName: String(preview.patientDisplayName ?? preview.patient_display_name ?? ""),
    bookingDate: String(preview.bookingDate ?? preview.booking_date ?? ""),
    bookingTime: String(preview.bookingTime ?? preview.booking_time ?? ""),
    requiresReport: Boolean(preview.requiresReport ?? preview.requires_report),
    reportFeature: preview.reportFeature as PublicAppointmentCancelPreview["reportFeature"],
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
  state: "final" | "draft" | "no_report" | "unavailable" | "not_required" | "not_completed" | "disabled";
  canViewReport: boolean;
  message: string;
  checkButtonLabel: string;
  viewButtonLabel: string;
}

export async function fetchPublicAppointmentReportStatus(token: string): Promise<PublicReportStatusResponse> {
  const query = new URLSearchParams({ t: token });
  return api<PublicReportStatusResponse>(`/public/appointments/report-status?${query.toString()}`);
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
  printQrOnAppointmentSlip: boolean;
  allowCancellation: boolean;
  allowAddToCalendar: boolean;
  showBookingTime: boolean;
  showPreparationInstructions: boolean;
  showDocumentsChecklist: boolean;
  showDepartmentContact: boolean;
  showLocationDirections: boolean;
  allowReportAccess: boolean;
  showReportPendingCard: boolean;
  reportAccessRequiresCompletedAppointment: boolean;
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

  return {
    enabled: bool(record.enabled, true),
    printQrOnAppointmentSlip: bool(record.printQrOnAppointmentSlip, true),
    allowCancellation: bool(record.allowCancellation, true),
    allowAddToCalendar: bool(record.allowAddToCalendar, true),
    showBookingTime: bool(record.showBookingTime, true),
    showPreparationInstructions: bool(record.showPreparationInstructions, true),
    showDocumentsChecklist: bool(record.showDocumentsChecklist, true),
    showDepartmentContact: bool(record.showDepartmentContact, false),
    showLocationDirections: bool(record.showLocationDirections, false),
    allowReportAccess: bool(record.allowReportAccess, false),
    showReportPendingCard: bool(record.showReportPendingCard, true),
    reportAccessRequiresCompletedAppointment: bool(record.reportAccessRequiresCompletedAppointment, true),
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
    pageTitleAr: str(record.pageTitleAr, "خدمة المريض عبر رمز QR"),
    pageTitleEn: str(record.pageTitleEn, "Patient QR Service"),
    introTextAr: str(record.introTextAr, "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة."),
    introTextEn: str(record.introTextEn, "You can review appointment details, instructions, and department information from this page."),
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
      centerNameAr: str(location.centerNameAr, "المركز الوطني للأورام بنغازي"),
      centerNameEn: str(location.centerNameEn, "National Cancer Center Benghazi"),
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

export async function fetchPatientQrSettings(): Promise<PatientQrSettings> {
  const response = await api<{ settings: RawRecord[] }>("/settings/patient_qr_self_service");
  const configRow = response.settings?.find((row) => row.setting_key === "config");
  return normalizePatientQrSettings(configRow ?? {});
}

export async function savePatientQrSettings(payload: PatientQrSettings) {
  return api<RawRecord>("/settings/patient_qr_self_service", {
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

export async function deleteAppointment(id: number) {
  await api<{ booking: RawRecord; previousStatus: string }>(`/v2/appointments/${id}/cancel`, {
    method: "POST"
  });
  return { ok: true };
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
  return api<RawRecord>("/v2/read/queue/scan", {
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

export interface SonicDicomLookupDebugStep {
  lookupTarget: "accession_number" | "study_instance_uid";
  requestUrlPreview: string;
  contentType: string;
  state: "final" | "draft" | "no_report" | "unavailable" | "not_required" | "not_completed" | "disabled";
}

export interface SonicDicomLookupDebugResponse {
  ok: boolean;
  state: "final" | "draft" | "no_report" | "unavailable" | "not_required" | "not_completed" | "disabled";
  canViewReport: boolean;
  source: "sonicdicom" | "rispro";
  baseUrlSource: "internal" | "public_fallback" | "none";
  lookupTried: Array<"accession_number" | "study_instance_uid">;
  steps: SonicDicomLookupDebugStep[];
  diagnostics?: string[];
}

export async function testSonicDicomLookup(payload: {
  accessionNumber: string;
  studyInstanceUid?: string;
  lookupKey?: "accession_number" | "study_instance_uid" | "prefer_study_uid_then_accession" | "prefer_accession_then_study_uid";
}): Promise<SonicDicomLookupDebugResponse> {
  return api<SonicDicomLookupDebugResponse>("/settings/sonicdicom_reports/test-lookup", {
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

export async function fetchExamTypes(includeInactive = false): Promise<{ examTypes: RawRecord[] }> {
  const query = includeInactive ? "?includeInactive=true" : "";
  const raw = await api<{ examTypes: RawRecord[] }>(`/settings/exam-types${query}`);
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
