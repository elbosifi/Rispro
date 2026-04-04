import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export default function DoctorPage() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [modalityId, setModalityId] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);

  const { data: lookups } = useQuery<{ modalities: any[] }>({
    queryKey: ["lookups"],
    queryFn: () => api("/appointments/lookups"),
    staleTime: 1000 * 60 * 5
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["doctor-requests", date, modalityId],
    queryFn: () => fetchDoctorRequests(date, modalityId),
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
          <Input label="Date" type="date" value={date} onChange={setDate} />
          <Select
            label="Modality"
            value={modalityId}
            onChange={setModalityId}
            options={[
              { value: "", label: "All" },
              ...(lookups?.modalities ?? []).map((m: any) => ({
                value: m.id.toString(),
                label: m.name_en
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
                      {apt.accession_number}
                    </p>
                    <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                      {apt.arabic_full_name} • {apt.modality_name_en}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                      {apt.appointment_date} • {apt.status}
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
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white mb-4">
                Appointment Details
              </h3>
              <div className="space-y-3 text-sm">
                <Field label="Accession" value={selectedAppointment.accession_number} />
                <Field label="Patient" value={selectedAppointment.arabic_full_name} />
                <Field label="Modality" value={selectedAppointment.modality_name_en} />
                <Field label="Exam" value={selectedAppointment.exam_name_en} />
                <Field label="Date" value={selectedAppointment.appointment_date} />
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

async function fetchDoctorRequests(date: string, modalityId: string) {
  const params = new URLSearchParams();
  params.set("date", date);
  if (modalityId) params.set("modalityId", modalityId);
  return api<{ appointments: any[] }>(`/appointments?${params.toString()}`).then((r) => r.appointments);
}

function Input({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
      />
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
