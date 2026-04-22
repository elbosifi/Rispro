import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import PublicCancelAppointmentPage from "./cancel-appointment-page";
import {
  cancelPublicAppointment,
  fetchPublicAppointmentCancelPreview,
} from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", () => ({
  fetchPublicAppointmentCancelPreview: vi.fn(),
  cancelPublicAppointment: vi.fn(),
}));

function renderPage(entry = "/public/cancel-appointment?t=test-token") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/public/cancel-appointment" element={<PublicCancelAppointmentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PublicCancelAppointmentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValue({
      bookingId: 12,
      patientDisplayName: "Test Patient",
      bookingDate: "2026-07-01",
      modalityName: "CT",
      examName: "CT Head",
      currentStatus: "scheduled",
    });
    vi.mocked(cancelPublicAppointment).mockResolvedValue({
      ok: true,
      alreadyCancelled: false,
      bookingId: 12,
      status: "cancelled",
    });
  });

  it("loads preview from token", async () => {
    renderPage();

    expect(await screen.findByText("إلغاء الموعد")).toBeTruthy();
    expect(await screen.findByText(/Test Patient/i)).toBeTruthy();
    expect(fetchPublicAppointmentCancelPreview).toHaveBeenCalledWith("test-token");
  });

  it("confirm triggers cancellation", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("إلغاء الموعد");
    await user.click(screen.getByRole("button", { name: /تأكيد الإلغاء/i }));

    await waitFor(() => {
      expect(cancelPublicAppointment).toHaveBeenCalledWith("test-token");
    });
    expect(await screen.findByText(/تم إلغاء الموعد بنجاح/i)).toBeTruthy();
  });

  it("shows expired-link state", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockRejectedValue(
      new ApiError("Cancellation link has expired.", 401, { code: "expired_link" })
    );

    renderPage();

    expect(await screen.findByText(/انتهت صلاحية رابط الإلغاء/i)).toBeTruthy();
  });
});
