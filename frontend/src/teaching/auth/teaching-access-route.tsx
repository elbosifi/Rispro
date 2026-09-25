import { Navigate, useLocation } from "react-router-dom";
import { ForcedPasswordChange } from "@/components/auth/forced-password-change";
import { useTeachingAuth } from "./teaching-auth-context";
import { TeachingAccessDenied } from "../components/teaching-access-denied";
import { TeachingLoadingScreen } from "../components/teaching-loading-screen";
import type { TeachingPermission } from "../api/teaching-api";

export function TeachingAccessRoute({ children, requiredPermission }: { children: React.ReactNode; requiredPermission?: TeachingPermission }) {
  const location = useLocation();
  const { isAuthenticated, isLoading, isIdentityLoading, mustChangePassword, identity, changePassword } = useTeachingAuth();

  if (isLoading) return <TeachingLoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/teaching/login" state={{ from: location }} replace />;
  if (mustChangePassword) {
    return <ForcedPasswordChange changePassword={changePassword} isLoading={isLoading} />;
  }
  if (isIdentityLoading) return <TeachingLoadingScreen />;
  if (!identity?.permissions.includes("teaching.access")) return <TeachingAccessDenied />;
  if (requiredPermission && !identity.permissions.includes(requiredPermission) && !identity.permissions.includes("teaching.admin")) {
    return <TeachingAccessDenied capability={requiredPermission} />;
  }

  return <>{children}</>;
}
