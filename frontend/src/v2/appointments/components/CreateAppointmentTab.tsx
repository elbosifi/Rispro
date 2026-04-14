import { useMemo, useState } from "react";
import { pushToast } from "@/lib/toast";
import type {
  BookingResponse,
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
  schedulingEngineEnabled: boolean;
  onCreateAppointment: (input: CreateBookingRequest) => Promise<BookingResponse>;
  onEvaluateAvailability: (input: {
    patientId: number;
    modalityId: number;
    examTypeId: number | null;
    scheduledDate: string;
    caseCategory: "oncology" | "non_oncology";
    useSpecialQuota: boolean;
    specialReasonCode: string | null;
    includeOverrideEvaluation: boolean;
  }) => Promise<SchedulingDecisionDto>;
  onSupervisorOverride: (input: {
    supervisorUsername: string;
    supervisorPassword: string;
    overrideReason: string;
  }) => Promise<{ ok: boolean; message?: string }>;
}

interface SuccessSummary {
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
  schedulingEngineEnabled,
  onCreateAppointment,
  onEvaluateAvailability,
  onSupervisorOverride,
}: CreateAppointmentTabProps) {
  const { form, actions } = useCreateAppointmentForm();
  const [availabilitySelectedRow, setAvailabilitySelectedRow] = useState<AvailabilityRowViewModel | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<SchedulingDecisionDto | null>(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [success, setSuccess] = useState<SuccessSummary | null>(null);

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
    caseCategory: "non_oncology",
    useSpecialQuota: form.useSpecialQuota,
    specialReasonCode: form.specialReasonCode || null,
  });

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
    if (form.useSpecialQuota && !form.specialReasonCode) return "Special reason code required";
    return null;
  }

  async function createWithDecision(decision: SchedulingDecisionDto, override?: CreateBookingRequest["override"]) {
    const request: CreateBookingRequest = {
      patientId: form.patientId as number,
      modalityId: form.modalityId as number,
      examTypeId: form.examTypeId,
      reportingPriorityId: null,
      bookingDate: form.appointmentDate,
      bookingTime: null,
      caseCategory: "non_oncology",
      useSpecialQuota: form.useSpecialQuota,
      specialReasonCode: form.useSpecialQuota ? form.specialReasonCode || null : null,
      notes: form.notes.trim() || null,
      override,
    };

    const response = await onCreateAppointment(request);
    const modalityName = modalityOptions.find((m) => m.id === form.modalityId)?.name || "—";
    const examTypeName = effectiveExamTypes.find((et) => et.id === form.examTypeId)?.name || null;
    setSuccess({
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
        caseCategory: "non_oncology",
        useSpecialQuota: form.useSpecialQuota,
        specialReasonCode: form.useSpecialQuota ? form.specialReasonCode || null : null,
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
      const auth = await onSupervisorOverride(payload);
      if (!auth.ok) {
        setOverrideError(auth.message || "Supervisor authentication failed");
        return;
      }

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
        onPrintSlip={() => pushToast({ type: "info", title: "Print", message: "Print flow can be connected to print page." })}
        onViewDetails={() => pushToast({ type: "info", title: "Details", message: "Detail navigation can be connected in rollout." })}
        onCreateAnother={() => {
          setSuccess(null);
          actions.clearAfterSuccess();
          setAvailabilitySelectedRow(null);
          setPageError(null);
        }}
      />
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 16 }}>
      <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 10, padding: 16, display: "grid", gap: 12 }}>
        <PatientSearchSection
          value={form.patient}
          onSelectPatient={(patient: SelectedPatient) => {
            actions.setPatient(patient);
            setAvailabilitySelectedRow(null);
            setPageError(null);
          }}
          onClearPatient={() => {
            actions.setPatient(null);
            setAvailabilitySelectedRow(null);
            setPageError(null);
          }}
        />

        <PatientSummaryCard patient={form.patient} />

        <ModalitySelect
          options={modalityOptions}
          value={form.modalityId}
          onChange={(value) => {
            actions.setModalityId(value);
            setAvailabilitySelectedRow(null);
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
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Appointment Date</label>
          <input
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
          enabled={form.useSpecialQuota}
          onToggle={actions.setUseSpecialQuota}
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
          <button type="button" onClick={() => actions.resetAll()} disabled={submitLoading}>Reset</button>
          <button type="button" onClick={runSubmitFlow} disabled={submitLoading || !schedulingEngineEnabled}>
            {submitLoading ? "Creating..." : "Create Appointment"}
          </button>
        </div>
      </div>

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
    </div>
  );
}
