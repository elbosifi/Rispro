import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import {
  isActionPinActionKey,
  isIdleLockRequiredForUser,
  readActionPinPolicy,
  resolveActionPinRequirement,
  type ActionPinActionKey,
  type ActionPinMode,
  type ActionPinPolicy,
} from "../services/action-pin-policy-service.js";
import {
  getActionPinIdleLockStatus,
  validateActionPinVerification,
  type ActionPinIdleLockStatus,
  type ActionPinVerificationValidationResult,
} from "../services/action-pin-service.js";
import { HttpError } from "../utils/http-error.js";

export const ACTION_PIN_COOKIE_NAME = "rispro_action_pin";
export const ACTION_PIN_TOKEN_PURPOSE = "action-pin";

type PolicyReader = () => Promise<ActionPinPolicy>;
type VerificationValidator = typeof validateActionPinVerification;
type IdleLockReader = (userId: number) => Promise<ActionPinIdleLockStatus>;

function readActionPinToken(req: Request): string {
  return req.cookies?.[ACTION_PIN_COOKIE_NAME] ?? "";
}

export function writeActionPinVerificationCookie(res: Response, token: string, ttlSeconds: number): void {
  res.cookie(ACTION_PIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
    maxAge: ttlSeconds * 1000,
    path: "/",
  });
}

export function clearActionPinVerificationCookie(res: Response): void {
  res.clearCookie(ACTION_PIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
    path: "/",
  });
}

export async function hasRecentActionPinVerification(
  req: Request,
  actionKey?: ActionPinActionKey,
  mode: ActionPinMode = "required_after_inactivity",
  validateVerification: VerificationValidator = validateActionPinVerification
): Promise<ActionPinVerificationValidationResult> {
  if (!req.user) return { ok: false, reason: "missing_token" };
  const consume = mode === "required_every_time" || mode === "required_every_time_with_reason";
  const requireActionScoped = consume;
  return validateVerification({
    userId: req.user.sub,
    token: readActionPinToken(req),
    actionKey: actionKey ?? null,
    consume,
    requireActionScoped,
  });
}

export function requireActionPin(
  actionKey: ActionPinActionKey,
  readPolicy: PolicyReader = readActionPinPolicy,
  validateVerification: VerificationValidator = validateActionPinVerification,
  readIdleLock: IdleLockReader = (userId) => getActionPinIdleLockStatus(userId)
) {
  return async function actionPinGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new HttpError(401, "Authentication required.");
      }

      const policy = await readPolicy();
      const requirement = resolveActionPinRequirement(policy, req.user.role, actionKey);

      if (requirement.disabledForRole) {
        res.status(403).json({ error: "action_pin_disabled_for_role", actionKey });
        return;
      }

      if (isIdleLockRequiredForUser(policy, req.user.sub, req.user.role)) {
        const idleLock = await readIdleLock(Number(req.user.sub));
        if (idleLock.active && actionKey !== "session_unlock") {
          res.status(403).json({
            error: "action_pin_required",
            actionKey: "session_unlock",
            requiresReason: false,
          });
          return;
        }
      }

      if (!requirement.required) {
        next();
        return;
      }

      const verification = await hasRecentActionPinVerification(req, actionKey, requirement.mode, validateVerification);
      if (!verification.ok) {
        res.status(403).json({
          error: "action_pin_required",
          actionKey,
          requiresReason: requirement.requiresReason,
        });
        return;
      }

      if (requirement.requiresReason && !String(verification.actionReason ?? "").trim()) {
        res.status(403).json({ error: "action_pin_reason_required", actionKey });
        return;
      }

      if (req.body && typeof req.body === "object" && "actionPin" in (req.body as Record<string, unknown>)) {
        delete (req.body as Record<string, unknown>).actionPin;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function parseActionKey(value: unknown): ActionPinActionKey | undefined {
  return isActionPinActionKey(value) ? value : undefined;
}
