import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/providers/auth-provider";
import type { User } from "@/types/api";
import { ForcedPasswordChange } from "./forced-password-change";
import { canAccessPath, canAccessModule, moduleLanding, workstationPath } from '@/lib/module-access';
import { ErrorState } from '@/components/shared';

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

  if (location.pathname === '/workstation/printing' && !canAccessModule(user, 'core')) {
    const path = workstationPath(user, location.pathname);
    if (path) return <Navigate to={path} replace />;
  }
  if (!canAccessPath(user, location.pathname)) {
    const landing = moduleLanding(user);
    return landing && landing !== location.pathname ? <Navigate to={landing} replace /> : <ErrorState message="No authorized module is available. Contact an administrator. / لا توجد وحدة مصرح بها. يرجى الاتصال بالمسؤول." />;
  }

  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return (
      <Navigate to="/" replace />
    );
  }

  return <>{children}</>;
}
