import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import {
  parseActionKey,
  writeActionPinVerificationCookie,
} from "../middleware/action-pin.js";
import { asyncRoute } from "../utils/async-route.js";
import { asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { authenticateUser } from "../services/auth-service.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { logAuditEntry } from "../services/audit-service.js";
import {
  clearActionPin,
  createActionPinVerification,
  expireActionPinForUser,
  getActionPinStatus,
  listActionPinAdminUsers,
  setActionPin,
  unlockActionPinForUser,
  verifyActionPin,
} from "../services/action-pin-service.js";
import {
  readActionPinPolicy,
  resolveActionPinRequirement,
} from "../services/action-pin-policy-service.js";
import { HttpError } from "../utils/http-error.js";
import type { AuthenticatedUserContext, UserId } from "../types/http.js";

interface ActionPinRequest extends Request {
  user: AuthenticatedUserContext;
  body: Record<string, unknown>;
}

export const actionPinRouter = express.Router();
const actionPinManagementPasswordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many Security Action PIN password attempts. Please wait a few minutes and try again.",
});

actionPinRouter.use(requireAuth);

function requireActionPinAdmin(request: ActionPinRequest): void {
  if (request.user.role !== "super_admin") {
    throw new HttpError(403, "Only super_admin can manage Action PIN administration.");
  }
}

function parseUserIdParam(value: unknown): UserId {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new HttpError(400, "Invalid user ID.");
  }
  return userId as UserId;
}

async function verifyCurrentAccountPassword(request: ActionPinRequest, body: Record<string, unknown>): Promise<void> {
  const currentPassword = asString(body.currentPassword);
  if (!currentPassword) {
    throw new HttpError(403, "Current account password is required.");
  }

  try {
    await authenticateUser(asString(request.user.username), currentPassword);
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 401) {
      await logAuditEntry({
        entityType: "action_pin",
        entityId: request.user.sub,
        actionType: "security_pin_password_failed_attempt",
        oldValues: null,
        newValues: { userId: request.user.sub, reason: "incorrect_password" },
        changedByUserId: request.user.sub,
      });
      throw new HttpError(403, "Account password is incorrect.");
    }
    throw error;
  }
}

function validatePinManagementBody(body: Record<string, unknown>): string {
  const pin = asString(body.pin);
  const confirmPin = asString(body.confirmPin);

  if (!pin) {
    throw new HttpError(400, "PIN is required.");
  }
  if (!/^\d+$/.test(pin)) {
    throw new HttpError(400, "PIN must contain digits only.");
  }
  if (!/^\d{4,8}$/.test(pin)) {
    throw new HttpError(400, "PIN must be 4-8 digits.");
  }
  if (confirmPin && confirmPin !== pin) {
    throw new HttpError(400, "PINs do not match.");
  }

  return pin;
}

actionPinRouter.get(
  "/admin/users",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    requireActionPinAdmin(request);
    const users = await listActionPinAdminUsers(request.user.sub);
    res.json({ users });
  })
);

actionPinRouter.post(
  "/admin/users/:userId/reset",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    requireActionPinAdmin(request);
    const result = await clearActionPin(parseUserIdParam(req.params.userId), request.user.sub);
    res.json({ ok: true, ...result });
  })
);

actionPinRouter.post(
  "/admin/users/:userId/unlock",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    requireActionPinAdmin(request);
    const result = await unlockActionPinForUser(parseUserIdParam(req.params.userId), request.user.sub);
    res.json({ ok: true, ...result });
  })
);

actionPinRouter.post(
  "/admin/users/:userId/expire",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    requireActionPinAdmin(request);
    const result = await expireActionPinForUser(parseUserIdParam(req.params.userId), request.user.sub);
    res.json({ ok: true, ...result });
  })
);

actionPinRouter.get(
  "/status",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    const policy = await readActionPinPolicy();
    const status = await getActionPinStatus(request.user.sub);
    res.json({
      ...status,
      policy: {
        enabled: policy.enabled,
        pinLength: policy.pinLength,
        rotationMode: policy.rotationMode,
        verificationTtlSeconds: policy.verificationTtlSeconds,
        idleLockEnabled: policy.idleLockEnabled,
        idleLockSeconds: policy.idleLockSeconds,
        allowUserPinChange: policy.allowUserPinChange,
        allowUserPinRegenerate: policy.allowUserPinRegenerate,
        requirePinToViewOwnPinSettings: policy.requirePinToViewOwnPinSettings,
      },
    });
  })
);

actionPinRouter.post(
  "/verify",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    const body = asUnknownRecord(request.body ?? {});
    const actionKey = parseActionKey(body.actionKey);
    const policy = await readActionPinPolicy();
    const requirement = actionKey ? resolveActionPinRequirement(policy, request.user.role, actionKey) : null;

    if (requirement?.requiresReason && !asString(body.reason).trim()) {
      res.status(403).json({ error: "action_pin_reason_required", actionKey });
      return;
    }

    const result = await verifyActionPin(
      request.user.sub,
      body.pin,
      {
        maxFailedAttempts: policy.maxFailedAttempts,
        lockoutMinutes: policy.lockoutMinutes,
      },
      undefined,
      { actionKey: actionKey ?? null, role: request.user.role }
    );

    if (!result.ok) {
      res.status(result.reason === "locked" ? 423 : 403).json({
        error: result.reason === "locked" ? "action_pin_locked" : "invalid_action_pin",
        reason: result.reason,
        failedAttempts: result.failedAttempts,
        lockedUntil: result.lockedUntil,
      });
      return;
    }

    const reason = asString(body.reason).trim() || null;
    const verification = await createActionPinVerification({
      userId: request.user.sub,
      actionKey: actionKey ?? null,
      reason,
      ttlSeconds: policy.verificationTtlSeconds,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    writeActionPinVerificationCookie(res, verification.token, policy.verificationTtlSeconds);
    res.json({ ok: true, expiresAt: verification.expiresAt });
  })
);

actionPinRouter.post(
  "/set",
  actionPinManagementPasswordRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    const body = asUnknownRecord(request.body ?? {});
    const policy = await readActionPinPolicy();

    if (!policy.allowUserPinChange) {
      throw new HttpError(403, "Action PIN changes are disabled by policy.");
    }

    const status = await getActionPinStatus(request.user.sub);
    await verifyCurrentAccountPassword(request, body);

    const pin = validatePinManagementBody(body);
    await setActionPin(
      request.user.sub,
      pin,
      request.user.sub,
      null,
      undefined,
      status.hasPin ? "security_pin_reset_by_user" : "security_pin_created"
    );
    res.json({ ok: true });
  })
);

actionPinRouter.post(
  "/disable",
  actionPinManagementPasswordRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    const body = asUnknownRecord(request.body ?? {});
    const policy = await readActionPinPolicy();

    if (!policy.allowUserPinChange) {
      throw new HttpError(403, "Action PIN changes are disabled by policy.");
    }

    await verifyCurrentAccountPassword(request, body);
    await clearActionPin(request.user.sub, request.user.sub, undefined, "security_pin_disabled");
    res.json({ ok: true });
  })
);

actionPinRouter.post(
  "/reset/:userId",
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    if (request.user.role !== "super_admin") {
      throw new HttpError(403, "Only super_admin can reset Action PINs.");
    }

    const result = await clearActionPin(parseUserIdParam(req.params.userId), request.user.sub);
    res.json({ ok: true, ...result });
  })
);
