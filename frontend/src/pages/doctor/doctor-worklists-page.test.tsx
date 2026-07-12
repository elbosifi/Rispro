import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DoctorWorklistsPage, MyReportingWorklistCard } from "./doctor-worklists-page";

const fetchMine = vi.fn();
const fetchAll = vi.fn();
vi.mock("@/lib/api-hooks", () => ({
  fetchMyDoctorReportingWorklist: () => fetchMine(),
  fetchDoctorReportingWorklists: () => fetchAll(),
  updateDoctorReportingWorklist: vi.fn(),
}));

function renderQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("Doctor worklist query states", () => {
  beforeEach(() => { fetchMine.mockReset(); fetchAll.mockReset(); });

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
      userActive: true, doctorActive: true, effectiveModalityCodes: ["CT"], assignedPendingCount: 2,
      eligibleUnassignedCount: 3, active: true, lastAccessedAt: null, expiresAt: null, subscriptionCount: 0,
    }]);
    renderQuery(<DoctorWorklistsPage />);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.getByText("Dr Example")).toBeTruthy();
  });
});
