import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegistrationsPage from "./registrations-page";
import { LanguageProvider } from "@/providers/language-provider";

const fetchAppointmentsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchAppointmentSlipSettingsMock = vi.fn();
const fetchPatientQrSettingsMock = vi.fn();
const getAppointmentByIdMock = vi.fn();
const sendPatientWebPushNotificationMock = vi.fn();
const useV2AvailabilityMock = vi.fn();
const rescheduleV2BookingMock = vi.fn();
const prepareAppointmentSlipHtmlMock = vi.fn();
const mockPrintAppointmentSlipById = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  cancelAppointment: vi.fn(),
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchAppointmentSlipSettings: (...args: unknown[]) => fetchAppointmentSlipSettingsMock(...args),
  getAppointmentById: (...args: unknown[]) => getAppointmentByIdMock(...args),
  fetchPatientQrSettings: (...args: unknown[]) => fetchPatientQrSettingsMock(...args),
  sendPatientWebPushNotification: (...args: unknown[]) => sendPatientWebPushNotificationMock(...args),
}));

vi.mock("@/v2/appointments/api", () => ({
  useV2Availability: (...args: unknown[]) => useV2AvailabilityMock(...args),
  rescheduleV2Booking: (...args: unknown[]) => rescheduleV2BookingMock(...args),
  useV2ExamTypes: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/lib/print-utils", () => ({
  prepareAppointmentSlipHtml: (...args: unknown[]) => prepareAppointmentSlipHtmlMock(...args),
  printAppointmentList: vi.fn(),
}));

vi.mock("@/lib/appointment-printing", () => ({
  printAppointmentSlipById: (...args: unknown[]) => mockPrintAppointmentSlipById(...args),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: (...args: unknown[]) => mockPushToast(...args),
}));

