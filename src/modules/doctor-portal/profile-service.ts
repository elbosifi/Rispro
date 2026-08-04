import { HttpError } from "../../utils/http-error.js";
import bcrypt from "bcryptjs";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { isRole } from "../../constants/roles.js";
import { canRoleAccessPage, readPageVisibilityMatrix } from "../../services/page-visibility-settings-service.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { deriveDoctorCapabilities } from "./capabilities.js";
import { syncDoctorWorklistLifecycle } from "./doctor-worklist-provisioning.js";
import { normalizeUsername, requireExactPassword } from "../../utils/credentials.js";
import {
  createDoctorProfile,
  findActiveDoctorProfileByUserId,
  findDoctorProfileByUserId,
  listDoctorModalityPermissions,
  listDoctorProfiles,
  replaceDoctorModalityPermissions,
  insertDoctorAuditEvent,
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
  const profile = await createDoctorProfile(input, actorUserId);
  await syncDoctorWorklistLifecycle(profile.id);
  return profile;
}

export async function createDoctorWithUserForAdmin(
  actorUserId: UserId,
  appRole: Role,
  input: {
    username: string;
    fullName: string;
    temporaryPassword: string;
    coreRole: Role | string;
    userActive: boolean;
    doctorDisplayName: string;
    doctorRole: DoctorRole;
    doctorProfileActive: boolean;
    canFinalizeReports: boolean;
    canAssignProtocols: boolean;
    canSupervise: boolean;
    modalityPermissions: Array<{
      modalityId: number;
      canProtocol: boolean;
      canReport: boolean;
      canSupervise: boolean;
      active: boolean;
    }>;
  }
) {
  await requireDoctorAdmin(actorUserId, appRole);
  const username = normalizeUsername(input.username);
  const fullName = input.fullName.trim();
  const temporaryPassword = requireExactPassword(input.temporaryPassword, "temporaryPassword");
  const doctorDisplayName = input.doctorDisplayName.trim() || fullName;

  if (!username || !fullName || !temporaryPassword || !doctorDisplayName) {
    throw new HttpError(400, "username, fullName, temporaryPassword, and doctorDisplayName are required.");
  }
  if (input.coreRole !== "doctor" && input.coreRole !== "supervisor") {
    throw new HttpError(400, "coreRole must be doctor or supervisor.");
  }
  if (!isRole(input.coreRole)) {
    throw new HttpError(400, "coreRole is invalid.");
  }
  if (!input.userActive) {
    throw new HttpError(400, "New doctor users must be active.");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const userResult = await client.query<{
      id: number;
      username: string;
      full_name: string;
      role: Role;
      is_active: boolean;
      must_change_password: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `
        insert into users (username, full_name, password_hash, role, is_active, must_change_password)
        values ($1, $2, $3, $4, $5, true)
        returning id, username, full_name, role, is_active, must_change_password, created_at, updated_at
      `,
      [username, fullName, passwordHash, input.coreRole, input.userActive]
    );
    const user = userResult.rows[0];

    const profileResult = await client.query<DoctorProfileRow>(
      `
        insert into doctor_portal.doctor_profiles (
          user_id,
          display_name,
          doctor_role,
          active,
          can_finalize_reports,
          can_assign_protocols,
          can_supervise
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        returning
          id,
          user_id as "userId",
          $8::text as username,
          $9::text as "fullName",
          $10::text as "coreRole",
          $11::boolean as "userActive",
          display_name as "displayName",
          doctor_role as "doctorRole",
          active,
          can_finalize_reports as "canFinalizeReports",
          can_assign_protocols as "canAssignProtocols",
          can_supervise as "canSupervise",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `,
      [
        user.id,
        doctorDisplayName,
        input.doctorRole,
        input.doctorProfileActive,
        input.canFinalizeReports,
        input.canAssignProtocols,
        input.canSupervise,
        user.username,
        user.full_name,
        user.role,
        user.is_active,
      ]
    );
    const profile = profileResult.rows[0];

    for (const permission of input.modalityPermissions) {
      await client.query(
        `
          insert into doctor_portal.doctor_modality_permissions (
            doctor_id, modality_id, can_protocol, can_report, can_supervise, active
          )
          values ($1, $2, $3, $4, $5, $6)
          on conflict (doctor_id, modality_id)
          do update set
            can_protocol = excluded.can_protocol,
            can_report = excluded.can_report,
            can_supervise = excluded.can_supervise,
            active = excluded.active,
            updated_at = now()
        `,
        [
          profile.id,
          permission.modalityId,
          permission.canProtocol,
          permission.canReport,
          permission.canSupervise,
          permission.active,
        ]
      );
    }

    await insertDoctorAuditEvent(client, {
      actorUserId,
      actorDoctorId: null,
      eventType: "doctor_created_with_user",
      targetType: "doctor_profile",
      targetId: profile.id,
      metadata: {
        userId: user.id,
        username: user.username,
        coreRole: user.role,
        doctorRole: profile.doctorRole,
        modalityIds: input.modalityPermissions.map((permission) => permission.modalityId),
      },
      reason: null,
    });
    await syncDoctorWorklistLifecycle(profile.id, client);
    await client.query("commit");

    return {
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        is_active: user.is_active,
        must_change_password: user.must_change_password,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      profile,
      modalities: await listDoctorModalityPermissions(profile.id, true),
    };
  } catch (error) {
    await client.query("rollback");
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String((error as Record<string, unknown>).code) === "23505"
    ) {
      throw new HttpError(409, "A user with that username already exists.");
    }
    throw error;
  } finally {
    client.release();
  }
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
  await syncDoctorWorklistLifecycle(profile.id);
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
