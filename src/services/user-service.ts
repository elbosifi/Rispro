import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logSecurityAuditEntry } from "./audit-service.js";
import { isRole } from "../constants/roles.js";
import type { Role } from "../types/domain.js";
import type { NullableUserId, UserId } from "../types/http.js";
import { syncDoctorWorklistForUser } from "../modules/doctor-portal/doctor-worklist-provisioning.js";
import { findDoctorProfileByUserId, listDoctorModalityPermissions } from "../modules/doctor-portal/profile-repository.js";
import { canRoleAccessPage, PAGE_VISIBILITY_ROUTE_KEYS, readPageVisibilityMatrix } from "./page-visibility-settings-service.js";
import { normalizeUsername, requireExactPassword } from "../utils/credentials.js";
import { normalizeOptionalEmail } from "../utils/email-address.js";
import { assertCanManageProtectedAccount, isProtectedAdministrativeRole } from "./protected-account-authorization.js";

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  full_name: string;
  english_name: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  can_request_scheduling_override: boolean;
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
  auth_version?: number;
}

export interface UserListRow extends Omit<UserRow, "must_change_password"> {
  must_change_password: boolean | null;
}

export interface UserCreatePayload {
  username?: string;
  email?: string | null;
  fullName?: string;
  englishName?: string | null;
  password?: string;
  role?: Role | string;
  isActive?: boolean;
  mustChangePassword?: boolean;
  canRequestSchedulingOverride?: boolean;
}

export interface UserIdentityPayload {
  username?: string;
  email?: string | null;
  fullName?: string;
  englishName?: string | null;
}

interface UserActorContext {
  userId: NullableUserId;
  role: Role;
}

const DOCTOR_WORKSPACE_ROLES = new Set<Role>(["doctor", "supervisor", "super_admin"]);

export async function lockActiveSuperAdminSet(client: PoolClient): Promise<void> {
  await client.query("select pg_advisory_xact_lock(24181, 1)");
}

async function auditSuperAdminAttempt(input: {
  actionType: string;
  actorUserId: NullableUserId;
  targetUserId?: NullableUserId;
  details: Record<string, unknown>;
}, client?: PoolClient): Promise<void> {
  await logSecurityAuditEntry({
    entityType: "user",
    entityId: input.targetUserId ?? null,
    actionType: input.actionType,
    oldValues: null,
    newValues: input.details,
    changedByUserId: input.actorUserId
  }, client);
}

export async function listUsers(actorRole: Role = "supervisor", actorUserId: NullableUserId = null): Promise<UserListRow[]> {
  const { rows } = await pool.query(`
    select id, username, email, full_name, english_name, role, is_active,
           case when role in ('supervisor', 'super_admin') and $1 <> 'super_admin' and id is distinct from $2 then null
                else coalesce(must_change_password, false) end as must_change_password,
           coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
           case when role in ('supervisor', 'super_admin') and $1 <> 'super_admin' and id is distinct from $2 then null else last_login_at end as last_login_at,
           created_at, updated_at
    from users
    order by created_at asc
  `, [actorRole, actorUserId]);

  return rows as UserListRow[];
}

