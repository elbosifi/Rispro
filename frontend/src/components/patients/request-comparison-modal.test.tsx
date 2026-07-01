import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequestComparisonModal } from "@/components/patients/request-comparison-modal";
import { fetchPreviousCompletedStudies } from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-hooks")>("@/lib/api-hooks");
  return {
    ...actual,
    fetchPreviousCompletedStudies: vi.fn(),
    createComparisonRequest: vi.fn(),
  };
});

describe("RequestComparisonModal", () => {
  it("does not bubble clicks to the patient drawer backdrop", async () => {
    vi.mocked(fetchPreviousCompletedStudies).mockResolvedValue([
      {
        bookingId: 42,
        patientId: 7,
        date: "2026-06-20",
        time: null,
        modalityId: 1,
        modalityCode: "CT",
        modalityName: "CT",
        examTypeId: 10,
        examName: "CT Brain",
        accessionNumber: "V2-000042",
        reportStatus: "unknown",
        studyInstanceUid: "1.2.3",
      },
    ]);
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
});
