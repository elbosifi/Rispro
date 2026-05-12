import type { Role } from "../../types/domain.js";

export type DoctorModuleCapability = "doctor" | "doctor_supervisor" | "doctor_admin";

export interface DoctorCapabilityInput {
  appRole: Role;
  hasActiveProfile: boolean;
  canSupervise: boolean;
}

export function deriveDoctorCapabilities(input: DoctorCapabilityInput): DoctorModuleCapability[] {
  const capabilities: DoctorModuleCapability[] = [];
  if (input.hasActiveProfile) capabilities.push("doctor");
  if (input.hasActiveProfile && input.canSupervise) capabilities.push("doctor_supervisor");
  if (input.appRole === "super_admin") capabilities.push("doctor_admin");
  return capabilities;
}

export function hasDoctorCapability(
  capabilities: readonly DoctorModuleCapability[],
  capability: DoctorModuleCapability
): boolean {
  return capabilities.includes(capability);
}
