import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

export async function authenticateUser(username, password) {
  const query = `
    select id, username, full_name, role, password_hash, is_active
    from users
    where username = $1
    limit 1
  `;
  const { rows } = await pool.query(query, [username]);
  const user = rows[0];

  if (!user || !user.is_active) {
    throw new HttpError(401, "Invalid username or password.");
  }

  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    throw new HttpError(401, "Invalid username or password.");
  }

  return user;
}

export function buildSessionToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role
    },
    env.jwtSecret,
    { expiresIn: "8h" }
  );
}

export function writeSessionCookie(res, token) {
  res.cookie(env.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 8 * 60 * 60 * 1000
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(env.cookieName);
}
