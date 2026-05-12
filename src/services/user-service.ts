import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { isRole } from "../constants/roles.js";
import type { Role } from "../types/domain.js";
import type { NullableUserId, UserId } from "../types/http.js";

export interface UserRow {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserCreatePayload {
  username?: string;
  fullName?: string;
  password?: string;
  role?: Role | string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

interface UserActorContext {
  userId: NullableUserId;
  role: Role;
}

async function auditSuperAdminAttempt(input: {
  actionType: string;
  actorUserId: NullableUserId;
  targetUserId?: NullableUserId;
  details: Record<string, unknown>;
}): Promise<void> {
  await logAuditEntry({
    entityType: "user",
    entityId: input.targetUserId ?? null,
    actionType: input.actionType,
    oldValues: null,
    newValues: input.details,
    changedByUserId: input.actorUserId
  });
}

export async function listUsers(): Promise<UserRow[]> {
  const { rows } = await pool.query(`
    select id, username, full_name, role, is_active, coalesce(must_change_password, false) as must_change_password, created_at, updated_at
    from users
    order by created_at asc
  `);

  return rows as UserRow[];
}

export async function createUser(
  { username, fullName, password, role, isActive = true, mustChangePassword = false }: UserCreatePayload,
  actor: UserActorContext = { userId: null, role: "supervisor" }
): Promise<UserRow> {
  if (!username || !fullName || !password || !role) {
    throw new HttpError(400, "username, fullName, password, and role are required.");
  }

  if (!isRole(role)) {
    throw new HttpError(
      400,
      "role must be receptionist, supervisor, super_admin, modality_staff, doctor, or administrative."
    );
  }

  if (role === "super_admin" && actor.role !== "super_admin") {
    await auditSuperAdminAttempt({
      actionType: "create_super_admin_denied",
      actorUserId: actor.userId,
      details: {
        reason: "only_super_admin_can_create_super_admin",
        attemptedRole: role,
        username: String(username)
      }
    });
    throw new HttpError(403, "Only super_admin can create a super_admin user.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const { rows } = await pool.query(
      `
        insert into users (username, full_name, password_hash, role, is_active, must_change_password)
        values ($1, $2, $3, $4, $5, $6)
        returning id, username, full_name, role, is_active, must_change_password, created_at, updated_at
      `,
      [username, fullName, passwordHash, role, isActive, mustChangePassword]
    );

    const createdUser = rows[0] as UserRow | undefined;

    if (!createdUser) {
      throw new HttpError(500, "Failed to create user.");
    }

    await logAuditEntry(
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

  const targetResult = await pool.query<{
    id: number;
    username: string;
    role: Role;
  }>(
    `
      select id, username, role
      from users
      where id = $1
      limit 1
    `,
    [cleanUserId]
  );
  const target = targetResult.rows[0];
  if (!target) {
    throw new HttpError(404, "User not found.");
  }

  if (target.role === "super_admin" && actor.role !== "super_admin") {
    await auditSuperAdminAttempt({
      actionType: "delete_super_admin_denied",
      actorUserId: actor.userId,
      targetUserId: target.id,
      details: {
        reason: "only_super_admin_can_delete_super_admin",
        targetUsername: target.username
      }
    });
    throw new HttpError(403, "Only super_admin can delete a super_admin user.");
  }

  if (target.role === "super_admin") {
    const countResult = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from users
        where role = 'super_admin'
          and is_active = true
      `
    );
    const activeSuperAdminCount = Number(countResult.rows[0]?.count ?? "0");
    if (activeSuperAdminCount <= 1) {
      await auditSuperAdminAttempt({
        actionType: "delete_super_admin_denied",
        actorUserId: actor.userId,
        targetUserId: target.id,
        details: {
          reason: "cannot_delete_last_super_admin",
          targetUsername: target.username
        }
      });
      throw new HttpError(409, "Cannot delete the last active super_admin user.");
    }
  }

  const { rows } = await pool.query(
    `
      delete from users
      where id = $1
      returning id, username, full_name, role, is_active, must_change_password, created_at, updated_at
    `,
    [cleanUserId]
  );

  const removed = rows[0] as UserRow | undefined;

  if (!removed) {
    throw new HttpError(404, "User not found.");
  }

  await logAuditEntry({
    entityType: "user",
    entityId: removed.id,
    actionType: "delete",
    oldValues: removed,
    newValues: null,
    changedByUserId: actor.userId
  });

  if (removed.role === "super_admin") {
    await auditSuperAdminAttempt({
      actionType: "delete_super_admin_allowed",
      actorUserId: actor.userId,
      targetUserId: removed.id,
      details: {
        reason: "super_admin_deleted",
        targetUsername: removed.username
      }
    });
  }

  return removed;
}

export async function updateUserPassword(
  userId: UserId,
  password: string,
  changedByUserId: NullableUserId = null
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  const cleanPassword = String(password ?? "").trim();

  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }
  if (!cleanPassword) {
    throw new HttpError(400, "password is required.");
  }

  const currentResult = await pool.query(
    `
      select id, username, full_name, role, is_active, must_change_password, created_at, updated_at
      from users
      where id = $1
      limit 1
    `,
    [cleanUserId]
  );

  const previousUser = currentResult.rows[0] as UserRow | undefined;
  if (!previousUser) {
    throw new HttpError(404, "User not found.");
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 10);
  const updatedResult = await pool.query(
    `
      update users
      set password_hash = $2, must_change_password = false, updated_at = now()
      where id = $1
      returning id, username, full_name, role, is_active, must_change_password, created_at, updated_at
    `,
    [cleanUserId, passwordHash]
  );

  const updatedUser = updatedResult.rows[0] as UserRow | undefined;
  if (!updatedUser) {
    throw new HttpError(500, "Failed to update user password.");
  }

  await logAuditEntry({
    entityType: "user",
    entityId: updatedUser.id,
    actionType: "update",
    oldValues: previousUser,
    newValues: updatedUser,
    changedByUserId
  });

  return updatedUser;
}

export async function resetUserTemporaryPassword(
  userId: UserId,
  password: string,
  changedByUserId: NullableUserId = null
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  const cleanPassword = String(password ?? "").trim();

  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }
  if (!cleanPassword) {
    throw new HttpError(400, "temporaryPassword is required.");
  }

  const currentResult = await pool.query(
    `
      select id, username, full_name, role, is_active, must_change_password, created_at, updated_at
      from users
      where id = $1
      limit 1
    `,
    [cleanUserId]
  );
  const previousUser = currentResult.rows[0] as UserRow | undefined;
  if (!previousUser) {
    throw new HttpError(404, "User not found.");
  }

  const passwordHash = await bcrypt.hash(cleanPassword, 10);
  const updatedResult = await pool.query(
    `
      update users
      set password_hash = $2, must_change_password = true, updated_at = now()
      where id = $1
      returning id, username, full_name, role, is_active, must_change_password, created_at, updated_at
    `,
    [cleanUserId, passwordHash]
  );

  const updatedUser = updatedResult.rows[0] as UserRow | undefined;
  if (!updatedUser) {
    throw new HttpError(500, "Failed to reset user password.");
  }

  await logAuditEntry({
    entityType: "user",
    entityId: updatedUser.id,
    actionType: "reset_temporary_password",
    oldValues: { must_change_password: previousUser.must_change_password },
    newValues: { must_change_password: updatedUser.must_change_password },
    changedByUserId
  });

  return updatedUser;
}

export async function setUserMustChangePassword(
  userId: UserId,
  changedByUserId: NullableUserId = null
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }

  const updatedResult = await pool.query(
    `
      update users
      set must_change_password = true, updated_at = now()
      where id = $1
      returning id, username, full_name, role, is_active, must_change_password, created_at, updated_at
    `,
    [cleanUserId]
  );

  const updatedUser = updatedResult.rows[0] as UserRow | undefined;
  if (!updatedUser) {
    throw new HttpError(404, "User not found.");
  }

  await logAuditEntry({
    entityType: "user",
    entityId: updatedUser.id,
    actionType: "force_password_change",
    oldValues: null,
    newValues: { must_change_password: true },
    changedByUserId
  });

  return updatedUser;
}

export async function updateOwnPassword(
  userId: UserId,
  currentPassword: string,
  newPassword: string
): Promise<UserRow> {
  const cleanUserId = Number(userId);
  const cleanCurrentPassword = String(currentPassword ?? "");
  const cleanNewPassword = String(newPassword ?? "").trim();

  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }
  if (!cleanCurrentPassword || !cleanNewPassword) {
    throw new HttpError(400, "currentPassword and newPassword are required.");
  }

  const currentResult = await pool.query<UserRow & { password_hash: string }>(
    `
      select id, username, full_name, role, password_hash, is_active, must_change_password, created_at, updated_at
      from users
      where id = $1
      limit 1
    `,
    [cleanUserId]
  );
  const current = currentResult.rows[0];
  if (!current || !current.is_active) throw new HttpError(401, "Invalid username or password.");

  const valid = await bcrypt.compare(cleanCurrentPassword, current.password_hash);
  if (!valid) throw new HttpError(401, "Invalid username or password.");

  const passwordHash = await bcrypt.hash(cleanNewPassword, 10);
  const updatedResult = await pool.query<UserRow>(
    `
      update users
      set password_hash = $2, must_change_password = false, updated_at = now()
      where id = $1
      returning id, username, full_name, role, is_active, must_change_password, created_at, updated_at
    `,
    [cleanUserId, passwordHash]
  );
  const updated = updatedResult.rows[0];
  if (!updated) throw new HttpError(500, "Failed to update user password.");

  await logAuditEntry({
    entityType: "user",
    entityId: updated.id,
    actionType: "change_own_password",
    oldValues: { must_change_password: current.must_change_password },
    newValues: { must_change_password: updated.must_change_password },
    changedByUserId: updated.id
  });

  return updated;
}
