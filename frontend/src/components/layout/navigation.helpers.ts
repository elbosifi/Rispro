import type { DoctorMe } from "@/types/api";

export function hasDoctorWorkspaceAccess(
  me: Pick<
    DoctorMe,
    "canAccessDoctorPortal" | "hasActiveDoctorProfile" | "canAccessDoctorAdmin"
  > | null | undefined,
): boolean {
  return Boolean(me?.canAccessDoctorPortal ?? me?.hasActiveDoctorProfile ?? me?.canAccessDoctorAdmin);
}
