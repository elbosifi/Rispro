import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStatistics as fetchStats, fetchAppointmentLookups } from "@/lib/api-hooks";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { Select } from "@/components/common/select";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { BarChart3 } from "lucide-react";
import type {
  AppointmentStatisticsStatusRow,
  AppointmentStatisticsModalityRow,
  AppointmentStatisticsDailyRow
} from "@/types/api";

export default function StatisticsPage() {
  const { language } = useLanguage();
  const [date, setDate] = useState(todayIsoDateLy());
  const [modalityId, setModalityId] = useState("");

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const { data: stats } = useQuery({
    queryKey: ["statistics", date, modalityId],
    queryFn: () => fetchStats(date, modalityId),
    staleTime: 1000 * 30
  });

  const statusBreakdown: AppointmentStatisticsStatusRow[] = stats?.statusBreakdown ?? [];
  const modalityBreakdown: AppointmentStatisticsModalityRow[] = stats?.modalityBreakdown ?? [];
  const dailyBreakdown: AppointmentStatisticsDailyRow[] = stats?.dailyBreakdown ?? [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
          <BarChart3 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-embossed" style={{ color: "var(--text)" }}>
            {t(language, "statistics.title")}
          </h2>
          <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
            {t(language, "statistics.dailyTrend")}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card-shell relative p-4">
        {/* Corner screws */}
        <div className="absolute top-3 left-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />
        <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />
        <div className="absolute bottom-3 left-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />
        <div className="absolute bottom-3 right-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DateInput label={t(language, "statistics.dateCol")} value={date} onChange={setDate} />
          <Select
            label={t(language, "statistics.modalityCol")}
            value={modalityId}
            onChange={setModalityId}
            options={[
              { value: "", label: t(language, "statistics.all") },
              ...(lookups?.modalities ?? []).map((m) => ({
                value: m.id.toString(),
                label: m.nameEn
              }))
            ]}
          />
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="card-shell card-elevated overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="w-1 h-5 rounded-full" style={{ background: "var(--accent)" }} />
          <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
            {t(language, "statistics.byStatus")}
          </h3>
        </div>
        <table className="w-full text-xs font-mono-data">
          <thead style={{ color: "var(--text-muted)" }}>
            <tr className="uppercase tracking-[0.06em]">
              <th className="text-right p-3 border-b" style={{ borderColor: "var(--border)" }}>{t(language, "statistics.statusCol")}</th>
              <th className="text-right p-3 border-b" style={{ borderColor: "var(--border)" }}>{t(language, "statistics.countCol")}</th>
            </tr>
          </thead>
          <tbody className="divide-y" >
            {statusBreakdown.map((row) => (
              <tr key={row.status} className="hover:bg-[var(--foreground)] transition-colors">
                <td className="p-3" style={{ color: "var(--text)" }}>{row.status}</td>
                <td className="p-3 text-right" style={{ color: "var(--text-muted)" }}>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modality Breakdown */}
      <div className="card-shell card-elevated overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="w-1 h-5 rounded-full" style={{ background: "var(--accent)" }} />
          <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
            {t(language, "statistics.byModality")}
          </h3>
        </div>
        <table className="w-full text-xs font-mono-data">
          <thead style={{ color: "var(--text-muted)" }}>
            <tr className="uppercase tracking-[0.06em]">
              <th className="text-right p-3 border-b" style={{ borderColor: "var(--border)" }}>{t(language, "statistics.modalityCol")}</th>
              <th className="text-right p-3 border-b" style={{ borderColor: "var(--border)" }}>{t(language, "statistics.countCol")}</th>
            </tr>
          </thead>
          <tbody className="divide-y" >
            {modalityBreakdown.map((row) => (
              <tr key={row.modalityId} className="hover:bg-[var(--foreground)] transition-colors">
                <td className="p-3" style={{ color: "var(--text)" }}>{row.modalityNameEn}</td>
                <td className="p-3 text-right" style={{ color: "var(--text-muted)" }}>{row.totalCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Daily Breakdown */}
      <div className="card-shell card-elevated overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="w-1 h-5 rounded-full" style={{ background: "var(--accent)" }} />
          <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
            {t(language, "statistics.dailyTrend")}
          </h3>
        </div>
        <table className="w-full text-xs font-mono-data">
          <thead style={{ color: "var(--text-muted)" }}>
            <tr className="uppercase tracking-[0.06em]">
              <th className="text-right p-3 border-b" style={{ borderColor: "var(--border)" }}>{t(language, "statistics.dateCol")}</th>
              <th className="text-right p-3 border-b" style={{ borderColor: "var(--border)" }}>{t(language, "statistics.totalCol")}</th>
              <th className="text-right p-3 border-b" style={{ borderColor: "var(--border)" }}>{t(language, "status.completed")}</th>
              <th className="text-right p-3 border-b" style={{ borderColor: "var(--border)" }}>{t(language, "status.no-show")}</th>
            </tr>
          </thead>
          <tbody className="divide-y" >
            {dailyBreakdown.map((row) => (
              <tr key={row.appointmentDate} className="hover:bg-[var(--foreground)] transition-colors">
                <td className="p-3" style={{ color: "var(--text)" }}>{formatDateLy(row.appointmentDate)}</td>
                <td className="p-3 text-right" style={{ color: "var(--text-muted)" }}>{row.totalCount}</td>
                <td className="p-3 text-right" style={{ color: "var(--text-muted)" }}>{row.completedCount}</td>
                <td className="p-3 text-right" style={{ color: "var(--text-muted)" }}>{row.noShowCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
