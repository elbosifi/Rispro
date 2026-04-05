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
import type { Patient, AppointmentLookups, QueueSnapshot, User, AppointmentStatistics } from "@/types/api";

// -- Auth --
export async function fetchCurrentSession(): Promise<User | null> {
  try {
    const res = await api<{ user: any }>("/auth/me");
    return mapUser(res.user);
  } catch {
    return null;
  }
}

export async function login(username: string, password: string): Promise<User> {
  const res = await api<{ user: any }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return mapUser(res.user);
}

export async function reAuthSupervisor(password: string): Promise<User> {
  const res = await api<{ user: any }>("/auth/re-auth", {
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
  const raw = await api("/appointments/lookups");
  return mapAppointmentLookups(raw);
}

// -- Dashboard Data --
export async function fetchQueueSnapshot(): Promise<QueueSnapshot> {
  const raw = await api("/queue");
  return mapQueueSnapshot(raw);
}

export async function fetchDaySettings() {
  return api("/appointments/day-settings");
}

// -- Patient Search --
export async function searchPatients(query: string): Promise<Patient[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const raw = await api<{ patients: any[] }>(`/patients?${params.toString()}`);
  return mapPatients(raw.patients);
}

// -- Patient CRUD --
export async function fetchPatientById(id: number): Promise<Patient> {
  const raw = await api<{ patient: any }>(`/patients/${id}`);
  return mapPatient(raw.patient);
}

export async function updatePatient(id: number, payload: any) {
  const raw = await api<{ patient: any }>(`/patients/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return mapPatient(raw.patient);
}

export async function createPatient(payload: any) {
  const raw = await api<{ patient: any }>("/patients", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return mapPatient(raw.patient);
}

// -- Appointments --
export async function getAppointmentAvailability(modalityId: number, days = 14) {
  const raw = await api<{ availability: any[] }>(`/appointments/availability?modalityId=${modalityId}&days=${days}`);
  return raw.availability;
}

export async function createAppointment(payload: any) {
  const raw = await api<{ appointment: any }>("/appointments", {
    method: "POST",
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

  const raw = await api<{ appointments: any[] }>(`/appointments?${query.toString()}`);
  return mapAppointmentsWithDetails(raw.appointments);
}

// -- Statistics --
export async function fetchStatistics(date: string, modalityId: string): Promise<AppointmentStatistics> {
  const params = new URLSearchParams();
  params.set("date", date);
  if (modalityId) params.set("modalityId", modalityId);
  const raw = await api(`/appointments/statistics?${params.toString()}`);
  return mapStatistics(raw);
}

// -- Queue --
export async function scanIntoQueue(scanValue: string) {
  return api("/queue/scan", {
    method: "POST",
    body: JSON.stringify({ scanValue })
  });
}

export async function addWalkIn(payload: any) {
  return api("/queue/walk-in", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function confirmNoShow(appointmentId: number, reason: string) {
  return api("/queue/confirm-no-show", {
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
  const raw = await api<{ appointments: any[] }>(`/modality/worklist?${params.toString()}`);
  return mapAppointmentsWithDetails(raw.appointments);
}

export async function completeAppointment(id: number) {
  return api(`/modality/${id}/complete`, { method: "POST" });
}

// -- Settings --
export async function fetchSettings(category: string) {
  const raw: any = await api(`/settings/${category}`);
  return mapSettings(raw.settings ?? []);
}

export async function fetchUsers() {
  const raw: any = await api("/users");
  return raw;
}

export async function fetchAuditEntries(limit: number) {
  const raw: any = await api(`/audit?limit=${limit}`);
  return {
    entries: mapAuditEntries(raw.entries ?? []),
    meta: raw.meta ?? {}
  };
}

export async function fetchExamTypes() {
  const raw: any = await api("/settings/exam-types");
  return raw;
}

export async function fetchModalitiesSettings() {
  const raw: any = await api("/settings/modalities");
  return raw;
}

export async function fetchNameDictionary() {
  const raw: any = await api("/settings/name-dictionary");
  return {
    entries: mapNameDictionary(raw.entries ?? []),
    meta: raw.meta ?? {}
  };
}

export async function upsertNameDictionaryEntry(arabicText: string, englishText: string) {
  return api<{ entry: any }>("/settings/name-dictionary", {
    method: "POST",
    body: JSON.stringify({ arabicText, englishText })
  });
}

export async function fetchDicomDevices() {
  const raw: any = await api("/settings/dicom-devices");
  return {
    devices: mapDicomDevices(raw.devices ?? []),
    meta: raw.meta ?? {}
  };
}

export async function fetchPacsConnection() {
  const raw: any = await api("/settings/pacs_connection");
  return raw;
}

// -- PACS --
export async function searchPacs(patientNationalId: string) {
  return api("/integrations/pacs-search", {
    method: "POST",
    body: JSON.stringify({ patientNationalId })
  });
}
