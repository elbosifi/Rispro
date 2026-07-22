import express, { type Request, type Response, type Router } from "express";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/auth.js";
import {
  buildSessionToken,
  clearPasskeyChallengeCookie,
  clearSupervisorReauthCookie,
  readPasskeyChallengeCookie,
  writePasskeyChallengeCookie,
  writeSessionCookie
} from "../services/auth-service.js";
import { logAuditEntry } from "../services/audit-service.js";
import { requirePasskeyConfiguration } from "../services/passkey-settings-service.js";
import {
  authenticationOptions,
  registrationOptionsForUser,
  simpleWebAuthn,
  verifyAndStoreRegistration,
  verifyPasskeyLogin,
  type PasskeyUser,
  type PasskeyWebAuthn
} from "../services/passkey-service.js";
import type { AuthenticatedUserContext, UnknownRecord } from "../types/http.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";

interface PasskeyRequest extends Request {
  body: UnknownRecord;
  user: AuthenticatedUserContext;
}

function currentUser(request: PasskeyRequest): PasskeyUser {
  if (!request.user?.sub || !request.user.role || !request.user.username) {
    throw new HttpError(401, "Authentication required.");
  }
  return {
    id: request.user.sub,
    username: request.user.username,
    fullName: request.user.fullName || request.user.username,
    role: request.user.role,
    mustChangePassword: request.user.mustChangePassword === true
  };
}

function readChallenge(request: PasskeyRequest, type: "registration" | "authentication", userId?: PasskeyUser["id"]): string {
  const challenge = readPasskeyChallengeCookie(request);
  if (!challenge || challenge.type !== type || (userId != null && Number(challenge.userId) !== Number(userId))) {
    throw new HttpError(400, "Passkey challenge is missing or invalid.");
  }
  return challenge.challenge;
}

function loginResponse(user: PasskeyUser) {
  return {
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword
    }
  };
}

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: "Too many login attempts. Please wait a few minutes and try again."
});

export function createPasskeyRouter(webauthn: PasskeyWebAuthn = simpleWebAuthn): Router {
  const router = express.Router();

  router.post(
    "/register/options",
    requireAuth,
    asyncRoute(async (req: Request, res: Response) => {
      const user = currentUser(req as PasskeyRequest);
      const configuration = await requirePasskeyConfiguration();
      const options = await registrationOptionsForUser(user, configuration, webauthn);
      writePasskeyChallengeCookie(res, { type: "registration", challenge: options.challenge, userId: user.id });
      res.json(options);
    })
  );

  router.post(
    "/register/verify",
    requireAuth,
    asyncRoute(async (req: Request, res: Response) => {
      const request = req as PasskeyRequest;
      const user = currentUser(request);
      const challenge = readChallenge(request, "registration", user.id);
      const configuration = await requirePasskeyConfiguration();
      await verifyAndStoreRegistration(user.id, request.body?.response, challenge, configuration, webauthn);
      clearPasskeyChallengeCookie(res);
      res.json({ verified: true });
    })
  );

  router.post(
    "/login/options",
    loginRateLimiter,
    asyncRoute(async (_req: Request, res: Response) => {
      const configuration = await requirePasskeyConfiguration();
      const options = await authenticationOptions(configuration, webauthn);
      writePasskeyChallengeCookie(res, { type: "authentication", challenge: options.challenge });
      res.json(options);
    })
  );

  router.post(
    "/login/verify",
    loginRateLimiter,
    asyncRoute(async (req: Request, res: Response) => {
      const request = req as PasskeyRequest;
      const challenge = readChallenge(request, "authentication");
      const configuration = await requirePasskeyConfiguration();
      const user = await verifyPasskeyLogin(request.body?.response, challenge, configuration, webauthn);
      const token = buildSessionToken({
        id: user.id,
        username: user.username,
        full_name: user.fullName,
        role: user.role,
        must_change_password: user.mustChangePassword
      });
      writeSessionCookie(res, token);
      clearSupervisorReauthCookie(res);
      clearPasskeyChallengeCookie(res);
      await logAuditEntry({
        entityType: "auth",
        entityId: user.id,
        actionType: "passkey_login",
        oldValues: null,
        newValues: { username: user.username, role: user.role },
        changedByUserId: user.id
      });
      res.json(loginResponse(user));
    })
  );

  return router;
}
