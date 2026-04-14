/**
 * Appointments V2 — Booking form component.
 *
 * Collects patient, date, exam type, case category, and notes for creating a booking.
 * If the evaluate decision requires override, shows the OverrideDialog.
 * Uses the existing `useV2CreateBooking` mutation and `evaluateV2Scheduling` for pre-check.
 */

import { useState, useEffect } from "react";
import { Calendar, Plus, Loader2 } from "lucide-react";
import { pushToast } from "@/lib/toast";
import { useV2CreateBooking, evaluateV2Scheduling, useV2SpecialReasonCodes } from "../api";
import { PatientSearch } from "./patient-search";
import { OverrideDialog } from "./override-dialog";
import type {
  AvailabilityDayDto,
  CreateBookingRequest,
  ModalityDto,
  SchedulingDecisionDto,
} from "../types";

interface Patient {
  id: number;
  arabicFullName: string;
  englishFullName?: string | null;
  nationalId?: string | null;
  medicalRecordNo?: string | null;
  phone?: string | null;
}

interface BookingFormProps {
  modalities: ModalityDto[];
  availability: AvailabilityDayDto[];
  selectedModalityId: number | null;
  selectedExamTypeId: number | null;
  caseCategory: "oncology" | "non_oncology";
  onBookingSuccess: () => void;
}

