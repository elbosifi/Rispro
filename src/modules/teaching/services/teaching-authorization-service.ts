import type { TeachingIdentity, TeachingIdentityCandidate } from "../domain/teaching-identity.js";
import { loadOrProvisionTeachingIdentity } from "../repositories/teaching-identity-repository.js";
import { resolveLegacyTeachingBootstrapPermissions } from "./legacy-teaching-permission-adapter.js";

export async function resolveTeachingPermissions(candidate: TeachingIdentityCandidate): Promise<TeachingIdentity> {
  const identity = await loadOrProvisionTeachingIdentity(
    candidate,
    resolveLegacyTeachingBootstrapPermissions(candidate.compatibilityRole),
  );

  return identity;
}
