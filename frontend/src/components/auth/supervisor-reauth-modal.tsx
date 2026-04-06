import { useState, useRef, useEffect, type FormEvent } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";

interface SupervisorReAuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function SupervisorReAuthModal({ onClose, onSuccess }: SupervisorReAuthModalProps) {
  const { reAuth } = useAuth();
  const { language } = useLanguage();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, isPending]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password.trim()) return;

    setIsPending(true);
    try {
      await reAuth(password);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || t(language, "reauth.failed"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget && !isPending) onClose(); }}
    >
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
          {t(language, "reauth.title")}
        </h3>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {t(language, "reauth.description")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            placeholder={t(language, "reauth.placeholder")}
            autoComplete="current-password"
            disabled={isPending}
            className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
          />

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="flex-1 py-2 px-4 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-50 text-stone-700 dark:text-stone-300 font-medium rounded-lg transition-colors text-sm"
            >
              {t(language, "common.cancel")}
            </button>
            <button
              type="submit"
              disabled={isPending || !password.trim()}
              className="flex-1 py-2 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-lg transition-colors text-sm"
            >
              {isPending ? t(language, "reauth.verifying") : t(language, "reauth.verify")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
