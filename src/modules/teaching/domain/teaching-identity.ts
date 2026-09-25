import type { TeachingPermission } from "./teaching-permission.js";

export interface TeachingIdentityCandidate {
  identityIssuer: string;
  identitySubject: string;
  displayName: string;
  compatibilityRole: string;
}

export interface TeachingIdentity {
  identityIssuer: string;
  identitySubject: string;
  displayName: string;
  permissions: TeachingPermission[];
}
