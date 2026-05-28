import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import {
  isActionPinActionKey,
  readActionPinPolicy,
  resolveActionPinRequirement,
  type ActionPinActionKey,
  type ActionPinPolicy,
} from "../services/action-pin-policy-service.js";
import { HttpError } from "../utils/http-error.js";
import type { AuthenticatedUserContext } from "../types/http.js";

export const ACTION_PIN_COOKIE_NAME = "rispro_action_pin";
export const ACTION_PIN_TOKEN_PURPOSE = "action-pin";

interface ActionPinTokenPayload extends AuthenticatedUserContext {
  purpose: "action-pin";
  actionKey?: string;
}

type PolicyReader = () => Promise<ActionPinPolicy>;

function readActionPinToken(req: Request): string {
  return req.cookies?.[ACTION_PIN_COOKIE_NAME] ?? "";
}

function getReason(req: Request): string {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  return String(body.actionPinReason ?? body.reason ?? "").trim();
}

export function buildActionPinVerificationToken(user: AuthenticatedUserContext, ttlSeconds: number, actionKey?: string): string {
  return jwt.sign(
    {
      sub: user.sub,
      username: user.username,
      role: user.role,
      purpose: ACTION_PIN_TOKEN_PURPOSE,
      actionKey,
    },
    env.jwtSecret,
    { expiresIn: `${ttlSeconds}s` }
  );
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

export function hasRecentActionPinVerification(req: Request, actionKey?: ActionPinActionKey): boolean {
  try {
    const token = readActionPinToken(req);
    if (!token || !req.user) return false;

    const payload = jwt.verify(token, env.jwtSecret) as ActionPinTokenPayload;
    if (payload?.purpose !== ACTION_PIN_TOKEN_PURPOSE || Number(payload.sub) !== Number(req.user.sub)) {
      return false;
    }

    return !actionKey || !payload.actionKey || payload.actionKey === actionKey;
  } catch {
    return false;
  }
}

export function requireActionPin(actionKey: ActionPinActionKey, readPolicy: PolicyReader = readActionPinPolicy) {
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

      if (!requirement.required) {
        next();
        return;
      }

      if (requirement.requiresReason && !getReason(req)) {
        res.status(403).json({ error: "action_pin_reason_required", actionKey });
        return;
      }

      if (!hasRecentActionPinVerification(req, actionKey)) {
        res.status(403).json({
          error: "action_pin_required",
          actionKey,
          requiresReason: requirement.requiresReason,
        });
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
