import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import EditPatientPage from "./edit-patient-page";
import { PATIENTS_SEARCH_STORAGE_KEY } from "@/lib/navigation/patient-navigation";

vi.mock("@/components/patients/patient-form", () => ({
  default: ({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) => <><button onClick={onCancel}>Cancel edit</button><button onClick={onSuccess}>Save edit</button></>,
}));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderEdit(entry: string) {
  return render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/patients/:id/edit" element={<EditPatientPage />} /><Route path="/patients" element={<LocationProbe />} /></Routes><LocationProbe /></MemoryRouter>);
}

describe("EditPatientPage returnTo", () => {
  it("returns to the validated prior directory context on cancel and header Back", () => {
    window.sessionStorage.setItem(PATIENTS_SEARCH_STORAGE_KEY, "ali");
    renderEdit("/patients/55/edit?returnTo=%2Fpatients%3Fq%3DSENSITIVE_VALUE%26category%3Doncology%26page%3D2%26patientId%3D55");
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.getAllByTestId("location")[0].textContent).toBe("/patients?category=oncology&page=2&patientId=55");
    expect(screen.getAllByTestId("location")[0].textContent).not.toContain("SENSITIVE_VALUE");
    expect(window.sessionStorage.getItem(PATIENTS_SEARCH_STORAGE_KEY)).toBe("ali");
  });

  it("falls back to Patients for an external returnTo", () => {
    renderEdit("/patients/55/edit?returnTo=https%3A%2F%2Fevil.example");
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.getAllByTestId("location")[0].textContent).toBe("/patients");
  });

  it("uses the same validated return target after a successful save", () => {
    renderEdit("/patients/55/edit?returnTo=%2Fpatients%3Fq%3DSENSITIVE_VALUE%26page%3D2");
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    expect(screen.getAllByTestId("location")[0].textContent).toBe("/patients?page=2");
  });
});
