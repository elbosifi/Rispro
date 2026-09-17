import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import PatientsPage from "./patients-page";
import { PATIENTS_SEARCH_STORAGE_KEY } from "@/lib/navigation/patient-navigation";

const api = vi.hoisted(() => ({ fetchPatientDirectory: vi.fn() }));
vi.mock("@/lib/api-hooks", () => api);
vi.mock("@/components/patients/patient-drawer", () => ({
  PatientDrawer: ({ patientId, onClose }: { patientId: number; onClose: () => void }) => <aside data-testid="patient-drawer">Patient {patientId}<button onClick={onClose}>Close drawer</button></aside>,
}));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("@/lib/appointment-printing", () => ({ printAppointmentSlipById: vi.fn() }));

const patient = {
  id: 55, mrn: "MRN-55", arabicFullName: "Test Patient", englishFullName: "Test Patient", sex: "male", ageYears: 45,
  demographicsEstimated: false, phone1: "0910000000", category: "oncology", lastAppointment: null, nextAppointment: null,
  warnings: { missingPhone: false, missingDob: false, missingSex: false, missingName: false, noAppointment: true, possibleDuplicate: false, duplicateReasons: [] },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(entry: string) {
  api.fetchPatientDirectory.mockResolvedValue({ patients: [patient], pagination: { page: 2, pageSize: 25, total: 60, totalPages: 3 } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PatientsPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("PatientsPage URL navigation", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    api.fetchPatientDirectory.mockReset();
  });

  afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

  it("initializes controls from URL and updates filters/page without retaining local navigation state", async () => {
    window.sessionStorage.setItem(PATIENTS_SEARCH_STORAGE_KEY, "ahmed");
    renderPage("/patients?category=oncology&appointment=has_future&sex=male&ageMin=40&ageMax=70&sort=name&page=2");
    await screen.findAllByText("Test Patient");
    expect((screen.getByPlaceholderText("Search patients by name, national ID, MRN, or phone...") as HTMLInputElement).value).toBe("ahmed");
    expect((screen.getByLabelText("Category:") as HTMLSelectElement).value).toBe("oncology");
    expect((screen.getByLabelText("Appointments:") as HTMLSelectElement).value).toBe("has_future");
    expect((screen.getByLabelText("Sex:") as HTMLSelectElement).value).toBe("male");

    fireEvent.click(screen.getByRole("button", { name: /^Next$/ }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("page=3"));

    fireEvent.change(screen.getByLabelText("Category:"), { target: { value: "non_oncology" } });
    fireEvent.change(screen.getByLabelText("Sex:"), { target: { value: "female" } });
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("category=non_oncology"));
    expect(screen.getByTestId("location").textContent).toContain("sex=female");

    fireEvent.change(screen.getByPlaceholderText("Search patients by name, national ID, MRN, or phone..."), { target: { value: "ali" } });
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("q="));
    expect(screen.getByTestId("location").textContent).toContain("category=non_oncology");
    expect(window.sessionStorage.getItem(PATIENTS_SEARCH_STORAGE_KEY)).toBe("ali");
    expect(screen.getByTestId("location").textContent).not.toContain("page=2");

    fireEvent.change(screen.getByPlaceholderText("Search patients by name, national ID, MRN, or phone..."), { target: { value: "" } });
    await waitFor(() => expect(window.sessionStorage.getItem(PATIENTS_SEARCH_STORAGE_KEY)).toBeNull());
    expect(screen.getByTestId("location").textContent).not.toContain("q=");
  });

  it("sanitizes a legacy q URL without adopting or storing its sensitive value", async () => {
    renderPage("/patients?q=SENSITIVE_VALUE&category=oncology");

    const search = await screen.findByPlaceholderText("Search patients by name, national ID, MRN, or phone...");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/patients?category=oncology"));
    expect((search as HTMLInputElement).value).toBe("");
    expect(window.sessionStorage.getItem(PATIENTS_SEARCH_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("location").textContent).not.toContain("SENSITIVE_VALUE");
  });

  it("restores private search text across drawer navigation while keeping it out of the URL", async () => {
    window.sessionStorage.setItem(PATIENTS_SEARCH_STORAGE_KEY, "Ahmed");
    const { container } = renderPage("/patients?category=oncology&page=2");
    const search = await screen.findByPlaceholderText("Search patients by name, national ID, MRN, or phone...");
    await screen.findAllByText("Test Patient");

    expect((search as HTMLInputElement).value).toBe("Ahmed");
    fireEvent.click(container.querySelector('[data-patient-id="55"]')!);
    await screen.findByTestId("patient-drawer");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/patients?category=oncology&page=2&patientId=55"));
    expect(screen.getByTestId("location").textContent).not.toContain("Ahmed");
    expect((search as HTMLInputElement).value).toBe("Ahmed");

    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/patients?category=oncology&page=2"));
    expect((screen.getByPlaceholderText("Search patients by name, national ID, MRN, or phone...") as HTMLInputElement).value).toBe("Ahmed");
    expect(window.sessionStorage.getItem(PATIENTS_SEARCH_STORAGE_KEY)).toBe("Ahmed");
  });

  it("opens the drawer from patientId and closes it without removing unrelated filters", async () => {
    window.sessionStorage.setItem(PATIENTS_SEARCH_STORAGE_KEY, "ali");
    const { container } = renderPage("/patients?category=oncology&page=2&patientId=55");
    expect((await screen.findByTestId("patient-drawer")).textContent).toContain("Patient 55");
    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    await waitFor(() => expect(screen.queryByTestId("patient-drawer")).toBeNull());
    expect(screen.getByTestId("location").textContent).toBe("/patients?category=oncology&page=2");
    expect((screen.getByPlaceholderText("Search patients by name, national ID, MRN, or phone...") as HTMLInputElement).value).toBe("ali");

    fireEvent.click(container.querySelector('[data-patient-id="55"]')!);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("patientId=55"));
  });

  it("restores the selected row into the app scroll container after the drawer closes", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    window.sessionStorage.setItem(PATIENTS_SEARCH_STORAGE_KEY, "ali");
    const { container } = renderPage("/patients");
    await screen.findAllByText("Test Patient");
    fireEvent.click(container.querySelector('[data-patient-id="55"]')!);
    await screen.findByTestId("patient-drawer");
    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }));
  });
});
