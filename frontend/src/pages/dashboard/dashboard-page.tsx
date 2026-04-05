import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchQueueSnapshot, fetchAppointmentLookups, fetchStatistics } from "@/lib/api-hooks";
import { buildDashboardViewModel, type DashboardTone } from "@/lib/dashboard-view-model";
import { formatDateTimeLy, todayIsoDateLy } from "@/lib/date-format";
import { PageContainer } from "@/components/layout/page-container";
import { useAuth } from "@/providers/auth-provider";

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
    default: "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700",
    good: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
    warn: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
    alert: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
  };

  const valueColors = {
    default: "text-stone-900 dark:text-white",
    good: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
    alert: "text-red-700 dark:text-red-400"
  };

  return (
    <div className={`rounded-2xl p-5 border shadow-sm ${toneStyles[tone]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-stone-500 dark:text-stone-400">
            {label}
          </p>
          <p className={`mt-2 text-3xl font-bold ${valueColors[tone]}`}>
            {value}
          </p>
          {subValue && (
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{subValue}</p>
          )}
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
  children
}: {
  title: string;
  stale?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
        <h3 className="font-semibold text-stone-900 dark:text-white">{title}</h3>
        {stale && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
            Stale data
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
    viewModel.kpis.totalAppointments > 0 ? `${Math.round(viewModel.kpis.completionRatio * 100)}% completion` : "No volume yet";

  return (
    <PageContainer>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
              Welcome, {user?.fullName}
            </h2>
            <p className="text-stone-500 dark:text-stone-400 mt-1">
              Reception operations overview for today
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-700 text-xs text-stone-700 dark:text-stone-300">
              Tripoli time: {formatDateTimeLy(now)}
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 text-xs font-medium text-teal-700 dark:text-teal-300">
              {user?.role === "supervisor" ? "Supervisor Mode" : "Reception Mode"}
            </span>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-medium transition-colors"
            >
              {isRefreshing ? "Refreshing..." : "Refresh now"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-stone-200 dark:border-stone-700 p-3 bg-white dark:bg-stone-800">
            <span className="text-stone-500 dark:text-stone-400">Queue updated:</span>{" "}
            <span className="text-stone-900 dark:text-white font-medium">
              {queueQuery.dataUpdatedAt ? formatDateTimeLy(new Date(queueQuery.dataUpdatedAt)) : "—"}
            </span>
          </div>
          <div className="rounded-xl border border-stone-200 dark:border-stone-700 p-3 bg-white dark:bg-stone-800">
            <span className="text-stone-500 dark:text-stone-400">Statistics updated:</span>{" "}
            <span className="text-stone-900 dark:text-white font-medium">
              {statisticsQuery.dataUpdatedAt ? formatDateTimeLy(new Date(statisticsQuery.dataUpdatedAt)) : "—"}
            </span>
          </div>
          <div className="rounded-xl border border-stone-200 dark:border-stone-700 p-3 bg-white dark:bg-stone-800">
            <span className="text-stone-500 dark:text-stone-400">Lookups updated:</span>{" "}
            <span className="text-stone-900 dark:text-white font-medium">
              {lookupsQuery.dataUpdatedAt ? formatDateTimeLy(new Date(lookupsQuery.dataUpdatedAt)) : "—"}
            </span>
          </div>
        </div>

        {(queueStale || statisticsStale || lookupsStale) && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
            Some widgets are showing cached data because the latest refresh failed.
          </div>
        )}

        {!queueQuery.data?.reviewActive && queueQuery.data?.reviewTime && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-300">
            No-show review opens at {queueQuery.data.reviewTime} (Tripoli time).
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
          <StatCard
            label="Total Appointments"
            value={statisticsQuery.isLoading && !statisticsQuery.data ? "..." : viewModel.kpis.totalAppointments}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            }
            tone="default"
          />
          <StatCard
            label="Arrived / In Queue"
            value={`${viewModel.kpis.arrivedCount} / ${viewModel.kpis.inQueueCount}`}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            subValue={`Waiting: ${viewModel.kpis.waitingCount}`}
            tone={viewModel.tones.inQueue}
          />
          <StatCard
            label="Completed Today"
            value={viewModel.kpis.completedCount}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            }
            subValue={completionRatioLabel}
            tone={viewModel.tones.completion}
          />
          <StatCard
            label="No-Show Count"
            value={viewModel.kpis.noShowCount}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
            tone={viewModel.tones.noShow}
          />
          <StatCard
            label="Walk-In Count"
            value={viewModel.kpis.walkInCount}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4H2v16h5m10 0v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2m12 0H7m10-10a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            }
            tone="default"
          />
          <StatCard
            label="Active Modalities"
            value={lookupsQuery.isLoading && !lookupsQuery.data ? "..." : viewModel.kpis.activeModalities}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
            tone="default"
          />
        </div>

        {!hasAnyData && (queueQuery.isError || statisticsQuery.isError || lookupsQuery.isError) && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
            Failed to load dashboard data. Use “Refresh now” to retry.
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <WidgetShell title="Status Distribution" stale={statisticsStale}>
            {statisticsQuery.isLoading && !statisticsQuery.data ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonBlock key={i} className="h-7" />
                ))}
              </div>
            ) : statisticsQuery.isError && !statisticsQuery.data ? (
              <p className="text-sm text-red-600 dark:text-red-400">Unable to load status distribution.</p>
            ) : (
              <ul className="space-y-2">
                {viewModel.statuses.map((row) => (
                  <li key={row.status} className="flex items-center justify-between text-sm">
                    <span className="text-stone-600 dark:text-stone-300 capitalize">{row.status}</span>
                    <span className="font-semibold text-stone-900 dark:text-white">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetShell>

          <WidgetShell title="Queue Health" stale={queueStale}>
            {queueQuery.isLoading && !queueQuery.data ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-7" />
                <SkeletonBlock className="h-7" />
                <SkeletonBlock className="h-7" />
              </div>
            ) : queueQuery.isError && !queueQuery.data ? (
              <p className="text-sm text-red-600 dark:text-red-400">Unable to load queue health.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-500 dark:text-stone-400">Waiting now</span>
                  <span className="font-semibold text-stone-900 dark:text-white">{viewModel.kpis.waitingCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500 dark:text-stone-400">No-show review</span>
                  <span className={`font-semibold ${viewModel.queueHealth.reviewActive ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {viewModel.queueHealth.reviewActive ? "Active" : `Opens ${viewModel.queueHealth.reviewTime}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500 dark:text-stone-400">Candidates</span>
                  <span className="font-semibold text-stone-900 dark:text-white">{viewModel.queueHealth.noShowCandidates}</span>
                </div>
              </div>
            )}
          </WidgetShell>

          <WidgetShell title="Reception Action Hub" stale={false}>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
              <ActionLink to="/patients" label="Register Patient" tone="default" />
              <ActionLink to="/appointments" label="Create Appointment" tone="default" />
              <ActionLink to="/queue" label="Queue Scan & Arrival" tone="good" />
              <ActionLink to="/registrations" label="Registrations" tone="default" />
              {viewModel.queueHealth.reviewActive && (
                <ActionLink
                  to="/queue"
                  label={`No-show Review (${viewModel.queueHealth.noShowCandidates})`}
                  tone={viewModel.queueHealth.noShowCandidates > 0 ? "warn" : "default"}
                />
              )}
            </div>
          </WidgetShell>
        </div>

        <WidgetShell title="Modality Throughput" stale={statisticsStale}>
          {statisticsQuery.isLoading && !statisticsQuery.data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-8" />
              ))}
            </div>
          ) : statisticsQuery.isError && !statisticsQuery.data ? (
            <p className="text-sm text-red-600 dark:text-red-400">Unable to load modality throughput.</p>
          ) : viewModel.modalities.length === 0 ? (
            <div className="text-sm text-stone-500 dark:text-stone-400">
              No appointments yet today.{" "}
              <Link to="/appointments" className="text-teal-600 dark:text-teal-400 hover:underline">
                Create the first appointment.
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-stone-500 dark:text-stone-400">
                  <tr>
                    <th className="text-right py-2">Modality</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-right py-2">In Queue</th>
                    <th className="text-right py-2">Completed</th>
                    <th className="text-right py-2">No-show</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                  {viewModel.modalities.map((row) => (
                    <tr key={row.modalityId}>
                      <td className="py-2 text-stone-900 dark:text-white font-medium">{row.modalityNameEn}</td>
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
    <Link
      to={to}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${styles[tone]}`}
    >
      {label}
    </Link>
  );
}
