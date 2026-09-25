import { Navigate, useNavigate } from "react-router-dom";
import { LoginForm } from "@/components/auth/login-form";
import { useTeachingAuth } from "../auth/teaching-auth-context";
import { TeachingAccessDenied } from "../components/teaching-access-denied";
import { TeachingLoadingScreen } from "../components/teaching-loading-screen";

export function TeachingLoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, isIdentityLoading, mustChangePassword, identity, login, loginWithPasskey } = useTeachingAuth();

  if (isLoading) return <TeachingLoadingScreen />;
  if (isAuthenticated && mustChangePassword) return <Navigate to="/teaching/dashboard" replace />;
  if (isAuthenticated && isIdentityLoading) return <TeachingLoadingScreen />;
  if (isAuthenticated && identity?.permissions.includes("teaching.access")) {
    return <Navigate to="/teaching/dashboard" replace />;
  }
  if (isAuthenticated) return <TeachingAccessDenied />;

  return (
    <LoginForm
      product="teaching"
      operations={{ isLoading, login, loginWithPasskey }}
      onAuthenticated={() => navigate("/teaching/dashboard", { replace: true })}
    />
  );
}
