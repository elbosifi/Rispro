import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { ApiError, api, setActionPinChallengeHandler } from "@/lib/api-client";
import { fetchActionPinStatus, lockActionPinIdleSession, logout as logoutApi } from "@/lib/api-hooks";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";

interface ActionPinChallenge {
  actionKey: string;
  requiresReason: boolean;
}

interface PendingChallenge extends ActionPinChallenge {
  resolve: () => void;
  reject: (error: Error) => void;
}

function actionLabel(actionKey: string) {
  return actionKey.replace(/_/g, " ");
}

function validatePin(pin: string, isArabic: boolean): string | null {
  return /^\d{4,8}$/.test(pin) ? null : (isArabic ? "أدخل رمز PIN من 4 إلى 8 أرقام." : "Enter a 4-8 digit PIN.");
}

function ActionPinDialog({
  challenge,
  onCancel,
  onVerified
}: {
  challenge: PendingChallenge;
  onCancel: () => void;
  onVerified: () => void;
}) {
  const { language } = useLanguage();
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isArabic = language === "ar";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const pinError = validatePin(pin, isArabic);
    if (pinError) {
      setError(pinError);
      return;
    }
    if (challenge.requiresReason && !reason.trim()) {
      setError(isArabic ? "سبب الإجراء مطلوب." : "Reason is required.");
      return;
    }

    setIsPending(true);
    try {
      await api<{ ok: true }>("/action-pin/verify", {
        method: "POST",
        skipActionPinRetry: true,
        body: JSON.stringify({
          pin,
          actionKey: challenge.actionKey,
          reason: challenge.requiresReason ? reason.trim() : undefined
        })
      });
      setPin("");
      setReason("");
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : (isArabic ? "فشل التحقق من PIN." : "PIN verification failed."));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) onCancel();
      }}
      dir={isArabic ? "rtl" : "ltr"}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-700 dark:bg-stone-800"
      >
        <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
          {isArabic ? "تأكيد إجراء مقيد" : "Confirm Restricted Action"}
        </h3>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {isArabic
            ? `أدخل PIN إجراء الأمان لتأكيد ${actionLabel(challenge.actionKey)}.`
            : `Enter your Security Action PIN to confirm ${actionLabel(challenge.actionKey)}.`}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <input
            ref={inputRef}
            aria-label={isArabic ? "PIN إجراء الأمان" : "Security Action PIN"}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, "").slice(0, 8));
              setError(null);
            }}
            autoComplete="off"
            disabled={isPending}
            className="w-full rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
          />

          {challenge.requiresReason && (
            <textarea
              aria-label={isArabic ? "سبب الإجراء" : "Action reason"}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
              disabled={isPending}
              rows={3}
              className="w-full resize-none rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-sm text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
            />
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="flex-1 rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600"
            >
              {isArabic ? "إلغاء" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:bg-teal-400"
            >
              {isPending ? (isArabic ? "جار التحقق..." : "Verifying...") : (isArabic ? "تأكيد" : "Verify")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ActionPinIdleLockOverlay({
  hasPin,
  userFullName,
  username,
  onUnlocked
}: {
  hasPin: boolean;
  userFullName?: string | null;
  username?: string | null;
  onUnlocked: () => void;
}) {
  const { language } = useLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const isArabic = language === "ar";

  const switchUser = async () => {
    setPin("");
    try {
      await logoutApi();
    } finally {
      window.location.href = "/login";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const pinError = validatePin(pin, isArabic);
    if (pinError) {
      setError(pinError);
      return;
    }

    setIsPending(true);
    try {
      await api<{ ok: true }>("/action-pin/verify", {
        method: "POST",
        skipActionPinRetry: true,
        body: JSON.stringify({ pin, actionKey: "session_unlock" })
      });
      setPin("");
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : (isArabic ? "فشل فتح القفل." : "Unlock failed."));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-stone-950 p-4 text-white" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-stone-900 p-6 shadow-2xl">
        <h2 className="text-xl font-semibold">{isArabic ? "الجلسة مقفلة" : "Session locked"}</h2>
        <p className="mt-2 text-sm text-stone-300">
          {userFullName || username || (isArabic ? "المستخدم الحالي" : "Current user")}
          {username ? <span className="block font-mono text-xs text-stone-400">{username}</span> : null}
        </p>
        {!hasPin ? (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            Action PIN is required to unlock. Switch user or contact super admin.
          </p>
        ) : null}
        <form onSubmit={submit} className="mt-4 space-y-4">
          <input
            aria-label="Unlock Action PIN"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, "").slice(0, 8));
              setError(null);
            }}
            autoComplete="off"
            disabled={isPending || !hasPin}
            className="w-full rounded-lg border border-white/10 bg-stone-800 px-4 py-2 text-white outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60"
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={switchUser} disabled={isPending} className="flex-1 rounded-lg bg-stone-700 px-4 py-2 text-sm font-medium hover:bg-stone-600 disabled:opacity-50">
              {isArabic ? "تبديل المستخدم" : "Switch user"}
            </button>
            <button type="submit" disabled={isPending || !hasPin} className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium hover:bg-teal-700 disabled:bg-teal-400">
              {isPending ? (isArabic ? "جار الفتح..." : "Unlocking...") : (isArabic ? "فتح" : "Unlock")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ActionPinIdleLock({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [locked, setLocked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["action-pin", "status", "idle-lock"],
    queryFn: fetchActionPinStatus,
    enabled: Boolean(user),
    staleTime: 30_000,
    retry: false,
  });
  const policy = status?.policy;
  const enabled = Boolean(user && policy?.enabled && policy?.idleLockEnabled && status?.idleLockEligible !== false);
  const idleSeconds = Number(policy?.idleLockSeconds || 180);

  const triggerIdleLock = async () => {
    if (!enabled || locked) return;
    try {
      const result = await lockActionPinIdleSession();
      setLocked(result.active);
    } catch {
      setLocked(true);
    }
  };

  const resetTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!enabled || locked) return;
    timerRef.current = setTimeout(() => { void triggerIdleLock(); }, Math.max(idleSeconds, 0.1) * 1000);
  };

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setLocked(false);
      return;
    }
    if (status?.idleLockActive) {
      setLocked(true);
      return;
    }
    resetTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, idleSeconds, locked, location.pathname, status?.idleLockActive]);

  useEffect(() => {
    if (!enabled) return;
    const events = ["mousemove", "mousedown", "click", "keydown", "touchstart", "touchmove", "rispro-api-activity"];
    for (const eventName of events) window.addEventListener(eventName, resetTimer, { passive: true });
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, resetTimer);
    };
  }, [enabled, idleSeconds, locked]);

  return (
    <>
      {children}
      {locked && user ? (
        <ActionPinIdleLockOverlay
          hasPin={Boolean(status?.hasPin)}
          userFullName={user.fullName}
          username={user.username}
          onUnlocked={() => {
            setLocked(false);
            void refetchStatus();
            resetTimer();
          }}
        />
      ) : null}
    </>
  );
}

export function ActionPinProvider({ children }: { children: ReactNode }) {
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);

  useEffect(() => {
    setActionPinChallengeHandler((nextChallenge) => {
      return new Promise<void>((resolve, reject) => {
        setChallenge({ ...nextChallenge, resolve, reject });
      });
    });
    return () => setActionPinChallengeHandler(null);
  }, []);

  const cancel = () => {
    challenge?.reject(new ApiError("Action PIN verification cancelled.", 403));
    setChallenge(null);
  };

  const verified = () => {
    challenge?.resolve();
    setChallenge(null);
  };

  return (
    <>
      {children}
      {challenge && (
        <ActionPinDialog
          challenge={challenge}
          onCancel={cancel}
          onVerified={verified}
        />
      )}
    </>
  );
}
