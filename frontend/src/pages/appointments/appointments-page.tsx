import { useState, useEffect, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAppointmentLookups,
  getAppointmentAvailability,
  searchPatients,
  createAppointment,
  fetchPatientById
} from "@/lib/api-hooks";
import type { Patient } from "@/types/api";

interface AppointmentForm {
  patientId: string;
  patientSearch: string;
  modalityId: string;
  examTypeId: string;
  reportingPriorityId: string;
  appointmentDate: string;
  notes: string;
  isWalkIn: boolean;
}

const DEFAULT_FORM: AppointmentForm = {
  patientId: "",
  patientSearch: "",
  modalityId: "",
  examTypeId: "",
  reportingPriorityId: "",
  appointmentDate: "",
  notes: "",
  isWalkIn: false
};

export default function AppointmentsPage() {
  const [searchParams] = useSearchParams();
  const urlPatientId = searchParams.get("patientId");
  const [form, setForm] = useState<AppointmentForm>(DEFAULT_FORM);
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const queryClient = useQueryClient();

  // Fetch patient by ID if present in URL
  const { data: urlPatient } = useQuery({
    queryKey: ["patient-by-id", urlPatientId],
    queryFn: () => fetchPatientById(parseInt(urlPatientId!, 10)),
    enabled: !!urlPatientId && !isNaN(parseInt(urlPatientId, 10)),
    staleTime: 1000 * 60 * 5
  });

  // Preselect patient from URL
  useEffect(() => {
    if (urlPatient && !selectedPatient) {
      setSelectedPatient(urlPatient);
      setForm((f) => ({
        ...f,
        patientId: urlPatient.id.toString(),
        patientSearch: urlPatient.arabicFullName
      }));
    }
  }, [urlPatient]);

  // Load lookups
  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  // Load availability for selected modality
  const { data: availability } = useQuery({
    queryKey: ["availability", form.modalityId],
    queryFn: () => getAppointmentAvailability(parseInt(form.modalityId, 10)),
    enabled: !!form.modalityId,
    staleTime: 1000 * 30
  });

  // Search for patient
  const handlePatientSearch = (query: string) => {
    setForm((f) => ({ ...f, patientSearch: query }));
    if (query.length > 1) {
      searchPatients(query).then(setPatientResults);
    } else {
      setPatientResults([]);
    }
  };

  const selectPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setForm((f) => ({
      ...f,
      patientId: patient.id.toString(),
      patientSearch: patient.arabicFullName
    }));
    setPatientResults([]);
  };

  // Reset dependent fields when modality changes
  useEffect(() => {
    setForm((f) => ({ ...f, examTypeId: "", appointmentDate: "" }));
  }, [form.modalityId]);

  // Create appointment mutation
  const createMutation = useMutation({
    mutationFn: createAppointment,
    onSuccess: (appointment) => {
      alert(`Appointment created! Accession: ${appointment.accessionNumber}`);
      setForm(DEFAULT_FORM);
      setSelectedPatient(null);
      queryClient.invalidateQueries({ queryKey: ["availability"] });
    }
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      patientId: parseInt(form.patientId, 10),
      modalityId: parseInt(form.modalityId, 10),
      examTypeId: form.examTypeId ? parseInt(form.examTypeId, 10) : undefined,
      reportingPriorityId: form.reportingPriorityId
        ? parseInt(form.reportingPriorityId, 10)
        : undefined,
      appointmentDate: form.appointmentDate,
      notes: form.notes || undefined,
      isWalkIn: form.isWalkIn
    });
  };

  const modalities = lookups?.modalities ?? [];
  const examTypes = lookups?.examTypes ?? [];
  const priorities = lookups?.priorities ?? [];

  const filteredExamTypes = examTypes.filter(
    (et) => et.modalityId?.toString() === form.modalityId
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        Create Appointment
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-2 space-y-6">
          <form
            onSubmit={handleSubmit}
            className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6 space-y-6"
          >
            {/* Patient Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">
                Patient
              </h3>
              <div className="relative">
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                  Search Patient
                </label>
                <input
                  type="text"
                  value={form.patientSearch}
                  onChange={(e) => handlePatientSearch(e.target.value)}
                  placeholder="Type name, MRN, or National ID..."
                  className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
                />
                {patientResults.length > 0 && (
                  <ul className="absolute z-10 w-full mt-1 bg-white dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {patientResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => selectPatient(p)}
                          className="w-full text-right p-3 hover:bg-stone-50 dark:hover:bg-stone-600 transition-colors border-b border-stone-100 dark:border-stone-600 last:border-b-0"
                        >
                          <p className="font-medium text-sm text-stone-900 dark:text-white">
                            {p.arabicFullName}
                          </p>
                          {p.englishFullName && (
                            <p className="text-xs text-stone-500 dark:text-stone-400">{p.englishFullName}</p>
                          )}
                          <p className="text-xs text-stone-500 dark:text-stone-400">
                            {p.identifierValue || p.nationalId || "No ID"}
                            {" • "}MRN: {p.mrn || "—"}
                          </p>
                          {p.phone1 && (
                            <p className="text-xs text-stone-500 dark:text-stone-400">Phone: {p.phone1}</p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selectedPatient && (
                <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg">
                  <p className="text-sm font-medium text-teal-800 dark:text-teal-300">
                    Selected: {selectedPatient.arabicFullName}
                  </p>
                  {selectedPatient.englishFullName && (
                    <p className="text-xs text-teal-600 dark:text-teal-400">{selectedPatient.englishFullName}</p>
                  )}
                  <p className="text-xs text-teal-600 dark:text-teal-400">
                    {selectedPatient.identifierValue || selectedPatient.nationalId || "No ID"}
                    {" • "}MRN: {selectedPatient.mrn || "—"}
                  </p>
                  {selectedPatient.phone1 && (
                    <p className="text-xs text-teal-600 dark:text-teal-400">Phone: {selectedPatient.phone1}</p>
                  )}
                </div>
              )}
            </div>

            {/* Modality & Date */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">
                Schedule
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label="Modality"
                  value={form.modalityId}
                  onChange={(v) => setForm((f) => ({ ...f, modalityId: v }))}
                  options={[
                    { value: "", label: "Select modality..." },
                    ...modalities
                      .filter((m) => m.isActive)
                      .map((m) => ({
                        value: m.id.toString(),
                        label: m.nameEn
                      }))
                  ]}
                  required
                />
                <Select
                  label="Exam Type (Optional)"
                  value={form.examTypeId}
                  onChange={(v) => setForm((f) => ({ ...f, examTypeId: v }))}
                  options={[
                    { value: "", label: "None" },
                    ...filteredExamTypes.map((et) => ({
                      value: et.id.toString(),
                      label: et.nameEn
                    }))
                  ]}
                />
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                    Appointment Date
                  </label>
                  <input
                    type="date"
                    value={form.appointmentDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, appointmentDate: e.target.value }))
                    }
                    required
                    className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
                  />
                  {availability && form.appointmentDate && (
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {getAvailabilityText(availability, form.appointmentDate)}
                    </p>
                  )}
                </div>
                <Select
                  label="Priority"
                  value={form.reportingPriorityId}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, reportingPriorityId: v }))
                  }
                  options={[
                    { value: "", label: "Normal" },
                    ...priorities.map((p) => ({
                      value: p.id.toString(),
                      label: p.nameEn
                    }))
                  ]}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white border-b pb-2">
                Notes
              </h3>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes..."
                rows={3}
                className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
              />
            </div>

            {createMutation.error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
                {createMutation.error.message}
              </div>
            )}

            <button
              type="submit"
              disabled={createMutation.isPending || !form.patientId || !form.modalityId || !form.appointmentDate}
              className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors"
            >
              {createMutation.isPending ? "Creating..." : "Create Appointment"}
            </button>
          </form>
        </div>

        {/* Sidebar: Availability */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4">
            <h3 className="font-semibold text-stone-900 dark:text-white mb-3">
              Modality Availability
            </h3>
            {!form.modalityId ? (
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Select a modality to see availability.
              </p>
            ) : availability && availability.length > 0 ? (
              <ul className="space-y-2">
                {availability.slice(0, 7).map((day: any) => (
                  <li
                    key={day.appointment_date}
                    className="flex justify-between items-center text-sm p-2 rounded bg-stone-50 dark:bg-stone-700"
                  >
                    <span className="text-stone-700 dark:text-stone-300">
                      {day.appointment_date}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        day.is_full
                          ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                          : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {day.remaining_capacity} slots
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500 dark:text-stone-400">Loading...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getAvailabilityText(availability: any[], date: string): string {
  const day = availability.find((d) => d.appointment_date === date);
  if (!day) return "No data for this date";
  if (day.is_full) return "Fully booked";
  return `${day.remaining_capacity} slots available`;
}

function Select({
  label,
  value,
  onChange,
  options,
  required
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
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
