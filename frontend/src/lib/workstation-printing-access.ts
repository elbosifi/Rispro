import type { Role } from "@/types/api";

export const WORKSTATION_PRINTING_ROLES: Role[] = ["receptionist", "supervisor", "modality_staff", "doctor", "super_admin"];
export function canAccessWorkstationPrinting(role: Role): boolean { return WORKSTATION_PRINTING_ROLES.includes(role); }
