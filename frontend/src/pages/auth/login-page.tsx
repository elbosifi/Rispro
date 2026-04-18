import { useState, type FormEvent } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { Lock, User, Power, Shield } from "lucide-react";

export function LoginPage() {
  const { language } = useLanguage();
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const from = location.state?.from?.pathname || "/dashboard";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t(language, "login.failed"));
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ backgroundColor: "var(--background)" }}
    >
      {/* Background decorative elements */}
      <div className="absolute top-0 left-0 w-96 h-96 rounded-full opacity-5" style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)", transform: "translate(-50%, -50%)" }} />
      <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full opacity-5" style={{ background: "radial-gradient(circle, var(--blue), transparent 70%)", transform: "translate(50%, 50%)" }} />

      <div className="w-full max-w-md relative z-10">
        {/* Main login card */}
        <div className="card-shell p-8 relative">

          {/* Header */}
          <div className="text-center space-y-3 mb-8">
            {/* Logo badge */}
            <div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl text-white relative"
              style={{
                background: "linear-gradient(135deg, var(--accent), #c0392b)",
                boxShadow: "4px 4px 8px rgba(166, 50, 60, 0.4), -4px -4px 8px rgba(255, 100, 110, 0.3)"
              }}
            >
              <Shield size={28} strokeWidth={1.5} />
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-embossed" style={{ color: "var(--accent)" }}>
                {t(language, "login.heading")}
              </h1>
              <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
                {t(language, "login.description")}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label className="block text-xs font-mono-data uppercase tracking-[0.08em] mb-1.5" style={{ color: "var(--text-muted)" }}>
                {t(language, "login.username")}
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center" style={{ color: "var(--text-muted)" }}>
                  <User size={16} strokeWidth={1.5} />
                </div>
                <input
                  type="text"
                  className="input-premium pl-10"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  disabled={isLoading}
                  dir={language === "ar" ? "rtl" : "ltr"}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-mono-data uppercase tracking-[0.08em] mb-1.5" style={{ color: "var(--text-muted)" }}>
                {t(language, "login.password")}
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center" style={{ color: "var(--text-muted)" }}>
                  <Lock size={16} strokeWidth={1.5} />
                </div>
                <input
                  type="password"
                  className="input-premium pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                className="rounded-lg p-3 text-xs font-mono-data flex items-center gap-2 border"
                style={{
                  backgroundColor: "rgba(255, 71, 87, 0.08)",
                  borderColor: "rgba(255, 71, 87, 0.3)",
                  color: "var(--accent)"
                }}
              >
                <Power size={14} />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || !username || !password}
              className="btn-primary w-full"
            >
              {isLoading ? (
                <>
                  <div className="spinner-industrial h-4 w-4 border-2" />
                  {t(language, "login.signingIn")}
                </>
              ) : (
                <>
                  <Power size={16} />
                  {t(language, "login.signIn")}
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer status */}
        <div className="mt-4 text-center">
          <div className="inline-flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.15em] font-mono-data" style={{ color: "var(--text-muted)" }}>
              RISpro Reception v2.0
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
