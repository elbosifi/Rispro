import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAppointmentLookups, fetchModalityWorklist, completeAppointment } from "@/lib/api-hooks";

export default function ModalityPage() {
  const [modalityId, setModalityId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [scope, setScope] = useState<"day" | "all">("day");
  const queryClient = useQueryClient();

  // Load lookups
  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  // Load worklist
  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["modality-worklist", modalityId, date, scope],
    queryFn: () => fetchModalityWorklist(modalityId, date, scope),
    enabled: !!modalityId,
    staleTime: 1000 * 10
  });

  // Complete mutation
  const completeMutation = useMutation({
    mutationFn: completeAppointment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
    }
  });

  const handleComplete = (id: number) => {
    completeMutation.mutate(id);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
  };

  // Stats
  const waitingCount = appointments.filter((a: any) => a.status === "waiting").length;
  const arrivedCount = appointments.filter((a: any) => a.status === "arrived").length;
  const completedCount = appointments.filter((a: any) => a.status === "completed").length;

  const modalities = (lookups as any)?.modalities ?? [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
          Modality Board
        </h2>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 font-medium rounded-lg transition-colors text-sm"
        >
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              Modality
            </label>
            <select
              value={modalityId}
              onChange={(e) => setModalityId(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
            >
              <option value="">Select modality...</option>
              {modalities
                .filter((m: any) => m.isActive)
                .map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.nameEn}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={scope === "all"}
              className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              Scope
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setScope("day")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  scope === "day"
                    ? "bg-teal-600 text-white"
                    : "bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-600"
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setScope("all")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  scope === "all"
                    ? "bg-teal-600 text-white"
                    : "bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-600"
                }`}
              >
                All Dates
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      {modalityId && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Waiting" value={waitingCount} color="amber" />
          <StatCard label="Arrived" value={arrivedCount} color="teal" />
          <StatCard label="Completed" value={completedCount} color="emerald" />
        </div>
      )}

      {/* Worklist */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">
            {isLoading ? "Loading..." : `Worklist (${appointments.length})`}
          </h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-stone-500">Loading...</div>
        ) : !modalityId ? (
          <div className="p-8 text-center text-stone-500">Select a modality to view worklist</div>
        ) : appointments.length === 0 ? (
          <div className="p-8 text-center text-stone-500">No appointments found</div>
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
            {appointments.map((apt: any) => (
              <li
                key={apt.id}
                className="p-4 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors"
              >
                <div className="text-right flex-1">
                  <p className="font-medium text-stone-900 dark:text-white">
                    #{apt.modalitySlotNumber || "—"} • {apt.arabicFullName}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                    {apt.accessionNumber} • {apt.modalityNameEn} • {apt.examNameEn || "—"}
                  </p>
                  <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                    ID: {apt.nationalId || "—"} • Age: {apt.ageYears || "—"} • Priority: {apt.priorityNameEn || "Normal"}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {["waiting", "arrived", "in-progress"].includes(apt.status) ? (
                    <button
                      onClick={() => handleComplete(apt.id)}
                      disabled={completeMutation.isPending}
                      className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Complete
                    </button>
                  ) : apt.status === "completed" ? (
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                      Completed
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400">
                      {apt.status}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    amber: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400",
    teal: "bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-400",
    emerald: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
  };

  return (
    <div className={`rounded-xl p-4 border ${colors[color]}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
