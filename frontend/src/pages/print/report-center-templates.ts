import type { Role } from "@/types/api";

export type ReportSource = "appointments" | "patients" | "audit";
export type ReportArea = "primary" | "operational";
export type AppointmentGrouping = "modality" | "status" | "category" | "exam";

export interface ReportTemplate {
  id: string;
  title: string;
  description: string;
  source: ReportSource;
  area: ReportArea;
  roles: Role[];
  status?: string;
  walkIn?: string;
  specialQuota?: string;
  supervisorOverride?: string;
  grouping?: AppointmentGrouping;
  registrationList?: boolean;
  prioritySelector?: boolean;
}

// Only supported, truthful production workflows belong in this list. Unsupported
// definitions were deliberately removed instead of leaving selectable dead ends.
export const REPORT_TEMPLATES: ReportTemplate[] = [
  { id: "daily-appointments", title: "Daily appointment list", description: "Appointments for the selected date, in booking-time order.", source: "appointments", area: "primary", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "registration-list", title: "Registration list", description: "Uses the authoritative registration-list Chromium document and printer profile.", source: "appointments", area: "primary", roles: ["receptionist", "supervisor", "super_admin"], registrationList: true },
  { id: "no-show-list", title: "No-show list", description: "Appointments whose status is fixed to no-show.", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], status: "no-show" },
  { id: "cancellation-list", title: "Cancellation list", description: "Appointments whose status is fixed to cancelled.", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], status: "cancelled" },
  { id: "waiting-list", title: "Waiting list", description: "Appointments whose status is fixed to waiting.", source: "appointments", area: "operational", roles: ["receptionist", "supervisor", "super_admin"], status: "waiting" },
  { id: "walk-in-list", title: "Walk-in list", description: "Appointments recorded as walk-ins.", source: "appointments", area: "operational", roles: ["receptionist", "supervisor", "super_admin"], walkIn: "true" },
  { id: "priority-urgent", title: "Priority / urgent list", description: "Appointments filtered by the selected reporting-priority value.", source: "appointments", area: "operational", roles: ["receptionist", "supervisor", "super_admin"], prioritySelector: true },
  { id: "appointment-volume-by-modality", title: "Appointment volume by modality", description: "Appointment counts grouped by modality; this is not capacity utilization.", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], grouping: "modality" },
  { id: "special-quota", title: "Special quota report", description: "Appointments that used special quota.", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], specialQuota: "true" },
  { id: "supervisor-override", title: "Supervisor override report", description: "Bookings recorded with a capacity override or exception.", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], supervisorOverride: "true" },
  { id: "exam-type-volume", title: "Exam type volume", description: "Appointment counts grouped by exam type.", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], grouping: "exam" },
  { id: "patient-directory", title: "Patient directory", description: "A paginated directory result, limited to the first 100 matches.", source: "patients", area: "operational", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "printed-documents-audit", title: "Printed-output audit", description: "The 200 most recent report print and export audit entries.", source: "audit", area: "operational", roles: ["super_admin"] },
];
