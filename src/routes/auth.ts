import express, { Request, Response, Router } from "express";
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
import { UnknownRecord, AuthenticatedUserContext, UserId } from "../types/http.js";
import type { Role } from "../types/domain.js";

interface AuthSessionRequest extends Request {
  body: Record<string, unknown>;
  user: AuthenticatedUserContext;
}

interface AuthenticatedUser {
  sub: UserId;
  role: Role;
  username: string;
}

export const authRouter: Router = express.Router();
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many login attempts. Please wait a few minutes and try again."
});

function requireCurrentUser(request: AuthSessionRequest): AuthenticatedUser {
  if (!request.user.sub || !request.user.role) {
    throw new HttpError(401, "Authentication required.");
  }

  return {
    sub: request.user.sub,
    role: request.user.role,
    username: request.user.username as string
  };
}

authRouter.post(
  "/login",
  loginRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const body = req.body as UnknownRecord;
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

authRouter.post("/logout", (_req: Request, res: Response) => {
  clearSupervisorReauthCookie(res);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  const request = req as AuthSessionRequest;
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
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as AuthSessionRequest;
    const currentUser = requireCurrentUser(request);
    const body = request.body as UnknownRecord;
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
