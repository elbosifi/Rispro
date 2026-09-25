import { TEACHING_PERMISSIONS, type TeachingPermission } from "../domain/teaching-permission.js";

const ADMIN_BOOTSTRAP_PERMISSIONS: readonly TeachingPermission[] = TEACHING_PERMISSIONS;

/** Transitional V1 mapping from RISpro roles. Persisted Teaching grants are authoritative afterward. */
export function resolveLegacyTeachingBootstrapPermissions(role: string): readonly TeachingPermission[] {
  switch (role) {
    case "doctor":
      return ["teaching.access", "teaching.learn"];
    case "supervisor":
    case "super_admin":
      return ADMIN_BOOTSTRAP_PERMISSIONS;
    default:
      return [];
  }
}
