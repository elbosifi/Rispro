import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api, setActionPinChallengeHandler } from "@/lib/api-client";
import { useLanguage } from "@/providers/language-provider";

interface ActionPinChallenge {
  actionKey: string;
  requiresReason: boolean;
}

interface PendingChallenge extends ActionPinChallenge {
  resolve: () => void;
  reject: (error: Error) => void;
}

const ActionPinContext = createContext<null>(null);

function actionLabel(actionKey: string) {
  return actionKey.replace(/_/g, " ");
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

    if (!/^\d{4}$/.test(pin)) {
      setError(isArabic ? "أدخل رمز PIN من 4 أرقام." : "Enter a 4-digit PIN.");
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
          {isArabic ? "تأكيد PIN الإجراء" : "Confirm Action PIN"}
        </h3>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          {isArabic
            ? `أدخل PIN الخاص بك لتأكيد ${actionLabel(challenge.actionKey)}.`
            : `Enter your PIN to confirm ${actionLabel(challenge.actionKey)}.`}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <input
            ref={inputRef}
            aria-label={isArabic ? "رمز PIN" : "Action PIN"}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
              setError(null);
            }}
            autoComplete="off"
            disabled={isPending}
            className="w-full rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
          />

          {challenge.requiresReason && (
            <textarea
              aria-label={isArabic ? "سبب الإجراء" : "Action PIN reason"}
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
    <ActionPinContext.Provider value={null}>
      {children}
      {challenge && (
        <ActionPinDialog
          challenge={challenge}
          onCancel={cancel}
          onVerified={verified}
        />
      )}
    </ActionPinContext.Provider>
  );
}

export function useActionPinProvider() {
  return useContext(ActionPinContext);
}
