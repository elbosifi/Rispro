import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { pushToast } from "@/lib/toast";
import { fetchAppointments, fetchPatientQrSettings, fetchSettings, getAppointmentById } from "@/lib/api-hooks";
import { chooseLocalized, t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { buildAppointmentPrintUrl } from "@/lib/print-routing";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import type {
  BookingResponse,
  CapacityResolutionMode,
  CreateBookingRequest,
  ExamTypeDto,
  ModalityDto,
  SchedulingDecisionDto,
  SpecialReasonCodeDto,
} from "../types";
import { useV2ExamTypes } from "../api";
import { useCreateAppointmentForm, type SelectedPatient } from "../hooks/useCreateAppointmentForm";
import { useAppointmentAvailability, type AvailabilityRowViewModel } from "../hooks/useAppointmentAvailability";
import { PatientSearchSection } from "./PatientSearchSection";
import { ModalitySelect } from "./ModalitySelect";
import { ExamTypeSelect } from "./ExamTypeSelect";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { SpecialQuotaSection } from "./SpecialQuotaSection";
import { SupervisorOverrideModal } from "./SupervisorOverrideModal";
import { AppointmentSuccessState } from "./AppointmentSuccessState";
import { SectionLabel, Button, Card } from "@/components/shared";
import { formatAppointmentPatientName } from "../utils/patient-display-name";
import { formatEntityLabel, type EntityDisplayMode } from "../utils/entity-display";
import type { Role } from "@/types/api";

interface CreateAppointmentTabProps {
  patientLookups: unknown;
  modalityOptions: ModalityDto[];
  examTypeOptions: ExamTypeDto[];
  specialReasonOptions: SpecialReasonCodeDto[];
  priorityOptions: Array<{ id: number; nameEn: string; nameAr: string }>;
  schedulingEngineEnabled: boolean;
  canUseNonStandardCapacityModes?: boolean;
  currentUserRole?: Role;
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
  patientName: string;
  bookingDate: string;
  modalityName: string;
  examTypeName?: string | null;
  wasOverride: boolean;
  publicAppointmentUrl?: string | null;
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

export function CreateAppointmentTab({
  patientLookups: _patientLookups,
  modalityOptions,
  examTypeOptions,
  specialReasonOptions,
  priorityOptions,
  schedulingEngineEnabled,
  canUseNonStandardCapacityModes = false,
  currentUserRole,
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
  const { form, actions } = useCreateAppointmentForm({
    oncology: patientQrSettings?.defaultReportRequiredForOncology ?? true,
    nonOncology: patientQrSettings?.defaultReportRequiredForNonOncology ?? false,
  });
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [availabilitySelectedRow, setAvailabilitySelectedRow] = useState<AvailabilityRowViewModel | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<SchedulingDecisionDto | null>(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [success, setSuccess] = useState<SuccessSummary | null>(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);
  const [printNowLoading, setPrintNowLoading] = useState(false);
  const [patientNoShows, setPatientNoShows] = useState<Array<{ id: number; appointmentDate: string; examTypeName: string; status: string }>>([]);
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [availabilityOffset, setAvailabilityOffset] = useState(0);
  const [showFullDays, setShowFullDays] = useState(false);
  const [showWeekendDays, setShowWeekendDays] = useState(false);
  const [entityDisplayMode, setEntityDisplayMode] = useState<EntityDisplayMode>(() => {
    if (typeof window === "undefined") return "both";
    const stored = window.localStorage.getItem(ENTITY_DISPLAY_MODE_STORAGE_KEY);
    if (stored === "ar" || stored === "en" || stored === "both") return stored;
    return "both";
  });
  const pendingDecisionRef = useRef<SchedulingDecisionDto | null>(null);
  const initialPatientAppliedRef = useRef(false);
  const isReceptionist = currentUserRole === "receptionist";
  const isSuperAdmin = currentUserRole === "super_admin";
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
  const hasSafetyWarning = selectedModality?.safetyWarningEnabled && 
    !!(selectedModality.safetyWarningEn || selectedModality.safetyWarningAr);
  const safetyMessage = chooseLocalized(language, selectedModality?.safetyWarningAr, selectedModality?.safetyWarningEn) || "";

  const filteredExamTypes = useMemo(
    () => examTypeOptions.filter((et) => form.modalityId != null && et.modalityId === form.modalityId),
    [examTypeOptions, form.modalityId]
  );
  const modalityExamTypes = useV2ExamTypes(form.modalityId);
  const effectiveExamTypes = modalityExamTypes.data ?? filteredExamTypes;

  const availability = useAppointmentAvailability({
    patientId: form.patientId,
    modalityId: form.modalityId,
    examTypeId: form.examTypeId,
    caseCategory: form.caseCategory,
    capacityResolutionMode: form.capacityResolutionMode,
    specialReasonCode:
      form.capacityResolutionMode === "special_quota_extra" ? form.specialReasonCode || null : null,
    days: AVAILABILITY_WINDOW_DAYS,
    offset: availabilityOffset,
  });
  const hasSpecialQuotaAvailable = (availability.rawItems ?? []).some(
    (item) =>
      item.date === form.appointmentDate &&
      (item.specialQuotaSummary?.remaining ?? 0) > 0
  );
  const filteredPriorityOptions = useMemo(
    () => priorityOptions.filter((p) => !isRoutinePriority(p)),
    [priorityOptions]
  );

  useEffect(() => {
    if (
      form.capacityResolutionMode !== "standard" &&
      (!canUseNonStandardCapacityModes ||
        (form.capacityResolutionMode === "special_quota_extra" && !hasSpecialQuotaAvailable))
    ) {
      actions.setCapacityResolutionMode("standard");
    }
  }, [actions, form.capacityResolutionMode, hasSpecialQuotaAvailable, canUseNonStandardCapacityModes]);

  useEffect(() => {
    if (!form.patientId) {
      setPatientNoShows([]);
      setNoShowLoading(false);
      return;
    }

    let cancelled = false;
    setNoShowLoading(true);

    fetchAppointments({
      status: ["no-show", "cancelled"],
      patientId: String(form.patientId),
      dateTo: new Date().toISOString().slice(0, 10),
    })
        .then((appointments) => {
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
      })
      .catch(() => {
        if (!cancelled) {
          setPatientNoShows([]);
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

  function handleSelectAvailabilityRow(row: AvailabilityRowViewModel) {
    if (isReceptionist && row.status !== "available") {
      return;
    }
    if (row.status === "blocked") {
      return;
    }

    if (row.status === "full" && !row.requiresSupervisorOverride) {
      return;
    }

    const requiresOverride = row.status === "restricted" || (row.status === "full" && row.requiresSupervisorOverride);
    actions.setAppointmentDate(row.date, requiresOverride);
    setAvailabilitySelectedRow(row);
    setPageError(null);
  }

  function validateBaseFields(): string | null {
    if (!form.patientId) return t(language, "appointments.create.missingPatient");
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
      capacityResolutionMode:
        canUseNonStandardCapacityModes ? form.capacityResolutionMode : "standard",
      useSpecialQuota:
        canUseNonStandardCapacityModes && form.capacityResolutionMode === "special_quota_extra",
      specialReasonCode:
        canUseNonStandardCapacityModes && form.capacityResolutionMode === "special_quota_extra"
          ? form.specialReasonCode || null
          : null,
      specialReasonNote:
        canUseNonStandardCapacityModes && form.capacityResolutionMode === "special_quota_extra"
          ? form.specialReasonNote.trim() || null
          : null,
      notes: form.notes.trim() || null,
      isWalkIn: form.isWalkIn,
      requiresReport: form.requiresReport,
      override,
    };

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
    try {
      const appointmentDetails = await getAppointmentById(response.booking.id);
      publicAppointmentUrl = String(appointmentDetails.publicAppointmentUrl || "").trim() || null;
    } catch {
      publicAppointmentUrl = null;
    }
    setSuccess({
      bookingId: response.booking.id,
      patientId: form.patientId,
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

    try {
      const decision = await onEvaluateAvailability({
        patientId: form.patientId as number,
        modalityId: form.modalityId as number,
        examTypeId: form.examTypeId,
        scheduledDate: form.appointmentDate,
        caseCategory: form.caseCategory,
        capacityResolutionMode:
          canUseNonStandardCapacityModes ? form.capacityResolutionMode : "standard",
        useSpecialQuota:
          canUseNonStandardCapacityModes && form.capacityResolutionMode === "special_quota_extra",
        specialReasonCode:
          canUseNonStandardCapacityModes && form.capacityResolutionMode === "special_quota_extra"
            ? form.specialReasonCode || null
            : null,
        includeOverrideEvaluation: true,
      });

      if (availabilitySelectedRow && (decision.displayStatus === "blocked")) {
        setPageError(t(language, "appointments.create.availabilityChanged"));
        return;
      }

      if (decision.displayStatus === "blocked" && !decision.requiresSupervisorOverride) {
        setPageError(t(language, "appointments.create.selectedDateNotAllowed"));
        return;
      }

      const selectedCapacityModeNeedsOverrideAuth =
        form.capacityResolutionMode === "category_override" ||
        form.capacityResolutionMode === "total_capacity_override";

      if (decision.requiresSupervisorOverride || decision.displayStatus === "restricted" || selectedCapacityModeNeedsOverrideAuth) {
        setPendingDecision(decision);
        setShowOverrideModal(true);
        return;
      }

      if (hasSafetyWarning && !safetyAcknowledged) {
        pendingDecisionRef.current = decision;
        setShowSafetyModal(true);
        return;
      }

      await createWithDecision(decision);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : t(language, "appointments.create.failedCreate"));
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
      });

      setShowOverrideModal(false);
      setPendingDecision(null);
    } catch (error) {
      setOverrideError(error instanceof Error ? `${t(language, "appointments.create.supervisorAuthFailed")}: ${error.message}` : t(language, "appointments.create.supervisorAuthFailed"));
    } finally {
      setOverrideLoading(false);
    }
  }

  if (success) {
    const currentSuccess = success;

    async function handlePrintNow() {
      if (printNowLoading) return;
      setPrintNowLoading(true);
      try {
        await printAppointmentSlipById(currentSuccess.bookingId, language);
      } finally {
        setPrintNowLoading(false);
      }
    }

    return (
      <div className="max-w-2xl mx-auto">
        <AppointmentSuccessState
          appointmentSummary={currentSuccess}
          onPrintView={() => navigate(buildAppointmentPrintUrl(currentSuccess.bookingId))}
          onPrintNow={handlePrintNow}
          printNowDisabled={printNowLoading}
          onViewDetails={() => navigate(buildAppointmentPrintUrl(currentSuccess.bookingId))}
          onCreateAnother={() => {
            setSuccess(null);
            actions.clearAfterSuccess();
            setAvailabilitySelectedRow(null);
            setPageError(null);
            setSafetyAcknowledged(false);
            setShowSafetyModal(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-4 sm:space-y-5">
      {/* Page Header */}
      <div className="space-y-2 sm:space-y-3 mb-3 sm:mb-4 lg:hidden">
        <div className="flex items-center gap-3">
          <SectionLabel pulsing>{t(language, "appointments.create.sectionLabel")}</SectionLabel>
        </div>
        <h1 className="text-2xl sm:text-3xl font-display" style={{ color: "var(--foreground)" }}>
          {t(language, "appointments.create.title")}
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-3xl">
          {t(language, "appointments.create.subtitle")}
        </p>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.95fr)] gap-4 sm:gap-5">
        {/* Patient & Form Panel */}
        <div className="space-y-3 sm:space-y-4 order-1 xl:order-2">
          <div className="flex items-center gap-3">
            <SectionLabel>{t(language, "appointments.create.patientDetails")}</SectionLabel>
          </div>
          <Card className="p-4 sm:p-5 lg:sticky lg:top-4 h-fit">
            <PatientSearchSection
              value={form.patient}
              caseCategory={form.caseCategory}
              onSelectPatient={(patient: any) => {
                actions.setPatient(patient);
                setAvailabilitySelectedRow(null);
                setPageError(null);
                setSafetyAcknowledged(false);
                setShowSafetyModal(false);
              }}
              onClearPatient={() => {
                actions.setPatient(null);
                setAvailabilitySelectedRow(null);
                setPageError(null);
                setSafetyAcknowledged(false);
                setShowSafetyModal(false);
              }}
            />

            {form.patientId != null && patientNoShows.length > 0 && (
              <div className="mt-4 sm:mt-5 p-3 sm:p-4 border border-amber-200 rounded-xl" style={{ background: "rgba(245, 158, 11, 0.05)" }}>
                <div className="text-sm font-bold mb-3" style={{ color: "var(--amber)" }}>
                  {t(language, "appointments.create.previousNoShows")}
                </div>
                {noShowLoading ? (
                  <div className="text-sm" style={{ color: "var(--amber)" }}>{t(language, "appointments.create.loadingNoShows")}</div>
                ) : (
                  <ul className="space-y-2">
                    {patientNoShows.map((item) => (
                      <li key={item.id} className="text-sm text-muted-foreground">
                        {item.appointmentDate} — {item.examTypeName} ({item.status})
                      </li>
                    ))}
                  </ul>
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
                  setShowSafetyModal(false);
                }}
                disabled={!schedulingEngineEnabled || !form.patientId}
              />

              <ExamTypeSelect
                options={effectiveExamTypes}
                value={form.examTypeId}
                displayMode={entityDisplayMode}
                onChange={(value) => {
                  actions.setExamTypeId(value);
                  setAvailabilitySelectedRow(null);
                }}
                disabled={!schedulingEngineEnabled || !form.modalityId}
              />

              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">
                  Entity Display
                </label>
                <select
                  aria-label="Entity Display"
                  value={entityDisplayMode}
                  onChange={(e) => setEntityDisplayMode(e.target.value as EntityDisplayMode)}
                  className="input-premium"
                >
                  <option value="ar">Arabic</option>
                  <option value="en">English</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">
                  {t(language, "appointments.create.caseCategory")}
                </label>
                <select
                  aria-label={t(language, "appointments.create.caseCategory")}
                  value={form.caseCategory}
                  onChange={(e) => {
                    actions.setCaseCategory(e.target.value as "oncology" | "non_oncology");
                    setAvailabilitySelectedRow(null);
                    setPendingDecision(null);
                    setShowOverrideModal(false);
                    setOverrideError(null);
                  }}
                  className="input-premium"
                >
                  <option value="non_oncology">{t(language, "appointments.create.nonOncology")}</option>
                  <option value="oncology">{t(language, "appointments.create.oncology")}</option>
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
                  checked={form.requiresReport}
                  onChange={(e) => actions.setRequiresReport(e.target.checked)}
                  className="mt-0.5 w-5 h-5 cursor-pointer accent-[var(--accent)]"
                />
                <span className="text-sm sm:text-base text-foreground">
                  <span className="block font-semibold">{chooseLocalized(language, "التقرير مطلوب", "Report required")}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {chooseLocalized(language, "عند التفعيل، يمكن لصفحة رمز QR الخاصة بالمريض إظهار توفر التقرير بعد اكتمال الفحص.", "When enabled, the patient QR page can show report availability after the exam is completed.")}
                  </span>
                </span>
              </label>

              {!isReceptionist && (
              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">
                  {t(language, "appointments.create.appointmentDate")}
                </label>
                <input
                  aria-label={t(language, "appointments.create.appointmentDate")}
                  type="date"
                  value={form.appointmentDate}
                  onChange={(e) => actions.setAppointmentDate(e.target.value, form.overrideRequired)}
                  className="input-premium"
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

              <div className="xl:col-span-2">
                <SpecialQuotaSection
                  capacityResolutionMode={form.capacityResolutionMode}
                  onChangeCapacityResolutionMode={(mode) => {
                    if (mode === "special_quota_extra" && !hasSpecialQuotaAvailable) return;
                    actions.setCapacityResolutionMode(mode);
                    setAvailabilitySelectedRow(null);
                    setPendingDecision(null);
                    setShowOverrideModal(false);
                    setOverrideError(null);
                  }}
                  specialQuotaAvailable={hasSpecialQuotaAvailable}
                  supervisorMode={canUseNonStandardCapacityModes}
                  superAdminMode={isSuperAdmin}
                  specialReasonCode={form.specialReasonCode}
                  onChangeSpecialReasonCode={actions.setSpecialReasonCode}
                  specialReasonConfirmed={form.specialReasonConfirmed}
                  onChangeSpecialReasonConfirmed={actions.setSpecialReasonConfirmed}
                  specialReasonNote={form.specialReasonNote}
                  onChangeSpecialReasonNote={actions.setSpecialReasonNote}
                  options={specialReasonOptions}
                />
              </div>
              {isSuperAdmin && (
                <div className="text-xs text-muted-foreground xl:col-span-2">
                  {language === "ar"
                    ? "تجاوز السعة الإجمالية متاح فقط عبر مسار صريح مع سبب."
                    : "Total capacity overbooking is only available via an explicit override path with reason."}
                </div>
              )}

              {form.overrideRequired && (
                <div className="text-sm font-medium border border-amber-200 p-3 rounded-lg xl:col-span-2" style={{ background: "rgba(245, 158, 11, 0.05)", color: "var(--amber)" }}>
                  {t(language, "appointments.create.overrideRequired")}
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
                    setShowSafetyModal(false);
                  }}
                  disabled={submitLoading}
                >
                  {t(language, "appointments.create.reset")}
                </Button>
                <Button
                  onClick={runSubmitFlow}
                  disabled={submitLoading || !schedulingEngineEnabled}
                >
                  {submitLoading ? t(language, "appointments.create.creating") : t(language, "appointments.create.create")}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Availability Panel */}
        <div className="space-y-3 sm:space-y-4 order-2 xl:order-1">
          <div className="flex items-center gap-3">
            <SectionLabel>{t(language, "appointments.create.availabilityLabel")}</SectionLabel>
          </div>
          <Card className="p-4 sm:p-5">
            <h3 className="text-lg sm:text-xl font-semibold mb-4 sm:mb-5" style={{ color: "var(--foreground)" }}>{t(language, "appointments.create.evaluatedAvailability")}</h3>
            <AvailabilityPanel
              rows={availability.rows}
              selectedDate={form.appointmentDate}
              onSelectDate={handleSelectAvailabilityRow}
              loading={availability.isLoading}
              showFullDays={showFullDays}
              onToggleShowFullDays={() => setShowFullDays((current) => !current)}
              showWeekendDays={showWeekendDays}
              onToggleShowWeekendDays={() => setShowWeekendDays((current) => !current)}
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
              emptyMessage={
                availability.enabled
                  ? t(language, "appointments.create.noAvailabilityRows")
                  : t(language, "appointments.create.loadAvailabilityHint")
              }
            />
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

      {showSafetyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setShowSafetyModal(false); }}>
          <Card className="w-full max-w-md mx-4 p-4 sm:p-5">
            <h3 className="text-lg sm:text-xl font-semibold mb-3" style={{ color: "var(--amber)" }}>{t(language, "appointments.create.safetyConfirmation")}</h3>
            <p className="text-sm sm:text-base mb-4" style={{ color: "var(--amber)" }}>{safetyMessage}</p>
            <p className="text-sm sm:text-base mb-5">
              {t(language, "appointments.create.confirmNoContraindications", {
                modality: formatEntityLabel({
                  mode: entityDisplayMode,
                  nameAr: selectedModality?.nameAr,
                  nameEn: selectedModality?.nameEn,
                  fallback: selectedModality?.name || "—",
                }),
              })}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowSafetyModal(false)}
                className="flex-1"
              >
                {t(language, "appointments.create.cancel")}
              </Button>
              <Button
                className="flex-1"
                style={{ background: "var(--amber)" }}
                onClick={async () => {
                  setSafetyAcknowledged(true);
                  setShowSafetyModal(false);
                  const decision = pendingDecisionRef.current;
                  if (decision) {
                    pendingDecisionRef.current = null;
                    setSubmitLoading(true);
                    try {
                      await createWithDecision(decision);
                    } catch (error) {
                      setPageError(error instanceof Error ? error.message : t(language, "appointments.create.failedCreate"));
                    } finally {
                      setSubmitLoading(false);
                    }
                  }
                }}
              >
                {t(language, "appointments.create.confirm")}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
