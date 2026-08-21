import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { pushToast } from "@/lib/toast";
import { fetchAppointments, fetchPatientNoShowHistory, fetchPatientQrSettings, fetchPublicSchedulingCapacitySettings, fetchSettings, getAppointmentById } from "@/lib/api-hooks";
import { chooseLocalized, t } from "@/lib/i18n";
import { getPatientRequirementStaffMessage } from "@/lib/patient-requirement-messages";
import { useLanguage } from "@/providers/language-provider";
import { buildAppointmentPrintUrl } from "@/lib/print-routing";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { buildAppointmentWhatsappText, normalizeWhatsappPhone } from "@/lib/whatsapp";
import type {
  BookingResponse,
  CapacityResolutionMode,
  CreateBookingRequest,
  ExamTypeDto,
  ModalityDto,
  SchedulingDecisionDto,
  SchedulingOverrideType,
  SpecialReasonCodeDto,
} from "../types";
import { fetchIntendedReportingDoctors, useCreateSchedulingOverrideRequest, useV2ExamTypes } from "../api";
import { useCreateAppointmentForm, type SelectedPatient } from "../hooks/useCreateAppointmentForm";
import { isAvailabilityRowVisible } from "../hooks/availability-row-mapper";
import { useAppointmentAvailability, type AvailabilityRowViewModel } from "../hooks/useAppointmentAvailability";
import { PatientSearchSection } from "./PatientSearchSection";
import { ModalitySelect } from "./ModalitySelect";
import { ExamTypeSelect } from "./ExamTypeSelect";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { SpecialQuotaSection } from "./SpecialQuotaSection";
import { SupervisorOverrideModal } from "./SupervisorOverrideModal";
import { SchedulingOverrideRequestModal } from "./SchedulingOverrideRequestModal";
import { AppointmentSuccessState } from "./AppointmentSuccessState";
import { Alert, AlertDescription, Badge, Button, Card, Input } from "@/components/shared";
import { MriPrimaryScreeningBadges } from "@/components/appointments/mri-primary-screening-badges";
import { Lock, RefreshCw, TriangleAlert } from "lucide-react";
import { formatAppointmentPatientName } from "../utils/patient-display-name";
import { formatEntityLabel, type EntityDisplayMode } from "../utils/entity-display";
import { formatOverrideType, hasMultipleSupportedOverrideTypesFromDecision, inferSupportedOverrideTypeFromDecision, inferSupportedOverrideTypeFromExamRuleMetadata, shouldUseDeferredOverrideRequest } from "../utils/scheduling-override-requests";
import type { DoctorModuleCapability, Role } from "@/types/api";

interface CreateAppointmentTabProps {
  patientLookups: unknown;
  modalityOptions: ModalityDto[];
  examTypeOptions: ExamTypeDto[];
  specialReasonOptions: SpecialReasonCodeDto[];
  priorityOptions: Array<{ id: number; nameEn: string; nameAr: string }>;
  schedulingEngineEnabled: boolean;
  canUseNonStandardCapacityModes?: boolean;
  currentUserRole?: Role;
  doctorModuleCapabilities?: DoctorModuleCapability[];
  initialSelectedPatient?: SelectedPatient | null;
  onCreateAppointment: (input: CreateBookingRequest) => Promise<BookingResponse>;
  onEvaluateAvailability: (input: {
    patientId: number;
    modalityId: number;
    examTypeId: number | null;
    scheduledDate: string;
    caseCategory: "oncology" | "non_oncology";
    capacityResolutionMode: CapacityResolutionMode;
    useSpecialQuota: boolean;
    specialReasonCode: string | null;
    includeOverrideEvaluation: boolean;
  }) => Promise<SchedulingDecisionDto>;
}

interface SuccessSummary {
  bookingId: number;
  patientId: number | null;
  patientPhone1: string | null;
  patientName: string;
  bookingDate: string;
  modalityName: string;
  examTypeName?: string | null;
  wasOverride: boolean;
  publicAppointmentUrl?: string | null;
  mriPrimaryScreeningResult?: "no_known_implant_reported" | "implant_reported_review_required" | null;
}

const AVAILABILITY_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const ENTITY_DISPLAY_MODE_STORAGE_KEY = "rispro:create-appointment:entity-display-mode";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function clampAvailabilityOffset(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
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

function isRoutinePriority(priority: { nameEn?: string | null; nameAr?: string | null }): boolean {
  const nameEn = String(priority.nameEn ?? "").trim().toLowerCase();
  const nameAr = String(priority.nameAr ?? "").trim();
  return (
    nameEn === "routine" ||
    nameEn === "normal" ||
    nameEn.includes("routine") ||
    nameEn.includes("normal") ||
    nameAr.includes("روت") ||
    nameAr.includes("عادي")
  );
}

function localizeCreateAppointmentError(error: unknown, language: "ar" | "en"): string {
  const requirementMessage = getPatientRequirementStaffMessage(error, (key) => t(language, key));
  if (requirementMessage) return requirementMessage;

  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("This patient cannot be booked or entered into the queue because they do not have a primary identifier.")) {
    return t(language, "appointments.booking.patientIdentifierRequired");
  }
  return message || t(language, "appointments.create.failedCreate");
}

function buildNoShowRestrictionDecision(): SchedulingDecisionDto {
  return {
    isAllowed: false,
    requiresSupervisorOverride: true,
    displayStatus: "restricted",
    suggestedBookingMode: "override",
    consumedCapacityMode: null,
    remainingStandardCapacity: null,
    remainingSpecialQuota: null,
    matchedRuleIds: [],
    reasons: [
      {
        code: "patient_no_show_booking_blocked",
        severity: "warning",
        message: "Patient has an active no-show booking restriction.",
      },
    ],
    policy: { policySetKey: "default", versionId: 0, versionNo: 0, configHash: "" },
    decisionTrace: { evaluatedAt: new Date().toISOString(), input: null },
  };
}

