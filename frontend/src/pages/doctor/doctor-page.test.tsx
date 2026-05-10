import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DoctorPage from "./doctor-page";
import { LanguageProvider } from "@/providers/language-provider";
import type { DoctorMe } from "@/types/api";

const fetchDoctorMeMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorMe: () => fetchDoctorMeMock(),
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
});
