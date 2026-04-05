import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStatistics as fetchStats, fetchAppointmentLookups } from "@/lib/api-hooks";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";

export default function StatisticsPage() {
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

  const statusBreakdown = stats?.statusBreakdown ?? [];
  const modalityBreakdown = stats?.modalityBreakdown ?? [];
  const dailyBreakdown = stats?.dailyBreakdown ?? [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        Statistics
      </h2>

      {/* Filters */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DateInput label="Date" value={date} onChange={setDate} />
          <Select
            label="Modality"
            value={modalityId}
            onChange={setModalityId}
            options={[
              { value: "", label: "All" },
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
          <h3 className="font-semibold text-stone-900 dark:text-white">By Status</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
            <tr>
              <th className="text-right p-3">Status</th>
              <th className="text-right p-3">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
            {statusBreakdown.map((row: any) => (
              <tr key={row.status}>
                <td className="p-3 text-stone-900 dark:text-white font-medium capitalize">{row.status}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modality Breakdown */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">By Modality</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
            <tr>
              <th className="text-right p-3">Modality</th>
              <th className="text-right p-3">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
            {modalityBreakdown.map((row: any) => (
              <tr key={row.modalityId}>
                <td className="p-3 text-stone-900 dark:text-white font-medium">{row.modalityNameEn}</td>
                <td className="p-3 text-stone-700 dark:text-stone-300">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Daily Breakdown */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">Daily Trend</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
            <tr>
              <th className="text-right p-3">Date</th>
              <th className="text-right p-3">Total</th>
              <th className="text-right p-3">Completed</th>
              <th className="text-right p-3">No-Show</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
            {dailyBreakdown.map((row: any) => (
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

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none">
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
