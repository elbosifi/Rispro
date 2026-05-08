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
import { chooseLocalized, t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { SpecialQuotaSection } from "./SpecialQuotaSection";
import type {
  SchedulingDecisionDto,
  CaseCategory,
  CreateBookingRequest,
  BookingWithPatientInfo,
  AvailabilityDayDto,
  CapacityResolutionMode,
  SpecialReasonCodeDto,
} from "../types";
import type { Role } from "@/types/api";

interface RescheduleDialogProps {
  booking: BookingWithPatientInfo;
  availabilityItems: AvailabilityDayDto[];
  caseCategory: CaseCategory;
  examTypeId: number | null;
  canUseNonStandardCapacityModes?: boolean;
  currentUserRole?: Role;
  specialReasonOptions?: SpecialReasonCodeDto[];
  onReschedule: (
    newDate: string,
    newTime: string | null,
    override?: CreateBookingRequest["override"],
    capacity?: {
      capacityResolutionMode: CapacityResolutionMode;
      useSpecialQuota: boolean;
      specialReasonCode: string | null;
      specialReasonNote: string | null;
    }
  ) => Promise<void>;
  onCancel: () => void;
  error?: string | null;
}

export function RescheduleDialog({
  booking,
  availabilityItems,
  caseCategory,
  examTypeId,
  canUseNonStandardCapacityModes = false,
  currentUserRole,
  specialReasonOptions = [],
  onReschedule,
  onCancel,
  error,
}: RescheduleDialogProps) {
  const { language } = useLanguage();
  const [newDate, setNewDate] = useState("");
  const [decision, setDecision] = useState<SchedulingDecisionDto | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [capacityResolutionMode, setCapacityResolutionMode] = useState<CapacityResolutionMode>("standard");
  const [specialReasonCode, setSpecialReasonCode] = useState("");
  const [specialReasonConfirmed, setSpecialReasonConfirmed] = useState(false);
  const [specialReasonNote, setSpecialReasonNote] = useState("");

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

    const selectedAvailabilityItem = availabilityItems.find((item) => item.date === newDate);
    const hasSpecialQuotaAvailable = (selectedAvailabilityItem?.specialQuotaSummary?.remaining ?? 0) > 0;
    const canUseSpecialQuotaMode = currentUserRole === "super_admin" || hasSpecialQuotaAvailable || capacityResolutionMode === "special_quota_extra";
    const effectiveCapacityResolutionMode =
      capacityResolutionMode === "special_quota_extra"
        ? canUseSpecialQuotaMode ? capacityResolutionMode : "standard"
        : canUseNonStandardCapacityModes ? capacityResolutionMode : "standard";
    evaluateV2Scheduling({
      patientId: booking.patientId,
      modalityId: booking.modalityId,
      examTypeId,
      scheduledDate: newDate,
      caseCategory,
      capacityResolutionMode: effectiveCapacityResolutionMode,
      useSpecialQuota: effectiveCapacityResolutionMode === "special_quota_extra",
      specialReasonCode: effectiveCapacityResolutionMode === "special_quota_extra" ? specialReasonCode || null : null,
      includeOverrideEvaluation: true,
    })
      .then((result) => {
        setDecision(result);
        const selectedCapacityModeNeedsOverrideAuth =
          effectiveCapacityResolutionMode === "category_override" ||
          effectiveCapacityResolutionMode === "total_capacity_override";
        if (result.requiresSupervisorOverride || selectedCapacityModeNeedsOverrideAuth) {
          setShowOverride(true);
        }
      })
      .catch((err) => {
        setDecision(null);
        const message = err instanceof Error ? err.message : t(language, "appointments.v2.unknownError");
        setEvaluationError(`${language === "ar" ? "تعذر تقييم التاريخ المحدد:" : "Could not evaluate selected date:"} ${message}`);
      })
      .finally(() => {
        setEvaluating(false);
      });
  }, [newDate, booking, examTypeId, caseCategory, capacityResolutionMode, specialReasonCode, canUseNonStandardCapacityModes, language, availabilityItems, currentUserRole]);

  const selectedAvailabilityItem = availabilityItems.find((item) => item.date === newDate);
  const hasSpecialQuotaAvailable = (selectedAvailabilityItem?.specialQuotaSummary?.remaining ?? 0) > 0;
  const isSuperAdmin = currentUserRole === "super_admin";
  const canUseSpecialQuotaMode = isSuperAdmin || hasSpecialQuotaAvailable || capacityResolutionMode === "special_quota_extra";
  const effectiveCapacityResolutionMode =
    capacityResolutionMode === "special_quota_extra"
      ? canUseSpecialQuotaMode ? capacityResolutionMode : "standard"
      : canUseNonStandardCapacityModes ? capacityResolutionMode : "standard";
  const selectedCapacityModeNeedsOverrideAuth =
    effectiveCapacityResolutionMode === "category_override" ||
    effectiveCapacityResolutionMode === "total_capacity_override";
  const specialQuotaNeedsDetails = effectiveCapacityResolutionMode === "special_quota_extra";

  useEffect(() => {
    if (capacityResolutionMode === "special_quota_extra" && !evaluating && !hasSpecialQuotaAvailable) {
      setCapacityResolutionMode("standard");
      setSpecialReasonCode("");
      setSpecialReasonConfirmed(false);
      setSpecialReasonNote("");
    }
  }, [capacityResolutionMode, evaluating, hasSpecialQuotaAvailable]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newDate) return;
    if (specialQuotaNeedsDetails && (!specialReasonCode || !specialReasonConfirmed)) {
      return;
    }

    // If override is required, validate supervisor fields
    if (decision?.requiresSupervisorOverride || selectedCapacityModeNeedsOverrideAuth) {
      if (!overrideUsername.trim() || !overridePassword.trim() || !overrideReason.trim()) {
        return;
      }
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      const override = decision?.requiresSupervisorOverride || selectedCapacityModeNeedsOverrideAuth
        ? {
            supervisorUsername: overrideUsername.trim(),
            supervisorPassword: overridePassword,
            reason: overrideReason.trim(),
          }
        : undefined;

      await onReschedule(newDate, null, override, {
        capacityResolutionMode: effectiveCapacityResolutionMode,
        useSpecialQuota: effectiveCapacityResolutionMode === "special_quota_extra",
        specialReasonCode: effectiveCapacityResolutionMode === "special_quota_extra" ? specialReasonCode || null : null,
        specialReasonNote: effectiveCapacityResolutionMode === "special_quota_extra" ? specialReasonNote.trim() || null : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t(language, "appointments.v2.unknownError");
      setSubmitError(`${language === "ar" ? "تعذر إعادة جدولة الحجز:" : "Could not reschedule booking:"} ${message}`);
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
    .filter((item) => (item.rowDisplayStatus ?? item.decision.displayStatus) !== "blocked")
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
              <DialogTitle>{t(language, "appointments.v2.rescheduleBooking")}</DialogTitle>
              <DialogDescription>
                {chooseLocalized(language, booking.patientArabicName, booking.patientEnglishName) || `Patient #${booking.patientId}`} — {booking.bookingDate}
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
                {t(language, "appointments.v2.newDate")}
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
                  <option value="">{t(language, "appointments.v2.selectaDate")}</option>
                  {selectableDates.map((item) => {
                    const rowStatus = item.rowDisplayStatus ?? item.decision.displayStatus;
                    const isRestricted = rowStatus === "restricted";
                    const isFull = rowStatus === "full";
                    const label = isRestricted
                      ? `${item.date} — Restricted (override required)`
                      : isFull
                      ? `${item.date} — Full (override required)`
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
                  {t(language, "appointments.v2.noAvailableDates")}
                </p>
              )}
            </div>

            {(canUseNonStandardCapacityModes || canUseSpecialQuotaMode) && (
              <SpecialQuotaSection
                capacityResolutionMode={capacityResolutionMode}
                onChangeCapacityResolutionMode={(mode) => {
                  if (mode === "special_quota_extra" && !hasSpecialQuotaAvailable) return;
                  setCapacityResolutionMode(mode);
                  setDecision(null);
                  setEvaluationError(null);
                  setSubmitError(null);
                  setShowOverride(false);
                  setOverrideUsername("");
                  setOverridePassword("");
                  setOverrideReason("");
                }}
                specialQuotaAvailable={hasSpecialQuotaAvailable}
                supervisorMode={canUseNonStandardCapacityModes || canUseSpecialQuotaMode}
                superAdminMode={isSuperAdmin}
                allowCategoryOverride={canUseNonStandardCapacityModes}
                specialReasonCode={specialReasonCode}
                onChangeSpecialReasonCode={setSpecialReasonCode}
                specialReasonConfirmed={specialReasonConfirmed}
                onChangeSpecialReasonConfirmed={setSpecialReasonConfirmed}
                specialReasonNote={specialReasonNote}
                onChangeSpecialReasonNote={setSpecialReasonNote}
                options={specialReasonOptions}
              />
            )}

            {/* Decision Status */}
            {evaluating && (
              <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)" }}>
                {language === "ar" ? "جاري تقييم التاريخ المحدد…" : "Evaluating selected date…"}
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
                    ✅ {language === "ar" ? "متاح" : "Available"} — {decision.remainingStandardCapacity ?? 0} {language === "ar" ? "خانة متبقية" : "slots remaining"}
                  </span>
                )}
                {decision.displayStatus === "restricted" && decision.requiresSupervisorOverride && (
                  <span>⚠️ {language === "ar" ? "مطلوب اعتماد المشرف لهذا التاريخ." : "Supervisor approval is required for this date."}</span>
                )}
                {decision.displayStatus === "blocked" && (
                  <span>❌ {language === "ar" ? "التاريخ محجوب لهذا الجهاز." : "Date is blocked for this modality."}</span>
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
            {showOverride && (decision?.requiresSupervisorOverride || selectedCapacityModeNeedsOverrideAuth) && (
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
                    {t(language, "appointments.create.supervisorUsername")}
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
                    {t(language, "appointments.create.password")}
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
                    {t(language, "appointments.create.overrideReason")}
                  </label>
                   <Input
                     type="text"
                     value={overrideReason}
                     onChange={(e) => setOverrideReason(e.target.value)}
                     placeholder={t(language, "appointments.create.overrideReasonPlaceholder")}
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
                 {t(language, "appointments.v2.keepBooking")}
               </Button>
               <Button
                 type="submit"
                 disabled={
                   !newDate ||
                   isBlocked ||
                   !!evaluationError ||
                   evaluating ||
                   submitting ||
                   (specialQuotaNeedsDetails && (!specialReasonCode || !specialReasonConfirmed)) ||
                   (showOverride &&
                     (!overrideUsername.trim() || !overridePassword.trim() || !overrideReason.trim()))
                 }
                 style={{
                   backgroundColor: isBlocked || !newDate ? "var(--border)" : "var(--blue)",
                   color: "#fff",
                 }}
               >
                 {submitting ? t(language, "appointments.v2.rescheduling") : t(language, "appointments.v2.reschedule")}
               </Button>
             </DialogFooter>
           </form>
      </DialogContent>
    </Dialog>
  );
}
