import type { Request } from "express";
import type { AuthenticatedUserContext } from "../../../types/http.js";
import { HttpError } from "../../../utils/http-error.js";
import { resolveTeachingPermissions } from "../services/teaching-authorization-service.js";
import type { TeachingAuditIdentity } from "../domain/teaching-content.js";
import type { TeachingPermission } from "../domain/teaching-permission.js";

export interface TeachingRequest extends Request {
  user?: AuthenticatedUserContext;
}

export async function requireTeachingCapabilities(req: TeachingRequest, allowed: readonly TeachingPermission[]) {
  const identity = req.user;
  if (!identity) throw new HttpError(401, "Authentication required.");
  const teachingIdentity = await resolveTeachingPermissions({
    identityIssuer: "rispro",
    identitySubject: String(identity.sub),
    displayName: identity.fullName ?? "",
    compatibilityRole: identity.role,
  });
  if (!teachingIdentity.permissions.includes("teaching.access")) {
    throw new HttpError(403, "Teaching access is not enabled for this identity.");
  }
  if (allowed.length > 0 && !allowed.some((permission) => teachingIdentity.permissions.includes(permission))
    && !teachingIdentity.permissions.includes("teaching.admin")) {
    throw new HttpError(403, "Teaching capability is required.");
  }
  const actor: TeachingAuditIdentity = {
    identityIssuer: teachingIdentity.identityIssuer,
    identitySubject: teachingIdentity.identitySubject,
    displayName: teachingIdentity.displayName,
  };
  return { teachingIdentity, actor };
}

export async function requireTeachingLearner(req: TeachingRequest) {
  const access = await requireTeachingCapabilities(req, []);
  if (!access.teachingIdentity.permissions.includes("teaching.learn")) {
    throw new HttpError(403, "Teaching learner access is required.");
  }
  return access;
}
