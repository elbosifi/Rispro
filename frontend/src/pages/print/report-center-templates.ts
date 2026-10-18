import type { Role } from "@/types/api";

export type ReportSource = "appointments" | "patients" | "audit";
export type ReportArea = "primary" | "operational";
export type AppointmentGrouping = "modality" | "status" | "category" | "exam";

export interface ReportTemplate {
  id: string;
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
  { id: "daily-appointments", source: "appointments", area: "primary", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "registration-list", source: "appointments", area: "primary", roles: ["receptionist", "supervisor", "super_admin"], registrationList: true },
  { id: "no-show-list", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], status: "no-show" },
  { id: "cancellation-list", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], status: "cancelled" },
  { id: "waiting-list", source: "appointments", area: "operational", roles: ["receptionist", "supervisor", "super_admin"], status: "waiting" },
  { id: "walk-in-list", source: "appointments", area: "operational", roles: ["receptionist", "supervisor", "super_admin"], walkIn: "true" },
  { id: "priority-urgent", source: "appointments", area: "operational", roles: ["receptionist", "supervisor", "super_admin"], prioritySelector: true },
  { id: "appointment-volume-by-modality", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], grouping: "modality" },
  { id: "special-quota", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], specialQuota: "true" },
  { id: "supervisor-override", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], supervisorOverride: "true" },
  { id: "exam-type-volume", source: "appointments", area: "operational", roles: ["supervisor", "super_admin"], grouping: "exam" },
  { id: "patient-directory", source: "patients", area: "operational", roles: ["receptionist", "supervisor", "super_admin"] },
  { id: "printed-documents-audit", source: "audit", area: "operational", roles: ["super_admin"] },
];
