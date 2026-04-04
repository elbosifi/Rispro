// @ts-check

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";

/** @typedef {import("../types/domain.js").Role} Role */
/** @typedef {import("../types/http.js").UserId} UserId */

/**
 * @typedef {object} AuthUserRow
 * @property {UserId} id
 * @property {string} username
 * @property {string} full_name
 * @property {Role} role
 * @property {string} password_hash
 * @property {boolean} is_active
 */

/**
 * @template T
 * @param {T | undefined} row
 * @param {string} message
 * @returns {T}
 */
function requireRow(row, message) {
  if (!row) {
    throw new HttpError(500, message);
  }

  return row;
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<AuthUserRow>}
 */
export async function authenticateUser(username, password) {
  const query = `
    select id, username, full_name, role, password_hash, is_active
    from users
    where username = $1
    limit 1
  `;
  const { rows } = await pool.query(query, [username]);
  const user = /** @type {AuthUserRow | undefined} */ (rows[0]);

  if (!user || !user.is_active) {
    throw new HttpError(401, "Invalid username or password.");
  }
  const authenticatedUser = requireRow(user, "Failed to load authenticated user.");

  const isValid = await bcrypt.compare(password, authenticatedUser.password_hash);

  if (!isValid) {
    throw new HttpError(401, "Invalid username or password.");
  }

  return authenticatedUser;
}

/**
 * @param {AuthUserRow} user
 * @returns {string}
 */
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

/**
 * @param {AuthUserRow} user
 * @returns {string}
 */
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
  return /** @type {{ httpOnly: boolean, sameSite: "lax" | "strict" | "none", secure: boolean, maxAge: number, path: "/" }} */ ({
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
    maxAge: env.sessionHours * 60 * 60 * 1000,
    path: "/"
  });
}

function reauthCookieOptions() {
  return /** @type {{ httpOnly: boolean, sameSite: "lax" | "strict" | "none", secure: boolean, maxAge: number, path: "/" }} */ ({
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
    maxAge: env.supervisorReauthMinutes * 60 * 1000,
    path: "/"
  });
}

/**
 * @param {{ cookie: (name: string, value: string, options: object) => void }} res
 * @param {string} token
 * @returns {void}
 */
export function writeSessionCookie(res, token) {
  res.cookie(env.cookieName, token, sessionCookieOptions());
}

/**
 * @param {{ cookie: (name: string, value: string, options: object) => void }} res
 * @param {string} token
 * @returns {void}
 */
export function writeSupervisorReauthCookie(res, token) {
  res.cookie(env.reauthCookieName, token, reauthCookieOptions());
}

/**
 * @param {{ clearCookie: (name: string, options: object) => void }} res
 * @returns {void}
 */
export function clearSessionCookie(res) {
  res.clearCookie(env.cookieName, sessionCookieOptions());
}

/**
 * @param {{ clearCookie: (name: string, options: object) => void }} res
 * @returns {void}
 */
export function clearSupervisorReauthCookie(res) {
  res.clearCookie(env.reauthCookieName, reauthCookieOptions());
}
