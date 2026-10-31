import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import type { Role } from "../types/domain.js";
import type { UserId } from "../types/http.js";
import type { DbQueryResult } from "../types/db.js";
import { normalizeUsername } from "../utils/credentials.js";
import { httpsCookieName, trustedHttpsRequest, type HttpsTransportRequest } from "../modules/automatic-https/https-transport.js";

interface AuthUserRow {
  id: UserId;
  username: string;
  full_name: string;
  english_name: string | null;
  role: Role;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  auth_version: number;
}

interface CookieResponse {
  req?: HttpsTransportRequest;
  cookie: (name: string, value: string, options: object) => void;
}

interface ClearCookieResponse {
  req?: HttpsTransportRequest;
  clearCookie: (name: string, options: object) => void;
}

interface CookieRequest extends HttpsTransportRequest {
  cookies?: Record<string, string | undefined>;
}

export interface PasskeyChallengeSession {
  type: "registration" | "authentication" | "reauthentication";
  challenge: string;
  userId?: UserId;
}

const PASSKEY_CHALLENGE_COOKIE_NAME = "rispro_passkey_challenge";
const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;

export async function authenticateUser(
  username: string,
  password: string
): Promise<AuthUserRow> {
  const normalizedUsername = normalizeUsername(username);
  const query = `
    select id, username, full_name, english_name, role, password_hash, is_active, coalesce(must_change_password, false) as must_change_password, auth_version
    from users
    where lower(btrim(username)) = $1
    limit 1
  `;
  const { rows } = (await pool.query(query, [normalizedUsername])) as DbQueryResult<AuthUserRow>;
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

export async function recordSuccessfulLogin(userId: UserId, authVersion: number): Promise<void> {
  const result = await pool.query(
    `update users
        set last_login_at = now()
      where id = $1 and is_active = true and auth_version = $2
      returning id`,
    [Number(userId), authVersion]
  );
  if (!result.rowCount) throw new HttpError(401, "Session expired. Please sign in again.");
}

export interface CurrentSessionUser {
  id: UserId;
  username: string;
  full_name: string;
  english_name: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
}

export async function findCurrentSessionUser(userId: UserId): Promise<CurrentSessionUser | null> {
  const { rows } = await pool.query<CurrentSessionUser>(
    `select id, username, full_name, english_name, role, is_active,
            coalesce(must_change_password, false) as must_change_password
       from users where id = $1 limit 1`,
    [Number(userId)]
  );
  return rows[0] ?? null;
}

export function buildSessionToken(user: Pick<AuthUserRow, "id" | "username" | "full_name" | "role" | "must_change_password"> & { auth_version?: number }): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      authVersion: user.auth_version ?? 0,
      mustChangePassword: user.must_change_password
    },
    env.jwtSecret,
    { expiresIn: `${env.sessionHours}h` }
  );
}

export function buildSupervisorReauthToken(user: Pick<AuthUserRow, "id" | "username" | "role"> & { auth_version?: number }): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      authVersion: user.auth_version ?? 0,
      purpose: "supervisor-reauth"
    },
    env.jwtSecret,
    { expiresIn: `${env.supervisorReauthMinutes}m` }
  );
}

function sessionCookieOptions(req?: HttpsTransportRequest): {
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  maxAge: number;
  path: "/";
} {
  return {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure || Boolean(req && trustedHttpsRequest(req)),
    maxAge: env.sessionHours * 60 * 60 * 1000,
    path: "/"
  };
}

function reauthCookieOptions(req?: HttpsTransportRequest): {
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  maxAge: number;
  path: "/";
} {
  return {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure || Boolean(req && trustedHttpsRequest(req)),
    maxAge: env.supervisorReauthMinutes * 60 * 1000,
    path: "/"
  };
}

function passkeyChallengeCookieOptions(req?: HttpsTransportRequest): {
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  maxAge: number;
  path: "/";
} {
  return {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure || Boolean(req && trustedHttpsRequest(req)),
    maxAge: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
    path: "/"
  };
}

export function writeSessionCookie(res: CookieResponse, token: string): void {
  res.cookie(httpsCookieName(env.cookieName, res.req), token, sessionCookieOptions(res.req));
}

export function writeSupervisorReauthCookie(res: CookieResponse, token: string): void {
  res.cookie(httpsCookieName(env.reauthCookieName, res.req), token, reauthCookieOptions(res.req));
}

export function clearSessionCookie(res: ClearCookieResponse): void {
  res.clearCookie(httpsCookieName(env.cookieName, res.req), sessionCookieOptions(res.req));
}

export function clearSupervisorReauthCookie(res: ClearCookieResponse): void {
  res.clearCookie(httpsCookieName(env.reauthCookieName, res.req), reauthCookieOptions(res.req));
}

export function writePasskeyChallengeCookie(res: CookieResponse, challenge: PasskeyChallengeSession): void {
  const token = jwt.sign({ purpose: "passkey-challenge", ...challenge }, env.jwtSecret, {
    expiresIn: PASSKEY_CHALLENGE_TTL_SECONDS
  });
  res.cookie(httpsCookieName(PASSKEY_CHALLENGE_COOKIE_NAME, res.req), token, passkeyChallengeCookieOptions(res.req));
}

export function readPasskeyChallengeCookie(req: CookieRequest): PasskeyChallengeSession | null {
  try {
    const token = req.cookies?.[httpsCookieName(PASSKEY_CHALLENGE_COOKIE_NAME, req)];
    if (!token) return null;
    const payload = jwt.verify(token, env.jwtSecret) as Record<string, unknown>;
    if (
      payload.purpose !== "passkey-challenge" ||
      (payload.type !== "registration" && payload.type !== "authentication" && payload.type !== "reauthentication") ||
      typeof payload.challenge !== "string"
    ) {
      return null;
    }
    return {
      type: payload.type,
      challenge: payload.challenge,
      ...(payload.userId == null ? {} : { userId: payload.userId as UserId })
    };
  } catch {
    return null;
  }
}

export function clearPasskeyChallengeCookie(res: ClearCookieResponse): void {
  res.clearCookie(httpsCookieName(PASSKEY_CHALLENGE_COOKIE_NAME, res.req), passkeyChallengeCookieOptions(res.req));
}
