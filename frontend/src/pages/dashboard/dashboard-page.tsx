import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchQueueSnapshot, fetchAppointmentLookups, fetchStatistics } from "@/lib/api-hooks";
import { buildDashboardViewModel, type DashboardTone } from "@/lib/dashboard-view-model";
import { formatDateTimeLy, todayIsoDateLy } from "@/lib/date-format";
import { PageContainer } from "@/components/layout/page-container";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";

function StatCard({
  label,
  value,
  subValue,
  icon,
  tone = "default"
}: {
  label: string;
  value: string | number;
  subValue?: string;
  icon: React.ReactNode;
  tone?: DashboardTone;
}) {
  const toneStyles = {
    default: "card-shell",
    good: "rounded-2xl p-5 border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 shadow-sm",
    warn: "rounded-2xl p-5 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 shadow-sm",
    alert: "rounded-2xl p-5 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 shadow-sm"
  };

  const valueColors = {
    default: "text-stone-900 dark:text-white",
    good: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
    alert: "text-red-700 dark:text-red-400"
  };

  return (
    <div className={toneStyles[tone]}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-stone-500 dark:text-stone-400">{label}</p>
          <p className={`mt-2 text-3xl font-bold ${valueColors[tone]}`}>{value}</p>
          {subValue && <p className="mt-1 text-xs description-center">{subValue}</p>}
        </div>
        <div className="p-2 rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-500 dark:text-stone-300">
          {icon}
        </div>
      </div>
    </div>
  );
}

