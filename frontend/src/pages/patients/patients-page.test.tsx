import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PatientsPage from "./patients-page";
import { LanguageProvider } from "@/providers/language-provider-component";
import { AuthContext } from "@/providers/auth-provider";

const fetchPatientDirectoryMock = vi.fn();
const fetchPatientDirectorySummaryMock = vi.fn();

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe" data-pathname={location.pathname} data-search={location.search} />;
}

const noShowSummary = {
  noShowCount: 0,
  bookingRestricted: false,
  lastNoShowAppointment: null,
  lastAuthorizationUser: null,
  lastAuthorizationDate: null,
  lastAuthorizationReason: null,
};

vi.mock("@/lib/api-hooks", () => ({
  fetchPatientDirectory: (...args: unknown[]) => fetchPatientDirectoryMock(...args),
  fetchPatientDirectorySummary: (...args: unknown[]) => fetchPatientDirectorySummaryMock(...args),
}));

vi.mock("@/components/patients/patient-form", () => ({
  default: () => <div data-testid="patient-form" />,
}));

vi.mock("@/components/patients/patient-category-badge", () => ({
  PatientCategoryBadge: ({ category }: { category?: string | null }) => <span data-testid="patient-category">{category || "none"}</span>,
}));

function renderPatientsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const authValue = {
    user: { id: 1, username: "supervisor", fullName: "Supervisor", role: "supervisor" as const },
    isLoading: false,
    login: vi.fn(),
    loginWithPasskey: vi.fn(),
    logout: vi.fn(),
    reAuth: vi.fn(),
    reAuthWithPasskey: vi.fn(),
    changePassword: vi.fn(),
  };

  return render(
    <LanguageProvider>
      <AuthContext.Provider value={authValue}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/patients"]}>
            <Routes>
              <Route path="/patients" element={<PatientsPage />} />
              <Route path="/registrations" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>
    </LanguageProvider>,
  );
}

