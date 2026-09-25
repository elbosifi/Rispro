import { type ReactNode } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useTeachingIdentity } from "../api/use-teaching-identity";
import { createRisproTeachingAuthAdapter } from "./teaching-auth-adapter";
import { TeachingAuthContext } from "./teaching-auth-context";

export function TeachingAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const identityQuery = useTeachingIdentity(
    auth.user ? String(auth.user.id) : null,
    Boolean(auth.user && !auth.user.mustChangePassword),
  );
  const isIdentityLoading = Boolean(auth.user && !auth.user.mustChangePassword && identityQuery.isLoading);
  const value = createRisproTeachingAuthAdapter(auth, identityQuery.data ?? null, isIdentityLoading);

  return <TeachingAuthContext.Provider value={value}>{children}</TeachingAuthContext.Provider>;
}
