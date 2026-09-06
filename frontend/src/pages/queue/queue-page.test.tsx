import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QueuePage from "./queue-page";
import { ApiError } from "@/lib/api-client";
import { LanguageProvider } from "@/providers/language-provider-component";
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

const multiAppointmentSnapshot: QueueSnapshot = {
  ...queueSnapshot,
  summary: {
    ...queueSnapshot.summary,
    total_appointments: 3,
    scheduled_count: 3,
  },
  queueEntries: [
    {
      ...queueSnapshot.queueEntries[0],
      sameDayAppointmentCount: 3,
      hasMultipleAppointments: true,
      relatedAppointments: [
        {
          appointmentId: 44,
          accessionNumber: "ACC-44",
          appointmentStatus: "scheduled",
          modalityNameAr: "CT",
          modalityNameEn: "CT",
          examNameAr: "Head",
          examNameEn: "Head",
        },
        {
          appointmentId: 45,
          accessionNumber: "ACC-45",
          appointmentStatus: "scheduled",
          modalityNameAr: "MRI",
          modalityNameEn: "MRI",
          examNameAr: "Brain",
          examNameEn: "Brain",
        },
        {
          appointmentId: 46,
          accessionNumber: "ACC-46",
          appointmentStatus: "waiting",
          modalityNameAr: "US",
          modalityNameEn: "US",
          examNameAr: "Abdomen",
          examNameEn: "Abdomen",
        },
      ],
    },
  ],
};

const enteredQueueSnapshot: QueueSnapshot = {
  ...queueSnapshot,
  summary: {
    ...queueSnapshot.summary,
    total_appointments: 2,
    scheduled_count: 1,
    waiting_count: 1,
  },
  queueEntries: [
    {
      ...queueSnapshot.queueEntries[0],
      id: 1,
      appointmentId: 44,
      accessionNumber: "ACC-44",
      appointmentStatus: "scheduled",
      queueStatus: "waiting",
      modalityNameAr: "CT",
      modalityNameEn: "CT",
    },
    {
      ...queueSnapshot.queueEntries[0],
      id: 2,
      appointmentId: 45,
      accessionNumber: "ACC-45",
      appointmentStatus: "waiting",
      queueStatus: "waiting",
      arrivedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      modalityNameAr: "MRI",
      modalityNameEn: "MRI",
      examNameAr: "Brain",
      examNameEn: "Brain",
    },
  ],
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

    const dialog = await screen.findByRole("dialog", { name: /Validation Error/i });
    expect(within(dialog).getByRole("heading", { name: /Validation Error/i })).toBeTruthy();
    expect(within(dialog).getByText(/Phone 1 and primary identifier are missing/i)).toBeTruthy();
    expect(within(dialog).getByText(/Complete the missing patient data before entering the patient into the queue/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Edit patient information/i })).toBeTruthy();

    await waitFor(() => {
      expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "error",
        title: "Scan failed.",
      }));
    });

    await user.click(within(dialog).getByRole("button", { name: /Edit patient information/i }));
    expect(navigateMock).toHaveBeenCalledWith("/registrations?appointmentId=44&patientId=22");

    await user.click(within(dialog).getByRole("button", { name: /Dismiss/i }));
    expect(screen.queryByRole("heading", { name: /Validation Error/i })).toBeNull();
  });
});

