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

  it("shows the landing page first and does not expose the destructive action immediately", async () => {
    renderPage();

    expect(await screen.findByText("إلغاء الموعد")).toBeTruthy();
    expect(screen.getByText("متابعة الإلغاء")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /تأكيد الإلغاء/i })).toBeNull();
    expect(fetchPublicAppointmentCancelPreview).toHaveBeenCalledWith("test-token");
    expect(screen.queryByRole("button", { name: /طلب موعد جديد/i })).toBeNull();
  });

  it("moves from landing to confirmation and requires acknowledgement before canceling", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("إلغاء الموعد");
    await user.click(screen.getByRole("button", { name: /متابعة الإلغاء/i }));

    expect(await screen.findByText("تأكيد إلغاء الموعد")).toBeTruthy();

    const confirmButton = screen.getByRole("button", { name: /تأكيد الإلغاء/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /أفهم أن هذا الإلغاء نهائي/i }));
    expect(confirmButton.disabled).toBe(false);

    await user.click(confirmButton);

    await waitFor(() => {
      expect(cancelPublicAppointment).toHaveBeenCalledWith("test-token");
    });

    expect(await screen.findByText("تم إلغاء الموعد بنجاح")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /تأكيد الإلغاء/i })).toBeNull();
  });

  it("shows the already-cancelled state when the QR link is reopened after cancellation", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValueOnce({
      bookingId: 12,
      patientDisplayName: "Test Patient",
      bookingDate: "2026-07-01",
      modalityName: "CT",
      examName: "CT Head",
      currentStatus: "cancelled",
    });

    renderPage();

    expect(await screen.findByText("هذا الموعد ملغى مسبقاً")).toBeTruthy();
    expect(screen.getByText("لا توجد أي إجراءات مطلوبة.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /تأكيد الإلغاء/i })).toBeNull();
  });

  it("shows the non-cancellable state for completed appointments", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockResolvedValueOnce({
      bookingId: 12,
      patientDisplayName: "Test Patient",
      bookingDate: "2026-07-01",
      modalityName: "CT",
      examName: "CT Head",
      currentStatus: "completed",
    });

    renderPage();

    expect(await screen.findByText("هذا الموعد غير قابل للإلغاء من هذه الصفحة")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /تأكيد الإلغاء/i })).toBeNull();
  });

  it("shows a safe invalid-link state", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockRejectedValue(
      new ApiError("Invalid cancellation token.", 400, { code: "invalid_token" })
    );

    renderPage();

    expect(await screen.findByText("رابط غير صالح أو منتهي الصلاحية")).toBeTruthy();
    expect(screen.queryByText("Test Patient")).toBeNull();
  });

  it("shows a safe expired-link state", async () => {
    vi.mocked(fetchPublicAppointmentCancelPreview).mockRejectedValue(
      new ApiError("Cancellation link has expired.", 401, { code: "expired_link" })
    );

    renderPage();

    expect(await screen.findByText("رابط غير صالح أو منتهي الصلاحية")).toBeTruthy();
    expect(screen.getByText(/انتهت صلاحية هذا الرابط/i)).toBeTruthy();
  });

  it("shows a retry-safe error when cancellation fails", async () => {
    const user = userEvent.setup();
    vi.mocked(cancelPublicAppointment).mockRejectedValueOnce(
      new ApiError("Temporary failure", 500, { code: "server_error" })
    );

    renderPage();

    await screen.findByText("إلغاء الموعد");
    await user.click(screen.getByRole("button", { name: /متابعة الإلغاء/i }));
    await user.click(screen.getByRole("checkbox", { name: /أفهم أن هذا الإلغاء نهائي/i }));
    await user.click(screen.getByRole("button", { name: /تأكيد الإلغاء/i }));

    expect(await screen.findByText(/تعذر إلغاء الموعد الآن/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /تأكيد الإلغاء/i })).toBeTruthy();
  });
});
