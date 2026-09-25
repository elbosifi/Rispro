export { createTeachingRouter } from "./api/teaching-routes.js";
export { resolveTeachingPermissions } from "./services/teaching-authorization-service.js";
export { resolveLegacyTeachingBootstrapPermissions } from "./services/legacy-teaching-permission-adapter.js";
export { TEACHING_PERMISSIONS, type TeachingPermission } from "./domain/teaching-permission.js";
export type { TeachingIdentity, TeachingIdentityCandidate } from "./domain/teaching-identity.js";
