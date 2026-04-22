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
});
