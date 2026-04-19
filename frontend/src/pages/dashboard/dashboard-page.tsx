import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchQueueSnapshot, fetchAppointmentLookups, fetchStatistics } from "@/lib/api-hooks";
import { buildDashboardViewModel, type DashboardTone } from "@/lib/dashboard-view-model";
import { formatDateTimeLy, todayIsoDateLy } from "@/lib/date-format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/shared/Button";
import { Card } from "@/components/shared/Card";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import {
  Activity,
  Users,
  CheckCircle2,
  UserX,
  Footprints,
  Settings2,
  RefreshCw,
  ArrowRight,
  Clock,
  AlertTriangle
} from "lucide-react";



/* --- Stat Card (neumorphic with LED) --- */
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
  const valueColor = tone === "good" ? "text-green-700" : tone === "warn" ? "text-amber-700" : tone === "alert" ? "text-red-700" : "";

  return (
    <Card variant="elevated" className="p-4 relative">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[10px] uppercase tracking-[0.12em] font-mono-data" style={{ color: "var(--text-muted)" }}>{label}</p>
          </div>
          <p className={`text-2xl font-bold text-embossed ${valueColor}`}>{value}</p>
          {subValue && (
            <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>{subValue}</p>
          )}
        </div>
        <div className="icon-housing icon-housing--sm text-[var(--text-muted)]">
          {icon}
        </div>
       </div>
     </Card>
   );
 }

 /* --- Widget Module (bolted panel) --- */
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
    <Card className="relative overflow-hidden">
      <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-embossed" style={{ color: "var(--text)" }}>{title}</h3>
        {stale && (
          <span className="pill-soft text-[9px]" style={{ backgroundColor: "rgba(245, 158, 11, 0.15)", color: "var(--amber)", borderColor: "rgba(245, 158, 11, 0.3)" }}>
            {staleLabel}
          </span>
        )}
      </div>
       <div className="p-4">{children}</div>
     </Card>
   );
 }

