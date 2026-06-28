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

  it("preserves manual case-category override after other form changes", () => {
    const { result } = renderHook(() => useCreateAppointmentForm());

    act(() => {
      result.current.actions.setPatient({
        id: 1,
        arabicFullName: "Test Patient",
        category: "oncology",
      });
    });

    act(() => {
      result.current.actions.setCaseCategory("non_oncology");
    });

    act(() => {
      result.current.actions.setModalityId(2);
      result.current.actions.setExamTypeId(11);
      result.current.actions.setNotes("manual note");
    });

    expect(result.current.form.caseCategory).toBe("non_oncology");
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

  it("updates report-required default on category change until manual override", () => {
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
      result.current.actions.setCaseCategory("oncology");
    });
    expect(result.current.form.requiresReport).toBe(true);

    act(() => {
      result.current.actions.setRequiresReport(false);
    });
    act(() => {
      result.current.actions.setCaseCategory("non_oncology");
    });
    act(() => {
      result.current.actions.setCaseCategory("oncology");
    });
    expect(result.current.form.requiresReport).toBe(false);
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
});
