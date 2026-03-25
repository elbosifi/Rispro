import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

export async function listUsers() {
  const { rows } = await pool.query(`
    select id, username, full_name, role, is_active, created_at, updated_at
    from users
    order by created_at asc
  `);

  return rows;
}

export async function createUser({ username, fullName, password, role, isActive = true }) {
  if (!username || !fullName || !password || !role) {
    throw new HttpError(400, "username, fullName, password, and role are required.");
  }

  if (!["receptionist", "supervisor"].includes(role)) {
    throw new HttpError(400, "role must be receptionist or supervisor.");
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

    return rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "A user with that username already exists.");
    }

    throw error;
  }
}