/* --- Skeleton Block --- */
function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md ${className}`} style={{ backgroundColor: "var(--muted)" }} />;
}

/* --- Action Link (neumorphic button) --- */
function ActionLink({
  to,
  label,
  tone
}: {
  to: string;
  label: string;
  tone: DashboardTone;
}) {
  const iconMap: Record<DashboardTone, typeof Activity> = {
    default: ArrowRight,
    good: CheckCircle2,
    warn: AlertTriangle,
    alert: AlertTriangle
  };
  const Icon = iconMap[tone];
  const accentBorder = tone === "good" ? "rgba(34,197,94,0.3)" : tone === "warn" ? "rgba(245,158,11,0.3)" : tone === "alert" ? "rgba(255,71,87,0.3)" : "var(--border)";
  const accentBg = tone === "good" ? "rgba(34,197,94,0.08)" : tone === "warn" ? "rgba(245,158,11,0.08)" : tone === "alert" ? "rgba(255,71,87,0.08)" : "transparent";

  return (
    <Link
      to={to}
      className="w-full px-4 py-3 rounded-lg text-center text-sm font-semibold tracking-wide transition-all duration-150 flex items-center justify-between group border"
      style={{
        backgroundColor: accentBg,
        borderColor: accentBorder,
        boxShadow: "var(--shadow-card)",
        color: "var(--text)"
      }}
    >
      <span>{label}</span>
      <Icon className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" style={{ color: "var(--text-muted)" }} />
    </Link>
  );
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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-embossed" style={{ color: "var(--text)" }}>
              {t("dashboard.welcome", { name: user?.fullName ?? "" })}
            </h2>
            <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>{t("dashboard.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill-soft text-[10px] font-mono-data">
              <Clock className="w-3 h-3" />
              {t("dashboard.tripoliTime", { time: formatDateTimeLy(now) })}
            </span>
            <span
              className="pill-soft text-[10px]"
              style={{
                backgroundColor: user?.role === "supervisor" ? "rgba(255,71,87,0.1)" : "rgba(34,197,94,0.1)",
                color: user?.role === "supervisor" ? "var(--accent)" : "var(--green)",
                borderColor: user?.role === "supervisor" ? "rgba(255,71,87,0.3)" : "rgba(34,197,94,0.3)"
              }}
            >
              {user?.role === "supervisor" ? t("shell.supervisorMode") : t("shell.receptionMode")}
            </span>
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-xs"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? t("common.refreshing") : t("common.refreshNow")}
            </Button>
          </div>
        </div>

        {/* Stale data warning */}
        {(queueStale || statisticsStale || lookupsStale) && (
          <div className="rounded-lg border p-3 text-xs font-mono-data flex items-center gap-2" style={{
            backgroundColor: "rgba(245, 158, 11, 0.08)",
            borderColor: "rgba(245, 158, 11, 0.3)",
            color: "var(--amber)"
          }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {t("dashboard.staleData")}
          </div>
        )}

        {/* No-show review notice */}
        {!queueQuery.data?.reviewActive && queueQuery.data?.reviewTime && (
          <div className="rounded-lg border p-3 text-xs font-mono-data text-center" style={{
            backgroundColor: "rgba(59, 130, 246, 0.08)",
            borderColor: "rgba(59, 130, 246, 0.3)",
            color: "var(--blue)"
          }}>
            {t("dashboard.noShowOpens", { time: queueQuery.data.reviewTime })}
          </div>
        )}

        {/* Data freshness strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[10px] font-mono-data">
          {[
            { label: t("dashboard.queueUpdated"), updatedAt: queueQuery.dataUpdatedAt },
            { label: t("dashboard.statsUpdated"), updatedAt: statisticsQuery.dataUpdatedAt },
            { label: t("dashboard.lookupsUpdated"), updatedAt: lookupsQuery.dataUpdatedAt }
          ].map((item, i) => (
             <Card key={i} className="p-3 flex items-center justify-between">
              <span style={{ color: "var(--text-muted)" }}>{item.label}</span>
               <span className="font-semibold">{item.updatedAt ? formatDateTimeLy(new Date(item.updatedAt)) : t("common.na")}</span>
             </Card>
          ))}
        </div>

        {/* Stat Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
          <StatCard
            label={t("dashboard.totalAppointments")}
            value={statisticsQuery.isLoading && !statisticsQuery.data ? "..." : viewModel.kpis.totalAppointments}
            icon={<Settings2 size={18} />}
            tone="default"
          />
          <StatCard
            label={t("dashboard.arrivedInQueue")}
            value={`${viewModel.kpis.arrivedCount} / ${viewModel.kpis.inQueueCount}`}
            icon={<Users size={18} />}
            subValue={t("dashboard.waiting", { count: viewModel.kpis.waitingCount })}
            tone={viewModel.tones.inQueue}
          />
          <StatCard
            label={t("dashboard.completedToday")}
            value={viewModel.kpis.completedCount}
            icon={<CheckCircle2 size={18} />}
            subValue={completionRatioLabel}
            tone={viewModel.tones.completion}
          />
          <StatCard
            label={t("dashboard.noShowCount")}
            value={viewModel.kpis.noShowCount}
            icon={<UserX size={18} />}
            tone={viewModel.tones.noShow}
          />
          <StatCard
            label={t("dashboard.walkInCount")}
            value={viewModel.kpis.walkInCount}
            icon={<Footprints size={18} />}
            tone="default"
          />
          <StatCard
            label={t("dashboard.activeModalities")}
            value={lookupsQuery.isLoading && !lookupsQuery.data ? "..." : viewModel.kpis.activeModalities}
            icon={<Activity size={18} />}
            tone="default"
          />
        </div>

        {/* Error state */}
        {!hasAnyData && (queueQuery.isError || statisticsQuery.isError || lookupsQuery.isError) && (
          <div className="rounded-lg border p-4 text-xs font-mono-data text-center flex items-center gap-2 justify-center" style={{
            backgroundColor: "rgba(255, 71, 87, 0.08)",
            borderColor: "rgba(255, 71, 87, 0.3)",
            color: "var(--accent)"
          }}>
            <AlertTriangle className="w-4 h-4" />
            {t("dashboard.unableAll")}
          </div>
        )}

        {/* Widget Row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Status Distribution */}
          <WidgetShell title={t("dashboard.statusDistribution")} stale={statisticsStale} staleLabel={t("common.staleData")}>
            {statisticsQuery.isLoading && !statisticsQuery.data ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonBlock key={i} className="h-7" />
                ))}
              </div>
            ) : statisticsQuery.isError && !statisticsQuery.data ? (
              <p className="text-xs font-mono-data text-center" style={{ color: "var(--accent)" }}>{t("dashboard.unableStatus")}</p>
            ) : (
              <ul className="space-y-2">
                {viewModel.statuses.map((row) => (
                  <li key={row.status} className="flex items-center justify-between text-xs font-mono-data">
                    <span style={{ color: "var(--text-muted)" }}>{statusLabel(language, row.status)}</span>
                    <span className="font-bold">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetShell>

          {/* Queue Health */}
          <WidgetShell title={t("dashboard.queueHealth")} stale={queueStale} staleLabel={t("common.staleData")}>
            {queueQuery.isLoading && !queueQuery.data ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-7" />
                <SkeletonBlock className="h-7" />
                <SkeletonBlock className="h-7" />
              </div>
            ) : queueQuery.isError && !queueQuery.data ? (
              <p className="text-xs font-mono-data text-center" style={{ color: "var(--accent)" }}>{t("dashboard.unableQueue")}</p>
            ) : (
              <div className="space-y-3 text-xs font-mono-data">
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>{statusLabel(language, "waiting")}</span>
                  <span className="font-bold">{viewModel.kpis.waitingCount}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>{t("dashboard.noShow")}</span>
                  <span className={`font-bold ${viewModel.queueHealth.reviewActive ? "text-green-700" : "text-amber-700"}`}>
                    {viewModel.queueHealth.reviewActive ? t("dashboard.reviewActive") : t("dashboard.reviewOpens", { time: viewModel.queueHealth.reviewTime })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>{t("dashboard.candidates")}</span>
                  <span className="font-bold">{viewModel.queueHealth.noShowCandidates}</span>
                </div>
              </div>
            )}
          </WidgetShell>

          {/* Action Hub */}
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

        {/* Modality Throughput */}
        <WidgetShell title={t("dashboard.modalityThroughput")} stale={statisticsStale} staleLabel={t("common.staleData")}>
          {statisticsQuery.isLoading && !statisticsQuery.data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-8" />
              ))}
            </div>
          ) : statisticsQuery.isError && !statisticsQuery.data ? (
            <p className="text-xs font-mono-data text-center" style={{ color: "var(--accent)" }}>{t("dashboard.unableThroughput")}</p>
          ) : viewModel.modalities.length === 0 ? (
            <div className="text-xs font-mono-data text-center">
              {t("dashboard.noAppointmentsYet")}{" "}
              <Link to="/appointments" className="font-semibold hover:underline" style={{ color: "var(--accent)" }}>
                {t("dashboard.createFirstAppointment")}
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono-data">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                    <th className="text-start py-2 font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>{t("dashboard.modality")}</th>
                    <th className="text-start py-2 font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>{t("dashboard.total")}</th>
                    <th className="text-start py-2 font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>{t("dashboard.inQueue")}</th>
                    <th className="text-start py-2 font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>{t("dashboard.completed")}</th>
                    <th className="text-start py-2 font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>{t("dashboard.noShow")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {viewModel.modalities.map((row) => (
                    <tr key={row.modalityId}>
                      <td className="py-2 font-semibold">
                        {chooseLocalized(language, row.modalityNameAr, row.modalityNameEn)}
                      </td>
                      <td className="py-2">{row.totalCount}</td>
                      <td className="py-2">{row.inQueueCount}</td>
                      <td className="py-2">{row.completedCount}</td>
                      <td className="py-2">{row.noShowCount}</td>
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
