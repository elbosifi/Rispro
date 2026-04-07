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
  created_at: string;
  updated_at: string;
}

export interface UserCreatePayload {
  username?: string;
  fullName?: string;
  password?: string;
  role?: Role | string;
  isActive?: boolean;
}

export async function listUsers(): Promise<UserRow[]> {
  const { rows } = await pool.query(`
    select id, username, full_name, role, is_active, created_at, updated_at
    from users
    order by created_at asc
  `);

  return rows as UserRow[];
}

export async function createUser(
  { username, fullName, password, role, isActive = true }: UserCreatePayload,
  createdByUserId: NullableUserId = null
): Promise<UserRow> {
  if (!username || !fullName || !password || !role) {
    throw new HttpError(400, "username, fullName, password, and role are required.");
  }

  if (!isRole(role)) {
    throw new HttpError(400, "role must be receptionist, supervisor, or modality_staff.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const { rows } = await pool.query(
      `
        insert into users (username, full_name, password_hash, role, is_active)
        values ($1, $2, $3, $4, $5)
        returning id, username, full_name, role, is_active, created_at, updated_at
      `,
      [username, fullName, passwordHash, role, isActive]
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
        changedByUserId: createdByUserId
      }
    );

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
  deletedByUserId: NullableUserId = null
): Promise<UserRow> {
  const cleanUserId = Number(userId);

  if (!Number.isInteger(cleanUserId) || cleanUserId <= 0) {
    throw new HttpError(400, "userId must be a positive whole number.");
  }

  if (deletedByUserId && Number(deletedByUserId) === cleanUserId) {
    throw new HttpError(400, "You cannot delete your own account.");
  }

  const { rows } = await pool.query(
    `
      delete from users
      where id = $1
      returning id, username, full_name, role, is_active, created_at, updated_at
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
    changedByUserId: deletedByUserId
  });

  return removed;
}