describe("QueuePage multiple appointment marker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("rispro-language", "en");
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [] });
    fetchSettingsMock.mockResolvedValue({ walk_in_queue: "disabled" });
  });

  it("shows a text badge and related appointment hint when count is greater than one", async () => {
    fetchQueueSnapshotMock.mockResolvedValue(multiAppointmentSnapshot);

    renderPage();

    expect(await screen.findByText("Multiple appointments · 3")).toBeTruthy();
    expect(screen.getByText(/Also today: MRI Brain, US Abdomen/i)).toBeTruthy();
  });

  it("hides the multiple appointment badge when count is one or missing", async () => {
    fetchQueueSnapshotMock.mockResolvedValue(queueSnapshot);

    renderPage();

    await screen.findByText("Patient Name");
    expect(screen.queryByText(/Multiple appointments/i)).toBeNull();
    expect(screen.queryByText(/Also today:/i)).toBeNull();
  });

  it("shows entered time and waiting duration only for entered queue rows", async () => {
    fetchQueueSnapshotMock.mockResolvedValue({
      ...queueSnapshot,
      summary: {
        ...queueSnapshot.summary,
        scheduled_count: 1,
        waiting_count: 1,
      },
      queueEntries: [
        {
          ...queueSnapshot.queueEntries[0],
          id: 1,
          appointmentId: 44,
          accessionNumber: "ACC-44",
          appointmentStatus: "waiting",
          arrivedAt: new Date(Date.now() - 70 * 60_000).toISOString(),
        },
        {
          ...queueSnapshot.queueEntries[0],
          id: 2,
          appointmentId: 45,
          accessionNumber: "ACC-45",
          appointmentStatus: "scheduled",
          arrivedAt: null,
        },
      ],
    });

    renderPage();

    const enteredRow = await screen.findByText(/ACC-44/);
    const enteredCard = enteredRow.closest("li")!;
    expect(within(enteredCard).getByText(/Entered/i)).toBeTruthy();
    expect(enteredCard.textContent).toMatch(/Waiting 1h (9|10)m/i);

    const scheduledRow = screen.getByText(/ACC-45/);
    const scheduledCard = scheduledRow.closest("li")!;
    expect(within(scheduledCard).queryByText(/Entered:/i)).toBeNull();
    expect(within(scheduledCard).queryByText(/Waiting:/i)).toBeNull();
  });
});

