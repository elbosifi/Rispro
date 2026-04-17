import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pushToast } from "@/lib/toast";
import type {
  BookingResponse,
  CapacityResolutionMode,
  CreateBookingRequest,
  ExamTypeDto,
  ModalityDto,
  SchedulingDecisionDto,
  SpecialReasonCodeDto,
} from "../types";
import { useV2ExamTypes, useV2Suggestions } from "../api";
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
  patientName: string;
  bookingDate: string;
  modalityName: string;
  examTypeName?: string | null;
  wasOverride: boolean;
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
  });

  const suggestions = useV2Suggestions(
    form.modalityId != null && form.examTypeId != null && form.capacityResolutionMode === "standard"
      ? { modalityId: form.modalityId, days: 14, examTypeId: form.examTypeId, caseCategory: form.caseCategory }
      : undefined
  );
  const hasSpecialQuotaAvailable = (availability.rawItems ?? []).some(
    (item) =>
      item.date === form.appointmentDate &&
      (item.specialQuotaSummary?.remaining ?? 0) > 0
  );
  const selectedRawItem = (availability.rawItems ?? []).find((item) => item.date === form.appointmentDate) ?? null;
  const primaryExamMixBlocking =
    selectedRawItem?.examMixQuotaSummaries?.find((row) => row.isPrimaryBlocking) ?? null;
  useEffect(() => {
    if (
      form.capacityResolutionMode !== "standard" &&
      (!canUseNonStandardCapacityModes ||
        (form.capacityResolutionMode === "special_quota_extra" && !hasSpecialQuotaAvailable))
    ) {
      actions.setCapacityResolutionMode("standard");
    }
  }, [actions, form.capacityResolutionMode, hasSpecialQuotaAvailable, canUseNonStandardCapacityModes]);

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
      <AppointmentSuccessState
        appointmentSummary={success}
        onPrintSlip={() => navigate(`/print?source=v2&v2BookingId=${success.bookingId}&autoprint=1`)}
        onViewDetails={() => navigate(`/print?source=v2&v2BookingId=${success.bookingId}`)}
        onCreateAnother={() => {
          setSuccess(null);
          actions.clearAfterSuccess();
          setAvailabilitySelectedRow(null);
          setPageError(null);
          setSafetyAcknowledged(false);
          setShowSafetyModal(false);
        }}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          border: "1px solid var(--border-color, #e2e8f0)",
          borderRadius: 10,
          padding: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 8,
          fontSize: 12,
          background: "var(--bg-surface, #f8fafc)",
        }}
      >
        <div><strong>Patient:</strong> {form.patient?.englishFullName ?? form.patient?.arabicFullName ?? "—"}</div>
        <div><strong>Modality:</strong> {selectedModality?.name ?? "—"}</div>
        <div><strong>Exam Type:</strong> {effectiveExamTypes.find((et) => et.id === form.examTypeId)?.name ?? "—"}</div>
        <div><strong>Category:</strong> {form.caseCategory === "oncology" ? "Oncology" : "Non-oncology"}</div>
        <div><strong>Date:</strong> {form.appointmentDate || "—"}</div>
        <div>
          <strong>Exam mix:</strong>{" "}
          {primaryExamMixBlocking
            ? `${primaryExamMixBlocking.title ?? `Group #${primaryExamMixBlocking.ruleId}`} ${primaryExamMixBlocking.consumed}/${primaryExamMixBlocking.dailyLimit}`
            : "No matching group"}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 16 }}>
        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 10, padding: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>Evaluated Availability</h3>
          <AvailabilityPanel
            rows={availability.rows}
            selectedDate={form.appointmentDate}
            onSelectDate={handleSelectAvailabilityRow}
            loading={availability.isLoading}
            emptyMessage={
              availability.enabled
                ? "No evaluated availability rows returned by backend evaluator."
                : "Select patient, modality, and exam type to load evaluated availability."
            }
          />
          {form.modalityId != null && form.examTypeId != null && form.capacityResolutionMode === "standard" && (
            <div style={{ borderTop: "1px solid var(--border-color, #e2e8f0)", paddingTop: 12, marginTop: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 14 }}>Suggested Dates (Advisory)</h3>
              {suggestions.isLoading ? (
                <p style={{ color: "var(--text-muted, #64748b)", fontSize: 12 }}>Loading suggestions...</p>
              ) : suggestions.isError ? (
                <p style={{ color: "var(--color-error, #ef4444)", fontSize: 12 }}>Could not load suggestions.</p>
              ) : suggestions.data?.items.length ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {suggestions.data.items.slice(0, 5).map((s) => (
                    <li key={`${s.modalityId}-${s.date}`} style={{ marginBottom: 4, color: "var(--text-muted, #64748b)" }}>
                      {s.date} — {s.decision.displayStatus}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: "var(--text-muted, #64748b)", fontSize: 12 }}>No alternative dates found.</p>
              )}
            </div>
          )}
        </div>

        <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 10, padding: 16, display: "grid", gap: 12, position: "sticky", top: 12, alignSelf: "start", maxHeight: "calc(100vh - 24px)", overflow: "auto" }}>
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

        <PatientSummaryCard patient={form.patient} caseCategory={form.caseCategory} />

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
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Case Category</label>
          <select
            aria-label="Case Category"
            value={form.caseCategory}
            onChange={(e) => actions.setCaseCategory(e.target.value as "oncology" | "non_oncology")}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
          >
            <option value="non_oncology">Non-Oncology</option>
            <option value="oncology">Oncology</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Priority</label>
          <select
            aria-label="Priority"
            value={form.reportingPriorityId ?? ""}
            onChange={(e) => actions.setReportingPriorityId(e.target.value ? Number(e.target.value) : null)}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
          >
            <option value="">Normal</option>
            {priorityOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.nameEn}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            id="isWalkIn"
            checked={form.isWalkIn}
            onChange={(e) => actions.setIsWalkIn(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <label htmlFor="isWalkIn" style={{ fontSize: 13 }}>Walk-in patient</label>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Appointment Date</label>
          <input
            aria-label="Appointment Date"
            type="date"
            value={form.appointmentDate}
            onChange={(e) => actions.setAppointmentDate(e.target.value, form.overrideRequired)}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => actions.setNotes(e.target.value)}
            rows={3}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 6 }}
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
          specialReasonNote={form.specialReasonNote}
          onChangeSpecialReasonNote={actions.setSpecialReasonNote}
          options={specialReasonOptions}
        />

        {form.overrideRequired && (
          <div style={{ fontSize: 12, color: "#b45309" }}>Selected date requires supervisor override.</div>
        )}

        {pageError && (
          <div style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", fontSize: 12 }}>
            {pageError}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={() => { actions.resetAll(); setSafetyAcknowledged(false); setShowSafetyModal(false); }} disabled={submitLoading}>Reset</button>
          <button type="button" onClick={runSubmitFlow} disabled={submitLoading || !schedulingEngineEnabled}>
            {submitLoading ? "Creating..." : "Create Appointment"}
          </button>
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
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSafetyModal(false); }}
        >
          <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth: 400, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: "#b45309", marginBottom: 12 }}>Safety Confirmation</h3>
            <p style={{ fontSize: 14, color: "#b45309", marginBottom: 16 }}>{safetyMessage}</p>
            <p style={{ fontSize: 14, color: "#444", marginBottom: 20 }}>Have you confirmed this patient has no contraindications for {selectedModality?.name}?</p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                onClick={() => setShowSafetyModal(false)}
                style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
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
                style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#fff", fontWeight: 600, cursor: "pointer" }}
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
