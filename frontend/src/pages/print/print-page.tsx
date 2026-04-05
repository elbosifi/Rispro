import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";
import { DATE_INPUT_LANG, formatDateLy, todayIsoDateLy } from "@/lib/date-format";

export default function PrintPage() {
  const [date, setDate] = useState(todayIsoDateLy());
  const [modalityId, setModalityId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["print-appointments", date, modalityId, query],
    queryFn: () => fetchAppointments({ date, ...(modalityId && { modalityId }), ...(query && { q: query }) }),
    staleTime: 1000 * 30
  });

  const handlePrint = (apt: any) => {
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head><title>Appointment Slip</title></head>
          <body style="font-family: sans-serif; padding: 20px;">
            <h1>Appointment Slip</h1>
            <p><strong>Accession:</strong> ${apt.accessionNumber}</p>
            <p><strong>Patient:</strong> ${apt.arabicFullName}</p>
            <p><strong>Modality:</strong> ${apt.modalityNameEn}</p>
            <p><strong>Exam:</strong> ${apt.examNameEn || "—"}</p>
            <p><strong>Date:</strong> ${formatDateLy(apt.appointmentDate)}</p>
            <p><strong>Status:</strong> ${apt.status}</p>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">Printing</h2>

      {/* Filters */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input label="Date" type="date" value={date} onChange={setDate} />
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
          <Input label="Search" type="text" value={query} onChange={setQuery} placeholder="Name, MRN, Accession..." />
        </div>
      </div>

      {/* List + Slip */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-stone-200 dark:border-stone-700">
            <h3 className="font-semibold text-stone-900 dark:text-white">
              Appointments ({isLoading ? "..." : appointments.length})
            </h3>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-stone-500">Loading...</div>
          ) : appointments.length === 0 ? (
            <div className="p-8 text-center text-stone-500">No appointments found</div>
          ) : (
            <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
              {appointments.map((apt: any) => (
                <li key={apt.id}>
                  <div className="p-4 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors">
                    <button
                      onClick={() => setSelectedAppointment(apt)}
                      className="text-right flex-1"
                    >
                      <p className="font-medium text-stone-900 dark:text-white">
                        {apt.accessionNumber}
                      </p>
                      <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                        {apt.arabicFullName} • {apt.modalityNameEn}
                      </p>
                    </button>
                    <button
                      onClick={() => handlePrint(apt)}
                      className="ml-4 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Print
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Slip Preview */}
        <div>
          {selectedAppointment ? (
            <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
                  Slip Preview
                </h3>
                <button
                  onClick={() => handlePrint(selectedAppointment)}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Print Slip
                </button>
              </div>
              <div className="space-y-4 border-2 border-dashed border-stone-300 dark:border-stone-600 rounded-lg p-6">
                <div className="text-center pb-4 border-b border-stone-200 dark:border-stone-700">
                  <h2 className="text-xl font-bold text-teal-700 dark:text-teal-500">RISpro Reception</h2>
                  <p className="text-sm text-stone-500 dark:text-stone-400">Appointment Slip</p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <Field label="Accession" value={selectedAppointment.accessionNumber} />
                  <Field label="Patient" value={selectedAppointment.arabicFullName} />
                  <Field label="Modality" value={selectedAppointment.modalityNameEn} />
                  <Field label="Exam" value={selectedAppointment.examNameEn} />
                  <Field label="Date" value={formatDateLy(selectedAppointment.appointmentDate)} />
                  <Field label="Status" value={selectedAppointment.status} />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 p-8">
              <p className="text-stone-500 dark:text-stone-400">Select an appointment to preview slip</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({ label, type, value, onChange, placeholder }: { label: string; type: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}</label>
      <input type={type} lang={type === "date" ? DATE_INPUT_LANG : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none" />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none">
        {options.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
      </select>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (<div><p className="text-stone-500 dark:text-stone-400 text-xs">{label}</p><p className="text-stone-900 dark:text-white font-medium">{value ?? "—"}</p></div>);
}
