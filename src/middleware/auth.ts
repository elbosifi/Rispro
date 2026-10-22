import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { isRole } from "../constants/roles.js";
import { asUnknownRecord } from "../utils/records.js";
import type { Role } from "../types/domain.js";
import type { UserId, AuthenticatedUserContext } from "../types/http.js";

export type AuthRequest = Request;

function parseRole(value: unknown): Role {
  const role = String(value ?? "").trim();

  if (!isRole(role)) {
    throw new HttpError(401, "Invalid session.");
  }

  return role;
}

export function readToken(req: AuthRequest): string {
  return req.cookies?.[env.cookieName] ?? "";
}

export function readSupervisorReauthToken(req: AuthRequest): string {
  return req.cookies?.[env.reauthCookieName] ?? "";
}

function parseAuthVersion(value: unknown): number {
  if (value === undefined) return 0;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) throw new HttpError(401, "Invalid session.");
  return version;
}

interface CurrentAuthState {
  authVersion: number;
  isActive: boolean;
  role: Role;
  mustChangePassword: boolean;
}

async function currentAuthState(userId: UserId): Promise<CurrentAuthState | null> {
  const result = await pool.query<{
    auth_version: number;
    is_active: boolean;
    role: string;
    must_change_password: boolean;
  }>(
    `select auth_version, is_active, role,
            coalesce(must_change_password, false) as must_change_password
       from users where id = $1 limit 1`,
    [Number(userId)]
  );
  const row = result.rows[0];
  return row ? {
    authVersion: Number(row.auth_version),
    isActive: row.is_active,
    role: parseRole(row.role),
    mustChangePassword: row.must_change_password
  } : null;
}

function decodeSessionToken(token: string): Record<string, unknown> {
  const decoded = jwt.verify(token, env.jwtSecret);
  const payload = decoded && typeof decoded === "object" ? asUnknownRecord(decoded) : null;
  if (!payload || !payload.sub || !payload.role || payload.purpose !== undefined) {
    throw new HttpError(401, "Invalid session.");
  }
  return payload;
}

async function currentSessionUser(payload: Record<string, unknown>): Promise<AuthenticatedUserContext | null> {
  const userId = payload.sub as UserId;
  const authVersion = parseAuthVersion(payload.authVersion);
  const current = await currentAuthState(userId);
  if (!current?.isActive || current.authVersion !== authVersion) return null;

  return {
    sub: userId,
    role: current.role,
    authVersion: current.authVersion,
    username: payload.username ? String(payload.username) : undefined,
    fullName: payload.fullName ? String(payload.fullName) : undefined,
    mustChangePassword: current.mustChangePassword
  };
}

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      if (req.user) return next();
      const token = readToken(req);
      if (!token) throw new HttpError(401, "Authentication required.");

      const payload = decodeSessionToken(token);
      req.user = await currentSessionUser(payload) ?? undefined;
      if (!req.user) throw new HttpError(401, "Session expired. Please sign in again.");
      next();
    } catch (error) {
      const isJwtError =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        ["JsonWebTokenError", "TokenExpiredError"].includes(String((error as Error).name));
      next(isJwtError ? new HttpError(401, "Invalid session.") : error);
    }
  })();
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  let payload: Record<string, unknown>;
  try {
    const token = readToken(req);
    if (!token) return next();
    payload = decodeSessionToken(token);
  } catch {
    return next();
  }
  void currentSessionUser(payload).then((user) => {
    if (user) req.user = user;
    next();
  }).catch(next);
}

export function blockForcedPasswordChange(req: AuthRequest, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) return next();

  void (async () => {
    try {
      const payload = decodeSessionToken(token);
      const user = await currentSessionUser(payload);
      if (!user) return next();
      req.user = user;
      if (user.mustChangePassword) {
        return next(new HttpError(403, "Password change is required before accessing this area."));
      }
      return next();
    } catch (error) {
      const isJwtError = typeof error === "object" && error !== null && "name" in error &&
        ["JsonWebTokenError", "TokenExpiredError"].includes(String((error as Error).name));
      return next(isJwtError ? undefined : error);
    }
  })();
}

export function requireSupervisor(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(new HttpError(401, "Authentication required."));
  }

  if (req.user.role !== "supervisor" && req.user.role !== "super_admin") {
    return next(new HttpError(403, "Supervisor access required."));
  }

  return next();
}

export function requireAnyRole(allowedRoles: Role[]) {
  return function roleGuard(req: AuthRequest, _res: Response, next: NextFunction): void {
    if (!req.user) {
      return next(new HttpError(401, "Authentication required."));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new HttpError(403, "This role cannot access this area."));
    }

    return next();
  };
}

export function hasRecentSupervisorReauth(req: AuthRequest): boolean {
  try {
    const token = readSupervisorReauthToken(req);

    if (!token || !req.user || (req.user.role !== "supervisor" && req.user.role !== "super_admin")) {
      return false;
    }

    const payload = jwt.verify(token, env.jwtSecret) as AuthenticatedUserContext;
    return (
      payload?.purpose === "supervisor-reauth" &&
      Number(payload?.sub) === Number(req.user.sub) &&
      Number(payload?.authVersion ?? 0) === Number(req.user.authVersion ?? 0) &&
      (payload?.role === "supervisor" || payload?.role === "super_admin")
    );
  } catch {
    return false;
  }
}

export function requireRecentSupervisorReauth(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!hasRecentSupervisorReauth(req)) {
    return next(new HttpError(403, "Recent supervisor re-authentication is required."));
  }

  return next();
}