export async function createUser(
  { username, email, fullName, englishName, password, role, isActive = true, mustChangePassword = false, canRequestSchedulingOverride = false }: UserCreatePayload,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  const canonicalUsername = normalizeUsername(username);
  const canonicalEmail = normalizeOptionalEmail(email);
  const cleanEnglishName = String(englishName ?? "").trim() || null;
  if (!canonicalUsername || !fullName || !password || !role) {
    throw new HttpError(400, "username, fullName, password, and role are required.");
  }

  if (!isRole(role)) {
    throw new HttpError(
      400,
      "role must be receptionist, supervisor, super_admin, modality_staff, doctor, or administrative."
    );
  }

  if (isProtectedAdministrativeRole(role) && actor.role !== "super_admin") {
    await auditSuperAdminAttempt({
      actionType: role === "super_admin" ? "create_super_admin_denied" : "create_supervisor_denied",
      actorUserId: actor.userId,
      details: {
        reason: role === "super_admin" ? "only_super_admin_can_create_super_admin" : "only_super_admin_can_grant_supervisor",
        attemptedRole: role,
        username: String(username)
      }
    });
    assertCanManageProtectedAccount(actor.role, role, actor.userId);
  }

  const exactPassword = requireExactPassword(password);
  const passwordHash = await bcrypt.hash(exactPassword, 10);

  try {
    const { rows } = await pool.query(
      `
        insert into users (username, email, full_name, english_name, password_hash, role, is_active, must_change_password, can_request_scheduling_override)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning id, username, email, full_name, english_name, role, is_active, must_change_password, can_request_scheduling_override, created_at, updated_at
      `,
      [canonicalUsername, canonicalEmail, fullName, cleanEnglishName, passwordHash, role, isActive, mustChangePassword, role === "receptionist" && canRequestSchedulingOverride]
    );

    const createdUser = rows[0] as UserRow | undefined;

    if (!createdUser) {
      throw new HttpError(500, "Failed to create user.");
    }

    await logSecurityAuditEntry(
      {
        entityType: "user",
        entityId: createdUser.id,
        actionType: "create",
        oldValues: null,
        newValues: createdUser,
        changedByUserId: actor.userId
      }
    );

    if (createdUser.role === "super_admin") {
      await auditSuperAdminAttempt({
        actionType: "create_super_admin_allowed",
        actorUserId: actor.userId,
        targetUserId: createdUser.id,
        details: {
          reason: "super_admin_created",
          targetUsername: createdUser.username
        }
      });
    }

    return createdUser;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String((error as Record<string, unknown>).code) === "23505"
    ) {
      throw new HttpError(409, "A user with that username already exists.");
    }

    throw error;
  }
}

