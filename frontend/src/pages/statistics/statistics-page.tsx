import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStatistics as fetchStats, fetchAppointmentLookups } from "@/lib/api-hooks";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { Select } from "@/components/common/select";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
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
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        {t(language, "statistics.title")}
      </h2>

      {/* Filters */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4">
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
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">{t(language, "statistics.byStatus")}</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
            <tr>
              <th className="text-right p-3">{t(language, "statistics.statusCol")}</th>
              <th className="text-right p-3">{t(language, "statistics.countCol")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
            {statusBreakdown.map((row) => (
              <tr key={row.status}>
                <td className="p-3 text-stone-900 dark:text-white font-medium">{row.status}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modality Breakdown */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">{t(language, "statistics.byModality")}</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
            <tr>
              <th className="text-right p-3">{t(language, "statistics.modalityCol")}</th>
              <th className="text-right p-3">{t(language, "statistics.countCol")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
            {modalityBreakdown.map((row) => (
              <tr key={row.modalityId}>
                <td className="p-3 text-stone-900 dark:text-white font-medium">{row.modalityNameEn}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">{row.totalCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Daily Breakdown */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">{t(language, "statistics.dailyTrend")}</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
            <tr>
              <th className="text-right p-3">{t(language, "statistics.dateCol")}</th>
              <th className="text-right p-3">{t(language, "statistics.totalCol")}</th>
              <th className="text-right p-3">{t(language, "status.completed")}</th>
              <th className="text-right p-3">{t(language, "status.no-show")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
            {dailyBreakdown.map((row) => (
              <tr key={row.appointmentDate}>
                <td className="p-3 text-stone-900 dark:text-white font-medium">{formatDateLy(row.appointmentDate)}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">{row.totalCount}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">{row.completedCount}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">{row.noShowCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

