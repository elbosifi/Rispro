import { useState, type FormEvent } from "react";
import { GraduationCap, KeyRound, Lock, Power, User as UserIcon } from "lucide-react";
import { Button, Input } from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import type { User } from "@/types/api";

export interface LoginOperations {
  isLoading: boolean;
  login: (username: string, password: string) => Promise<User>;
  loginWithPasskey: () => Promise<User>;
}

export function LoginForm({
  operations,
  onAuthenticated,
  product = "rispro",
}: {
  operations: LoginOperations;
  onAuthenticated: (user: User) => Promise<void> | void;
  product?: "rispro" | "teaching";
}) {
  const { language } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await onAuthenticated(await operations.login(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : t(language, "login.failed"));
    }
  };

  const handlePasskeyLogin = async () => {
    setError("");
    try {
      await onAuthenticated(await operations.loginWithPasskey());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey sign-in failed.");
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ backgroundColor: "var(--background)" }}
    >
      <div className="absolute top-0 left-0 w-96 h-96 rounded-full opacity-5" style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)", transform: "translate(-50%, -50%)" }} />
      <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full opacity-5" style={{ background: "radial-gradient(circle, var(--blue), transparent 70%)", transform: "translate(50%, 50%)" }} />

      <div className="w-full max-w-md relative z-10">
        <div className="card-shell p-8 relative">
          <div className="text-center space-y-4 mb-8">
            <div
              className={`mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border shadow-sm ${product === "rispro" ? "bg-white" : ""}`}
              style={{ borderColor: "var(--border)" }}
            >
              {product === "teaching" ? (
                <div
                  className="flex h-full w-full items-center justify-center text-white"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))" }}
                  aria-hidden="true"
                >
                  <GraduationCap size={42} strokeWidth={1.5} />
                </div>
              ) : !logoFailed ? (
                <img
                  src="/assets/nccb-logo.png"
                  alt="National Cancer Center Benghazi logo"
                  className="h-full w-full object-contain p-2"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-white relative"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))" }}
                >
                  <span className="text-sm font-bold tracking-[0.24em]">NCCB</span>
                </div>
              )}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-embossed sm:text-3xl" style={{ color: "var(--accent)" }}>
                {product === "teaching" ? "RISpro Teaching" : t(language, "login.heading")}
              </h1>
              <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
                {product === "teaching" ? "Question Bank and Residency Education" : t(language, "login.description")}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="rispro-login-username" className="block text-xs font-mono-data uppercase tracking-[0.08em] mb-1.5" style={{ color: "var(--text-muted)" }}>
                {t(language, "login.username")}
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center" style={{ color: "var(--text-muted)" }} aria-hidden="true">
                  <UserIcon size={16} strokeWidth={1.5} />
                </div>
                <Input
                  id="rispro-login-username"
                  type="text"
                  className="input-premium pl-10"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                  disabled={operations.isLoading}
                  dir={language === "ar" ? "rtl" : "ltr"}
                />
              </div>
            </div>

            <div>
              <label htmlFor="rispro-login-password" className="block text-xs font-mono-data uppercase tracking-[0.08em] mb-1.5" style={{ color: "var(--text-muted)" }}>
                {t(language, "login.password")}
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center" style={{ color: "var(--text-muted)" }} aria-hidden="true">
                  <Lock size={16} strokeWidth={1.5} />
                </div>
                <Input
                  id="rispro-login-password"
                  type="password"
                  className="input-premium pl-10"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={operations.isLoading}
                />
              </div>
            </div>

            {error && (
              <div
                className="rounded-lg p-3 text-xs font-mono-data flex items-center gap-2 border"
                style={{ backgroundColor: "rgba(255, 71, 87, 0.08)", borderColor: "rgba(255, 71, 87, 0.3)", color: "var(--accent)" }}
                role="alert"
              >
                <Power size={14} aria-hidden="true" />
                {error}
              </div>
            )}

            <Button type="submit" disabled={operations.isLoading || !username || !password} className="w-full">
              {operations.isLoading ? (
                <>
                  <div className="spinner-industrial h-4 w-4 border-2" />
                  {t(language, "login.signingIn")}
                </>
              ) : (
                <>
                  <Power size={16} aria-hidden="true" />
                  {t(language, "login.signIn")}
                </>
              )}
            </Button>

            <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }} aria-hidden="true">
              <span className="h-px flex-1" style={{ backgroundColor: "var(--border)" }} />
              <span>or</span>
              <span className="h-px flex-1" style={{ backgroundColor: "var(--border)" }} />
            </div>
            <Button type="button" variant="secondary" disabled={operations.isLoading} onClick={() => void handlePasskeyLogin()} className="w-full">
              <KeyRound size={16} aria-hidden="true" />
              Sign in with passkey
            </Button>
          </form>
        </div>

        <div className="mt-4 text-center">
          <div className="inline-flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.15em] font-mono-data" style={{ color: "var(--text-muted)" }}>
              {product === "teaching" ? "RISpro Teaching" : "Rispro Radiology Information System v2.0"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
