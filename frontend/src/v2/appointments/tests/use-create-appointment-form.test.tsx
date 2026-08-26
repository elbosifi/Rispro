import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCreateAppointmentForm } from "../hooks/useCreateAppointmentForm";

describe("useCreateAppointmentForm", () => {
  it("defaults case category from selected patient category", () => {
    const { result } = renderHook(() => useCreateAppointmentForm());

    act(() => {
      result.current.actions.setPatient({
        id: 1,
        arabicFullName: "Test Patient",
        category: "oncology",
      });
    });

    expect(result.current.form.caseCategory).toBe("oncology");
  });

  it("keeps the selected patient's category after other form changes", () => {
    const { result } = renderHook(() => useCreateAppointmentForm());

    act(() => {
      result.current.actions.setPatient({
        id: 1,
        arabicFullName: "Test Patient",
        category: "oncology",
      });
    });

    act(() => {
      result.current.actions.setModalityId(2);
      result.current.actions.setExamTypeId(11);
      result.current.actions.setNotes("manual note");
    });

    expect(result.current.form.caseCategory).toBe("oncology");
  });

  it("falls back to non-oncology when patient category is missing", () => {
    const { result } = renderHook(() => useCreateAppointmentForm());

    act(() => {
      result.current.actions.setPatient({
        id: 2,
        arabicFullName: "Legacy Patient",
        category: null,
      });
    });

    expect(result.current.form.caseCategory).toBe("non_oncology");
  });

  it("defaults report required true for oncology and false for non-oncology", () => {
    const { result } = renderHook(() => useCreateAppointmentForm());

    act(() => {
      result.current.actions.setPatient({
        id: 3,
        arabicFullName: "Oncology Patient",
        category: "oncology",
      });
    });
    expect(result.current.form.requiresReport).toBe(true);

    act(() => {
      result.current.actions.setPatient({
        id: 4,
        arabicFullName: "Non Oncology Patient",
        category: "non_oncology",
      });
    });
    expect(result.current.form.requiresReport).toBe(false);
  });

  it("updates report-required default when the selected patient changes", () => {
    const { result } = renderHook(() => useCreateAppointmentForm());

    act(() => {
      result.current.actions.setPatient({
        id: 5,
        arabicFullName: "Test Patient",
        category: "non_oncology",
      });
    });
    expect(result.current.form.requiresReport).toBe(false);

    act(() => {
      result.current.actions.setPatient({
        id: 6,
        arabicFullName: "Oncology Patient",
        category: "oncology",
      });
    });
    expect(result.current.form.requiresReport).toBe(true);

    act(() => {
      result.current.actions.setRequiresReport(false);
    });
    act(() => {
      result.current.actions.setPatient({
        id: 7,
        arabicFullName: "Another Oncology Patient",
        category: "oncology",
      });
    });
    expect(result.current.form.requiresReport).toBe(true);
  });

  it("clears intended reporting doctor when modality changes or report is no longer required", () => {
    const { result } = renderHook(() => useCreateAppointmentForm({ oncology: true, nonOncology: true }));

    act(() => {
      result.current.actions.setPatient({
        id: 6,
        arabicFullName: "Report Patient",
        category: "oncology",
      });
    });
    act(() => {
      result.current.actions.setModalityId(1);
      result.current.actions.setIntendedReportingDoctorId(42);
      result.current.actions.setIntendedReportingDoctorReason("Workload plan");
    });
    expect(result.current.form.intendedReportingDoctorId).toBe(42);

    act(() => {
      result.current.actions.setModalityId(2);
    });
    expect(result.current.form.intendedReportingDoctorId).toBeNull();
    expect(result.current.form.intendedReportingDoctorReason).toBe("");

    act(() => {
      result.current.actions.setIntendedReportingDoctorId(43);
      result.current.actions.setIntendedReportingDoctorReason("Specific reader");
      result.current.actions.setRequiresReport(false);
    });
    expect(result.current.form.intendedReportingDoctorId).toBeNull();
    expect(result.current.form.intendedReportingDoctorReason).toBe("");
  });

  it("applies locked recall identity verification without changing scheduling fields", () => {
    const { result } = renderHook(() => useCreateAppointmentForm());
    act(() => {
      result.current.actions.initializeComplementaryRecall({ id: 9, arabicFullName: "Ambiguous", identityRisk: "ambiguous", patientIdentitySelectionSource: "url_preselect" }, 4, 12);
      result.current.actions.setAppointmentDate("2039-06-12", false);
      result.current.actions.applyLockedPatientIdentityVerification({ id: 9, arabicFullName: "Ambiguous", patientIdentityVerificationProof: "verified-proof", patientIdentityVerificationMethod: "exact_dob" });
    });
    expect(result.current.form.patientId).toBe(9);
    expect(result.current.form.patient?.patientIdentityVerificationProof).toBe("verified-proof");
    expect(result.current.form.patient?.patientIdentityVerificationMethod).toBe("exact_dob");
    expect(result.current.form.modalityId).toBe(4);
    expect(result.current.form.examTypeId).toBe(12);
    expect(result.current.form.appointmentDate).toBe("2039-06-12");
  });
});
