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

/**
 * @typedef {object} AuthRequest
 * @property {Record<string, unknown>} [body]
 * @property {{ username?: string, sub?: number | string, role?: string }} [user]
 */

export const authRouter = express.Router();
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many login attempts. Please wait a few minutes and try again."
});

authRouter.post(
  "/login",
  loginRateLimiter,
  asyncRoute(async (req, res) => {
    const request = /** @type {AuthRequest} */ (req);
    const body = /** @type {Record<string, unknown>} */ (request.body || {});
    const username = String(body.username || "");
    const password = String(body.password || "");
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
  const request = /** @type {AuthRequest} */ (req);
  res.json({
    user: {
      ...request.user,
      recentSupervisorReauth: hasRecentSupervisorReauth(req)
    }
  });
});

authRouter.post(
  "/re-auth",
  requireAuth,
  asyncRoute(async (req, res) => {
    const request = /** @type {AuthRequest} */ (req);
    const body = /** @type {Record<string, unknown>} */ (request.body || {});
    const password = String(body.password || "");
    const user = await authenticateUser(String(request.user?.username || ""), password);
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