function renderRegistrationsPage(initialEntries = ["/registrations"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/registrations" element={<RegistrationsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("RegistrationsPage print actions", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    mockPrintAppointmentSlipById.mockReset();
    mockPrintAppointmentSlipById.mockResolvedValue(undefined);
    mockPushToast.mockReset();
    sendPatientWebPushNotificationMock.mockReset();
    sendPatientWebPushNotificationMock.mockResolvedValue({});
    getAppointmentByIdMock.mockReset();
    useV2AvailabilityMock.mockReset();
    rescheduleV2BookingMock.mockReset();
    fetchAppointmentsMock.mockResolvedValue([
      {
        id: 7,
        modalityId: 1,
        examTypeId: 3,
        accessionNumber: "ACC-7",
        dailySequence: 1,
        patientId: 1,
        caseCategory: "non_oncology",
        arabicFullName: "Test Patient",
        englishFullName: "Test Patient",
        modalityNameAr: "أشعة مقطعية",
        modalityNameEn: "CT",
        examNameAr: "CT Head",
        examNameEn: "CT Head",
        priorityNameAr: null,
        priorityNameEn: null,
        appointmentDate: "2027-01-03",
        status: "scheduled",
        isWalkIn: false,
        notes: null,
        phone1: "0912345678",
        patientWebPushSubscribed: true,
        publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=sample-token",
      },
    ]);
    useV2AvailabilityMock.mockReturnValue({
      data: {
        items: [
          {
            date: "2027-01-04",
            bucketMode: "partitioned",
            modalityTotalCapacity: 10,
            bookedTotal: 2,
            oncology: { reserved: 2, filled: 0, remaining: 2 },
            nonOncology: { reserved: 8, filled: 2, remaining: 6 },
            specialQuotaSummary: null,
            dailyCapacity: 10,
            bookedCount: 2,
            remainingCapacity: 8,
            isFull: false,
            decision: {
              isAllowed: true,
              requiresSupervisorOverride: false,
              displayStatus: "available",
              suggestedBookingMode: "standard",
              consumedCapacityMode: "standard",
              remainingStandardCapacity: 8,
              remainingSpecialQuota: null,
              matchedRuleIds: [],
              reasons: [],
              policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "hash" },
              decisionTrace: { evaluatedAt: "2026-01-01T00:00:00Z", input: null },
            },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    rescheduleV2BookingMock.mockResolvedValue({ booking: { id: 7 }, previousDate: "2027-01-03" });
    getAppointmentByIdMock.mockResolvedValue({
      id: 7,
      modalityId: 1,
      examTypeId: 3,
      accessionNumber: "ACC-7",
      dailySequence: 1,
      patientId: 1,
      caseCategory: "non_oncology",
      arabicFullName: "Test Patient",
      englishFullName: "Test Patient",
      modalityNameAr: "أشعة مقطعية",
      modalityNameEn: "CT",
      examNameAr: "CT Head",
      examNameEn: "CT Head",
      priorityNameAr: null,
      priorityNameEn: null,
      appointmentDate: "2027-01-04",
      status: "scheduled",
      isWalkIn: false,
      notes: null,
      phone1: "0912345678",
      patientWebPushSubscribed: true,
      publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=sample-token",
    });
    fetchAppointmentLookupsMock.mockResolvedValue({
      modalities: [{ id: 1, name: "CT", nameAr: "CT", nameEn: "CT", code: "CT", isActive: true }],
    });
    fetchAppointmentSlipSettingsMock.mockResolvedValue({});
    fetchPatientQrSettingsMock.mockResolvedValue({});
    prepareAppointmentSlipHtmlMock.mockResolvedValue("<html><body>preview</body></html>");
  });

  it("prints directly from the row print button", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    const row = screen.getByText("ACC-7").closest('[role="button"]') as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Print" }));

    await waitFor(() => {
      expect(mockPrintAppointmentSlipById).toHaveBeenCalledWith(7, "en");
    });
  });

  it("renders fixed icon action slots with stable labels", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    const row = screen.getByText("ACC-7").closest('[role="button"]') as HTMLElement;
    const actionLabels = within(row)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(actionLabels).toEqual(["Print", "Link", "WhatsApp", "Notify", "Manage"]);
  });

  it("opens the appointment drawer from an appointmentId deep link", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([
      {
        id: 99,
        modalityId: 1,
        examTypeId: 3,
        accessionNumber: "ACC-99",
        dailySequence: 1,
        patientId: 2,
        caseCategory: "non_oncology",
        arabicFullName: "Other Patient",
        englishFullName: "Other Patient",
        modalityNameAr: "CT",
        modalityNameEn: "CT",
        examNameAr: "CT Chest",
        examNameEn: "CT Chest",
        priorityNameAr: null,
        priorityNameEn: null,
        appointmentDate: "2027-01-05",
        status: "scheduled",
        isWalkIn: false,
        notes: null,
        phone1: "0911111111",
        patientWebPushSubscribed: false,
        publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=other-token",
      },
    ]);
    renderRegistrationsPage(["/registrations?appointmentId=7"]);

    await waitFor(() => {
      expect(getAppointmentByIdMock).toHaveBeenCalledWith(7);
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Manage" })).toBeTruthy();
      expect(screen.getByText("Test Patient")).toBeTruthy();
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });
  });

  it("keeps WhatsApp and Notify action slots disabled when unavailable", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([
      {
        id: 10,
        modalityId: 1,
        examTypeId: 3,
        accessionNumber: "ACC-10",
        dailySequence: 1,
        patientId: 1,
        caseCategory: "non_oncology",
        arabicFullName: "Unavailable Actions",
        englishFullName: "Unavailable Actions",
        modalityNameAr: "CT",
        modalityNameEn: "CT",
        examNameAr: "CT Head",
        examNameEn: "CT Head",
        priorityNameAr: null,
        priorityNameEn: null,
        appointmentDate: "2027-01-03",
        status: "scheduled",
        isWalkIn: false,
        notes: null,
        phone1: null,
        patientWebPushSubscribed: false,
        publicAppointmentUrl: null,
      },
    ]);

    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-10")).toBeTruthy();
    });

    const row = screen.getByText("ACC-10").closest('[role="button"]') as HTMLElement;
    const buttons = within(row).getAllByRole("button") as HTMLButtonElement[];

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Print",
      "Link",
      "WhatsApp",
      "Notify",
      "Manage",
    ]);
    expect(buttons[2].disabled).toBe(true);
    expect(buttons[3].disabled).toBe(true);
    expect(buttons[2].getAttribute("title")).toBe("No patient phone number is available for this registration.");
    expect(buttons[3].getAttribute("title")).toBe("Web notifications not enabled");
  });

  it("opens WhatsApp and Notify dialogs from the icon actions", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    const row = screen.getByText("ACC-7").closest('[role="button"]') as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "WhatsApp" }));
    expect(screen.getByText("Send WhatsApp message")).toBeTruthy();

    await userEvent.click(screen.getByTestId("registrations-whatsapp-backdrop"));
    await waitFor(() => {
      expect(screen.queryByText("Send WhatsApp message")).toBeNull();
    });

    await userEvent.click(within(row).getByRole("button", { name: "Notify" }));
    expect(screen.getByText("Send patient notification")).toBeTruthy();
  });

  it("prints directly from the preview modal confirm button", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(screen.getByText("ACC-7"));

    await waitFor(() => {
      expect(screen.getByTitle("Appointment slip preview")).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: "Confirm Print" }));

    await waitFor(() => {
      expect(mockPrintAppointmentSlipById).toHaveBeenCalledWith(7, "en");
    });
  });

  it("dismisses the preview when clicking outside the slip", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(screen.getByText("ACC-7"));

    await waitFor(() => {
      expect(screen.getByTestId("slip-preview-backdrop")).toBeTruthy();
    });

    await userEvent.click(screen.getByTestId("slip-preview-backdrop"));

    await waitFor(() => {
      expect(screen.queryByTestId("slip-preview-backdrop")).toBeNull();
    });
  });

  it("shows the appointment link from the row action button", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    const row = screen.getByText("ACC-7").closest('[role="button"]') as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "success",
          title: "Appointment Link",
          message: "https://rispro.nccb.com.ly/public/appointment?t=sample-token",
        })
      );
    });
  });

  it("shows unavailable message when link is missing", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([
      {
        id: 7,
        accessionNumber: "ACC-7",
        dailySequence: 1,
        patientId: 1,
        arabicFullName: "Test Patient",
        englishFullName: "Test Patient",
        modalityNameAr: "أشعة مقطعية",
        modalityNameEn: "CT",
        examNameAr: "CT Head",
        examNameEn: "CT Head",
        priorityNameAr: null,
        priorityNameEn: null,
        appointmentDate: "2027-01-03",
        status: "scheduled",
        isWalkIn: false,
        notes: null,
        publicAppointmentUrl: null,
      },
    ]);
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    const row = screen.getByText("ACC-7").closest('[role="button"]') as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          title: "Appointment Link",
          message: "No public appointment link is available for this registration.",
        })
      );
    });
  });

  it("keeps row reschedule absent and submits reschedule only from the manage drawer", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    const row = screen.getByText("ACC-7").closest('[role="button"]') as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Reschedule" })).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "Manage" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Reschedule" }).at(-1)!);

    await waitFor(() => {
      expect(useV2AvailabilityMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modalityId: 1,
          days: 14,
          examTypeId: 3,
          caseCategory: "non_oncology",
          includeOverrideCandidates: true,
        })
      );
    });

    await userEvent.click(screen.getByRole("button", { name: /2027-01-04 available/i }));
    await userEvent.type(screen.getByLabelText("Reason"), "Patient requested later date");
    await userEvent.click(screen.getAllByRole("button", { name: "Reschedule" }).at(-1)!);

    await waitFor(() => {
      expect(rescheduleV2BookingMock).toHaveBeenCalledWith(7, {
        bookingDate: "2027-01-04",
        bookingTime: null,
        rescheduleReason: "Patient requested later date",
      });
    });
  });

  it("shows the category legend and marks oncology rows for color coding", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([
      {
        id: 9,
        modalityId: 1,
        examTypeId: 3,
        accessionNumber: "ACC-9",
        dailySequence: 1,
        patientId: 1,
        caseCategory: "oncology",
        arabicFullName: "Oncology Patient",
        englishFullName: "Oncology Patient",
        modalityNameAr: "CT",
        modalityNameEn: "CT",
        examNameAr: "CT Head",
        examNameEn: "CT Head",
        priorityNameAr: null,
        priorityNameEn: null,
        appointmentDate: "2027-01-03",
        status: "scheduled",
        isWalkIn: false,
        notes: null,
        publicAppointmentUrl: null,
      },
    ]);

    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-9")).toBeTruthy();
    });

    expect(screen.getByLabelText("Patient category legend")).toBeTruthy();
    const row = screen.getByText("ACC-9").closest('[role="button"]') as HTMLElement;
    expect(row.getAttribute("data-category")).toBe("oncology");
    expect(row.getAttribute("aria-label")).toContain("Oncology");
  });

  it("shows reschedule in the manage drawer", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-7")).toBeTruthy();
    });

    const row = screen.getByText("ACC-7").closest('[role="button"]') as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Manage" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Reschedule" }).at(-1)!);

    await waitFor(() => {
      expect(screen.getByText("Choose a new date for this appointment. Other appointment details stay unchanged.")).toBeTruthy();
    });
  });

  it("does not show row reschedule for inactive appointment statuses", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([
      {
        id: 8,
        modalityId: 1,
        examTypeId: 3,
        accessionNumber: "ACC-8",
        dailySequence: 1,
        patientId: 1,
        caseCategory: "non_oncology",
        arabicFullName: "Done Patient",
        englishFullName: "Done Patient",
        modalityNameAr: "CT",
        modalityNameEn: "CT",
        examNameAr: "CT Head",
        examNameEn: "CT Head",
        priorityNameAr: null,
        priorityNameEn: null,
        appointmentDate: "2027-01-03",
        status: "completed",
        isWalkIn: false,
        notes: null,
        publicAppointmentUrl: null,
      },
    ]);

    renderRegistrationsPage();

    await waitFor(() => {
      expect(screen.getByText("ACC-8")).toBeTruthy();
    });

    const row = screen.getByText("ACC-8").closest('[role="button"]') as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Reschedule" })).toBeNull();
  });
});
