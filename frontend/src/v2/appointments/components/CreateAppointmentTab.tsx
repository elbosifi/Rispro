import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pushToast } from "@/lib/toast";
import { fetchAppointments } from "@/lib/api-hooks";
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
import { PatientSummaryCard } from "./PatientSummaryCard";
import { ModalitySelect } from "./ModalitySelect";
import { ExamTypeSelect } from "./ExamTypeSelect";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { SpecialQuotaSection } from "./SpecialQuotaSection";
import { SupervisorOverrideModal } from "./SupervisorOverrideModal";
import { AppointmentSuccessState } from "./AppointmentSuccessState";

interface CreateAppointmentTabProps {
  patientLookups: unknown;
  modalityOptions: ModalityDto[];
  examTypeOptions: ExamTypeDto[];
  specialReasonOptions: SpecialReasonCodeDto[];
  priorityOptions: Array<{ id: number; nameEn: string; nameAr: string }>;
  schedulingEngineEnabled: boolean;
  canUseNonStandardCapacityModes?: boolean;
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
}

const AVAILABILITY_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  initialSelectedPatient = null,
  onCreateAppointment,
  onEvaluateAvailability,
}: CreateAppointmentTabProps) {
  const { form, actions } = useCreateAppointmentForm();
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
  const [patientNoShows, setPatientNoShows] = useState<Array<{ id: number; appointmentDate: string; examTypeName: string; status: string }>>([]);
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [availabilityOffset, setAvailabilityOffset] = useState(0);
  const [showFullDays, setShowFullDays] = useState(false);
  const pendingDecisionRef = useRef<SchedulingDecisionDto | null>(null);
  const initialPatientAppliedRef = useRef(false);

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
  const safetyMessage = selectedModality?.safetyWarningEn || selectedModality?.safetyWarningAr || "";

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
  const selectedRawItem = (availability.rawItems ?? []).find((item) => item.date === form.appointmentDate) ?? null;
  const primaryExamMixBlocking =
    selectedRawItem?.examMixQuotaSummaries?.find((row) => row.isPrimaryBlocking) ?? null;
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
            examTypeName: appointment.examNameEn || appointment.examNameAr || "—",
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
  }, [form.patientId]);

  function handleSelectAvailabilityRow(row: AvailabilityRowViewModel) {
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
    if (!form.patientId) return "Missing patient";
    if (!form.modalityId) return "Missing modality";
    if (!form.examTypeId) return "Missing exam type";
    if (!form.appointmentDate) return "Selected date unavailable";
    if (form.capacityResolutionMode === "special_quota_extra" && !form.specialReasonCode) {
      return "Special reason code required";
    }
    if (form.capacityResolutionMode === "special_quota_extra" && !form.specialReasonConfirmed) {
      return "Confirm special reason selection";
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
      override,
    };

    const response = await onCreateAppointment(request);
    const modalityName = modalityOptions.find((m) => m.id === form.modalityId)?.name || "—";
    const examTypeName = effectiveExamTypes.find((et) => et.id === form.examTypeId)?.name || null;
    setSuccess({
      bookingId: response.booking.id,
      patientId: form.patientId,
      patientName: form.patient?.englishFullName || form.patient?.arabicFullName || `Patient #${form.patientId}`,
      bookingDate: response.booking.bookingDate,
      modalityName,
      examTypeName,
      wasOverride: response.wasOverride,
    });

    if (decision.consumedCapacityMode === "special") {
      pushToast({
        type: "success",
        title: "Special quota consumed",
        message: "Booking saved with special quota justification metadata.",
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
        setPageError("Availability changed before save");
        return;
      }

      if (decision.displayStatus === "blocked" && !decision.requiresSupervisorOverride) {
        setPageError("Selected date unavailable");
        return;
      }

      if (decision.requiresSupervisorOverride || decision.displayStatus === "restricted") {
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
      setPageError(error instanceof Error ? error.message : "Failed to create appointment");
    } finally {
      setSubmitLoading(false);
    }
  }

  async function handleOverrideConfirm(payload: { supervisorUsername: string; supervisorPassword: string; overrideReason: string }) {
    setOverrideLoading(true);
    setOverrideError(null);

    try {
      if (!pendingDecision) {
        setOverrideError("Availability must be evaluated before override.");
        return;
      }

      if (!payload.overrideReason.trim()) {
        setOverrideError("Override reason required");
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
      setOverrideError(error instanceof Error ? `Supervisor authentication failed: ${error.message}` : "Supervisor authentication failed");
    } finally {
      setOverrideLoading(false);
    }
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto">
        <AppointmentSuccessState
          appointmentSummary={success}
          onPrintSlip={() => navigate(`/print?appointmentId=${success.bookingId}&autoprint=1`)}
          onViewDetails={() => navigate(`/print?appointmentId=${success.bookingId}`)}
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
    <div className="space-y-6">
      <div className="card-shell p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="font-bold" style={{ color: "var(--text-muted)" }}>Patient:</span>{" "}
            <span style={{ color: "var(--text)" }}>{form.patient?.englishFullName ?? form.patient?.arabicFullName ?? "—"}</span>
          </div>
          <div>
            <span className="font-bold" style={{ color: "var(--text-muted)" }}>Modality:</span>{" "}
            <span style={{ color: "var(--text)" }}>{selectedModality?.name ?? "—"}</span>
          </div>
          <div>
            <span className="font-bold" style={{ color: "var(--text-muted)" }}>Exam Type:</span>{" "}
            <span style={{ color: "var(--text)" }}>{effectiveExamTypes.find((et) => et.id === form.examTypeId)?.name ?? "—"}</span>
          </div>
          <div>
            <span className="font-bold" style={{ color: "var(--text-muted)" }}>Category:</span>{" "}
            <span style={{ color: "var(--text)" }}>{form.caseCategory === "oncology" ? "Oncology" : "Non-oncology"}</span>
          </div>
          <div>
            <span className="font-bold" style={{ color: "var(--text-muted)" }}>Date:</span>{" "}
            <span style={{ color: "var(--text)" }}>{form.appointmentDate || "—"}</span>
          </div>
          <div>
            <span className="font-bold" style={{ color: "var(--text-muted)" }}>Exam mix:</span>{" "}
            <span style={{ color: "var(--text)" }}>
              {primaryExamMixBlocking
                ? `${primaryExamMixBlocking.title ?? `Group #${primaryExamMixBlocking.ruleId}`} ${primaryExamMixBlocking.consumed}/${primaryExamMixBlocking.dailyLimit}`
                : "No matching group"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-shell p-4">
          <h3 className="text-lg font-bold mb-4 text-embossed" style={{ color: "var(--text)" }}>Evaluated Availability</h3>
          <AvailabilityPanel
            rows={availability.rows}
            selectedDate={form.appointmentDate}
            onSelectDate={handleSelectAvailabilityRow}
            loading={availability.isLoading}
            showFullDays={showFullDays}
            onToggleShowFullDays={() => setShowFullDays((current) => !current)}
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
                ? "No evaluated availability rows returned by backend evaluator."
                : "Select patient, modality, and exam type to load evaluated availability."
            }
          />
        </div>

        <div className="card-shell p-4 lg:sticky lg:top-4 h-fit">
          <PatientSearchSection
            value={form.patient}
            onSelectPatient={(patient: SelectedPatient) => {
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

          <div className="mt-4">
            <PatientSummaryCard patient={form.patient} caseCategory={form.caseCategory} />
          </div>

          {form.patientId != null && patientNoShows.length > 0 && (
            <div className="card-shell p-4 mt-4" style={{ background: "rgba(245, 158, 11, 0.1)" }}>
              <div className="text-xs uppercase tracking-[0.08em] font-bold mb-2" style={{ color: "var(--amber)" }}>
                Previous No-Shows / Cancelled
              </div>
              {noShowLoading ? (
                <div className="text-sm" style={{ color: "var(--amber)" }}>Loading no-show history...</div>
              ) : (
                <ul className="space-y-1">
                  {patientNoShows.map((item) => (
                    <li key={item.id} className="text-sm font-mono-data" style={{ color: "var(--text-muted)" }}>
                      {item.appointmentDate} — {item.examTypeName} ({item.status})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-4 mt-4">
            <ModalitySelect
              options={modalityOptions}
              value={form.modalityId}
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
              onChange={(value) => {
                actions.setExamTypeId(value);
                setAvailabilitySelectedRow(null);
              }}
              disabled={!schedulingEngineEnabled || !form.modalityId}
            />

            <div>
              <label className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data" style={{ color: "var(--text-muted)" }}>
                Case Category
              </label>
              <select
                aria-label="Case Category"
                value={form.caseCategory}
                onChange={(e) => actions.setCaseCategory(e.target.value as "oncology" | "non_oncology")}
                className="input-premium"
              >
                <option value="non_oncology">Non-Oncology</option>
                <option value="oncology">Oncology</option>
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data" style={{ color: "var(--text-muted)" }}>
                Priority
              </label>
              <select
                aria-label="Priority"
                value={form.reportingPriorityId ?? ""}
                onChange={(e) => actions.setReportingPriorityId(e.target.value ? Number(e.target.value) : null)}
                className="input-premium"
              >
                <option value="" hidden>Routine (default)</option>
                {filteredPriorityOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.nameEn}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer user-select-none">
              <input
                type="checkbox"
                id="isWalkIn"
                checked={form.isWalkIn}
                onChange={(e) => actions.setIsWalkIn(e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-[var(--accent)]"
              />
              <span className="text-sm" style={{ color: "var(--text)" }}>Walk-in patient</span>
            </label>

            <div>
              <label className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data" style={{ color: "var(--text-muted)" }}>
                Appointment Date
              </label>
              <input
                aria-label="Appointment Date"
                type="date"
                value={form.appointmentDate}
                onChange={(e) => actions.setAppointmentDate(e.target.value, form.overrideRequired)}
                className="input-premium"
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-[0.08em] mb-2 font-mono-data" style={{ color: "var(--text-muted)" }}>
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => actions.setNotes(e.target.value)}
                rows={3}
                className="input-premium"
              />
            </div>

            <SpecialQuotaSection
              capacityResolutionMode={form.capacityResolutionMode}
              onChangeCapacityResolutionMode={(mode) => {
                if (mode === "special_quota_extra" && !hasSpecialQuotaAvailable) return;
                actions.setCapacityResolutionMode(mode);
              }}
              specialQuotaAvailable={hasSpecialQuotaAvailable}
              supervisorMode={canUseNonStandardCapacityModes}
              specialReasonCode={form.specialReasonCode}
              onChangeSpecialReasonCode={actions.setSpecialReasonCode}
              specialReasonConfirmed={form.specialReasonConfirmed}
              onChangeSpecialReasonConfirmed={actions.setSpecialReasonConfirmed}
              specialReasonNote={form.specialReasonNote}
              onChangeSpecialReasonNote={actions.setSpecialReasonNote}
              options={specialReasonOptions}
            />

            {form.overrideRequired && (
              <div className="text-sm font-mono-data" style={{ color: "var(--amber)" }}>
                Selected date requires supervisor override.
              </div>
            )}

            {pageError && (
              <div className="card-shell p-3" style={{ background: "rgba(255, 71, 87, 0.1)", color: "var(--accent)" }}>
                <span className="text-sm">{pageError}</span>
              </div>
            )}

            <div className="flex justify-end gap-4 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  actions.resetAll();
                  setSafetyAcknowledged(false);
                  setShowSafetyModal(false);
                }}
                disabled={submitLoading}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={runSubmitFlow}
                disabled={submitLoading || !schedulingEngineEnabled}
              >
                {submitLoading ? "Creating..." : "Create Appointment"}
              </button>
            </div>
          </div>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) setShowSafetyModal(false); }}>
          <div className="card-shell p-6 max-w-md">
            <h3 className="text-lg font-bold mb-4" style={{ color: "var(--amber)" }}>Safety Confirmation</h3>
            <p className="text-sm mb-4" style={{ color: "var(--amber)" }}>{safetyMessage}</p>
            <p className="text-sm mb-6" style={{ color: "var(--text)" }}>
              Have you confirmed this patient has no contraindications for {selectedModality?.name}?
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => setShowSafetyModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
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
                      setPageError(error instanceof Error ? error.message : "Failed to create appointment");
                    } finally {
                      setSubmitLoading(false);
                    }
                  }
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
