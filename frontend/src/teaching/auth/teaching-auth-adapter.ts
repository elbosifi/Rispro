import type { AuthContextValue } from "@/providers/auth-provider";
import type { TeachingIdentity } from "../api/teaching-api";

export interface TeachingAuthAdapter {
  identity: TeachingIdentity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isIdentityLoading: boolean;
  mustChangePassword: boolean;
  login: AuthContextValue["login"];
  loginWithPasskey: AuthContextValue["loginWithPasskey"];
  logout: () => Promise<void>;
  changePassword: AuthContextValue["changePassword"];
}

export function createRisproTeachingAuthAdapter(
  auth: AuthContextValue,
  identity: TeachingIdentity | null,
  isIdentityLoading: boolean,
): TeachingAuthAdapter {
  return {
    identity,
    isAuthenticated: Boolean(auth.user),
    isLoading: auth.isLoading,
    isIdentityLoading,
    mustChangePassword: Boolean(auth.user?.mustChangePassword),
    login: auth.login,
    loginWithPasskey: auth.loginWithPasskey,
    logout: () => auth.logout("/teaching/login"),
    changePassword: auth.changePassword,
  };
}
