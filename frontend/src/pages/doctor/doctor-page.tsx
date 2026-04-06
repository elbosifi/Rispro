import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";

export default function DoctorPage() {
  const [date, setDate] = useState(todayIsoDateLy());
  const [modalityId, setModalityId] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        Doctor Home
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

      {/* List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-stone-200 dark:border-stone-700">
            <h3 className="font-semibold text-stone-900 dark:text-white">
              Requests ({isLoading ? "..." : appointments.length})
            </h3>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-stone-500">Loading...</div>
          ) : appointments.length === 0 ? (
            <div className="p-8 text-center text-stone-500">No requests found</div>
          ) : (
            <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
              {appointments.map((apt: any) => (
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
                      {apt.arabicFullName} • {apt.modalityNameEn}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                      {formatDateLy(apt.appointmentDate)} • {apt.status}
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
                <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
                  Appointment Details
                </h3>
                <button
                  onClick={() => navigate(`/print?appointmentId=${selectedAppointment.id}`)}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Print
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <Field label="Accession" value={selectedAppointment.accessionNumber} />
                <Field label="Patient" value={selectedAppointment.arabicFullName} />
                <Field label="Modality" value={selectedAppointment.modalityNameEn} />
                <Field label="Exam" value={selectedAppointment.examNameEn} />
                <Field label="Date" value={formatDateLy(selectedAppointment.appointmentDate)} />
                <Field label="Status" value={selectedAppointment.status} />
                <Field label="Notes" value={selectedAppointment.notes} />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 p-8">
              <p className="text-stone-500 dark:text-stone-400">Select an appointment to view details</p>
            </div>
          )}
        </div>
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

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-stone-500 dark:text-stone-400">{label}</p>
      <p className="mt-1 text-stone-900 dark:text-white font-medium">{value ?? "—"}</p>
    </div>
  );
}
