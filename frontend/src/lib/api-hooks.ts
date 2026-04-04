import { api } from "@/lib/api-client";
import type { AppointmentLookups, QueueSnapshot, Patient, Appointment } from "@/types/api";

// -- Auth --
export async function fetchCurrentSession() {
  const res = await api<{ user: any }>("/auth/me");
  return res.user;
}

export async function login(username: string, password: string) {
  return api<{ user: any }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  }).then((r) => r.user);
}

export async function logout() {
  await api("/auth/logout", { method: "POST" });
}

// -- Lookups --
export async function fetchAppointmentLookups(): Promise<AppointmentLookups> {
  return api("/appointments/lookups");
}

// -- Dashboard Data --
export async function fetchQueueSnapshot(): Promise<QueueSnapshot> {
  return api("/queue");
}

export async function fetchDaySettings() {
  return api("/appointments/day-settings");
}

// -- Patient Search --
function mapPatient(raw: any): Patient {
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

export async function searchPatients(query: string): Promise<Patient[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  return api<{ patients: any[] }>(`/patients?${params.toString()}`)
    .then((r) => r.patients.map(mapPatient));
}

// -- Patient CRUD --
export async function updatePatient(id: number, payload: any) {
  return api<{ patient: any }>(`/patients/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  }).then((r) => mapPatient(r.patient));
}

export async function createPatient(payload: any) {
  return api<{ patient: any }>("/patients", {
    method: "POST",
    body: JSON.stringify(payload)
  }).then((r) => mapPatient(r.patient));
}

// -- Appointments --
export async function getAppointmentAvailability(modalityId: number, days = 14) {
  return api<{ availability: any[] }>(`/appointments/availability?modalityId=${modalityId}&days=${days}`)
    .then((r) => r.availability);
}

export async function createAppointment(payload: any) {
  return api<{ appointment: Appointment }>("/appointments", {
    method: "POST",
    body: JSON.stringify(payload)
  }).then((r) => r.appointment);
}
