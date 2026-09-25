import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/providers/auth-provider";
import type { User } from "@/types/api";
import { ForcedPasswordChange } from "./forced-password-change";

export function ProtectedRoute({
  children,
  requiredRoles
}: {
  children: React.ReactNode;
  requiredRoles?: User["role"][];
}) {
  const { user, isLoading, changePassword } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-stone-50 dark:bg-stone-900">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.mustChangePassword) {
    return <ForcedPasswordChange changePassword={changePassword} isLoading={isLoading} />;
  }

  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return (
      <Navigate to="/" replace />
    );
  }

  return <>{children}</>;
}
