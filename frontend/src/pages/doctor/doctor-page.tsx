import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { Select } from "@/components/common/select";
import { AppointmentEditor } from "@/components/appointments/appointment-editor";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import type { Appointment } from "@/types/api";

interface DoctorAppointment extends Appointment {
  arabicFullName: string;
  modalityNameEn: string;
  examNameEn: string;
}

export default function DoctorPage() {
  const { language } = useLanguage();
  const [date, setDate] = useState(todayIsoDateLy());
  const [modalityId, setModalityId] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<DoctorAppointment | null>(null);
  const navigate = useNavigate();

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["doctor-requests", date, modalityId],
    queryFn: () => fetchAppointments({ date, ...(modalityId && { modalityId }) }),
    staleTime: 1000 * 30
  });
  const typedAppointments = appointments as DoctorAppointment[];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        {t(language, "doctor.title")}
      </h2>

      {/* Filters */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DateInput label={t(language, "doctor.date")} value={date} onChange={setDate} />
          <Select
            label={t(language, "doctor.modality")}
            value={modalityId}
            onChange={setModalityId}
            options={[
              { value: "", label: t(language, "doctor.all") },
              ...(lookups?.modalities ?? []).map((m) => ({
                value: m.id.toString(),
                label: m.nameEn
              }))
            ]}
          />
        </div>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-stone-200 dark:border-stone-700">
            <h3 className="font-semibold text-stone-900 dark:text-white">
              {t(language, "doctor.requests", { count: isLoading ? 0 : typedAppointments.length })}
            </h3>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-stone-500">{t(language, "common.loading")}</div>
          ) : typedAppointments.length === 0 ? (
            <div className="p-8 text-center text-stone-500">{t(language, "doctor.empty")}</div>
          ) : (
            <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
              {typedAppointments.map((apt) => (
                <li key={apt.id}>
                  <button
                    onClick={() => setSelectedAppointment(apt)}
                    className={`w-full text-right p-4 transition-colors hover:bg-stone-50 dark:hover:bg-stone-700/50 ${
                      selectedAppointment?.id === apt.id ? "bg-teal-50 dark:bg-teal-900/20" : ""
                    }`}
                  >
                    <p className="font-medium text-stone-900 dark:text-white">
                      {apt.accessionNumber}
                    </p>
                    <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                      {apt.arabicFullName} {"\u2022"} {apt.modalityNameEn}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                      {formatDateLy(apt.appointmentDate)} {"\u2022"} {apt.status}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Details */}
        <div>
          {selectedAppointment ? (
            <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
                    {t(language, "doctor.details")}
                  </h3>
                  {selectedAppointment.updatedAt && selectedAppointment.createdAt && selectedAppointment.updatedAt !== selectedAppointment.createdAt && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      {t(language, "appointmentEditor.edited")}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/print?appointmentId=${selectedAppointment.id}`)}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Print
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <Field label={t(language, "doctor.fieldAccession")} value={selectedAppointment.accessionNumber} />
                <Field label={t(language, "doctor.fieldPatient")} value={selectedAppointment.arabicFullName} />
                <Field label={t(language, "doctor.fieldModality")} value={selectedAppointment.modalityNameEn} />
                <Field label={t(language, "doctor.fieldExam")} value={selectedAppointment.examNameEn} />
                <Field label={t(language, "doctor.fieldDate")} value={formatDateLy(selectedAppointment.appointmentDate)} />
                <Field label={t(language, "doctor.fieldStatus")} value={selectedAppointment.status} />
                <Field label={t(language, "doctor.fieldNotes")} value={selectedAppointment.notes} />
              </div>
              <div className="mt-6">
                <AppointmentEditor
                  appointment={selectedAppointment}
                  lookups={lookups}
                  onUpdated={(updated) => setSelectedAppointment(updated)}
                  onDeleted={() => setSelectedAppointment(null)}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 p-8">
              <p className="text-stone-500 dark:text-stone-400">{t(language, "doctor.selectPrompt")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function Field({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div>
      <p className="text-stone-500 dark:text-stone-400">{label}</p>
      <p className="mt-1 text-stone-900 dark:text-white font-medium">{value ?? "—"}</p>
    </div>
  );
}
