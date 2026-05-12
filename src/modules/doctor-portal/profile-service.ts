import { HttpError } from "../../utils/http-error.js";
import { env } from "../../config/env.js";
import { canRoleAccessPage, readPageVisibilityMatrix } from "../../services/page-visibility-settings-service.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { deriveDoctorCapabilities } from "./capabilities.js";
import {
  createDoctorProfile,
  findActiveDoctorProfileByUserId,
  findDoctorProfileByUserId,
  listDoctorModalityPermissions,
  listDoctorProfiles,
  replaceDoctorModalityPermissions,
  updateDoctorProfile,
  type CreateDoctorProfileInput,
  type DoctorModalityPermissionRow,
  type DoctorProfileRow,
  type DoctorRole,
  type UpdateDoctorProfileInput,
} from "./profile-repository.js";

export interface DoctorMeResponse {
  hasActiveDoctorProfile: boolean;
  profile: DoctorProfileRow | null;
  isSuperAdmin: boolean;
  canAccessDoctorPortal: boolean;
  canAccessClinicalDoctorPortal: boolean;
  canAccessDoctorAdmin: boolean;
  canManageDoctorProfiles: boolean;
  doctorPortalAutoRedirect: boolean;
  doctorRole: DoctorRole | null;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
  allowedModalities: DoctorModalityPermissionRow[];
  moduleCapabilities: Array<"doctor" | "doctor_supervisor" | "doctor_admin">;
  canAccessCoreWorkspace: boolean;
}

const CORE_ROUTE_KEYS = [
  "dashboard",
  "patients",
  "appointments",
  "v2.appointments.admin",
  "calendar",
  "registrations",
  "queue",
  "queue.checkin",
  "modality",
  "print",
  "statistics",
  "pacs",
  "pacs.remap",
  "legacy",
  "settings",
] as const;

export async function getDoctorMe(userId: UserId, appRole: Role): Promise<DoctorMeResponse> {
  const profile = await findDoctorProfileByUserId(userId);
  const hasActiveDoctorProfile = Boolean(profile?.active);
  const isSuperAdmin = appRole === "super_admin";
  const canManageDoctorProfiles = isSuperAdmin || appRole === "supervisor";
  const canAccessClinicalDoctorPortal = hasActiveDoctorProfile;
  const allowedModalities = hasActiveDoctorProfile && profile ? await listDoctorModalityPermissions(profile.id) : [];
  const moduleCapabilities = deriveDoctorCapabilities({
    appRole,
    hasActiveProfile: hasActiveDoctorProfile,
    canSupervise: canManageDoctorProfiles || Boolean(profile?.canSupervise),
  });

  const pageMatrix = await readPageVisibilityMatrix();
  const canAccessCoreWorkspace = CORE_ROUTE_KEYS.some((routeKey) => canRoleAccessPage(routeKey, appRole, pageMatrix));

  return {
    hasActiveDoctorProfile,
    profile,
    isSuperAdmin,
    canAccessDoctorPortal: canAccessClinicalDoctorPortal || canManageDoctorProfiles,
    canAccessClinicalDoctorPortal,
    canAccessDoctorAdmin: canManageDoctorProfiles,
    canManageDoctorProfiles,
    doctorPortalAutoRedirect: env.doctorPortalAutoRedirect,
    doctorRole: profile?.doctorRole ?? null,
    canFinalizeReports: hasActiveDoctorProfile && Boolean(profile?.canFinalizeReports),
    canAssignProtocols: hasActiveDoctorProfile && Boolean(profile?.canAssignProtocols),
    canSupervise: hasActiveDoctorProfile && (canManageDoctorProfiles || Boolean(profile?.canSupervise)),
    allowedModalities,
    moduleCapabilities,
    canAccessCoreWorkspace,
  };
}

export async function requireDoctorAdmin(userId: UserId, appRole: Role): Promise<DoctorProfileRow | null> {
  if (appRole !== "super_admin" && appRole !== "supervisor") {
    throw new HttpError(403, "Doctor admin access is required.");
  }
  return findActiveDoctorProfileByUserId(userId);
}

export async function listProfilesForAdmin(userId: UserId, appRole: Role): Promise<DoctorProfileRow[]> {
  await requireDoctorAdmin(userId, appRole);
  return listDoctorProfiles();
}

export async function createProfileForAdmin(
  actorUserId: UserId,
  appRole: Role,
  input: CreateDoctorProfileInput
): Promise<DoctorProfileRow> {
  await requireDoctorAdmin(actorUserId, appRole);
  return createDoctorProfile(input, actorUserId);
}

export async function updateProfileForAdmin(
  actorUserId: UserId,
  appRole: Role,
  profileId: number,
  input: UpdateDoctorProfileInput
): Promise<DoctorProfileRow> {
  await requireDoctorAdmin(actorUserId, appRole);
  const profile = await updateDoctorProfile(profileId, input, actorUserId);
  if (!profile) {
    throw new HttpError(404, "Doctor profile not found.");
  }
  return profile;
}

export async function listProfileModalitiesForAdmin(userId: UserId, appRole: Role, profileId: number) {
  await requireDoctorAdmin(userId, appRole);
  return listDoctorModalityPermissions(profileId, true);
}

export async function updateProfileModalitiesForAdmin(
  actorUserId: UserId,
  appRole: Role,
  profileId: number,
  permissions: Array<{
    modalityId: number;
    canProtocol: boolean;
    canReport: boolean;
    canSupervise: boolean;
    active: boolean;
  }>
) {
  await requireDoctorAdmin(actorUserId, appRole);
  return replaceDoctorModalityPermissions(profileId, permissions, actorUserId);
}
