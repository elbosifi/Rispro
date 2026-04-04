// @ts-check

import express from "express";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  authenticateUser,
  buildSessionToken,
  buildSupervisorReauthToken,
  clearSupervisorReauthCookie,
  clearSessionCookie,
  writeSessionCookie,
  writeSupervisorReauthCookie
} from "../services/auth-service.js";
import { logAuditEntry } from "../services/audit-service.js";
import { hasRecentSupervisorReauth, requireAuth } from "../middleware/auth.js";
import { HttpError } from "../utils/http-error.js";
import { asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @typedef {object} AuthLoginRequest
 * @property {UnknownRecord} [body]
 */

/**
 * @typedef {object} AuthSessionRequest
 * @property {UnknownRecord} [body]
 * @property {AuthenticatedUserContext} user
 */

/**
 * @typedef {AuthenticatedUserContext} AuthenticatedUser
 */

export const authRouter = express.Router();
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many login attempts. Please wait a few minutes and try again."
});

/**
 * @param {AuthSessionRequest} request
 * @returns {AuthenticatedUser}
 */
function requireCurrentUser(request) {
  if (!request.user.sub || !request.user.role) {
    throw new HttpError(401, "Authentication required.");
  }

  return {
    sub: request.user.sub,
    role: request.user.role,
    username: request.user.username
  };
}

authRouter.post(
  "/login",
  loginRateLimiter,
  asyncRoute(async (req, res) => {
    const request = /** @type {AuthLoginRequest} */ (req);
    const body = asUnknownRecord(request.body);
    const username = asString(body.username);
    const password = asString(body.password);
    const user = await authenticateUser(username, password);
    const token = buildSessionToken(user);
    writeSessionCookie(res, token);
    clearSupervisorReauthCookie(res);

    await logAuditEntry({
      entityType: "auth",
      entityId: user.id,
      actionType: "login",
      oldValues: null,
      newValues: { username: user.username, role: user.role },
      changedByUserId: user.id
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role
      }
    });
  })
);

authRouter.post("/logout", (_req, res) => {
  clearSupervisorReauthCookie(res);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  const request = /** @type {AuthSessionRequest} */ (req);
  const currentUser = requireCurrentUser(request);
  res.json({
    user: {
      ...currentUser,
      recentSupervisorReauth: hasRecentSupervisorReauth(request)
    }
  });
});

authRouter.post(
  "/re-auth",
  requireAuth,
  asyncRoute(async (req, res) => {
    const request = /** @type {AuthSessionRequest} */ (req);
    const currentUser = requireCurrentUser(request);
    const body = asUnknownRecord(request.body);
    const password = asString(body.password);
    const user = await authenticateUser(asString(currentUser.username), password);
    const reauthToken = buildSupervisorReauthToken(user);
    writeSupervisorReauthCookie(res, reauthToken);

    await logAuditEntry({
      entityType: "auth",
      entityId: user.id,
      actionType: "supervisor_reauth",
      oldValues: null,
      newValues: { username: user.username },
      changedByUserId: user.id
    });

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        recentSupervisorReauth: true
      }
    });
  })
);
