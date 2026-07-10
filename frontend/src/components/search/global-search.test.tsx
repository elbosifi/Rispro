import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { GlobalSearch } from "./global-search";

const api = vi.hoisted(() => ({ searchPatients: vi.fn(), fetchAppointments: vi.fn() }));
vi.mock("@/lib/api-hooks", () => api);
vi.mock("@/components/patients/patient-category-badge", () => ({ PatientCategoryBadge: () => null }));

const patient = { id: 1, arabicFullName: "مريض تجريبي", englishFullName: "Test Patient", mrn: "MRN-1", nationalId: "N-1", phone1: "0910000000", ageYears: 30, sex: "male" };
const registration = { id: 7, patientId: 1, accessionNumber: "V2-000123", appointmentDate: "2026-07-10", modalityNameAr: "أشعة", modalityNameEn: "CT", examNameAr: "صدر", examNameEn: "CT Chest", arabicFullName: "مريض تجريبي", englishFullName: "Test Patient", status: "scheduled" };

function renderSearch(props: Partial<ComponentProps<typeof GlobalSearch>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><GlobalSearch language="en" isRtl={false} canSearchPatients canSearchRegistrations onPatientSelect={vi.fn()} onRegistrationSelect={vi.fn()} {...props} /></QueryClientProvider>);
}

describe("GlobalSearch", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("debounces authorized patient and registration searches, groups and limits results", async () => {
    api.searchPatients.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({ ...patient, id: index + 1, mrn: `MRN-${index}` })));
    api.fetchAppointments.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({ ...registration, id: index + 1, accessionNumber: `V2-${index}` })));
    renderSearch();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 300)); });
    expect(api.searchPatients).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "ab" } });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 300)); });
    await waitFor(() => expect(api.searchPatients).toHaveBeenCalledWith("ab"));
    expect(api.fetchAppointments).toHaveBeenCalledWith({ q: "ab" });
    await waitFor(() => expect(within(screen.getAllByRole("listbox")[0]).getAllByRole("option")).toHaveLength(10));
    expect(within(screen.getAllByRole("listbox")[0]).getByText("Patients")).toBeTruthy();
    expect(within(screen.getAllByRole("listbox")[0]).getByText("Registrations")).toBeTruthy();
  });

  it("selects a patient without navigation, supports keyboard selection, Escape, and outside close", async () => {
    api.searchPatients.mockResolvedValue([patient]);
    api.fetchAppointments.mockResolvedValue([registration]);
    const onPatientSelect = vi.fn();
    renderSearch({ onPatientSelect });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "test" } });
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPatientSelect).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getAllByRole("listbox").length).toBeGreaterThan(0));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.focus(input);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not fetch or display inaccessible result types and renders failures safely", async () => {
    api.fetchAppointments.mockRejectedValue(new Error("unavailable"));
    renderSearch({ canSearchPatients: false, canSearchRegistrations: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "test" } });
    await waitFor(() => expect(api.fetchAppointments).toHaveBeenCalledWith({ q: "test" }));
    expect(api.searchPatients).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText(/could not be completed/i).length).toBeGreaterThan(0));
  });

  it("uses RTL alignment and opens the mobile trigger", async () => {
    renderSearch({ language: "ar", isRtl: true, canSearchPatients: false, canSearchRegistrations: false });
    fireEvent.click(screen.getByRole("button", { name: "البحث عن المرضى أو التسجيلات" }));
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("listbox").at(-1)?.className).toContain("text-right");
  });
});
