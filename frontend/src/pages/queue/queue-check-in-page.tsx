import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Building2,
  Clock3,
  ScanLine,
  Sparkles,
  TriangleAlert,
  Waves,
  RefreshCw,
  Loader2
} from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { fetchQueueSnapshot, fetchStatistics, scanIntoQueue } from "@/lib/api-hooks";
import { chooseLocalized } from "@/lib/i18n";
import { todayIsoDateLy, formatDateTimeLy } from "@/lib/date-format";
import type { QueueEntry, QueueSnapshot } from "@/types/api";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { Button, Card, Input } from "@/components/shared";

const RESET_DELAY_MS = 4500;
const FALLBACK_MODALITY_LIMIT = 6;

type CheckInState =
  | { mode: "idle" }
  | { mode: "loading" }
  | { mode: "success"; entry: QueueEntry | null }
  | { mode: "error"; message: string };

type ModalityRow = {
  key: string;
  nameAr: string;
  nameEn: string;
  inQueueCount: number;
  completedCount: number;
  totalCount: number;
};

function getLocalizedScanError(t: ReturnType<typeof useLanguage>["t"], err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return t("queue.checkInErrorNotFound");
    if (err.status === 400) return t("queue.checkInErrorInvalidCode");
    if (err.status === 409) return t("queue.checkInErrorAlreadyArrived");
    if (err.status === 408) return t("queue.checkInErrorTimeout");
  }
  return t("queue.checkInErrorGeneric");
}

function normalizeKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("||");
}

function countEnteredEntries(queue: QueueSnapshot | undefined): number {
  return queue?.queueEntries.filter((entry) => ["arrived", "waiting"].includes(entry.appointmentStatus)).length ?? 0;
}

function countCompletedEntries(queue: QueueSnapshot | undefined): number {
  return queue?.queueEntries.filter((entry) => entry.appointmentStatus === "completed").length ?? 0;
}

function countModalityEntries(
  queue: QueueSnapshot | undefined,
  predicate: (entry: QueueEntry) => boolean
): number {
  return queue?.queueEntries.filter(predicate).length ?? 0;
}

