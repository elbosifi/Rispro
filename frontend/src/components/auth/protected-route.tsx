import { Navigate, useLocation } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/providers/auth-provider";
import type { User } from "@/types/api";

function ForcedPasswordChange() {
  const { changePassword, isLoading } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ backgroundColor: "var(--background)" }}>
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border p-6" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <h1 className="text-xl font-semibold text-foreground">Change password</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>You must change your temporary password before accessing RISpro.</p>
        <div className="mt-4 space-y-3">
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" className="w-full rounded-lg border px-3 py-2" autoComplete="current-password" />
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" className="w-full rounded-lg border px-3 py-2" autoComplete="new-password" />
        </div>
        {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
        <button type="submit" disabled={isLoading || !currentPassword || !newPassword} className="mt-4 w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">
          Save password
        </button>
      </form>
    </div>
  );
}

export function ProtectedRoute({
  children,
  requiredRoles
}: {
  children: React.ReactNode;
  requiredRoles?: User["role"][];
}) {
  const { user, isLoading } = useAuth();
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
    return <ForcedPasswordChange />;
  }

  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return (
      <Navigate to="/" replace />
    );
  }

  return <>{children}</>;
}
