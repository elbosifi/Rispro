import { useState, useEffect, useMemo, useRef, useCallback, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAppointmentLookups,
  getAppointmentAvailability,
  getAppointmentSuggestions,
  searchPatients,
  createAppointment,
  fetchPatientById,
  fetchSettings
} from "@/lib/api-hooks";
import type { Patient } from "@/types/api";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { Select } from "@/components/common/select";
import { pushToast } from "@/lib/toast";
import { printAppointmentSlip } from "@/lib/print-utils";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeSchedulingReason(reason: string): string {
  switch (reason) {
    case "standard_capacity_exhausted":
      return "Daily capacity reached";
    case "special_quota_exhausted":
      return "Special quota reached";
    case "modality_blocked_rule_match":
      return "Blocked for this modality";
    case "modality_blocked_overridable":
      return "Needs supervisor approval";
    case "exam_type_not_allowed_for_rule":
      return "Exam type not allowed";
    case "malformed_rule_configuration":
      return "Rule needs review";
    case "modality_not_found":
    case "exam_type_not_found":
    case "exam_type_modality_mismatch":
      return "Scheduling configuration issue";
    default:
      return "Scheduling restriction";
  }
}

function getAvailabilityLabel(day: Record<string, unknown>): string {
  const status = String(day.displayStatus || "");
  if (status === "restricted") return "Needs supervisor approval";
  if (status === "blocked") return "Not available";
  if (day.is_bookable === true) return "Available";
  return "Not available";
}

function getAvailabilityNote(day: Record<string, unknown>): string {
  const status = String(day.displayStatus || "");
  const remaining = Number(day.remaining_capacity);
  if (status === "restricted" || status === "blocked") {
    const reason = Array.isArray(day.blockReasons) && day.blockReasons.length > 0
      ? describeSchedulingReason(String(day.blockReasons[0]))
      : "";
    return reason || getAvailabilityLabel(day);
  }
  if (day.is_bookable === true) {
    return Number.isFinite(remaining) ? `${remaining} slots left` : "Available";
  }
  if (day.is_full) return "Fully booked";
  return "Not available";
}

interface AppointmentForm {
  patientId: string;
  patientSearch: string;
  modalityId: string;
  examTypeId: string;
  reportingPriorityId: string;
  appointmentDate: string;
  notes: string;
  isWalkIn: boolean;
  caseCategory: "oncology" | "non_oncology";
  useSpecialQuota: boolean;
  specialReasonCode: string;
  specialReasonNote: string;
  includeOverrideCandidates: boolean;
  supervisorUsername: string;
  supervisorPassword: string;
}

const DEFAULT_FORM: AppointmentForm = {
  patientId: "",
  patientSearch: "",
  modalityId: "",
  examTypeId: "",
  reportingPriorityId: "",
  appointmentDate: "",
  notes: "",
  isWalkIn: false,
  caseCategory: "non_oncology",
  useSpecialQuota: false,
  specialReasonCode: "",
  specialReasonNote: "",
  includeOverrideCandidates: false,
  supervisorUsername: "",
  supervisorPassword: ""
};

