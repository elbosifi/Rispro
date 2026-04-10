import { api } from "@/lib/api-client";
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
  SchedulingEngineConfig
} from "@/types/api";
import type { DictionaryEntry } from "@/lib/name-generation";

// Generic raw response type for API responses that are passed through mappers
type RawRecord = Record<string, unknown>;

// -- Auth --
export async function fetchCurrentSession(): Promise<User | null> {
  try {
    const res = await api<{ user: RawRecord }>("/auth/me");
    return mapUser(res.user);
  } catch {
    return null;
  }
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
  const raw = await api<RawRecord>("/appointments/lookups");
  return mapAppointmentLookups(raw);
}

// -- Dashboard Data --
export async function fetchQueueSnapshot(): Promise<QueueSnapshot> {
  const raw = await api<RawRecord>("/queue");
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

export async function createAppointment(payload: RawRecord) {
  const raw = await api<{ appointment: RawRecord }>("/appointments", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return mapAppointmentWithDetails(raw.appointment);
}

export async function getAppointmentById(id: number) {
  const raw = await api<{ appointment: RawRecord }>(`/appointments/${id}`);
  return mapAppointmentWithDetails(raw.appointment);
}

export async function updateAppointment(id: number, payload: RawRecord) {
  const raw = await api<{ appointment: RawRecord }>(`/appointments/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return mapAppointmentWithDetails(raw.appointment);
}

export async function cancelAppointment(id: number, cancelReason: string) {
  return api<{ appointment: RawRecord }>(`/appointments/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ cancelReason })
  });
}

export async function deleteAppointment(id: number) {
  return api<{ ok: boolean }>(`/appointments/${id}`, {
    method: "DELETE"
  });
}

export async function updateAppointmentProtocol(id: number, payload: RawRecord) {
  const raw = await api<{ appointment: RawRecord }>(`/appointments/${id}/protocol`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return mapAppointmentWithDetails(raw.appointment);
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

  const raw = await api<{ appointments: RawRecord[] }>(`/appointments?${query.toString()}`);
  return mapAppointmentsWithDetails(raw.appointments);
}

// -- Statistics --
export async function fetchStatistics(date: string, modalityId: string): Promise<AppointmentStatistics> {
  const params = new URLSearchParams();
  params.set("date", date);
  if (modalityId) params.set("modalityId", modalityId);
  const raw = await api<RawRecord>(`/appointments/statistics?${params.toString()}`);
  return mapStatistics(raw);
}

// -- Queue --
export async function scanIntoQueue(scanValue: string) {
  return api<RawRecord>("/queue/scan", {
    method: "POST",
    body: JSON.stringify({ scanValue })
  });
}

export async function addWalkIn(payload: RawRecord) {
  return api<RawRecord>("/queue/walk-in", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function confirmNoShow(appointmentId: number, reason: string) {
  return api<RawRecord>("/queue/confirm-no-show", {
    method: "POST",
    body: JSON.stringify({ appointmentId, reason })
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
  const raw = await api<{ appointments: RawRecord[] }>(`/modality/worklist?${params.toString()}`);
  return mapAppointmentsWithDetails(raw.appointments);
}

export async function completeAppointment(id: number) {
  return api<RawRecord>(`/modality/${id}/complete`, { method: "POST" });
}

// -- Settings --
export async function fetchSettings(category: string) {
  const raw = await api<{ settings: RawRecord[] }>(`/settings/${category}`);
  return mapSettings(raw.settings ?? []);
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

export async function fetchExamTypes(): Promise<{ examTypes: RawRecord[] }> {
  const raw = await api<{ examTypes: RawRecord[] }>("/settings/exam-types");
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

// -- PACS --
export async function searchPacs(patientNationalId: string) {
  return api<RawRecord>("/integrations/pacs-search", {
    method: "POST",
    body: JSON.stringify({ patientNationalId })
  });
}