export function BookingForm({
  modalities,
  availability,
  selectedModalityId,
  selectedExamTypeId,
  caseCategory,
  onBookingSuccess,
}: BookingFormProps) {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [useSpecialQuota, setUseSpecialQuota] = useState(false);
  const [specialReasonCode, setSpecialReasonCode] = useState<string>("");
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Override state
  const [showOverride, setShowOverride] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [pendingBooking, setPendingBooking] = useState<CreateBookingRequest | null>(null);

  const createBooking = useV2CreateBooking();
  const specialReasons = useV2SpecialReasonCodes();

  const modality = modalities.find((m) => m.id === selectedModalityId);

  // Reset form when modality changes
  useEffect(() => {
    setSelectedDate("");
    setSelectedPatient(null);
    setNotes("");
    setUseSpecialQuota(false);
    setSpecialReasonCode("");
  }, [selectedModalityId]);

  const availableDates = availability
    .filter((d) => d.decision.displayStatus === "available" || d.decision.displayStatus === "restricted")
    .map((d) => d.date);
  const hasSpecialReasons = (specialReasons.data?.length ?? 0) > 0;
  const specialReasonsUnavailable = useSpecialQuota && !specialReasons.isLoading && !specialReasons.isError && !hasSpecialReasons;
  const missingSpecialReasonSelection = useSpecialQuota && !specialReasonCode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);

    if (!selectedPatient || !selectedModalityId || !selectedDate) {
      pushToast({
        type: "error",
        title: "Validation Error",
        message: "Please select a patient, modality, and date.",
      });
      return;
    }

    if (useSpecialQuota && specialReasons.isError) {
      pushToast({
        type: "error",
        title: "Special Quota Unavailable",
        message: "Special reason codes could not be loaded. Try again before submitting.",
      });
      return;
    }

    if (specialReasonsUnavailable) {
      pushToast({
        type: "error",
        title: "Special Quota Unavailable",
        message: "No active special reason codes are configured. Contact a supervisor.",
      });
      return;
    }

    if (missingSpecialReasonSelection) {
      pushToast({
        type: "error",
        title: "Validation Error",
        message: "Select a special reason before creating a special quota booking.",
      });
      return;
    }

    const request: CreateBookingRequest = {
      patientId: selectedPatient.id,
      modalityId: selectedModalityId,
      examTypeId: selectedExamTypeId,
      reportingPriorityId: null,
      bookingDate: selectedDate,
      bookingTime: null,
      caseCategory,
      useSpecialQuota,
      specialReasonCode: useSpecialQuota ? specialReasonCode || null : null,
      notes: notes.trim() || null,
    };

    // Pre-evaluate to check if override is needed
    try {
      const decision: SchedulingDecisionDto = await evaluateV2Scheduling({
        patientId: selectedPatient.id,
        modalityId: selectedModalityId,
        examTypeId: selectedExamTypeId ?? null,
        scheduledDate: selectedDate,
        caseCategory,
        useSpecialQuota,
        specialReasonCode: useSpecialQuota ? specialReasonCode || null : null,
        includeOverrideEvaluation: false,
      });

      if (decision.requiresSupervisorOverride) {
        // Show override dialog
        setPendingBooking(request);
        setShowOverride(true);
        setOverrideError(null);
        pushToast({
          type: "error",
          title: "Supervisor Override Required",
          message: "This booking needs supervisor approval before it can be saved.",
        });
        return;
      }

      if (!decision.isAllowed) {
        const reason = decision.reasons[0]?.message ?? "Booking not allowed for the selected date.";
        pushToast({ type: "error", title: "Booking Not Allowed", message: reason });
        return;
      }

      // Proceed with booking
      await createBooking.mutateAsync(request);
      pushToast({
        type: "success",
        title: "Booking Created",
        message: `${selectedPatient.englishFullName} was booked for ${selectedDate}.`,
      });
      resetForm();
      onBookingSuccess();
    } catch (err) {
      const fallbackName = selectedPatient.englishFullName || selectedPatient.arabicFullName || `Patient #${selectedPatient.id}`;
      pushToast({
        type: "error",
        title: "Booking Failed",
        message: err instanceof Error ? `${fallbackName}: ${err.message}` : `${fallbackName}: Unable to create booking.`,
      });
    }
  };

  const handleOverrideSubmit = async (username: string, password: string, reason: string) => {
    if (!pendingBooking) return;

    try {
      const requestWithOverride: CreateBookingRequest = {
        ...pendingBooking,
        override: {
          supervisorUsername: username,
          supervisorPassword: password,
          reason,
        },
      };

      await createBooking.mutateAsync(requestWithOverride);
      pushToast({
        type: "success",
        title: "Booking Created (Override)",
        message: `${selectedPatient?.englishFullName ?? selectedPatient?.arabicFullName ?? "Patient"} was booked for ${pendingBooking.bookingDate} with supervisor override.`,
      });
      setShowOverride(false);
      setPendingBooking(null);
      setOverrideError(null);
      resetForm();
      onBookingSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      setOverrideError(`Override failed: ${message}`);
    }
  };

  const resetForm = () => {
    setSelectedPatient(null);
    setSelectedDate("");
    setNotes("");
    setUseSpecialQuota(false);
    setSpecialReasonCode("");
    setSubmitAttempted(false);
  };

  const handleClearPatient = () => {
    setSelectedPatient(null);
  };

  return (
    <>
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          backgroundColor: "var(--bg-surface, #f8fafc)",
          border: "1px solid var(--border-color, #e2e8f0)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Plus size={18} />
          New Booking
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Patient Search */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 4,
                  color: "var(--text-muted, #64748b)",
                }}
              >
                Patient
              </label>
              <PatientSearch
                onSelect={setSelectedPatient}
                selectedPatient={selectedPatient}
                onClear={handleClearPatient}
              />
            </div>

            {/* Modality + Date row */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 4,
                    color: "var(--text-muted, #64748b)",
                  }}
                >
                  Modality
                </label>
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color, #e2e8f0)",
                    fontSize: 14,
                    backgroundColor: "var(--bg-input, #fff)",
                    color: "var(--text-primary, #1e293b)",
                  }}
                >
                  {modality?.name ?? "—"}
                </div>
              </div>

              <div style={{ flex: "1 1 200px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 4,
                    color: "var(--text-muted, #64748b)",
                  }}
                >
                  Booking Date
                </label>
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color, #e2e8f0)",
                    fontSize: 14,
                  }}
                >
                  <option value="">Select date…</option>
                  {availableDates.map((date) => {
                    const day = availability.find((d) => d.date === date);
                    const dayStatus = day?.decision.displayStatus;
                    const isBlocked = dayStatus === "blocked";
                    const isRestricted = dayStatus === "restricted";
                    const standard = isBlocked ? null : Math.max(0, day?.decision.remainingStandardCapacity ?? day?.remainingCapacity ?? 0);
                    const special = isBlocked ? null : Math.max(0, day?.decision.remainingSpecialQuota ?? 0);
                    const specialVal = special ?? 0;
                    let label: string;
                    if (isBlocked) {
                      label = `${date} (Blocked)`;
                    } else if (specialVal > 0) {
                      label = `${date} (${standard} standard, ${specialVal} special)`;
                    } else {
                      label = `${date} (${standard} standard)`;
                    }
                    return (
                      <option key={date} value={date}>
                        {label}{isRestricted ? " ⚠️" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Case category + notes row */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "0 1 180px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 4,
                    color: "var(--text-muted, #64748b)",
                  }}
                >
                  Case Category
                </label>
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color, #e2e8f0)",
                    fontSize: 14,
                    backgroundColor: "var(--bg-input, #fff)",
                    color: "var(--text-primary, #1e293b)",
                  }}
                >
                  {caseCategory === "oncology" ? "Oncology" : "Non-Oncology"}
                </div>
              </div>

              <div style={{ flex: "1 1 300px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 4,
                    color: "var(--text-muted, #64748b)",
                  }}
                >
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes…"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color, #e2e8f0)",
                    fontSize: 14,
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={useSpecialQuota}
                  onChange={(e) => {
                    setUseSpecialQuota(e.target.checked);
                    if (!e.target.checked) {
                      setSpecialReasonCode("");
                    }
                  }}
                />
                Use special quota
              </label>
              {useSpecialQuota && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <select
                    value={specialReasonCode}
                    onChange={(e) => setSpecialReasonCode(e.target.value)}
                    disabled={specialReasons.isLoading || specialReasons.isError || !hasSpecialReasons}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border-color, #e2e8f0)",
                      fontSize: 13,
                      minWidth: 230,
                      opacity: specialReasons.isLoading || specialReasons.isError || !hasSpecialReasons ? 0.7 : 1,
                    }}
                  >
                    <option value="">Select special reason…</option>
                    {specialReasons.isLoading && <option value="">Loading…</option>}
                    {!specialReasons.isLoading && specialReasons.data?.map((reason) => (
                      <option key={reason.code} value={reason.code}>
                        {reason.labelEn || reason.code}
                      </option>
                    ))}
                  </select>
                  {specialReasons.isLoading && (
                    <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
                      Loading special reasons…
                    </span>
                  )}
                  {specialReasons.isError && (
                    <span style={{ fontSize: 12, color: "var(--color-error, #ef4444)" }}>
                      Could not load special reasons.
                    </span>
                  )}
                  {specialReasonsUnavailable && (
                    <span style={{ fontSize: 12, color: "var(--color-warning, #b45309)" }}>
                      No active special reasons configured.
                    </span>
                  )}
                  {submitAttempted && missingSpecialReasonSelection && !specialReasons.isLoading && !specialReasons.isError && hasSpecialReasons && (
                    <span style={{ fontSize: 12, color: "var(--color-error, #ef4444)" }}>
                      Please select a special reason to continue.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Submit button */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={
                  !selectedPatient ||
                  !selectedDate ||
                  createBooking.isPending ||
                  missingSpecialReasonSelection ||
                  specialReasonsUnavailable ||
                  (useSpecialQuota && specialReasons.isError)
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 24px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor:
                    !selectedPatient ||
                    !selectedDate ||
                    missingSpecialReasonSelection ||
                    specialReasonsUnavailable ||
                    (useSpecialQuota && specialReasons.isError)
                      ? "var(--border-color, #e2e8f0)"
                      : "var(--color-primary, #3b82f6)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor:
                    !selectedPatient ||
                    !selectedDate ||
                    createBooking.isPending ||
                    missingSpecialReasonSelection ||
                    specialReasonsUnavailable ||
                    (useSpecialQuota && specialReasons.isError)
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    !selectedPatient ||
                    !selectedDate ||
                    missingSpecialReasonSelection ||
                    specialReasonsUnavailable ||
                    (useSpecialQuota && specialReasons.isError)
                      ? 0.6
                      : 1,
                }}
              >
                {createBooking.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Booking…
                  </>
                ) : (
                  <>
                    <Calendar size={16} />
                    Book Appointment
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Override dialog */}
      {showOverride && (
        <OverrideDialog
          onSubmit={handleOverrideSubmit}
          onCancel={() => {
            setShowOverride(false);
            setPendingBooking(null);
            setOverrideError(null);
          }}
          error={overrideError}
        />
      )}
    </>
  );
}