export default function QueueCheckInPage() {
  const { t, language, isArabic, toggleLanguage } = useLanguage();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [logoFailed, setLogoFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [state, setState] = useState<CheckInState>({ mode: "idle" });
  const today = useMemo(() => todayIsoDateLy(), []);

  const queueQuery = useQuery({
    queryKey: ["queue"],
    queryFn: fetchQueueSnapshot,
    refetchInterval: 10_000,
    staleTime: 5_000
  });

  const statisticsQuery = useQuery({
    queryKey: ["statistics", today, "check-in"],
    queryFn: () => fetchStatistics(today, ""),
    refetchInterval: 30_000,
    staleTime: 15_000
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (state.mode !== "loading") {
      inputRef.current?.focus();
    }
  }, [state.mode]);

  const resetToIdle = () => {
    setScanValue("");
    setState({ mode: "idle" });
    inputRef.current?.focus();
  };

  const queue = queueQuery.data;
  const statistics = statisticsQuery.data;
  const queueEntries = queue?.queueEntries ?? [];
  const statsSummary = statistics?.summary;

  const enteredToday = queue?.summary.waiting_count || countEnteredEntries(queue);
  const waitingNow = queue?.summary.waiting_count || countModalityEntries(queue, (entry) => entry.appointmentStatus === "waiting");
  const scheduledNotArrived = queue?.summary.scheduled_count || queueEntries.filter((entry) => entry.appointmentStatus === "scheduled").length;
  const totalAppointments = queue?.summary.total_appointments || queueEntries.length;
  const completedToday = statsSummary?.completedCount || countCompletedEntries(queue);

  const lastUpdatedAt = Math.max(queueQuery.dataUpdatedAt || 0, statisticsQuery.dataUpdatedAt || 0);

  const modalityRows = useMemo<ModalityRow[]>(() => {
    const merged = new Map<string, ModalityRow>();

    const upsert = (row: ModalityRow) => {
      const existing = merged.get(row.key);
      if (!existing) {
        merged.set(row.key, row);
        return;
      }

      existing.inQueueCount = Math.max(existing.inQueueCount, row.inQueueCount);
      existing.completedCount = Math.max(existing.completedCount, row.completedCount);
      existing.totalCount = Math.max(existing.totalCount, row.totalCount);
      if (!existing.nameEn && row.nameEn) existing.nameEn = row.nameEn;
      if (!existing.nameAr && row.nameAr) existing.nameAr = row.nameAr;
    };

    for (const row of statistics?.modalityBreakdown ?? []) {
      upsert({
        key: normalizeKey(row.modalityId, row.modalityNameEn, row.modalityNameAr),
        nameAr: row.modalityNameAr,
        nameEn: row.modalityNameEn,
        inQueueCount: row.inQueueCount,
        completedCount: row.completedCount,
        totalCount: row.totalCount
      });
    }

    const queueGrouped = new Map<string, { nameAr: string; nameEn: string; total: number; inQueue: number; completed: number }>();
    for (const entry of queueEntries) {
      const key = normalizeKey(entry.modalityNameEn, entry.modalityNameAr);
      const existing = queueGrouped.get(key);
      const total = (existing?.total ?? 0) + 1;
      const inQueue = (existing?.inQueue ?? 0) + (entry.appointmentStatus !== "scheduled" ? 1 : 0);
      const completed = (existing?.completed ?? 0) + (entry.appointmentStatus === "completed" ? 1 : 0);
      queueGrouped.set(key, {
        nameAr: existing?.nameAr || entry.modalityNameAr,
        nameEn: existing?.nameEn || entry.modalityNameEn,
        total,
        inQueue,
        completed
      });
    }

    for (const [key, row] of queueGrouped.entries()) {
      upsert({
        key,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        inQueueCount: row.inQueue,
        completedCount: row.completed,
        totalCount: row.total
      });
    }

    return Array.from(merged.values())
      .sort((a, b) => b.inQueueCount - a.inQueueCount || b.totalCount - a.totalCount)
      .slice(0, FALLBACK_MODALITY_LIMIT);
  }, [queueEntries, statistics?.modalityBreakdown]);

  const scanMutation = useMutation({
    mutationFn: scanIntoQueue,
    onSuccess: async (result) => {
      try {
        const [freshQueue, freshStats] = await Promise.all([
          fetchQueueSnapshot(),
          fetchStatistics(today, "")
        ]);
        queryClient.setQueryData(["queue"], freshQueue);
        queryClient.setQueryData(["statistics", today, "check-in"], freshStats);

        const matchedEntry =
          freshQueue.queueEntries.find((entry) => entry.appointmentId === result.bookingId) ??
          freshQueue.queueEntries.find((entry) => entry.id === result.bookingId) ??
          null;

        setState({ mode: "success", entry: matchedEntry });
        setScanValue("");
        if (resetTimerRef.current !== null) {
          clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
          resetToIdle();
        }, RESET_DELAY_MS);
      } catch {
        setState({ mode: "success", entry: null });
        setScanValue("");
        resetTimerRef.current = setTimeout(() => {
          resetToIdle();
        }, RESET_DELAY_MS);
      }
    },
    onError: (err) => {
      setState({ mode: "error", message: getLocalizedScanError(t, err) });
      setScanValue("");
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        resetToIdle();
      }, RESET_DELAY_MS);
    }
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = scanValue.trim();
    if (!value || scanMutation.isPending || state.mode === "loading") return;
    setState({ mode: "loading" });
    scanMutation.mutate(value);
  };

  const handleResetNow = () => {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    resetToIdle();
  };

  const statusText = useMemo(() => {
    if (state.mode === "loading") return t("queue.checkInScanning");
    if (state.mode === "error") return state.message;
    return t("queue.checkInReady");
  }, [state, t]);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", {
        timeZone: "Africa/Tripoli",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }),
    [language]
  );

  const currentClock = timeFormatter.format(currentTime);
  const hospitalName = t("brand.hospitalName");
  const pageTitle = t("queue.checkInTitle");
  const subtitle = t("queue.checkInInstruction");
  const lastUpdatedText = lastUpdatedAt ? formatDateTimeLy(new Date(lastUpdatedAt)) : t("queue.lastUpdatedUnknown");
  const hasQueueSummaryData = enteredToday > 0 || completedToday > 0 || waitingNow > 0 || scheduledNotArrived > 0 || totalAppointments > 0;
  const heroStatusLabel =
    state.mode === "loading"
      ? t("queue.checkInScanning")
      : state.mode === "success"
        ? t("queue.checkInSuccessShort")
        : state.mode === "error"
          ? t("queue.checkInErrorTitle")
          : t("queue.checkInReady");
  const heroBodyText =
    state.mode === "loading"
      ? t("queue.checkInScanningHint")
      : state.mode === "success"
        ? t("queue.checkInSuccessMessage")
        : state.mode === "error"
          ? state.message
          : subtitle;

  return (
    <div
      className="min-h-screen overflow-hidden"
      dir={isArabic ? "rtl" : "ltr"}
      style={{
        background:
          "radial-gradient(circle at top left, rgba(0, 82, 255, 0.15), transparent 35%), radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,250,252,1))"
      }}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 p-4 sm:p-6 lg:p-8">
        <header className="rounded-[2rem] border border-border/70 bg-white/85 px-4 py-4 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-md sm:px-6">
          <div className={`flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between ${isArabic ? "xl:flex-row-reverse" : ""}`}>
            <div className={`flex items-center gap-4 ${isArabic ? "flex-row-reverse" : ""}`}>
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
                {!logoFailed ? (
                  <img
                    src="/nccb-logo.png"
                    alt={hospitalName}
                    className="h-full w-full object-contain p-2"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--accent),var(--accent-secondary))] text-white">
                    <span className="text-lg font-bold tracking-[0.2em]">NCCB</span>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{t("queue.checkInLabel")}</p>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {hospitalName}
                </h1>
                <p className="text-sm text-muted-foreground sm:text-base">{pageTitle}</p>
              </div>
            </div>

            <div className={`flex flex-wrap items-center gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  <Clock3 size={14} />
                  <span>{t("queue.currentTime")}</span>
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{currentClock}</p>
              </div>

              <Button variant="ghost" size="sm" onClick={toggleLanguage} className="rounded-2xl px-4">
                {isArabic ? "EN" : "عربي"}
              </Button>

              <Link to="/queue">
                <Button variant="ghost" size="sm" className="rounded-2xl px-4">
                  <ArrowLeft size={16} />
                  <span>{t("queue.checkInBackToQueue")}</span>
                </Button>
              </Link>

              <Button variant="ghost" size="sm" onClick={logout} className="rounded-2xl px-4">
                {t("common.signOut")}
              </Button>
            </div>
          </div>
        </header>

        <main className="grid flex-1 gap-4 xl:grid-cols-[minmax(300px,0.76fr)_minmax(0,1.24fr)]">
          <section className="flex min-h-0 flex-col gap-4 xl:order-2">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.07)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t("queue.checkInMetrics")}</p>
                    <h3 className="mt-1 text-xl font-semibold text-foreground">{t("queue.checkInTodayOverview")}</h3>
                  </div>
                  <Activity className="h-5 w-5 text-[var(--accent)]" />
                </div>

                {(enteredToday === 0 && completedToday === 0 && waitingNow === 0 && scheduledNotArrived === 0 && totalAppointments === 0) ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
                    {t("queue.noActiveData")}
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  <StatTile label={t("queue.enteredToday")} value={enteredToday} accent="bg-sky-500" />
                  <StatTile label={t("queue.completedToday")} value={completedToday} accent="bg-emerald-500" />
                  <StatTile label={t("queue.waitingNow")} value={waitingNow} accent="bg-amber-500" />
                  <StatTile label={t("queue.scheduledNotArrived")} value={scheduledNotArrived} accent="bg-rose-500" />
                  <StatTile label={t("queue.totalAppointments")} value={totalAppointments} accent="bg-indigo-500" />
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
                  <span>{t("queue.lastUpdated")}</span>
                  <span className="font-medium text-foreground">{lastUpdatedText}</span>
                </div>
              </Card>

              <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.07)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t("queue.modalityStatus")}</p>
                    <h3 className="mt-1 text-xl font-semibold text-foreground">{t("queue.modalityStatusHeading")}</h3>
                  </div>
                  <Building2 className="h-5 w-5 text-[var(--accent)]" />
                </div>

                <div className="mt-4 space-y-3">
                  {modalityRows.length > 0 ? (
                    modalityRows.map((row) => (
                      <div
                        key={row.key}
                        className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4 shadow-sm"
                      >
                        <div className={`flex items-start justify-between gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
                          <div>
                            <p className="text-lg font-semibold text-foreground">
                              {chooseLocalized(language, row.nameAr, row.nameEn) || t("common.na")}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {t("queue.inQueue")}: {row.inQueueCount}{" "}
                              <span className="px-1">•</span>
                              {t("queue.completed")}: {row.completedCount}{" "}
                              <span className="px-1">•</span>
                              {t("queue.total")}: {row.totalCount}
                            </p>
                          </div>

                          <div className="min-w-16 rounded-2xl bg-[linear-gradient(135deg,rgba(0,82,255,0.12),rgba(14,165,233,0.12))] px-3 py-2 text-center">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("queue.inQueue")}</p>
                            <p className="text-2xl font-semibold text-[var(--accent)]">{row.inQueueCount}</p>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                          <div className="rounded-xl bg-white px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t("queue.inQueue")}</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{row.inQueueCount}</p>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t("queue.completed")}</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{row.completedCount}</p>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t("queue.total")}</p>
                            <p className="mt-1 text-lg font-semibold text-foreground">{row.totalCount}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (queueQuery.isLoading || statisticsQuery.isLoading) ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                      {t("common.loading")}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                      {t("queue.modalityStatusEmpty")}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-4 xl:order-1">
            <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.07)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t("queue.checkInInstructionsTitle")}</p>
                  <h3 className="mt-1 text-xl font-semibold text-foreground">{t("queue.checkInInstructionsHeading")}</h3>
                </div>
                <ScanLine className="h-5 w-5 text-[var(--accent)]" />
              </div>

              <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                <p>{t("queue.checkInStep1")}</p>
                <p>{t("queue.checkInStep2")}</p>
                <p>{t("queue.checkInStep3")}</p>
              </div>
            </Card>

            <section className="relative overflow-hidden rounded-[2rem] border border-white/20 bg-[linear-gradient(135deg,rgba(0,82,255,0.97),rgba(10,132,255,0.92)_45%,rgba(15,118,110,0.92))] p-4 text-white shadow-[0_24px_60px_rgba(0,82,255,0.22)] sm:p-5">
              <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.1),transparent_28%)]" />
              <div className="relative z-10 space-y-4">
                <div className={`flex items-center gap-3 text-white/[0.92] ${isArabic ? "flex-row-reverse" : ""}`}>
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.18] shadow-sm">
                    <ScanLine size={24} />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-white/[0.72]">{t("queue.checkInReadyToScan")}</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-[1.65rem]">
                      {state.mode === "loading" ? t("queue.checkInScanning") : t("queue.checkInReady")}
                    </h2>
                  </div>
                </div>

                <p className="text-sm leading-6 text-white/[0.88]">
                  {state.mode === "idle" && subtitle}
                  {state.mode === "loading" && t("queue.checkInScanningHint")}
                  {state.mode === "success" && t("queue.checkInSuccessMessage")}
                  {state.mode === "error" && t("queue.checkInErrorMessage")}
                </p>

                <div className={`grid gap-3 ${state.mode === "idle" ? "sm:grid-cols-[1.1fr_0.9fr]" : ""}`}>
                  <div
                    className={`rounded-[1.5rem] border border-white/[0.16] px-4 py-4 ${
                      state.mode === "error"
                        ? "bg-rose-500/10"
                        : state.mode === "success"
                          ? "bg-emerald-500/10"
                          : "bg-white/[0.10]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.22em] text-white/[0.72]">
                          {state.mode === "error" ? t("queue.checkInErrorTitle") : t("queue.checkInLiveStatus")}
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          {state.mode === "error"
                            ? t("queue.checkInAskReception")
                            : state.mode === "success"
                              ? t("queue.checkInSuccessShort")
                              : t("queue.checkInScanHere")}
                        </p>
                      </div>
                      {state.mode === "error" ? (
                        <TriangleAlert size={24} className="text-rose-100" />
                      ) : state.mode === "success" ? (
                        <BadgeCheck size={24} className="text-emerald-100" />
                      ) : (
                        <Waves size={24} className="text-white/[0.8]" />
                      )}
                    </div>

                    <p className="mt-3 text-sm leading-6 text-white/[0.88]">
                      {state.mode === "error"
                        ? state.message
                        : state.mode === "success"
                          ? (state.entry
                              ? `${chooseLocalized(language, state.entry.modalityNameAr, state.entry.modalityNameEn)} • ${chooseLocalized(language, state.entry.examNameAr, state.entry.examNameEn) || t("common.na")}`
                              : t("queue.checkInSuccessMessage"))
                          : t("queue.checkInIdleHint")}
                    </p>
                  </div>

                  <div className={`rounded-[1.5rem] border border-white/[0.16] px-4 py-4 ${state.mode === "idle" ? "bg-white/[0.08]" : "bg-white/[0.10]"}`}>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-white/[0.72]">
                      {t("queue.lastUpdated")}
                    </p>
                    <p className="mt-1 text-base font-semibold">{lastUpdatedText}</p>
                    <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/[0.10] px-3 py-2 text-sm">
                      <Sparkles className="h-4 w-4" />
                      <span>{statusText}</span>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="sr-only">
                  <label htmlFor="queue-check-in-scan" className="sr-only">
                    {t("queue.checkInScanHere")}
                  </label>
                  <Input
                    id="queue-check-in-scan"
                    ref={inputRef}
                    value={scanValue}
                    onChange={(event) => setScanValue(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="none"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="h-px w-px border-0 p-0 opacity-0 pointer-events-none"
                  />
                </form>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    onClick={handleResetNow}
                    className="rounded-full border border-white/[0.18] bg-white/[0.10] px-6 text-white hover:bg-white/[0.18]"
                  >
                    <RefreshCw className="h-5 w-5" />
                    <span>{t("queue.checkInResetNow")}</span>
                  </Button>
                </div>
              </div>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className={`mb-3 h-2 w-12 rounded-full ${accent}`} />
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
  );
}
