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
import { chooseLocalized, statusLabel, t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { useV2Lookups, useV2ExamTypes, useV2Availability, useV2ListBookings, useV2CancelBooking, useV2RescheduleBooking, useV2Suggestions } from "./api";
import type { CaseCategory, DecisionStatus, AvailabilityDayDto, BookingWithPatientInfo, ExamTypeDto, ModalityDto } from "./types";
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
    modality_not_found: "appointments.v2.modalityNotFound",
    exam_type_not_found: "appointments.v2.examTypeNotFound",
    exam_type_modality_mismatch: "appointments.v2.examTypeInvalid",
    malformed_rule_configuration: "appointments.v2.ruleError",
    modality_blocked_rule_match: "appointments.v2.blockedForModality",
    modality_blocked_overridable: "appointments.v2.blockedNeedsApproval",
    exam_type_not_allowed_for_rule: "appointments.v2.examTypeNotAllowed",
    standard_capacity_exhausted: "appointments.v2.capacityReached",
    special_quota_exhausted: "appointments.v2.specialQuotaReached",
    no_published_policy: "appointments.v2.noPolicyPublished",
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
  const { language } = useLanguage();
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
            {t(language, "appointments.create.failedLoadLookups")}
          </p>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            {(lookups.error as Error)?.message ?? t(language, "appointments.v2.unknownError")}
          </p>
          <Button
            onClick={() => lookups.refetch()}
          >
            {t(language, "appointments.create.retry")}
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
            {t(language, "appointments.v2.title")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user?.role === "supervisor" && (
            <Button
              variant="secondary"
              type="button"
              onClick={() => navigate("/v2/appointments/admin")}
            >
              {t(language, "appointments.v2.openAdmin")}
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
              {t(language, "appointments.v2.modality")}
            </label>
            <select
              value={modalityId ?? ""}
              onChange={(e) => {
                setModalityId(e.target.value ? Number(e.target.value) : null);
                setExamTypeId(null);
              }}
              className="input-premium"
            >
              <option value="">{t(language, "appointments.v2.selectModality")}</option>
              {lookups.data?.modalities.map((m: ModalityDto) => (
                <option key={m.id} value={m.id}>
                  {chooseLocalized(language, m.nameAr, m.nameEn) || m.name}
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
              {t(language, "appointments.v2.examType")}
            </label>
            <select
              value={examTypeId ?? ""}
              onChange={(e) => setExamTypeId(e.target.value ? Number(e.target.value) : null)}
              disabled={!modalityId}
              className="input-premium"
            >
              <option value="">{t(language, "appointments.v2.allExamTypes")}</option>
              {examTypes.data?.map((et: ExamTypeDto) => (
                <option key={et.id} value={et.id}>
                  {chooseLocalized(language, et.nameAr, et.nameEn) || et.name}
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
              {t(language, "appointments.v2.caseCategory")}
            </label>
            <select
              value={caseCategory}
              onChange={(e) => setCaseCategory(e.target.value as CaseCategory)}
              className="input-premium"
            >
              <option value="non_oncology">{t(language, "appointments.create.nonOncology")}</option>
              <option value="oncology">{t(language, "appointments.create.oncology")}</option>
            </select>
          </div>

          {/* Days */}
          <div>
            <label
              className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data"
              style={{ color: "var(--text-muted)" }}
            >
              {t(language, "appointments.v2.days")}
            </label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="input-premium"
            >
              <option value={7}>{t(language, "appointments.v2.daysOption", { count: 7 })}</option>
              <option value={14}>{t(language, "appointments.v2.daysOption", { count: 14 })}</option>
              <option value={30}>{t(language, "appointments.v2.daysOption", { count: 30 })}</option>
         </select>
           </div>
         </div>
       </Card>

      {/* Availability Table */}
      {disabled ? (
        <p className="text-center text-sm italic" style={{ color: "var(--text-muted)" }}>
          {t(language, "appointments.v2.selectModalityHint")}
        </p>
      ) : availability.isLoading ? (
        <LoadingState message={t(language, "appointments.v2.loadingAvailability")} />
      ) : availability.isError ? (
        <p className="text-center text-sm" style={{ color: "var(--accent)" }}>
          {language === "ar" ? "تعذر تحميل التوفر." : "Could not load availability."} {(availability.error as Error).message}
        </p>
       ) : noPublishedPolicy ? (
         <Card className="p-6">
          <p className="font-bold mb-2" style={{ color: "var(--text)" }}>
            {t(language, "appointments.create.noSchedulePolicy")}
          </p>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            {t(language, "appointments.create.emptyAvailabilityPolicy")}
          </p>
          {user?.role !== "supervisor" && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t(language, "appointments.create.askSupervisorPublish")}
            </p>
          )}
          {user?.role === "supervisor" && (
         <Button
           variant="secondary"
           type="button"
           onClick={() => navigate("/v2/appointments/admin")}
           className="mt-2"
         >
           {t(language, "appointments.create.publishOrUpdatePolicy")}
         </Button>
       )}
     </Card>
      ) : availability.data?.items.length === 0 ? (
        <p className="text-center text-sm italic" style={{ color: "var(--text-muted)" }}>
          {t(language, "appointments.v2.selectModalityHint")}
        </p>
      ) : (
        <>
          <AvailabilityTable items={availability.data?.items ?? []} language={language} />

          {/* Suggestions */}
          <div className="mt-6">
            <h2 className="text-lg font-bold mb-4 text-embossed" style={{ color: "var(--text)" }}>{t(language, "appointments.v2.suggestions")}</h2>
            {suggestions.isLoading ? (
              <LoadingState message={t(language, "appointments.v2.loadingSuggestions")} />
            ) : suggestions.isError ? (
              <p style={{ color: "var(--accent)" }}>
                {language === "ar" ? "تعذر تحميل الاقتراحات." : "Could not load suggestions."} {(suggestions.error as Error).message}
              </p>
            ) : suggestions.data?.items.length ? (
             <Card className="p-4">
               <ul className="space-y-2">
                 {suggestions.data.items.slice(0, 5).map((s) => (
                  <li key={`${s.modalityId}-${s.date}`} className="text-sm" style={{ color: "var(--text-muted)" }}>
                     {s.date} — {statusLabel(language, s.decision.displayStatus)}
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
  language: "ar" | "en";
}

function AvailabilityTable({ items, language }: AvailabilityTableProps) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--border)" }}>
              <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                {language === "ar" ? "التاريخ" : "Date"}
              </th>
              <th className="text-center p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                {language === "ar" ? "السعة" : "Capacity"}
              </th>
              <th className="text-center p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                {language === "ar" ? "محجوز" : "Booked"}
              </th>
              <th className="text-center p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                {language === "ar" ? "التوفر" : "Availability"}
              </th>
              <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                {language === "ar" ? "الحالة" : "Status"}
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
                      {language === "ar" ? "محجوب" : "Blocked"}
                    </span>
                  ) : (
                    <>
                      <div className="font-medium" style={{ color: standard <= 0 ? "var(--accent)" : "var(--text)" }}>
                        {totalRemaining} {language === "ar" ? "إجمالي" : "total"}
                      </div>
                      {day.bucketMode === "partitioned" ? (
                        <div className="text-xs font-mono-data mt-1" style={{ color: "var(--text-muted)" }}>
                          {language === "ar"
                            ? `أورام ${day.oncology.filled}/${day.oncology.reserved ?? 0}، غير أورام ${day.nonOncology.filled}/${day.nonOncology.reserved ?? 0}`
                            : `Onc ${day.oncology.filled}/${day.oncology.reserved ?? 0}, Non-onc ${day.nonOncology.filled}/${day.nonOncology.reserved ?? 0}`}
                        </div>
                      ) : (
                        <div className="text-xs font-mono-data mt-1" style={{ color: "var(--text-muted)" }}>
                          {language === "ar" ? "نمط الإجمالي فقط (بدون حصص فئات)" : "Total-only mode (no category reserves)"}
                        </div>
                      )}
                      {(day.specialQuotaSummary?.remaining ?? special) > 0 && (
                        <div className="text-xs font-mono-data mt-1" style={{ color: "var(--amber)", fontWeight: "600" }}>
                          {language === "ar" ? "المتبقي الخاص" : "Special remaining"}: {day.specialQuotaSummary?.remaining ?? special}
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
  const { language } = useLanguage();
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
        title: t(language, "appointments.v2.bookingCancelled"),
        message: `${cancelTarget.patientName} — ${cancelTarget.date}`,
      });
      setCancelTarget(null);
      onBookingCancelled();
    } catch (err) {
      pushToast({
        type: "error",
        title: t(language, "appointments.v2.cancelFailed"),
        message: err instanceof Error ? err.message : t(language, "appointments.v2.unknownError"),
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
        title: t(language, "appointments.v2.bookingRescheduled"),
        message: `${rescheduleTarget.patientEnglishName ?? `Patient #${rescheduleTarget.patientId}`} — ${rescheduleTarget.bookingDate} → ${newDate}`,
      });
      setRescheduleTarget(null);
      onBookingCancelled();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t(language, "appointments.v2.unknownError");
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
          {t(language, "appointments.v2.recentBookings")}
        </h2>

        {/* Include inactive toggle */}
            <label
              className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data text-muted"
            >
          <input
            type="checkbox"
            checked={includeCancelled}
            onChange={(e) => setIncludeCancelled(e.target.checked)}
            className="w-4 h-4 cursor-pointer accent-[var(--accent)]"
          />
          {language === "ar" ? "تضمين الملغاة والمتوقفة والمبطلة" : "Include cancelled/discontinued/voided"}
        </label>
      </div>

      {bookings.isLoading ? (
        <LoadingState message={t(language, "appointments.v2.loadingBookings")} />
      ) : bookings.isError ? (
        <div className="p-8 text-center">
          <p style={{ color: "var(--accent)" }}>
            {language === "ar" ? "تعذر تحميل الحجوزات." : "Could not load bookings."} {(bookings.error as Error).message}
          </p>
        </div>
      ) : bookingsList.length === 0 ? (
        <div className="p-8 text-center">
          <p style={{ color: "var(--text-muted)" }}>
            {language === "ar" ? "لا توجد حجوزات في نطاق التاريخ المحدد." : "No bookings found for the selected date range."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  {t(language, "appointments.v2.patient")}
                </th>
                <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  {t(language, "common.date")}
                </th>
                <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  {t(language, "appointments.v2.caseCategory")}
                </th>
                <th className="text-left p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  {t(language, "appointments.v2.status")}
                </th>
                <th className="text-right p-3 font-bold text-xs uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  {t(language, "common.actions")}
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
                      opacity: booking.status === "cancelled" || booking.status === "discontinued" || booking.status === "voided" ? 0.6 : 1,
                    }}
                  >
                  <td className="p-3">
                    <div className="font-medium" style={{ color: "var(--text)" }}>{booking.patientEnglishName ?? booking.patientArabicName ?? `Patient #${booking.patientId}`}</div>
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
                      {booking.caseCategory === "oncology" ? t(language, "appointments.create.oncology") : t(language, "appointments.create.nonOncology")}
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
                           ? (reschedulePendingForRow ? t(language, "appointments.v2.rescheduleInProgress") : t(language, "appointments.v2.rescheduleThisBooking"))
                           : (language === "ar"
                             ? `لا يمكن إعادة جدولة حجز بالحالة "${booking.status}"`
                             : `Cannot reschedule a booking with status "${booking.status}"`)
                       }
                   >
                       {reschedulePendingForRow ? t(language, "appointments.v2.rescheduling") : t(language, "appointments.v2.reschedule")}
                     </Button>
                     <Button
                       variant="ghost"
                       size="sm"
                       type="button"
                       onClick={() =>
                         setCancelTarget({
                           id: booking.id,
                           patientName: booking.patientEnglishName ?? booking.patientArabicName ?? `Patient #${booking.patientId}`,
                           date: booking.bookingDate,
                         })
                       }
                       disabled={!CANCELLABLE_STATUSES.includes(booking.status) || cancelPendingForRow}
                       title={
                         CANCELLABLE_STATUSES.includes(booking.status)
                           ? (cancelPendingForRow ? t(language, "appointments.v2.cancelInProgress") : t(language, "appointments.v2.cancelThisBooking"))
                           : (language === "ar"
                             ? `لا يمكن إلغاء حجز بالحالة "${booking.status}"`
                             : `Cannot cancel a booking with status "${booking.status}"`)
                       }
                       style={{ color: "var(--accent)" }}
                     >
                       {cancelPendingForRow ? t(language, "appointments.v2.cancelling") : t(language, "appointments.v2.cancel")}
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
  const { language } = useLanguage();
  const config: Record<string, { label: string; color: string; bg: string }> = {
    scheduled: { label: language === "ar" ? "مجدول" : "Scheduled", color: "var(--green)", bg: "rgba(34, 197, 94, 0.1)" },
    arrived: { label: language === "ar" ? "وصل" : "Arrived", color: "var(--blue)", bg: "rgba(59, 130, 246, 0.1)" },
    waiting: { label: language === "ar" ? "بانتظار" : "Waiting", color: "var(--amber)", bg: "rgba(245, 158, 11, 0.1)" },
    completed: { label: language === "ar" ? "مكتمل" : "Completed", color: "var(--text-muted)", bg: "var(--muted)" },
    discontinued: { label: language === "ar" ? "متوقف" : "Discontinued", color: "var(--accent)", bg: "rgba(255, 71, 87, 0.12)" },
    cancelled: { label: language === "ar" ? "ملغي" : "Cancelled", color: "var(--accent)", bg: "rgba(255, 71, 87, 0.08)" },
    voided: { label: language === "ar" ? "مبطل" : "Voided", color: "var(--accent)", bg: "rgba(255, 71, 87, 0.1)" },
    "no-show": { label: language === "ar" ? "لم يحضر" : "No-Show", color: "var(--accent)", bg: "rgba(255, 71, 87, 0.1)" },
  };

  const c = config[status] ?? { label: status, color: "var(--text-muted)", bg: "var(--muted)" };

  return (
      <span className="pill-soft text-xs font-bold" style={{ backgroundColor: c.bg, color: c.color, borderColor: c.bg }}>
      {c.label}
    </span>
  );
}
