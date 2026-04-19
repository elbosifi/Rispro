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
import { Button, Card, LoadingState } from "@/components/shared";
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
      <div className="max-w-7xl mx-auto p-4 lg:p-6">
        <Card className="p-8 text-center">
          <p className="text-lg font-bold mb-2" style={{ color: "var(--accent)" }}>
            Failed to load modality list
          </p>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            {(lookups.error as Error)?.message ?? "Unknown error"}
          </p>
          <Button
            onClick={() => lookups.refetch()}
          >
            Retry
          </Button>
        </Card>
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
      : undefined
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
    <div className="max-w-7xl mx-auto p-4 lg:p-6">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-embossed text">
            Appointments V2
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user?.role === "supervisor" && (
            <Button
              variant="secondary"
              type="button"
              onClick={() => navigate("/v2/appointments/admin")}
            >
              Open Scheduling Policy Admin
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Modality */}
          <div>
            <label
              className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data"
              style={{ color: "var(--text-muted)" }}
            >
              Modality
            </label>
            <select
              value={modalityId ?? ""}
              onChange={(e) => {
                setModalityId(e.target.value ? Number(e.target.value) : null);
                setExamTypeId(null);
              }}
              className="input-premium"
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
          <div>
            <label
              className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data"
              style={{ color: "var(--text-muted)" }}
            >
              Exam Type (optional)
            </label>
            <select
              value={examTypeId ?? ""}
              onChange={(e) => setExamTypeId(e.target.value ? Number(e.target.value) : null)}
              disabled={!modalityId}
              className="input-premium"
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
          <div>
            <label
              className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data"
              style={{ color: "var(--text-muted)" }}
            >
              Case Category
            </label>
            <select
              value={caseCategory}
              onChange={(e) => setCaseCategory(e.target.value as CaseCategory)}
              className="input-premium"
            >
              <option value="non_oncology">Non-Oncology</option>
              <option value="oncology">Oncology</option>
            </select>
          </div>

          {/* Days */}
          <div>
            <label
              className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data"
              style={{ color: "var(--text-muted)" }}
            >
              Days
            </label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="input-premium"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
         </select>
           </div>
         </div>
       </Card>

      {/* Availability Table */}
      {disabled ? (
        <p className="text-center text-sm italic" style={{ color: "var(--text-muted)" }}>
          Select a modality to view availability.
        </p>
      ) : availability.isLoading ? (
        <LoadingState message="Loading availability…" />
      ) : availability.isError ? (
        <p className="text-center text-sm" style={{ color: "var(--accent)" }}>
          Could not load availability. {(availability.error as Error).message}
        </p>
       ) : noPublishedPolicy ? (
         <Card className="p-6">
          <p className="font-bold mb-2" style={{ color: "var(--text)" }}>
            No scheduling policy has been published yet.
          </p>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            Availability is empty because no published policy exists for V2 scheduling.
          </p>
          {user?.role !== "supervisor" && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Ask a supervisor to publish a policy before booking.
            </p>
          )}
          {user?.role === "supervisor" && (
         <Button
           variant="secondary"
           type="button"
           onClick={() => navigate("/v2/appointments/admin")}
           className="mt-2"
         >
           Publish or Update Policy
         </Button>
       )}
     </Card>
      ) : availability.data?.items.length === 0 ? (
        <p className="text-center text-sm italic" style={{ color: "var(--text-muted)" }}>
          No availability found for the selected filters.
        </p>
      ) : (
        <>
          <AvailabilityTable items={availability.data?.items ?? []} />

          {/* Suggestions */}
          <div className="mt-6">
            <h2 className="text-lg font-bold mb-4 text-embossed" style={{ color: "var(--text)" }}>Suggestions</h2>
            {suggestions.isLoading ? (
              <LoadingState message="Loading next available suggestions…" />
            ) : suggestions.isError ? (
              <p style={{ color: "var(--accent)" }}>
                Could not load suggestions. {(suggestions.error as Error).message}
              </p>
            ) : suggestions.data?.items.length ? (
             <Card className="p-4">
               <ul className="space-y-2">
                 {suggestions.data.items.slice(0, 5).map((s) => (
                   <li key={`${s.modalityId}-${s.date}`} className="text-sm" style={{ color: "var(--text-muted)" }}>
                     {s.date} — {s.decision.displayStatus}
                   </li>
                 ))}
               </ul>
             </Card>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No better dates found in the selected window.
              </p>
            )}
          </div>

          {/* Booking Form */}
          <div className="mt-8">
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
            <div className="mt-8">
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
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--border)" }}>
              <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Date
              </th>
              <th className="text-center p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Capacity
              </th>
              <th className="text-center p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Booked
              </th>
              <th className="text-center p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Availability
              </th>
              <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((day) => {
              const status = day.decision.displayStatus as DecisionStatus;
              const isBlocked = status === "blocked";
              const standard = Math.max(0, day.decision.remainingStandardCapacity ?? day.remainingCapacity ?? 0);
              const special = Math.max(0, day.decision.remainingSpecialQuota ?? 0);
              const totalCapacity = day.modalityTotalCapacity ?? day.dailyCapacity;
              const totalBooked = day.bookedTotal ?? day.bookedCount;
              const totalRemaining = Math.max(0, totalCapacity - totalBooked);
              return (
              <tr
                key={day.date}
                className="border-b transition-colors hover:bg-[var(--muted)]"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="p-3 whitespace-nowrap">
                  <div className="font-medium" style={{ color: "var(--text)" }}>{formatDate(day.date)}</div>
                  <div className="text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>{day.date}</div>
                </td>
                <td className="text-center p-3" style={{ color: "var(--text)" }}>{totalCapacity}</td>
                <td className="text-center p-3" style={{ color: "var(--text)" }}>{totalBooked}</td>
                <td className="text-center p-3">
                  {isBlocked ? (
                    <span className="font-bold" style={{ color: "var(--accent)" }}>
                      Blocked
                    </span>
                  ) : (
                    <>
                      <div className="font-medium" style={{ color: standard <= 0 ? "var(--accent)" : "var(--text)" }}>
                        {totalRemaining} total
                      </div>
                      {day.bucketMode === "partitioned" ? (
                        <div className="text-xs font-mono-data mt-1" style={{ color: "var(--text-muted)" }}>
                          Onc {day.oncology.filled}/{day.oncology.reserved ?? 0}, Non-onc {day.nonOncology.filled}/{day.nonOncology.reserved ?? 0}
                        </div>
                      ) : (
                        <div className="text-xs font-mono-data mt-1" style={{ color: "var(--text-muted)" }}>
                          Total-only mode (no category reserves)
                        </div>
                      )}
                      {(day.specialQuotaSummary?.remaining ?? special) > 0 && (
                        <div className="text-xs font-mono-data mt-1" style={{ color: "var(--amber)", fontWeight: "600" }}>
                          Special remaining: {day.specialQuotaSummary?.remaining ?? special}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="p-3">
                  <StatusBadge
                    status={status}
                    reasons={day.decision.reasons.map((r: { code: string; severity: "error" | "warning"; message: string }) => ({
                      ...r,
                      message: describeReason(r.code),
                    }))}
                    remainingStandardCapacity={isBlocked ? null : day.decision.remainingStandardCapacity}
                    remainingSpecialQuota={isBlocked ? null : day.decision.remainingSpecialQuota}
                  />
                </td>
              </tr>
              );
            })}
       </tbody>
         </table>
       </div>
     </Card>
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

  return (
    <Card className="p-4">
      <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
        <h2 className="text-lg font-bold text-embossed" style={{ color: "var(--text)" }}>
          Recent Bookings
        </h2>

        {/* Include cancelled toggle */}
            <label
              className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data text-muted"
            >
          <input
            type="checkbox"
            checked={includeCancelled}
            onChange={(e) => setIncludeCancelled(e.target.checked)}
            className="w-4 h-4 cursor-pointer accent-[var(--accent)]"
          />
          Include cancelled
        </label>
      </div>

      {bookings.isLoading ? (
        <LoadingState message="Loading bookings…" />
      ) : bookings.isError ? (
        <div className="p-8 text-center">
          <p style={{ color: "var(--accent)" }}>
            Could not load bookings. {(bookings.error as Error).message}
          </p>
        </div>
      ) : bookingsList.length === 0 ? (
        <div className="p-8 text-center">
          <p style={{ color: "var(--text-muted)" }}>
            No bookings found for the selected date range.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  Patient
                </th>
                <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  Date
                </th>
                <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  Category
                </th>
                <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  Status
                </th>
                <th className="text-right p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
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
                    className="border-b transition-colors hover:bg-[var(--muted)]"
                    style={{
                      borderColor: "var(--border)",
                      opacity: booking.status === "cancelled" ? 0.6 : 1,
                    }}
                  >
                  <td className="p-3">
                    <div className="font-medium" style={{ color: "var(--text)" }}>{booking.patientEnglishName}</div>
                    {booking.patientNationalId && (
                      <div className="text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
                        {booking.patientNationalId}
                      </div>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap" style={{ color: "var(--text)" }}>
                    {booking.bookingDate}
                    {booking.bookingTime ? ` ${booking.bookingTime}` : ""}
                  </td>
                  <td className="p-3">
                    <span className="text-xs">
                      {booking.caseCategory === "oncology" ? "Oncology" : "Non-Oncology"}
                    </span>
                  </td>
                  <td className="p-3">
                    <BookingStatusBadge status={booking.status} />
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex gap-2 justify-end flex-wrap">
                     <Button
                       variant="ghost"
                       size="sm"
                       type="button"
                       onClick={() => setRescheduleTarget(booking)}
                       disabled={!RESCHEDULABLE_STATUSES.includes(booking.status) || reschedulePendingForRow}
                       title={
                         RESCHEDULABLE_STATUSES.includes(booking.status)
                           ? (reschedulePendingForRow ? "Rescheduling in progress" : "Reschedule this booking")
                           : `Cannot reschedule a booking with status "${booking.status}"`
                       }
                     >
                       {reschedulePendingForRow ? "Rescheduling…" : "Reschedule"}
                     </Button>
                     <Button
                       variant="ghost"
                       size="sm"
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
                       style={{ color: "var(--accent)" }}
                     >
                       {cancelPendingForRow ? "Cancelling…" : "Cancel"}
                     </Button>
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
          availabilityItems={availabilityItems}
          caseCategory={rescheduleTarget.caseCategory}
          examTypeId={rescheduleTarget.examTypeId}
          onReschedule={handleReschedule}
          onCancel={handleRescheduleCancel}
          error={rescheduleError}
        />
       )}
     </Card>
   );
 }

 // ---------------------------------------------------------------------------
 // Booking Status Badge Component
// ---------------------------------------------------------------------------

function BookingStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    scheduled: { label: "Scheduled", color: "var(--green)", bg: "rgba(34, 197, 94, 0.1)" },
    arrived: { label: "Arrived", color: "var(--blue)", bg: "rgba(59, 130, 246, 0.1)" },
    waiting: { label: "Waiting", color: "var(--amber)", bg: "rgba(245, 158, 11, 0.1)" },
    completed: { label: "Completed", color: "var(--text-muted)", bg: "var(--muted)" },
    "no-show": { label: "No-Show", color: "var(--accent)", bg: "rgba(255, 71, 87, 0.1)" },
  };

  const c = config[status] ?? { label: status, color: "var(--text-muted)", bg: "var(--muted)" };

  return (
    <span className="pill-soft text-xs font-bold" style={{ backgroundColor: c.bg, color: c.color, borderColor: c.bg }}>
      {c.label}
    </span>
  );
}
