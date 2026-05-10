import { HttpError } from "../../utils/http-error.js";
import { canRoleAccessPage, readPageVisibilityMatrix } from "../../services/page-visibility-settings-service.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { deriveDoctorCapabilities } from "./capabilities.js";
import {
  createDoctorProfile,
  findActiveDoctorProfileByUserId,
  listDoctorModalityPermissions,
  listDoctorProfiles,
  type CreateDoctorProfileInput,
  type DoctorModalityPermissionRow,
  type DoctorProfileRow,
  type DoctorRole,
} from "./profile-repository.js";

export interface DoctorMeResponse {
  hasActiveDoctorProfile: boolean;
  profile: DoctorProfileRow | null;
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
  const profile = await findActiveDoctorProfileByUserId(userId);
  const allowedModalities = profile ? await listDoctorModalityPermissions(profile.id) : [];
  const moduleCapabilities = deriveDoctorCapabilities({
    appRole,
    hasActiveProfile: Boolean(profile),
    canSupervise: Boolean(profile?.canSupervise),
  });

  const pageMatrix = await readPageVisibilityMatrix();
  const canAccessCoreWorkspace = CORE_ROUTE_KEYS.some((routeKey) => canRoleAccessPage(routeKey, appRole, pageMatrix));

  return {
    hasActiveDoctorProfile: Boolean(profile),
    profile,
    doctorRole: profile?.doctorRole ?? null,
    canFinalizeReports: Boolean(profile?.canFinalizeReports),
    canAssignProtocols: Boolean(profile?.canAssignProtocols),
    canSupervise: Boolean(profile?.canSupervise),
    allowedModalities,
    moduleCapabilities,
    canAccessCoreWorkspace,
  };
}

export async function requireDoctorAdmin(userId: UserId, appRole: Role): Promise<DoctorProfileRow> {
  const profile = await findActiveDoctorProfileByUserId(userId);
  if (!profile) {
    throw new HttpError(403, "Active doctor profile is required.");
  }
  if (appRole !== "super_admin") {
    throw new HttpError(403, "Doctor admin access is required.");
  }
  return profile;
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
