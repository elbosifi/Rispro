import type { DoctorMe, User } from "@/types/api";

export function hasDoctorWorkspaceAccess(
  me: Pick<
    DoctorMe,
    "canAccessDoctorPortal" | "hasActiveDoctorProfile" | "canAccessDoctorAdmin"
  > | null | undefined,
): boolean {
  return Boolean(me?.canAccessDoctorPortal ?? me?.hasActiveDoctorProfile ?? me?.canAccessDoctorAdmin);
}

export function shouldAutoEnterDoctorWorkspace(
  user: Pick<User, "role"> | null | undefined,
  me: Pick<DoctorMe, "hasActiveDoctorProfile" | "doctorPortalAutoRedirect"> | null | undefined,
): boolean {
  return Boolean(user?.role === "doctor" && me?.hasActiveDoctorProfile && me?.doctorPortalAutoRedirect !== false);
}
