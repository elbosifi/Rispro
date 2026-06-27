import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { LoginPage } from "./login-page";

const testState = vi.hoisted(() => ({
  fetchDoctorMe: vi.fn(),
  login: vi.fn(),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    login: testState.login,
    isLoading: false,
  }),
}));

vi.mock("@/providers/language-provider", async () => {
  const { t } = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
  return {
    useLanguage: () => ({
      language: "en",
      isArabic: false,
      t: (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t("en", key, params),
    }),
  };
});

vi.mock("@/lib/api-hooks", () => ({
  fetchDoctorMe: testState.fetchDoctorMe,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderLogin(from = "/") {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: { pathname: from } } }]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

async function submitLogin(container: HTMLElement) {
  const username = container.querySelector('input[type="text"]');
  const password = container.querySelector('input[type="password"]');
  if (!username || !password) throw new Error("Login inputs were not rendered");

  fireEvent.change(username, { target: { value: "doctor" } });
  fireEvent.change(password, { target: { value: "password" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginPage routing", () => {
  beforeEach(() => {
    testState.login.mockResolvedValue({ mustChangePassword: false });
    testState.fetchDoctorMe.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lands doctor-only users in Doctor Portal from the default login target", async () => {
    testState.fetchDoctorMe.mockResolvedValue({
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: false,
      doctorPortalAutoRedirect: true,
    });
    const { container } = renderLogin("/");

    await submitLogin(container);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/doctor/dashboard"));
  });

  it("does not force Doctor Portal for dual-access users", async () => {
    testState.fetchDoctorMe.mockResolvedValue({
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: true,
    });
    const { container } = renderLogin("/");

    await submitLogin(container);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/"));
  });

  it("respects an explicit appointments request after login", async () => {
    testState.fetchDoctorMe.mockResolvedValue({
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: false,
      doctorPortalAutoRedirect: true,
    });
    const { container } = renderLogin("/appointments");

    await submitLogin(container);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/appointments"));
  });
});
