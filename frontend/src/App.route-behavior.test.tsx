import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { App } from "./App";
import { APP_NAV_ITEMS } from "@/lib/route-registry";
import { DEFAULT_PAGE_VISIBILITY_MATRIX, type PageVisibilityMatrix } from "@/lib/page-visibility";
import { t as translate } from "@/lib/i18n";
import type { User } from "@/types/api";

const testState = vi.hoisted(() => ({
  fetchDoctorMe: vi.fn(),
  fetchPageVisibilityMatrix: vi.fn(),
  logout: vi.fn(),
  language: "en" as "en" | "ar",
  user: {
    id: 1,
    username: "reception",
    fullName: "Reception User",
    role: "receptionist",
  } as User | null,
}));

function TestPage({ testId, label }: { testId: string; label: string }) {
  return <div data-testid={testId}>{label}</div>;
}

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: testState.user,
    isLoading: false,
    login: vi.fn(),
    logout: testState.logout,
    reAuth: vi.fn(),
    changePassword: vi.fn(),
  }),
}));

vi.mock("@/providers/auth-provider-component", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/providers/language-provider", async () => {
  const { t } = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
  return {
    useLanguage: () => ({
      language: testState.language,
      isArabic: testState.language === "ar",
      setLanguage: vi.fn(),
      toggleLanguage: vi.fn(),
      t: (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t(testState.language, key, params),
    }),
  };
});

vi.mock("@/providers/language-provider-component", () => ({
  LanguageProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/providers/action-pin-provider", () => ({
  ActionPinProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ActionPinIdleLock: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorMe: testState.fetchDoctorMe,
  fetchPageVisibilityMatrix: testState.fetchPageVisibilityMatrix,
  fetchNoShowSummary: vi.fn().mockResolvedValue({ pendingCount: 0, mode: "manual", lastAutomaticProcessedCount: 0 }),
  fetchComplementaryRecallReceptionSummary: vi.fn().mockResolvedValue({ pendingCount: 0, unseenPendingCount: 0 }),
  searchPatients: vi.fn(),
  fetchAppointments: vi.fn(),
}));

vi.mock("@/components/auth/action-pin-settings-button", () => ({
  ActionPinSettingsButton: () => null,
}));

vi.mock("@/v2/appointments/components/SchedulingOverrideApprovalCenter", () => ({
  SchedulingOverrideApprovalCenter: () => null,
}));

vi.mock("@/components/common/toast-viewport", () => ({
  ToastViewport: () => null,
}));

