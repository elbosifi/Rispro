import { useState, type FormEvent } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { fetchDoctorMe } from "@/lib/api-hooks";
import { Lock, User, Power } from "lucide-react";

export function LoginPage() {
  const { language } = useLanguage();
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);

  const from = location.state?.from?.pathname || "/";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const user = await login(username, password);
      if (user.mustChangePassword) {
        navigate(from, { replace: true });
        return;
      }
      const doctorMe = await fetchDoctorMe().catch(() => null);
      if (
        doctorMe?.doctorPortalAutoRedirect !== false &&
        doctorMe?.hasActiveDoctorProfile &&
        !doctorMe.canAccessCoreWorkspace &&
        (from === "/" || from === "/login")
      ) {
        navigate("/doctor/dashboard", { replace: true });
        return;
      }
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
          <div className="text-center space-y-4 mb-8">
            {/* Logo */}
            <div
              className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border bg-white shadow-sm"
              style={{ borderColor: "var(--border)" }}
            >
              {!logoFailed ? (
                <img
                  src="/assets/nccb-logo.png"
                  alt="National Cancer Center Benghazi logo"
                  className="h-full w-full object-contain p-2"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-white relative"
                  style={{
                    background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))"
                  }}
                >
                  <span className="text-sm font-bold tracking-[0.24em]">NCCB</span>
                </div>
              )}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-embossed sm:text-3xl" style={{ color: "var(--accent)" }}>
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
              Rispro Radiology Information System v2.0
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
