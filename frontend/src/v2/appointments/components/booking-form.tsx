/**
 * Appointments V2 — Booking form component.
 *
 * Collects patient, date, exam type, case category, and notes for creating a booking.
 * If the evaluate decision requires override, shows the OverrideDialog.
 * Uses the existing `useV2CreateBooking` mutation and `evaluateV2Scheduling` for pre-check.
 */

import { useState, useEffect } from "react";
import { Calendar, Loader2 } from "lucide-react";
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
import { Card, Button } from "@/components/shared";

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
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground">Patient</label>
          <PatientSearch
            caseCategory={caseCategory}
            onSelect={setSelectedPatient}
            selectedPatient={selectedPatient}
            onClear={handleClearPatient}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">Modality</label>
            <div className="input-premium opacity-70">
              {modality?.name ?? "—"}
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">Booking Date</label>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="input-premium input-ltr w-full"
            >
              <option value="">Select date…</option>
              {availableDates.map((date) => {
                const day = availability.find((d) => d.date === date);
                const dayStatus = day?.decision.displayStatus;
                const isBlocked = dayStatus === "blocked";
                const isRestricted = dayStatus === "restricted";
                const totalRemaining = isBlocked ? null : Math.max(0, (day?.modalityTotalCapacity ?? day?.dailyCapacity ?? 0) - (day?.bookedTotal ?? day?.bookedCount ?? 0));
                const special = isBlocked ? null : Math.max(0, day?.decision.remainingSpecialQuota ?? 0);
                const specialVal = special ?? 0;
                let label: string;
                if (isBlocked) {
                  label = `${date} (Blocked)`;
                } else {
                  const modeLabel = day?.bucketMode === "partitioned" ? "partitioned" : "total-only";
                  if (specialVal > 0) {
                    label = `${date} (${totalRemaining} total, ${specialVal} special, ${modeLabel})`;
                  } else {
                    label = `${date} (${totalRemaining} total, ${modeLabel})`;
                  }
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">Case Category</label>
            <div className="input-premium opacity-70">
              {caseCategory === "oncology" ? "Oncology" : "Non-Oncology"}
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-2">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes…"
              className="input-premium input-ltr w-full"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center py-2">
          <label className="flex items-center gap-3 cursor-pointer user-select-none p-2 rounded-lg hover:bg-muted/50">
            <input
              type="checkbox"
              checked={useSpecialQuota}
              onChange={(e) => {
                setUseSpecialQuota(e.target.checked);
                if (!e.target.checked) {
                  setSpecialReasonCode("");
                }
              }}
              className="w-5 h-5 cursor-pointer accent-[var(--accent)]"
            />
            <span className="text-base font-medium">Use special quota</span>
          </label>
          {useSpecialQuota && (
            <div className="flex flex-col gap-2">
              <select
                value={specialReasonCode}
                onChange={(e) => setSpecialReasonCode(e.target.value)}
                disabled={specialReasons.isLoading || specialReasons.isError || !hasSpecialReasons}
                className="input-premium input-ltr"
                style={{
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
                <span className="text-sm text-muted-foreground">
                  Loading special reasons…
                </span>
              )}
              {specialReasons.isError && (
                <span className="text-sm text-red-500">
                  Could not load special reasons.
                </span>
              )}
              {specialReasonsUnavailable && (
                <span className="text-sm text-amber-600">
                  No active special reasons configured.
                </span>
              )}
              {submitAttempted && missingSpecialReasonSelection && !specialReasons.isLoading && !specialReasons.isError && hasSpecialReasons && (
                <span className="text-sm text-red-500">
                  Please select a special reason to continue.
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4 border-t border-border">
          <Button
            type="submit"
            disabled={
              !selectedPatient ||
              !selectedDate ||
              createBooking.isPending ||
              missingSpecialReasonSelection ||
              specialReasonsUnavailable ||
              (useSpecialQuota && specialReasons.isError)
            }
            className="ml-auto"
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
          </Button>
        </div>
        {createBooking.isError && (
          <div className="p-4 rounded-xl border-red-200" style={{ background: "rgba(239, 68, 68, 0.05)", color: "#ef4444" }}>
            <p className="text-sm">{createBooking.error.message}</p>
          </div>
        )}
      </form>

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
    </Card>
  );
}
