import { useMemo, useState } from "react";
import type { CapacityResolutionMode } from "../types";

export interface SelectedPatient {
  id: number;
  arabicFullName: string;
  englishFullName?: string | null;
  category?: "oncology" | "non_oncology" | null;
  identifierType?: string | null;
  identifierValue?: string | null;
  nationalId?: string | null;
  mrn?: string | null;
  sex?: string | null;
  ageYears?: number | null;
  demographicsEstimated?: boolean;
  phone1?: string | null;
  estimatedDateOfBirth?: string | null;
  identityRisk?: "none" | "ambiguous";
  similarPatientCount?: number;
  availableVerificationMethods?: Array<"primary_identifier" | "exact_dob" | "phone_suffix">;
  patientIdentityVerificationProof?: string | null;
  patientIdentityVerificationMethod?: "primary_identifier" | "exact_dob" | "phone_suffix" | null;
  patientIdentitySelectionSource?: "search" | "url_preselect";
}

export interface CreateAppointmentFormModel {
  patientId: number | null;
  patient: SelectedPatient | null;
  modalityId: number | null;
  examTypeId: number | null;
  caseCategory: "oncology" | "non_oncology";
  requiresReport: boolean;
  reportRequiredManuallyOverridden: boolean;
  appointmentDate: string;
  notes: string;
  reportingPriorityId: number | null;
  intendedReportingDoctorId: number | null;
  intendedReportingDoctorReason: string;
  isWalkIn: boolean;
  capacityResolutionMode: CapacityResolutionMode;
  specialReasonCode: string;
  specialReasonConfirmed: boolean;
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
  requiresReport: false,
  reportRequiredManuallyOverridden: false,
  appointmentDate: "",
  notes: "",
  reportingPriorityId: null,
  intendedReportingDoctorId: null,
  intendedReportingDoctorReason: "",
  isWalkIn: false,
  capacityResolutionMode: "standard",
  specialReasonCode: "",
  specialReasonConfirmed: false,
  specialReasonNote: "",
  overrideRequired: false,
  overrideReason: "",
};

export function useCreateAppointmentForm(reportDefaults = { oncology: true, nonOncology: false }) {
  const [form, setForm] = useState<CreateAppointmentFormModel>(DEFAULT_FORM);

  const actions = useMemo(() => ({
    initializeComplementaryRecall(patient: SelectedPatient, modalityId: number, examTypeId: number, requiresReport = false) {
      const defaultCategory = patient.category === "oncology" ? "oncology" : "non_oncology";
      setForm((prev) => ({ ...prev, patientId: patient.id, patient: { ...patient, patientIdentitySelectionSource: "url_preselect" }, modalityId, examTypeId, caseCategory: defaultCategory, requiresReport, reportRequiredManuallyOverridden: false, appointmentDate: "", notes: "", capacityResolutionMode: "standard", specialReasonCode: "", specialReasonConfirmed: false, specialReasonNote: "", intendedReportingDoctorId: null, intendedReportingDoctorReason: "", overrideRequired: false, overrideReason: "" }));
    },
    setPatient(patient: SelectedPatient | null) {
      const defaultCategory =
        patient?.category === "oncology" || patient?.category === "non_oncology"
          ? patient.category
          : "non_oncology";
      const defaultRequiresReport =
        defaultCategory === "oncology" ? reportDefaults.oncology : reportDefaults.nonOncology;
      setForm((prev) => ({
        ...prev,
        patientId: patient?.id ?? null,
        patient: patient ? { ...patient, patientIdentityVerificationProof: patient.patientIdentityVerificationProof ?? null, patientIdentityVerificationMethod: patient.patientIdentityVerificationMethod ?? null, patientIdentitySelectionSource: patient.patientIdentitySelectionSource ?? "search" } : null,
        caseCategory: defaultCategory,
        requiresReport: defaultRequiresReport,
        reportRequiredManuallyOverridden: false,
        modalityId: null,
        examTypeId: null,
        appointmentDate: "",
        notes: "",
        capacityResolutionMode: "standard",
        specialReasonCode: "",
        specialReasonConfirmed: false,
        specialReasonNote: "",
        intendedReportingDoctorId: null,
        intendedReportingDoctorReason: "",
        overrideRequired: false,
        overrideReason: "",
      }));
    },
    applyLockedPatientIdentityVerification(patient: SelectedPatient) {
      setForm((prev) => {
        if (!prev.patient || prev.patientId !== patient.id) return prev;
        return {
          ...prev,
          patient: {
            ...prev.patient,
            patientIdentityVerificationProof: patient.patientIdentityVerificationProof ?? prev.patient.patientIdentityVerificationProof ?? null,
            patientIdentityVerificationMethod: patient.patientIdentityVerificationMethod ?? prev.patient.patientIdentityVerificationMethod ?? null,
            patientIdentitySelectionSource: prev.patient.patientIdentitySelectionSource ?? patient.patientIdentitySelectionSource ?? "url_preselect",
          },
        };
      });
    },
    setModalityId(modalityId: number | null) {
      setForm((prev) => ({
        ...prev,
        modalityId,
        examTypeId: null,
        appointmentDate: "",
        capacityResolutionMode: "standard",
        specialReasonCode: "",
        specialReasonConfirmed: false,
        specialReasonNote: "",
        intendedReportingDoctorId: null,
        intendedReportingDoctorReason: "",
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
    setRequiresReport(requiresReport: boolean) {
      setForm((prev) => ({
        ...prev,
        requiresReport,
        reportRequiredManuallyOverridden: true,
        intendedReportingDoctorId: requiresReport ? prev.intendedReportingDoctorId : null,
        intendedReportingDoctorReason: requiresReport ? prev.intendedReportingDoctorReason : "",
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
        specialReasonConfirmed:
          capacityResolutionMode === "special_quota_extra" ? prev.specialReasonConfirmed : false,
        specialReasonNote:
          capacityResolutionMode === "special_quota_extra" ? prev.specialReasonNote : "",
      }));
    },
    setSpecialReasonCode(specialReasonCode: string) {
      setForm((prev) => ({
        ...prev,
        specialReasonCode,
        specialReasonConfirmed:
          specialReasonCode && specialReasonCode === prev.specialReasonCode
            ? prev.specialReasonConfirmed
            : false,
      }));
    },
    setSpecialReasonConfirmed(specialReasonConfirmed: boolean) {
      setForm((prev) => ({ ...prev, specialReasonConfirmed }));
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
    setIntendedReportingDoctorId(intendedReportingDoctorId: number | null) {
      setForm((prev) => ({ ...prev, intendedReportingDoctorId }));
    },
    setIntendedReportingDoctorReason(intendedReportingDoctorReason: string) {
      setForm((prev) => ({ ...prev, intendedReportingDoctorReason }));
    },
    setIsWalkIn(isWalkIn: boolean) {
      setForm((prev) => ({ ...prev, isWalkIn }));
    },
    clearAfterSuccess() {
      setForm((prev) => ({
        ...DEFAULT_FORM,
        patientId: prev.patientId,
        patient: prev.patient,
        caseCategory: prev.caseCategory,
        requiresReport:
          prev.caseCategory === "oncology" ? reportDefaults.oncology : reportDefaults.nonOncology,
      }));
    },
    resetAll() {
      setForm(DEFAULT_FORM);
    },
  }), [reportDefaults.nonOncology, reportDefaults.oncology]);

  return { form, setForm, actions };
}
