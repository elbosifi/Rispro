import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export function readToken(req) {
  return req.cookies?.[env.cookieName] || "";
}

export function readSupervisorReauthToken(req) {
  return req.cookies?.[env.reauthCookieName] || "";
}

export function requireAuth(req, _res, next) {
  try {
    const token = readToken(req);

    if (!token) {
      throw new HttpError(401, "Authentication required.");
    }

    req.user = jwt.verify(token, env.jwtSecret);
    next();
  } catch (error) {
    next(
      ["JsonWebTokenError", "TokenExpiredError"].includes(error.name)
        ? new HttpError(401, "Invalid session.")
        : error
    );
  }
}

export function requireSupervisor(req, _res, next) {
  if (!req.user) {
    return next(new HttpError(401, "Authentication required."));
  }

  if (req.user.role !== "supervisor") {
    return next(new HttpError(403, "Supervisor access required."));
  }

  return next();
}

export function requireAnyRole(allowedRoles) {
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

export function hasRecentSupervisorReauth(req) {
  try {
    const token = readSupervisorReauthToken(req);

    if (!token || !req.user || req.user.role !== "supervisor") {
      return false;
    }

    const payload = jwt.verify(token, env.jwtSecret);
    return (
      payload?.purpose === "supervisor-reauth" &&
      Number(payload?.sub) === Number(req.user.sub) &&
      payload?.role === "supervisor"
    );
  } catch {
    return false;
  }
}

export function requireRecentSupervisorReauth(req, _res, next) {
  if (!hasRecentSupervisorReauth(req)) {
    return next(new HttpError(403, "Recent supervisor re-authentication is required."));
  }

  return next();
}
