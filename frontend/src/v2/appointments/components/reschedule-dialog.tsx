/**
 * Appointments V2 — Reschedule dialog component.
 *
 * Allows rescheduling an existing booking to a new date/time.
 * Pre-evaluates the scheduling decision for the new date; if override is required,
 * it collects supervisor credentials before submitting.
 * Follows the inline modal pattern from existing V2 components.
 */

import { useState, useEffect, useRef } from "react";
import { CalendarClock } from "lucide-react";
import { evaluateV2Scheduling } from "../api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/shared/Dialog";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";
import type {
  SchedulingDecisionDto,
  CaseCategory,
  CreateBookingRequest,
  BookingWithPatientInfo,
  AvailabilityDayDto,
} from "../types";

interface RescheduleDialogProps {
  booking: BookingWithPatientInfo;
  availabilityItems: AvailabilityDayDto[];
  caseCategory: CaseCategory;
  examTypeId: number | null;
  onReschedule: (
    newDate: string,
    newTime: string | null,
    override?: CreateBookingRequest["override"]
  ) => Promise<void>;
  onCancel: () => void;
  error?: string | null;
}

export function RescheduleDialog({
  booking,
  availabilityItems,
  caseCategory,
  examTypeId,
  onReschedule,
  onCancel,
  error,
}: RescheduleDialogProps) {
  const [newDate, setNewDate] = useState("");
  const [decision, setDecision] = useState<SchedulingDecisionDto | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Override state
  const [showOverride, setShowOverride] = useState(false);
  const [overrideUsername, setOverrideUsername] = useState("");
  const [overridePassword, setOverridePassword] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const overridePasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    overridePasswordRef.current?.focus();
  }, [showOverride]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  // Pre-evaluate when date changes
  useEffect(() => {
    if (!newDate) {
      setDecision(null);
      setEvaluationError(null);
      return;
    }

    setEvaluating(true);
    setDecision(null);
    setEvaluationError(null);
    setShowOverride(false);

    evaluateV2Scheduling({
      patientId: booking.patientId,
      modalityId: booking.modalityId,
      examTypeId,
      scheduledDate: newDate,
      caseCategory,
      useSpecialQuota: false,
      specialReasonCode: null,
      includeOverrideEvaluation: true,
    })
      .then((result) => {
        setDecision(result);
        if (result.requiresSupervisorOverride) {
          setShowOverride(true);
        }
      })
      .catch((err) => {
        setDecision(null);
        const message = err instanceof Error ? err.message : "Could not evaluate this date";
        setEvaluationError(`Could not evaluate selected date: ${message}`);
      })
      .finally(() => {
        setEvaluating(false);
      });
  }, [newDate, booking, examTypeId, caseCategory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newDate) return;

    // If override is required, validate supervisor fields
    if (decision?.requiresSupervisorOverride) {
      if (!overrideUsername.trim() || !overridePassword.trim() || !overrideReason.trim()) {
        return;
      }
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      const override = decision?.requiresSupervisorOverride
        ? {
            supervisorUsername: overrideUsername.trim(),
            supervisorPassword: overridePassword,
            reason: overrideReason.trim(),
          }
        : undefined;

      await onReschedule(newDate, null, override);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reschedule failed";
      setSubmitError(`Could not reschedule booking: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const isDateAvailable = availabilityItems.length > 0;
  const isBlocked = decision?.displayStatus === "blocked";

  // Derive selectable dates from availability items:
  // - Exclude blocked dates
  // - Exclude the current booking date
  // - Keep restricted dates (override possible) and available dates
  const selectableDates = availabilityItems
    .filter((item) => item.decision.displayStatus !== "blocked")
    .filter((item) => item.date !== booking.bookingDate);

  return (
    <Dialog open={true} onClose={onCancel}>
      <DialogContent maxWidth="480px">
        <DialogHeader showClose={false}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                borderRadius: "50%",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                color: "var(--blue)",
              }}
            >
              <CalendarClock size={20} />
            </div>
            <div>
              <DialogTitle>Reschedule Booking</DialogTitle>
              <DialogDescription>
                {booking.patientEnglishName ?? `Patient #${booking.patientId}`} — {booking.bookingDate}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: "var(--radius-md)",
              backgroundColor: "rgba(255, 71, 87, 0.1)",
              border: "1px solid rgba(255, 71, 87, 0.3)",
              fontSize: 13,
              color: "var(--accent)",
            }}
          >
            {error}
          </div>
        )}
        {!error && (submitError || evaluationError) && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: "var(--radius-md)",
              backgroundColor: "rgba(255, 71, 87, 0.1)",
              border: "1px solid rgba(255, 71, 87, 0.3)",
              fontSize: 13,
              color: "var(--accent)",
            }}
          >
            {submitError ?? evaluationError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* New Date */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text-primary, #1e293b)",
                }}
              >
                New Date
              </label>
              {isDateAvailable ? (
                <select
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color, #e2e8f0)",
                    fontSize: 14,
                  }}
                >
                  <option value="">Select a date…</option>
                  {selectableDates.map((item) => {
                    const isRestricted = item.decision.displayStatus === "restricted";
                    const label = isRestricted
                      ? `${item.date} — Restricted (override required)`
                      : item.date;
                    return (
                      <option key={item.date} value={item.date}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>
                  No available dates to select from.
                </p>
              )}
            </div>

            {/* Decision Status */}
            {evaluating && (
              <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>
                Evaluating selected date…
              </div>
            )}

             {decision && !evaluating && (
               <div
                 style={{
                   padding: "8px 12px",
                   borderRadius: "var(--radius-md)",
                   fontSize: 13,
                   backgroundColor:
                     decision.displayStatus === "available"
                       ? "rgba(34, 197, 94, 0.1)"
                       : decision.displayStatus === "restricted"
                       ? "rgba(245, 158, 11, 0.1)"
                       : "rgba(255, 71, 87, 0.1)",
                   border: `1px solid ${
                     decision.displayStatus === "available"
                       ? "rgba(34, 197, 94, 0.3)"
                       : decision.displayStatus === "restricted"
                       ? "rgba(245, 158, 11, 0.3)"
                       : "rgba(255, 71, 87, 0.3)"
                   }`,
                   color:
                     decision.displayStatus === "available"
                       ? "var(--green)"
                       : decision.displayStatus === "restricted"
                       ? "var(--amber)"
                       : "var(--accent)",
                 }}
               >
                {decision.displayStatus === "available" && (
                  <span>
                    ✅ Available — {decision.remainingStandardCapacity ?? 0} slots remaining
                  </span>
                )}
                {decision.displayStatus === "restricted" && decision.requiresSupervisorOverride && (
                  <span>⚠️ Supervisor approval is required for this date.</span>
                )}
                {decision.displayStatus === "blocked" && (
                  <span>❌ Date is blocked for this modality.</span>
                )}
                {decision.reasons.length > 0 && (
                  <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                    {decision.reasons.map((r, i) => (
                      <li key={i} style={{ fontSize: 12 }}>
                        {r.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Override Fields */}
            {showOverride && decision?.requiresSupervisorOverride && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 4,
                      color: "var(--text-primary, #1e293b)",
                    }}
                  >
                    Supervisor Username
                  </label>
                   <Input
                     type="text"
                     value={overrideUsername}
                     onChange={(e) => setOverrideUsername(e.target.value)}
                     autoComplete="username"
                   />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 4,
                      color: "var(--text-primary, #1e293b)",
                    }}
                  >
                    Password
                  </label>
                   <Input
                     ref={overridePasswordRef}
                     type="password"
                     value={overridePassword}
                     onChange={(e) => setOverridePassword(e.target.value)}
                     autoComplete="current-password"
                   />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 4,
                      color: "var(--text-primary, #1e293b)",
                    }}
                  >
                    Override Reason
                  </label>
                   <Input
                     type="text"
                     value={overrideReason}
                     onChange={(e) => setOverrideReason(e.target.value)}
                     placeholder="Why is this reschedule needed?"
                   />
                </div>
              </div>
            )}
           </div>

             <DialogFooter>
               <Button
                 variant="secondary"
                 type="button"
                 onClick={onCancel}
                 disabled={submitting}
               >
                 Cancel
               </Button>
               <Button
                 type="submit"
                 disabled={
                   !newDate ||
                   isBlocked ||
                   !!evaluationError ||
                   evaluating ||
                   submitting ||
                   (showOverride &&
                     (!overrideUsername.trim() || !overridePassword.trim() || !overrideReason.trim()))
                 }
                 style={{
                   backgroundColor: isBlocked || !newDate ? "var(--border)" : "var(--blue)",
                   color: "#fff",
                 }}
               >
                 {submitting ? "Rescheduling…" : "Reschedule"}
               </Button>
             </DialogFooter>
           </form>
      </DialogContent>
    </Dialog>
  );
}
