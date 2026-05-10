import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DoctorPage from "./doctor-page";
import { LanguageProvider } from "@/providers/language-provider";
import type { DoctorMe } from "@/types/api";

const fetchDoctorMeMock = vi.fn();
const fetchMyDoctorRosterMock = vi.fn();
const fetchDoctorRosterWeekMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchRosterDoctorsMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorMe: () => fetchDoctorMeMock(),
  fetchMyDoctorRoster: (...args: unknown[]) => fetchMyDoctorRosterMock(...args),
  fetchDoctorRosterWeek: (...args: unknown[]) => fetchDoctorRosterWeekMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchRosterDoctors: (...args: unknown[]) => fetchRosterDoctorsMock(...args),
  createDoctorRosterWeek: vi.fn(),
  copyPreviousDoctorRosterWeek: vi.fn(),
  publishDoctorRosterWeek: vi.fn(),
  createDoctorRosterAssignment: vi.fn(),
  deleteDoctorRosterAssignment: vi.fn(),
  addDoctorRosterMember: vi.fn(),
  deleteDoctorRosterMember: vi.fn(),
}));

function CorePlaceholder() {
  const location = useLocation();
  return <div data-testid="core-page">{location.pathname}</div>;
}

const normalDoctor: DoctorMe = {
  hasActiveDoctorProfile: true,
  profile: {
    id: 1,
    userId: 10,
    displayName: "Dr Normal",
    doctorRole: "specialist",
    active: true,
    canFinalizeReports: false,
    canAssignProtocols: true,
    canSupervise: false,
  },
  doctorRole: "specialist",
  canFinalizeReports: false,
  canAssignProtocols: true,
  canSupervise: false,
  allowedModalities: [],
  moduleCapabilities: ["doctor"],
  canAccessCoreWorkspace: true,
};

function renderDoctorPortal(initialPath = "/doctor") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<CorePlaceholder />} />
            <Route path="/dashboard" element={<CorePlaceholder />} />
            <Route path="/doctor/*" element={<DoctorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("Doctor Portal shell", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    fetchDoctorMeMock.mockReset();
    fetchMyDoctorRosterMock.mockReset();
    fetchDoctorRosterWeekMock.mockReset();
    fetchAppointmentLookupsMock.mockReset();
    fetchRosterDoctorsMock.mockReset();
    fetchMyDoctorRosterMock.mockResolvedValue({ week: null, assignments: [] });
    fetchDoctorRosterWeekMock.mockResolvedValue({ week: null, assignments: [] });
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [] });
    fetchRosterDoctorsMock.mockResolvedValue([]);
  });

  it("allows an active doctor to access /doctor", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal();

    expect(await screen.findByText("Doctor Portal")).toBeTruthy();
    expect(screen.getByText("Dr Normal")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dashboard/i })).toBeTruthy();
  });

  it("redirects a non-doctor away from /doctor", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      hasActiveDoctorProfile: false,
      profile: null,
      doctorRole: null,
      moduleCapabilities: [],
    });

    renderDoctorPortal();

    await waitFor(() => {
      expect(screen.getByTestId("core-page").textContent).toBe("/");
    });
  });

  it("shows management menu items to doctor supervisors", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });

    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByRole("button", { name: /Roster Management/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Team Workload/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Doctors\/Admin/i })).toBeTruthy();
  });

  it("does not show management menu items to normal doctors", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByRole("button", { name: /My Roster/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Team Workload/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Doctors\/Admin/i })).toBeNull();
  });

  it("does not render appointment editing or rescheduling controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/dashboard");

    expect(await screen.findByText("Dr Normal")).toBeTruthy();
    expect(screen.queryByTestId("appointment-editor")).toBeNull();
    expect(screen.queryByRole("button", { name: /Print/i })).toBeNull();
    expect(screen.queryByText(/reschedule/i)).toBeNull();
  });

  it("normal doctor sees My Roster empty state without management controls", async () => {
    fetchDoctorMeMock.mockResolvedValue(normalDoctor);
    renderDoctorPortal("/doctor/roster");

    expect(await screen.findByText("My Roster")).toBeTruthy();
    expect(screen.getByText("No roster assignments for this week.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create draft week/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publish week/i })).toBeNull();
  });

  it("doctor supervisor sees roster management controls", async () => {
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/admin/roster");

    expect(await screen.findByText("Roster Management")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create draft week/i })).toBeTruthy();
  });

  it("publish action is visible only for supervisor draft roster", async () => {
    fetchDoctorRosterWeekMock.mockResolvedValue({
      week: {
        id: 99,
        weekStartDate: "2027-01-04",
        weekEndDate: "2027-01-10",
        status: "draft",
        createdBy: 1,
        publishedBy: null,
        publishedAt: null,
        createdAt: "2027-01-01",
        updatedAt: "2027-01-01",
      },
      assignments: [],
    });
    fetchDoctorMeMock.mockResolvedValue({
      ...normalDoctor,
      canSupervise: true,
      moduleCapabilities: ["doctor", "doctor_supervisor"],
    });
    renderDoctorPortal("/doctor/admin/roster");

    expect(await screen.findByRole("button", { name: /Publish week/i })).toBeTruthy();
  });
});
