import { createContext, useContext } from "react";
import type { TeachingAuthAdapter } from "./teaching-auth-adapter";

export const TeachingAuthContext = createContext<TeachingAuthAdapter | undefined>(undefined);

export function useTeachingAuth(): TeachingAuthAdapter {
  const context = useContext(TeachingAuthContext);
  if (!context) throw new Error("useTeachingAuth must be used within a TeachingAuthProvider");
  return context;
}
