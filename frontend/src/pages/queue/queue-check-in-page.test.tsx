import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QueueCheckInPage from "./queue-check-in-page";
import { LanguageProvider } from "@/providers/language-provider-component";
import type { QueueSnapshot } from "@/types/api";

const fetchQueueSnapshotMock = vi.fn();
const fetchStatisticsMock = vi.fn();
const scanIntoQueueMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchQueueSnapshot: (...args: unknown[]) => fetchQueueSnapshotMock(...args),
  fetchStatistics: (...args: unknown[]) => fetchStatisticsMock(...args),
  scanIntoQueue: (...args: unknown[]) => scanIntoQueueMock(...args),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock("@/lib/date-format", async () => {
  const actual = await vi.importActual<typeof import("@/lib/date-format")>("@/lib/date-format");
  return {
    ...actual,
    todayIsoDateLy: () => "2026-06-18",
  };
});

const emptyQueue: QueueSnapshot = {
  queueDate: "2026-06-18",
  reviewTime: "18:00",
  reviewActive: false,
  summary: {
    total_appointments: 0,
    scheduled_count: 0,
    waiting_count: 0,
    no_show_count: 0,
    arrived_count: 0,
  },
  queueEntries: [],
  noShowCandidates: [],
  oldNoShowCandidates: [],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <QueueCheckInPage />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("QueueCheckInPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("rispro-language", "en");
    fetchQueueSnapshotMock.mockResolvedValue(emptyQueue);
    fetchStatisticsMock.mockResolvedValue({ summary: {}, modalityBreakdown: [] });
    scanIntoQueueMock.mockResolvedValue({ ok: true, bookingId: 44 });
  });

  it("shows checked-in time after a successful scan when the refreshed queue entry has an arrival timestamp", async () => {
    fetchQueueSnapshotMock
      .mockResolvedValue({
        ...emptyQueue,
        queueEntries: [
          {
            id: 44,
            queueDate: "2026-06-18",
            queueNumber: 1,
            queueStatus: "waiting",
            arrivedAt: "2026-06-18T08:15:00Z",
            scannedAt: "2026-06-18T08:15:00Z",
            appointmentId: 44,
            accessionNumber: "ACC-44",
            appointmentStatus: "waiting",
            isWalkIn: false,
            patientId: 22,
            arabicFullName: "Patient Name",
            englishFullName: "Patient Name",
            phone1: null,
            nationalId: null,
            modalityNameAr: "CT",
            modalityNameEn: "CT",
            examNameAr: "Head",
            examNameEn: "Head",
          },
        ],
      });

    const { container } = renderPage();
    const input = container.querySelector<HTMLInputElement>("#queue-check-in-scan");
    expect(input).toBeTruthy();

    fireEvent.change(input!, { target: { value: "V2-000044" } });
    fireEvent.submit(input!.closest("form")!);

    await waitFor(() => {
      expect(scanIntoQueueMock.mock.calls[0]?.[0]).toBe("V2-000044");
      expect(screen.getByTestId("queue-check-in-time").textContent).toMatch(/Checked in at 10:15/i);
    });
  });
});
