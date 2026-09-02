import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { ReportingBoardMobilePage } from "./reporting-board-mobile-page";
import type { ReportingBoardMobileResponse, User } from "@/types/api";

const testState = vi.hoisted(() => ({
  user: null as User | null,
  fetchView: vi.fn(),
  fetchConfig: vi.fn(),
  fetchStatus: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  sendTest: vi.fn(),
  fetchOhif: vi.fn(),
  logout: vi.fn(),
  noop: vi.fn(),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: testState.user, isLoading: false, logout: testState.logout }),
}));

vi.mock("@/components/auth/passkey-settings-button", () => ({
  PasskeySettingsButton: () => null,
}));

vi.mock("@/components/doctor/complementary-recall-request-dialog", () => ({
  ComplementaryRecallRequestDialog: () => null,
}));

vi.mock("@/lib/api-hooks", () => ({
  assignReportingBoardMobileCaseToMe: testState.noop,
  createReportingBoardComplementaryRecall: testState.noop,
  fetchOhifViewerAvailability: testState.fetchOhif,
  fetchReportingBoardHistoricalPacsCandidates: testState.noop,
  fetchReportingBoardMobilePushConfig: testState.fetchConfig,
  fetchReportingBoardMobilePushStatus: testState.fetchStatus,
  fetchReportingBoardMobileView: testState.fetchView,
  fetchReportingBoardPatientHistory: testState.noop,
  finalizeComparisonRequest: testState.noop,
  launchReportingBoardCaseInOhif: testState.noop,
  markReportingBoardCaseManualFinal: testState.noop,
  sendReportingBoardMobileTestPush: testState.sendTest,
  subscribeReportingBoardMobilePush: testState.subscribe,
  unsubscribeReportingBoardMobilePush: testState.unsubscribe,
}));

function viewData(): ReportingBoardMobileResponse {
  return {
    savedView: { id: 1, name: "Personal Desk", token: "token", linkKind: "doctor_worklist", targetDoctorId: 7 },
    lockedFilters: {},
    effectiveModalityCodes: ["CT"],
    scopeMessage: null,
    currentDoctorId: 7,
    filters: {},
    filterSummary: [],
    counters: { total: 0, assignedToMe: 0, unassigned: 0, urgent: 0, requiredNotFinal: 0, overdue: 0 },
    totalCount: 0,
    pagination: { limit: 40, offset: 0, hasMore: false, nextOffset: null },
    cases: [],
    allowedActions: {
      authenticated: true,
      accessLevel: "doctor",
      readOnly: false,
      readOnlyReason: null,
      assignToMe: true,
      reassign: false,
      unassign: false,
      batchReassign: false,
      copyAccession: true,
      copyMrn: true,
    },
    refreshedAt: "2026-09-02T00:00:00.000Z",
  };
}

function makeSubscription() {
  const json = {
    endpoint: "https://push.example/subscription",
    expirationTime: null,
    keys: { p256dh: "p256dh", auth: "auth" },
  } satisfies PushSubscriptionJSON;
  const subscription = {
    endpoint: json.endpoint,
    toJSON: vi.fn(() => json),
    unsubscribe: vi.fn().mockResolvedValue(true),
  } as unknown as PushSubscription;
  return { json, subscription };
}

function installPushSupport(permission: NotificationPermission, currentSubscription: PushSubscription | null) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(currentSubscription),
      subscribe: vi.fn(),
    },
  } as unknown as ServiceWorkerRegistration;
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
  const requestPermission = vi.fn().mockResolvedValue("granted");
  Object.defineProperty(window, "Notification", { configurable: true, value: { permission, requestPermission } });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn().mockResolvedValue(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });
  return { registration, requestPermission };
}