export default function AppointmentsPage() {
  const [searchParams] = useSearchParams();
  const urlPatientId = searchParams.get("patientId");
  const [form, setForm] = useState<AppointmentForm>(DEFAULT_FORM);
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [postCreateAppointment, setPostCreateAppointment] = useState<AppointmentWithDetails | null>(null);
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [pendingAppointment, setPendingAppointment] = useState<Record<string, unknown> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [showBlockedDates, setShowBlockedDates] = useState(false);
  const schedulingSettingsRecord = schedulingSettings as Record<string, string> | undefined;
  const pageDays = parseInt(schedulingSettingsRecord?.calendar_window_days ?? "14", 10) || 14;
  const availOffset = availPage * pageDays;

  const modalities = lookups?.modalities ?? [];
  const examTypes = lookups?.examTypes ?? [];
  const priorities = lookups?.priorities ?? [];

  // Load availability for selected modality
  const { data: availability } = useQuery({
    queryKey: [
      "availability",
      form.modalityId,
      form.examTypeId,
      form.caseCategory,
      form.useSpecialQuota,
      form.specialReasonCode,
      form.includeOverrideCandidates,
      pageDays,
      availOffset
    ],
    queryFn: () =>
      getAppointmentAvailability(parseInt(form.modalityId, 10), pageDays, availOffset, {
        examTypeId: form.examTypeId ? parseInt(form.examTypeId, 10) : undefined,
        caseCategory: form.caseCategory,
        useSpecialQuota: form.useSpecialQuota,
        specialReasonCode: form.specialReasonCode || undefined,
        includeOverrideCandidates: form.includeOverrideCandidates
      }),
    enabled: !!form.modalityId,
    staleTime: 1000 * 30
  });
  const availabilityRows = availability ?? [];
  const displayRows = showBlockedDates ? availabilityRows : availabilityRows.filter((day: any) => day.displayStatus !== "blocked");

  // Track the selected date's scheduling status for banner/override visibility
  const selectedDateStatus = useMemo(() => {
    if (!form.appointmentDate || !availability) return null;
    const day = availability.find((d: any) => normalizeDateKey(d.appointment_date) === form.appointmentDate);
    if (!day) return null;
    return {
      displayStatus: String(day.displayStatus || ""),
      requiresSupervisorOverride: Boolean(day.requiresSupervisorOverride),
      blockReasons: Array.isArray(day.blockReasons) ? day.blockReasons : []
    };
  }, [form.appointmentDate, availability]);

  useEffect(() => {
    if (!selectedDateStatus?.requiresSupervisorOverride) {
      setForm((f) => {
        if (!f.supervisorUsername && !f.supervisorPassword) return f;
        return { ...f, supervisorUsername: "", supervisorPassword: "" };
      });
    }
  }, [selectedDateStatus?.requiresSupervisorOverride]);

  // Next open slot suggestion after selecting patient + modality
  const { data: suggestionAvailability, isFetching: isSuggestionLoading } = useQuery({
    queryKey: [
      "availability-next-open",
      form.modalityId,
      form.examTypeId,
      form.caseCategory,
      form.useSpecialQuota,
      form.specialReasonCode,
      form.includeOverrideCandidates
    ],
    queryFn: () =>
      getAppointmentSuggestions({
        modalityId: parseInt(form.modalityId, 10),
        examTypeId: form.examTypeId ? parseInt(form.examTypeId, 10) : undefined,
        caseCategory: form.caseCategory,
        useSpecialQuota: form.useSpecialQuota,
        specialReasonCode: form.specialReasonCode || undefined,
        includeOverrideCandidates: form.includeOverrideCandidates,
        days: 180
      }),
    enabled: !!form.modalityId,
    staleTime: 1000 * 30
  });
  const suggestionInfo = useMemo(() => {
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
    // Prefer a truly bookable day first.
    const bookable = rows.find((day: any) => {
      if (day.is_bookable !== true) return false;
      const dayKey = normalizeDateKey(day.appointment_date);
      if (isAfterTwoPmTripoli && dayKey === today) return false;
      return true;
    });
    if (bookable) {
      return {
        label: "Suggested next available date",
        date: normalizeDateKey(bookable.appointment_date)
      };
    }
    // Fall back to override-required day only when includeOverrideCandidates is on.
    if (form.includeOverrideCandidates) {
      const overrideDay = rows.find((day: any) => {
        if (!day.requiresSupervisorOverride) return false;
        const dayKey = normalizeDateKey(day.appointment_date);
        if (isAfterTwoPmTripoli && dayKey === today) return false;
        return true;
      });
      if (overrideDay) {
        return {
          label: "Earliest date with supervisor override",
          date: normalizeDateKey(overrideDay.appointment_date)
        };
      }
    }
    return null;
  }, [suggestionAvailability, form.includeOverrideCandidates]);

  // Debounced patient search
  const handlePatientSearch = useCallback((query: string) => {
    setForm((f) => ({ ...f, patientSearch: query }));
    
    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current);
    }

    if (query.length > 1) {
      searchTimerRef.current = setTimeout(() => {
        searchPatients(query).then(setPatientResults).catch(console.error);
        searchTimerRef.current = null;
      }, 300);
    } else {
      setPatientResults([]);
      if (searchTimerRef.current !== null) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    }
  }, []);

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
    setShowBlockedDates(false);
  }, [form.modalityId]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

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
    },
    onError: (err: Error) => {
      // Check if this is a supervisor re-auth required error (403)
      if (err.message?.includes("re-authentication") || err.message?.includes("re-authenticate") || err.message?.includes("supervisor")) {
        // Store the pending appointment data and show re-auth modal
        const payload = {
          patientId: parseInt(form.patientId, 10),
          modalityId: parseInt(form.modalityId, 10),
          examTypeId: form.examTypeId ? parseInt(form.examTypeId, 10) : undefined,
          reportingPriorityId: form.reportingPriorityId
            ? parseInt(form.reportingPriorityId, 10)
            : undefined,
          appointmentDate: form.appointmentDate,
          notes: form.notes || undefined,
          isWalkIn: form.isWalkIn,
          caseCategory: form.caseCategory,
          useSpecialQuota: form.useSpecialQuota,
          specialReasonCode: form.specialReasonCode || undefined,
          specialReasonNote: form.specialReasonNote || undefined,
          supervisorUsername: form.supervisorUsername || undefined,
          supervisorPassword: form.supervisorPassword || undefined,
          override: {
            supervisorUsername: form.supervisorUsername || undefined,
            supervisorPassword: form.supervisorPassword || undefined,
            reason: form.specialReasonNote || form.notes || "Scheduling override"
          }
        };
        setPendingAppointment(payload);
        setShowReAuthModal(true);
      } else {
        // Show regular error
        pushToast({
          type: "error",
          title: "Failed to create appointment",
          message: err.message
        });
      }
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
      isWalkIn: form.isWalkIn,
      caseCategory: form.caseCategory,
      useSpecialQuota: form.useSpecialQuota,
      specialReasonCode: form.specialReasonCode || undefined,
      specialReasonNote: form.specialReasonNote || undefined,
      supervisorUsername: form.supervisorUsername || undefined,
      supervisorPassword: form.supervisorPassword || undefined,
      override: {
        supervisorUsername: form.supervisorUsername || undefined,
        supervisorPassword: form.supervisorPassword || undefined,
        reason: form.specialReasonNote || form.notes || "Scheduling override"
      }
    });
  };

  const handleSafetyConfirm = () => {
    setSafetyAcknowledged(true);
    submitAppointment();
  };

  const handleReAuthSuccess = () => {
    setShowReAuthModal(false);
    if (pendingAppointment) {
      createMutation.mutate(pendingAppointment as Parameters<typeof createAppointment>[0]);
      setPendingAppointment(null);
    }
  };

  const filteredExamTypes = examTypes.filter(
    (et) => et.modalityId?.toString() === form.modalityId
  );

  return (
    <>
      <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        Create Appointment TEST
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
                  label="Exam type"
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
                <Select
                  label="Case Category"
                  value={form.caseCategory}
                  onChange={(v) => setForm((f) => ({ ...f, caseCategory: (v as "oncology" | "non_oncology") || "non_oncology" }))}
                  options={[
                    { value: "non_oncology", label: "Non-oncology" },
                    { value: "oncology", label: "Oncology" }
                  ]}
                />
                <div className="md:col-span-2 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/30">
                  <details className="group p-3">
                    <summary className="cursor-pointer list-none text-sm font-medium text-stone-700 dark:text-stone-300 flex items-center justify-between gap-3">
                      <span>Advanced scheduling options</span>
                      <span className="text-xs text-stone-500 dark:text-stone-400 group-open:hidden">Show</span>
                      <span className="text-xs text-stone-500 dark:text-stone-400 hidden group-open:inline">Hide</span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        Use these only when a booking needs an exception.
                      </p>
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                        <input
                          type="checkbox"
                          checked={form.useSpecialQuota}
                          onChange={(e) => setForm((f) => ({ ...f, useSpecialQuota: e.target.checked }))}
                        />
                        Use special quota
                      </label>
                      {form.useSpecialQuota && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            value={form.specialReasonCode}
                            onChange={(e) => setForm((f) => ({ ...f, specialReasonCode: e.target.value }))}
                            placeholder="Reason code"
                            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white"
                          />
                          <input
                            value={form.specialReasonNote}
                            onChange={(e) => setForm((f) => ({ ...f, specialReasonNote: e.target.value }))}
                            placeholder="Short note (optional)"
                            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white"
                          />
                        </div>
                      )}
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                        <input
                          type="checkbox"
                          checked={form.includeOverrideCandidates}
                          onChange={(e) => setForm((f) => ({ ...f, includeOverrideCandidates: e.target.checked }))}
                        />
                        Show dates needing supervisor approval
                      </label>
                    </div>
                  </details>
                </div>
                <div className="md:col-span-2">
                  <DateInput
                    label="Appointment date"
                    value={form.appointmentDate}
                    onChange={(v) => setForm((f) => ({ ...f, appointmentDate: v }))}
                  />
                  <div className="mt-2 rounded-xl border border-emerald-200/70 dark:border-emerald-800/70 bg-emerald-50/60 dark:bg-emerald-900/10 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 font-semibold">
                      Suggested next available date
                    </p>
                    <div className="mt-1 text-xs">
                      {!form.modalityId ? (
                        <p className="text-stone-500 dark:text-stone-400">
                          Select a modality to see a suggestion.
                        </p>
                      ) : suggestionInfo ? (
                        <div className="text-emerald-800 dark:text-emerald-300">
                          {suggestionInfo.label}: {formatDateLy(suggestionInfo.date)}
                          <button
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, appointmentDate: suggestionInfo.date }))}
                            className="ml-2 underline underline-offset-2"
                          >
                            Use this date
                          </button>
                        </div>
                      ) : isSuggestionLoading ? (
                        <p className="text-stone-500 dark:text-stone-400">Finding the next date…</p>
                      ) : (
                        <p className="text-stone-500 dark:text-stone-400">No suggestion available yet.</p>
                      )}
                    </div>
                  </div>
                  {selectedDateStatus?.requiresSupervisorOverride && (
                    <div className="mt-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-2">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                        This date needs supervisor approval.
                      </p>
                      {selectedDateStatus.blockReasons.length > 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          {describeSchedulingReason(selectedDateStatus.blockReasons[0])}
                        </p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          value={form.supervisorUsername}
                          onChange={(e) => setForm((f) => ({ ...f, supervisorUsername: e.target.value }))}
                          placeholder="Supervisor username"
                          className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
                        />
                        <input
                          type="password"
                          value={form.supervisorPassword}
                          onChange={(e) => setForm((f) => ({ ...f, supervisorPassword: e.target.value }))}
                          placeholder="Supervisor password"
                          className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
                        />
                      </div>
                    </div>
                  )}
                  {availability && form.appointmentDate && (
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {(() => {
                        const day = availability.find((d: any) => normalizeDateKey(d.appointment_date) === form.appointmentDate);
                        if (!day) return "No data for this date";
                        return `${getAvailabilityLabel(day)} · ${getAvailabilityNote(day)}`;
                      })()}
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
                  onClick={() => setShowBlockedDates((v) => !v)}
                  className="text-xs text-teal-700 dark:text-teal-300 underline underline-offset-2"
                >
                  {showBlockedDates ? "Hide blocked dates" : "Show blocked dates"}
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
                    const displayStatus = String(day.displayStatus || "");
                    const isBlocked = displayStatus === "blocked";
                    const isRestricted = displayStatus === "restricted";
                    const statusLabel = getAvailabilityLabel(day);
                    const statusNote = getAvailabilityNote(day);

                    // Blocked rows: not clickable, reduced opacity, not-allowed cursor
                    if (isBlocked) {
                      return (
                        <li key={dateStr} className="space-y-1">
                          {showWeekHeader && (
                            <div className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-semibold border-t border-stone-200 dark:border-stone-700 mt-3 pt-2">
                              Week of {dateFormatted}
                            </div>
                          )}
                          <div className="rounded p-1.5 opacity-50 cursor-not-allowed border border-transparent">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-medium text-stone-400 dark:text-stone-500">
                                {weekday} {dateFormatted}
                              </span>
                              <span className="tabular-nums text-stone-400 dark:text-stone-500">
                                {day.remaining_capacity}/{day.daily_capacity}
                              </span>
                            </div>
                            <div className="mt-1">
                              <div className="text-[10px] uppercase tracking-wide text-red-600 dark:text-red-400 font-medium">
                                {statusLabel}
                              </div>
                              <div className="text-[10px] text-stone-500 dark:text-stone-400">
                                {statusNote}
                              </div>
                            </div>
                            <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-stone-600 overflow-hidden mt-1">
                              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${occupancyPct}%` }} />
                            </div>
                          </div>
                        </li>
                      );
                    }

                    // Restricted rows: show override messaging
                    if (isRestricted) {
                      return (
                        <li key={dateStr} className="space-y-1">
                          {showWeekHeader && (
                            <div className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-semibold border-t border-stone-200 dark:border-stone-700 mt-3 pt-2">
                              Week of {dateFormatted}
                            </div>
                          )}
                          <div
                            onClick={() => setForm((f) => ({ ...f, appointmentDate: dateStr }))}
                            className={`cursor-pointer rounded p-1.5 transition-colors border ${
                              isSelected
                                ? "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700"
                                : "hover:bg-amber-50 dark:hover:bg-amber-900/10 border-amber-200 dark:border-amber-800"
                            }`}
                          >
                            <div className="flex justify-between items-center text-xs">
                              <span className={`font-medium ${isSelected ? "text-amber-700 dark:text-amber-300" : "text-stone-700 dark:text-stone-300"}`}>
                                {weekday} {dateFormatted}
                              </span>
                              <span className="tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
                                {day.remaining_capacity}/{day.daily_capacity}
                              </span>
                            </div>
                            <div className="mt-1">
                              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
                                {statusLabel}
                              </span>
                              <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-1">
                                {statusNote}
                              </div>
                            </div>
                            <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-stone-600 overflow-hidden mt-1">
                              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${occupancyPct}%` }} />
                            </div>
                          </div>
                        </li>
                      );
                    }

                    // Available rows: normal click behavior
                    return (
                      <li key={dateStr} className="space-y-1">
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
                          <div className="mt-1">
                            <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-medium">
                              {statusLabel}
                            </div>
                            <div className="text-[10px] text-stone-500 dark:text-stone-400">
                              {statusNote}
                            </div>
                          </div>
                          <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-stone-600 overflow-hidden mt-1">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${occupancyPct}%` }} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {!showBlockedDates && displayRows.length === 0 && (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    No available dates on this page. Click "Show blocked dates" or go to Later.
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
              onClick={() => printAppointmentSlip(postCreateAppointment)}
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

    {/* Supervisor Re-Auth Modal for Overbooking */}
    {showReAuthModal && (
      <SupervisorReAuthModal
        onClose={() => { setShowReAuthModal(false); setPendingAppointment(null); }}
        onSuccess={handleReAuthSuccess}
      />
    )}
    </>
  );
}

function normalizeDateKey(rawDate: unknown): string {
  if (typeof rawDate === "string") {
    return rawDate.slice(0, 10);
  }
  return new Date(String(rawDate)).toISOString().slice(0, 10);
}

function toUtcDateFromIsoDay(isoDay: string): Date {
  const [yStr, mStr, dStr] = isoDay.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  return new Date(Date.UTC(y, m - 1, d));
}
