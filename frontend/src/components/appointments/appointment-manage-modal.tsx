import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Edit3, ExternalLink, FileText, Loader2, MoreHorizontal, Printer, Upload, UserRound, X } from "lucide-react";
import {
  cancelAppointment,
  deleteAppointment,
  fetchAppointmentLookups,
  fetchPublicSchedulingCapacitySettings,
  fetchPublicAppointmentReportStatus,
  getAppointmentById,
  updateAppointmentStatus,
  type PublicReportStatusResponse,
} from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { normalizeAppointmentId } from "@/lib/appointment-id";
import { getPatientRequirementStaffMessage } from "@/lib/patient-requirement-messages";
import { AppointmentInformationView } from "@/components/appointments/appointment-information-view";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { PatientDrawer } from "@/components/patients/patient-drawer";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { pushToast } from "@/lib/toast";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { AnchoredMenu, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shared";
import {
  useCreateSchedulingOverrideRequest,
  rescheduleV2Booking,
  useV2SpecialReasonCodes,
} from "@/v2/appointments/api";
import type {
  BookingStatus,
  CapacityResolutionMode,
  RescheduleBookingRequest,
  SchedulingOverrideType,
} from "@/v2/appointments/types";
import { CANCELLABLE_STATUSES, RESCHEDULABLE_STATUSES } from "@/v2/appointments/types";
import { AvailabilityPanel } from "@/v2/appointments/components/AvailabilityPanel";
import { SpecialQuotaSection } from "@/v2/appointments/components/SpecialQuotaSection";
import { SupervisorOverrideModal } from "@/v2/appointments/components/SupervisorOverrideModal";
import { SchedulingOverrideRequestModal } from "@/v2/appointments/components/SchedulingOverrideRequestModal";
import { useAppointmentAvailability, type AvailabilityRowViewModel } from "@/v2/appointments/hooks/useAppointmentAvailability";
import { inferSupportedOverrideType } from "@/v2/appointments/utils/scheduling-override-requests";
import { useAuth } from "@/providers/auth-provider";

export type AppointmentManageTab =
  | "details"
  | "documents"
  | "report"
  | "reschedule"
  | "status"
  | "cancel";

export type AppointmentManageModalProps = {
  appointmentId: number | null;
  open: boolean;
  onClose: () => void;
  initialAppointment?: AppointmentWithDetails | null;
  initialTab?: AppointmentManageTab;
  checkReportOnOpen?: boolean;
  onTabChange?: (tab: AppointmentManageTab) => void;
  onAppointmentUpdated?: (appointment: AppointmentWithDetails) => void;
  onAppointmentDeleted?: (appointmentId: number) => void;
};

const MANAGE_TABS: AppointmentManageTab[] = ["details", "documents", "report", "reschedule", "cancel"];
const MANUAL_STATUS_OPTIONS = ["scheduled", "arrived", "waiting", "completed", "no-show", "discontinued"] as const;
const STATUS_REASON_REQUIRED = new Set<string>(["no-show", "discontinued"]);
const RESCHEDULE_AVAILABILITY_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function publicAppointmentToken(appointment: AppointmentWithDetails): string {
  const directToken = String(appointment.publicCancelToken || "").trim();
  if (directToken) return directToken;

  const rawUrl = String(appointment.publicAppointmentUrl || "").trim();
  if (!rawUrl) return "";

  try {
    return new URL(rawUrl).searchParams.get("t")?.trim() || "";
  } catch {
    return new URLSearchParams(rawUrl.split("?")[1] || "").get("t")?.trim() || "";
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function clampAvailabilityOffset(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function startDateFromOffset(offset: number): string {
  const start = new Date(`${todayIsoDate()}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + clampAvailabilityOffset(offset));
  return start.toISOString().slice(0, 10);
}

function offsetFromStartDate(isoDate: string): number {
  if (!isoDate) return 0;
  const start = new Date(`${todayIsoDate()}T00:00:00Z`).getTime();
  const selected = new Date(`${isoDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(selected)) return 0;
  return clampAvailabilityOffset(Math.floor((selected - start) / DAY_MS));
}

function protocolVersionText(appointment: AppointmentWithDetails): string | null {
  const summary = appointment.protocolAssignmentSummary;
  if (!summary) return null;
  return [summary.protocolName, summary.versionNumber ? `v${summary.versionNumber}` : null].filter(Boolean).join(" ");
}

function isProtocolModality(appointment: AppointmentWithDetails): boolean {
  const code = String(appointment.modalityCode || "").trim().toUpperCase();
  return code === "CT" || code === "MRI";
}

function appointmentStatusVariant(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "completed") return "success";
  if (["no-show", "cancelled", "voided"].includes(status)) return "error";
  if (["arrived", "waiting", "discontinued"].includes(status)) return "warning";
  if (["scheduled", "in-progress"].includes(status)) return "info";
  return "neutral";
}

function priorityVariant(priority: string | null | undefined): "warning" | "error" | "neutral" {
  const normalized = String(priority || "").toLowerCase();
  if (!normalized) return "neutral";
  if (normalized.includes("stat") || normalized.includes("urgent")) return "error";
  return "warning";
}

function AppointmentHeaderBadgeCluster({ appointment, language }: { appointment: AppointmentWithDetails; language: "ar" | "en" }) {
  const priority = chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn);
  const protocolAssigned = Boolean(appointment.protocolAssignmentSummary);
  return <div data-testid="appointment-header-badge-cluster" className="flex min-w-0 flex-wrap items-center gap-2">
    <PatientCategoryBadge category={appointment.caseCategory} showWhenUnset size="default" />
    <Badge variant={appointmentStatusVariant(appointment.status)} className="whitespace-nowrap">{statusLabel(language, appointment.status)}</Badge>
    <Badge variant={priorityVariant(priority)} className="whitespace-nowrap">{priority || chooseLocalized(language, "الأولوية غير محددة", "Priority not assigned")}</Badge>
    <Badge variant={appointment.requiresReport ? "info" : "neutral"} className="whitespace-nowrap">{appointment.requiresReport ? chooseLocalized(language, "التقرير مطلوب", "Report required") : chooseLocalized(language, "التقرير غير مطلوب", "Report not required")}</Badge>
    {isProtocolModality(appointment) ? <Badge variant={protocolAssigned ? "success" : "neutral"} className="whitespace-nowrap">{protocolAssigned ? chooseLocalized(language, "البروتوكول معين", "Protocol assigned") : chooseLocalized(language, "البروتوكول غير معين", "Protocol not assigned")}</Badge> : null}
  </div>;
}

export function AppointmentManageModal({
  appointmentId,
  open,
  onClose,
  initialAppointment,
  initialTab = "documents",
  checkReportOnOpen = false,
  onTabChange,
  onAppointmentUpdated,
  onAppointmentDeleted,
}: AppointmentManageModalProps) {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isRtl = language === "ar";
  const normalizedAppointmentId = normalizeAppointmentId(appointmentId);
  const [activeTab, setActiveTab] = useState<AppointmentManageTab>(initialTab);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [documentReviewExpanded, setDocumentReviewExpanded] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [reportStatus, setReportStatus] = useState<PublicReportStatusResponse | null>(null);
  const [reportError, setReportError] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleSelectedRow, setRescheduleSelectedRow] = useState<AvailabilityRowViewModel | null>(null);
  const [rescheduleOffset, setRescheduleOffset] = useState(0);
  const [rescheduleShowFullDays, setRescheduleShowFullDays] = useState(false);
  const [rescheduleShowWeekendDays, setRescheduleShowWeekendDays] = useState(false);
  const [rescheduleOverrideOpen, setRescheduleOverrideOpen] = useState(false);
  const [rescheduleOverrideError, setRescheduleOverrideError] = useState<string | null>(null);
  const [rescheduleOverrideLoading, setRescheduleOverrideLoading] = useState(false);
  const [pendingReschedulePayload, setPendingReschedulePayload] = useState<RescheduleBookingRequest | null>(null);
  const [rescheduleRequestOpen, setRescheduleRequestOpen] = useState(false);
  const [rescheduleRequestError, setRescheduleRequestError] = useState<string | null>(null);
  const [rescheduleRequestOverrideType, setRescheduleRequestOverrideType] = useState<SchedulingOverrideType | null>(null);
  const [rescheduleCapacityResolutionMode, setRescheduleCapacityResolutionMode] = useState<CapacityResolutionMode>("standard");
  const [rescheduleSpecialReasonCode, setRescheduleSpecialReasonCode] = useState("");
  const [rescheduleSpecialReasonConfirmed, setRescheduleSpecialReasonConfirmed] = useState(false);
  const [rescheduleSpecialReasonNote, setRescheduleSpecialReasonNote] = useState("");
  const [manualStatus, setManualStatus] = useState<(typeof MANUAL_STATUS_OPTIONS)[number]>("scheduled");
  const [manualStatusReason, setManualStatusReason] = useState("");
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusDialogError, setStatusDialogError] = useState<string | null>(null);
  const legacyStatusKeyRef = useRef<string | null>(null);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const appointmentQuery = useQuery({
    queryKey: ["appointment-manage-modal", normalizedAppointmentId],
    queryFn: () => {
      if (normalizedAppointmentId === null) {
        throw new Error(t("registrations.appointmentInvalidReference"));
      }
      return getAppointmentById(normalizedAppointmentId);
    },
    enabled: open && normalizedAppointmentId !== null,
    initialData: initialAppointment?.id === normalizedAppointmentId ? initialAppointment : undefined,
    staleTime: 30_000,
  });
  const appointment = appointmentQuery.data ?? null;

  useEffect(() => {
    if (!open || !appointment || appointment.id !== normalizedAppointmentId) return;
    onAppointmentUpdated?.(appointment);
  }, [appointment, normalizedAppointmentId, onAppointmentUpdated, open]);

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    enabled: open && normalizedAppointmentId !== null,
    staleTime: 1000 * 60 * 5,
  });
  const { data: schedulingCapacitySettings } = useQuery({
    queryKey: ["settings", "scheduling_and_capacity", "public"],
    queryFn: fetchPublicSchedulingCapacitySettings,
    enabled: open && normalizedAppointmentId !== null,
    staleTime: 60_000,
  });
  const { data: specialReasonOptions = [] } = useV2SpecialReasonCodes(open && normalizedAppointmentId !== null);
  const isSuperAdmin = user?.role === "super_admin";
  const canAttachDocuments = user?.role === "receptionist" || user?.role === "supervisor" || user?.role === "super_admin";
  const canUseNonStandardCapacityModes = user?.role === "supervisor" || user?.role === "super_admin";
  const selectedCanReschedule = Boolean(appointment && RESCHEDULABLE_STATUSES.includes(appointment.status as BookingStatus));
  const selectedCanCancel = Boolean(appointment && CANCELLABLE_STATUSES.includes(appointment.status as BookingStatus));
  const rescheduleAvailability = useAppointmentAvailability({
    patientId: activeTab === "reschedule" && selectedCanReschedule ? appointment?.patientId ?? null : null,
    modalityId: appointment?.modalityId ?? null,
    examTypeId: appointment?.examTypeId ?? null,
    caseCategory: appointment?.caseCategory ?? "non_oncology",
    capacityResolutionMode:
      rescheduleCapacityResolutionMode === "special_quota_extra"
        ? rescheduleCapacityResolutionMode
        : canUseNonStandardCapacityModes
          ? rescheduleCapacityResolutionMode
          : "standard",
    specialReasonCode: rescheduleCapacityResolutionMode === "special_quota_extra" ? rescheduleSpecialReasonCode || null : null,
    days: 14,
    offset: rescheduleOffset,
  });
  const selectedRescheduleAvailabilityItem = rescheduleAvailability.rawItems.find((item) => item.date === rescheduleDate);
  const rescheduleSpecialQuotaAvailable = (selectedRescheduleAvailabilityItem?.specialQuotaSummary?.remaining ?? 0) > 0;
  const rescheduleAnySpecialQuotaAvailable = rescheduleAvailability.rawItems.some((item) => (item.specialQuotaSummary?.remaining ?? 0) > 0);
  const canUseRescheduleSpecialQuota = isSuperAdmin || rescheduleSpecialQuotaAvailable || rescheduleAnySpecialQuotaAvailable || rescheduleCapacityResolutionMode === "special_quota_extra";
  const canUseSelectedRescheduleCapacityMode =
    rescheduleCapacityResolutionMode === "special_quota_extra" ? canUseRescheduleSpecialQuota : canUseNonStandardCapacityModes;
  const rescheduleCapacityModeNeedsOverrideAuth = canUseNonStandardCapacityModes && (rescheduleCapacityResolutionMode === "category_override" || rescheduleCapacityResolutionMode === "total_capacity_override");
  const rescheduleSpecialQuotaNeedsDetails = canUseRescheduleSpecialQuota && rescheduleCapacityResolutionMode === "special_quota_extra";
  const createRescheduleOverrideRequestMutation = useCreateSchedulingOverrideRequest();

  const updateDisplayedAppointment = useCallback(
    (updated: AppointmentWithDetails) => {
      queryClient.setQueryData(["appointment-manage-modal", updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      onAppointmentUpdated?.(updated);
    },
    [onAppointmentUpdated, queryClient],
  );

  const closeModal = useCallback(() => {
    setSelectedPatientId(null);
    setReportStatus(null);
    setReportError("");
    setRescheduleOverrideOpen(false);
    setRescheduleRequestOpen(false);
    setDocumentReviewExpanded(false);
    setActionMenuOpen(false);
    setCancelConfirmOpen(false);
    setStatusDialogOpen(false);
    setStatusDialogError(null);
    setVoidDialogOpen(false);
    setVoidReason("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open || !documentReviewExpanded) return;
    const handleExpandedEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setDocumentReviewExpanded(false);
    };
    document.addEventListener("keydown", handleExpandedEscape, true);
    return () => document.removeEventListener("keydown", handleExpandedEscape, true);
  }, [documentReviewExpanded, open]);

  const selectTab = (tab: AppointmentManageTab) => {
    if (tab === "status") {
      setActionMenuOpen(false);
      setStatusDialogError(null);
      setStatusDialogOpen(true);
      return;
    }
    if (tab !== "documents") setDocumentReviewExpanded(false);
    setActiveTab(tab);
    setActionMenuOpen(false);
    setCancelConfirmOpen(false);
    onTabChange?.(tab);
  };

  const voidMutation = useMutation({
    mutationFn: async () => {
      if (!appointment || !voidReason.trim()) throw new Error(t("appointmentEditor.voidReasonRequired"));
      await deleteAppointment(appointment.id, voidReason.trim());
      return appointment.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      pushToast({ type: "success", title: t("appointmentEditor.toastVoided"), message: t("appointmentEditor.toastVoidedMsg") });
      setVoidDialogOpen(false);
      setVoidReason("");
      onAppointmentDeleted?.(appointment?.id ?? 0);
      closeModal();
    },
    onError: (error: unknown) => {
      pushToast({ type: "error", title: t("appointmentEditor.toastVoidFailed"), message: getErrorMessage(error, t("appointmentEditor.toastVoidFailedMsg")) });
    },
  });

  const reportStatusMutation = useMutation({
    mutationFn: (token: string) => fetchPublicAppointmentReportStatus(token),
    onSuccess: (status) => {
      setReportStatus(status);
      setReportError("");
    },
    onError: (error) => {
      setReportStatus(null);
      setReportError(error instanceof Error ? error.message : t("registrations.reportStatusFailed"));
    },
  });

  useEffect(() => {
    if (!open || !appointment || initialTab !== "report" || !checkReportOnOpen) return;
    const token = publicAppointmentToken(appointment);
    if (!token) {
      setReportStatus(null);
      setReportError(t("registrations.reportUnavailable"));
      return;
    }
    reportStatusMutation.mutate(token);
    // The row action requests one check for the selected appointment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment?.id, checkReportOnOpen, initialTab, open]);

  const cancelMutation = useMutation({
    mutationFn: (id: number) => cancelAppointment(id, "Cancelled from appointment management"),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      pushToast({ type: "success", title: t("registrations.cancelledTitle"), message: t("registrations.cancelledMessage") });
      onAppointmentDeleted?.(id);
      closeModal();
    },
    onError: (err: unknown) => {
      pushToast({ type: "error", title: t("registrations.cancelFailedTitle"), message: getErrorMessage(err, t("registrations.cancelFailedMessage")) });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (payload: { appointmentId: number; status: string; reason: string | null }) => {
      await updateAppointmentStatus(payload.appointmentId, payload.status, payload.reason);
      return getAppointmentById(payload.appointmentId);
    },
    meta: { suppressGlobalToast: true },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      updateDisplayedAppointment(updated);
      setManualStatus(updated.status as (typeof MANUAL_STATUS_OPTIONS)[number]);
      setManualStatusReason("");
      setStatusDialogError(null);
      setStatusDialogOpen(false);
      pushToast({ type: "success", title: chooseLocalized(language, "تم تحديث الحالة", "Status updated"), message: statusLabel(language, updated.status) });
    },
    onError: (err: unknown) => {
      setStatusDialogError(getErrorMessage(err, chooseLocalized(language, "تعذر تحديث الحالة", "Status update failed")));
      pushToast({ type: "error", title: chooseLocalized(language, "تعذر تحديث الحالة", "Status update failed"), message: getErrorMessage(err, chooseLocalized(language, "حاول مرة أخرى.", "Please try again.")) });
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: async (input: { appointment: AppointmentWithDetails; newDate: string; payload: RescheduleBookingRequest }) => {
      await rescheduleV2Booking(input.appointment.id, input.payload);
      return getAppointmentById(input.appointment.id);
    },
    meta: { suppressGlobalToast: true },
    onSuccess: (updated, variables) => {
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["registration-reschedule-availability"] });
      updateDisplayedAppointment(updated);
      setRescheduleDate("");
      setRescheduleReason("");
      setRescheduleSelectedRow(null);
      setRescheduleOverrideOpen(false);
      setPendingReschedulePayload(null);
      setRescheduleOverrideError(null);
      setRescheduleCapacityResolutionMode("standard");
      setRescheduleSpecialReasonCode("");
      setRescheduleSpecialReasonConfirmed(false);
      setRescheduleSpecialReasonNote("");
      pushToast({ type: "success", title: t("registrations.rescheduleSuccessTitle"), message: `${formatDateLy(variables.appointment.appointmentDate)} → ${formatDateLy(variables.newDate)}` });
    },
    onError: (err: unknown) => {
      pushToast({ type: "error", title: t("registrations.rescheduleFailedTitle"), message: getPatientRequirementStaffMessage(err, t) || getErrorMessage(err, t("registrations.rescheduleFailedMessage")) });
    },
  });

  const allowReceptionOverrideRequestsFromAvailability =
    String(schedulingCapacitySettings?.allow_reception_override_requests_from_availability ?? "enabled") !== "disabled" &&
    String(schedulingCapacitySettings?.can_request_scheduling_override ?? "disabled") === "enabled";
  const createRescheduleOverrideRequest = createRescheduleOverrideRequestMutation;
  const canSubmitReschedule =
    Boolean(appointment && rescheduleDate && rescheduleSelectedRow) &&
    (!rescheduleSpecialQuotaNeedsDetails || (Boolean(rescheduleSpecialReasonCode) && rescheduleSpecialReasonConfirmed)) &&
    !rescheduleMutation.isPending;

  const buildReschedulePayload = (): RescheduleBookingRequest | null => {
    if (!appointment || !rescheduleDate || !rescheduleSelectedRow) return null;
    return {
      bookingDate: rescheduleDate,
      bookingTime: null,
      capacityResolutionMode: canUseSelectedRescheduleCapacityMode ? rescheduleCapacityResolutionMode : "standard",
      useSpecialQuota: canUseRescheduleSpecialQuota && rescheduleCapacityResolutionMode === "special_quota_extra",
      specialReasonCode: canUseRescheduleSpecialQuota && rescheduleCapacityResolutionMode === "special_quota_extra" ? rescheduleSpecialReasonCode || null : null,
      specialReasonNote: canUseRescheduleSpecialQuota && rescheduleCapacityResolutionMode === "special_quota_extra" ? rescheduleSpecialReasonNote.trim() || null : null,
      rescheduleReason: rescheduleReason.trim() || null,
    };
  };

  const submitReschedulePayload = async (selected: AppointmentWithDetails, payload: RescheduleBookingRequest) => {
    await rescheduleMutation.mutateAsync({ appointment: selected, newDate: payload.bookingDate, payload });
  };

  const submitReschedule = () => {
    if (!appointment || !canSubmitReschedule) return;
    const payload = buildReschedulePayload();
    if (!payload) return;
    const supportedOverrideType = allowReceptionOverrideRequestsFromAvailability ? inferSupportedOverrideType(rescheduleSelectedRow?.reasonCodes) : null;
    if (rescheduleSelectedRow?.requiresSupervisorOverride || rescheduleSelectedRow?.status === "restricted" || rescheduleSelectedRow?.status === "full" || (rescheduleSelectedRow?.status === "blocked" && supportedOverrideType) || rescheduleCapacityModeNeedsOverrideAuth) {
      if (user?.role === "receptionist" && supportedOverrideType) {
        setPendingReschedulePayload(payload);
        setRescheduleRequestOverrideType(supportedOverrideType);
        setRescheduleRequestError(null);
        setRescheduleRequestOpen(true);
        return;
      }
      setPendingReschedulePayload(payload);
      setRescheduleOverrideError(null);
      setRescheduleOverrideOpen(true);
      return;
    }
    void submitReschedulePayload(appointment, payload);
  };

  const handleRescheduleOverrideConfirm = async (overridePayload: { supervisorUsername: string; supervisorPassword: string; overrideReason: string }) => {
    if (!appointment || !pendingReschedulePayload) return;
    if (!overridePayload.overrideReason.trim()) {
      setRescheduleOverrideError(t("appointments.create.overrideReasonRequired"));
      return;
    }
    setRescheduleOverrideLoading(true);
    setRescheduleOverrideError(null);
    try {
      await submitReschedulePayload(appointment, {
        ...pendingReschedulePayload,
        override: {
          supervisorUsername: overridePayload.supervisorUsername,
          supervisorPassword: overridePayload.supervisorPassword,
          reason: overridePayload.overrideReason.trim(),
        },
      });
      setRescheduleOverrideOpen(false);
      setPendingReschedulePayload(null);
    } finally {
      setRescheduleOverrideLoading(false);
    }
  };

  const submitRescheduleOverrideRequest = async (requesterReason: string) => {
    if (!appointment || !pendingReschedulePayload) return;
    setRescheduleRequestError(null);
    try {
      await createRescheduleOverrideRequest.mutateAsync({
        requestType: "reschedule_booking",
        bookingId: appointment.id,
        requesterReason,
        createdFromContext: "registrations_reschedule",
        requestPayload: { ...pendingReschedulePayload, capacityResolutionMode: "standard" },
      });
      setRescheduleRequestOpen(false);
      setPendingReschedulePayload(null);
      pushToast({ type: "success", title: t("overrideRequests.submittedTitle"), message: t("overrideRequests.rescheduleSubmittedMessage") });
      queryClient.invalidateQueries({ queryKey: ["v2-scheduling-override-requests"] });
    } catch (error) {
      setRescheduleRequestError(error instanceof Error ? error.message : t("overrideRequests.submitFailed"));
    }
  };

  const checkReportStatus = () => {
    if (!appointment) return;
    const token = publicAppointmentToken(appointment);
    if (!token) {
      setReportStatus(null);
      setReportError(t("registrations.reportUnavailable"));
      return;
    }
    reportStatusMutation.mutate(token);
  };

  const openReport = () => {
    if (!appointment) return;
    const token = publicAppointmentToken(appointment);
    if (token) window.location.href = `/api/public/appointments/report-open?t=${encodeURIComponent(token)}`;
  };

  useEffect(() => {
    const nextTab = initialTab === "status" ? "documents" : MANAGE_TABS.includes(initialTab) ? initialTab : "documents";
    setActiveTab(nextTab);
    setReportStatus(null);
    setReportError("");
    setSelectedPatientId(null);
    setDocumentReviewExpanded(false);
    setActionMenuOpen(false);
    setCancelConfirmOpen(initialTab === "cancel");
    setVoidDialogOpen(false);
    setVoidReason("");
    const statusKey = `${normalizedAppointmentId ?? "none"}`;
    if (initialTab === "status" && legacyStatusKeyRef.current !== statusKey) {
      legacyStatusKeyRef.current = statusKey;
      setStatusDialogOpen(true);
      setStatusDialogError(null);
      onTabChange?.("documents");
    } else if (normalizedAppointmentId !== null && legacyStatusKeyRef.current !== statusKey) {
      setStatusDialogOpen(false);
      setStatusDialogError(null);
    }
  }, [initialTab, normalizedAppointmentId, onTabChange]);

  useEffect(() => {
    setRescheduleDate("");
    setRescheduleReason("");
    setRescheduleSelectedRow(null);
    setRescheduleOverrideOpen(false);
    setPendingReschedulePayload(null);
    setRescheduleOverrideError(null);
    setRescheduleCapacityResolutionMode("standard");
    setRescheduleSpecialReasonCode("");
    setRescheduleSpecialReasonConfirmed(false);
    setRescheduleSpecialReasonNote("");
    if (appointment?.status && MANUAL_STATUS_OPTIONS.includes(appointment.status as (typeof MANUAL_STATUS_OPTIONS)[number])) {
      setManualStatus(appointment.status as (typeof MANUAL_STATUS_OPTIONS)[number]);
    }
    setManualStatusReason("");
  }, [appointment?.id, appointment?.status, activeTab]);

  useEffect(() => {
    if (open && activeTab === "cancel" && appointment) setCancelConfirmOpen(true);
  }, [activeTab, appointment, open]);

  useEffect(() => {
    if (rescheduleCapacityResolutionMode === "special_quota_extra" && !rescheduleAvailability.isLoading && !rescheduleSpecialQuotaAvailable) {
      setRescheduleCapacityResolutionMode("standard");
      setRescheduleSpecialReasonCode("");
      setRescheduleSpecialReasonConfirmed(false);
      setRescheduleSpecialReasonNote("");
    }
  }, [rescheduleAvailability.isLoading, rescheduleCapacityResolutionMode, rescheduleSpecialQuotaAvailable]);

  useEffect(() => {
    if (!open || !appointment) return;
    const handlePrintShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "p") return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable) return;
      event.preventDefault();
      void printAppointmentSlipById(appointment.id, language);
    };
    document.addEventListener("keydown", handlePrintShortcut);
    return () => document.removeEventListener("keydown", handlePrintShortcut);
  }, [appointment, language, open]);

  if (!open) return null;

  const dialogTitle = appointment ? chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName) : t("registrations.manage");
  const statusReasonRequired = Boolean(appointment && (STATUS_REASON_REQUIRED.has(manualStatus) || (appointment.status === "completed" && manualStatus === "arrived")));
  const reportPanel = appointment ? (
    <section className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{chooseLocalized(language, "الصور والتقرير", "Images and report")}</h3><p className="mt-1 text-[11px] text-muted-foreground"><span dir="ltr" className="font-mono-data">{appointment.accessionNumber}</span> · {chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn)}</p></div><FileText size={17} className="text-muted-foreground" aria-hidden="true" /></div>
      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-xs"><span className="text-muted-foreground">{appointment.studyInstanceUid ? chooseLocalized(language, "الدراسة مرتبطة", "Study linked") : chooseLocalized(language, "الدراسة غير متاحة", "Study unavailable")}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${reportStatus?.canViewReport ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{reportStatus?.canViewReport ? chooseLocalized(language, "جاهز", "Ready") : chooseLocalized(language, "غير مفحوص", "Not checked")}</span></div>
      {reportError ? <p className="mt-2 text-xs text-red-700" role="alert">{reportError}</p> : <p className="mt-2 text-xs leading-5 text-muted-foreground">{reportStatus?.message || t("registrations.reportHint")}</p>}
      <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" className="min-h-9 flex-1 text-xs" disabled={!publicAppointmentToken(appointment) || reportStatusMutation.isPending} onClick={checkReportStatus}>{reportStatusMutation.isPending ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : null}{reportStatusMutation.isPending ? t("registrations.reportChecking") : t("registrations.reportCheck")}</Button>{reportStatus?.canViewReport ? <Button type="button" size="sm" className="min-h-9 flex-1 text-xs" onClick={openReport}><ExternalLink size={14} className="me-1.5" aria-hidden="true" />{reportStatus.viewButtonLabel || t("registrations.reportOpen")}</Button> : null}</div>
    </section>
  ) : null;
  const protocolPanel = appointment ? (
    <section className="rounded-xl border border-border bg-background p-3"><details><summary className="cursor-pointer list-none text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><span className="flex items-center justify-between gap-2"><span>{chooseLocalized(language, "البروتوكول والملاحظات", "Protocol and notes")}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${appointment.protocolAssignmentSummary ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{appointment.protocolAssignmentSummary ? chooseLocalized(language, "معين", "Assigned") : chooseLocalized(language, "غير معين", "Not assigned")}</span></span></summary><div className="mt-3 space-y-2 text-xs text-muted-foreground">{appointment.protocolAssignmentSummary ? <><p className="font-semibold text-foreground">{protocolVersionText(appointment)}</p><p>{appointment.protocolAssignmentSummary.scannerName || chooseLocalized(language, "لم يتم اختيار جهاز", "Scanner not selected")}</p><p>{appointment.protocolAssignmentSummary.protocolNotes || chooseLocalized(language, "لا توجد ملاحظات بروتوكول", "No protocol notes")}</p><p>{appointment.protocolAssignmentSummary.contrastNotes || chooseLocalized(language, "لا توجد ملاحظات تباين", "No contrast notes")}</p></> : <p>{chooseLocalized(language, "لا يوجد بروتوكول معين لهذا الموعد.", "No protocol is assigned to this appointment.")}</p>}{appointment.notes ? <div className="border-t border-border pt-2"><p className="mb-1 font-semibold text-foreground">{chooseLocalized(language, "ملاحظات الموعد", "Appointment notes")}</p><p>{appointment.notes}</p></div> : null}</div></details></section>
  ) : null;
  const canVoidAppointment = user?.role === "supervisor" || user?.role === "super_admin";
  const moreMenuItems = appointment ? <>
    {selectedCanReschedule ? <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => { setActionMenuOpen(false); selectTab("reschedule"); }}><CalendarClock size={15} aria-hidden="true" />{t("registrations.reschedule")}</button> : null}
    <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => { setActionMenuOpen(false); selectTab("status"); }}><FileText size={15} aria-hidden="true" />{chooseLocalized(language, "تغيير الحالة", "Change status")}</button>
    {selectedCanCancel ? <><div role="separator" className="my-1 border-t border-border" /><button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500" onClick={() => { setActionMenuOpen(false); selectTab("cancel"); }}><X size={15} aria-hidden="true" />{t("registrations.cancelAppointment")}</button></> : null}
    {canVoidAppointment ? <><div role="separator" className="my-1 border-t border-border" /><button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500" onClick={() => { setActionMenuOpen(false); setVoidReason(""); setVoidDialogOpen(true); }}><X size={15} aria-hidden="true" />{t("appointmentEditor.void")}</button></> : null}
  </> : null;

  return (
    <>
    <Dialog open={open} onClose={closeModal}>
      <DialogContent
        maxWidth={documentReviewExpanded ? "calc(100vw - 16px)" : "min(98vw, 1500px)"}
        scrollable={false}
        role="dialog"
        aria-modal="true"
        aria-label={t("registrations.manage")}
        dir={isRtl ? "rtl" : "ltr"}
        className={`flex min-h-0 flex-col overflow-hidden !p-0 ${documentReviewExpanded ? "!m-2 !h-[calc(100dvh-16px)] !max-h-[calc(100dvh-16px)] !rounded-lg" : "h-[94dvh] !rounded-2xl"}`}
      >
        <DialogHeader closeLabel={t("toast.close")} className="sticky top-0 z-30 mb-0 shrink-0 border-b border-border bg-background px-3 py-2.5 sm:px-5 sm:py-3">
          {appointment ? <div data-testid="compact-document-appointment-header" className="grid min-w-0 gap-3 lg:grid-cols-[minmax(220px,1.1fr)_minmax(240px,1fr)_minmax(280px,1.4fr)_auto] lg:items-center">
            <div className="min-w-0"><DialogTitle className="truncate text-base font-semibold sm:text-lg">{dialogTitle}</DialogTitle><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span dir="ltr" className="font-mono-data [unicode-bidi:isolate]">MRN {appointment.mrn || appointment.patientPrimaryIdentifierValue || "—"}</span><span dir="ltr" className="font-mono-data [unicode-bidi:isolate]">{appointment.accessionNumber}</span></div></div>
            <div className="min-w-0 border-s border-border ps-3"><p className="truncate text-sm font-semibold text-foreground sm:text-[15px]">{chooseLocalized(language, appointment.examNameAr, appointment.examNameEn) || "—"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn)} · {appointment.modalityCode || "—"}</p></div>
            <div className="min-w-0 border-s border-border ps-3"><AppointmentHeaderBadgeCluster appointment={appointment} language={language} /><p className="mt-2 text-xs text-muted-foreground"><span dir="ltr" className="[unicode-bidi:isolate]">{formatDateLy(appointment.appointmentDate)} · {appointment.bookingTime || chooseLocalized(language, "الوقت غير محدد", "Time not assigned")}</span></p></div>
            <div className="relative flex flex-wrap items-center justify-start gap-1.5 lg:justify-end"><Button type="button" variant="secondary" size="sm" className="!h-9 !min-h-9 !px-3 text-xs" onClick={() => selectTab("details")}><Edit3 size={14} className="me-1.5" aria-hidden="true" /><span className="hidden sm:inline">{t("registrations.detailsEdit")}</span></Button><Button type="button" variant="secondary" size="sm" className="!h-9 !min-h-9 !px-3 text-xs" onClick={() => void printAppointmentSlipById(appointment.id, language)}><Printer size={14} className="me-1.5" aria-hidden="true" /><span className="hidden sm:inline">{t("registrations.print")}</span></Button><Button type="button" variant="secondary" size="sm" className="!h-9 !min-h-9 !px-3 text-xs" onClick={() => setSelectedPatientId(appointment.patientId)}><UserRound size={14} className="me-1.5" aria-hidden="true" /><span className="hidden sm:inline">{t("registrations.openPatientProfile")}</span></Button><AnchoredMenu open={actionMenuOpen} onOpenChange={setActionMenuOpen} dir={isRtl ? "rtl" : "ltr"} trigger={<Button type="button" variant="secondary" size="sm" className="!h-9 !min-h-9 !w-9 !p-0" aria-label={t("requestScans.actions.more")}><MoreHorizontal size={16} aria-hidden="true" /></Button>}>{moreMenuItems}</AnchoredMenu></div>
          </div> : <DialogTitle>{t("registrations.manage")}</DialogTitle>}
        </DialogHeader>
        {/*
            <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="truncate text-sm sm:text-base">{dialogTitle}</DialogTitle>
                  {appointment ? <PatientCategoryBadge category={appointment.caseCategory} showWhenUnset={false} size="sm" /> : null}
                </div>
                {appointment ? (
                  <p className="text-[11px] text-muted-foreground sm:text-xs">
                    <span dir="ltr" className="font-mono-data">{appointment.accessionNumber}</span> • {chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn)}
                  </p>
                ) : null}
              </div>
              {appointment && !documentReviewExpanded ? (
                <div className="flex flex-wrap gap-1">
                  <Button type="button" variant="secondary" size="sm" className="h-8 px-2.5 text-[10px]" onClick={() => setSelectedPatientId(appointment.patientId)}>
                    {t("registrations.openPatientProfile")}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" className="h-8 px-2.5 text-[10px]" onClick={() => void printAppointmentSlipById(appointment.id, language)}>
                    {t("registrations.print")}
                  </Button>
                </div>
              ) : null}
            </div>
            {appointment && activeTab === "documents" ? (
              <div
                data-testid="legacy-appointment-header"
                className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
                aria-label={t("registrations.requestDocuments")}
              >
                <span>{chooseLocalized(language, appointment.examNameAr, appointment.examNameEn)}</span>
                <span>{formatDateLy(appointment.appointmentDate)}</span>
                <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                  {statusLabel(language, appointment.status)}
                </span>
              </div>
            ) : appointment && !documentReviewExpanded ? (
              <>
                <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <Field label={t("registrations.patient")} value={chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName)} />
                  <Field label={t("registrations.accession")} value={<span dir="ltr" className="font-mono-data">{appointment.accessionNumber}</span>} />
                  <Field label={t("registrations.modality")} value={[chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn), chooseLocalized(language, appointment.examNameAr, appointment.examNameEn)].filter(Boolean).join(" • ") || "—"} />
                  <Field label={t("registrations.date")} value={formatDateLy(appointment.appointmentDate)} />
                  <Field label={t("registrations.createdAt")} value={formatDateTimeLy(appointment.createdAt)} />
                  <Field label={t("registrations.createdBy")} value={selectedAppointmentCreatedBy} />
                  {appointment.arrivedAt ? <Field label={chooseLocalized(language, "وقت الوصول", "Arrival time")} value={formatDateTimeLy(appointment.arrivedAt)} /> : null}
                  {(appointment.status === "arrived" || appointment.status === "waiting") && appointment.arrivedAt ? <Field label={chooseLocalized(language, "مدة الانتظار", "Waiting duration")} value={formatElapsedSince(language, appointment.arrivedAt)} /> : null}
                  {appointment.completedAt ? <Field label={chooseLocalized(language, "وقت الإكمال", "Completed at")} value={formatDateTimeLy(appointment.completedAt)} /> : null}
                </div>
                <div className="mt-2"><span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">{statusLabel(language, appointment.status)}</span></div>
                <ProtocolDetailSummary appointment={appointment} />
              </>
            ) : null}
          </div>
        */}

          {/*
          <div className="hidden shrink-0 border-b border-border px-0 py-2" aria-hidden="true">
            <div role="tablist" aria-label={t("registrations.manage")} className="flex max-w-full flex-wrap gap-1.5">
              {MANAGE_TABS.map((tab) => {
                const label = tab === "details" ? t("registrations.detailsEdit") : tab === "documents" ? t("registrations.requestDocuments") : tab === "report" ? t("registrations.report") : tab === "reschedule" ? t("registrations.reschedule") : tab === "status" ? chooseLocalized(language, "الحالة", "Status") : t("registrations.cancelAppointment");
                return <Button key={tab} type="button" role="tab" aria-selected={activeTab === tab} size="sm" variant={activeTab === tab ? "secondary" : "ghost"} className="h-8 px-2.5 text-[10px]" onClick={() => { if (tab === "report") { setReportStatus(null); setReportError(""); } selectTab(tab); }}>{label}</Button>;
              })}
            </div>
          </div>
        ) : null}

        */}
        <div className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3" aria-busy={appointmentQuery.isLoading}>
          {normalizedAppointmentId === null ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert"><p className="font-semibold">{t("registrations.appointmentInvalidReference")}</p></div> : null}
          {appointmentQuery.isLoading && !appointment ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground" role="status">{t("registrations.appointmentLoading")}</div> : null}
          {appointmentQuery.isError && !appointment ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert"><p className="font-semibold">{t("registrations.appointmentLoadFailed")}</p><p className="mt-1">{getErrorMessage(appointmentQuery.error, t("registrations.appointmentLoadFailed"))}</p></div> : null}

          {appointment && activeTab === "details" ? <div className="absolute inset-2 z-30 overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl sm:inset-3 sm:p-5"><AppointmentInformationView key={appointment.id} appointment={appointment} lookups={lookups} reportStatus={reportStatus} onBack={() => selectTab("documents")} onOpenPatientProfile={() => setSelectedPatientId(appointment.patientId)} onOpenReschedule={selectedCanReschedule ? () => selectTab("reschedule") : undefined} onOpenStatus={() => selectTab("status")} onAppointmentUpdated={updateDisplayedAppointment} /></div> : null}


          {appointment && activeTab === "documents" ? <div className="h-full min-h-0"><RequestDocumentsPanel appointmentId={appointment.id} patientId={appointment.patientId} appointmentRefType="v2_booking" title={t("registrations.requestDocuments")} previewMode="inline" enableLocalScan layout="workspace" supplementaryPanel={<>{reportPanel}{protocolPanel}</>} expanded={documentReviewExpanded} onExpandedChange={setDocumentReviewExpanded} /></div> : null}

          <div className={activeTab !== "documents" && activeTab !== "details" ? "absolute inset-2 z-20 overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl sm:inset-3 sm:p-5" : "hidden"}>
          {appointment && activeTab === "report" ? (
            <div className="absolute inset-2 z-20 overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl sm:inset-3 sm:p-5">
              <div className="mb-3"><h4 className="text-sm font-semibold">{t("registrations.report")}</h4><p className="mt-1 text-xs text-muted-foreground"><span dir="ltr" className="font-mono-data">{appointment.accessionNumber}</span> • {chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn)}</p></div>
              {appointment.sonicDicomStudyNote?.trim() ? <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm" title={`PACS note: ${appointment.sonicDicomStudyNote.trim()}`}><p className="text-xs font-semibold uppercase text-amber-700">PACS note</p><p className="mt-1 text-amber-900" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{appointment.sonicDicomStudyNote.trim()}</p></div> : null}
              <div className="rounded-xl border border-border bg-background p-3 text-sm">{reportError ? <p className="text-red-700">{reportError}</p> : reportStatus ? <p className="text-muted-foreground">{reportStatus.message}</p> : <p className="text-muted-foreground">{t("registrations.reportHint")}</p>}</div>
              <div className={isRtl ? "mt-3 flex justify-start" : "mt-3 flex justify-end"}><Button type="button" size="sm" disabled={!publicAppointmentToken(appointment) || reportStatusMutation.isPending} onClick={checkReportStatus}>{reportStatusMutation.isPending ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />{t("registrations.reportChecking")}</span> : t("registrations.reportCheck")}</Button></div>
              {reportStatus?.canViewReport ? <div className={isRtl ? "mt-3 flex justify-start" : "mt-3 flex justify-end"}><Button type="button" size="sm" variant="secondary" onClick={openReport}><ExternalLink size={14} className="me-2" />{reportStatus.viewButtonLabel || t("registrations.reportOpen")}</Button></div> : null}
            </div>
          ) : null}

          {appointment && activeTab === "reschedule" ? (
            selectedCanReschedule ? <div className="absolute inset-2 z-20 overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl sm:inset-3 sm:p-5"><div className="mb-3 flex items-center justify-between gap-2"><div><h4 className="text-sm font-semibold">{t("registrations.reschedule")}</h4><p className="mt-1 text-xs text-muted-foreground">{t("registrations.rescheduleHint")}</p></div><button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-muted" onClick={() => selectTab("documents")} aria-label={t("toast.close")}><X size={17} aria-hidden="true" /></button></div>
              {rescheduleAvailability.isError ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{(rescheduleAvailability.error as Error | undefined)?.message || t("registrations.rescheduleAvailabilityFailed")}</div> : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); submitReschedule(); }}>
                <div className="rounded-xl border border-border bg-background p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold text-foreground">{t("appointments.create.evaluatedAvailability")}</p><p className="text-[11px] text-muted-foreground">{t("registrations.rescheduleAvailabilitySameAsCreate")}</p></div>{rescheduleDate ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">{formatDateLy(rescheduleDate)}</span> : null}</div>
                  <AvailabilityPanel rows={rescheduleAvailability.rows.filter((row) => row.date !== appointment.appointmentDate && (row.status !== "blocked" || Boolean(inferSupportedOverrideType(row.reasonCodes))))} selectedDate={rescheduleDate} onSelectDate={(row) => { setRescheduleSelectedRow(row); setRescheduleDate(row.date); setRescheduleOverrideError(null); }} loading={rescheduleAvailability.isLoading} emptyMessage={t("registrations.rescheduleNoDates")} showFullDays={rescheduleShowFullDays} onToggleShowFullDays={() => setRescheduleShowFullDays((current) => !current)} showPolicyHiddenDays={rescheduleShowWeekendDays} onToggleShowPolicyHiddenDays={() => setRescheduleShowWeekendDays((current) => !current)} startDate={startDateFromOffset(rescheduleOffset)} onChangeStartDate={(nextDate) => { setRescheduleOffset(offsetFromStartDate(nextDate)); setRescheduleDate(""); setRescheduleSelectedRow(null); }} onPreviousPage={() => { setRescheduleOffset((current) => Math.max(0, current - RESCHEDULE_AVAILABILITY_WINDOW_DAYS)); setRescheduleDate(""); setRescheduleSelectedRow(null); }} onNextPage={() => { setRescheduleOffset((current) => current + RESCHEDULE_AVAILABILITY_WINDOW_DAYS); setRescheduleDate(""); setRescheduleSelectedRow(null); }} canGoPrevious={rescheduleOffset > 0} allowOverrideRequests />
                </div>
                {canUseNonStandardCapacityModes || canUseRescheduleSpecialQuota ? <SpecialQuotaSection capacityResolutionMode={rescheduleCapacityResolutionMode} onChangeCapacityResolutionMode={(mode) => { if (mode === "special_quota_extra" && !rescheduleSpecialQuotaAvailable) return; setRescheduleCapacityResolutionMode(mode); setRescheduleOverrideError(null); setRescheduleOverrideOpen(false); setPendingReschedulePayload(null); }} specialQuotaAvailable={rescheduleSpecialQuotaAvailable} showCapacityActions={canUseNonStandardCapacityModes || canUseRescheduleSpecialQuota} canUseSpecialQuota={canUseRescheduleSpecialQuota} canUseCategoryOverride={canUseNonStandardCapacityModes} canUseTotalCapacityOverride={isSuperAdmin} specialReasonCode={rescheduleSpecialReasonCode} onChangeSpecialReasonCode={setRescheduleSpecialReasonCode} specialReasonConfirmed={rescheduleSpecialReasonConfirmed} onChangeSpecialReasonConfirmed={setRescheduleSpecialReasonConfirmed} specialReasonNote={rescheduleSpecialReasonNote} onChangeSpecialReasonNote={setRescheduleSpecialReasonNote} options={specialReasonOptions} /> : null}
                <div><label htmlFor="appointment-manage-reschedule-reason" className="mb-1 block text-[10px] font-mono-data uppercase tracking-[0.08em] text-muted-foreground">{t("registrations.rescheduleReason")}</label><textarea id="appointment-manage-reschedule-reason" value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} rows={2} className="input-premium w-full resize-none" placeholder={t("registrations.rescheduleReasonPlaceholder")} /></div>
                {rescheduleSelectedRow?.requiresSupervisorOverride || rescheduleSelectedRow?.status === "restricted" || rescheduleSelectedRow?.status === "full" || rescheduleCapacityModeNeedsOverrideAuth ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("registrations.rescheduleSupervisorRequired")}</div> : null}
                <div className={`flex flex-wrap gap-2 ${isRtl ? "justify-start" : "justify-end"}`}>{user?.role === "receptionist" && rescheduleSelectedRow && inferSupportedOverrideType(rescheduleSelectedRow.reasonCodes) ? <Button type="button" size="sm" variant="secondary" disabled={!canSubmitReschedule || createRescheduleOverrideRequest.isPending} onClick={() => { const payload = buildReschedulePayload(); if (!payload) return; setPendingReschedulePayload(payload); setRescheduleRequestOverrideType(inferSupportedOverrideType(rescheduleSelectedRow.reasonCodes)); setRescheduleRequestError(null); setRescheduleRequestOpen(true); }}>{t("overrideRequests.requestApproval")}</Button> : null}<Button type="submit" size="sm" disabled={!canSubmitReschedule}>{rescheduleMutation.isPending ? t("appointments.v2.rescheduling") : t("registrations.reschedule")}</Button></div>
              </form>}
            </div> : <div className="rounded-2xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">{t("registrations.rescheduleNotAllowed")}</div>
          ) : null}

         {appointment && activeTab === "cancel" ? ["scheduled", "arrived", "waiting"].includes(appointment.status) ? <div className="rounded-2xl border border-border bg-muted/20 p-3"><div className="mb-2 text-xs text-muted-foreground">{t("registrations.cancelAppointment")}</div><div className={isRtl ? "flex justify-start" : "flex justify-end"}><Button size="sm" variant="ghost" style={{ color: "#ef4444" }} onClick={() => { if (window.confirm(t("common.confirmCancelAppointment"))) cancelMutation.mutate(appointment.id); }}>{t("registrations.cancelAppointment")}</Button></div></div> : <div className="rounded-2xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">{t("registrations.cancelNotAllowed")}</div> : null}
           </div>
         </div>
          {/*
        */}
        {isMobileViewport && appointment && activeTab === "documents" && !documentReviewExpanded && canAttachDocuments ? <div className="sticky bottom-0 z-30 grid shrink-0 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2 border-t border-border bg-background/95 p-2 backdrop-blur"><button type="button" className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 text-xs font-semibold text-accent-foreground" onClick={() => window.document.getElementById("request-documents-upload-file")?.click()}><Upload size={15} aria-hidden="true" />{t("documents.uploadRequest")}</button><button type="button" className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-semibold" onClick={() => setActionMenuOpen(true)}><MoreHorizontal size={15} aria-hidden="true" />{t("requestScans.actions.more")}</button></div> : null}
        {appointment && cancelConfirmOpen ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" role="presentation"><div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="appointment-cancel-title"><h2 id="appointment-cancel-title" className="text-base font-semibold text-red-700">{t("registrations.cancelAppointment")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("common.confirmCancelAppointment")}</p><div className="mt-5 flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCancelConfirmOpen(false)}>{t("common.cancel")}</Button><Button type="button" style={{ backgroundColor: "#dc2626", color: "white" }} disabled={cancelMutation.isPending} onClick={() => { setCancelConfirmOpen(false); cancelMutation.mutate(appointment.id); }}>{cancelMutation.isPending ? t("documents.uploading") : t("registrations.cancelAppointment")}</Button></div></div></div> : null}
      {appointment && voidDialogOpen ? <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4" role="presentation"><div className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="appointment-void-title"><h2 id="appointment-void-title" className="text-base font-semibold text-red-700">{t("appointmentEditor.void")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("appointmentEditor.voidConfirm")}</p><label htmlFor="appointment-void-reason" className="mt-4 block text-xs font-semibold">{t("appointmentEditor.voidReasonPrompt")}</label><textarea id="appointment-void-reason" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} rows={3} className="input-premium mt-1 w-full resize-none" required /><div className="mt-5 flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={() => { setVoidDialogOpen(false); setVoidReason(""); }}>{t("common.cancel")}</Button><Button type="button" variant="destructive" disabled={!voidReason.trim() || voidMutation.isPending} onClick={() => voidMutation.mutate()}>{voidMutation.isPending ? t("appointmentEditor.voiding") : t("appointmentEditor.void")}</Button></div></div></div> : null}
      </DialogContent>
    </Dialog>

      <Dialog open={statusDialogOpen && Boolean(appointment)} onClose={() => { setStatusDialogOpen(false); setStatusDialogError(null); }}>
        <DialogContent maxWidth="min(94vw, 460px)" role="dialog" aria-labelledby="appointment-status-dialog-title" aria-describedby="appointment-status-dialog-description" className="!p-5">
          <DialogHeader closeLabel={t("toast.close")}>
            <DialogTitle id="appointment-status-dialog-title">{chooseLocalized(language, "تغيير حالة الموعد", "Change appointment status")}</DialogTitle>
            <DialogDescription id="appointment-status-dialog-description">{chooseLocalized(language, "حدّث الحالة مع الحفاظ على صفحة الموعد مفتوحة.", "Update the status while keeping the appointment workspace open.")}</DialogDescription>
          </DialogHeader>
          {appointment ? <div className="space-y-4"><div className="rounded-lg border border-border bg-muted/20 p-3 text-sm"><span className="text-muted-foreground">{chooseLocalized(language, "الحالة الحالية", "Current status")}: </span><Badge variant="neutral" size="sm">{statusLabel(language, appointment.status)}</Badge></div><div><label htmlFor="appointment-status-select" className="mb-1 block text-xs font-semibold">{chooseLocalized(language, "الحالة الجديدة", "New status")}</label><select id="appointment-status-select" value={manualStatus} onChange={(event) => { setManualStatus(event.target.value as (typeof MANUAL_STATUS_OPTIONS)[number]); setStatusDialogError(null); }} className="input-premium w-full" aria-describedby={statusReasonRequired ? "appointment-status-reason-help" : undefined}>{MANUAL_STATUS_OPTIONS.map((status) => <option key={status} value={status} disabled={status === appointment.status}>{statusLabel(language, status)}</option>)}</select></div>{statusReasonRequired ? <div><label htmlFor="appointment-status-reason" className="mb-1 block text-xs font-semibold">{chooseLocalized(language, "السبب", "Reason")}</label><textarea id="appointment-status-reason" value={manualStatusReason} onChange={(event) => { setManualStatusReason(event.target.value); setStatusDialogError(null); }} rows={3} className="input-premium w-full resize-none" placeholder={chooseLocalized(language, "اكتب سبب تغيير الحالة", "Enter a reason for this status change")} required /><p id="appointment-status-reason-help" className="mt-1 text-xs text-muted-foreground">{chooseLocalized(language, "هذا التغيير يتطلب سبباً.", "A reason is required for this change.")}</p></div> : null}{statusDialogError ? <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">{statusDialogError}</p> : null}</div> : null}
          <DialogFooter className="mt-5"><Button type="button" variant="secondary" onClick={() => { setStatusDialogOpen(false); setStatusDialogError(null); }}>{t("common.cancel")}</Button><Button type="button" disabled={!appointment || statusMutation.isPending || manualStatus === appointment.status || (statusReasonRequired && !manualStatusReason.trim())} onClick={() => { if (!appointment) return; statusMutation.mutate({ appointmentId: appointment.id, status: manualStatus, reason: manualStatusReason.trim() || null }); }}>{statusMutation.isPending ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />{chooseLocalized(language, "جار الحفظ", "Saving")}</span> : chooseLocalized(language, "حفظ الحالة", "Save status")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedPatientId ? <PatientDrawer patientId={selectedPatientId} onClose={() => setSelectedPatientId(null)} /> : null}

      <SupervisorOverrideModal open={rescheduleOverrideOpen} onClose={() => { setRescheduleOverrideOpen(false); setRescheduleOverrideError(null); setPendingReschedulePayload(null); }} onConfirm={handleRescheduleOverrideConfirm} loading={rescheduleOverrideLoading || rescheduleMutation.isPending} authError={rescheduleOverrideError} />
      <SchedulingOverrideRequestModal open={rescheduleRequestOpen} requestType="reschedule_booking" overrideType={rescheduleRequestOverrideType} patientLabel={appointment?.englishFullName || appointment?.arabicFullName || `Patient #${appointment?.patientId ?? ""}`} modalityLabel={appointment?.modalityNameEn || appointment?.modalityNameAr || `Modality #${appointment?.modalityId ?? ""}`} examTypeLabel={appointment?.examNameEn || appointment?.examNameAr || `Exam #${appointment?.examTypeId ?? ""}`} requestedDate={rescheduleDate} requestedTime={null} decision={selectedRescheduleAvailabilityItem?.decision ?? null} loading={createRescheduleOverrideRequest.isPending} error={rescheduleRequestError} onClose={() => { setRescheduleRequestOpen(false); setRescheduleRequestError(null); }} onSubmit={submitRescheduleOverrideRequest} />
    </>
  );
}
