import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { ReportingBoardMobilePage } from "./reporting-board-mobile-page";
import type { ReportingBoardMobileCase, ReportingBoardMobileResponse, User } from "@/types/api";

const testState = vi.hoisted(() => ({
  user: null as User | null,
  fetchView: vi.fn(),
  claim: vi.fn(),
  finalize: vi.fn(),
  finalizeComparison: vi.fn(),
  fetchConfig: vi.fn(),
  fetchStatus: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  sendTest: vi.fn(),
  fetchOhif: vi.fn(),
  fetchRetrieval: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHistoricalCandidates: vi.fn(),
  fetchComparisonHistory: vi.fn(),
  fetchComparisonCandidates: vi.fn(),
  launchOhif: vi.fn(),
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
  assignReportingBoardMobileCaseToMe: testState.claim,
  createReportingBoardComplementaryRecall: testState.noop,
  fetchOhifViewerAvailability: testState.fetchOhif,
  fetchOhifRetrievalJob: testState.fetchRetrieval,
  fetchReportingBoardComparisonHistoricalPacsCandidates: testState.fetchComparisonCandidates,
  fetchReportingBoardComparisonHistory: testState.fetchComparisonHistory,
  fetchReportingBoardHistoricalPacsCandidates: testState.fetchHistoricalCandidates,
  fetchReportingBoardMobilePushConfig: testState.fetchConfig,
  fetchReportingBoardMobilePushStatus: testState.fetchStatus,
  fetchReportingBoardMobileView: testState.fetchView,
  fetchReportingBoardPatientHistory: testState.fetchHistory,
  finalizeComparisonRequest: testState.finalizeComparison,
  launchReportingBoardCaseInOhif: testState.noop,
  markReportingBoardCaseManualFinal: testState.finalize,
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
      finalizeOwnReports: true,
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
    testState.fetchHistory.mockResolvedValue({ items: [], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    testState.fetchHistoricalCandidates.mockResolvedValue({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    testState.fetchComparisonHistory.mockResolvedValue({ items: [], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    testState.fetchComparisonCandidates.mockResolvedValue({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
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

function makeCase(overrides: Partial<ReportingBoardMobileCase> = {}): ReportingBoardMobileCase {
  return {
    caseType: "appointment",
    caseKey: "appointment:42",
    appointmentId: 42,
    comparisonRequestId: null,
    patientName: "Patient One",
    mrn: "MRN-42",
    accessionNumber: "ACC-42",
    date: "2026-09-02",
    time: "09:30",
    modality: "MR",
    exam: "MRI Knee",
    category: "non_oncology",
    assignedDoctor: "Dr Reader",
    assignedDoctorId: 7,
    assignmentOrigin: "rispro",
    finalizedByDoctorId: null,
    finalizedByDoctorName: null,
    sonicDicomFinalizedByAccount: null,
    assignmentMatch: "not_applicable",
    priority: "Routine",
    priorityCode: "routine",
    reportStatus: "draft",
    requiresReport: true,
    appointmentStatus: "completed",
    assignmentStatus: "assigned",
    canAssign: true,
    exclusionReason: null,
    completedAt: "2026-09-02T07:00:00.000Z",
    firstAssignedAt: "2026-09-02T07:15:00.000Z",
    currentAssignedAt: "2026-09-02T07:15:00.000Z",
    reportFinalAt: null,
    completedToAssignedMinutes: 15,
    currentAssignmentAgeMinutes: 135,
    completedUnassignedAgeMinutes: null,
    completedAgeMinutes: 150,
    overdue: false,
    canAssignToMe: true,
    canReassign: false,
    canUnassign: false,
    actionDisabledReason: null,
    ...overrides,
  };
}

describe("Personal Reporting Desk case presentation", () => {
  beforeEach(() => {
    testState.user = { id: 7, username: "reporter", fullName: "Dr Reader", role: "doctor" };
    testState.fetchView.mockResolvedValue(viewData());
    testState.claim.mockResolvedValue({ assignmentId: 1 });
    testState.finalize.mockResolvedValue({ ok: true, appointmentId: 42, status: "manual_final" });
    testState.finalizeComparison.mockResolvedValue({});
    testState.fetchConfig.mockResolvedValue({ enabled: false, publicKey: null });
    testState.fetchStatus.mockResolvedValue({ enabled: false, lastSuccessAt: null });
    testState.fetchOhif.mockResolvedValue({ enabled: false, configured: false, openMode: "new_tab" });
    testState.fetchHistory.mockResolvedValue({ items: [], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    testState.fetchHistoricalCandidates.mockResolvedValue({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    testState.fetchComparisonHistory.mockResolvedValue({ items: [], pacsStatus: "available", historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    testState.fetchComparisonCandidates.mockResolvedValue({ historicalCandidates: [], historicalPacsIndexStatus: "ready", historicalPacsLastSuccessAt: null });
    testState.noop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    testState.user = null;
  });

  it("shows high-value case information once without clinical indication or duplicate modality", async () => {
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase()] });
    renderPage();

    expect(await screen.findByText("Patient One")).toBeTruthy();
    expect(screen.getByText("MRI Knee")).toBeTruthy();
    expect(screen.getAllByText("MR")).toHaveLength(1);
    expect(screen.getByText("Routine")).toBeTruthy();
    expect(screen.getByText("Assigned 2 h 15 min")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.queryByText(/clinical indication/i)).toBeNull();
    expect(screen.queryByText("MR · MR")).toBeNull();
  });

  it("shows the Comparison badge on comparison cards", async () => {
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase({
      caseType: "comparison",
      caseKey: "comparison:9",
      comparisonRequestId: 9,
      exam: "CT Chest",
      modality: "CT",
    })] });
    renderPage();

    expect(await screen.findByText("CT Chest")).toBeTruthy();
    expect(screen.getByText("Comparison")).toBeTruthy();
  });

  it("shows Patient History on an authorized appointment card without prefetching it", async () => {
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase()] });
    renderPage();

    expect(await screen.findByRole("button", { name: "Patient History" })).toBeTruthy();
    expect(testState.fetchHistory).not.toHaveBeenCalled();
  });

  it("shows Patient History on an authorized comparison card", async () => {
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase({ caseType: "comparison", caseKey: "comparison:9", comparisonRequestId: 9 })] });
    renderPage();

    expect(await screen.findByRole("button", { name: "Patient History" })).toBeTruthy();
  });

  it("does not expose an active Patient History action to anonymous users", async () => {
    testState.user = null;
    testState.fetchView.mockResolvedValue({ ...viewData(), currentDoctorId: null, allowedActions: { ...viewData().allowedActions, authenticated: false, readOnly: true }, cases: [makeCase()] });
    renderPage();

    await screen.findByText("Patient One");
    expect(screen.queryByRole("button", { name: "Patient History" })).toBeNull();
  });

  it("does not expose history to an ordinary doctor viewing another doctor's token", async () => {
    testState.user = { id: 8, username: "other", fullName: "Dr Other", role: "doctor" };
    testState.fetchView.mockResolvedValue({ ...viewData(), currentDoctorId: 8, allowedActions: { ...viewData().allowedActions, accessLevel: "doctor", readOnly: true, readOnlyReason: "This worklist does not belong to your doctor profile." }, cases: [makeCase()] });
    renderPage();

    await screen.findByText("Patient One");
    expect(screen.queryByRole("button", { name: "Patient History" })).toBeNull();
  });

  it("does not offer finalized history to anonymous viewers", async () => {
    testState.user = null;
    const view = viewData();
    testState.fetchView.mockResolvedValue({ ...view, currentDoctorId: null, allowedActions: { ...view.allowedActions, authenticated: false, accessLevel: "public", readOnly: true }, cases: [] });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("option", { name: "Finalized by this doctor" })).toBeNull();
  });

  it("offers finalized history to the worklist owner", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    expect(await screen.findByRole("option", { name: "Finalized by this doctor" })).toBeTruthy();
  });

  it.each([
    ["supervisor", "supervisor" as const],
    ["admin", "admin" as const],
  ])("offers finalized history to an authorized %s viewing the worklist", async (_label, accessLevel) => {
    testState.user = { id: 99, username: "manager", fullName: "Dr Manager", role: accessLevel === "admin" ? "super_admin" : "supervisor" };
    const view = viewData();
    testState.fetchView.mockResolvedValue({ ...view, currentDoctorId: 99, allowedActions: { ...view.allowedActions, accessLevel, readOnly: false } });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    expect(await screen.findByRole("option", { name: "Finalized by this doctor" })).toBeTruthy();
  });

  it("does not offer finalized history to another ordinary doctor", async () => {
    testState.user = { id: 8, username: "other", fullName: "Dr Other", role: "doctor" };
    const view = viewData();
    testState.fetchView.mockResolvedValue({ ...view, currentDoctorId: 8, allowedActions: { ...view.allowedActions, accessLevel: "doctor", readOnly: true, readOnlyReason: "This worklist does not belong to your doctor profile." } });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("option", { name: "Finalized by this doctor" })).toBeNull();
  });

  it.each([
    { label: "Priority first", value: "priority_study_date", expected: { sortBy: "priority_study_date", sortDirection: "asc", pinUrgentToTop: true } },
    { label: "Oldest study first", value: "oldest_study", expected: { sortBy: "study_date", sortDirection: "asc", pinUrgentToTop: false } },
    { label: "Newest study first", value: "newest_study", expected: { sortBy: "study_date", sortDirection: "desc", pinUrgentToTop: false } },
    { label: "Longest assigned first", value: "longest_assigned", expected: { sortBy: "longest_assigned_not_final", sortDirection: "asc", pinUrgentToTop: false } },
  ])("sends the exact Personal Desk fetch mapping for $label", async ({ value, expected }) => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Sort" }), { target: { value } });

    await waitFor(() => expect(testState.fetchView).toHaveBeenLastCalledWith("token", expect.objectContaining(expected)));
  });

  it("shows finalized history counters in My Cases and disables the other quick tabs", async () => {
    const view = viewData();
    testState.fetchView.mockResolvedValue({
      ...view,
      counters: { total: 3, assignedToMe: 3, unassigned: 0, urgent: 0, requiredNotFinal: 0, overdue: 0 },
      cases: [makeCase({ reportStatus: "final", canAssignToMe: false })],
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Report state" }), { target: { value: "final" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /My Cases 3/ })).toBeTruthy());
    expect((screen.getByRole("combobox", { name: "Report state" }) as HTMLSelectElement).value).toBe("final");
    expect((screen.getByRole("button", { name: /Available 0/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Urgent 0/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Overdue 0/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens history from the card without opening Details first", async () => {
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase()] });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Patient History" }));
    expect(await screen.findByText("Current RISpro / PACS studies")).toBeTruthy();
    expect(screen.queryByText("MRN:")).toBeNull();
    expect(testState.fetchHistory).toHaveBeenCalledWith(42);
  });

  it("returns from Details-origin history to the same Details case", async () => {
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase()] });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Open case details for Patient One" }));
    const details = screen.getByRole("dialog");
    fireEvent.click(within(details).getByRole("button", { name: "Patient History" }));
    expect(await screen.findByText("Current RISpro / PACS studies")).toBeTruthy();
    expect(screen.queryByText("MRN:")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to case" }));
    expect(await screen.findByText("MRN:")).toBeTruthy();
    expect(screen.queryByText("Current RISpro / PACS studies")).toBeNull();
  });

  it("shows the complete details hierarchy, comparison context, copy actions, and PACS note", async () => {
    const row = makeCase({
      caseType: "comparison",
      caseKey: "comparison:9",
      comparisonRequestId: 9,
      linkedPreviousStudyDate: "2026-08-01",
      linkedPreviousAccessionNumber: "PREV-9",
      comparisonReason: "Assess interval change",
      comparisonPreparationNote: "Prior study prepared by imaging team.",
      sonicDicomStudyNote: "SonicDICOM note for this study.",
    });
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [row] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open case details for Patient One" }));

    expect(screen.getByText("MRN-42")).toBeTruthy();
    expect(screen.getByText("ACC-42")).toBeTruthy();
    expect(screen.getByText("Category:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy MRN" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy accession" })).toBeTruthy();
    expect(screen.getByText("2026-08-01")).toBeTruthy();
    expect(screen.getByText("PREV-9")).toBeTruthy();
    expect(screen.getByText("Assess interval change")).toBeTruthy();
    expect(screen.getByText("Prior study prepared by imaging team.")).toBeTruthy();
    expect(screen.getByText("SonicDICOM note for this study.")).toBeTruthy();
  });

  it("omits a null PACS note from details", async () => {
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase({ sonicDicomStudyNote: null })] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open case details for Patient One" }));

    expect(screen.queryByText(/SonicDICOM note:/)).toBeNull();
  });

  it("does not render privileged viewers for an anonymous Personal Desk", async () => {
    testState.user = null;
    testState.fetchOhif.mockResolvedValue({ enabled: true, configured: true, openMode: "new_tab" });
    testState.fetchView.mockResolvedValue({ ...viewData(), allowedActions: { ...viewData().allowedActions, authenticated: false }, cases: [makeCase()] });
    renderPage();

    expect(await screen.findByText("Patient One")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open in SonicDICOM" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open in OHIF" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open case details for Patient One" }));
    expect(screen.queryByRole("link", { name: "Open in SonicDICOM" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open in OHIF" })).toBeNull();
  });

  it("keeps existing additional-imaging and finalization conditions while hiding finalization for report-not-required cases", async () => {
    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase()] });
    const firstRender = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open case details for Patient One" }));

    expect(screen.getByRole("button", { name: "Request additional imaging" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finalize report" })).toBeTruthy();
    firstRender.unmount();

    testState.fetchView.mockResolvedValue({ ...viewData(), cases: [makeCase({ requiresReport: false, exclusionReason: "report_not_required" })] });
    renderPage();
    await screen.findByText("Patient One");
    fireEvent.click(screen.getByRole("button", { name: "Open case details for Patient One" }));
    expect(screen.queryByRole("button", { name: "Finalize report" })).toBeNull();
  });

  async function openCaseDetails(row: ReportingBoardMobileCase, allowedActions: Partial<ReportingBoardMobileResponse["allowedActions"]> = {}) {
    testState.fetchView.mockResolvedValue({ ...viewData(), allowedActions: { ...viewData().allowedActions, ...allowedActions }, cases: [row] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open case details for Patient One" }));
    return screen.getByRole("dialog");
  }

  it.each([
    ["available", makeCase({ assignedDoctor: null, assignedDoctorId: null, assignmentStatus: "unassigned", canAssignToMe: true }), true, {}],
    ["urgent", makeCase({ assignedDoctor: null, assignedDoctorId: null, assignmentStatus: "unassigned", canAssignToMe: true, priority: "Urgent", priorityCode: "urgent" }), true, {}],
    ["other doctor", makeCase({ assignedDoctor: "Dr Other", assignedDoctorId: 8, assignmentStatus: "assigned", canAssignToMe: false }), false, {}],
    ["no permission", makeCase({ canAssignToMe: false }), false, { finalizeOwnReports: false }],
    ["report not required", makeCase({ requiresReport: false, exclusionReason: "report_not_required", canAssignToMe: false }), false, {}],
    ["final", makeCase({ reportStatus: "final", canAssignToMe: false }), false, {}],
  ] as const)("does not expose appointment self-finalization for %s cases", async (_label, row, canClaim, allowedActions) => {
    const view = await openCaseDetails(row, allowedActions);
    expect(screen.queryByRole("button", { name: "Finalize report" })).toBeNull();
    expect(Boolean(within(view).queryByRole("button", { name: "Claim case" }))).toBe(canClaim);
  });

  it("shows appointment self-finalization only for the assigned doctor with the server capability", async () => {
    const view = await openCaseDetails(makeCase());
    expect(within(view).getByRole("button", { name: "Finalize report" })).toBeTruthy();
  });

  it.each([
    ["assigned", makeCase({ caseType: "comparison", caseKey: "comparison:9", appointmentId: 0, comparisonRequestId: 9 }), true],
    ["unassigned", makeCase({ caseType: "comparison", caseKey: "comparison:10", appointmentId: 0, comparisonRequestId: 10, assignedDoctor: null, assignedDoctorId: null, assignmentStatus: "unassigned", canAssignToMe: true }), false],
    ["another doctor", makeCase({ caseType: "comparison", caseKey: "comparison:11", appointmentId: 0, comparisonRequestId: 11, assignedDoctor: "Dr Other", assignedDoctorId: 8, assignmentStatus: "assigned", canAssignToMe: false }), false],
  ] as const)("shows comparison self-finalization only for an assigned current doctor (%s)", async (_label, row, canFinalize) => {
    const view = await openCaseDetails(row);
    const action = within(view).queryByRole("button", { name: "Finalize comparison report" });
    expect(Boolean(action)).toBe(canFinalize);
  });

  it("invalidates the Personal Desk after a successful claim", async () => {
    const view = await openCaseDetails(makeCase({ assignedDoctor: null, assignedDoctorId: null, assignmentStatus: "unassigned", canAssignToMe: true }));
    const initialFetches = testState.fetchView.mock.calls.length;

    fireEvent.click(within(view).getByRole("button", { name: "Claim case" }));

    expect(await screen.findByText("Case claimed. It is now in My Cases.")).toBeTruthy();
    await waitFor(() => expect(testState.fetchView.mock.calls.length).toBeGreaterThan(initialFetches));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refreshes and closes stale details after a claim conflict", async () => {
    const error = Object.assign(new Error("Case is no longer eligible to claim."), { status: 409 });
    testState.claim.mockRejectedValue(error);
    const view = await openCaseDetails(makeCase({ assignedDoctor: null, assignedDoctorId: null, assignmentStatus: "unassigned", canAssignToMe: true }));
    const initialFetches = testState.fetchView.mock.calls.length;

    fireEvent.click(within(view).getByRole("button", { name: "Claim case" }));

    expect(await screen.findByText("This case is no longer available to claim. The desk was refreshed.")).toBeTruthy();
    await waitFor(() => expect(testState.fetchView.mock.calls.length).toBeGreaterThan(initialFetches));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refreshes and closes stale details after appointment finalization fails", async () => {
    testState.finalize.mockRejectedValue(new Error("No active reporting assignment found."));
    const view = await openCaseDetails(makeCase());
    const initialFetches = testState.fetchView.mock.calls.length;
    vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(within(view).getByRole("button", { name: "Finalize report" }));

    expect(await screen.findByText("No active reporting assignment found.")).toBeTruthy();
    await waitFor(() => expect(testState.fetchView.mock.calls.length).toBeGreaterThan(initialFetches));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refreshes and closes stale details after comparison finalization fails", async () => {
    testState.finalizeComparison.mockRejectedValue(new Error("The comparison assignment changed."));
    const view = await openCaseDetails(makeCase({ caseType: "comparison", caseKey: "comparison:12", appointmentId: 0, comparisonRequestId: 12 }));
    fireEvent.click(within(view).getByRole("button", { name: "Finalize comparison report" }));
    const finalDialog = screen.getAllByRole("dialog").at(-1)!;
    fireEvent.change(within(finalDialog).getByRole("textbox"), { target: { value: "Final comparison text" } });
    const initialFetches = testState.fetchView.mock.calls.length;
    vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(within(finalDialog).getByRole("button", { name: "Finalize comparison" }));

    expect(await screen.findByText("The comparison assignment changed.")).toBeTruthy();
    await waitFor(() => expect(testState.fetchView.mock.calls.length).toBeGreaterThan(initialFetches));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