function LocationStateProbe() {
  const location = useLocation();
  return <div data-testid="login-state">{JSON.stringify(location.state)}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/reporting/worklist/token?tab=urgent#case-42"]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <Routes>
          <Route path="/reporting/worklist/:token" element={<ReportingBoardMobilePage />} />
          <Route path="/login" element={<LocationStateProbe />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

async function openAccount() {
  await screen.findByText("Personal Reporting Desk");
  const accountButton = testState.user
    ? screen.getByRole("button", { name: new RegExp(testState.user.fullName?.trim() || testState.user.username, "i") })
    : screen.getByRole("button", { name: "Sign in" });
  fireEvent.click(accountButton);
}

describe("Personal Reporting Desk authentication and current-device notifications", () => {
  beforeEach(() => {
    testState.user = { id: 7, username: "reporter", fullName: "Dr Reader", role: "doctor" };
    testState.fetchView.mockResolvedValue(viewData());
    testState.fetchConfig.mockResolvedValue({ enabled: false, publicKey: null });
    testState.fetchStatus.mockResolvedValue({ enabled: false, lastSuccessAt: null });
    testState.fetchOhif.mockResolvedValue({ enabled: false });
    testState.subscribe.mockResolvedValue({ subscriptionId: 1 });
    testState.unsubscribe.mockResolvedValue({ disabled: true });
    testState.sendTest.mockResolvedValue({ attempted: 1, sent: 1, failed: 0 });
    testState.logout.mockResolvedValue(undefined);
    testState.noop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    testState.user = null;
    Reflect.deleteProperty(window, "PushManager");
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("passes the exact Personal Desk path, query, and hash into LoginPage", async () => {
    testState.user = null;
    renderPage();
    await openAccount();
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[1]);

    const state = await screen.findByTestId("login-state");
    expect(state.textContent).toContain("/reporting/worklist/token");
    expect(state.textContent).toContain("?tab=urgent");
    expect(state.textContent).toContain("#case-42");
  });

  it("shows the trimmed username when fullName is empty", async () => {
    testState.user = { id: 7, username: " reporter ", fullName: "   ", role: "doctor" };
    renderPage();

    expect(await screen.findByRole("button", { name: /reporter/i })).toBeTruthy();
  });

  it("passes the current public Desk URL to the existing logout flow", async () => {
    renderPage();
    await openAccount();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(testState.logout).toHaveBeenCalledWith("/reporting/worklist/token?tab=urgent#case-42"));
  });

  it("shows a non-empty trimmed full name", async () => {
    testState.user = { id: 7, username: "reporter", fullName: "  Dr Reader  ", role: "doctor" };
    renderPage();

    expect(await screen.findByRole("button", { name: /dr reader/i })).toBeTruthy();
  });

  it("does not call authenticated push APIs while anonymous", async () => {
    testState.user = null;
    installPushSupport("granted", null);
    renderPage();

    expect(await screen.findByText("Sign in to enable notifications")).toBeTruthy();
    await waitFor(() => expect(testState.fetchView).toHaveBeenCalled());
    expect(testState.fetchConfig).not.toHaveBeenCalled();
    expect(testState.fetchStatus).not.toHaveBeenCalled();
    expect(testState.subscribe).not.toHaveBeenCalled();
    expect(testState.unsubscribe).not.toHaveBeenCalled();
    expect(testState.sendTest).not.toHaveBeenCalled();
  });

  it("shows unsupported push state without working notification actions", async () => {
    renderPage();
    await openAccount();

    expect(screen.getByText("Notifications are not supported on this device/browser.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(testState.fetchConfig).not.toHaveBeenCalled();
  });

  it("shows the not-configured state and does not expose actions", async () => {
    installPushSupport("granted", null);
    renderPage();
    await openAccount();

    expect(screen.getByText("Notifications are not configured.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send test notification" })).toBeNull();
  });

  it("shows blocked permission without requesting permission again", async () => {
    const { requestPermission } = installPushSupport("denied", null);
    testState.fetchConfig.mockResolvedValue({ enabled: true, publicKey: "public-key" });
    renderPage();
    await openAccount();

    expect(screen.getByText("Notifications are blocked in your browser or device settings.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requests default permission once and subscribes a new browser subscription", async () => {
    const { json, subscription } = makeSubscription();
    const { registration, requestPermission } = installPushSupport("default", null);
    registration.pushManager.subscribe = vi.fn().mockResolvedValue(subscription);
    let currentSubscription: PushSubscription | null = null;
    registration.pushManager.getSubscription = vi.fn().mockImplementation(async () => currentSubscription);
    testState.fetchConfig.mockResolvedValue({ enabled: true, publicKey: "public-key" });
    testState.fetchStatus.mockResolvedValue({ enabled: true, lastSuccessAt: null });
    testState.subscribe.mockImplementation(async () => {
      currentSubscription = subscription;
      return { subscriptionId: 1 };
    });
    renderPage();
    await openAccount();

    expect(await screen.findByText("Notifications: Off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
    await waitFor(() => expect(registration.pushManager.subscribe).toHaveBeenCalledOnce());
    expect(testState.subscribe).toHaveBeenCalledWith("token", json);
    expect(await screen.findByText("Notifications enabled for this device.")).toBeTruthy();
    expect(await screen.findByText("Notifications: On")).toBeTruthy();
  });

  it("reuses an existing browser subscription and queries token-scoped status", async () => {
    const { json, subscription } = makeSubscription();
    const { registration } = installPushSupport("granted", subscription);
    registration.pushManager.subscribe = vi.fn();
    testState.fetchConfig.mockResolvedValue({ enabled: true, publicKey: "public-key" });
    testState.fetchStatus.mockResolvedValue({ enabled: true, lastSuccessAt: null });
    renderPage();
    await openAccount();

    expect(await screen.findByText("Notifications: On")).toBeTruthy();
    expect(testState.fetchStatus).toHaveBeenCalledWith("token", json);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(testState.unsubscribe).toHaveBeenCalledWith("token", json));
    await waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalledOnce());
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("shows Off with Enable and no active test action when the device is disabled", async () => {
    installPushSupport("granted", null);
    testState.fetchConfig.mockResolvedValue({ enabled: true, publicKey: "public-key" });
    renderPage();
    await openAccount();

    expect(await screen.findByText("Notifications: Off")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send test notification" })).toBeNull();
    expect(testState.sendTest).not.toHaveBeenCalled();
  });

  it("shows On with Disable and sends test only for the enabled current device", async () => {
    const { json, subscription } = makeSubscription();
    installPushSupport("granted", subscription);
    testState.fetchConfig.mockResolvedValue({ enabled: true, publicKey: "public-key" });
    testState.fetchStatus.mockResolvedValue({ enabled: true, lastSuccessAt: null });
    renderPage();
    await openAccount();

    expect(await screen.findByText("Notifications: On")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send test notification" }));

    await waitFor(() => expect(testState.sendTest).toHaveBeenCalledWith("token", json));
    expect(await screen.findByText("Test notification sent.")).toBeTruthy();
  });
});
