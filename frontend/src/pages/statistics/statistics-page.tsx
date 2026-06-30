import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { fetchStatistics as fetchStats, fetchAppointmentLookups, recordReportOutput } from "@/lib/api-hooks";
import { formatDateLy, formatDateTimeLy, isoDateDaysFromNow, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { Select } from "@/components/common/select";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";
import { statusLabel, t } from "@/lib/i18n";
import { AlertTriangle, BarChart3, Download, ExternalLink, Printer, RefreshCw } from "lucide-react";
import type {
  AppointmentStatistics,
  AppointmentStatisticsDailyRow,
  AppointmentStatisticsModalityRow,
  AppointmentStatisticsStatusRow
} from "@/types/api";

type QuickRange = "today" | "yesterday" | "last7" | "last31" | "month" | "custom";

const STATUS_ORDER: Record<string, number> = {
  scheduled: 10,
  arrived: 20,
  waiting: 30,
  "in-progress": 40,
  completed: 50,
  "no-show": 60,
  cancelled: 70,
  discontinued: 80,
  voided: 90
};

const DRILLDOWN_WORKFLOW_STATUSES = [
  "scheduled",
  "arrived",
  "waiting",
  "in-progress",
  "completed",
  "no-show",
  "cancelled",
  "discontinued",
  "voided",
];

const MAX_RANGE_DAYS = 366;

function monthStartIso(today: string): string {
  return `${today.slice(0, 8)}01`;
}

function isoDateToUtcDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  if (Number.isNaN(time)) return null;
  if (new Date(time).toISOString().slice(0, 10) !== value) return null;
  return Math.floor(time / 86_400_000);
}

function validateRange(dateFrom: string, dateTo: string): "required" | "order" | "tooLarge" | null {
  const fromDay = isoDateToUtcDay(dateFrom);
  const toDay = isoDateToUtcDay(dateTo);
  if (fromDay == null || toDay == null) return "required";
  if (fromDay > toDay) return "order";
  if (toDay - fromDay + 1 > MAX_RANGE_DAYS) return "tooLarge";
  return null;
}

function rangeValidationMessageKey(reason: ReturnType<typeof validateRange>): Parameters<typeof t>[1] | null {
  if (reason === "required") return "statistics.rangeDatesRequired";
  if (reason === "order") return "statistics.rangeOrderInvalid";
  if (reason === "tooLarge") return "statistics.rangeTooLarge";
  return null;
}

function rangeForPreset(range: QuickRange): { dateFrom: string; dateTo: string } {
  const today = todayIsoDateLy();
  if (range === "yesterday") {
    const yesterday = isoDateDaysFromNow(-1);
    return { dateFrom: yesterday, dateTo: yesterday };
  }
  if (range === "last7") return { dateFrom: isoDateDaysFromNow(-6), dateTo: today };
  if (range === "last31") return { dateFrom: isoDateDaysFromNow(-30), dateTo: today };
  if (range === "month") return { dateFrom: monthStartIso(today), dateTo: today };
  return { dateFrom: today, dateTo: today };
}

function quickRangeForDates(dateFrom: string, dateTo: string): QuickRange {
  for (const range of ["today", "yesterday", "last7", "last31", "month"] as QuickRange[]) {
    const preset = rangeForPreset(range);
    if (preset.dateFrom === dateFrom && preset.dateTo === dateTo) return range;
  }
  return "custom";
}

function parseInitialStatisticsFilters(searchParams: URLSearchParams): { dateFrom: string; dateTo: string; modalityId: string; quickRange: QuickRange } {
  const today = rangeForPreset("today");
  const date = searchParams.get("date")?.trim() ?? "";
  const requestedDateFrom = searchParams.get("dateFrom")?.trim() ?? "";
  const requestedDateTo = searchParams.get("dateTo")?.trim() ?? "";
  const modalityId = searchParams.get("modalityId")?.trim() ?? "";
  const suppliedDateValues = [date, requestedDateFrom, requestedDateTo].filter(Boolean);

  if (suppliedDateValues.some((value) => isoDateToUtcDay(value) == null)) {
    return { ...today, modalityId: "", quickRange: "today" };
  }

  const dateFrom = date || requestedDateFrom || requestedDateTo || today.dateFrom;
  const dateTo = date || requestedDateTo || requestedDateFrom || dateFrom;
  if (validateRange(dateFrom, dateTo)) {
    return { ...today, modalityId: "", quickRange: "today" };
  }

  return {
    dateFrom,
    dateTo,
    modalityId: /^\d+$/.test(modalityId) && Number(modalityId) > 0 ? modalityId : "",
    quickRange: quickRangeForDates(dateFrom, dateTo),
  };
}

