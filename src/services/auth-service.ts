import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import type { Role } from "../types/domain.js";
import type { UserId } from "../types/http.js";
import type { DbQueryResult } from "../types/db.js";

interface AuthUserRow {
  id: UserId;
  username: string;
  full_name: string;
  role: Role;
  password_hash: string;
  is_active: boolean;
}

interface CookieResponse {
  cookie: (name: string, value: string, options: object) => void;
}

interface ClearCookieResponse {
  clearCookie: (name: string, options: object) => void;
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new HttpError(500, message);
  }

  return row;
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<AuthUserRow> {
  const query = `
    select id, username, full_name, role, password_hash, is_active
    from users
    where username = $1
    limit 1
  `;
  const { rows } = (await pool.query(query, [username])) as DbQueryResult<AuthUserRow>;
  const user = rows[0];

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

export function buildSessionToken(user: AuthUserRow): string {
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

export function buildSupervisorReauthToken(user: AuthUserRow): string {
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

function sessionCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  maxAge: number;
  path: "/";
} {
  return {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
    maxAge: env.sessionHours * 60 * 60 * 1000,
    path: "/"
  };
}

function reauthCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  maxAge: number;
  path: "/";
} {
  return {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
    maxAge: env.supervisorReauthMinutes * 60 * 1000,
    path: "/"
  };
}

export function writeSessionCookie(res: CookieResponse, token: string): void {
  res.cookie(env.cookieName, token, sessionCookieOptions());
}

export function writeSupervisorReauthCookie(res: CookieResponse, token: string): void {
  res.cookie(env.reauthCookieName, token, reauthCookieOptions());
}

export function clearSessionCookie(res: ClearCookieResponse): void {
  res.clearCookie(env.cookieName, sessionCookieOptions());
}

export function clearSupervisorReauthCookie(res: ClearCookieResponse): void {
  res.clearCookie(env.reauthCookieName, reauthCookieOptions());
}
