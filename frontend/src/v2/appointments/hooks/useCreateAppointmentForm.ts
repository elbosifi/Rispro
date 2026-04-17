import { useMemo, useState } from "react";
import type { CapacityResolutionMode } from "../types";

export interface SelectedPatient {
  id: number;
  arabicFullName: string;
  englishFullName?: string | null;
  nationalId?: string | null;
  mrn?: string | null;
  sex?: string | null;
  ageYears?: number | null;
  demographicsEstimated?: boolean;
}

export interface CreateAppointmentFormModel {
  patientId: number | null;
  patient: SelectedPatient | null;
  modalityId: number | null;
  examTypeId: number | null;
  caseCategory: "oncology" | "non_oncology";
  appointmentDate: string;
  notes: string;
  reportingPriorityId: number | null;
  isWalkIn: boolean;
  capacityResolutionMode: CapacityResolutionMode;
  specialReasonCode: string;
  specialReasonNote: string;
  overrideRequired: boolean;
  overrideReason: string;
}

const DEFAULT_FORM: CreateAppointmentFormModel = {
  patientId: null,
  patient: null,
  modalityId: null,
  examTypeId: null,
  caseCategory: "non_oncology",
  appointmentDate: "",
  notes: "",
  reportingPriorityId: null,
  isWalkIn: false,
  capacityResolutionMode: "standard",
  specialReasonCode: "",
  specialReasonNote: "",
  overrideRequired: false,
  overrideReason: "",
};

export function useCreateAppointmentForm() {
  const [form, setForm] = useState<CreateAppointmentFormModel>(DEFAULT_FORM);

  const actions = useMemo(() => ({
    setPatient(patient: SelectedPatient | null) {
      setForm((prev) => ({
        ...prev,
        patientId: patient?.id ?? null,
        patient,
        modalityId: null,
        examTypeId: null,
        appointmentDate: "",
        notes: "",
        capacityResolutionMode: "standard",
        specialReasonCode: "",
        specialReasonNote: "",
        overrideRequired: false,
        overrideReason: "",
      }));
    },
    setModalityId(modalityId: number | null) {
      setForm((prev) => ({
        ...prev,
        modalityId,
        examTypeId: null,
        appointmentDate: "",
        capacityResolutionMode: "standard",
        specialReasonCode: "",
        specialReasonNote: "",
        overrideRequired: false,
        overrideReason: "",
      }));
    },
    setExamTypeId(examTypeId: number | null) {
      setForm((prev) => ({
        ...prev,
        examTypeId,
        appointmentDate: "",
        overrideRequired: false,
        overrideReason: "",
      }));
    },
    setCaseCategory(caseCategory: "oncology" | "non_oncology") {
      setForm((prev) => ({
        ...prev,
        caseCategory,
        appointmentDate: "",
        overrideRequired: false,
        overrideReason: "",
      }));
    },
    setAppointmentDate(appointmentDate: string, overrideRequired: boolean) {
      setForm((prev) => ({
        ...prev,
        appointmentDate,
        overrideRequired,
        overrideReason: overrideRequired ? prev.overrideReason : "",
      }));
    },
    setNotes(notes: string) {
      setForm((prev) => ({ ...prev, notes }));
    },
    setCapacityResolutionMode(capacityResolutionMode: CapacityResolutionMode) {
      setForm((prev) => ({
        ...prev,
        capacityResolutionMode,
        specialReasonCode:
          capacityResolutionMode === "special_quota_extra" ? prev.specialReasonCode : "",
        specialReasonNote:
          capacityResolutionMode === "special_quota_extra" ? prev.specialReasonNote : "",
      }));
    },
    setSpecialReasonCode(specialReasonCode: string) {
      setForm((prev) => ({ ...prev, specialReasonCode }));
    },
    setSpecialReasonNote(specialReasonNote: string) {
      setForm((prev) => ({ ...prev, specialReasonNote }));
    },
    setOverrideReason(overrideReason: string) {
      setForm((prev) => ({ ...prev, overrideReason }));
    },
    setReportingPriorityId(reportingPriorityId: number | null) {
      setForm((prev) => ({ ...prev, reportingPriorityId }));
    },
    setIsWalkIn(isWalkIn: boolean) {
      setForm((prev) => ({ ...prev, isWalkIn }));
    },
    clearAfterSuccess() {
      setForm((prev) => ({
        ...DEFAULT_FORM,
        patientId: prev.patientId,
        patient: prev.patient,
      }));
    },
    resetAll() {
      setForm(DEFAULT_FORM);
    },
  }), []);

  return { form, setForm, actions };
}