describe("QueuePage command center layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("rispro-language", "en");
    fetchAppointmentLookupsMock.mockResolvedValue({
      modalities: [
        { id: 1, nameAr: "CT", nameEn: "CT" },
        { id: 2, nameAr: "MRI", nameEn: "MRI" },
      ],
    });
    fetchSettingsMock.mockResolvedValue({ walk_in_queue: "disabled" });
  });

  it("renders one refresh control and compact summary controls", async () => {
    const user = userEvent.setup();
    fetchQueueSnapshotMock.mockResolvedValue(enteredQueueSnapshot);

    renderPage();

    await screen.findByText(/ACC-44/);
    expect(screen.getAllByRole("button", { name: /Refresh/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Total.*2/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Checked in.*1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Not arrived.*1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Walk-in.*0/i })).toBeTruthy();

    const view = screen.getByRole("combobox", { name: "View" });
    await user.click(screen.getByRole("button", { name: /Checked in.*1/i }));
    expect((view as HTMLSelectElement).value).toBe("entered");
    await user.click(screen.getByRole("button", { name: /Not arrived.*1/i }));
    expect((view as HTMLSelectElement).value).toBe("not_entered");
    await user.click(screen.getByRole("button", { name: /Walk-in.*0/i }));
    expect((view as HTMLSelectElement).value).toBe("walk_in");
    await user.click(screen.getByRole("button", { name: /Total.*2/i }));
    expect((view as HTMLSelectElement).value).toBe("all");
  });

  it("renders a primary scan bar and submits scans with Enter", async () => {
    const user = userEvent.setup();
    fetchQueueSnapshotMock.mockResolvedValue(queueSnapshot);
    scanIntoQueueMock.mockResolvedValue({ ok: true });

    renderPage();

    const scanRegion = await screen.findByRole("region", { name: /Scan Accession/i });
    const input = within(scanRegion).getByPlaceholderText(/Scan barcode or type accession/i);

    await user.type(input, "ACC-44{Enter}");

    expect(scanIntoQueueMock.mock.calls[0]?.[0]).toBe("ACC-44");
    expect(within(scanRegion).getByRole("button", { name: /full-screen|ملء الشاشة/i })).toBeTruthy();
  });

  it("renders scheduled and checked-in queue sections", async () => {
    fetchQueueSnapshotMock.mockResolvedValue(enteredQueueSnapshot);

    renderPage();

    await screen.findByText(/ACC-44/);
    const scheduledColumn = screen.getByRole("region", { name: /Scheduled \/ not checked in/i });
    const checkedInColumn = screen.getByRole("region", { name: /Checked in \/ waiting/i });

    expect(within(scheduledColumn).getByText(/ACC-44/)).toBeTruthy();
    expect(within(checkedInColumn).getByText(/ACC-45/)).toBeTruthy();
  });

  it("shows specific empty states", async () => {
    fetchQueueSnapshotMock.mockResolvedValue({ ...queueSnapshot, queueEntries: [] });

    renderPage();

    expect(await screen.findByText(/No checked-in patients yet/i)).toBeTruthy();
    expect(screen.getByText(/No scheduled patients are waiting for check-in/i)).toBeTruthy();
  });

  it("keeps the before-review no-show status compact", async () => {
    fetchQueueSnapshotMock.mockResolvedValue(queueSnapshot);
    const { unmount } = renderPage();

    await screen.findByText("Patient Name");
    expect(screen.getByText(/No-show review opens at 18:00/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open review workspace/i })).toBeNull();
    unmount();
  });

  it("shows a review action only for actionable manual no-shows", async () => {
    fetchQueueSnapshotMock.mockResolvedValue({
      ...queueSnapshot,
      reviewActive: true,
      autoNoShowEnabled: false,
      noShowCandidates: [
        {
          appointmentId: 44,
          accessionNumber: "ACC-44",
          appointmentDate: "2026-06-18",
          patientId: 22,
          arabicFullName: "Patient Name",
          englishFullName: "Patient Name",
          phone1: null,
          modalityNameAr: "CT",
          modalityNameEn: "CT",
        },
      ],
    });

    renderPage();

    expect(await screen.findByRole("region", { name: /No-show review status/i })).toBeTruthy();
    expect(screen.getByText(/1 appointment\(s\) are ready for manual review/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open review workspace/i })).toBeTruthy();
  });

  it("keeps automatic no-show processing informational", async () => {
    fetchQueueSnapshotMock.mockResolvedValue({
      ...queueSnapshot,
      reviewActive: true,
      autoNoShowEnabled: true,
      noShowCandidates: [],
    });

    renderPage();

    expect(await screen.findByText(/Automatic no-show processing is active/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open review workspace/i })).toBeNull();
  });

  it("displays arrived bookings as Arrived rather than Called", async () => {
    fetchQueueSnapshotMock.mockResolvedValue({
      ...queueSnapshot,
      summary: { ...queueSnapshot.summary, scheduled_count: 0, arrived_count: 1 },
      queueEntries: [{
        ...queueSnapshot.queueEntries[0],
        appointmentStatus: "arrived",
        arrivedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      }],
    });

    renderPage();

    expect(await screen.findByText("Arrived", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Called", { exact: true })).toBeNull();
  });

  it("filters queue rows and shows a filtered empty state", async () => {
    const user = userEvent.setup();
    fetchQueueSnapshotMock.mockResolvedValue(enteredQueueSnapshot);

    renderPage();

    await screen.findByText(/ACC-44/);
    const searchInput = screen.getByPlaceholderText(/Name, accession, phone/i);
    await user.type(searchInput, "MRI");

    expect(screen.queryByText(/ACC-44/)).toBeNull();
    expect(screen.getByText(/ACC-45/)).toBeTruthy();

    await user.clear(searchInput);
    await user.type(searchInput, "No Match");

    expect(await screen.findAllByText(/No patients match the current filters/i)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Clear filters/i }).length).toBeGreaterThan(0);
  });

  it("warns without submitting when accession is already checked in", async () => {
    const user = userEvent.setup();
    fetchQueueSnapshotMock.mockResolvedValue(enteredQueueSnapshot);

    renderPage();

    const scanRegion = await screen.findByRole("region", { name: /Scan Accession/i });
    await user.type(within(scanRegion).getByPlaceholderText(/Scan barcode or type accession/i), "ACC-45{Enter}");

    expect(scanIntoQueueMock).not.toHaveBeenCalled();
    expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({
      type: "info",
      title: "Already checked in",
    }));
  });
});