describe("PatientsPage interactions", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    fetchPatientDirectoryMock.mockReset();
    fetchPatientDirectorySummaryMock.mockReset();
    fetchPatientDirectoryMock.mockResolvedValue({
      patients: [
        {
          id: 11,
          mrn: "MRN-11",
          arabicFullName: "Alice Example",
          englishFullName: "Alice Example",
          sex: "F",
          ageYears: 31,
          demographicsEstimated: false,
          phone1: "0911111111",
          category: null,
          lastAppointment: null,
          nextAppointment: null,
          warnings: {
            missingPhone: false,
            missingDob: false,
            missingSex: false,
            missingName: false,
            noAppointment: false,
            possibleDuplicate: false,
            duplicateReasons: [],
          },
        },
      ],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    });
    fetchPatientDirectorySummaryMock.mockResolvedValue({
      demographics: {
        id: 11,
        mrn: "MRN-11",
        arabicFullName: "Alice Example",
        englishFullName: "Alice Example",
        sex: "F",
        ageYears: 31,
        demographicsEstimated: false,
        dateOfBirth: "1995-01-01",
      },
      identifiers: {
        nationalId: null,
        identifierType: null,
        identifierValue: null,
        items: [
          {
            id: 1,
            typeId: 1,
            typeCode: "passport",
            value: "P-12345",
            normalizedValue: "P-12345",
            isPrimary: true,
          },
          {
            id: 2,
            typeId: 2,
            typeCode: "other",
            value: "ALT-678",
            normalizedValue: "ALT-678",
            isPrimary: false,
          },
        ],
      },
      contact: {
        phone1: "0911111111",
        phone2: null,
        address: null,
      },
      category: null,
      registration: { createdAt: "2026-01-01T09:00:00.000Z", createdByUserId: 1, createdByName: "E2E Registrar", createdByUsername: "registrar" },
      warnings: {
        missingPhone: false,
        missingDob: false,
        missingSex: false,
        missingName: false,
        incompleteData: false,
        possibleDuplicate: false,
        duplicateReasons: [],
      },
      lastAppointment: {
        id: 44,
        date: "2027-01-02",
        status: "scheduled",
        modalityName: "MRI Abdomen",
        examTypeName: "MRI Abdomen",
      },
      nextAppointment: null,
      recentAppointments: [
        {
          id: 44,
          date: "2027-01-02",
          status: "scheduled",
          modalityName: "MRI Abdomen",
          examTypeName: "MRI Abdomen",
        },
      ],
      noShow: noShowSummary,
    });
  });

  it("opens and dismisses the patient drawer when clicking a patient row", async () => {
    renderPatientsPage();

    await waitFor(() => {
      expect(screen.getAllByText("Alice Example").length).toBeGreaterThan(0);
    });

    const row = screen.getAllByText("Alice Example")[0]?.closest("tr");
    expect(row).toBeTruthy();

    await userEvent.click(row as HTMLElement);

    await screen.findByText("Patient Profile");
    await waitFor(() => {
      expect(screen.getByText("Patient Profile")).toBeTruthy();
    });

    await userEvent.click(screen.getByTestId("patient-drawer-backdrop"));

    await waitFor(() => {
      expect(screen.queryByText("Patient Profile")).toBeNull();
    });
  });

  it("shows the primary identifier when national id is missing", async () => {
    fetchPatientDirectorySummaryMock.mockResolvedValue({
      demographics: {
        id: 11,
        mrn: "MRN-11",
        arabicFullName: "Alice Example",
        englishFullName: "Alice Example",
        sex: "F",
        ageYears: 31,
        demographicsEstimated: false,
        dateOfBirth: "1995-01-01",
      },
      identifiers: {
        nationalId: null,
        identifierType: "passport",
        identifierValue: "P-12345",
        items: [
          {
            id: 1,
            typeId: 1,
            typeCode: "passport",
            value: "P-12345",
            normalizedValue: "P-12345",
            isPrimary: true,
          },
          {
            id: 2,
            typeId: 2,
            typeCode: "other",
            value: "ALT-678",
            normalizedValue: "ALT-678",
            isPrimary: false,
          },
        ],
      },
      contact: {
        phone1: "0911111111",
        phone2: null,
        address: null,
      },
      category: null,
      registration: { createdAt: "2026-01-01T09:00:00.000Z", createdByUserId: 1, createdByName: "E2E Registrar", createdByUsername: "registrar" },
      warnings: {
        missingPhone: false,
        missingDob: false,
        missingSex: false,
        missingName: false,
        incompleteData: false,
        possibleDuplicate: false,
        duplicateReasons: [],
      },
      lastAppointment: null,
      nextAppointment: null,
      recentAppointments: [],
      noShow: noShowSummary,
    });

    renderPatientsPage();

    await waitFor(() => {
      expect(screen.getAllByText("Alice Example").length).toBeGreaterThan(0);
    });

    const row = screen.getAllByText("Alice Example")[0]?.closest("tr");
    expect(row).toBeTruthy();

    await userEvent.click(row as HTMLElement);

    await screen.findByText("Patient Profile");
    await waitFor(() => {
      expect(screen.getByText("Passport · Primary")).toBeTruthy();
      expect(screen.getByText("P-12345")).toBeTruthy();
      expect(screen.getByText("ALT-678")).toBeTruthy();
    });
  });

  it("includes the selected sex in the directory query", async () => {
    renderPatientsPage();

    await waitFor(() => {
      expect(fetchPatientDirectoryMock).toHaveBeenCalled();
    });

    const selects = screen.getAllByRole("combobox");
    const sexSelect = selects[2] as HTMLSelectElement;
    fireEvent.change(sexSelect, { target: { value: "female" } });

    await waitFor(() => {
      const latestCall = fetchPatientDirectoryMock.mock.calls.at(-1)?.[0] as { sex?: string } | undefined;
      expect(latestCall?.sex).toBe("female");
    });
  });

  it("defaults the directory sort to most recent", async () => {
    renderPatientsPage();

    await waitFor(() => {
      expect(fetchPatientDirectoryMock).toHaveBeenCalled();
    });

    const firstCall = fetchPatientDirectoryMock.mock.calls[0]?.[0] as { sortBy?: string } | undefined;
    expect(firstCall?.sortBy).toBe("recent");
  });

  it("opens the selected appointment in registrations when clicking a recent appointment", async () => {
    renderPatientsPage();

    await waitFor(() => {
      expect(screen.getAllByText("Alice Example").length).toBeGreaterThan(0);
    });

    const row = screen.getAllByText("Alice Example")[0]?.closest("tr");
    expect(row).toBeTruthy();

    await userEvent.click(row as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText("Patient Profile")).toBeTruthy();
    });

    await userEvent.click(screen.getAllByRole("button", { name: /Manage registration/i })[0]!);

    await waitFor(() => {
      const probe = screen.getByTestId("location-probe");
      expect(probe.getAttribute("data-pathname")).toBe("/registrations");
      expect(probe.getAttribute("data-search")).toBe("?appointmentId=44&patientId=11");
    });
  });
});
