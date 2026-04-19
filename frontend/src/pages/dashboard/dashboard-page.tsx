import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchQueueSnapshot, fetchAppointmentLookups, fetchStatistics } from "@/lib/api-hooks";
import { buildDashboardViewModel, type DashboardTone } from "@/lib/dashboard-view-model";
import { formatDateTimeLy, todayIsoDateLy } from "@/lib/date-format";
import { PageContainer } from "@/components/layout/page-container";
import { Button, Card, Badge, SectionLabel } from "@/components/shared";
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

/* --- Stat Card --- */
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
  const toneColors: Record<DashboardTone, { color: string }> = {
    default: { color: "var(--foreground)" },
    good: { color: "var(--green)" },
    warn: { color: "var(--amber)" },
    alert: { color: "#ef4444" }
  };

  const { color } = toneColors[tone];

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-1">{label}</p>
          <p className="text-3xl font-bold" style={{ color }}>{value}</p>
          {subValue && (
            <p className="mt-2 text-sm text-muted-foreground">{subValue}</p>
          )}
        </div>
        <div className="icon-housing icon-housing--md">
          {icon}
        </div>
      </div>
    </Card>
  );
}

/* --- Widget Module --- */
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
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-[0.15em] font-mono text-muted-foreground">{title}</h3>
        {stale && (
          <Badge variant="warning" size="sm">
            {staleLabel}
          </Badge>
        )}
      </div>
      <div className="p-6">{children}</div>
    </Card>
  );
}

