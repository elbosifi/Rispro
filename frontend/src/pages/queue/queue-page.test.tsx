import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QueuePage from "./queue-page";
import { ApiError } from "@/lib/api-client";
import { LanguageProvider } from "@/providers/language-provider";
import type { QueueSnapshot } from "@/types/api";

const fetchQueueSnapshotMock = vi.fn();
const scanIntoQueueMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchSettingsMock = vi.fn();
const pushToastMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchQueueSnapshot: (...args: unknown[]) => fetchQueueSnapshotMock(...args),
  scanIntoQueue: (...args: unknown[]) => scanIntoQueueMock(...args),
  addWalkIn: vi.fn(),
  confirmNoShow: vi.fn(),
  confirmAllOldNoShows: vi.fn(),
  cancelAppointment: vi.fn(),
  searchPatients: vi.fn(),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchSettings: (...args: unknown[]) => fetchSettingsMock(...args),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: (...args: unknown[]) => pushToastMock(...args),
}));

vi.mock("@/components/patients/patient-drawer", () => ({
  PatientDrawer: () => null,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const queueSnapshot: QueueSnapshot = {
  queueDate: "2026-06-18",
  reviewTime: "18:00",
  reviewActive: false,
  summary: {
    total_appointments: 1,
    scheduled_count: 1,
    waiting_count: 0,
    no_show_count: 0,
    arrived_count: 0,
  },
  queueEntries: [
    {
      id: 1,
      queueDate: "2026-06-18",
      queueNumber: 1,
      queueStatus: "waiting",
      appointmentId: 44,
      accessionNumber: "ACC-44",
      appointmentStatus: "scheduled",
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
          <QueuePage />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("QueuePage patient requirement errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("rispro-language", "en");
    fetchQueueSnapshotMock.mockResolvedValue(queueSnapshot);
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [] });
    fetchSettingsMock.mockResolvedValue({ walk_in_queue: "disabled" });
  });

  it("shows a persistent alert and keeps the toast when queue entry requirements fail", async () => {
    const user = userEvent.setup();
    scanIntoQueueMock.mockRejectedValue(
      new ApiError(
        "Missing patient data",
        422,
        { patientId: 22, missingPhone: true, missingIdentifier: true },
        ["patient_phone_required", "patient_primary_identifier_required"]
      )
    );

    renderPage();

    await user.click(await screen.findByRole("button", { name: /Enter to Queue/i }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: /Validation Error/i })).toBeTruthy();
    expect(within(alert).getByText(/Phone 1 and primary identifier are missing/i)).toBeTruthy();
    expect(within(alert).getByText(/Complete the missing patient data before entering the patient into the queue/i)).toBeTruthy();
    expect(within(alert).getByRole("button", { name: /Manage registration/i })).toBeTruthy();

    await waitFor(() => {
      expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "error",
        title: "Scan failed.",
      }));
    });

    await user.click(within(alert).getByRole("button", { name: /Manage registration/i }));
    expect(navigateMock).toHaveBeenCalledWith("/registrations?appointmentId=44&patientId=22");

    await user.click(within(alert).getByRole("button", { name: /Dismiss/i }));
    expect(screen.queryByRole("heading", { name: /Validation Error/i })).toBeNull();
  });
});
