import type { Role } from "../types/domain.js";
import type { NullableUserId, UserId } from "../types/http.js";
import { HttpError } from "../utils/http-error.js";

export function isProtectedAdministrativeRole(role: Role): boolean {
  return role === "supervisor" || role === "super_admin";
}

export function assertCanManageProtectedAccount(
  actorRole: Role,
  targetRole: Role,
  actorUserId: NullableUserId = null,
  targetUserId?: UserId
): void {
  const isOwnAccount = actorUserId != null && targetUserId != null && Number(actorUserId) === Number(targetUserId);
  if (isProtectedAdministrativeRole(targetRole) && actorRole !== "super_admin" && !isOwnAccount) {
    throw new HttpError(403, "Protected administrative accounts may be managed only by a Super Admin.");
  }
}
