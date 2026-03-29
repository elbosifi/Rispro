import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";

export async function listUsers() {
  const { rows } = await pool.query(`
    select id, username, full_name, role, is_active, created_at, updated_at
    from users
    order by created_at asc
  `);

  return rows;
}

export async function createUser({ username, fullName, password, role, isActive = true }, createdByUserId = null) {
  if (!username || !fullName || !password || !role) {
    throw new HttpError(400, "username, fullName, password, and role are required.");
  }

  if (!["receptionist", "supervisor", "modality_staff"].includes(role)) {
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

    await logAuditEntry(
      {
        entityType: "user",
        entityId: rows[0].id,
        actionType: "create",
        oldValues: null,
        newValues: rows[0],
        changedByUserId: createdByUserId
      }
    );

    return rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "A user with that username already exists.");
    }

    throw error;
  }
}

export async function deleteUser(userId, deletedByUserId = null) {
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

  const removed = rows[0];

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
