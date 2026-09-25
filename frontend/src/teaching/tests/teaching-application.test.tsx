import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeachingApplication } from "../teaching-application";

const teachingAuthState = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  isIdentityLoading: false,
  mustChangePassword: false,
  identity: null as { identitySubject: string; displayName: string; permissions: string[] } | null,
  login: vi.fn(),
  loginWithPasskey: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock("@/teaching/auth/teaching-auth-provider", () => ({
  TeachingAuthProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/teaching/auth/teaching-auth-context", () => ({
  useTeachingAuth: () => teachingAuthState,
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

function renderTeaching(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/teaching/*" element={<TeachingApplication />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Teaching application routes", () => {
  afterEach(() => {
    cleanup();
    teachingAuthState.isAuthenticated = false;
    teachingAuthState.isLoading = false;
    teachingAuthState.isIdentityLoading = false;
    teachingAuthState.mustChangePassword = false;
    teachingAuthState.identity = null;
    vi.clearAllMocks();
  });

  it("renders a separately branded login route", () => {
    renderTeaching("/teaching/login");

    expect(screen.getByRole("heading", { name: "RISpro Teaching" })).toBeTruthy();
    expect(screen.getByText("Question Bank and Residency Education")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
  });

  it("sends an authenticated Teaching user from login to the dashboard", () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "Teaching Learner",
      permissions: ["teaching.access", "teaching.learn"],
    };

    renderTeaching("/teaching/login");

    expect(screen.getByRole("heading", { name: "Question Bank and Residency Education" })).toBeTruthy();
    expect(screen.getByText("Teaching workspace initialized.")).toBeTruthy();
  });

  it("redirects unauthenticated dashboard visits to the Teaching login", () => {
    renderTeaching("/teaching/dashboard");

    expect(screen.getByRole("heading", { name: "RISpro Teaching" })).toBeTruthy();
  });

  it("redirects unauthenticated editorial visits to the Teaching login", () => {
    renderTeaching("/teaching/admin/questions");

    expect(screen.getByRole("heading", { name: "RISpro Teaching" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
  });

  it("rejects authenticated users without teaching.access", () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "RISpro User",
      permissions: [],
    };

    renderTeaching("/teaching/dashboard");

    expect(screen.getByRole("heading", { name: "Teaching access is not enabled" })).toBeTruthy();
    expect(screen.queryByText("Teaching workspace initialized.")).toBeNull();
  });

  it("requires the Teaching author capability to open the import workspace", () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "Teaching Author",
      permissions: ["teaching.access", "teaching.author"],
    };

    renderTeaching("/teaching/admin/import");

    expect(screen.getByRole("heading", { name: "Question Bank Import" })).toBeTruthy();
    expect(screen.getAllByRole("navigation", { name: "Teaching navigation" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("RISpro Core")).toBeNull();
  });

  it("does not expose the import workspace to a learner", () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "Teaching Learner",
      permissions: ["teaching.access", "teaching.learn"],
    };

    renderTeaching("/teaching/admin/import");

    expect(screen.getByRole("heading", { name: "Teaching author access is required" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Question Bank Import" })).toBeNull();
  });

  it("denies Teaching learners access to editorial routes", () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "Teaching Learner",
      permissions: ["teaching.access", "teaching.learn"],
    };

    renderTeaching("/teaching/admin/questions");

    expect(screen.getByRole("heading", { name: "Teaching editorial access is required" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New question" })).toBeNull();
  });

  it("uses the Teaching shell and adapter logout instead of the clinical app shell", () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "Teaching Learner",
      permissions: ["teaching.access"],
    };

    renderTeaching("/teaching");

    expect(screen.getAllByRole("navigation", { name: "Teaching navigation" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Sign out of Teaching" })).toBeTruthy();
    expect(screen.queryByText("RISpro Core")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign out of Teaching" }));
    expect(teachingAuthState.logout).toHaveBeenCalledOnce();
  });
});
