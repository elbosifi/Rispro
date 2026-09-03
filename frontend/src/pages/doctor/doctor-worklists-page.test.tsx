import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DoctorWorklistsPage, MyReportingWorklistCard } from "./doctor-worklists-page";

const fetchMine = vi.fn();
const fetchAll = vi.fn();
const emailLink = vi.fn();
vi.mock("@/lib/api-hooks", () => ({
  fetchMyDoctorReportingWorklist: () => fetchMine(),
  fetchDoctorReportingWorklists: () => fetchAll(),
  emailDoctorReportingWorklistLink: (id: number) => emailLink(id),
  updateDoctorReportingWorklist: vi.fn(),
}));

function renderQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("Doctor worklist query states", () => {
  beforeEach(() => { fetchMine.mockReset(); fetchAll.mockReset(); emailLink.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows personal API errors and retries without claiming the worklist is missing", async () => {
    fetchMine.mockRejectedValueOnce(new Error("Request timed out after 15s.")).mockResolvedValueOnce({
      id: 1, token: "token", active: true, effectiveModalityCodes: [], assignedPendingCount: 0,
      eligibleUnassignedCount: 0, lastAccessedAt: null, subscriptionCount: 0,
      scopeMessage: "No Reporting Board modalities are both globally enabled and permitted for this doctor.",
    });
    renderQuery(<MyReportingWorklistCard />);
    expect(await screen.findByText("Unable to load My Reporting Worklist")).toBeTruthy();
    expect(screen.getByText("Request timed out after 15s.")).toBeTruthy();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No Reporting Board modalities are both globally enabled/)).toBeTruthy();
  });

  it("distinguishes directory errors, empty results, and loaded rows", async () => {
    fetchAll.mockRejectedValueOnce(new Error("Forbidden"));
    const first = renderQuery(<DoctorWorklistsPage />);
    expect(await screen.findByText("Unable to load Doctor Worklists")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    first.unmount();

    fetchAll.mockResolvedValueOnce([]);
    const second = renderQuery(<DoctorWorklistsPage />);
    expect(await screen.findByText("No doctor worklists are currently provisioned.")).toBeTruthy();
    second.unmount();

    fetchAll.mockResolvedValueOnce([{
      id: 2, token: "token-2", doctorDisplayName: "Dr Example", username: "doctor", doctorRole: "consultant",
      doctorEmail: "doctor@example.com",
      userActive: true, doctorActive: true, effectiveModalityCodes: ["CT"], assignedPendingCount: 2,
      eligibleUnassignedCount: 3, active: true, lastAccessedAt: null, expiresAt: null, subscriptionCount: 0,
    }]);
    renderQuery(<DoctorWorklistsPage />);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.getByText("Dr Example")).toBeTruthy();
    expect(screen.getByText("doctor@example.com")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Email link" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("confirms the fixed stored email, queues only the worklist id, and reports asynchronous success", async () => {
    fetchAll.mockResolvedValueOnce([{
      id: 7, token: "token-7", doctorDisplayName: "Dr Example", username: "doctor", doctorRole: "consultant",
      doctorEmail: "doctor@example.com", userActive: true, doctorActive: true, effectiveModalityCodes: [],
      assignedPendingCount: 0, eligibleUnassignedCount: 0, active: true, lastAccessedAt: null, expiresAt: null,
      revokedAt: null, adminDisabledAt: null, subscriptionCount: 0,
    }]);
    emailLink.mockResolvedValueOnce({ queued: true, outboxId: 44, status: "pending", recipientEmail: "doctor@example.com" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderQuery(<DoctorWorklistsPage />);

    const button = await screen.findByRole("button", { name: "Email link" });
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith("Send this Personal Reporting Desk link to doctor@example.com?");
    await waitFor(() => expect(emailLink).toHaveBeenCalledTimes(1));
    expect(emailLink).toHaveBeenCalledWith(7);
    expect(emailLink.mock.calls[0]).toHaveLength(1);
    expect(await screen.findByText("Email queued for delivery to doctor@example.com.")).toBeTruthy();
  });

  it("keeps the email action disabled while pending and shows API failures", async () => {
    let resolveRequest!: (value: unknown) => void;
    emailLink.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    fetchAll.mockResolvedValueOnce([{
      id: 8, token: "token-8", doctorDisplayName: "Dr Pending", username: "pending", doctorRole: "consultant",
      doctorEmail: "pending@example.com", userActive: true, doctorActive: true, effectiveModalityCodes: [],
      assignedPendingCount: 0, eligibleUnassignedCount: 0, active: true, lastAccessedAt: null, expiresAt: null,
      revokedAt: null, adminDisabledAt: null, subscriptionCount: 0,
    }]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const pending = renderQuery(<DoctorWorklistsPage />);
    const button = await screen.findByRole("button", { name: "Email link" });
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    resolveRequest({ queued: true, outboxId: 45, status: "pending", recipientEmail: "pending@example.com" });
    expect(await screen.findByText("Email queued for delivery to pending@example.com.")).toBeTruthy();
    pending.unmount();

    fetchAll.mockReset().mockResolvedValueOnce([{
      id: 9, token: "token-9", doctorDisplayName: "Dr Failure", username: "failure", doctorRole: "consultant",
      doctorEmail: "failure@example.com", userActive: true, doctorActive: true, effectiveModalityCodes: [],
      assignedPendingCount: 0, eligibleUnassignedCount: 0, active: true, lastAccessedAt: null, expiresAt: null,
      revokedAt: null, adminDisabledAt: null, subscriptionCount: 0,
    }]);
    emailLink.mockReset().mockRejectedValueOnce(new Error("Outbound email is disabled."));
    const second = renderQuery(<DoctorWorklistsPage />);
    const failureButton = await screen.findByRole("button", { name: "Email link" });
    fireEvent.click(failureButton);
    expect(await screen.findByText("Outbound email is disabled.")).toBeTruthy();
    second.unmount();
  });

  it("shows missing email and disables email for unavailable doctors or worklists", async () => {
    fetchAll.mockResolvedValueOnce([
      {
        id: 10, token: "token-10", doctorDisplayName: "No Email", username: "no-email", doctorRole: "consultant",
        doctorEmail: "", userActive: true, doctorActive: true, effectiveModalityCodes: [], assignedPendingCount: 0,
        eligibleUnassignedCount: 0, active: true, lastAccessedAt: null, expiresAt: null, subscriptionCount: 0,
      },
      {
        id: 11, token: "token-11", doctorDisplayName: "Inactive User", username: "inactive-user", doctorRole: "consultant",
        doctorEmail: "inactive-user@example.com", userActive: false, doctorActive: true, effectiveModalityCodes: [], assignedPendingCount: 0,
        eligibleUnassignedCount: 0, active: true, lastAccessedAt: null, expiresAt: null, subscriptionCount: 0,
      },
      {
        id: 12, token: "token-12", doctorDisplayName: "Inactive Profile", username: "inactive-profile", doctorRole: "consultant",
        doctorEmail: "inactive-profile@example.com", userActive: true, doctorActive: false, effectiveModalityCodes: [], assignedPendingCount: 0,
        eligibleUnassignedCount: 0, active: true, lastAccessedAt: null, expiresAt: null, subscriptionCount: 0,
      },
      {
        id: 13, token: "token-13", doctorDisplayName: "Inactive Link", username: "inactive-link", doctorRole: "consultant",
        doctorEmail: "inactive-link@example.com", userActive: true, doctorActive: true, effectiveModalityCodes: [], assignedPendingCount: 0,
        eligibleUnassignedCount: 0, active: false, lastAccessedAt: null, expiresAt: null, subscriptionCount: 0,
      },
    ]);
    renderQuery(<DoctorWorklistsPage />);
    expect(await screen.findByText("No email on account")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Email link" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("does not expose the manager email action on My Reporting Worklist", async () => {
    fetchMine.mockResolvedValueOnce({
      id: 20, token: "token-20", doctorDisplayName: "Dr Mine", username: "mine", doctorRole: "consultant",
      doctorEmail: "mine@example.com", userActive: true, doctorActive: true, effectiveModalityCodes: [],
      assignedPendingCount: 0, eligibleUnassignedCount: 0, active: true, lastAccessedAt: null, expiresAt: null,
      revokedAt: null, adminDisabledAt: null, subscriptionCount: 0, scopeMessage: null,
    });
    renderQuery(<MyReportingWorklistCard />);
    await screen.findByText("My Reporting Worklist");
    expect(screen.queryByRole("button", { name: "Email link" })).toBeNull();
  });
});
