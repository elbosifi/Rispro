// @ts-check

import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

/**
 * @typedef {object} AuthUser
 * @property {number | string} sub
 * @property {string} role
 * @property {string} [purpose]
 * @property {string} [username]
 * @property {string} [fullName]
 */

/**
 * @typedef {object} AuthRequest
 * @property {Record<string, string | undefined>} [cookies]
 * @property {AuthUser} [user]
 */

/**
 * @typedef {(error?: unknown) => void} NextFunction
 */

/**
 * @param {AuthRequest} req
 * @returns {string}
 */
export function readToken(req) {
  return req.cookies?.[env.cookieName] || "";
}

/**
 * @param {AuthRequest} req
 * @returns {string}
 */
export function readSupervisorReauthToken(req) {
  return req.cookies?.[env.reauthCookieName] || "";
}

/**
 * @param {AuthRequest} req
 * @param {unknown} _res
 * @param {NextFunction} next
 * @returns {void}
 */
export function requireAuth(req, _res, next) {
  try {
    const token = readToken(req);

    if (!token) {
      throw new HttpError(401, "Authentication required.");
    }

    const decoded = jwt.verify(token, env.jwtSecret);
    const payload =
      decoded && typeof decoded === "object" ? /** @type {Record<string, unknown>} */ (decoded) : null;

    if (!payload || !payload.sub || !payload.role) {
      throw new HttpError(401, "Invalid session.");
    }

    req.user = {
      sub: /** @type {number | string} */ (payload.sub),
      role: String(payload.role),
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
      ["JsonWebTokenError", "TokenExpiredError"].includes(String(error.name));
    next(
      isJwtError ? new HttpError(401, "Invalid session.") : error
    );
  }
}

/**
 * @param {AuthRequest} req
 * @param {unknown} _res
 * @param {NextFunction} next
 * @returns {void}
 */
export function requireSupervisor(req, _res, next) {
  if (!req.user) {
    return next(new HttpError(401, "Authentication required."));
  }

  if (req.user.role !== "supervisor") {
    return next(new HttpError(403, "Supervisor access required."));
  }

  return next();
}

/**
 * @param {string[]} allowedRoles
 * @returns {(req: AuthRequest, _res: unknown, next: NextFunction) => void}
 */
export function requireAnyRole(allowedRoles) {
  /**
   * @param {AuthRequest} req
   * @param {unknown} _res
   * @param {NextFunction} next
   */
  return function roleGuard(req, _res, next) {
    if (!req.user) {
      return next(new HttpError(401, "Authentication required."));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new HttpError(403, "This role cannot access this area."));
    }

    return next();
  };
}

/**
 * @param {AuthRequest} req
 * @returns {boolean}
 */
export function hasRecentSupervisorReauth(req) {
  try {
    const token = readSupervisorReauthToken(req);

    if (!token || !req.user || req.user.role !== "supervisor") {
      return false;
    }

    const payload = /** @type {AuthUser} */ (jwt.verify(token, env.jwtSecret));
    return (
      payload?.purpose === "supervisor-reauth" &&
      Number(payload?.sub) === Number(req.user.sub) &&
      payload?.role === "supervisor"
    );
  } catch {
    return false;
  }
}

/**
 * @param {AuthRequest} req
 * @param {unknown} _res
 * @param {NextFunction} next
 * @returns {void}
 */
export function requireRecentSupervisorReauth(req, _res, next) {
  if (!hasRecentSupervisorReauth(req)) {
    return next(new HttpError(403, "Recent supervisor re-authentication is required."));
  }

  return next();
}
