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
import type {
  SchedulingDecisionDto,
  CaseCategory,
  CreateBookingRequest,
  BookingWithPatientInfo,
} from "../types";

interface RescheduleDialogProps {
  booking: BookingWithPatientInfo;
  availableDates: string[];
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
  availableDates,
  caseCategory,
  examTypeId,
  onReschedule,
  onCancel,
  error,
}: RescheduleDialogProps) {
  const [newDate, setNewDate] = useState("");
  const [decision, setDecision] = useState<SchedulingDecisionDto | null>(null);
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
      return;
    }

    setEvaluating(true);
    setDecision(null);
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
      .catch(() => {
        setDecision(null);
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
    } finally {
      setSubmitting(false);
    }
  };

  const isDateAvailable = availableDates.length > 0;
  const isBlocked = decision?.displayStatus === "blocked";

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)" }} />

      {/* Dialog */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 480,
          margin: "0 16px",
          padding: 24,
          borderRadius: 12,
          backgroundColor: "var(--bg-surface, #fff)",
          border: "1px solid var(--border-color, #e2e8f0)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: "50%",
              backgroundColor: "var(--bg-info, #dbeafe)",
              color: "var(--color-info, #3b82f6)",
            }}
          >
            <CalendarClock size={20} />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Reschedule Booking</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: 0 }}>
              {booking.patientEnglishName ?? `Patient #${booking.patientId}`} — {booking.bookingDate}
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: 6,
              backgroundColor: "var(--bg-error, #fef2f2)",
              border: "1px solid var(--border-error, #fecaca)",
              fontSize: 13,
              color: "var(--color-error, #ef4444)",
            }}
          >
            {error}
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
                  {availableDates
                    .filter((d) => d !== booking.bookingDate)
                    .map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                </select>
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>
                  No available dates to select from.
                </p>
              )}
            </div>

            {/* Decision Status */}
            {evaluating && (
              <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>Evaluating availability…</div>
            )}

            {decision && !evaluating && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  backgroundColor:
                    decision.displayStatus === "available"
                      ? "var(--bg-success, #dcfce7)"
                      : decision.displayStatus === "restricted"
                      ? "var(--bg-warning, #fef3c7)"
                      : "var(--bg-error, #fee2e2)",
                  border: `1px solid ${
                    decision.displayStatus === "available"
                      ? "var(--border-success, #bbf7d0)"
                      : decision.displayStatus === "restricted"
                      ? "var(--border-warning, #fde68a)"
                      : "var(--border-error, #fecaca)"
                  }`,
                  color:
                    decision.displayStatus === "available"
                      ? "var(--color-success, #15803d)"
                      : decision.displayStatus === "restricted"
                      ? "var(--color-warning, #b45309)"
                      : "var(--color-error, #dc2626)",
                }}
              >
                {decision.displayStatus === "available" && (
                  <span>
                    ✅ Available — {decision.remainingStandardCapacity ?? 0} slots remaining
                  </span>
                )}
                {decision.displayStatus === "restricted" && decision.requiresSupervisorOverride && (
                  <span>⚠️ Supervisor approval required</span>
                )}
                {decision.displayStatus === "blocked" && (
                  <span>❌ Date is blocked for this modality</span>
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
                  <input
                    type="text"
                    value={overrideUsername}
                    onChange={(e) => setOverrideUsername(e.target.value)}
                    autoComplete="username"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border-color, #e2e8f0)",
                      fontSize: 14,
                    }}
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
                  <input
                    ref={overridePasswordRef}
                    type="password"
                    value={overridePassword}
                    onChange={(e) => setOverridePassword(e.target.value)}
                    autoComplete="current-password"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border-color, #e2e8f0)",
                      fontSize: 14,
                    }}
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
                  <input
                    type="text"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Why is this reschedule needed?"
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
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                border: "1px solid var(--border-color, #e2e8f0)",
                backgroundColor: "var(--bg-surface, #fff)",
                fontSize: 14,
                fontWeight: 500,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                !newDate ||
                isBlocked ||
                evaluating ||
                submitting ||
                (showOverride &&
                  (!overrideUsername.trim() || !overridePassword.trim() || !overrideReason.trim()))
              }
              style={{
                padding: "8px 20px",
                borderRadius: 6,
                border: "none",
                backgroundColor: isBlocked || !newDate ? "var(--border-color, #e2e8f0)" : "var(--color-info, #3b82f6)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor:
                  !newDate || isBlocked || evaluating || submitting
                    ? "not-allowed"
                    : "pointer",
                opacity: !newDate || isBlocked || evaluating || submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Rescheduling…" : "Reschedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
