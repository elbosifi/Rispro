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

async function currentAuthVersion(userId: UserId): Promise<{ authVersion: number; isActive: boolean } | null> {
  const result = await pool.query<{ auth_version: number; is_active: boolean }>(
    "select auth_version, is_active from users where id = $1 limit 1",
    [Number(userId)]
  );
  const row = result.rows[0];
  return row ? { authVersion: Number(row.auth_version), isActive: row.is_active } : null;
}

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const token = readToken(req);
      if (!token) throw new HttpError(401, "Authentication required.");

      const decoded = jwt.verify(token, env.jwtSecret);
      const payload = decoded && typeof decoded === "object" ? asUnknownRecord(decoded) : null;
      if (!payload || !payload.sub || !payload.role) throw new HttpError(401, "Invalid session.");

      const userId = payload.sub as UserId;
      const authVersion = parseAuthVersion(payload.authVersion);
      const current = await currentAuthVersion(userId);
      if (!current?.isActive || current.authVersion !== authVersion) {
        throw new HttpError(401, "Session expired. Please sign in again.");
      }

      req.user = {
        sub: userId,
        role: parseRole(payload.role),
        authVersion,
        purpose: payload.purpose ? String(payload.purpose) : undefined,
        username: payload.username ? String(payload.username) : undefined,
        fullName: payload.fullName ? String(payload.fullName) : undefined,
        mustChangePassword: payload.mustChangePassword === true
      };
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
  let role: Role;
  try {
    const token = readToken(req);
    if (!token) return next();

    const decoded = jwt.verify(token, env.jwtSecret);
    const decodedPayload = decoded && typeof decoded === "object" ? asUnknownRecord(decoded) : null;
    if (!decodedPayload) return next();
    payload = decodedPayload;
    if (!payload || !payload.sub || !payload.role) return next();
    role = parseRole(payload.role);
  } catch {
    return next();
  }
  void currentAuthVersion(payload.sub as UserId).then((current) => {
    if (!current?.isActive || current.authVersion !== parseAuthVersion(payload.authVersion)) return next();
    req.user = {
      sub: payload.sub as UserId,
      role,
      authVersion: current.authVersion,
      purpose: payload.purpose ? String(payload.purpose) : undefined,
      username: payload.username ? String(payload.username) : undefined,
      fullName: payload.fullName ? String(payload.fullName) : undefined,
      mustChangePassword: payload.mustChangePassword === true
    };
    next();
  }).catch(next);
}

export function blockForcedPasswordChange(req: AuthRequest, _res: Response, next: NextFunction): void {
  try {
    const token = readToken(req);
    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, env.jwtSecret);
    const payload = decoded && typeof decoded === "object" ? asUnknownRecord(decoded) : null;
    if (payload?.mustChangePassword === true) {
      return next(new HttpError(403, "Password change is required before accessing this area."));
    }

    return next();
  } catch {
    return next();
  }
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
