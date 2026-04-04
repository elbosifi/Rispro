import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";

interface RegistrationsFilters {
  date: string;
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  query: string;
  status: string[];
}

export default function RegistrationsPage() {
  const [filters, setFilters] = useState<RegistrationsFilters>({
    date: new Date().toISOString().split("T")[0],
    dateFrom: "",
    dateTo: "",
    modalityId: "",
    query: "",
    status: ["scheduled"]
  });

  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);

  // Load registrations
  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["registrations", filters],
    queryFn: () => fetchRegistrations(filters)
  });

  // Load lookups for modality filter
  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const handleFilterChange = (key: keyof RegistrationsFilters, value: any) => {
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const handleStatusToggle = (status: string) => {
    setFilters((f) => {
      const current = f.status.includes(status);
      const newStatus = current
        ? f.status.filter((s) => s !== status)
        : [...f.status, status];
      // Ensure at least one status is selected
      return { ...f, status: newStatus.length > 0 ? newStatus : ["scheduled"] };
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        Daily Registrations
      </h2>

      {/* Filters */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Input
            label="Date"
            type="date"
            value={filters.date}
            onChange={(v) => {
              handleFilterChange("date", v);
              handleFilterChange("dateFrom", "");
              handleFilterChange("dateTo", "");
            }}
          />
          <Input
            label="From Date"
            type="date"
            value={filters.dateFrom}
            onChange={(v) => {
              handleFilterChange("dateFrom", v);
              if (v) handleFilterChange("date", "");
            }}
          />
          <Input
            label="To Date"
            type="date"
            value={filters.dateTo}
            onChange={(v) => {
              handleFilterChange("dateTo", v);
              if (v) handleFilterChange("date", "");
            }}
          />
          <Select
            label="Modality"
            value={filters.modalityId}
            onChange={(v) => handleFilterChange("modalityId", v)}
            options={[
              { value: "", label: "All" },
              ...(lookups?.modalities ?? []).map((m) => ({
                value: m.id.toString(),
                label: m.nameEn
              }))
            ]}
          />
          <Input
            label="Search"
            value={filters.query}
            onChange={(v) => handleFilterChange("query", v)}
            placeholder="Name, MRN, Accession..."
          />
        </div>

        {/* Status Filter */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-200 dark:border-stone-700">
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Status:</span>
          {["scheduled", "arrived", "waiting", "completed", "no-show", "cancelled"].map(
            (status) => (
              <button
                key={status}
                onClick={() => handleStatusToggle(status)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filters.status.includes(status)
                    ? "bg-teal-600 text-white"
                    : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600"
                }`}
              >
                {status}
              </button>
            )
          )}
        </div>
      </div>

      {/* Results */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">
            Results ({isLoading ? "..." : appointments.length})
          </h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-stone-500">Loading...</div>
        ) : appointments.length === 0 ? (
          <div className="p-8 text-center text-stone-500">No appointments found</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
              <tr>
                <th className="text-right p-3">Accession</th>
                <th className="text-right p-3">Patient</th>
                <th className="text-right p-3">Date</th>
                <th className="text-right p-3">Modality</th>
                <th className="text-right p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {appointments.map((apt) => (
                <tr
                  key={apt.id}
                  onClick={() => setSelectedAppointment(apt)}
                  className={`cursor-pointer transition-colors hover:bg-stone-50 dark:hover:bg-stone-700/50 ${
                    selectedAppointment?.id === apt.id
                      ? "bg-teal-50 dark:bg-teal-900/20"
                      : ""
                  }`}
                >
                  <td className="p-3 font-medium text-stone-900 dark:text-white">
                    {apt.accessionNumber}
                  </td>
                  <td className="p-3 text-stone-700 dark:text-stone-300">
                    {apt.arabicFullName}
                  </td>
                  <td className="p-3 text-stone-500 dark:text-stone-400">
                    {apt.appointmentDate}
                  </td>
                  <td className="p-3 text-stone-500 dark:text-stone-400">
                    {apt.modalityNameEn}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={apt.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Selected Appointment Details */}
      {selectedAppointment && (
        <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-stone-900 dark:text-white mb-4">
            Appointment Details: {selectedAppointment.accessionNumber}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Field label="Patient" value={selectedAppointment.arabicFullName} />
            <Field label="Modality" value={selectedAppointment.modalityNameEn} />
            <Field label="Date" value={selectedAppointment.appointmentDate} />
            <Field label="Status" value={selectedAppointment.status} />
            <Field label="Walk-in" value={selectedAppointment.isWalkIn ? "Yes" : "No"} />
            <Field label="Notes" value={selectedAppointment.notes} />
          </div>
        </div>
      )}
    </div>
  );
}

async function fetchRegistrations(filters: RegistrationsFilters) {
  const params: Record<string, string> = {};
  if (filters.dateFrom || filters.dateTo) {
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
  } else {
    params.date = filters.date;
  }
  if (filters.modalityId) params.modalityId = filters.modalityId;
  if (filters.query) params.q = filters.query;
  
  return fetchAppointments(params);
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    scheduled: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
    arrived: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
    waiting: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
    completed: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400",
    "no-show": "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
    cancelled: "bg-stone-100 dark:bg-stone-900/30 text-stone-700 dark:text-stone-400"
  };

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.scheduled}`}>
      {status}
    </span>
  );
}
