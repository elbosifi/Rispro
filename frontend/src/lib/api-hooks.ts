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
export async function searchPatients(query: string): Promise<Patient[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  return api<{ patients: Patient[] }>(`/patients?${params.toString()}`).then((r) => r.patients);
}

// -- Patient CRUD --
export async function updatePatient(id: number, payload: any) {
  return api<{ patient: Patient }>(`/patients/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  }).then((r) => r.patient);
}

export async function createPatient(payload: any) {
  return api<{ patient: Patient }>("/patients", {
    method: "POST",
    body: JSON.stringify(payload)
  }).then((r) => r.patient);
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