function sortStatusRows(rows: AppointmentStatisticsStatusRow[]): AppointmentStatisticsStatusRow[] {
  return [...rows].sort((a, b) => {
    const left = STATUS_ORDER[String(a.status)] ?? 999;
    const right = STATUS_ORDER[String(b.status)] ?? 999;
    return left - right || String(a.status).localeCompare(String(b.status));
  });
}

function maxCount(rows: Array<{ totalCount?: number; count?: number }>): number {
  return Math.max(1, ...rows.map((row) => row.totalCount ?? row.count ?? 0));
}

function BarCell({ value, max }: { value: number; max: number }) {
  const width = `${Math.max(4, Math.round((value / max) * 100))}%`;
  return (
    <div className="flex items-center justify-end gap-3">
      <div className="h-2 w-24 overflow-hidden rounded bg-[var(--muted)]">
        <div className="h-full rounded bg-[var(--accent)]" style={{ width }} />
      </div>
      <span className="min-w-10 text-right">{value}</span>
    </div>
  );
}

function formatRate(numerator: number | undefined, denominator: number | undefined): string {
  if (!denominator) return "â€”";
  return `${Math.round(((numerator ?? 0) / denominator) * 1000) / 10}%`;
}

function metricValue(stats: AppointmentStatistics | undefined, value: number | undefined, isInitialLoading: boolean, isInitialError: boolean) {
  if (!stats && (isInitialLoading || isInitialError)) return "—";
  return value ?? "—";
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1000);
}

function buildRegistrationsDrilldownUrl(options: {
  dateMode: "single" | "range";
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  modalityId?: string | number | null;
  statuses?: string[];
}): string {
  const params = new URLSearchParams();
  params.set("source", "statistics");
  params.set("dateMode", options.dateMode);
  if (options.dateMode === "single" && options.date) {
    params.set("date", options.date);
  }
  if (options.dateMode === "range") {
    if (options.dateFrom) params.set("dateFrom", options.dateFrom);
    if (options.dateTo) params.set("dateTo", options.dateTo);
  }
  if (options.modalityId) {
    params.set("modalityId", String(options.modalityId));
  }
  for (const status of options.statuses ?? []) {
    params.append("status", status);
  }
  return `/registrations?${params.toString()}`;
}