export function CreateAppointmentTab({
  modalityOptions,
  examTypeOptions,
  specialReasonOptions,
  priorityOptions,
  schedulingEngineEnabled,
  canUseNonStandardCapacityModes = false,
  currentUserRole,
  doctorModuleCapabilities = [],
  initialSelectedPatient = null,
  onCreateAppointment,
  onEvaluateAvailability,
}: CreateAppointmentTabProps) {
  const { data: patientQrSettings } = useQuery({
    queryKey: ["patient-qr-settings", "appointment-defaults"],
    queryFn: fetchPatientQrSettings,
    staleTime: 60_000,
  });
  const { data: queueArrivalSettings } = useQuery({
    queryKey: ["settings", "queue_and_arrival"],
    queryFn: () => fetchSettings("queue_and_arrival"),
    staleTime: 60_000,
  });
  const { data: schedulingCapacitySettings } = useQuery({
    queryKey: ["settings", "scheduling_and_capacity", "public"],
    queryFn: fetchPublicSchedulingCapacitySettings,
    staleTime: 60_000,
  });
  const allowReceptionOverrideRequestsFromAvailability =
    String(schedulingCapacitySettings?.allow_reception_override_requests_from_availability ?? "enabled") !== "disabled" &&
    String(schedulingCapacitySettings?.can_request_scheduling_override ?? "disabled") === "enabled";
  const { form, actions } = useCreateAppointmentForm({
    oncology: patientQrSettings?.defaultReportRequiredForOncology ?? true,
    nonOncology: patientQrSettings?.defaultReportRequiredForNonOncology ?? false,
  });
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [availabilitySelectedRow, setAvailabilitySelectedRow] = useState<AvailabilityRowViewModel | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<SchedulingDecisionDto | null>(null);
  const [pendingRequestDecision, setPendingRequestDecision] = useState<SchedulingDecisionDto | null>(null);
  const [requestOverrideOpen, setRequestOverrideOpen] = useState(false);
  const [requestOverrideError, setRequestOverrideError] = useState<string | null>(null);
  const [requestOverrideType, setRequestOverrideType] = useState<SchedulingOverrideType | null>(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [success, setSuccess] = useState<SuccessSummary | null>(null);
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);
  const [screeningResult, setScreeningResult] = useState<"no_known_implant_reported" | "implant_reported_review_required" | null>(null);
  const [implantSite, setImplantSite] = useState("");
  const [implantDescription, setImplantDescription] = useState("");
  const [previousReviewerNameReported, setPreviousReviewerNameReported] = useState("");
  const [printNowLoading, setPrintNowLoading] = useState(false);
  const [patientNoShows, setPatientNoShows] = useState<Array<{ id: number; appointmentDate: string; examTypeName: string; status: string }>>([]);
  const [patientNoShowSummary, setPatientNoShowSummary] = useState<Awaited<ReturnType<typeof fetchPatientNoShowHistory>> | null>(null);
  const [noShowAuthorizationReason, setNoShowAuthorizationReason] = useState("");
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [availabilityOffset, setAvailabilityOffset] = useState(0);
  const [showFullDays, setShowFullDays] = useState(false);
  const [showPolicyHiddenDays, setShowPolicyHiddenDays] = useState(false);
  const [entityDisplayMode, setEntityDisplayMode] = useState<EntityDisplayMode>(() => {
    if (typeof window === "undefined") return "both";
    const stored = window.localStorage.getItem(ENTITY_DISPLAY_MODE_STORAGE_KEY);
    if (stored === "ar" || stored === "en" || stored === "both") return stored;
    return "both";
  });
  const initialPatientAppliedRef = useRef(false);
  const isReceptionist = currentUserRole === "receptionist";
  const isSupervisor = currentUserRole === "supervisor";
  const isSuperAdmin = currentUserRole === "super_admin";
  const canEnableNonOncologyReport = isSuperAdmin || isSupervisor;
  const canSelectIntendedReportingDoctor =
    isSuperAdmin ||
    isSupervisor ||
    doctorModuleCapabilities.includes("doctor_admin") ||
    doctorModuleCapabilities.includes("doctor_supervisor");
  const showIntendedReportingDoctor =
    form.requiresReport === true &&
    form.modalityId != null &&
    canSelectIntendedReportingDoctor;
  const intendedReportingDoctorsQuery = useQuery({
    queryKey: ["intended-reporting-doctors", form.modalityId],
    queryFn: () => fetchIntendedReportingDoctors(form.modalityId as number),
    enabled: showIntendedReportingDoctor,
    staleTime: 60_000,
  });
  const isSelectedPatientNonOncology = form.patient?.category === "non_oncology";
  const canDirectlyAuthorizeNoShowRestriction = isSuperAdmin || (isSupervisor && !isSelectedPatientNonOncology);
  const createOverrideRequestMutation = useCreateSchedulingOverrideRequest();
  const walkInSettingRaw = String(queueArrivalSettings?.walk_in_queue ?? "disabled").trim().toLowerCase();
  const isWalkInEnabled = queueArrivalSettings != null && ["enabled", "on", "true", "yes", "1"].includes(walkInSettingRaw);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENTITY_DISPLAY_MODE_STORAGE_KEY, entityDisplayMode);
  }, [entityDisplayMode]);

  useEffect(() => {
    if (initialPatientAppliedRef.current) return;
    if (!initialSelectedPatient) return;
    if (form.patientId != null) return;
    actions.setPatient(initialSelectedPatient);
    initialPatientAppliedRef.current = true;
  }, [actions, form.patientId, initialSelectedPatient]);

  const selectedModality = modalityOptions.find((m) => m.id === form.modalityId);
  const safetyWarningEnabled = selectedModality?.safetyWarningEnabled === true;
  const hasSafetyWarning = safetyWarningEnabled && Boolean(
    String(selectedModality?.safetyWarningEn ?? "").trim() || String(selectedModality?.safetyWarningAr ?? "").trim()
  );
  const safetyMessage = chooseLocalized(language, selectedModality?.safetyWarningAr, selectedModality?.safetyWarningEn) || "";
  const isMriSafetyWorkflow = safetyWarningEnabled && selectedModality?.safetyWorkflowType === "mri_primary_implant_screening";
  const safetyConfigurationError = safetyWarningEnabled && !hasSafetyWarning;
  const safetyComplete = !safetyWarningEnabled || (safetyAcknowledged && (!isMriSafetyWorkflow || screeningResult !== null));

  useEffect(() => { setSafetyAcknowledged(false); setScreeningResult(null); setImplantSite(""); setImplantDescription(""); setPreviousReviewerNameReported(""); }, [form.patientId, form.modalityId]);

  const filteredExamTypes = useMemo(
    () => examTypeOptions.filter((et) => form.modalityId != null && et.modalityId === form.modalityId),
    [examTypeOptions, form.modalityId]
  );
  const modalityExamTypes = useV2ExamTypes(form.modalityId);
  const effectiveExamTypes = modalityExamTypes.data ?? filteredExamTypes;
  const selectedExamType = effectiveExamTypes.find((et) => et.id === form.examTypeId);
  const selectedPatientLabel = formatAppointmentPatientName(
    language,
    form.patient,
    chooseLocalized(language, `المريض #${form.patientId ?? ""}`, `Patient #${form.patientId ?? ""}`)
  );
  const selectedModalityLabel = formatEntityLabel({
    mode: entityDisplayMode,
    nameAr: selectedModality?.nameAr,
    nameEn: selectedModality?.nameEn,
    fallback: selectedModality?.name || "—",
  });
  const selectedExamTypeLabel =
    formatEntityLabel({
      mode: entityDisplayMode,
      nameAr: selectedExamType?.nameAr,
      nameEn: selectedExamType?.nameEn,
      fallback: selectedExamType?.name || null,
    }) || "—";

  const availability = useAppointmentAvailability({
    patientId: form.patientId,
    modalityId: form.modalityId,
    examTypeId: form.examTypeId,
    caseCategory: form.caseCategory,
    capacityResolutionMode: "standard",
    specialReasonCode: null,
    days: AVAILABILITY_WINDOW_DAYS,
    offset: availabilityOffset,
  });
  const availabilityStatusLabel =
    !form.patientId
      ? t(language, "appointments.create.availabilityNeedsPatient")
      : !form.modalityId
        ? t(language, "appointments.create.availabilityNeedsModality")
        : !form.examTypeId
          ? t(language, "appointments.create.availabilityNeedsExamType")
          : t(language, "appointments.create.availabilityReady");
  const hasSpecialQuotaAvailable = (availability.rawItems ?? []).some(
    (item) =>
      item.date === form.appointmentDate &&
      (item.specialQuotaSummary?.remaining ?? 0) > 0
  );
  const selectedSpecialQuotaSummary = (availability.rawItems ?? []).find(
    (item) => item.date === form.appointmentDate
  )?.specialQuotaSummary ?? null;
  const hasAnySpecialQuotaAvailable = (availability.rawItems ?? []).some(
    (item) => (item.specialQuotaSummary?.remaining ?? 0) > 0
  );
  const selectedDateNeedsCategoryOverride = Boolean(availabilitySelectedRow?.reasonCodes.includes("category_capacity_exhausted"));
  const selectedDateNeedsTotalCapacityOverride = Boolean(availabilitySelectedRow?.reasonCodes.includes("modality_daily_capacity_exhausted"));
  const effectiveCapacityResolutionMode =
    form.capacityResolutionMode === "category_override" && canUseNonStandardCapacityModes && selectedDateNeedsCategoryOverride
      ? "category_override"
      : form.capacityResolutionMode === "total_capacity_override" && isSuperAdmin && selectedDateNeedsTotalCapacityOverride
        ? "total_capacity_override"
        : form.capacityResolutionMode;
  const canUseSpecialQuotaMode =
    isSuperAdmin ||
    hasSpecialQuotaAvailable ||
    hasAnySpecialQuotaAvailable ||
    (form.capacityResolutionMode === "special_quota_extra" && availability.isLoading);
  const canUseSelectedCapacityMode =
    form.capacityResolutionMode === "special_quota_extra"
      ? hasSpecialQuotaAvailable
      : effectiveCapacityResolutionMode !== "standard";
  const showCapacityResolutionActions =
    (canUseNonStandardCapacityModes && selectedDateNeedsCategoryOverride) ||
    (isSuperAdmin && selectedDateNeedsTotalCapacityOverride) ||
    hasSpecialQuotaAvailable;
  const filteredPriorityOptions = useMemo(
    () => priorityOptions.filter((p) => !isRoutinePriority(p)),
    [priorityOptions]
  );

  useEffect(() => {
    const specialQuotaIsDefinitivelyUnavailable =
      form.capacityResolutionMode === "special_quota_extra" &&
      availability.enabled &&
      !availability.isLoading &&
      (form.appointmentDate ? !hasSpecialQuotaAvailable : !hasAnySpecialQuotaAvailable);
    if (
      (form.capacityResolutionMode !== "standard" &&
        form.capacityResolutionMode !== "special_quota_extra" &&
        !canUseSelectedCapacityMode ||
        (form.capacityResolutionMode === "category_override" && !selectedDateNeedsCategoryOverride) ||
        (form.capacityResolutionMode === "total_capacity_override" && !selectedDateNeedsTotalCapacityOverride)) ||
      specialQuotaIsDefinitivelyUnavailable
    ) {
      actions.setCapacityResolutionMode("standard");
    }
  }, [actions, availability.enabled, availability.isLoading, form.appointmentDate, form.capacityResolutionMode, hasAnySpecialQuotaAvailable, hasSpecialQuotaAvailable, canUseSelectedCapacityMode, selectedDateNeedsCategoryOverride, selectedDateNeedsTotalCapacityOverride]);

  useEffect(() => {
    if (!form.patientId) {
      setPatientNoShows([]);
      setPatientNoShowSummary(null);
      setNoShowAuthorizationReason("");
      setNoShowLoading(false);
      return;
    }

    let cancelled = false;
    setNoShowLoading(true);

    Promise.all([
      fetchAppointments({
        status: ["no-show", "cancelled"],
        patientId: String(form.patientId),
        dateTo: new Date().toISOString().slice(0, 10),
      }),
      fetchPatientNoShowHistory(form.patientId),
    ])
      .then(([appointments, summary]) => {
        if (cancelled) return;
        const history = appointments
          .slice(0, 5)
          .map((appointment) => ({
            id: appointment.id,
            appointmentDate: appointment.appointmentDate,
            examTypeName:
              formatEntityLabel({
                mode: entityDisplayMode,
                nameAr: appointment.examNameAr,
                nameEn: appointment.examNameEn,
                fallback: "—",
              }) || "—",
            status: String(appointment.status || ""),
          }));
        setPatientNoShows(history);
        setPatientNoShowSummary(summary);
      })
      .catch(() => {
        if (!cancelled) {
          setPatientNoShows([]);
          setPatientNoShowSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setNoShowLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entityDisplayMode, form.patientId]);

  const canRequestDeferredOverride = useCallback((
    overrideType: SchedulingOverrideType | null,
    row: AvailabilityRowViewModel | null = availabilitySelectedRow
  ): boolean => {
    if (!overrideType || !row || row.status === "available") return false;
    if (isReceptionist) return allowReceptionOverrideRequestsFromAvailability;
    return shouldUseDeferredOverrideRequest(currentUserRole, overrideType, allowReceptionOverrideRequestsFromAvailability);
  }, [allowReceptionOverrideRequestsFromAvailability, availabilitySelectedRow, currentUserRole]);

  const inferRowOverrideType = useCallback((row: AvailabilityRowViewModel | null | undefined): SchedulingOverrideType | null => {
    return inferSupportedOverrideTypeFromExamRuleMetadata({
      reasonCodes: row?.reasonCodes,
      requiresSupervisorOverride: Boolean(row?.requiresSupervisorOverride),
      effectModes: row?.matchedExamRuleSummary ? [row.matchedExamRuleSummary.effectMode] : [],
      capacityResolutionMode: "standard",
    });
  }, [form.capacityResolutionMode]);

  const visibleInAvailabilityPanel = useCallback((row: AvailabilityRowViewModel, selected = false): boolean => {
    return isAvailabilityRowVisible(row, {
      showFullDays,
      showPolicyHiddenDays,
      selected,
      requestableOverride: canRequestDeferredOverride(inferRowOverrideType(row), row),
    });
  }, [canRequestDeferredOverride, inferRowOverrideType, showFullDays, showPolicyHiddenDays]);

  const canSelectAvailabilityRow = useCallback((row: AvailabilityRowViewModel): boolean => {
    const supportedOverrideType = inferRowOverrideType(row);
    if (isReceptionist && row.status !== "available" && !row.hasSpecialQuotaPath && !canRequestDeferredOverride(supportedOverrideType, row)) {
      return false;
    }
    if (row.status === "blocked" && !supportedOverrideType) return false;
    if (row.status === "full" && !row.requiresSupervisorOverride && !supportedOverrideType) return false;
    return true;
  }, [canRequestDeferredOverride, inferRowOverrideType, isReceptionist]);

  function handleSelectAvailabilityRow(row: AvailabilityRowViewModel) {
    if (!canSelectAvailabilityRow(row)) return;
    const supportedOverrideType = inferRowOverrideType(row);
    const quotaOnlyPath = row.hasSpecialQuotaPath;
    const requiresOverride = !quotaOnlyPath && (row.status === "restricted" || (row.status !== "available" && Boolean(supportedOverrideType)) || (row.status === "full" && row.requiresSupervisorOverride));
    if (quotaOnlyPath) actions.setCapacityResolutionMode("special_quota_extra");
    actions.setAppointmentDate(row.date, requiresOverride);
    setAvailabilitySelectedRow(row);
    setPageError(null);
  }

  const selectedRowSupportedOverrideType = inferRowOverrideType(availabilitySelectedRow);
  const selectedRowCanUseImmediateOverride =
    availabilitySelectedRow != null &&
    availabilitySelectedRow.status !== "available" &&
    !isReceptionist &&
    !canRequestDeferredOverride(selectedRowSupportedOverrideType) &&
    Boolean(selectedRowSupportedOverrideType);
  const selectedRowCanBookNormally =
    availabilitySelectedRow == null
      ? !isReceptionist
      : availabilitySelectedRow.status === "available" ||
        (availabilitySelectedRow.hasSpecialQuotaPath && form.capacityResolutionMode === "special_quota_extra") ||
        selectedRowCanUseImmediateOverride;
  const canSubmitCreate = Boolean(
    schedulingEngineEnabled &&
    safetyComplete &&
    !submitLoading &&
    selectedRowCanBookNormally &&
    !(form.capacityResolutionMode === "special_quota_extra" && availability.isLoading)
  );
  const canRequestOverrideApproval = canRequestDeferredOverride(selectedRowSupportedOverrideType);

  useEffect(() => {
    if (!availability.enabled || availability.isLoading || availability.rows.length === 0) return;

    const selectedRow = availability.rows.find((row) => row.date === form.appointmentDate) ?? null;
    if (selectedRow && canSelectAvailabilityRow(selectedRow)) {
      if (availabilitySelectedRow?.date !== selectedRow.date) setAvailabilitySelectedRow(selectedRow);
      return;
    }

    const firstBookableVisibleRow = availability.rows.find(
      (row) => row.status === "available" && visibleInAvailabilityPanel(row)
    );
    if (firstBookableVisibleRow) {
      if (form.appointmentDate !== firstBookableVisibleRow.date) {
        actions.setAppointmentDate(firstBookableVisibleRow.date, false);
      }
      if (availabilitySelectedRow?.date !== firstBookableVisibleRow.date) {
        setAvailabilitySelectedRow(firstBookableVisibleRow);
      }
      return;
    }

    if (form.appointmentDate || availabilitySelectedRow) {
      actions.setAppointmentDate("", false);
      setAvailabilitySelectedRow(null);
    }
  }, [
    actions,
    availability.enabled,
    availability.isLoading,
    availability.rows,
    availabilitySelectedRow,
    canSelectAvailabilityRow,
    form.appointmentDate,
    showFullDays,
    showPolicyHiddenDays,
    visibleInAvailabilityPanel,
  ]);

  function validateBaseFields(): string | null {
    if (!form.patientId) return t(language, "appointments.create.missingPatient");
    if (form.patient?.identityRisk === "ambiguous" && !form.patient.patientIdentityVerificationProof) {
      return t(language, "appointments.identity.verificationRequiredBeforeBooking");
    }
    if (!form.modalityId) return t(language, "appointments.create.missingModality");
    if (!form.examTypeId) return t(language, "appointments.create.missingExamType");
    if (!form.appointmentDate) return t(language, "appointments.create.selectedDateUnavailable");
    if (isReceptionist && !availabilitySelectedRow) {
      return t(language, "appointments.create.selectedDateUnavailable");
    }
    if (form.capacityResolutionMode === "special_quota_extra" && !form.specialReasonCode) {
      return t(language, "appointments.create.specialReasonRequired");
    }
    if (form.capacityResolutionMode === "special_quota_extra" && !form.specialReasonConfirmed) {
      return t(language, "appointments.create.confirmSpecialReason");
    }
    return null;
  }

  async function createWithDecision(decision: SchedulingDecisionDto, override?: CreateBookingRequest["override"]) {
    const request: CreateBookingRequest = {
      patientId: form.patientId as number,
      modalityId: form.modalityId as number,
      examTypeId: form.examTypeId,
      reportingPriorityId: form.reportingPriorityId,
      bookingDate: form.appointmentDate,
      bookingTime: null,
      caseCategory: form.caseCategory,
      capacityResolutionMode: effectiveCapacityResolutionMode,
      useSpecialQuota: canUseSpecialQuotaMode && effectiveCapacityResolutionMode === "special_quota_extra",
      specialReasonCode:
        canUseSpecialQuotaMode && effectiveCapacityResolutionMode === "special_quota_extra"
          ? form.specialReasonCode || null
          : null,
      specialReasonNote:
        canUseSpecialQuotaMode && effectiveCapacityResolutionMode === "special_quota_extra"
          ? form.specialReasonNote.trim() || null
          : null,
      notes: form.notes.trim() || null,
      isWalkIn: form.isWalkIn,
      requiresReport: form.requiresReport,
      override,
      noShowAuthorizationReason:
        patientNoShowSummary?.bookingRestricted && !override && canDirectlyAuthorizeNoShowRestriction
          ? noShowAuthorizationReason.trim()
          : null,
      patientIdentityVerificationProof: form.patient?.patientIdentityVerificationProof ?? null,
      patientIdentitySelectionSource: form.patient?.patientIdentitySelectionSource ?? "search",
      modalitySafetyAcknowledged: safetyAcknowledged,
      mriPrimaryScreening: isMriSafetyWorkflow && screeningResult ? { result: screeningResult, implantSite: screeningResult === "implant_reported_review_required" ? implantSite.trim() || null : null, implantDescription: screeningResult === "implant_reported_review_required" ? implantDescription.trim() || null : null, previousReviewerNameReported: screeningResult === "implant_reported_review_required" ? previousReviewerNameReported.trim() || null : null } : null,
    };
    if (showIntendedReportingDoctor && form.intendedReportingDoctorId) {
      request.intendedReportingDoctorId = form.intendedReportingDoctorId;
      request.intendedReportingDoctorReason = form.intendedReportingDoctorReason.trim() || null;
    }

    const response = await onCreateAppointment(request);
    const modalityRecord = modalityOptions.find((m) => m.id === form.modalityId);
    const modalityName = formatEntityLabel({
      mode: entityDisplayMode,
      nameAr: modalityRecord?.nameAr,
      nameEn: modalityRecord?.nameEn,
      fallback: modalityRecord?.name || "—",
    });
    const examTypeRecord = effectiveExamTypes.find((et) => et.id === form.examTypeId);
    const examTypeName =
      formatEntityLabel({
        mode: entityDisplayMode,
        nameAr: examTypeRecord?.nameAr,
        nameEn: examTypeRecord?.nameEn,
        fallback: examTypeRecord?.name || null,
      }) || null;
    let publicAppointmentUrl: string | null = null;
    let patientPhone1: string | null = null;
    let persistedMriPrimaryScreeningResult = isMriSafetyWorkflow ? screeningResult : null;
    try {
      const appointmentDetails = await getAppointmentById(response.booking.id);
      publicAppointmentUrl = String(appointmentDetails.publicAppointmentUrl || "").trim() || null;
      patientPhone1 = String(appointmentDetails.phone1 || form.patient?.phone1 || "").trim() || null;
      persistedMriPrimaryScreeningResult = appointmentDetails.mriPrimaryScreening?.result ?? persistedMriPrimaryScreeningResult;
    } catch {
      publicAppointmentUrl = null;
      patientPhone1 = String(form.patient?.phone1 || "").trim() || null;
    }
    setSuccess({
      bookingId: response.booking.id,
      patientId: form.patientId,
      patientPhone1,
      patientName: formatAppointmentPatientName(
        language,
        form.patient,
        chooseLocalized(language, `المريض #${form.patientId}`, `Patient #${form.patientId}`)
      ),
      bookingDate: response.booking.bookingDate,
      modalityName,
      examTypeName,
      wasOverride: response.wasOverride,
      publicAppointmentUrl,
      mriPrimaryScreeningResult: persistedMriPrimaryScreeningResult,
    });

    if (decision.consumedCapacityMode === "special") {
      pushToast({
        type: "success",
        title: t(language, "appointments.create.specialQuotaConsumed"),
        message: t(language, "appointments.create.specialQuotaSaved"),
      });
    }
  }

  async function runSubmitFlow() {
    setSubmitLoading(true);
    setPageError(null);

    const validationError = validateBaseFields();
    if (validationError) {
      setSubmitLoading(false);
      setPageError(validationError);
      return;
    }

    if (patientNoShowSummary?.bookingRestricted) {
      if (canDirectlyAuthorizeNoShowRestriction) {
        if (!noShowAuthorizationReason.trim()) {
          setSubmitLoading(false);
          setPageError(t(language, "appointments.create.noShowAuthorizationReasonRequired"));
          return;
        }
      } else if (isSupervisor && isSelectedPatientNonOncology) {
        setSubmitLoading(false);
        setPageError(t(language, "appointments.create.noShowRestrictionBlockedNonOncology"));
        return;
      } else {
        setPendingDecision(buildNoShowRestrictionDecision());
        setShowOverrideModal(true);
        setSubmitLoading(false);
        return;
      }
    }

    try {
      const decision = await onEvaluateAvailability({
        patientId: form.patientId as number,
        modalityId: form.modalityId as number,
        examTypeId: form.examTypeId,
        scheduledDate: form.appointmentDate,
        caseCategory: form.caseCategory,
        capacityResolutionMode: effectiveCapacityResolutionMode,
        useSpecialQuota:
        canUseSpecialQuotaMode && effectiveCapacityResolutionMode === "special_quota_extra",
        specialReasonCode:
        canUseSpecialQuotaMode && effectiveCapacityResolutionMode === "special_quota_extra"
            ? form.specialReasonCode || null
            : null,
        includeOverrideEvaluation: true,
      });

      if (hasMultipleSupportedOverrideTypesFromDecision(decision, effectiveCapacityResolutionMode)) {
        setPageError(t(language, "appointments.create.multipleRestrictions"));
        return;
      }

      const supportedOverrideType = inferSupportedOverrideTypeFromDecision(decision, effectiveCapacityResolutionMode);

      if (availabilitySelectedRow && (decision.displayStatus === "blocked") && !supportedOverrideType) {
        setPageError(t(language, "appointments.create.availabilityChanged"));
        return;
      }

      if (decision.displayStatus === "blocked" && !decision.requiresSupervisorOverride && !supportedOverrideType) {
        setPageError(t(language, "appointments.create.selectedDateNotAllowed"));
        return;
      }

      const selectedCapacityModeNeedsOverrideAuth =
        effectiveCapacityResolutionMode === "category_override" ||
        effectiveCapacityResolutionMode === "total_capacity_override";
      if (decision.requiresSupervisorOverride || decision.displayStatus === "restricted" || (decision.displayStatus === "blocked" && supportedOverrideType) || selectedCapacityModeNeedsOverrideAuth) {
        if (canRequestDeferredOverride(supportedOverrideType)) {
          setPendingRequestDecision(decision);
          setRequestOverrideType(supportedOverrideType);
          setRequestOverrideError(null);
          setRequestOverrideOpen(true);
          return;
        }
        setPendingDecision(decision);
        setShowOverrideModal(true);
        return;
      }

      await createWithDecision(decision);
    } catch (error) {
      setPageError(localizeCreateAppointmentError(error, language));
    } finally {
      setSubmitLoading(false);
    }
  }

  async function handleOverrideConfirm(payload: { supervisorUsername: string; supervisorPassword: string; overrideReason: string }) {
    setOverrideLoading(true);
    setOverrideError(null);

    try {
      if (!pendingDecision) {
        setOverrideError(t(language, "appointments.create.overrideBeforeEvaluation"));
        return;
      }

      if (!payload.overrideReason.trim()) {
        setOverrideError(t(language, "appointments.create.overrideReasonRequired"));
        return;
      }

      await createWithDecision(pendingDecision, {
        supervisorUsername: payload.supervisorUsername,
        supervisorPassword: payload.supervisorPassword,
        reason: payload.overrideReason,
        overrideType: inferSupportedOverrideTypeFromDecision(pendingDecision, form.capacityResolutionMode) ?? undefined,
      });

      setShowOverrideModal(false);
      setPendingDecision(null);
    } catch (error) {
      setOverrideError(error instanceof Error ? `${t(language, "appointments.create.supervisorAuthFailed")}: ${error.message}` : t(language, "appointments.create.supervisorAuthFailed"));
    } finally {
      setOverrideLoading(false);
    }
  }

  async function submitCreateOverrideRequest(requesterReason: string) {
    if (!safetyComplete || safetyConfigurationError || !form.patientId || !form.modalityId || !form.appointmentDate) return;
    setRequestOverrideError(null);
    try {
      await createOverrideRequestMutation.mutateAsync({
        requestType: "create_booking",
        requesterReason,
        createdFromContext: "appointments_create",
        requestPayload: {
          patientId: form.patientId,
          modalityId: form.modalityId,
          examTypeId: form.examTypeId,
          reportingPriorityId: form.reportingPriorityId,
          bookingDate: form.appointmentDate,
          bookingTime: null,
          caseCategory: form.caseCategory,
          requiresReport: form.requiresReport,
          notes: form.notes.trim() || null,
          isWalkIn: form.isWalkIn,
          modalitySafetyAcknowledged: safetyAcknowledged,
          mriPrimaryScreening: isMriSafetyWorkflow && screeningResult ? { result: screeningResult, implantSite: screeningResult === "implant_reported_review_required" ? implantSite.trim() || null : null, implantDescription: screeningResult === "implant_reported_review_required" ? implantDescription.trim() || null : null, previousReviewerNameReported: screeningResult === "implant_reported_review_required" ? previousReviewerNameReported.trim() || null : null } : null,
          patientIdentityVerificationProof: form.patient?.patientIdentityVerificationProof ?? null,
        },
      });
      setRequestOverrideOpen(false);
      setPendingRequestDecision(null);
      pushToast({
        type: "success",
        title: t(language, "overrideRequests.submittedTitle"),
        message: t(language, "overrideRequests.createSubmittedMessage"),
      });
      void availability.refetch();
    } catch (error) {
      setRequestOverrideError(error instanceof Error ? error.message : t(language, "overrideRequests.submitFailed"));
    }
  }

  if (success) {
    const currentSuccess = success;
    const canSendWhatsapp = Boolean(currentSuccess.patientPhone1 && currentSuccess.publicAppointmentUrl);

    async function handlePrintNow() {
      if (printNowLoading) return;
      setPrintNowLoading(true);
      try {
        await printAppointmentSlipById(currentSuccess.bookingId, language);
      } finally {
        setPrintNowLoading(false);
      }
    }

    const handleSendWhatsapp = () => {
      if (!canSendWhatsapp) return;
      const phone = normalizeWhatsappPhone(currentSuccess.patientPhone1);
      const message = buildAppointmentWhatsappText(
        "appointment_reminder",
        {
          bookingDate: currentSuccess.bookingDate,
          publicAppointmentUrl: currentSuccess.publicAppointmentUrl,
        },
        language,
        patientQrSettings
      );
      if (!phone || !message) return;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    };

    return (
      <div className="max-w-2xl mx-auto">
        <AppointmentSuccessState
          appointmentSummary={currentSuccess}
          onPrintView={() => navigate(buildAppointmentPrintUrl(currentSuccess.bookingId))}
          onPrintNow={handlePrintNow}
          printNowDisabled={printNowLoading}
          onSendWhatsapp={canSendWhatsapp ? handleSendWhatsapp : undefined}
          onViewDetails={() => navigate(buildAppointmentPrintUrl(currentSuccess.bookingId))}
          onCreateAnother={() => {
            setSuccess(null);
            actions.clearAfterSuccess();
            setAvailabilitySelectedRow(null);
            setPageError(null);
            setSafetyAcknowledged(false);
            setScreeningResult(null);
            setImplantSite("");
            setImplantDescription("");
            setPreviousReviewerNameReported("");
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-4 sm:space-y-5">
      {/* Page Header */}
      <div className="space-y-2 sm:space-y-3 mb-3 sm:mb-4 lg:hidden">
        <h1 className="text-2xl sm:text-3xl font-display" style={{ color: "var(--foreground)" }}>
          {t(language, "appointments.create.title")}
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-3xl">
          {t(language, "appointments.create.subtitle")}
        </p>
      </div>

      {/* Main Grid Layout */}
      <div data-testid="appointment-create-grid" className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.95fr)] gap-4 sm:gap-5">
        {/* Patient & Form Panel */}
        <div data-testid="appointment-form-region" className="space-y-3 sm:space-y-4 order-1 xl:order-2">
          <Card className="p-4 sm:p-5 lg:sticky lg:top-4 h-fit">
            <PatientSearchSection
              value={form.patient}
              caseCategory={form.caseCategory}
              onSelectPatient={(patient: SelectedPatient) => {
                actions.setPatient(patient);
                setAvailabilitySelectedRow(null);
                setPageError(null);
                setSafetyAcknowledged(false);
              }}
              onClearPatient={() => {
                actions.setPatient(null);
                setAvailabilitySelectedRow(null);
                setPageError(null);
                setSafetyAcknowledged(false);
              }}
            />

            {form.patientId != null && (patientNoShows.length > 0 || patientNoShowSummary?.bookingRestricted) && (
              <div className="mt-4 sm:mt-5 space-y-3">
                {patientNoShowSummary?.bookingRestricted && (
                  <div className="p-3 sm:p-4 border border-red-300 rounded-xl" style={{ background: "rgba(239, 68, 68, 0.06)", color: "#b91c1c" }}>
                    <div className="text-sm font-bold">
                      {t(language, isSelectedPatientNonOncology ? "appointments.create.noShowRestrictionBlockedNonOncology" : "appointments.create.noShowRestrictionBlocked")}
                    </div>
                    {canDirectlyAuthorizeNoShowRestriction && (
                      <div className="mt-3">
                        <label className="block text-xs font-semibold mb-1">{t(language, "appointments.create.noShowAuthorizationReason")}</label>
                        <textarea
                          value={noShowAuthorizationReason}
                          onChange={(event) => setNoShowAuthorizationReason(event.target.value)}
                          className="input-premium input-ltr w-full"
                          rows={2}
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="text-sm font-bold mb-3" style={{ color: "var(--amber)" }}>
                  {t(language, "appointments.create.previousNoShows")}
                </div>
                {noShowLoading ? (
                  <div className="text-sm" style={{ color: "var(--amber)" }}>{t(language, "appointments.create.loadingNoShows")}</div>
                ) : (
                  <ul className="space-y-2">
                    {patientNoShows.filter((item) => item.status === "no-show").map((item) => (
                      <li key={item.id} className="text-sm text-muted-foreground">
                        {item.appointmentDate} — {item.examTypeName} ({item.status})
                      </li>
                    ))}
                  </ul>
                )}
                {patientNoShows.some((item) => item.status === "cancelled") && (
                  <div className="p-3 sm:p-4 border border-sky-200 rounded-xl" style={{ background: "rgba(14, 165, 233, 0.06)" }}>
                    <div className="text-sm font-bold mb-3" style={{ color: "#0369a1" }}>
                      {t(language, "appointments.create.previousCancelledAppointments")}
                    </div>
                    <ul className="space-y-2">
                      {patientNoShows.filter((item) => item.status === "cancelled").map((item) => (
                        <li key={item.id} className="text-sm text-muted-foreground">
                          {item.appointmentDate} - {item.examTypeName} ({item.status})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 mt-4 sm:mt-5">
              <ModalitySelect
                options={modalityOptions}
                value={form.modalityId}
                displayMode={entityDisplayMode}
                onChange={(value) => {
                  actions.setModalityId(value);
                  setAvailabilitySelectedRow(null);
                  setSafetyAcknowledged(false);
                }}
                disabled={!schedulingEngineEnabled || !form.patientId}
              />

              {safetyWarningEnabled && safetyComplete && (
                <div className="xl:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3 text-sm">
                  {isMriSafetyWorkflow ? (
                    <MriPrimaryScreeningBadges result={screeningResult} />
                  ) : (
                    <Badge variant="success" className="whitespace-normal text-start leading-snug">
                      {t(language, "appointments.create.safety.acknowledged")}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => setSafetyAcknowledged(false)}
                  >
                    <RefreshCw size={14} className="me-1.5" aria-hidden="true" />
                    {t(language, isMriSafetyWorkflow ? "appointments.create.safety.changeScreeningResponse" : "appointments.create.safety.reviewWarningAgain")}
                  </Button>
                </div>
              )}

              {safetyWarningEnabled && !safetyComplete && (
                <div className="xl:col-span-2">
                  <Card className={`border-2 p-4 sm:p-5 ${safetyConfigurationError ? "border-red-300 bg-red-50/60" : "border-amber-300 bg-amber-50/70"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${safetyConfigurationError ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          <TriangleAlert size={20} aria-hidden="true" />
                        </span>
                        <h3 className={`text-lg font-semibold leading-tight ${safetyConfigurationError ? "text-red-950" : "text-amber-950"}`}>
                          {t(language, isMriSafetyWorkflow ? "appointments.create.safety.mriTitle" : "appointments.create.safety.modalityTitle")}
                        </h3>
                      </div>
                      <Badge variant={safetyConfigurationError ? "error" : "warning"} className="shrink-0 whitespace-normal text-center leading-snug">
                        {t(language, "appointments.create.safety.requiredBeforeBooking")}
                      </Badge>
                    </div>

                    {safetyConfigurationError ? (
                      <Alert variant="error" className="mt-4" role="alert">
                        <AlertDescription className="mt-0">
                          {t(language, "appointments.create.safety.misconfigured")}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        <Alert variant="warning" className="mt-4 border-amber-300 bg-amber-100/70">
                          <AlertDescription className="mt-0 whitespace-pre-line text-amber-950">
                            {safetyMessage}
                          </AlertDescription>
                        </Alert>

                        {isMriSafetyWorkflow ? (
                          <fieldset className="mt-5 border-t border-amber-200 pt-5">
                            <legend className="sr-only">{t(language, "appointments.create.safety.mriTitle")}</legend>
                            <p className="mb-4 text-sm leading-relaxed text-amber-950">
                              {t(language, "appointments.create.safety.mriSupportingText")}
                            </p>
                            <div className="space-y-3">
                              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3.5 transition-colors focus-within:ring-2 focus-within:ring-amber-500 focus-within:ring-offset-2 ${screeningResult === "no_known_implant_reported" ? "border-amber-500 bg-amber-100" : "border-amber-200 bg-background hover:border-amber-300"}`}>
                                <input
                                  type="radio"
                                  name="mri-screening"
                                  value="no_known_implant_reported"
                                  checked={screeningResult === "no_known_implant_reported"}
                                  onChange={() => setScreeningResult("no_known_implant_reported")}
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600 focus-visible:outline-none"
                                />
                                <span className="text-sm font-medium leading-relaxed text-foreground">
                                  {t(language, "appointments.create.safety.noImplantOption")}
                                </span>
                              </label>

                              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3.5 transition-colors focus-within:ring-2 focus-within:ring-amber-500 focus-within:ring-offset-2 ${screeningResult === "implant_reported_review_required" ? "border-amber-500 bg-amber-100" : "border-amber-200 bg-background hover:border-amber-300"}`}>
                                <input
                                  type="radio"
                                  name="mri-screening"
                                  value="implant_reported_review_required"
                                  checked={screeningResult === "implant_reported_review_required"}
                                  onChange={() => setScreeningResult("implant_reported_review_required")}
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600 focus-visible:outline-none"
                                />
                                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
                                <span className="text-sm font-medium leading-relaxed text-foreground">
                                  {t(language, "appointments.create.safety.implantOption")}
                                </span>
                              </label>
                            </div>

                            {screeningResult === "implant_reported_review_required" && (
                              <div className="mt-4 grid gap-4 rounded-xl border border-amber-200 bg-background/80 p-4">
                                <div>
                                  <label htmlFor="mri-implant-site" className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                                    {t(language, "appointments.create.safety.implantSite")}
                                    <span className="text-xs font-medium text-red-700">{t(language, "appointments.create.safety.required")}</span>
                                  </label>
                                  <Input
                                    id="mri-implant-site"
                                    dir="auto"
                                    className="w-full"
                                    value={implantSite}
                                    onChange={(event) => setImplantSite(event.target.value)}
                                    aria-label={t(language, "appointments.create.safety.implantSite")}
                                    aria-describedby="mri-implant-site-help"
                                    aria-invalid={!implantSite.trim()}
                                  />
                                  {!implantSite.trim() && (
                                    <p id="mri-implant-site-help" className="mt-1.5 text-xs font-medium text-red-700">
                                      {t(language, "appointments.create.safety.implantSiteRequired")}
                                    </p>
                                  )}
                                </div>
                                <div>
                                  <label htmlFor="mri-implant-description" className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                                    {t(language, "appointments.create.safety.implantDescription")}
                                    <span className="text-xs font-normal text-muted-foreground">{t(language, "appointments.create.safety.optional")}</span>
                                  </label>
                                  <Input id="mri-implant-description" dir="auto" className="w-full" value={implantDescription} onChange={(event) => setImplantDescription(event.target.value)} aria-label={t(language, "appointments.create.safety.implantDescription")} />
                                </div>
                                <div>
                                  <label htmlFor="mri-previous-reviewer" className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                                    {t(language, "appointments.create.safety.previousReviewer")}
                                    <span className="text-xs font-normal text-muted-foreground">{t(language, "appointments.create.safety.optional")}</span>
                                  </label>
                                  <Input id="mri-previous-reviewer" dir="auto" className="w-full" value={previousReviewerNameReported} onChange={(event) => setPreviousReviewerNameReported(event.target.value)} aria-label={t(language, "appointments.create.safety.previousReviewer")} />
                                </div>
                              </div>
                            )}

                            <div className="mt-5 flex">
                              <Button
                                type="button"
                                size="lg"
                                className="w-full sm:w-auto"
                                onClick={() => setSafetyAcknowledged(true)}
                                disabled={!screeningResult || (screeningResult === "implant_reported_review_required" && !implantSite.trim())}
                              >
                                {t(language, "appointments.create.safety.completePrimaryScreening")}
                              </Button>
                            </div>
                          </fieldset>
                        ) : (
                          <div className="mt-5 border-t border-amber-200 pt-5">
                            <p className="mb-4 text-sm leading-relaxed text-amber-950">
                              {t(language, "appointments.create.safety.acknowledgementStatement")}
                            </p>
                            <Button type="button" size="lg" className="w-full sm:w-auto" onClick={() => setSafetyAcknowledged(true)}>
                              {t(language, "appointments.create.safety.acknowledgeAndContinue")}
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </Card>
                </div>
              )}

              {safetyComplete && <>
              <ExamTypeSelect
                options={effectiveExamTypes}
                value={form.examTypeId}
                displayMode={entityDisplayMode}
                onChange={(value) => {
                  actions.setExamTypeId(value);
                  setAvailabilitySelectedRow(null);
                }}
                disabled={!schedulingEngineEnabled || !form.modalityId || !safetyComplete}
              />

              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">
                  {t(language, "appointments.create.entityDisplay")}
                </label>
                <select
                  aria-label={t(language, "appointments.create.entityDisplay")}
                  value={entityDisplayMode}
                  onChange={(e) => setEntityDisplayMode(e.target.value as EntityDisplayMode)}
                  className="input-premium"
                >
                  <option value="ar">{t(language, "appointments.create.entityDisplayArabic")}</option>
                  <option value="en">{t(language, "appointments.create.entityDisplayEnglish")}</option>
                  <option value="both">{t(language, "appointments.create.entityDisplayBoth")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">
                  {t(language, "appointments.create.priority")}
                </label>
                <select
                  aria-label={t(language, "appointments.create.priority")}
                  value={form.reportingPriorityId ?? ""}
                  onChange={(e) => actions.setReportingPriorityId(e.target.value ? Number(e.target.value) : null)}
                  className="input-premium"
                >
                  <option value="" hidden>{t(language, "appointments.create.routineDefault")}</option>
                  {filteredPriorityOptions.map((p) => (
                    <option key={p.id} value={p.id}>{chooseLocalized(language, p.nameAr, p.nameEn)}</option>
                  ))}
                </select>
              </div>

              {isWalkInEnabled && (
                <label className="flex items-center gap-3 cursor-pointer user-select-none p-2.5 rounded-lg hover:bg-muted/50 xl:col-span-2">
                  <input
                    type="checkbox"
                    id="isWalkIn"
                    checked={form.isWalkIn}
                    onChange={(e) => actions.setIsWalkIn(e.target.checked)}
                    className="w-5 h-5 cursor-pointer accent-[var(--accent)]"
                  />
                  <span className="text-sm sm:text-base font-semibold text-foreground">{t(language, "appointments.create.walkIn")}</span>
                </label>
              )}

              <label className="flex items-start gap-3 cursor-pointer user-select-none p-2.5 rounded-lg hover:bg-muted/50 xl:col-span-2">
                <input
                  type="checkbox"
                  id="requiresReport"
                  aria-label={t(language, "appointments.create.reportRequired")}
                  checked={form.requiresReport}
                  onChange={(e) => actions.setRequiresReport(e.target.checked)}
                  disabled={isSelectedPatientNonOncology && !form.requiresReport && !canEnableNonOncologyReport}
                  className="mt-0.5 w-5 h-5 cursor-pointer accent-[var(--accent)]"
                />
                <span className="text-sm sm:text-base text-foreground">
                  <span className="block font-semibold">{chooseLocalized(language, "التقرير مطلوب", "Report required")}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {chooseLocalized(language, "عند التفعيل، يمكن لصفحة رمز QR الخاصة بالمريض إظهار توفر التقرير بعد اكتمال الفحص.", "When enabled, the patient QR page can show report availability after the exam is completed.")}
                  </span>
                </span>
              </label>

              {showIntendedReportingDoctor && (
                <div className="xl:col-span-2">
                  <label className="block text-sm font-semibold mb-2 text-foreground">
                    {t(language, "appointments.create.intendedReportingDoctor")}
                  </label>
                  <select
                    aria-label={t(language, "appointments.create.intendedReportingDoctor")}
                    value={form.intendedReportingDoctorId ?? ""}
                    onChange={(event) => actions.setIntendedReportingDoctorId(event.target.value ? Number(event.target.value) : null)}
                    className="input-premium"
                    disabled={intendedReportingDoctorsQuery.isLoading}
                  >
                    <option value="">{t(language, "appointments.create.normalReportingPool")}</option>
                    {(intendedReportingDoctorsQuery.data ?? []).map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>
                    ))}
                  </select>
                  <textarea
                    aria-label={t(language, "appointments.create.intendedReportingDoctorReason")}
                    value={form.intendedReportingDoctorReason}
                    onChange={(event) => actions.setIntendedReportingDoctorReason(event.target.value)}
                    className="input-premium mt-2"
                    rows={2}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t(language, "appointments.create.intendedReportingDoctorHelp")}
                  </p>
                </div>
              )}

              {!isReceptionist && (
              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">
                  {t(language, "appointments.create.appointmentDate")}
                </label>
                <Input
                  aria-label={t(language, "appointments.create.appointmentDate")}
                  type="date"
                  value={form.appointmentDate}
                  onChange={(e) => actions.setAppointmentDate(e.target.value, form.overrideRequired)}
                />
              </div>
              )}

              <div className="xl:col-span-2">
                <label className="block text-sm font-semibold mb-2 text-foreground">
                  {t(language, "appointments.create.notes")}
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => actions.setNotes(e.target.value)}
                  rows={2}
                  className="input-premium"
                />
              </div>

              {showCapacityResolutionActions ? <div className="xl:col-span-2">
                <SpecialQuotaSection
                  capacityResolutionMode={form.capacityResolutionMode}
                  onChangeCapacityResolutionMode={(mode) => {
                    if (mode === "special_quota_extra" && !hasSpecialQuotaAvailable) return;
                    actions.setCapacityResolutionMode(mode);
                    setPendingDecision(null);
                    setShowOverrideModal(false);
                    setOverrideError(null);
                  }}
                  specialQuotaAvailable={hasSpecialQuotaAvailable}
                  specialQuotaRemaining={selectedSpecialQuotaSummary?.remaining ?? null}
                  specialQuotaConfigured={selectedSpecialQuotaSummary?.configured ?? null}
                  showCapacityActions={showCapacityResolutionActions}
                  canUseSpecialQuota={hasSpecialQuotaAvailable}
                  canUseCategoryOverride={canUseNonStandardCapacityModes && selectedDateNeedsCategoryOverride}
                  canUseTotalCapacityOverride={isSuperAdmin && selectedDateNeedsTotalCapacityOverride}
                  specialReasonCode={form.specialReasonCode}
                  onChangeSpecialReasonCode={actions.setSpecialReasonCode}
                  specialReasonConfirmed={form.specialReasonConfirmed}
                  onChangeSpecialReasonConfirmed={actions.setSpecialReasonConfirmed}
                  specialReasonNote={form.specialReasonNote}
                  onChangeSpecialReasonNote={actions.setSpecialReasonNote}
                  options={specialReasonOptions}
                />
              </div> : null}
              {isSuperAdmin && selectedDateNeedsTotalCapacityOverride && (
                <div className="text-xs text-muted-foreground xl:col-span-2">
                  {language === "ar"
                    ? "تجاوز السعة الإجمالية متاح فقط عبر مسار صريح مع سبب."
                    : "Total capacity overbooking is only available via an explicit override path with reason."}
                </div>
              )}

              {form.overrideRequired && (
                <div className="text-sm font-medium border border-amber-200 p-3 rounded-lg xl:col-span-2" style={{ background: "rgba(245, 158, 11, 0.05)", color: "var(--amber)" }}>
                  <div>{t(language, "appointments.create.overrideRequired")}</div>
                  {isReceptionist && selectedRowSupportedOverrideType ? (
                    <div className="mt-1 text-xs">
                      {formatOverrideType(selectedRowSupportedOverrideType)}
                    </div>
                  ) : null}
                </div>
              )}

              {pageError && (
                <div className="p-3 sm:p-4 border border-red-200 rounded-lg xl:col-span-2" style={{ background: "rgba(239, 68, 68, 0.05)", color: "#ef4444" }}>
                  <span className="text-sm font-medium">{pageError}</span>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 sm:gap-4 pt-4 border-t border-border mt-1 xl:col-span-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    actions.resetAll();
                    setSafetyAcknowledged(false);
                    setNoShowAuthorizationReason("");
                  }}
                  disabled={submitLoading}
                >
                  {t(language, "appointments.create.reset")}
                </Button>
                <Button
                  onClick={runSubmitFlow}
                  disabled={!canSubmitCreate}
                >
                  {submitLoading ? t(language, "appointments.create.creating") : t(language, "appointments.create.create")}
                </Button>
                {canRequestOverrideApproval ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (!selectedRowSupportedOverrideType) return;
                      setRequestOverrideType(selectedRowSupportedOverrideType);
                      setPendingRequestDecision(availability.rawItems.find((item) => item.date === form.appointmentDate)?.decision ?? null);
                      setRequestOverrideError(null);
                      setRequestOverrideOpen(true);
                    }}
                    disabled={createOverrideRequestMutation.isPending}
                  >
                    {t(language, "overrideRequests.requestApproval")}
                  </Button>
                ) : null}
              </div>
            </>}
            </div>
          </Card>
        </div>

        {/* Availability Panel */}
        <div data-testid="appointment-availability-region" className="space-y-3 sm:space-y-4 order-2 xl:order-1">
          <Card className="p-4 sm:p-5">
            <div className="mb-4 sm:mb-5 flex items-start justify-between gap-3">
              <h3 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--foreground)" }}>
                {t(language, "appointments.create.evaluatedAvailability")}
              </h3>
              <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${safetyComplete ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                {safetyComplete ? availabilityStatusLabel : t(language, "appointments.create.safety.requiredBeforeBooking")}
              </span>
            </div>
            {safetyComplete ? (
              <AvailabilityPanel
                rows={availability.rows}
                selectedDate={form.appointmentDate}
                onSelectDate={handleSelectAvailabilityRow}
                loading={availability.isLoading}
                showFullDays={showFullDays}
                onToggleShowFullDays={() => setShowFullDays((current) => !current)}
                showPolicyHiddenDays={showPolicyHiddenDays}
                onToggleShowPolicyHiddenDays={() => setShowPolicyHiddenDays((current) => !current)}
                startDate={startDateFromOffset(availabilityOffset)}
                onChangeStartDate={(nextDate) => {
                  setAvailabilityOffset(offsetFromStartDate(nextDate));
                  setAvailabilitySelectedRow(null);
                }}
                onPreviousPage={() => {
                  setAvailabilityOffset((current) => Math.max(0, current - AVAILABILITY_WINDOW_DAYS));
                  setAvailabilitySelectedRow(null);
                }}
                onNextPage={() => {
                  setAvailabilityOffset((current) => current + AVAILABILITY_WINDOW_DAYS);
                  setAvailabilitySelectedRow(null);
                }}
                canGoPrevious={availabilityOffset > 0}
                allowOverrideRequests={allowReceptionOverrideRequestsFromAvailability || !isReceptionist}
                emptyMessage={
                  availability.enabled
                    ? t(language, "appointments.create.noAvailabilityRows")
                    : ""
                }
              />
            ) : (
              <div data-testid="safety-locked-availability" className="flex min-h-44 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 p-6 text-center">
                <div className="max-w-sm text-amber-900">
                  <span className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <Lock size={19} aria-hidden="true" />
                  </span>
                  <p className="text-sm font-medium leading-relaxed">
                    {t(language, "appointments.create.safety.availabilityLocked")}
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>

      </div>

      <SupervisorOverrideModal
        open={showOverrideModal}
        onClose={() => {
          setShowOverrideModal(false);
          setOverrideError(null);
        }}
        onConfirm={handleOverrideConfirm}
        loading={overrideLoading}
        authError={overrideError}
      />

      <SchedulingOverrideRequestModal
        open={requestOverrideOpen}
        requestType="create_booking"
        overrideType={requestOverrideType}
        patientLabel={selectedPatientLabel}
        modalityLabel={selectedModalityLabel}
        examTypeLabel={selectedExamTypeLabel}
        requestedDate={form.appointmentDate}
        requestedTime={null}
        decision={pendingRequestDecision}
        loading={createOverrideRequestMutation.isPending}
        error={requestOverrideError}
        onClose={() => {
          setRequestOverrideOpen(false);
          setRequestOverrideError(null);
        }}
        onSubmit={submitCreateOverrideRequest}
      />
    </div>
  );
}
