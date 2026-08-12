import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { LoginPage } from "./login-page";
import type { User } from "@/types/api";

function loggedInUser(role: User["role"], mustChangePassword = false): User {
  return { id: 1, username: role, fullName: role, role, mustChangePassword };
}

const testState = vi.hoisted(() => ({
  fetchDoctorMe: vi.fn(),
  login: vi.fn(),
  loginWithPasskey: vi.fn(),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    login: testState.login,
    loginWithPasskey: testState.loginWithPasskey,
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
  fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
}

describe("LoginPage routing", () => {
  beforeEach(() => {
    testState.login.mockResolvedValue(loggedInUser("doctor"));
    testState.loginWithPasskey.mockResolvedValue(loggedInUser("doctor"));
    testState.fetchDoctorMe.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lands dual-access doctors in Doctor Portal from the default login target", async () => {
    testState.fetchDoctorMe.mockResolvedValue({
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: true,
    });
    const { container } = renderLogin("/");

    await submitLogin(container);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/doctor/dashboard"));
  });

  it("keeps supervisors in Core from the default login target", async () => {
    testState.login.mockResolvedValue(loggedInUser("supervisor"));
    testState.fetchDoctorMe.mockResolvedValue({
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: true,
    });
    const { container } = renderLogin("/");

    await submitLogin(container);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/"));
  });

  it("keeps doctors in Core when Doctor Portal auto redirect is disabled", async () => {
    testState.fetchDoctorMe.mockResolvedValue({
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: false,
    });
    const { container } = renderLogin("/");

    await submitLogin(container);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/"));
  });

  it("respects an explicit appointments request after login", async () => {
    testState.fetchDoctorMe.mockResolvedValue({
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: true,
    });
    const { container } = renderLogin("/appointments");

    await submitLogin(container);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/appointments"));
  });

  it("uses the same redirect behavior after passkey sign-in", async () => {
    testState.fetchDoctorMe.mockResolvedValue({
      hasActiveDoctorProfile: true,
      canAccessCoreWorkspace: true,
      doctorPortalAutoRedirect: true,
    });
    renderLogin("/");

    fireEvent.click(screen.getByRole("button", { name: /sign in with passkey/i }));

    await waitFor(() => expect(testState.loginWithPasskey).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/doctor/dashboard"));
  });

  it("preserves the forced password-change route without loading Doctor Portal identity", async () => {
    testState.login.mockResolvedValue(loggedInUser("doctor", true));
    const { container } = renderLogin("/change-password");

    await submitLogin(container);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/change-password"));
    expect(testState.fetchDoctorMe).not.toHaveBeenCalled();
  });
});
