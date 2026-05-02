import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError } from "@/lib/api-client";
import { fetchQueueSnapshot, scanIntoQueue } from "@/lib/api-hooks";
import { chooseLocalized } from "@/lib/i18n";
import type { QueueEntry, QueueSnapshot } from "@/types/api";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { Button, Input } from "@/components/shared";

const RESET_DELAY_MS = 5000;

type CheckInState =
  | { mode: "idle" }
  | { mode: "loading" }
  | { mode: "success"; entry: QueueEntry | null }
  | { mode: "error"; message: string };

function getLocalizedScanError(t: ReturnType<typeof useLanguage>["t"], err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return t("queue.checkInErrorNotFound");
    if (err.status === 400) return t("queue.checkInErrorInvalidCode");
    if (err.status === 409) return t("queue.checkInErrorAlreadyArrived");
    if (err.status === 408) return t("queue.checkInErrorTimeout");
  }
  return t("queue.checkInErrorGeneric");
}

export default function QueueCheckInPage() {
  const { t, language, isArabic, toggleLanguage } = useLanguage();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [scanValue, setScanValue] = useState("");
  const [state, setState] = useState<CheckInState>({ mode: "idle" });

  const resetToIdle = () => {
    setScanValue("");
    setState({ mode: "idle" });
    inputRef.current?.focus();
  };

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const scanMutation = useMutation({
    mutationFn: scanIntoQueue,
    onSuccess: async (result) => {
      const snapshot = await queryClient.fetchQuery<QueueSnapshot>({
        queryKey: ["queue"],
        queryFn: fetchQueueSnapshot
      });
      const matchedEntry =
        snapshot.queueEntries.find((entry) => entry.appointmentId === result.bookingId) ??
        snapshot.queueEntries.find((entry) => entry.id === result.bookingId) ??
        null;
      setState({ mode: "success", entry: matchedEntry });
      setScanValue("");
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        resetToIdle();
      }, RESET_DELAY_MS);
    },
    onError: (err) => {
      setState({ mode: "error", message: getLocalizedScanError(t, err) });
      setScanValue("");
      inputRef.current?.focus();
    }
  });

  const statusText = useMemo(() => {
    if (state.mode === "loading") return t("queue.checkInProcessing");
    if (state.mode === "error") return state.message;
    return t("queue.checkInHint");
  }, [state, t]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = scanValue.trim();
    if (!value || scanMutation.isPending) return;
    setState({ mode: "loading" });
    scanMutation.mutate(value);
  };

  return (
    <div
      className="min-h-screen flex flex-col px-4 py-4 sm:px-6 sm:py-6"
      dir={isArabic ? "rtl" : "ltr"}
      style={{ backgroundColor: "var(--background)" }}
    >
      <div className={`flex items-center justify-between gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
        <Button variant="ghost" size="sm" onClick={toggleLanguage}>
          {isArabic ? "EN" : "عربي"}
        </Button>
        <div className={`flex items-center gap-2 ${isArabic ? "flex-row-reverse" : ""}`}>
          <Link to="/queue">
            <Button variant="ghost" size="sm">{t("queue.checkInBackToQueue")}</Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={logout}>{t("common.signOut")}</Button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-4xl mx-auto text-center space-y-8">
          <h1 className="text-4xl sm:text-5xl font-display font-semibold">
            {t("queue.checkInTitle")}
          </h1>
          <p className="text-muted-foreground text-lg sm:text-xl">
            {t("queue.checkInSubtitle")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              ref={inputRef}
              type="text"
              value={scanValue}
              onChange={(event) => setScanValue(event.target.value)}
              placeholder={t("queue.checkInInputPlaceholder")}
              dir="ltr"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              className="h-16 sm:h-20 text-xl sm:text-2xl text-center font-mono"
              aria-label={t("queue.checkInInputAria")}
            />
          </form>

          {state.mode === "success" ? (
            <div className="rounded-2xl border border-green-200 bg-green-50/70 px-6 py-8 space-y-3">
              <p className="text-2xl sm:text-3xl font-semibold text-green-800">{t("queue.checkInSuccessTitle")}</p>
              {state.entry ? (
                <>
                  <p className="text-lg sm:text-2xl font-semibold text-green-900">
                    {t("queue.checkInQueueNumber", { number: state.entry.queueNumber })}
                  </p>
                  <p className="text-base sm:text-xl text-green-900">
                    {t("queue.checkInModality", { modality: chooseLocalized(language, state.entry.modalityNameAr, state.entry.modalityNameEn) })}
                  </p>
                  <p className="text-base sm:text-xl text-green-900">
                    {t("queue.checkInExam", { exam: chooseLocalized(language, state.entry.examNameAr, state.entry.examNameEn) || t("common.na") })}
                  </p>
                </>
              ) : (
                <p className="text-base sm:text-xl text-green-900">{t("queue.checkInSuccessNoDetails")}</p>
              )}
              <p className="text-sm text-green-700">{t("queue.checkInAutoReset")}</p>
            </div>
          ) : (
            <p
              className={`text-base sm:text-lg ${
                state.mode === "error" ? "text-red-600" : "text-muted-foreground"
              }`}
              role={state.mode === "error" ? "alert" : undefined}
            >
              {statusText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
