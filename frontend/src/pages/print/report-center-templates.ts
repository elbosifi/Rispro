import type { Role } from "@/types/api";

export type ReportSource = "appointments" | "patients" | "audit" | "disabled";

export interface ReportTemplate {
  id: string;
  title: string;
  description: string;
  source: ReportSource;
  roles: Role[];
  status?: string;
  walkIn?: string;
  specialQuota?: string;
  supervisorOverride?: string;
  grouping?: "modality" | "status" | "category";
  disabledReason?: string;
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  { id: "daily-appointments", title: "Daily appointment list", description: "Authoritative day list by time.", source: "appointments", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "daily-modality", title: "Daily modality list", description: "Daily appointments grouped by modality.", source: "appointments", roles: ["receptionist", "supervisor", "super_admin"], grouping: "modality" },
  { id: "daily-room-station", title: "Daily room/station list", description: "Room/station metadata is not exposed yet.", source: "disabled", roles: ["supervisor", "super_admin"], disabledReason: "Station/room fields are not available in the appointments API." },
  { id: "appointment-slips", title: "Appointment slips / print list", description: "Print slips from the filtered appointment list.", source: "appointments", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "patient-directory", title: "Patient directory", description: "Paginated patient directory with safe filters.", source: "patients", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "registration-list", title: "Registration list", description: "Uses appointment registrations for the selected window.", source: "appointments", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "no-show-list", title: "No-show list", description: "Appointments marked no-show.", source: "appointments", roles: ["supervisor", "super_admin"], status: "no-show" },
  { id: "cancellation-list", title: "Cancellation list", description: "Cancelled appointments.", source: "appointments", roles: ["supervisor", "super_admin"], status: "cancelled" },
  { id: "walk-in-list", title: "Walk-in list", description: "Walk-in appointments.", source: "appointments", roles: ["receptionist", "supervisor", "super_admin"], walkIn: "true" },
  { id: "priority-urgent", title: "Priority/urgent list", description: "Filter by priority text.", source: "appointments", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "waiting-list", title: "Waiting list", description: "Patients in waiting status.", source: "appointments", roles: ["receptionist", "supervisor", "super_admin"], status: "waiting" },
  { id: "missing-demographics", title: "Patients with missing demographics", description: "Directory warning details are available per-patient only.", source: "disabled", roles: ["supervisor", "super_admin"], disabledReason: "Bulk missing-demographics fields are not exposed by the directory endpoint." },
  { id: "missing-phone-id", title: "Patients with missing phone number or identifier", description: "Requires a backend directory warning filter.", source: "disabled", roles: ["supervisor", "super_admin"], disabledReason: "The current directory endpoint has warnings but no server-side warning filter." },
  { id: "safety-checklist", title: "Patients requiring safety checklist", description: "Safety checklist state is not exposed yet.", source: "disabled", roles: ["supervisor", "super_admin"], disabledReason: "No checklist completion data source was found." },
  { id: "preparation-instructions", title: "Patients requiring preparation instructions", description: "Preparation instructions exist by modality/exam.", source: "appointments", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "capacity-utilization", title: "Capacity utilization report", description: "Daily counts by modality; capacity denominator can be added from policy data.", source: "appointments", roles: ["supervisor", "super_admin"], grouping: "modality" },
  { id: "special-quota", title: "Special quota report", description: "Appointments using special quota.", source: "appointments", roles: ["supervisor", "super_admin"], specialQuota: "true" },
  { id: "supervisor-override", title: "Supervisor override report", description: "Override and capacity exception bookings.", source: "appointments", roles: ["supervisor", "super_admin"], supervisorOverride: "true" },
  { id: "referring-physician-volume", title: "Referring physician volume report", description: "Referring physician is not exposed by the appointment list API.", source: "disabled", roles: ["supervisor", "super_admin"], disabledReason: "No referring physician field is available in the list API." },
  { id: "exam-type-volume", title: "Exam type volume report", description: "Grouped appointment counts by exam.", source: "appointments", roles: ["supervisor", "super_admin"] },
  { id: "printed-documents-audit", title: "User activity / printed documents report", description: "Recent report print/export/copy activity.", source: "audit", roles: ["super_admin"] },
];
