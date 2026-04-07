import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
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

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  try {
    const token = readToken(req);

    if (!token) {
      throw new HttpError(401, "Authentication required.");
    }

    const decoded = jwt.verify(token, env.jwtSecret);
    const payload = decoded && typeof decoded === "object" ? asUnknownRecord(decoded) : null;

    if (!payload || !payload.sub || !payload.role) {
      throw new HttpError(401, "Invalid session.");
    }

    req.user = {
      sub: payload.sub as UserId,
      role: parseRole(payload.role),
      purpose: payload.purpose ? String(payload.purpose) : undefined,
      username: payload.username ? String(payload.username) : undefined,
      fullName: payload.fullName ? String(payload.fullName) : undefined
    };
    next();
  } catch (error) {
    const isJwtError =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      ["JsonWebTokenError", "TokenExpiredError"].includes(String((error as Error).name));
    next(
      isJwtError ? new HttpError(401, "Invalid session.") : error
    );
  }
}

export function requireSupervisor(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(new HttpError(401, "Authentication required."));
  }

  if (req.user.role !== "supervisor") {
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

    if (!token || !req.user || req.user.role !== "supervisor") {
      return false;
    }

    const payload = jwt.verify(token, env.jwtSecret) as AuthenticatedUserContext;
    return (
      payload?.purpose === "supervisor-reauth" &&
      Number(payload?.sub) === Number(req.user.sub) &&
      payload?.role === "supervisor"
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
