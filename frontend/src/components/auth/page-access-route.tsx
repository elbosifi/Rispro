import { Navigate, useLocation } from "react-router-dom";
import { canRoleAccessRoute, type PageVisibilityMatrix, type PageVisibilityRouteKey } from "@/lib/page-visibility";
import type { User } from "@/types/api";

export function PageAccessRoute({
  routeKey,
  user,
  matrix,
  defaultLandingPath,
  children,
}: {
  routeKey: PageVisibilityRouteKey;
  user: User;
  matrix: PageVisibilityMatrix;
  defaultLandingPath: string;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const canAccess = canRoleAccessRoute(matrix, routeKey, user.role);

  if (!canAccess) {
    if (location.pathname === defaultLandingPath) {
      return null;
    }
    return <Navigate to={defaultLandingPath} replace />;
  }

  return <>{children}</>;
}