export async function updateUserIdentity(
  userId: UserId,
  { username, email, fullName, englishName }: UserIdentityPayload,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }

  const canonicalUsername = normalizeUsername(username);
  const canonicalEmail = normalizeOptionalEmail(email);
  const cleanFullName = String(fullName ?? "").trim();
  const cleanEnglishName = String(englishName ?? "").trim() || null;
  if (!canonicalUsername) throw new HttpError(400, "username is required.");
  if (!cleanFullName) throw new HttpError(400, "fullName is required.");

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("begin");
    const currentResult = await client.query<UserRow>(
      `
        select id, username, email, full_name, english_name, role, is_active,
               coalesce(must_change_password, false) as must_change_password,
               coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
               created_at, updated_at
        from users
        where id = $1
        for update
      `,
      [cleanUserId]
    );
    const previousUser = currentResult.rows[0];
    if (!previousUser) throw new HttpError(404, "User not found.");

    if (previousUser.role === "super_admin" && actor.role !== "super_admin") {
      await auditSuperAdminAttempt({
        actionType: "update_super_admin_identity_denied",
        actorUserId: actor.userId,
        targetUserId: previousUser.id,
        details: {
          reason: "only_super_admin_can_update_super_admin",
          targetUsername: previousUser.username
        }
      });
    }
    try {
      assertCanManageProtectedAccount(actor.role, previousUser.role, actor.userId, previousUser.id);
    } catch (error) {
      if (previousUser.role === "super_admin" && actor.role !== "super_admin") {
        await client.query("commit");
        committed = true;
      }
      throw error;
    }

    const updatedResult = await client.query<UserRow>(
      `
        update users
        set username = $2, email = $3, full_name = $4, english_name = $5, updated_at = now()
        where id = $1
        returning id, username, email, full_name, english_name, role, is_active,
                  coalesce(must_change_password, false) as must_change_password,
                  coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
                  created_at, updated_at
      `,
      [cleanUserId, canonicalUsername, canonicalEmail, cleanFullName, cleanEnglishName]
    );
    const updatedUser = updatedResult.rows[0];
    if (!updatedUser) throw new HttpError(500, "Failed to update user identity.");

    await logSecurityAuditEntry({
      entityType: "user",
      entityId: updatedUser.id,
      actionType: "update_identity",
      oldValues: { username: previousUser.username, email: previousUser.email, fullName: previousUser.full_name, englishName: previousUser.english_name },
      newValues: { username: updatedUser.username, email: updatedUser.email, fullName: updatedUser.full_name, englishName: updatedUser.english_name },
      changedByUserId: actor.userId
    }, client);

    if (updatedUser.role === "super_admin") {
      await auditSuperAdminAttempt({
        actionType: "update_super_admin_identity_allowed",
        actorUserId: actor.userId,
        targetUserId: updatedUser.id,
        details: {
          reason: "super_admin_identity_updated",
          targetUsername: updatedUser.username
        }
      }, client);
    }

    await client.query("commit");
    committed = true;
    return updatedUser;
  } catch (error) {
    if (!committed) await client.query("rollback").catch(() => undefined);
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

export async function updateUserRole(
  userId: UserId,
  role: string,
  actor: UserActorContext
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }
  if (!isRole(role)) {
    throw new HttpError(400, "role must be receptionist, supervisor, super_admin, modality_staff, doctor, or administrative.");
  }
  if (actor.role !== "supervisor" && actor.role !== "super_admin") {
    throw new HttpError(403, "Supervisor access required.");
  }

  const client = await pool.connect();
  let changedRole = false;
  let deactivateDoctorProfile = false;
  let updatedUser: UserRow | undefined;
  try {
    await client.query("begin");
    await lockActiveSuperAdminSet(client);
    const currentResult = await client.query<UserRow>(
      `select id, username, email, full_name, english_name, role, is_active,
              coalesce(must_change_password, false) as must_change_password,
              coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
              created_at, updated_at
         from users where id = $1 for update`,
      [cleanUserId]
    );
    const previous = currentResult.rows[0];
    if (!previous) throw new HttpError(404, "User not found.");

    assertCanManageProtectedAccount(actor.role, previous.role, actor.userId, previous.id);
    if (role !== previous.role) assertCanManageProtectedAccount(actor.role, role);
    if (role === previous.role) {
      await client.query("commit");
      return previous;
    }

    if (previous.role === "super_admin" && previous.is_active) {
      const countResult = await client.query<{ count: string }>(
        `select count(*)::text as count from users where role = 'super_admin' and is_active = true`
      );
      if (Number(countResult.rows[0]?.count ?? "0") <= 1) {
        throw new HttpError(409, "Cannot remove the last active super_admin user.");
      }
    }

    const profileResult = await client.query<{ id: number; active: boolean }>(
      "select id, active from doctor_portal.doctor_profiles where user_id = $1 for update",
      [cleanUserId]
    );
    const profile = profileResult.rows[0];
    deactivateDoctorProfile = Boolean(profile?.active && !DOCTOR_WORKSPACE_ROLES.has(role as Role));
    if (deactivateDoctorProfile && profile) {
      await client.query(
        "update doctor_portal.doctor_profiles set active = false, updated_at = now() where id = $1",
        [profile.id]
      );
    }

    const updatedResult = await client.query<UserRow>(
      `update users
          set role = $2,
              can_request_scheduling_override = false,
              auth_version = auth_version + 1,
              updated_at = now()
        where id = $1
        returning id, username, email, full_name, english_name, role, is_active,
                  coalesce(must_change_password, false) as must_change_password,
                  coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
                  created_at, updated_at`,
      [cleanUserId, role]
    );
    updatedUser = updatedResult.rows[0];
    if (!updatedUser) throw new HttpError(500, "Failed to update user role.");

    await logSecurityAuditEntry({
      entityType: "user",
      entityId: updatedUser.id,
      actionType: "user_role_changed",
      oldValues: {
        role: previous.role,
        canRequestSchedulingOverride: previous.can_request_scheduling_override,
        doctorProfileActive: profile?.active ?? null
      },
      newValues: {
        role: updatedUser.role,
        canRequestSchedulingOverride: updatedUser.can_request_scheduling_override,
        doctorProfileActive: deactivateDoctorProfile ? false : profile?.active ?? null
      },
      changedByUserId: actor.userId
    }, client);

    await client.query("commit");
    changedRole = true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  if (changedRole && deactivateDoctorProfile) await syncDoctorWorklistForUser(cleanUserId);
  if (!updatedUser) throw new HttpError(500, "Failed to update user role.");
  return updatedUser;
}

export async function deleteUser(
  userId: UserId,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  const cleanUserId = Number(userId);

  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }

  if (actor.userId && Number(actor.userId) === cleanUserId) {
    throw new HttpError(400, "You cannot delete your own account.");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockActiveSuperAdminSet(client);
    const targetResult = await client.query<{ id: number; username: string; role: Role; is_active: boolean }>(
      "select id, username, role, is_active from users where id = $1 for update",
      [cleanUserId]
    );
    const target = targetResult.rows[0];
    if (!target) throw new HttpError(404, "User not found.");

    if (target.role === "super_admin" && actor.role !== "super_admin") {
      await auditSuperAdminAttempt({
        actionType: "delete_super_admin_denied",
        actorUserId: actor.userId,
        targetUserId: target.id,
        details: { reason: "only_super_admin_can_delete_super_admin", targetUsername: target.username }
      });
    }
    assertCanManageProtectedAccount(actor.role, target.role, actor.userId, target.id);

    if (target.role === "super_admin" && target.is_active) {
      const countResult = await client.query<{ count: string }>(
        "select count(*)::text as count from users where role = 'super_admin' and is_active = true"
      );
      if (Number(countResult.rows[0]?.count ?? "0") <= 1) {
        await auditSuperAdminAttempt({
          actionType: "delete_super_admin_denied",
          actorUserId: actor.userId,
          targetUserId: target.id,
          details: { reason: "cannot_delete_last_super_admin", targetUsername: target.username }
        });
        throw new HttpError(409, "Cannot delete the last active super_admin user.");
      }
    }

    const result = await client.query<UserRow>(
      `delete from users where id = $1
       returning id, username, email, full_name, english_name, role, is_active,
                 must_change_password, can_request_scheduling_override, created_at, updated_at`,
      [cleanUserId]
    );
    const removed = result.rows[0];
    if (!removed) throw new HttpError(404, "User not found.");

    await logSecurityAuditEntry({
      entityType: "user",
      entityId: removed.id,
      actionType: "delete",
      oldValues: removed,
      newValues: null,
      changedByUserId: actor.userId
    }, client);
    if (removed.role === "super_admin") {
      await logSecurityAuditEntry({
        entityType: "user",
        entityId: removed.id,
        actionType: "delete_super_admin_allowed",
        oldValues: null,
        newValues: { reason: "super_admin_deleted", targetUsername: removed.username },
        changedByUserId: actor.userId
      }, client);
    }
    await client.query("commit");
    return removed;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserSchedulingOverridePermission(
  userId: string,
  canRequestSchedulingOverride: boolean,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "Invalid user ID.");
  }

  const { rows } = await pool.query(
    `
      update users
      set can_request_scheduling_override = case when role = 'receptionist' then $2 else false end,
          updated_at = now()
      where id = $1
        and ($3 = 'super_admin' or role not in ('supervisor', 'super_admin') or id = $4)
      returning id, username, email, full_name, english_name, role, is_active, must_change_password, can_request_scheduling_override, created_at, updated_at
    `,
    [cleanUserId, canRequestSchedulingOverride, actor.role, actor.userId]
  );
  const updated = rows[0] as UserRow | undefined;
  if (!updated) {
    const target = await pool.query<{ role: Role }>("select role from users where id = $1", [cleanUserId]);
    if (!target.rows[0]) throw new HttpError(404, "User not found.");
    assertCanManageProtectedAccount(actor.role, target.rows[0].role, actor.userId, cleanUserId);
    throw new HttpError(409, "User changed during the update. Please retry.");
  }

  await logSecurityAuditEntry({
    entityType: "user",
    entityId: updated.id,
    actionType: "update_scheduling_override_permission",
    oldValues: null,
    newValues: { canRequestSchedulingOverride: updated.can_request_scheduling_override },
    changedByUserId: actor.userId
  });

  return updated;
}

