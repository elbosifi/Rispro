import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAppointmentLookups, fetchModalityWorklist, completeAppointment } from "@/lib/api-hooks";
import { todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { AppointmentEditor } from "@/components/appointments/appointment-editor";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";

export default function ModalityPage() {
  const { language } = useLanguage();
  const [modalityId, setModalityId] = useState("");
  const [date, setDate] = useState(todayIsoDateLy());
  const [scope, setScope] = useState<"day" | "all">("day");
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["modality-worklist", modalityId, date, scope],
    queryFn: () => fetchModalityWorklist(modalityId, date, scope),
    enabled: !!modalityId,
    staleTime: 1000 * 10
  });

  const completeMutation = useMutation({
    mutationFn: completeAppointment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
    }
  });

  const handleComplete = (id: number) => {
    completeMutation.mutate(id);
  };

  const handlePrint = (appointmentId: number) => {
    navigate(`/print?appointmentId=${appointmentId}`);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
  };

  const waitingCount = appointments.filter((a: any) => a.status === "waiting").length;
  const arrivedCount = appointments.filter((a: any) => a.status === "arrived").length;
  const completedCount = appointments.filter((a: any) => a.status === "completed").length;

  const modalities = (lookups as any)?.modalities ?? [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">{t(language, "modality.title")}</h2>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 font-medium rounded-lg transition-colors text-sm"
        >
          {t(language, "modality.refresh")}
        </button>
      </div>

      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{t(language, "modality.selectModality")}</label>
            <select
              value={modalityId}
              onChange={(e) => {
                setModalityId(e.target.value);
                setSelectedAppointment(null);
              }}
              className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
            >
              <option value="">{t(language, "modality.selectModality")}</option>
              {modalities
                .filter((m: any) => m.isActive)
                .map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.nameEn}
                  </option>
                ))}
            </select>
          </div>
          <DateInput label={t(language, "modality.date")} value={date} onChange={setDate} disabled={scope === "all"} />
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{t(language, "modality.scope")}</label>
            <div className="flex gap-2">
              <button
                onClick={() => setScope("day")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  scope === "day"
                    ? "bg-teal-600 text-white"
                    : "bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-600"
                }`}
              >
                {t(language, "modality.scopeToday")}
              </button>
              <button
                onClick={() => setScope("all")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  scope === "all"
                    ? "bg-teal-600 text-white"
                    : "bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-600"
                }`}
              >
                {t(language, "modality.scopeAll")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {modalityId && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label={t(language, "modality.waiting")} value={waitingCount} color="amber" />
          <StatCard label={t(language, "modality.arrived")} value={arrivedCount} color="teal" />
          <StatCard label={t(language, "modality.completed")} value={completedCount} color="emerald" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-stone-200 dark:border-stone-700">
            <h3 className="font-semibold text-stone-900 dark:text-white">
              {isLoading ? t(language, "modality.loading") : t(language, "modality.worklist", { count: appointments.length })}
            </h3>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-stone-500">{t(language, "modality.loading")}</div>
          ) : !modalityId ? (
            <div className="p-8 text-center text-stone-500">{t(language, "modality.selectPrompt")}</div>
          ) : appointments.length === 0 ? (
            <div className="p-8 text-center text-stone-500">{t(language, "modality.empty")}</div>
          ) : (
            <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
              {appointments.map((apt: any) => (
                <li
                  key={apt.id}
                  onClick={() => setSelectedAppointment(apt)}
                  className={`p-4 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors cursor-pointer ${
                    selectedAppointment?.id === apt.id ? "bg-teal-50 dark:bg-teal-900/20" : ""
                  }`}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleComplete(apt.id);
                        }}
                        disabled={completeMutation.isPending}
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {t(language, "modality.complete")}
                      </button>
                    ) : apt.status === "completed" ? (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                        {t(language, "modality.completed")}
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

        <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
          {selectedAppointment ? (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-stone-900 dark:text-white">{t(language, "modality.reviewTitle")}</h3>
                  {selectedAppointment.updatedAt && selectedAppointment.createdAt && selectedAppointment.updatedAt !== selectedAppointment.createdAt && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      {t(language, "appointmentEditor.edited")}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handlePrint(selectedAppointment.id)}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {t(language, "common.print")}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm">
                <Field label={t(language, "modality.fieldAccession")} value={selectedAppointment.accessionNumber} />
                <Field label={t(language, "modality.fieldPatient")} value={selectedAppointment.arabicFullName} />
                <Field label={t(language, "modality.fieldModality")} value={selectedAppointment.modalityNameEn} />
                <Field label={t(language, "modality.fieldExam")} value={selectedAppointment.examNameEn || "—"} />
                <Field label={t(language, "modality.fieldDate")} value={selectedAppointment.appointmentDate} />
                <Field label={t(language, "modality.fieldStatus")} value={selectedAppointment.status} />
                <Field label={t(language, "modality.fieldPriority")} value={selectedAppointment.priorityNameEn || "Normal"} />
                <Field label={t(language, "modality.fieldNotes")} value={selectedAppointment.notes || "—"} />
              </div>
              <div className="mt-6">
                <AppointmentEditor
                  appointment={selectedAppointment}
                  lookups={lookups}
                  onUpdated={(updated) => setSelectedAppointment(updated)}
                  onDeleted={() => setSelectedAppointment(null)}
                />
              </div>
            </>
          ) : (
            <div className="h-full min-h-[240px] flex items-center justify-center text-stone-500 dark:text-stone-400">
              {t(language, "modality.selectToReview")}
            </div>
          )}
        </div>
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

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/40 p-3">
      <p className="text-stone-500 dark:text-stone-400 text-[11px] uppercase tracking-[0.14em] mb-1">{label}</p>
      <p className="text-stone-900 dark:text-white font-semibold text-base leading-snug break-words">{value ?? "—"}</p>
    </div>
  );
}
