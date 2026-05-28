import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import {
  hasRecentActionPinVerification,
  parseActionKey,
  writeActionPinVerificationCookie,
} from "../middleware/action-pin.js";
import { asyncRoute } from "../utils/async-route.js";
import { asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { authenticateUser } from "../services/auth-service.js";
import {
  clearActionPin,
  createActionPinVerification,
  getActionPinStatus,
  setActionPin,
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

actionPinRouter.use(requireAuth);

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
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as ActionPinRequest;
    const body = asUnknownRecord(request.body ?? {});
    const policy = await readActionPinPolicy();

    if (!policy.allowUserPinChange) {
      throw new HttpError(403, "Action PIN changes are disabled by policy.");
    }

    const status = await getActionPinStatus(request.user.sub);
    const recentVerification = await hasRecentActionPinVerification(request);
    if (status.hasPin && policy.requirePinToViewOwnPinSettings && !recentVerification.ok) {
      const currentPassword = asString(body.currentPassword);
      if (!currentPassword) {
        throw new HttpError(403, "Recent Action PIN verification or current password is required.");
      }
      await authenticateUser(asString(request.user.username), currentPassword);
    }

    await setActionPin(request.user.sub, body.pin, request.user.sub);
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

    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new HttpError(400, "Invalid user ID.");
    }

    const result = await clearActionPin(userId as UserId, request.user.sub);
    res.json({ ok: true, ...result });
  })
);