function WidgetShell({
  title,
  stale,
  staleLabel,
  children
}: {
  title: string;
  stale?: boolean;
  staleLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-shell overflow-hidden">
      <div className="p-4 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
        <h3 className="font-semibold text-stone-900 dark:text-white">{title}</h3>
        {stale && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
            {staleLabel}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-stone-200 dark:bg-stone-700 ${className}`} />;
}

export function DashboardPage() {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [today] = useState(() => todayIsoDateLy());
  const [now, setNow] = useState(() => new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const lookupsQuery = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
    placeholderData: (previousData) => previousData
  });

  const queueQuery = useQuery({
    queryKey: ["queue"],
    queryFn: fetchQueueSnapshot,
    staleTime: 1000 * 10,
    refetchInterval: 1000 * 10,
    placeholderData: (previousData) => previousData
  });

  const statisticsQuery = useQuery({
    queryKey: ["statistics", today, ""],
    queryFn: () => fetchStatistics(today, ""),
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60,
    placeholderData: (previousData) => previousData
  });

  const viewModel = useMemo(
    () => buildDashboardViewModel(queueQuery.data, statisticsQuery.data, lookupsQuery.data),
    [queueQuery.data, statisticsQuery.data, lookupsQuery.data]
  );

  const queueStale = queueQuery.isError && !!queueQuery.data;
  const statisticsStale = statisticsQuery.isError && !!statisticsQuery.data;
  const lookupsStale = lookupsQuery.isError && !!lookupsQuery.data;
  const hasAnyData = !!(queueQuery.data || statisticsQuery.data || lookupsQuery.data);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["queue"] }),
        queryClient.invalidateQueries({ queryKey: ["statistics"] }),
        queryClient.invalidateQueries({ queryKey: ["lookups"] })
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const completionRatioLabel =
    viewModel.kpis.totalAppointments > 0
      ? t("dashboard.completion", { percent: Math.round(viewModel.kpis.completionRatio * 100) })
      : t("dashboard.noVolume");

  return (
    <PageContainer>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
              {t("dashboard.welcome", { name: user?.fullName ?? "" })}
            </h2>
            <p className="description-center mt-1">{t("dashboard.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill-soft text-xs">
              {t("dashboard.tripoliTime", { time: formatDateTimeLy(now) })}
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-700 dark:text-teal-300">
              {user?.role === "supervisor" ? t("shell.supervisorMode") : t("shell.receptionMode")}
            </span>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="btn-primary text-xs"
            >
              {isRefreshing ? t("common.refreshing") : t("common.refreshNow")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="card-shell p-3">
            <span className="description-center">{t("dashboard.queueUpdated")}</span>{" "}
            <span className="text-stone-900 dark:text-white font-medium">
              {queueQuery.dataUpdatedAt ? formatDateTimeLy(new Date(queueQuery.dataUpdatedAt)) : t("common.na")}
            </span>
          </div>
          <div className="card-shell p-3">
            <span className="description-center">{t("dashboard.statsUpdated")}</span>{" "}
            <span className="text-stone-900 dark:text-white font-medium">
              {statisticsQuery.dataUpdatedAt ? formatDateTimeLy(new Date(statisticsQuery.dataUpdatedAt)) : t("common.na")}
            </span>
          </div>
          <div className="card-shell p-3">
            <span className="description-center">{t("dashboard.lookupsUpdated")}</span>{" "}
            <span className="text-stone-900 dark:text-white font-medium">
              {lookupsQuery.dataUpdatedAt ? formatDateTimeLy(new Date(lookupsQuery.dataUpdatedAt)) : t("common.na")}
            </span>
          </div>
        </div>

        {(queueStale || statisticsStale || lookupsStale) && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300 description-center">
            {t("dashboard.staleData")}
          </div>
        )}

        {!queueQuery.data?.reviewActive && queueQuery.data?.reviewTime && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-300 description-center">
            {t("dashboard.noShowOpens", { time: queueQuery.data.reviewTime })}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
          <StatCard
            label={t("dashboard.totalAppointments")}
            value={statisticsQuery.isLoading && !statisticsQuery.data ? "..." : viewModel.kpis.totalAppointments}
            icon={<span className="font-semibold">T</span>}
            tone="default"
          />
          <StatCard
            label={t("dashboard.arrivedInQueue")}
            value={`${viewModel.kpis.arrivedCount} / ${viewModel.kpis.inQueueCount}`}
            icon={<span className="font-semibold">Q</span>}
            subValue={t("dashboard.waiting", { count: viewModel.kpis.waitingCount })}
            tone={viewModel.tones.inQueue}
          />
          <StatCard
            label={t("dashboard.completedToday")}
            value={viewModel.kpis.completedCount}
            icon={<span className="font-semibold">C</span>}
            subValue={completionRatioLabel}
            tone={viewModel.tones.completion}
          />
          <StatCard
            label={t("dashboard.noShowCount")}
            value={viewModel.kpis.noShowCount}
            icon={<span className="font-semibold">N</span>}
            tone={viewModel.tones.noShow}
          />
          <StatCard
            label={t("dashboard.walkInCount")}
            value={viewModel.kpis.walkInCount}
            icon={<span className="font-semibold">W</span>}
            tone="default"
          />
          <StatCard
            label={t("dashboard.activeModalities")}
            value={lookupsQuery.isLoading && !lookupsQuery.data ? "..." : viewModel.kpis.activeModalities}
            icon={<span className="font-semibold">M</span>}
            tone="default"
          />
        </div>

        {!hasAnyData && (queueQuery.isError || statisticsQuery.isError || lookupsQuery.isError) && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400 description-center">
            {t("dashboard.unableAll")}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <WidgetShell title={t("dashboard.statusDistribution")} stale={statisticsStale} staleLabel={t("common.staleData")}>
            {statisticsQuery.isLoading && !statisticsQuery.data ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonBlock key={i} className="h-7" />
                ))}
              </div>
            ) : statisticsQuery.isError && !statisticsQuery.data ? (
              <p className="text-sm text-red-600 dark:text-red-400 description-center">{t("dashboard.unableStatus")}</p>
            ) : (
              <ul className="space-y-2">
                {viewModel.statuses.map((row) => (
                  <li key={row.status} className="flex items-center justify-between text-sm">
                    <span className="text-stone-600 dark:text-stone-300">{statusLabel(language, row.status)}</span>
                    <span className="font-semibold text-stone-900 dark:text-white">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetShell>

          <WidgetShell title={t("dashboard.queueHealth")} stale={queueStale} staleLabel={t("common.staleData")}>
            {queueQuery.isLoading && !queueQuery.data ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-7" />
                <SkeletonBlock className="h-7" />
                <SkeletonBlock className="h-7" />
              </div>
            ) : queueQuery.isError && !queueQuery.data ? (
              <p className="text-sm text-red-600 dark:text-red-400 description-center">{t("dashboard.unableQueue")}</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="description-center">{statusLabel(language, "waiting")}</span>
                  <span className="font-semibold text-stone-900 dark:text-white">{viewModel.kpis.waitingCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="description-center">{t("dashboard.noShow")}</span>
                  <span className={`font-semibold ${viewModel.queueHealth.reviewActive ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {viewModel.queueHealth.reviewActive ? t("dashboard.reviewActive") : t("dashboard.reviewOpens", { time: viewModel.queueHealth.reviewTime })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="description-center">{t("dashboard.candidates")}</span>
                  <span className="font-semibold text-stone-900 dark:text-white">{viewModel.queueHealth.noShowCandidates}</span>
                </div>
              </div>
            )}
          </WidgetShell>

          <WidgetShell title={t("dashboard.actionHub")} stale={false} staleLabel={t("common.staleData")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
              <ActionLink to="/patients" label={t("dashboard.registerPatient")} tone="default" />
              <ActionLink to="/appointments" label={t("dashboard.createAppointment")} tone="default" />
              <ActionLink to="/queue" label={t("dashboard.queueScanArrival")} tone="good" />
              <ActionLink to="/registrations" label={t("dashboard.registrations")} tone="default" />
              {viewModel.queueHealth.reviewActive && (
                <ActionLink
                  to="/queue"
                  label={t("dashboard.noShowReview", { count: viewModel.queueHealth.noShowCandidates })}
                  tone={viewModel.queueHealth.noShowCandidates > 0 ? "warn" : "default"}
                />
              )}
            </div>
          </WidgetShell>
        </div>

        <WidgetShell title={t("dashboard.modalityThroughput")} stale={statisticsStale} staleLabel={t("common.staleData")}>
          {statisticsQuery.isLoading && !statisticsQuery.data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-8" />
              ))}
            </div>
          ) : statisticsQuery.isError && !statisticsQuery.data ? (
            <p className="text-sm text-red-600 dark:text-red-400 description-center">{t("dashboard.unableThroughput")}</p>
          ) : viewModel.modalities.length === 0 ? (
            <div className="text-sm description-center">
              {t("dashboard.noAppointmentsYet")}{" "}
              <Link to="/appointments" className="text-teal-600 dark:text-teal-400 hover:underline">
                {t("dashboard.createFirstAppointment")}
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-stone-500 dark:text-stone-400">
                  <tr>
                    <th className="text-start py-2">{t("dashboard.modality")}</th>
                    <th className="text-start py-2">{t("dashboard.total")}</th>
                    <th className="text-start py-2">{t("dashboard.inQueue")}</th>
                    <th className="text-start py-2">{t("dashboard.completed")}</th>
                    <th className="text-start py-2">{t("dashboard.noShow")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                  {viewModel.modalities.map((row) => (
                    <tr key={row.modalityId}>
                      <td className="py-2 text-stone-900 dark:text-white font-medium">
                        {chooseLocalized(language, row.modalityNameAr, row.modalityNameEn)}
                      </td>
                      <td className="py-2 text-stone-700 dark:text-stone-300">{row.totalCount}</td>
                      <td className="py-2 text-stone-700 dark:text-stone-300">{row.inQueueCount}</td>
                      <td className="py-2 text-stone-700 dark:text-stone-300">{row.completedCount}</td>
                      <td className="py-2 text-stone-700 dark:text-stone-300">{row.noShowCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </WidgetShell>
      </div>
    </PageContainer>
  );
}

function ActionLink({
  to,
  label,
  tone
}: {
  to: string;
  label: string;
  tone: DashboardTone;
}) {
  const styles: Record<DashboardTone, string> = {
    default: "bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-600",
    good: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50",
    warn: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50",
    alert: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
  };

  return (
    <Link to={to} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${styles[tone]}`}>
      {label}
    </Link>
  );
}
