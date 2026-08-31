import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestComparisonModal } from "@/components/patients/request-comparison-modal";
import { fetchComparisonReportingDoctors, fetchPreviousCompletedStudies } from "@/lib/api-hooks";

let currentUser: { role: string } | null = { role: "receptionist" };

vi.mock("@/lib/api-hooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-hooks")>("@/lib/api-hooks");
  return {
    ...actual,
    fetchPreviousCompletedStudies: vi.fn(),
    fetchComparisonReportingDoctors: vi.fn(),
    createComparisonRequest: vi.fn(),
  };
});

vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: currentUser }) }));

const study = { bookingId: 42, patientId: 7, date: "2026-06-20", time: null, modalityId: 1, modalityCode: "CT", modalityName: "CT", examTypeId: 10, examName: "CT Brain", accessionNumber: "V2-000042", reportStatus: "unknown" as const, studyInstanceUid: "1.2.3" };

beforeEach(() => {
  vi.clearAllMocks(); currentUser = { role: "receptionist" };
  vi.mocked(fetchPreviousCompletedStudies).mockResolvedValue([study]);
  vi.mocked(fetchComparisonReportingDoctors).mockResolvedValue([{ id: 55, displayName: "Dr Test" }]);
});

describe("RequestComparisonModal", () => {
  it("does not bubble clicks to the patient drawer backdrop", async () => {
    const parentClose = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <div onClick={parentClose}>
          <RequestComparisonModal patientId={7} onClose={vi.fn()} />
        </div>
      </QueryClientProvider>
    );

    await screen.findByText(/CT Brain/);
    await userEvent.click(screen.getByRole("radio", { name: /CT Brain/ }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: /Request comparison/i })).toBeTruthy());
    expect(parentClose).not.toHaveBeenCalled();
  });

  it("shows the planned reporting-doctor selector to supervisors", async () => {
    currentUser = { role: "supervisor" }; const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><RequestComparisonModal patientId={7} onClose={vi.fn()} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("radio", { name: /CT Brain/ }));
    expect(await screen.findByRole("combobox", { name: /Assign reporting doctor/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Dr Test" })).toBeTruthy();
  });

  it("does not show the planned reporting-doctor selector to receptionists", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><RequestComparisonModal patientId={7} onClose={vi.fn()} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("radio", { name: /CT Brain/ }));
    expect(screen.queryByRole("combobox", { name: /Assign reporting doctor/i })).toBeNull();
    expect(fetchComparisonReportingDoctors).not.toHaveBeenCalled();
  });
});