/* --- Skeleton Block --- */
function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg ${className}`} style={{ backgroundColor: "var(--muted)" }} />;
}

/* --- Action Link --- */
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
  const accentBorder = tone === "good" ? "rgba(34,197,94,0.3)" : tone === "warn" ? "rgba(245,158,11,0.3)" : tone === "alert" ? "rgba(239,68,68,0.3)" : "var(--border)";
  const accentBg = tone === "good" ? "rgba(34,197,94,0.05)" : tone === "warn" ? "rgba(245,158,11,0.05)" : tone === "alert" ? "rgba(239,68,68,0.05)" : "transparent";
  const textColor = tone === "good" ? "var(--green)" : tone === "warn" ? "var(--amber)" : tone === "alert" ? "#ef4444" : "var(--foreground)";

  return (
    <Link
      to={to}
      className="w-full px-4 py-3 rounded-xl text-center text-sm font-medium transition-all duration-200 flex items-center justify-between group border hover:shadow-md hover:-translate-y-0.5"
      style={{
        backgroundColor: accentBg,
        borderColor: accentBorder,
        color: textColor
      }}
    >
      <span>{label}</span>
      <Icon className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1 text-muted-foreground" />
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
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-4">
                <SectionLabel pulsing>DASHBOARD</SectionLabel>
              </div>
              <h1 className="text-3xl font-display mt-2" style={{ color: "var(--foreground)" }}>
                Welcome, <span className="gradient-text">{user?.fullName ?? ""}</span>
              </h1>
              <p className="mt-2 text-muted-foreground">{t("dashboard.subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="neutral" size="sm" className="flex items-center gap-2">
                <Clock className="w-3 h-3" />
                {t("dashboard.tripoliTime", { time: formatDateTimeLy(now) })}
              </Badge>
              <Badge
                variant={user?.role === "supervisor" ? "accent" : "success"}
                size="sm"
              >
                {user?.role === "supervisor" ? t("shell.supervisorMode") : t("shell.receptionMode")}
              </Badge>
              <Button
                onClick={handleRefresh}
                disabled={isRefreshing}
                variant="secondary"
                size="sm"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? t("common.refreshing") : t("common.refreshNow")}
              </Button>
            </div>
          </div>
        </div>

        {/* Stale data warning */}
        {(queueStale || statisticsStale || lookupsStale) && (
          <Card className="p-4 border-amber-200" style={{ background: "rgba(245, 158, 11, 0.05)" }}>
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-700">{t("dashboard.staleData")}</p>
            </div>
          </Card>
        )}

        {/* No-show review notice */}
        {!queueQuery.data?.reviewActive && queueQuery.data?.reviewTime && (
          <Card className="p-4 border-blue-200" style={{ background: "rgba(59, 130, 246, 0.05)" }}>
            <p className="text-sm text-blue-700 text-center font-medium">
              {t("dashboard.noShowOpens", { time: queueQuery.data.reviewTime })}
            </p>
          </Card>
        )}

        {/* Data freshness strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: t("dashboard.queueUpdated"), updatedAt: queueQuery.dataUpdatedAt },
            { label: t("dashboard.statsUpdated"), updatedAt: statisticsQuery.dataUpdatedAt },
            { label: t("dashboard.lookupsUpdated"), updatedAt: lookupsQuery.dataUpdatedAt }
          ].map((item, i) => (
             <Card key={i} className="p-4 flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground">{item.label}</span>
               <span className="font-medium">{item.updatedAt ? formatDateTimeLy(new Date(item.updatedAt)) : t("common.na")}</span>
             </Card>
          ))}
        </div>

        {/* Stat Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
          <StatCard
            label={t("dashboard.totalAppointments")}
            value={statisticsQuery.isLoading && !statisticsQuery.data ? "..." : viewModel.kpis.totalAppointments}
            icon={<Settings2 size={20} />}
            tone="default"
          />
          <StatCard
            label={t("dashboard.arrivedInQueue")}
            value={`${viewModel.kpis.arrivedCount} / ${viewModel.kpis.inQueueCount}`}
            icon={<Users size={20} />}
            subValue={t("dashboard.waiting", { count: viewModel.kpis.waitingCount })}
            tone={viewModel.tones.inQueue}
          />
          <StatCard
            label={t("dashboard.completedToday")}
            value={viewModel.kpis.completedCount}
            icon={<CheckCircle2 size={20} />}
            subValue={completionRatioLabel}
            tone={viewModel.tones.completion}
          />
          <StatCard
            label={t("dashboard.noShowCount")}
            value={viewModel.kpis.noShowCount}
            icon={<UserX size={20} />}
            tone={viewModel.tones.noShow}
          />
          <StatCard
            label={t("dashboard.walkInCount")}
            value={viewModel.kpis.walkInCount}
            icon={<Footprints size={20} />}
            tone="default"
          />
          <StatCard
            label={t("dashboard.activeModalities")}
            value={lookupsQuery.isLoading && !lookupsQuery.data ? "..." : viewModel.kpis.activeModalities}
            icon={<Activity size={20} />}
            tone="default"
          />
        </div>

        {/* Error state */}
        {!hasAnyData && (queueQuery.isError || statisticsQuery.isError || lookupsQuery.isError) && (
          <Card className="p-6 border-red-200" style={{ background: "rgba(239, 68, 68, 0.05)" }}>
            <div className="flex items-center gap-3 justify-center">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <p className="text-sm text-red-700">{t("dashboard.unableAll")}</p>
            </div>
          </Card>
        )}

        {/* Widget Row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Status Distribution */}
          <WidgetShell title={t("dashboard.statusDistribution")} stale={statisticsStale} staleLabel={t("common.staleData")}>
            {statisticsQuery.isLoading && !statisticsQuery.data ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonBlock key={i} className="h-8" />
                ))}
              </div>
            ) : statisticsQuery.isError && !statisticsQuery.data ? (
              <p className="text-sm text-center text-red-500">{t("dashboard.unableStatus")}</p>
            ) : (
              <ul className="space-y-3">
                {viewModel.statuses.map((row) => (
                  <li key={row.status} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{statusLabel(language, row.status)}</span>
                    <span className="font-bold text-lg">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </WidgetShell>

          {/* Queue Health */}
          <WidgetShell title={t("dashboard.queueHealth")} stale={queueStale} staleLabel={t("common.staleData")}>
            {queueQuery.isLoading && !queueQuery.data ? (
              <div className="space-y-3">
                <SkeletonBlock className="h-8" />
                <SkeletonBlock className="h-8" />
                <SkeletonBlock className="h-8" />
              </div>
            ) : queueQuery.isError && !queueQuery.data ? (
              <p className="text-sm text-center text-red-500">{t("dashboard.unableQueue")}</p>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{statusLabel(language, "waiting")}</span>
                  <span className="font-bold text-lg">{viewModel.kpis.waitingCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("dashboard.noShow")}</span>
                  <span className={`font-bold text-lg ${viewModel.queueHealth.reviewActive ? "text-green-600" : "text-amber-600"}`}>
                    {viewModel.queueHealth.reviewActive ? t("dashboard.reviewActive") : t("dashboard.reviewOpens", { time: viewModel.queueHealth.reviewTime })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("dashboard.candidates")}</span>
                  <span className="font-bold text-lg">{viewModel.queueHealth.noShowCandidates}</span>
                </div>
              </div>
            )}
          </WidgetShell>

          {/* Action Hub */}
          <WidgetShell title={t("dashboard.actionHub")} stale={false} staleLabel={t("common.staleData")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
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
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-10" />
              ))}
            </div>
          ) : statisticsQuery.isError && !statisticsQuery.data ? (
            <p className="text-sm text-center text-red-500">{t("dashboard.unableThroughput")}</p>
          ) : viewModel.modalities.length === 0 ? (
            <div className="text-sm text-center">
              {t("dashboard.noAppointmentsYet")}{" "}
              <Link to="/appointments" className="font-semibold text-accent hover:underline">
                {t("dashboard.createFirstAppointment")}
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-start py-3 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t("dashboard.modality")}</th>
                    <th className="text-start py-3 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t("dashboard.total")}</th>
                    <th className="text-start py-3 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t("dashboard.inQueue")}</th>
                    <th className="text-start py-3 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t("dashboard.completed")}</th>
                    <th className="text-start py-3 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t("dashboard.noShow")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {viewModel.modalities.map((row) => (
                    <tr key={row.modalityId} className="hover:bg-muted/50 transition-colors">
                      <td className="py-3 font-semibold">
                        {chooseLocalized(language, row.modalityNameAr, row.modalityNameEn)}
                      </td>
                      <td className="py-3">{row.totalCount}</td>
                      <td className="py-3">{row.inQueueCount}</td>
                      <td className="py-3">{row.completedCount}</td>
                      <td className="py-3">{row.noShowCount}</td>
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
