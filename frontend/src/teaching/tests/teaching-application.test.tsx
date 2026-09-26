import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TeachingApplication } from "../teaching-application";
import { TeachingLayout } from "../layout/teaching-layout";
import { registerUnsavedNavigationGuard } from "@/lib/unsaved-navigation-guard";

const learnerApi = vi.hoisted(() => ({ fetchDashboard: vi.fn() }));

vi.mock("../api/teaching-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/teaching-api")>();
  return { ...actual, fetchTeachingLearnerDashboard: learnerApi.fetchDashboard };
});

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/teaching/*" element={<TeachingApplication />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
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

  beforeEach(() => {
    learnerApi.fetchDashboard.mockResolvedValue({
      publishedQuestionCount: 0,
      progress: { attemptedQuestions: 0, unseenQuestions: 0, correctQuestions: 0, incorrectQuestions: 0, markedQuestions: 0 },
      recentSessions: [],
      continueSession: null,
    });
  });

  it("renders a separately branded login route", () => {
    renderTeaching("/teaching/login");

    expect(screen.getByRole("heading", { name: "RISpro Teaching" })).toBeTruthy();
    expect(screen.getByText("Question Bank and Residency Education")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
  });

  it("sends an authenticated Teaching learner from login to the dashboard", async () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "Teaching Learner",
      permissions: ["teaching.access", "teaching.learn"],
    };

    renderTeaching("/teaching/login");

    expect(await screen.findByRole("heading", { name: "Question Bank" })).toBeTruthy();
    expect(screen.getByText(/Current cycle: 0 \/ 0 questions/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Progress" }).length).toBe(2);
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
    expect(screen.queryByRole("heading", { name: "Question Bank" })).toBeNull();
  });

  it("requires teaching.learn for the learner dashboard", () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "Teaching Author",
      permissions: ["teaching.access", "teaching.author"],
    };

    renderTeaching("/teaching/dashboard");

    expect(screen.getByRole("heading", { name: "Teaching learner access is not enabled" })).toBeTruthy();
    expect(learnerApi.fetchDashboard).not.toHaveBeenCalled();
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
      permissions: ["teaching.access", "teaching.learn"],
    };

    renderTeaching("/teaching");

    expect(screen.getAllByRole("navigation", { name: "Teaching navigation" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Sign out of Teaching" })).toBeTruthy();
    expect(screen.queryByText("RISpro Core")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign out of Teaching" }));
    expect(teachingAuthState.logout).toHaveBeenCalledOnce();
  });

  it("uses the shared unsaved-navigation guard for desktop Dashboard and sign out", () => {
    teachingAuthState.isAuthenticated = true;
    teachingAuthState.identity = {
      identitySubject: "123",
      displayName: "Teaching Author",
      permissions: ["teaching.access", "teaching.learn"],
    };
    let proceed: (() => void) | undefined;
    const guard = vi.fn((next: () => void) => { proceed = next; });
    const unregister = registerUnsavedNavigationGuard(guard);
    const Location = () => <p data-testid="location">{useLocation().pathname}</p>;
    render(
      <MemoryRouter initialEntries={["/teaching/admin/questions/12"]}>
        <TeachingLayout><Location /></TeachingLayout>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("link", { name: "Dashboard" })[0]!);
    expect(guard).toHaveBeenCalledOnce();
    expect(screen.getByTestId("location").textContent).toBe("/teaching/admin/questions/12");
    act(() => proceed?.());
    expect(screen.getByTestId("location").textContent).toBe("/teaching/dashboard");

    const unregisterSignOut = registerUnsavedNavigationGuard(guard);
    fireEvent.click(screen.getByRole("button", { name: "Sign out of Teaching" }));
    expect(teachingAuthState.logout).not.toHaveBeenCalled();
    act(() => proceed?.());
    expect(teachingAuthState.logout).toHaveBeenCalledOnce();
    unregisterSignOut();
    unregister();
  });
});
