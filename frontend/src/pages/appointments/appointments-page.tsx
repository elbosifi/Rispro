import { useState, useEffect, useMemo, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAppointmentLookups,
  getAppointmentAvailability,
  searchPatients,
  createAppointment,
  fetchPatientById,
  fetchSettings
} from "@/lib/api-hooks";
import type { Patient } from "@/types/api";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { pushToast } from "@/lib/toast";

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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlPatientId = searchParams.get("patientId");
  const [form, setForm] = useState<AppointmentForm>(DEFAULT_FORM);
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [postCreateAppointment, setPostCreateAppointment] = useState<any>(null);
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

  // Load day settings + scheduling settings for calendar_window_days
  const { data: schedulingSettings } = useQuery({
    queryKey: ["settings", "scheduling_and_capacity"],
    queryFn: () => fetchSettings("scheduling_and_capacity"),
    staleTime: 1000 * 60 * 30
  });

  // Availability pagination: setting value is days per page
  const [availPage, setAvailPage] = useState(0);
  const [showAllDays, setShowAllDays] = useState(false);
  const pageDays = parseInt((schedulingSettings as any)?.calendar_window_days, 10) || 14;
  const availOffset = availPage * pageDays;

  const modalities = lookups?.modalities ?? [];
  const examTypes = lookups?.examTypes ?? [];
  const priorities = lookups?.priorities ?? [];

  // Load availability for selected modality
  const { data: availability } = useQuery({
    queryKey: ["availability", form.modalityId, pageDays, availOffset],
    queryFn: () => getAppointmentAvailability(parseInt(form.modalityId, 10), pageDays, availOffset),
    enabled: !!form.modalityId,
    staleTime: 1000 * 30
  });
  const availabilityRows = availability ?? [];
  const displayRows = showAllDays ? availabilityRows : availabilityRows.filter((day: any) => !day.is_full);

  // Next open slot suggestion after selecting patient + modality
  const { data: suggestionAvailability } = useQuery({
    queryKey: ["availability-next-open", form.modalityId],
    queryFn: () => getAppointmentAvailability(parseInt(form.modalityId, 10), 180, 0),
    enabled: !!form.patientId && !!form.modalityId,
    staleTime: 1000 * 30
  });
  const nextOpenSlotDate = useMemo(() => {
    const rows = suggestionAvailability ?? [];
    const tripoliHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Tripoli",
        hour: "2-digit",
        hour12: false
      }).format(new Date())
    );
    const isAfterTwoPmTripoli = tripoliHour >= 14;
    const today = todayIsoDateLy();
    const next = rows.find((day: any) => {
      if (day.is_full) return false;
      const dayKey = normalizeDateKey(day.appointment_date);
      if (isAfterTwoPmTripoli && dayKey === today) return false;
      return true;
    });
    return next ? normalizeDateKey(next.appointment_date) : "";
  }, [suggestionAvailability]);

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
    setSafetyAcknowledged(false);
    setAvailPage(0);
    setShowAllDays(false);
  }, [form.modalityId]);

  // Safety warning state
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);

  const selectedModality = modalities.find(
    (m) => m.id.toString() === form.modalityId
  );
  const hasSafetyWarning = !!selectedModality?.safetyWarningEnabled &&
    !!(selectedModality?.safetyWarningEn || selectedModality?.safetyWarningAr);
  const safetyMessage = selectedModality?.safetyWarningEn || selectedModality?.safetyWarningAr || "";

  // Create appointment mutation
  const createMutation = useMutation({
    mutationFn: createAppointment,
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: (appointment) => {
      pushToast({
        type: "success",
        title: "Appointment created",
        message: `Accession ${appointment.accessionNumber} is ready to print.`
      });
      setPostCreateAppointment(appointment);
      setForm(DEFAULT_FORM);
      setSelectedPatient(null);
      setSafetyAcknowledged(false);
      queryClient.invalidateQueries({ queryKey: ["availability"] });
    }
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // If modality has safety warning and not yet acknowledged, show safety confirmation
    if (hasSafetyWarning && !safetyAcknowledged) {
      setShowSafetyModal(true);
      return;
    }
    submitAppointment();
  };

  const submitAppointment = () => {
    setShowSafetyModal(false);
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

  const handleSafetyConfirm = () => {
    setSafetyAcknowledged(true);
    submitAppointment();
  };

  const filteredExamTypes = examTypes.filter(
    (et) => et.modalityId?.toString() === form.modalityId
  );

  return (
    <>
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
                {hasSafetyWarning && (
                  <div className="md:col-span-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Safety Notice</p>
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{safetyMessage}</p>
                      </div>
                    </div>
                  </div>
                )}
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
                  <DateInput
                    label="Appointment Date"
                    value={form.appointmentDate}
                    onChange={(v) => setForm((f) => ({ ...f, appointmentDate: v }))}
                  />
                  {!!form.patientId && !!form.modalityId && !!nextOpenSlotDate && (
                    <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                      Suggested next open slot: {formatDateLy(nextOpenSlotDate)}
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, appointmentDate: nextOpenSlotDate }))}
                        className="ml-2 underline underline-offset-2"
                      >
                        Use this date
                      </button>
                    </div>
                  )}
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
              Availability
            </h3>
            {!form.modalityId ? (
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Select a modality to see availability.
              </p>
            ) : availabilityRows.length > 0 ? (
              <div className="space-y-2">
                {/* Prev/Next navigation */}
                <div className="flex justify-between items-center mb-2">
                  <button
                    onClick={() => setAvailPage((p) => Math.max(0, p - 1))}
                    disabled={availPage === 0}
                    className="px-2 py-1 text-xs bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-30 disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-700 rounded text-stone-700 dark:text-stone-300 transition-colors"
                  >
                    ← Earlier
                  </button>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    Page {availPage + 1}
                  </span>
                  <button
                    onClick={() => setAvailPage((p) => p + 1)}
                    className="px-2 py-1 text-xs bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-30 disabled:hover:bg-stone-100 dark:disabled:hover:bg-stone-700 rounded text-stone-700 dark:text-stone-300 transition-colors"
                  >
                    Later →
                  </button>
                </div>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Showing {displayRows.length} days on this page (setting: {pageDays} days per page)
                </p>
                <button
                  type="button"
                  onClick={() => setShowAllDays((v) => !v)}
                  className="text-xs text-teal-700 dark:text-teal-300 underline underline-offset-2"
                >
                  {showAllDays ? "Hide fully booked days" : "Show all days"}
                </button>

                <ul className="space-y-1.5">
                  {displayRows.map((day: any, idx: number) => {
                    const occupancyPct = day.daily_capacity > 0
                      ? Math.min(100, Math.max(0, Math.round((day.booked_count / day.daily_capacity) * 100)))
                      : 0;
                    const barColor = occupancyPct >= 100
                      ? "bg-red-500"
                      : occupancyPct >= 80
                      ? "bg-orange-500"
                      : occupancyPct >= 60
                      ? "bg-yellow-500"
                      : occupancyPct >= 30
                      ? "bg-lime-500"
                      : "bg-emerald-500";
                    const dateStr = normalizeDateKey(day.appointment_date);
                    const dateObj = toUtcDateFromIsoDay(dateStr);
                    const weekday = dateObj.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
                    const dateFormatted = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
                    const isSelected = form.appointmentDate === dateStr;
                    const showWeekHeader = idx === 0 || dateObj.getUTCDay() === 0;

                    return (
                      <li key={dateStr} className="space-y-1">
                      {/* Week separator: show header when a new week starts */}
                      {showWeekHeader && (
                        <div className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-semibold border-t border-stone-200 dark:border-stone-700 mt-3 pt-2">
                          Week of {dateFormatted}
                        </div>
                      )}
                        <div
                          onClick={() => setForm((f) => ({ ...f, appointmentDate: dateStr }))}
                          className={`cursor-pointer rounded p-1.5 transition-colors ${
                            isSelected
                              ? "bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800"
                              : "hover:bg-stone-50 dark:hover:bg-stone-700/50 border border-transparent"
                          }`}
                        >
                          <div className="flex justify-between items-center text-xs">
                            <span className={`font-medium ${isSelected ? "text-teal-700 dark:text-teal-300" : "text-stone-700 dark:text-stone-300"}`}>
                              {weekday} {dateFormatted}
                            </span>
                            <span className={`tabular-nums ${day.is_full ? "text-red-600 dark:text-red-400 font-semibold" : "text-stone-500 dark:text-stone-400"}`}>
                              {day.remaining_capacity}/{day.daily_capacity}
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-stone-600 overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full transition-all ${barColor}`}
                              style={{ width: `${occupancyPct}%` }}
                            />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {!showAllDays && displayRows.length === 0 && (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    No open days on this page. Click "Show all days" or go to Later.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-stone-500 dark:text-stone-400">Loading...</p>
            )}
          </div>
        </div>
      </div>
    </div>

    {postCreateAppointment && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) setPostCreateAppointment(null);
        }}
      >
        <div className="w-full max-w-lg rounded-3xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-6 shadow-2xl">
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-stone-900 dark:text-white">Appointment created</h3>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              Print the appointment slip for accession {postCreateAppointment.accessionNumber}?
            </p>
          </div>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setPostCreateAppointment(null)}
              className="flex-1 rounded-xl border border-stone-200 dark:border-stone-700 px-4 py-3 text-sm font-semibold text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => navigate(`/print?appointmentId=${postCreateAppointment.id}`)}
              className="flex-1 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
            >
              Print slip
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Safety Confirmation Modal */}
    {showSafetyModal && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={(e) => { if (e.target === e.currentTarget) setShowSafetyModal(false); }}
      >
        <div className="bg-white dark:bg-stone-800 rounded-xl border border-amber-200 dark:border-amber-800 shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-300">Safety Confirmation</h3>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-2">{safetyMessage}</p>
              <p className="text-sm text-stone-600 dark:text-stone-400 mt-3 font-medium">
                Have you confirmed this patient has no contraindications for {selectedModality?.nameEn}?
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowSafetyModal(false)}
              className="flex-1 py-2.5 px-4 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 font-medium rounded-lg transition-colors text-sm"
            >
              Cancel Booking
            </button>
            <button
              onClick={handleSafetyConfirm}
              className="flex-1 py-2.5 px-4 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg transition-colors text-sm"
            >
              Confirm — No Contraindications
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function normalizeDateKey(rawDate: unknown): string {
  if (typeof rawDate === "string") {
    return rawDate.slice(0, 10);
  }
  return new Date(rawDate as any).toISOString().slice(0, 10);
}

function toUtcDateFromIsoDay(isoDay: string): Date {
  const [yStr, mStr, dStr] = isoDay.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  return new Date(Date.UTC(y, m - 1, d));
}

function getAvailabilityText(availability: any[], date: string): string {
  const day = availability.find((d) => normalizeDateKey(d.appointment_date) === date);
  if (!day) return "No data for this date";
  if (day.is_full) return `Fully booked on ${formatDateLy(date)}`;
  return `${day.remaining_capacity} slots available on ${formatDateLy(date)}`;
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