export async function getUserSchedulingOverridePermission(userId: UserId): Promise<boolean> {
  const { rows } = await pool.query<{ can_request_scheduling_override: boolean }>(
    `
      select coalesce(can_request_scheduling_override, false) as can_request_scheduling_override
      from users
      where id = $1
      limit 1
    `,
    [userId]
  );
  return Boolean(rows[0]?.can_request_scheduling_override);
}

export async function getUserEffectiveAccess(userId: string, actor: UserActorContext) {
  const cleanUserId = Number(userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) throw new HttpError(400, "Invalid user ID.");
  const result = await pool.query<{
    id: number;
    role: Role;
    is_active: boolean;
    must_change_password: boolean;
    can_request_scheduling_override: boolean;
  }>(
    `select id, role, is_active,
            coalesce(must_change_password, false) as must_change_password,
            coalesce(can_request_scheduling_override, false) as can_request_scheduling_override
       from users where id = $1 limit 1`,
    [cleanUserId]
  );
  const user = result.rows[0];
  if (!user) throw new HttpError(404, "User not found.");
  assertCanManageProtectedAccount(actor.role, user.role, actor.userId, user.id);

  const [profile, visibility] = await Promise.all([
    findDoctorProfileByUserId(cleanUserId),
    readPageVisibilityMatrix()
  ]);
  const modalityPermissions = profile ? await listDoctorModalityPermissions(profile.id) : [];
  const profileRoleEligible = Boolean(profile?.coreRole && DOCTOR_WORKSPACE_ROLES.has(profile.coreRole as Role));
  return {
    userId: user.id,
    role: user.role,
    isActive: user.is_active,
    passwordChangeRequired: user.must_change_password,
    canRequestSchedulingOverride:
      user.role === "receptionist" && user.is_active && user.can_request_scheduling_override,
    doctorPortal: {
      configured: Boolean(profile),
      profile: profile ? {
        active: profile.active,
        effective: user.is_active && profile.active && profileRoleEligible,
        doctorRole: profile.doctorRole,
        canFinalizeReports: profile.canFinalizeReports,
        canAssignProtocols: profile.canAssignProtocols,
        canSupervise: profile.canSupervise
      } : null,
      modalityPermissions: modalityPermissions.map((permission) => ({
        modalityCode: permission.modalityCode,
        modalityNameEn: permission.modalityNameEn,
        modalityNameAr: permission.modalityNameAr,
        canProtocol: permission.canProtocol,
        canReport: permission.canReport,
        canSupervise: permission.canSupervise,
        effective: user.is_active && Boolean(profile?.active) && profileRoleEligible && permission.active
      }))
    },
    navigationVisibility: {
      source: "role_page_access",
      note: "Navigation visibility only; API authorization is enforced separately.",
      pages: PAGE_VISIBILITY_ROUTE_KEYS.map((routeKey) => ({
        routeKey,
        visible: canRoleAccessPage(routeKey, user.role, visibility)
      }))
    }
  };
}

