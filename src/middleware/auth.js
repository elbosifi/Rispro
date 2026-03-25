import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export function readToken(req) {
  return req.cookies?.[env.cookieName] || "";
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
    next(error.name === "JsonWebTokenError" ? new HttpError(401, "Invalid session.") : error);
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
