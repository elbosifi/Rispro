import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarPage from "./calendar-page";
import { CALENDAR_SEARCH_STORAGE_KEY } from "@/lib/navigation/calendar-navigation";

const fetchAppointmentsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
}));

vi.mock("@/v2/appointments/api", () => ({
  useV2Availability: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { role: "receptionist" } }),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/lib/appointment-printing", () => ({ printAppointmentSlipById: vi.fn() }));
vi.mock("@/lib/day-list-printing", () => ({ printDayListFromRoute: vi.fn() }));
vi.mock("./manage-day-dialog", () => ({ ManageDayDialog: () => null }));
vi.mock("@/components/patients/patient-drawer", () => ({
  PatientDrawer: ({ patientId, onClose }: { patientId: number; onClose: () => void }) => (
    <div data-testid="patient-drawer-backdrop">Patient {patientId}<button onClick={onClose}>Close</button></div>
  ),
}));

function LocationControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.pathname}{location.search}</output>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

function renderPage(entry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <LocationControls />
        <CalendarPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function location() {
  return screen.getByTestId("location").textContent;
}

describe("CalendarPage URL navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [{ id: 2, nameEn: "MRI", nameAr: "MRI" }] });
    fetchAppointmentsMock.mockImplementation(async (params?: { modalityId?: string }) => {
      const appointments = [{
        id: 1,
        patientId: 11,
        modalityId: 2,
        accessionNumber: "ACC-1",
        appointmentDate: "2026-06-18",
        bookingTime: "08:00",
        status: "scheduled",
        caseCategory: "oncology",
        arabicFullName: "Calendar Patient",
        englishFullName: "Calendar Patient",
        nationalId: "N1",
        mrn: "MRN1",
        modalityNameAr: "MRI",
        modalityNameEn: "MRI",
        examNameAr: "Brain",
        examNameEn: "Brain",
      }];
      return params?.modalityId ? appointments.filter((appointment) => String(appointment.modalityId) === params.modalityId) : appointments;
    });
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("initializes the selected month, date, and supported filters from the URL", async () => {
    renderPage("/calendar?source=dashboard&month=2026-06&date=2026-06-18&modalityId=2&category=oncology&status=scheduled");

    await screen.findByTestId("modality-summary-modality:2");
    expect((screen.getByRole("combobox", { name: "Modality" }) as HTMLSelectElement).value).toBe("2");
    expect((screen.getByRole("combobox", { name: "Category" }) as HTMLSelectElement).value).toBe("oncology");
    expect((screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement).value).toBe("scheduled");
    expect(screen.getByTestId("selected-day-summary").textContent).toContain("June 18, 2026");
    expect(fetchAppointmentsMock).toHaveBeenCalledWith(expect.objectContaining({ modalityId: "2" }));
  });

  it("uses browser history for selected dates and patient drawers while retaining Calendar context", async () => {
    renderPage("/calendar?source=dashboard&month=2026-06&modalityId=2&category=oncology&status=scheduled");

    await screen.findByTestId("modality-summary-modality:2");
    const day = screen.getAllByRole("button").find((button) => (button.getAttribute("aria-label") || "").includes("June 18, 2026"));
    expect(day).toBeTruthy();
    fireEvent.click(day!);
    await waitFor(() => expect(location()).toBe("/calendar?source=dashboard&month=2026-06&date=2026-06-18&modalityId=2&category=oncology&status=scheduled"));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(location()).toBe("/calendar?source=dashboard&month=2026-06&modalityId=2&category=oncology&status=scheduled"));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(location()).toContain("date=2026-06-18"));

    fireEvent.click(screen.getByTestId("modality-summary-modality:2"));
    await screen.findByText("Calendar Patient");
    fireEvent.click(screen.getByRole("button", { name: "Calendar Patient" }));
    await waitFor(() => expect(location()).toContain("patientId=11"));
    expect(screen.getByTestId("patient-drawer-backdrop")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(location()).not.toContain("patientId="));
    expect(screen.queryByTestId("patient-drawer-backdrop")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(location()).toContain("patientId=11"));
    expect(screen.getByTestId("patient-drawer-backdrop")).toBeTruthy();
  });

  it("keeps free-text search private and restores it after a reload-style remount", async () => {
    const view = renderPage("/calendar?source=dashboard&month=2026-06&q=Patient%20Name");
    await screen.findByTestId("modality-summary-modality:2");
    await waitFor(() => expect(location()).toBe("/calendar?source=dashboard&month=2026-06"));

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "Patient Name MRN-42" } });
    await waitFor(() => expect(window.sessionStorage.getItem(CALENDAR_SEARCH_STORAGE_KEY)).toBe("Patient Name MRN-42"));
    expect(location()).not.toContain("q=");
    expect(location()).not.toContain("Patient");

    view.unmount();
    renderPage("/calendar?source=dashboard&month=2026-06");
    expect((await screen.findByRole("textbox", { name: "Search" }) as HTMLInputElement).value).toBe("Patient Name MRN-42");
  });

  it("sanitizes invalid state and closes a deep-linked patient drawer without dropping safe parameters", async () => {
    const invalidView = renderPage("/calendar?source=dashboard&month=bad&date=2026-02-30&modalityId=0&category=other&status=invalid&patientId=nope&q=PRIVATE");
    await screen.findByTestId("modality-summary-modality:2");
    await waitFor(() => expect(location()).toBe("/calendar?source=dashboard"));

    invalidView.unmount();
    renderPage("/calendar?source=dashboard&month=2026-06&date=2026-06-18&patientId=11");
    expect(await screen.findByTestId("patient-drawer-backdrop")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(location()).toBe("/calendar?source=dashboard&month=2026-06&date=2026-06-18"));
  });
});
