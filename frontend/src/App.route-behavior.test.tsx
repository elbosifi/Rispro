import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: testState.user,
    isLoading: false,
    login: vi.fn(),
    logout: testState.logout,
    reAuth: vi.fn(),
    changePassword: vi.fn(),
  }),
}));

vi.mock("@/providers/language-provider", async () => {
  const { t } = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
  return {
    LanguageProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useLanguage: () => ({
      language: "en",
      isArabic: false,
      setLanguage: vi.fn(),
      toggleLanguage: vi.fn(),
      t: (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t("en", key, params),
    }),
  };
});

vi.mock("@/providers/action-pin-provider", () => ({
  ActionPinProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ActionPinIdleLock: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorMe: testState.fetchDoctorMe,
  fetchPageVisibilityMatrix: testState.fetchPageVisibilityMatrix,
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
vi.mock("@/pages/legacy-access-viewer/legacy-access-viewer-page", () => ({
  default: () => <TestPage testId="legacy-page" label="Legacy Page" />,
}));
vi.mock("@/pages/public/cancel-appointment-page", () => ({
  default: () => <TestPage testId="public-cancel-page" label="Public Cancel Page" />,
}));
vi.mock("@/v2/appointments", () => ({
  AppointmentCreatePage: () => <TestPage testId="appointment-create-page" label="Appointment Create Page" />,
  SchedulingAdminV2Page: () => <TestPage testId="scheduling-admin-page" label="Scheduling Admin Page" />,
}));

function renderAppAt(path: string, matrix: PageVisibilityMatrix = DEFAULT_PAGE_VISIBILITY_MATRIX) {
  testState.fetchDoctorMe.mockResolvedValue({ hasActiveDoctorProfile: false });
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

  it("renders navigation labels from APP_NAV_ITEMS", async () => {
    testState.user = {
      id: 2,
      username: "admin",
      fullName: "Super Admin",
      role: "super_admin",
    } as User;
    renderAppAt("/dashboard");

    expect(await screen.findByTestId("dashboard-page")).toBeTruthy();
    for (const item of APP_NAV_ITEMS) {
      expect(screen.getAllByText(translate("en", item.labelKey)).length).toBeGreaterThan(0);
    }
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