export async function revokeUserSessions(userId: string, actor: UserActorContext): Promise<UserRow> {
  const cleanUserId = Number(userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) throw new HttpError(400, "Invalid user ID.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query<UserRow & { auth_version: number }>(
      `select id, username, email, full_name, english_name, role, is_active,
              coalesce(must_change_password, false) as must_change_password,
              coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
              auth_version, created_at, updated_at
         from users where id = $1 for update`,
      [cleanUserId]
    );
    const previous = current.rows[0];
    if (!previous) throw new HttpError(404, "User not found.");
    if (previous.role === "super_admin" && actor.role !== "super_admin") {
      await logSecurityAuditEntry({
        entityType: "user",
        entityId: previous.id,
        actionType: "revoke_sessions_denied",
        oldValues: null,
        newValues: { reason: "only_super_admin_can_revoke_super_admin_sessions" },
        changedByUserId: actor.userId
      }, client);
      await client.query("commit");
      assertCanManageProtectedAccount(actor.role, previous.role, actor.userId, previous.id);
    }
    assertCanManageProtectedAccount(actor.role, previous.role, actor.userId, previous.id);

    const updated = await client.query<UserRow & { auth_version: number }>(
      `update users set auth_version = auth_version + 1, updated_at = now()
        where id = $1
        returning id, username, email, full_name, english_name, role, is_active,
                  coalesce(must_change_password, false) as must_change_password,
                  coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
                  auth_version, created_at, updated_at`,
      [cleanUserId]
    );
    const user = updated.rows[0];
    if (!user) throw new HttpError(500, "Failed to revoke user sessions.");
    await logSecurityAuditEntry({
      entityType: "user",
      entityId: user.id,
      actionType: "revoke_sessions",
      oldValues: { authVersion: previous.auth_version },
      newValues: { authVersion: user.auth_version },
      changedByUserId: actor.userId
    }, client);
    await client.query("commit");
    return user;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserPassword(
  userId: UserId,
  password: string,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  const cleanPassword = requireExactPassword(password);

  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 10);
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("begin");
    const currentResult = await client.query<UserRow>(
      `select id, username, email, full_name, english_name, role, is_active,
              coalesce(must_change_password, false) as must_change_password,
              coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
              created_at, updated_at
         from users where id = $1 for update`,
      [cleanUserId]
    );
    const previousUser = currentResult.rows[0];
    if (!previousUser) throw new HttpError(404, "User not found.");
    if (previousUser.role === "super_admin" && actor.role !== "super_admin") {
      await logSecurityAuditEntry({
        entityType: "user", entityId: previousUser.id, actionType: "update_super_admin_password_denied",
        oldValues: null,
        newValues: { reason: "only_super_admin_can_update_super_admin", targetUsername: previousUser.username },
        changedByUserId: actor.userId
      }, client);
      await client.query("commit");
      committed = true;
      assertCanManageProtectedAccount(actor.role, previousUser.role, actor.userId, previousUser.id);
    }
    assertCanManageProtectedAccount(actor.role, previousUser.role, actor.userId, previousUser.id);
    const updatedResult = await client.query<UserRow>(
      `update users
          set password_hash = $2, must_change_password = false,
              auth_version = auth_version + 1, updated_at = now()
        where id = $1 and ($3 = 'super_admin' or role not in ('supervisor', 'super_admin') or id = $4)
        returning id, username, email, full_name, english_name, role, is_active,
                  coalesce(must_change_password, false) as must_change_password,
                  coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
                  created_at, updated_at`,
      [cleanUserId, passwordHash, actor.role, actor.userId]
    );
    const updatedUser = updatedResult.rows[0];
    if (!updatedUser) throw new HttpError(409, "User changed during the update. Please retry.");
    await logSecurityAuditEntry({
      entityType: "user", entityId: updatedUser.id, actionType: "update",
      oldValues: { must_change_password: previousUser.must_change_password },
      newValues: { must_change_password: updatedUser.must_change_password },
      changedByUserId: actor.userId
    }, client);
    await client.query("commit");
    committed = true;
    return updatedUser;
  } catch (error) {
    if (!committed) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function resetUserTemporaryPassword(
  userId: UserId,
  password: string,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  const cleanPassword = requireExactPassword(password, "temporaryPassword");

  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 10);
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("begin");
    const currentResult = await client.query<UserRow>(
      `select id, username, email, full_name, english_name, role, is_active,
              coalesce(must_change_password, false) as must_change_password,
              coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
              created_at, updated_at
         from users where id = $1 for update`,
      [cleanUserId]
    );
    const previousUser = currentResult.rows[0];
    if (!previousUser) throw new HttpError(404, "User not found.");
    if (previousUser.role === "super_admin" && actor.role !== "super_admin") {
      await logSecurityAuditEntry({
        entityType: "user", entityId: previousUser.id, actionType: "reset_super_admin_password_denied",
        oldValues: null,
        newValues: { reason: "only_super_admin_can_update_super_admin", targetUsername: previousUser.username },
        changedByUserId: actor.userId
      }, client);
      await client.query("commit");
      committed = true;
      assertCanManageProtectedAccount(actor.role, previousUser.role, actor.userId, previousUser.id);
    }
    assertCanManageProtectedAccount(actor.role, previousUser.role, actor.userId, previousUser.id);
    const updatedResult = await client.query<UserRow>(
      `update users
          set password_hash = $2, must_change_password = true,
              auth_version = auth_version + 1, updated_at = now()
        where id = $1 and ($3 = 'super_admin' or role not in ('supervisor', 'super_admin') or id = $4)
        returning id, username, email, full_name, english_name, role, is_active,
                  coalesce(must_change_password, false) as must_change_password,
                  coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
                  created_at, updated_at`,
      [cleanUserId, passwordHash, actor.role, actor.userId]
    );
    const updatedUser = updatedResult.rows[0];
    if (!updatedUser) throw new HttpError(409, "User changed during the update. Please retry.");
    await logSecurityAuditEntry({
      entityType: "user", entityId: updatedUser.id, actionType: "reset_temporary_password",
      oldValues: { must_change_password: previousUser.must_change_password },
      newValues: { must_change_password: updatedUser.must_change_password },
      changedByUserId: actor.userId
    }, client);
    await client.query("commit");
    committed = true;
    return updatedUser;
  } catch (error) {
    if (!committed) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function setUserMustChangePassword(
  userId: UserId,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("begin");
    const target = await client.query<{ id: number; role: Role; username: string; must_change_password: boolean }>(
      `select id, role, username, coalesce(must_change_password, false) as must_change_password
         from users where id = $1 for update`,
      [cleanUserId]
    );
    const previous = target.rows[0];
    if (!previous) throw new HttpError(404, "User not found.");
    if (previous.role === "super_admin" && actor.role !== "super_admin") {
      await logSecurityAuditEntry({
        entityType: "user", entityId: cleanUserId, actionType: "force_super_admin_password_change_denied",
        oldValues: null,
        newValues: { reason: "only_super_admin_can_update_super_admin", targetUsername: previous.username },
        changedByUserId: actor.userId
      }, client);
      await client.query("commit");
      committed = true;
      assertCanManageProtectedAccount(actor.role, previous.role, actor.userId, previous.id);
    }
    assertCanManageProtectedAccount(actor.role, previous.role, actor.userId, previous.id);
    const updatedResult = await client.query<UserRow>(
      `update users
          set must_change_password = true,
              auth_version = auth_version + 1, updated_at = now()
        where id = $1 and ($2 = 'super_admin' or role not in ('supervisor', 'super_admin') or id = $3)
        returning id, username, email, full_name, english_name, role, is_active,
                  coalesce(must_change_password, false) as must_change_password,
                  coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
                  created_at, updated_at`,
      [cleanUserId, actor.role, actor.userId]
    );
    const updatedUser = updatedResult.rows[0];
    if (!updatedUser) throw new HttpError(409, "User changed during the update. Please retry.");
    await logSecurityAuditEntry({
      entityType: "user", entityId: updatedUser.id, actionType: "force_password_change",
      oldValues: { must_change_password: previous.must_change_password },
      newValues: { must_change_password: true },
      changedByUserId: actor.userId
    }, client);
    await client.query("commit");
    committed = true;
    return updatedUser;
  } catch (error) {
    if (!committed) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserActiveState(
  userId: UserId,
  isActive: boolean,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }
  if (actor.userId && Number(actor.userId) === cleanUserId && !isActive) {
    throw new HttpError(400, "You cannot deactivate your own account.");
  }

  const client = await pool.connect();
  let updatedUser: UserRow | undefined;
  try {
    await client.query("begin");
    await lockActiveSuperAdminSet(client);
    const currentResult = await client.query<UserRow>(
      `select id, username, email, full_name, english_name, role, is_active,
              coalesce(must_change_password, false) as must_change_password,
              coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
              created_at, updated_at
         from users where id = $1 for update`,
      [cleanUserId]
    );
    const previousUser = currentResult.rows[0];
    if (!previousUser) throw new HttpError(404, "User not found.");

    if (previousUser.role === "super_admin" && actor.role !== "super_admin") {
      await auditSuperAdminAttempt({
        actionType: "update_super_admin_active_denied",
        actorUserId: actor.userId,
        targetUserId: previousUser.id,
        details: {
          reason: "only_super_admin_can_update_super_admin",
          targetUsername: previousUser.username,
          attemptedIsActive: isActive
        }
      });
    }
    assertCanManageProtectedAccount(actor.role, previousUser.role, actor.userId, previousUser.id);

    if (previousUser.role === "super_admin" && previousUser.is_active && !isActive) {
      const countResult = await client.query<{ count: string }>(
        "select count(*)::text as count from users where role = 'super_admin' and is_active = true"
      );
      if (Number(countResult.rows[0]?.count ?? "0") <= 1) {
        await auditSuperAdminAttempt({
          actionType: "update_super_admin_active_denied",
          actorUserId: actor.userId,
          targetUserId: previousUser.id,
          details: { reason: "cannot_deactivate_last_super_admin", targetUsername: previousUser.username }
        });
        throw new HttpError(409, "Cannot deactivate the last active super_admin user.");
      }
    }

    const updatedResult = await client.query<UserRow>(
      `update users
          set is_active = $2,
              auth_version = auth_version + case when is_active is distinct from $2 then 1 else 0 end,
              updated_at = now()
        where id = $1
        returning id, username, email, full_name, english_name, role, is_active,
                  coalesce(must_change_password, false) as must_change_password,
                  coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
                  created_at, updated_at`,
      [cleanUserId, isActive]
    );
    updatedUser = updatedResult.rows[0];
    if (!updatedUser) throw new HttpError(500, "Failed to update user active state.");

    await logSecurityAuditEntry({
      entityType: "user",
      entityId: updatedUser.id,
      actionType: isActive ? "activate" : "deactivate",
      oldValues: { is_active: previousUser.is_active },
      newValues: { is_active: updatedUser.is_active },
      changedByUserId: actor.userId
    }, client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  await syncDoctorWorklistForUser(cleanUserId);
  if (!updatedUser) throw new HttpError(500, "Failed to update user active state.");
  return updatedUser;
}

export async function updateOwnPassword(
  userId: UserId,
  currentPassword: string,
  newPassword: string,
  expectedAuthVersion?: number
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  const cleanCurrentPassword = String(currentPassword ?? "");
  const cleanNewPassword = requireExactPassword(newPassword, "newPassword");

  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }
  if (!cleanCurrentPassword || !cleanNewPassword) {
    throw new HttpError(400, "currentPassword and newPassword are required.");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const currentResult = await client.query<UserRow & { password_hash: string; auth_version: number }>(
      `select id, username, email, full_name, english_name, role, password_hash, is_active,
              coalesce(must_change_password, false) as must_change_password,
              coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
              auth_version, created_at, updated_at
         from users where id = $1 for update`,
      [cleanUserId]
    );
    const current = currentResult.rows[0];
    if (!current || !current.is_active ||
        (expectedAuthVersion !== undefined && current.auth_version !== expectedAuthVersion)) {
      throw new HttpError(401, "Session expired. Please sign in again.");
    }

    const valid = await bcrypt.compare(cleanCurrentPassword, current.password_hash);
    if (!valid) throw new HttpError(401, "Invalid username or password.");
    const passwordHash = await bcrypt.hash(cleanNewPassword, 10);
    const updatedResult = await client.query<UserRow & { auth_version: number }>(
      `update users
          set password_hash = $2, must_change_password = false,
              auth_version = auth_version + 1, updated_at = now()
        where id = $1
        returning id, username, email, full_name, english_name, role, is_active,
                  coalesce(must_change_password, false) as must_change_password,
                  coalesce(can_request_scheduling_override, false) as can_request_scheduling_override,
                  created_at, updated_at, auth_version`,
      [cleanUserId, passwordHash]
    );
    const updated = updatedResult.rows[0];
    if (!updated) throw new HttpError(500, "Failed to update user password.");

    await logSecurityAuditEntry({
      entityType: "user", entityId: updated.id, actionType: "change_own_password",
      oldValues: { must_change_password: current.must_change_password },
      newValues: { must_change_password: updated.must_change_password },
      changedByUserId: updated.id
    }, client);
    await client.query("commit");
    return updated;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