function DrilldownLink({ to }: { to: string }) {
  const { language } = useLanguage();
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-end gap-1 text-xs font-semibold text-accent hover:underline"
    >
      {t(language, "statistics.viewAppointments")}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

function OperationalMetricCard({
  label,
  value,
  helper,
  href,
}: {
  label: string;
  value: string | number;
  helper?: string;
  href?: string;
}) {
  return (
    <Card className="statistics-print-card p-4">
      <div className="flex h-full flex-col justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] font-mono text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold" style={{ color: "var(--text)" }}>{value}</p>
          {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
        </div>
        {href ? (
          <div className="statistics-print-hide">
            <DrilldownLink to={href} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export default function StatisticsPage() {
  const { language } = useLanguage();
  const [searchParams] = useSearchParams();
  const initialFilters = useMemo(() => parseInitialStatisticsFilters(searchParams), []);
  const [quickRange, setQuickRange] = useState<QuickRange>(initialFilters.quickRange);
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom);
  const [dateTo, setDateTo] = useState(initialFilters.dateTo);
  const [modalityId, setModalityId] = useState(initialFilters.modalityId);
  const rangeValidation = useMemo(() => validateRange(dateFrom, dateTo), [dateFrom, dateTo]);
  const rangeValidationMessage = rangeValidationMessageKey(rangeValidation);
  const hasValidRange = !rangeValidation;

  const lookupsQuery = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
    placeholderData: (previousData) => previousData
  });

  const statisticsQuery = useQuery({
    queryKey: ["statistics", dateFrom, dateTo, modalityId],
    queryFn: () => fetchStats({ dateFrom, dateTo }, modalityId),
    staleTime: 1000 * 30,
    enabled: hasValidRange
  });

  const stats = statisticsQuery.data;
  const isInitialLoading = statisticsQuery.isLoading && !stats;
  const isInitialError = statisticsQuery.isError && !stats;
  const isStale = (statisticsQuery.isError || statisticsQuery.isRefetchError) && !!stats;
  const statusBreakdown = useMemo(() => sortStatusRows(stats?.statusBreakdown ?? []), [stats?.statusBreakdown]);
  const modalityBreakdown: AppointmentStatisticsModalityRow[] = stats?.modalityBreakdown ?? [];
  const dailyBreakdown: AppointmentStatisticsDailyRow[] = stats?.dailyBreakdown ?? [];
  const statusMax = maxCount(statusBreakdown);
  const modalityMax = maxCount(modalityBreakdown);
  const dailyMax = maxCount(dailyBreakdown);
  const inProgressCount = statusBreakdown.find((row) => row.status === "in-progress")?.count ?? 0;
  const totalAppointments = stats?.summary.totalAppointments;
  const completionRate = formatRate(stats?.summary.completedCount, totalAppointments);
  const noShowRate = formatRate(stats?.summary.noShowCount, totalAppointments);
  const cancellationRate = formatRate(stats?.summary.cancelledCount, totalAppointments);
  const activeWorkloadCount = stats
    ? stats.summary.scheduledCount + stats.summary.inQueueCount + inProgressCount
    : undefined;
  const hasAggregateRows = Boolean(hasValidRange && stats && (
    statusBreakdown.length > 0 ||
    modalityBreakdown.length > 0 ||
    dailyBreakdown.length > 0 ||
    stats.summary.totalAppointments > 0
  ));

  const applyQuickRange = (range: QuickRange) => {
    setQuickRange(range);
    if (range === "custom") return;
    const next = rangeForPreset(range);
    setDateFrom(next.dateFrom);
    setDateTo(next.dateTo);
  };

  const auditOutput = async (outputType: "csv" | "print", rowCount: number) => {
    try {
      await recordReportOutput({
        reportTemplate: "statistics",
        outputType,
        filters: { dateFrom, dateTo, modalityId: modalityId || null },
        rowCount,
        includePhoneNumbers: false,
        includePatientIdentifiers: false
      });
    } catch {
      // Output should not fail just because audit logging is temporarily unavailable.
    }
  };

  const buildExportRows = (): Array<Record<string, unknown>> => {
    if (!stats) return [];
    return [
      { section: "summary", metric: "patient_registry_total_all_time", value: stats.summary.totalRegisteredPatients },
      { section: "summary", metric: "appointments_selected_period", value: stats.summary.totalAppointments },
      { section: "summary", metric: "unique_patients_selected_period", value: stats.summary.uniquePatients },
      { section: "summary", metric: "walk_in_selected_period", value: stats.summary.walkInCount },
      { section: "operational", metric: "completion_rate", value: completionRate },
      { section: "operational", metric: "no_show_rate", value: noShowRate },
      { section: "operational", metric: "cancellation_rate", value: cancellationRate },
      { section: "operational", metric: "in_queue_selected_period", value: stats.summary.inQueueCount },
      { section: "operational", metric: "active_workload_selected_period", value: activeWorkloadCount ?? 0 },
      ...statusBreakdown.map((row) => ({ section: "status", status: row.status, count: row.count })),
      ...modalityBreakdown.map((row) => ({
        section: "modality",
        modality: row.modalityNameEn,
        total: row.totalCount,
        scheduled: row.scheduledCount,
        in_queue: row.inQueueCount,
        completed: row.completedCount,
        no_show: row.noShowCount,
        cancelled: row.cancelledCount,
        discontinued: row.discontinuedCount
      })),
      ...dailyBreakdown.map((row) => ({
        section: "day",
        date: row.appointmentDate,
        total: row.totalCount,
        completed: row.completedCount,
        no_show: row.noShowCount,
        cancelled: row.cancelledCount,
        discontinued: row.discontinuedCount
      }))
    ];
  };

  const handleExportCsv = () => {
    if (!hasAggregateRows || !hasValidRange) return;
    const rows = buildExportRows();
    void auditOutput("csv", rows.length);
    downloadCsv(`rispro-statistics-${dateFrom}-to-${dateTo}.csv`, rows);
  };

  const handlePrint = () => {
    if (!hasAggregateRows || !hasValidRange) return;
    void auditOutput("print", buildExportRows().length);
    window.print();
  };

  return (
    <div className="statistics-page max-w-7xl mx-auto space-y-6">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .statistics-page, .statistics-page * { visibility: visible; }
          .statistics-page { position: absolute; inset: 0 auto auto 0; max-width: none !important; width: 100% !important; padding: 0 !important; color: #111827 !important; background: #ffffff !important; }
          .statistics-print-hide { display: none !important; }
          .statistics-print-card { break-inside: avoid; box-shadow: none !important; border-color: #d1d5db !important; }
          .statistics-table-scroll { overflow: visible !important; }
          .statistics-table-scroll table { min-width: 0 !important; font-size: 10px !important; }
        }
      `}</style>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-embossed" style={{ color: "var(--text)" }}>
              {t(language, "statistics.title")}
            </h2>
            <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
              {t(language, "statistics.selectedPeriod")}: {formatDateLy(dateFrom)} - {formatDateLy(dateTo)}
            </p>
          </div>
        </div>
        <div className="statistics-print-hide flex flex-wrap items-center gap-2">
          <Badge variant="neutral" size="sm">
            {t(language, "statistics.lastUpdated")}: {statisticsQuery.dataUpdatedAt ? formatDateTimeLy(new Date(statisticsQuery.dataUpdatedAt)) : "—"}
          </Badge>
          <Button type="button" variant="secondary" size="sm" onClick={() => void statisticsQuery.refetch()} disabled={!hasValidRange || statisticsQuery.isFetching}>
            <RefreshCw className={`w-4 h-4 ${statisticsQuery.isFetching ? "animate-spin" : ""}`} />
            {statisticsQuery.isFetching ? t(language, "statistics.refreshing") : t(language, "statistics.refresh")}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={handleExportCsv} disabled={!hasAggregateRows}>
            <Download className="w-4 h-4" />
            {t(language, "statistics.exportCsv")}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={handlePrint} disabled={!hasAggregateRows}>
            <Printer className="w-4 h-4" />
            {t(language, "statistics.print")}
          </Button>
        </div>
      </div>

      {isStale && (
        <Card className="p-4 border-amber-200" style={{ background: "rgba(245, 158, 11, 0.05)" }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-700">{t(language, "statistics.staleData")}</p>
          </div>
        </Card>
      )}

      <Card className="statistics-print-hide p-4">
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">
              {t(language, "statistics.quickRange")}
            </p>
            <div className="flex flex-wrap gap-2">
              {([
                ["today", "statistics.today"],
                ["yesterday", "statistics.yesterday"],
                ["last7", "statistics.last7Days"],
                ["last31", "statistics.last31Days"],
                ["month", "statistics.thisMonth"],
                ["custom", "statistics.customRange"]
              ] as Array<[QuickRange, Parameters<typeof t>[1]]>).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={quickRange === value ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => applyQuickRange(value)}
                >
                  {t(language, label)}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <DateInput
              label={t(language, "statistics.dateFrom")}
              value={dateFrom}
              onChange={(value) => {
                setQuickRange("custom");
                setDateFrom(value);
              }}
            />
            <DateInput
              label={t(language, "statistics.dateTo")}
              value={dateTo}
              onChange={(value) => {
                setQuickRange("custom");
                setDateTo(value);
              }}
            />
            <Select
              label={t(language, "statistics.modalityCol")}
              value={modalityId}
              onChange={setModalityId}
              options={[
                { value: "", label: t(language, "statistics.all") },
                ...(lookupsQuery.data?.modalities ?? []).map((m) => ({
                  value: m.id.toString(),
                  label: language === "ar" ? m.nameAr : m.nameEn
                }))
              ]}
            />
          </div>
        </div>
      </Card>

      <Card className="statistics-print-card p-4">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t(language, "statistics.scopeNote")}
        </p>
        {rangeValidationMessage && (
          <div className="mt-3 flex items-center gap-2 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{t(language, rangeValidationMessage)}</span>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="statistics-print-card p-5">
          <p className="text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">
            {t(language, "statistics.patientRegistryAllTime")}
          </p>
          <p className="text-3xl font-bold" style={{ color: "var(--text)" }}>
            {metricValue(stats, stats?.summary.totalRegisteredPatients, isInitialLoading, isInitialError)}
          </p>
        </Card>
        <Card className="statistics-print-card p-5">
          <p className="text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">
            {t(language, "statistics.appointmentsForPeriod")}
          </p>
          <p className="text-3xl font-bold" style={{ color: "var(--text)" }}>
            {metricValue(stats, stats?.summary.totalAppointments, isInitialLoading, isInitialError)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(language, "statistics.oncologyAppointments")}: {metricValue(stats, stats?.summary.oncologyAppointments, isInitialLoading, isInitialError)}
            {" · "}
            {t(language, "statistics.nonOncologyAppointments")}: {metricValue(stats, stats?.summary.nonOncologyAppointments, isInitialLoading, isInitialError)}
          </p>
        </Card>
        <Card className="statistics-print-card p-5">
          <p className="text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">
            {t(language, "statistics.oncologyPatientsAllTime")}
          </p>
          <p className="text-3xl font-bold" style={{ color: "var(--text)" }}>
            {metricValue(stats, stats?.summary.oncologyPatients, isInitialLoading, isInitialError)}
          </p>
        </Card>
        <Card className="statistics-print-card p-5">
          <p className="text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">
            {t(language, "statistics.nonOncologyPatientsAllTime")}
          </p>
          <p className="text-3xl font-bold" style={{ color: "var(--text)" }}>
            {metricValue(stats, stats?.summary.nonOncologyPatients, isInitialLoading, isInitialError)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(language, "statistics.uncategorizedPatientsAllTime")}: {metricValue(stats, stats?.summary.uncategorizedPatients, isInitialLoading, isInitialError)}
          </p>
        </Card>
      </div>

      {!rangeValidationMessage ? (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
              {t(language, "statistics.operationalExceptions")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(language, "statistics.operationalExceptionsHint")}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <OperationalMetricCard
              label={t(language, "statistics.completionRate")}
              value={stats ? completionRate : "â€”"}
              helper={stats && totalAppointments ? `${stats.summary.completedCount} / ${stats.summary.totalAppointments}` : undefined}
              href={stats?.summary.completedCount ? buildRegistrationsDrilldownUrl({
                dateMode: "range",
                dateFrom,
                dateTo,
                modalityId: modalityId || null,
                statuses: ["completed"],
              }) : undefined}
            />
            <OperationalMetricCard
              label={t(language, "statistics.noShowRate")}
              value={stats ? noShowRate : "â€”"}
              helper={stats && totalAppointments ? `${stats.summary.noShowCount} / ${stats.summary.totalAppointments}` : undefined}
              href={stats?.summary.noShowCount ? buildRegistrationsDrilldownUrl({
                dateMode: "range",
                dateFrom,
                dateTo,
                modalityId: modalityId || null,
                statuses: ["no-show"],
              }) : undefined}
            />
            <OperationalMetricCard
              label={t(language, "statistics.cancellationRate")}
              value={stats ? cancellationRate : "â€”"}
              helper={stats && totalAppointments ? `${stats.summary.cancelledCount} / ${stats.summary.totalAppointments}` : undefined}
              href={stats?.summary.cancelledCount ? buildRegistrationsDrilldownUrl({
                dateMode: "range",
                dateFrom,
                dateTo,
                modalityId: modalityId || null,
                statuses: ["cancelled"],
              }) : undefined}
            />
            <OperationalMetricCard
              label={t(language, "statistics.walkInSelectedPeriod")}
              value={metricValue(stats, stats?.summary.walkInCount, isInitialLoading, isInitialError)}
            />
            <OperationalMetricCard
              label={t(language, "statistics.inQueueSelectedPeriod")}
              value={metricValue(stats, stats?.summary.inQueueCount, isInitialLoading, isInitialError)}
            />
            <OperationalMetricCard
              label={t(language, "statistics.activeWorkloadSelectedPeriod")}
              value={metricValue(stats, activeWorkloadCount, isInitialLoading, isInitialError)}
              helper={stats ? t(language, "statistics.activeWorkloadHint") : undefined}
            />
          </div>
        </div>
      ) : null}

      {rangeValidationMessage ? (
        <Card className="statistics-print-card">
          <EmptyState message={t(language, rangeValidationMessage)} icon={<AlertTriangle size={28} />} />
        </Card>
      ) : isInitialLoading ? (
        <Card>
          <LoadingState message={t(language, "statistics.loading")} />
        </Card>
      ) : isInitialError ? (
        <Card>
          <ErrorState message={t(language, "statistics.error")} onRetry={() => void statisticsQuery.refetch()} />
        </Card>
      ) : stats && !hasAggregateRows ? (
        <Card>
          <EmptyState message={t(language, "statistics.noData")} />
        </Card>
      ) : (
        <>
          <Card className="statistics-print-card overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
                {t(language, "statistics.byStatus")}
              </h3>
              {stats?.metadata.generatedAt && (
                <span className="text-xs text-muted-foreground">
                  {t(language, "statistics.generatedAt")}: {formatDateTimeLy(stats.metadata.generatedAt)}
                </span>
              )}
            </div>
            <div className="statistics-table-scroll overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(language, "statistics.statusCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.countCol")}</TableHead>
                  <TableHead className="statistics-print-hide text-right">{t(language, "statistics.actionCol")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statusBreakdown.map((row) => {
                  const href = buildRegistrationsDrilldownUrl({
                    dateMode: "range",
                    dateFrom,
                    dateTo,
                    modalityId: modalityId || null,
                    statuses: [row.status],
                  });
                  return (
                    <TableRow key={row.status} className="hover:bg-[var(--muted)]/40">
                      <TableCell>{statusLabel(language, row.status)}</TableCell>
                      <TableCell className="text-right"><BarCell value={row.count} max={statusMax} /></TableCell>
                      <TableCell className="statistics-print-hide text-right"><DrilldownLink to={href} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </Card>

          <Card className="statistics-print-card overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
                {t(language, "statistics.byModality")}
              </h3>
            </div>
            <div className="statistics-table-scroll overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(language, "statistics.modalityCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.totalCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.scheduledCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.inQueueCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.completedCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.noShowCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.cancelledCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.discontinuedCol")}</TableHead>
                  <TableHead className="statistics-print-hide text-right">{t(language, "statistics.actionCol")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modalityBreakdown.map((row) => {
                  const href = buildRegistrationsDrilldownUrl({
                    dateMode: "range",
                    dateFrom,
                    dateTo,
                    modalityId: row.modalityId,
                    statuses: DRILLDOWN_WORKFLOW_STATUSES,
                  });
                  return (
                    <TableRow key={row.modalityId} className="hover:bg-[var(--muted)]/40">
                      <TableCell>{language === "ar" ? row.modalityNameAr : row.modalityNameEn}</TableCell>
                      <TableCell className="text-right"><BarCell value={row.totalCount} max={modalityMax} /></TableCell>
                      <TableCell className="text-right">{row.scheduledCount}</TableCell>
                      <TableCell className="text-right">{row.inQueueCount}</TableCell>
                      <TableCell className="text-right">{row.completedCount}</TableCell>
                      <TableCell className="text-right">{row.noShowCount}</TableCell>
                      <TableCell className="text-right">{row.cancelledCount}</TableCell>
                      <TableCell className="text-right">{row.discontinuedCount}</TableCell>
                      <TableCell className="statistics-print-hide text-right"><DrilldownLink to={href} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </Card>

          <Card className="statistics-print-card overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
                {t(language, "statistics.dailyBreakdown")}
              </h3>
            </div>
            <div className="statistics-table-scroll overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(language, "statistics.dateCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.totalCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.completedCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.noShowCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.cancelledCol")}</TableHead>
                  <TableHead className="text-right">{t(language, "statistics.discontinuedCol")}</TableHead>
                  <TableHead className="statistics-print-hide text-right">{t(language, "statistics.actionCol")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyBreakdown.map((row) => {
                  const href = buildRegistrationsDrilldownUrl({
                    dateMode: "single",
                    date: row.appointmentDate,
                    modalityId: modalityId || null,
                    statuses: DRILLDOWN_WORKFLOW_STATUSES,
                  });
                  return (
                    <TableRow key={row.appointmentDate} className="hover:bg-[var(--muted)]/40">
                      <TableCell>{formatDateLy(row.appointmentDate)}</TableCell>
                      <TableCell className="text-right"><BarCell value={row.totalCount} max={dailyMax} /></TableCell>
                      <TableCell className="text-right">{row.completedCount}</TableCell>
                      <TableCell className="text-right">{row.noShowCount}</TableCell>
                      <TableCell className="text-right">{row.cancelledCount}</TableCell>
                      <TableCell className="text-right">{row.discontinuedCount}</TableCell>
                      <TableCell className="statistics-print-hide text-right"><DrilldownLink to={href} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
