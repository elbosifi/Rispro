import { useAuth } from "@/providers/auth-provider";
import { useNavigate, useLocation } from "react-router-dom";
import { fetchDoctorMe } from "@/lib/api-hooks";
import { LoginForm } from "@/components/auth/login-form";
import type { User } from "@/types/api";
import { shouldAutoEnterDoctorWorkspace } from "@/components/layout/navigation.helpers";

type LoginDestination = string | { pathname: string; search: string; hash: string };

function safeInternalPath(pathname: string): boolean {
  return pathname.startsWith("/") && !pathname.startsWith("//") && !pathname.startsWith("/\\");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function resolveLoginDestination(state: unknown): { pathname: string; to: LoginDestination } {
  const from = record(state)?.from;
  if (typeof from === "string") {
    if (!safeInternalPath(from)) return { pathname: "/", to: "/" };
    return { pathname: from.split(/[?#]/, 1)[0] || "/", to: from };
  }

  const locationLike = record(from);
  const pathname = locationLike?.pathname;
  if (!locationLike || typeof pathname !== "string" || !safeInternalPath(pathname)) return { pathname: "/", to: "/" };
  const search = typeof locationLike.search === "string" && (locationLike.search === "" || locationLike.search.startsWith("?")) ? locationLike.search : "";
  const hash = typeof locationLike.hash === "string" && (locationLike.hash === "" || locationLike.hash.startsWith("#")) ? locationLike.hash : "";
  return { pathname, to: { pathname, search, hash } };
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const loginDestination = resolveLoginDestination(location.state);

  const completeLogin = async (user: User) => {
    if (user.mustChangePassword) {
      navigate(loginDestination.to, { replace: true });
      return;
    }
    const doctorMe = await fetchDoctorMe().catch(() => null);
    if (shouldAutoEnterDoctorWorkspace(user, doctorMe) && (loginDestination.pathname === "/" || loginDestination.pathname === "/login")) {
      navigate("/doctor/dashboard", { replace: true });
      return;
    }
    navigate(loginDestination.to, { replace: true });
  };

  return (
    <LoginForm
      operations={auth}
      onAuthenticated={completeLogin}
    />
  );
}