vi.mock("@/pages/auth/login-page", () => ({
  LoginPage: () => <TestPage testId="login-page" label="Login Page" />,
}));
vi.mock("@/pages/dashboard/dashboard-page", () => ({
  DashboardPage: () => <TestPage testId="dashboard-page" label="Dashboard Page" />,
}));
vi.mock("@/pages/search/search-page", () => ({
  default: () => <TestPage testId="search-page" label="Search Page" />,
}));
vi.mock("@/pages/patients/patients-page", () => ({
  default: () => <TestPage testId="patients-page" label="Patients Page" />,
}));
vi.mock("@/pages/patients/edit-patient-page", () => ({
  default: () => <TestPage testId="edit-patient-page" label="Edit Patient Page" />,
}));
vi.mock("@/pages/patient-merge/patient-merge-page", () => ({
  default: () => <TestPage testId="patient-merge-page" label="Patient Merge Page" />,
}));
vi.mock("@/pages/name-dictionary/name-dictionary-page", () => ({
  default: () => <TestPage testId="name-dictionary-page" label="Name Dictionary Page" />,
}));
vi.mock("@/pages/calendar/calendar-page", () => ({
  default: () => <TestPage testId="calendar-page" label="Calendar Page" />,
}));
vi.mock("@/pages/registrations/registrations-page", () => ({
  default: () => <TestPage testId="registrations-page" label="Registrations Page" />,
}));
vi.mock("@/pages/scheduling-override-requests/scheduling-override-requests-page", () => ({
  default: () => <TestPage testId="override-requests-page" label="Override Requests Page" />,
}));
vi.mock("@/pages/queue/queue-page", () => ({
  default: () => <TestPage testId="queue-page" label="Queue Page" />,
}));
vi.mock("@/pages/queue/queue-check-in-page", () => ({
  default: () => <TestPage testId="queue-check-in-page" label="Queue Check-In Page" />,
}));
vi.mock("@/pages/modality/modality-page", () => ({
  default: () => <TestPage testId="modality-page" label="Modality Page" />,
}));
vi.mock("@/pages/doctor/doctor-page", () => ({
  default: () => <TestPage testId="doctor-page" label="Doctor Page" />,
}));
vi.mock("@/pages/doctor/reporting-board-mobile-page", () => ({
  ReportingBoardMobilePage: () => <TestPage testId="reporting-board-mobile-page" label="Reporting Board Mobile Page" />,
}));
vi.mock("@/pages/print/print-page", () => ({
  default: () => <TestPage testId="print-page" label="Print Page" />,
}));
vi.mock("@/pages/print/day-list-print-page", () => ({
  default: () => <TestPage testId="day-list-print-page" label="Day List Print Page" />,
}));
vi.mock("@/pages/print/reporting-board-print-page", () => ({
  default: () => <TestPage testId="reporting-board-print-page" label="Reporting Board Print Page" />,
}));
vi.mock("@/pages/statistics/statistics-page", () => ({
  default: () => <TestPage testId="statistics-page" label="Statistics Page" />,
}));
vi.mock("@/pages/pacs/pacs-page", () => ({
  default: () => <TestPage testId="pacs-page" label="PACS Page" />,
}));
vi.mock("@/pages/pacs/pacs-remap-page", () => ({
  default: () => <TestPage testId="pacs-remap-page" label="PACS Remap Page" />,
}));
vi.mock("@/pages/worklist-monitor/worklist-monitor-page", () => ({
  default: () => <TestPage testId="worklist-monitor-page" label="Worklist Monitor Page" />,
}));
vi.mock("@/pages/settings/settings-page", () => ({
  default: () => <TestPage testId="settings-page" label="Settings Page" />,
}));
vi.mock("@/pages/workstation/workstation-printing-page", () => ({
  default: () => <TestPage testId="workstation-printing-page" label="Workstation Printing Page" />,
}));
vi.mock("@/pages/legacy-access-viewer/legacy-access-viewer-page", () => ({
  default: () => <TestPage testId="legacy-page" label="Legacy Page" />,
}));
vi.mock("@/pages/public/cancel-appointment-page", () => ({
  default: () => <TestPage testId="public-cancel-page" label="Public Cancel Page" />,
}));
vi.mock("@/v2/appointments", () => ({
  AppointmentCreatePage: () => <TestPage testId="appointment-create-page" label="Appointment Create Page" />,
  SchedulingAdminPage: () => <TestPage testId="scheduling-admin-page" label="Scheduling Admin Page" />,
}));

