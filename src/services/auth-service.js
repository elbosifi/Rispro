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
    { expiresIn: `${env.sessionHours}h` }
  );
}

export function buildSupervisorReauthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      purpose: "supervisor-reauth"
    },
    env.jwtSecret,
    { expiresIn: `${env.supervisorReauthMinutes}m` }
  );
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
    maxAge: env.sessionHours * 60 * 60 * 1000,
    path: "/"
  };
}

function reauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
    maxAge: env.supervisorReauthMinutes * 60 * 1000,
    path: "/"
  };
}

export function writeSessionCookie(res, token) {
  res.cookie(env.cookieName, token, sessionCookieOptions());
}

export function writeSupervisorReauthCookie(res, token) {
  res.cookie(env.reauthCookieName, token, reauthCookieOptions());
}

export function clearSessionCookie(res) {
  res.clearCookie(env.cookieName, sessionCookieOptions());
}

export function clearSupervisorReauthCookie(res) {
  res.clearCookie(env.reauthCookieName, reauthCookieOptions());
}
