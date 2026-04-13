/**
 * Appointments V2 — Appointments page.
 *
 * A new React page that consumes only V2 endpoints.
 * Shows availability calendar with explicit status (D005).
 * Does not use or import any legacy scheduling code.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import { useV2Lookups, useV2ExamTypes, useV2Availability, useV2ListBookings, useV2CancelBooking, useV2RescheduleBooking, useV2Suggestions } from "./api";
import type { CaseCategory, DecisionStatus, AvailabilityDayDto, BookingWithPatientInfo } from "./types";
import { RESCHEDULABLE_STATUSES, CANCELLABLE_STATUSES } from "./types";
import { StatusBadge } from "./components/status-badge";
import { BookingForm } from "./components/booking-form";
import { CancelConfirmDialog } from "./components/cancel-confirm-dialog";
import { RescheduleDialog } from "./components/reschedule-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeReason(code: string): string {
  const map: Record<string, string> = {
    modality_not_found: "Modality not found",
    exam_type_not_found: "Exam type not found",
    exam_type_modality_mismatch: "Exam type not valid for modality",
    malformed_rule_configuration: "Rule configuration error",
    modality_blocked_rule_match: "Date blocked for this modality",
    modality_blocked_overridable: "Date blocked — needs supervisor approval",
    exam_type_not_allowed_for_rule: "Exam type not allowed on this date",
    standard_capacity_exhausted: "Daily capacity reached",
    special_quota_exhausted: "Special quota reached",
    no_published_policy: "No scheduling policy published",
  };
  return map[code] ?? code;
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-LY", { weekday: "short", month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AppointmentsV2Page() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const lookups = useV2Lookups();
  const [modalityId, setModalityId] = useState<number | null>(null);
  const [examTypeId, setExamTypeId] = useState<number | null>(null);
  const [caseCategory, setCaseCategory] = useState<CaseCategory>("non_oncology");
  const [days, setDays] = useState(14);

  // Show explicit error if lookups fail
  if (lookups.isError) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-error, #ef4444)", marginBottom: 8 }}>
          Failed to load modality list
        </p>
        <p style={{ fontSize: 14, color: "var(--text-muted, #64748b)" }}>
          {(lookups.error as Error)?.message ?? "Unknown error"}
        </p>
        <button
          onClick={() => lookups.refetch()}
          style={{
            marginTop: 16,
            padding: "8px 20px",
            borderRadius: 6,
            border: "none",
            background: "var(--color-primary, #3b82f6)",
            color: "#fff",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const examTypes = useV2ExamTypes(modalityId);
  const availability = useV2Availability(
    modalityId != null
      ? {
          modalityId,
          days,
          offset: 0,
          examTypeId,
          caseCategory,
          useSpecialQuota: false,
          specialReasonCode: null,
          includeOverrideCandidates: false,
        }
      : undefined as unknown as Parameters<typeof useV2Availability>[0]
  );
  const suggestions = useV2Suggestions(
    modalityId != null
      ? { modalityId, days, examTypeId, caseCategory }
      : undefined as unknown as Parameters<typeof useV2Suggestions>[0]
  );

  // Bookings: use date range from availability query
  const bookings = useV2ListBookings(
    modalityId != null && availability.data?.items
      ? {
          modalityId,
          dateFrom: availability.data.items[0]?.date ?? "",
          dateTo: availability.data.items[availability.data.items.length - 1]?.date ?? "",
        }
      : null
  );

  const disabled = modalityId == null;
  const noPublishedPolicy = availability.data?.meta?.noPublishedPolicy === true;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>
        Appointments V2
      </h1>
      {user?.role === "supervisor" && (
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => navigate("/v2/appointments/admin")}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              background: "var(--bg-surface, #f8fafc)",
              cursor: "pointer",
            }}
          >
            Open V2 Policy Admin
          </button>
        </div>
      )}

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
          padding: 16,
          borderRadius: 8,
          backgroundColor: "var(--bg-surface, #f8fafc)",
          border: "1px solid var(--border-color, #e2e8f0)",
        }}
      >
        {/* Modality */}
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
          <select
            value={modalityId ?? ""}
            onChange={(e) => {
              setModalityId(e.target.value ? Number(e.target.value) : null);
              setExamTypeId(null);
            }}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              fontSize: 14,
            }}
          >
            <option value="">Select modality…</option>
            {lookups.data?.modalities.map((m: { id: number; name: string }) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Exam Type */}
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
            Exam Type (optional)
          </label>
          <select
            value={examTypeId ?? ""}
            onChange={(e) => setExamTypeId(e.target.value ? Number(e.target.value) : null)}
            disabled={!modalityId}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              fontSize: 14,
              opacity: !modalityId ? 0.5 : 1,
            }}
          >
            <option value="">All exam types</option>
            {examTypes.data?.map((et: { id: number; name: string }) => (
              <option key={et.id} value={et.id}>
                {et.name}
              </option>
            ))}
          </select>
        </div>

        {/* Case Category */}
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
          <select
            value={caseCategory}
            onChange={(e) => setCaseCategory(e.target.value as CaseCategory)}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              fontSize: 14,
            }}
          >
            <option value="non_oncology">Non-Oncology</option>
            <option value="oncology">Oncology</option>
          </select>
        </div>

        {/* Days */}
        <div style={{ flex: "0 1 120px" }}>
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
            Days
          </label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #e2e8f0)",
              fontSize: 14,
            }}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>

      {/* Availability Table */}
      {disabled ? (
        <p style={{ color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>
          Select a modality to view availability.
        </p>
      ) : availability.isLoading ? (
        <p style={{ color: "var(--text-muted, #64748b)" }}>Loading availability…</p>
      ) : availability.isError ? (
        <p style={{ color: "var(--color-error, #ef4444)" }}>
          Error loading availability: {(availability.error as Error).message}
        </p>
      ) : noPublishedPolicy ? (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: "1px solid var(--border-color, #e2e8f0)",
            background: "var(--bg-surface, #f8fafc)",
          }}
        >
          <p style={{ color: "var(--text-primary, #1e293b)", fontWeight: 600, marginBottom: 6 }}>
            No scheduling policy has been published yet.
          </p>
          <p style={{ color: "var(--text-muted, #64748b)", marginBottom: user?.role === "supervisor" ? 12 : 0 }}>
            Availability is currently empty because the V2 policy is not published.
          </p>
          {user?.role === "supervisor" && (
            <button
              type="button"
              onClick={() => navigate("/v2/appointments/admin")}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-color, #e2e8f0)",
                background: "var(--bg-page, #fff)",
                cursor: "pointer",
              }}
            >
              Open V2 Policy Admin
            </button>
          )}
        </div>
      ) : availability.data?.items.length === 0 ? (
        <div>
          <p style={{ color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>
            No availability data found for the selected criteria.
          </p>
        </div>
      ) : (
        <>
          <AvailabilityTable items={availability.data?.items ?? []} />

          {/* Suggestions */}
          <div style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Suggestions</h2>
            {suggestions.isLoading ? (
              <p style={{ color: "var(--text-muted, #64748b)" }}>Loading suggestions…</p>
            ) : suggestions.data?.items.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {suggestions.data.items.slice(0, 5).map((s) => (
                  <li key={`${s.modalityId}-${s.date}`} style={{ marginBottom: 4 }}>
                    {s.date} - {s.decision.displayStatus}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: "var(--text-muted, #64748b)" }}>No suggestions available.</p>
            )}
          </div>

          {/* Booking Form */}
          <div style={{ marginTop: 32 }}>
            <BookingForm
              modalities={lookups.data?.modalities ?? []}
              availability={availability.data?.items ?? []}
              selectedModalityId={modalityId}
              selectedExamTypeId={examTypeId}
              caseCategory={caseCategory}
              onBookingSuccess={() => {
                // Refetch availability and bookings after booking
                availability.refetch();
                bookings.refetch();
              }}
            />
          </div>

          {/* Recent Bookings */}
          {modalityId != null && (
            <div style={{ marginTop: 32 }}>
              <BookingsList
                modalityId={modalityId}
                availabilityItems={availability.data?.items ?? []}
                onBookingCancelled={() => {
                  availability.refetch();
                  bookings.refetch();
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Availability Table Component
// ---------------------------------------------------------------------------

interface AvailabilityTableProps {
  items: AvailabilityDayDto[];
}

function AvailabilityTable({ items }: AvailabilityTableProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: "2px solid var(--border-color, #e2e8f0)",
            }}
          >
            <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Date
            </th>
            <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Capacity
            </th>
            <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Booked
            </th>
            <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Remaining
            </th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((day) => (
            <tr
              key={day.date}
              style={{
                borderBottom: "1px solid var(--border-color, #e2e8f0)",
              }}
            >
              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: 500 }}>{formatDate(day.date)}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>{day.date}</div>
              </td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>{day.dailyCapacity}</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>{day.bookedCount}</td>
              <td style={{ textAlign: "center", padding: "10px 12px" }}>
                <span
                  style={{
                    fontWeight: day.remainingCapacity <= 0 ? 700 : 400,
                    color:
                      day.remainingCapacity <= 0
                        ? "var(--color-error, #ef4444)"
                        : "var(--text-primary, #1e293b)",
                  }}
                >
                  {day.remainingCapacity}
                </span>
              </td>
              <td style={{ padding: "10px 12px" }}>
                <StatusBadge
                  status={day.decision.displayStatus as DecisionStatus}
                  reasons={day.decision.reasons.map((r: { code: string; severity: "error" | "warning"; message: string }) => ({
                    ...r,
                    message: describeReason(r.code),
                  }))}
                  remainingCapacity={day.decision.remainingStandardCapacity}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bookings List Component
// ---------------------------------------------------------------------------

interface BookingsListProps {
  modalityId: number;
  availabilityItems: AvailabilityDayDto[];
  onBookingCancelled: () => void;
}

function BookingsList({ modalityId, availabilityItems, onBookingCancelled }: BookingsListProps) {
  const cancelMutation = useV2CancelBooking();
  const rescheduleMutation = useV2RescheduleBooking();
  const [cancelTarget, setCancelTarget] = useState<{
    id: number;
    patientName: string;
    date: string;
  } | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<BookingWithPatientInfo | null>(null);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [cancelPendingBookingId, setCancelPendingBookingId] = useState<number | null>(null);
  const [reschedulePendingBookingId, setReschedulePendingBookingId] = useState<number | null>(null);

  // Compute date range from availability data
  const dateFrom = availabilityItems[0]?.date ?? "";
  const dateTo = availabilityItems[availabilityItems.length - 1]?.date ?? "";

  const bookings = useV2ListBookings(
    modalityId && dateFrom && dateTo
      ? { modalityId, dateFrom, dateTo, includeCancelled }
      : null
  );

  const handleCancelConfirm = async () => {
    if (!cancelTarget) return;
    const pendingId = cancelTarget.id;
    setCancelPendingBookingId(pendingId);
    try {
      await cancelMutation.mutateAsync(cancelTarget.id);
      pushToast({
        type: "success",
        title: "Booking Cancelled",
        message: `${cancelTarget.patientName} — ${cancelTarget.date}`,
      });
      setCancelTarget(null);
      onBookingCancelled();
    } catch (err) {
      pushToast({
        type: "error",
        title: "Cancel Failed",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setCancelPendingBookingId(null);
    }
  };

  const handleCancelCancel = () => {
    setCancelTarget(null);
  };

  const handleReschedule = async (
    newDate: string,
    _newTime: string | null,
    override?: { supervisorUsername: string; supervisorPassword: string; reason: string }
  ) => {
    if (!rescheduleTarget) return;
    if (!RESCHEDULABLE_STATUSES.includes(rescheduleTarget.status)) {
      const msg = `Cannot reschedule a booking with status "${rescheduleTarget.status}"`;
      setRescheduleError(msg);
      return;
    }
    setReschedulePendingBookingId(rescheduleTarget.id);
    setRescheduleError(null);
    try {
      await rescheduleMutation.mutateAsync({
        bookingId: rescheduleTarget.id,
        input: {
          bookingDate: newDate,
          bookingTime: _newTime,
          ...(override ? { override } : {}),
        },
      });
      pushToast({
        type: "success",
        title: "Booking Rescheduled",
        message: `${rescheduleTarget.patientEnglishName ?? `Patient #${rescheduleTarget.patientId}`} — ${rescheduleTarget.bookingDate} → ${newDate}`,
      });
      setRescheduleTarget(null);
      onBookingCancelled();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setRescheduleError(msg);
      throw err; // Re-throw so the dialog can show it
    } finally {
      setReschedulePendingBookingId(null);
    }
  };

  const handleRescheduleCancel = () => {
    setRescheduleTarget(null);
    setRescheduleError(null);
  };

  const bookingsList = bookings.data?.bookings ?? [];
  const availableDates = availabilityItems.map((item) => item.date);

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        backgroundColor: "var(--bg-surface, #f8fafc)",
        border: "1px solid var(--border-color, #e2e8f0)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
          Recent Bookings
        </h2>

        {/* Include cancelled toggle */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--text-muted, #64748b)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={includeCancelled}
            onChange={(e) => setIncludeCancelled(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              accentColor: "var(--color-primary, #3b82f6)",
              cursor: "pointer",
            }}
          />
          Include cancelled
        </label>
      </div>

      {bookings.isLoading ? (
        <p style={{ color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>
          Loading bookings…
        </p>
      ) : bookings.isError ? (
        <p style={{ color: "var(--color-error, #ef4444)" }}>
          Error loading bookings: {(bookings.error as Error).message}
        </p>
      ) : bookingsList.length === 0 ? (
        <p style={{ color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>
          No bookings found for the selected date range.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-color, #e2e8f0)" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
                  Patient
                </th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
                  Date
                </th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
                  Category
                </th>
                <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
                  Status
                </th>
                <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {bookingsList.map((booking) => {
                // Keep pending disable state scoped to the affected booking row only.
                const cancelPendingForRow = cancelPendingBookingId === booking.id;
                const reschedulePendingForRow = reschedulePendingBookingId === booking.id;

                return (
                  <tr
                    key={booking.id}
                    style={{
                      borderBottom: "1px solid var(--border-color, #e2e8f0)",
                      opacity: booking.status === "cancelled" ? 0.6 : 1,
                    }}
                  >
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 500 }}>{booking.patientEnglishName}</div>
                    {booking.patientNationalId && (
                      <div style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>
                        {booking.patientNationalId}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {booking.bookingDate}
                    {booking.bookingTime ? ` ${booking.bookingTime}` : ""}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontSize: 12 }}>
                      {booking.caseCategory === "oncology" ? "Oncology" : "Non-Oncology"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <BookingStatusBadge status={booking.status} />
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => setRescheduleTarget(booking)}
                        disabled={!RESCHEDULABLE_STATUSES.includes(booking.status) || reschedulePendingForRow}
                        title={
                          RESCHEDULABLE_STATUSES.includes(booking.status)
                            ? (reschedulePendingForRow ? "Rescheduling in progress" : "Reschedule this booking")
                            : `Cannot reschedule a booking with status "${booking.status}"`
                        }
                        style={{
                          padding: "4px 12px",
                          borderRadius: 4,
                          border: `1px solid ${RESCHEDULABLE_STATUSES.includes(booking.status) ? "var(--color-info, #3b82f6)" : "var(--border-color, #e2e8f0)"}`,
                          backgroundColor: "transparent",
                          color: RESCHEDULABLE_STATUSES.includes(booking.status) ? "var(--color-info, #3b82f6)" : "var(--text-muted, #94a3b8)",
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: RESCHEDULABLE_STATUSES.includes(booking.status) && !reschedulePendingForRow ? "pointer" : "not-allowed",
                          opacity: RESCHEDULABLE_STATUSES.includes(booking.status) && !reschedulePendingForRow ? 1 : 0.5,
                        }}
                      >
                        {reschedulePendingForRow ? "Rescheduling…" : "Reschedule"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCancelTarget({
                            id: booking.id,
                            patientName: booking.patientEnglishName ?? `Patient #${booking.patientId}`,
                            date: booking.bookingDate,
                          })
                        }
                        disabled={!CANCELLABLE_STATUSES.includes(booking.status) || cancelPendingForRow}
                        title={
                          CANCELLABLE_STATUSES.includes(booking.status)
                            ? (cancelPendingForRow ? "Cancellation in progress" : "Cancel this booking")
                            : `Cannot cancel a booking with status "${booking.status}"`
                        }
                        style={{
                          padding: "4px 12px",
                          borderRadius: 4,
                          border: `1px solid ${CANCELLABLE_STATUSES.includes(booking.status) ? "var(--color-error, #ef4444)" : "var(--border-color, #e2e8f0)"}`,
                          backgroundColor: "transparent",
                          color: CANCELLABLE_STATUSES.includes(booking.status) ? "var(--color-error, #ef4444)" : "var(--text-muted, #94a3b8)",
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: CANCELLABLE_STATUSES.includes(booking.status) && !cancelPendingForRow ? "pointer" : "not-allowed",
                          opacity: CANCELLABLE_STATUSES.includes(booking.status) && !cancelPendingForRow ? 1 : 0.5,
                        }}
                      >
                        {cancelPendingForRow ? "Cancelling…" : "Cancel"}
                      </button>
                    </div>
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Cancel confirmation dialog */}
      {cancelTarget && (
        <CancelConfirmDialog
          booking={cancelTarget}
          onConfirm={handleCancelConfirm}
          onCancel={handleCancelCancel}
        />
      )}

      {/* Reschedule dialog */}
      {rescheduleTarget && (
        <RescheduleDialog
          booking={rescheduleTarget}
          availableDates={availableDates}
          caseCategory={rescheduleTarget.caseCategory}
          examTypeId={rescheduleTarget.examTypeId}
          onReschedule={handleReschedule}
          onCancel={handleRescheduleCancel}
          error={rescheduleError}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking Status Badge Component
// ---------------------------------------------------------------------------

function BookingStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    scheduled: { label: "Scheduled", color: "#15803d", bg: "#dcfce7" },
    arrived: { label: "Arrived", color: "#1d4ed8", bg: "#dbeafe" },
    waiting: { label: "Waiting", color: "#a16207", bg: "#fef9c3" },
    completed: { label: "Completed", color: "#6b7280", bg: "#f3f4f6" },
    "no-show": { label: "No-Show", color: "#991b1b", bg: "#fee2e2" },
  };

  const c = config[status] ?? { label: status, color: "#6b7280", bg: "#f3f4f6" };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: c.color,
        backgroundColor: c.bg,
      }}
    >
      {c.label}
    </span>
  );
}