function renderAppAt(
  path: string,
  matrix: PageVisibilityMatrix = DEFAULT_PAGE_VISIBILITY_MATRIX,
  doctorMe: unknown = { hasActiveDoctorProfile: false }
) {
  testState.fetchDoctorMe.mockResolvedValue(doctorMe);
  testState.fetchPageVisibilityMatrix.mockResolvedValue(matrix);
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("App route behavior", () => {
  beforeEach(() => {
    testState.user = {
      id: 1,
      username: "reception",
      fullName: "Reception User",
      role: "receptionist",
    } as User;
    testState.logout.mockReset();
    testState.fetchDoctorMe.mockReset();
    testState.fetchPageVisibilityMatrix.mockReset();
    localStorage.setItem("rispro-language", "en");
    testState.language = "en";
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/");
  });

  it("renders AppointmentCreatePage at /appointments", async () => {
    renderAppAt("/appointments");

    expect(await screen.findByTestId("appointment-create-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/appointments");
  });

  it("redirects /v2/appointments to /appointments", async () => {
    renderAppAt("/v2/appointments");

    await waitFor(() => expect(window.location.pathname).toBe("/appointments"));
    expect(await screen.findByTestId("appointment-create-page")).toBeTruthy();
  });

  it("redirects /appointments/legacy to /appointments", async () => {
    renderAppAt("/appointments/legacy");

    await waitFor(() => expect(window.location.pathname).toBe("/appointments"));
    expect(await screen.findByTestId("appointment-create-page")).toBeTruthy();
  });

  it.each(["receptionist", "supervisor", "modality_staff", "doctor", "super_admin"] as const)("allows %s to open workstation printing without exposing admin settings", async (role) => {
    testState.user = { id: 10, username: role, fullName: role, role } as User;
    renderAppAt("/workstation/printing");
    expect(await screen.findByTestId("workstation-printing-page")).toBeTruthy();
    expect(screen.queryByTestId("settings-page")).toBeNull();
  });

  it("blocks a non-printing administrative role from workstation printing", async () => {
    testState.user = { id: 11, username: "administrative", fullName: "Administrative", role: "administrative" } as User;
    renderAppAt("/workstation/printing");
    await waitFor(() => expect(window.location.pathname).not.toBe("/workstation/printing"));
    expect(screen.queryByTestId("workstation-printing-page")).toBeNull();
  });

  it("allows supervisor access to appointment administration when page visibility allows it", async () => {
    testState.user = {
      id: 2,
      username: "supervisor",
      fullName: "Supervisor User",
      role: "supervisor",
    } as User;

    renderAppAt("/v2/appointments/admin");

    expect(await screen.findByTestId("scheduling-admin-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/v2/appointments/admin");
  });

  it("allows super-admin access to appointment administration when page visibility allows it", async () => {
    testState.user = {
      id: 3,
      username: "super-admin",
      fullName: "Super Admin",
      role: "super_admin",
    } as User;

    renderAppAt("/v2/appointments/admin");

    expect(await screen.findByTestId("scheduling-admin-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/v2/appointments/admin");
  });

  it("redirects receptionist appointment administration access to the canonical appointment route", async () => {
    renderAppAt("/v2/appointments/admin");

    await waitFor(() => expect(window.location.pathname).toBe("/appointments"));
    expect(await screen.findByTestId("appointment-create-page")).toBeTruthy();
    expect(screen.queryByTestId("scheduling-admin-page")).toBeNull();
  });

  it("redirects an authorized appointment administrator denied by page visibility to the normal fallback", async () => {
    testState.user = {
      id: 2,
      username: "supervisor",
      fullName: "Supervisor User",
      role: "supervisor",
    } as User;
    const deniedMatrix: PageVisibilityMatrix = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      "v2.appointments.admin": [],
    };

    renderAppAt("/v2/appointments/admin", deniedMatrix);

    await waitFor(() => expect(window.location.pathname).toBe("/queue"));
    expect(screen.queryByTestId("scheduling-admin-page")).toBeNull();
    expect(await screen.findByTestId("queue-page")).toBeTruthy();
  });

  it("uses Doctor Portal as the root landing for dual-access doctors", async () => {
    testState.user = { id: 2, username: "doctor", fullName: "Doctor User", role: "doctor" } as User;
    renderAppAt("/", DEFAULT_PAGE_VISIBILITY_MATRIX, {
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: true,
    });

    await waitFor(() => expect(window.location.pathname).toBe("/doctor/dashboard"));
    expect(await screen.findByTestId("doctor-page")).toBeTruthy();
  });

  it("uses the Core default root landing for supervisors with Doctor Portal access", async () => {
    testState.user = { id: 2, username: "supervisor", fullName: "Supervisor User", role: "supervisor" } as User;
    renderAppAt("/", DEFAULT_PAGE_VISIBILITY_MATRIX, {
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
    });

    await waitFor(() => expect(window.location.pathname).toBe("/queue"));
    expect(await screen.findByTestId("queue-page")).toBeTruthy();
  });

  it("uses the Core default root landing for doctors without an active profile", async () => {
    testState.user = { id: 2, username: "doctor", fullName: "Doctor User", role: "doctor" } as User;
    renderAppAt("/", DEFAULT_PAGE_VISIBILITY_MATRIX, {
      hasActiveDoctorProfile: false,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: true,
    });

    await waitFor(() => expect(window.location.pathname).toBe("/patients"));
    expect(await screen.findByTestId("patients-page")).toBeTruthy();
  });

  it("uses the Core default root landing when doctor auto redirect is disabled", async () => {
    testState.user = { id: 2, username: "doctor", fullName: "Doctor User", role: "doctor" } as User;
    renderAppAt("/", DEFAULT_PAGE_VISIBILITY_MATRIX, {
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: false,
    });

    await waitFor(() => expect(window.location.pathname).toBe("/patients"));
    expect(await screen.findByTestId("patients-page")).toBeTruthy();
  });

  it("keeps Doctor Portal manually accessible for dual-access users", async () => {
    renderAppAt("/doctor/dashboard", DEFAULT_PAGE_VISIBILITY_MATRIX, {
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
    });

    expect(await screen.findByTestId("doctor-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/doctor/dashboard");
  });

  it("renders configured sidebar labels from APP_NAV_ITEMS", async () => {
    testState.user = {
      id: 2,
      username: "admin",
      fullName: "Super Admin",
      role: "super_admin",
    } as User;
    renderAppAt("/dashboard");

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
    for (const item of APP_NAV_ITEMS) {
      // Doctor access is presented through WorkspaceSwitcher, not SideNav.
      if (item.route === "doctor") {
        continue;
      }

      if (item.route === "appointments") {
        await userEvent.click(screen.getByRole("button", { name: "New" }));
        expect(screen.getByRole("menuitem", { name: "New appointment" })).toBeTruthy();
        continue;
      }

      expect(screen.getAllByText(translate("en", item.labelKey)).length).toBeGreaterThan(0);
    }
  });

  it("renders Doctor Workspace in the workspace switcher for dual-access users", async () => {
    testState.user = {
      id: 2,
      username: "admin",
      fullName: "Super Admin",
      role: "super_admin",
    } as User;
    renderAppAt("/dashboard", DEFAULT_PAGE_VISIBILITY_MATRIX, {
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
    });

    const workspaceSwitcher = await screen.findByRole("button", {
      name: new RegExp(translate("en", "workspace.switcher"), "i"),
    });
    await userEvent.click(workspaceSwitcher);

    expect(
      await screen.findByRole("menuitem", {
        name: translate("en", "workspace.doctor"),
      }),
    ).toBeTruthy();
  });

  it("places the sidebar left in LTR and right of the main content in RTL", async () => {
    renderAppAt("/dashboard");
    await screen.findByTestId("dashboard-page");
    const ltrNav = screen.getByRole("navigation");
    expect(ltrNav.parentElement?.firstElementChild).toBe(ltrNav);

    cleanup();
    testState.language = "ar";
    renderAppAt("/dashboard");
    await screen.findByTestId("dashboard-page");
    const rtlNav = screen.getByRole("navigation");
    expect(rtlNav.getAttribute("dir")).toBe("rtl");
    expect(rtlNav.parentElement?.getAttribute("dir")).toBe("rtl");
    expect(rtlNav.style.borderLeft).toContain("1px");
  });

  it("hides and blocks a route denied by page visibility", async () => {
    const deniedMatrix: PageVisibilityMatrix = {
      ...DEFAULT_PAGE_VISIBILITY_MATRIX,
      appointments: [],
    };
    renderAppAt("/dashboard", deniedMatrix);

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
    expect(screen.queryByText(translate("en", "nav.appointments"))).toBeNull();

    cleanup();
    renderAppAt("/appointments", deniedMatrix);

    await waitFor(() => expect(window.location.pathname).toBe("/queue"));
    expect(screen.queryByTestId("appointment-create-page")).toBeNull();
    expect(await screen.findByTestId("queue-page")).toBeTruthy();
  });
});
