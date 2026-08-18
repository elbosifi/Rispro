import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegistrationsPage from "./registrations-page";
import { LanguageProvider } from "@/providers/language-provider-component";
import { todayIsoDateLy } from "@/lib/date-format";

const fetchAppointmentsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchAppointmentSlipSettingsMock = vi.fn();
const fetchPatientDirectorySummaryMock = vi.fn();
const fetchPatientQrSettingsMock = vi.fn();
const fetchPublicAppointmentReportStatusMock = vi.fn();
const fetchPublicSchedulingCapacitySettingsMock = vi.fn();
const getAppointmentByIdMock = vi.fn();
const sendPatientWebPushNotificationMock = vi.fn();
const uploadAppointmentDocumentMock = vi.fn();
const useV2AvailabilityMock = vi.fn();
const rescheduleV2BookingMock = vi.fn();
const createSchedulingOverrideRequestMock = vi.fn();
const prepareAppointmentSlipHtmlMock = vi.fn();
const directPrintRegistrationRowsMock = vi.fn();
const mockPrintAppointmentSlipById = vi.fn();
const mockPushToast = vi.fn();
let mockAuthRole: "receptionist" | "supervisor" | "super_admin" = "super_admin";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
}

vi.mock("@/lib/api-hooks", () => ({
  cancelAppointment: vi.fn(),
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchAppointmentSlipSettings: (...args: unknown[]) => fetchAppointmentSlipSettingsMock(...args),
  fetchPatientDirectorySummary: (...args: unknown[]) => fetchPatientDirectorySummaryMock(...args),
  fetchCurrentSession: vi.fn(async () => ({ id: 91, role: mockAuthRole, username: "test", fullName: "Test User" })),
  fetchIntegrationStatus: vi.fn(async () => ({ scanner: { scannerAppEnabled: false, naps2WebScanEnabled: false } })),
  listAppointmentDocuments: vi.fn(async () => []),
  deleteAppointmentDocument: vi.fn(),
  uploadAppointmentDocument: (...args: unknown[]) => uploadAppointmentDocumentMock(...args),
  prepareScanSession: vi.fn(),
  createScanSession: vi.fn(),
  getAppointmentById: (...args: unknown[]) => getAppointmentByIdMock(...args),
  fetchPatientQrSettings: (...args: unknown[]) => fetchPatientQrSettingsMock(...args),
  fetchPublicSchedulingCapacitySettings: (...args: unknown[]) => fetchPublicSchedulingCapacitySettingsMock(...args),
  fetchPublicAppointmentReportStatus: (...args: unknown[]) => fetchPublicAppointmentReportStatusMock(...args),
  sendPatientWebPushNotification: (...args: unknown[]) => sendPatientWebPushNotificationMock(...args),
}));

vi.mock("@/v2/appointments/api", () => ({
  useV2Availability: (...args: unknown[]) => useV2AvailabilityMock(...args),
  rescheduleV2Booking: (...args: unknown[]) => rescheduleV2BookingMock(...args),
  useCreateSchedulingOverrideRequest: () => ({
    mutateAsync: createSchedulingOverrideRequestMock,
    isPending: false,
  }),
  useV2ExamTypes: () => ({ data: [], isLoading: false }),
  useV2SpecialReasonCodes: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/lib/print-utils", () => ({
  prepareAppointmentSlipHtml: (...args: unknown[]) => prepareAppointmentSlipHtmlMock(...args),
}));
vi.mock("@/lib/registration-list-printing", () => ({ directPrintRegistrationRows: (...args: unknown[]) => directPrintRegistrationRowsMock(...args) }));

vi.mock("@/lib/appointment-printing", () => ({
  printAppointmentSlipById: (...args: unknown[]) => mockPrintAppointmentSlipById(...args),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: (...args: unknown[]) => mockPushToast(...args),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    user: { id: 91, role: mockAuthRole },
  }),
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
            <Route
              path="/registrations"
              element={
                <>
                  <RegistrationsPage />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

function getFirstText(text: string): HTMLElement {
  return screen.getAllByText(text)[0] as HTMLElement;
}

function getAppointmentRow(accessionNumber: string): HTMLElement {
  return screen.getAllByText(accessionNumber).at(-1)!.closest('[role="button"]') as HTMLElement;
}

function registrationAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    modalityId: 1,
    examTypeId: 3,
    accessionNumber: "ACC-7",
    dailySequence: 1,
    patientId: 1,
    caseCategory: "non_oncology",
    arabicFullName: "Test Patient",
    englishFullName: "Test Patient",
    modalityNameAr: "CT",
    modalityNameEn: "CT",
    modalityCode: "CT",
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
    protocolAssignmentSummary: null,
    ...overrides,
  };
}

describe("RegistrationsPage print actions", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    localStorage.setItem("rispro-language", "en");
    fetchAppointmentsMock.mockReset();
    mockPrintAppointmentSlipById.mockReset();
    mockPrintAppointmentSlipById.mockResolvedValue(undefined);
    mockPushToast.mockReset();
    sendPatientWebPushNotificationMock.mockReset();
    sendPatientWebPushNotificationMock.mockResolvedValue({});
    uploadAppointmentDocumentMock.mockReset();
    uploadAppointmentDocumentMock.mockResolvedValue({ id: 101 });
    fetchPublicAppointmentReportStatusMock.mockReset();
    fetchPublicSchedulingCapacitySettingsMock.mockReset();
    fetchPublicSchedulingCapacitySettingsMock.mockReturnValue({
      allow_reception_override_requests_from_availability: "enabled",
      can_request_scheduling_override: "enabled",
    });
    fetchPublicAppointmentReportStatusMock.mockResolvedValue({
      enabled: true,
      state: "final",
      canViewReport: true,
      message: "Report is ready.",
      checkButtonLabel: "Check report status",
      viewButtonLabel: "Open report",
    });
    getAppointmentByIdMock.mockReset();
    fetchPatientDirectorySummaryMock.mockReset();
    fetchPatientDirectorySummaryMock.mockResolvedValue({
      demographics: {
        id: 1,
        mrn: "MRN-1",
        arabicFullName: "Test Patient",
        englishFullName: "Test Patient",
        sex: "F",
        ageYears: 31,
        demographicsEstimated: false,
        dateOfBirth: "1995-01-01",
      },
      identifiers: {
        nationalId: null,
        identifierType: null,
        identifierValue: null,
      },
      contact: {
        phone1: "0912345678",
        phone2: null,
        address: null,
      },
      category: "non_oncology",
      registration: { createdAt: "2026-01-01T09:00:00.000Z", createdByUserId: 1, createdByName: "E2E Registrar", createdByUsername: "registrar" },
      warnings: {
        missingPhone: false,
        missingDob: false,
        missingSex: false,
        missingName: false,
        incompleteData: false,
        possibleDuplicate: false,
        duplicateReasons: [],
      },
      lastAppointment: {
        id: 7,
        date: "2027-01-03",
        status: "scheduled",
        modalityName: "CT",
        examTypeName: "CT Head",
      },
      nextAppointment: null,
      noShow: {
        noShowCount: 0,
        bookingRestricted: false,
        lastNoShowAppointment: null,
        lastAuthorizationDate: null,
        lastAuthorizationUser: null,
        lastAuthorizationReason: null,
      },
      recentAppointments: [
        {
          id: 7,
          date: "2027-01-03",
          status: "scheduled",
          modalityName: "CT",
          examTypeName: "CT Head",
        },
      ],
    });
    useV2AvailabilityMock.mockReset();
    rescheduleV2BookingMock.mockReset();
    createSchedulingOverrideRequestMock.mockReset();
    createSchedulingOverrideRequestMock.mockResolvedValue({ request: { id: 99, status: "pending" } });
    mockAuthRole = "super_admin";
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
      appointmentDate: "2027-01-03",
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
    directPrintRegistrationRowsMock.mockReset();
    directPrintRegistrationRowsMock.mockResolvedValue(undefined);
  });

  it("defaults to today's single-date registrations when opened normally", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenCalled();
    });

    const firstQuery = fetchAppointmentsMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(firstQuery).toEqual(
      expect.objectContaining({
        dateFrom: todayIsoDateLy(),
        dateTo: todayIsoDateLy(),
      })
    );
  });

  it("initializes appointment filters from URL params", async () => {
    renderRegistrationsPage([
      "/registrations?dateMode=range&dateFrom=2026-06-01&dateTo=2026-06-30&modalityId=1&status=completed&status=no-show&q=ACC",
    ]);

    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30",
          modalityId: "1",
          q: "ACC",
          status: ["completed", "no-show"],
        })
      );
    });
  });

  it("shows and clears statistics drill-down filter context", async () => {
    renderRegistrationsPage([
      "/registrations?source=statistics&dateMode=range&dateFrom=2026-06-01&dateTo=2026-06-30&modalityId=1&status=completed&status=no-show&q=ACC",
    ]);

    expect(await screen.findByText("Filtered from Statistics")).toBeTruthy();
    expect(await screen.findByText("Date range: 01/06/2026 - 30/06/2026")).toBeTruthy();
    expect(await screen.findByText("Modality: CT")).toBeTruthy();
    expect(screen.getByText("Status: Completed")).toBeTruthy();
    expect(screen.getByText("Status: No-show")).toBeTruthy();
    expect(screen.getByText("Search: ACC")).toBeTruthy();

    const backLink = screen.getByRole("link", { name: "Back to Statistics" });
    const backUrl = new URL(backLink.getAttribute("href") ?? "", "http://rispro.test");
    expect(backUrl.pathname).toBe("/statistics");
    expect(backUrl.searchParams.get("dateFrom")).toBe("2026-06-01");
    expect(backUrl.searchParams.get("dateTo")).toBe("2026-06-30");
    expect(backUrl.searchParams.get("modalityId")).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      expect(screen.queryByText("Filtered from Statistics")).toBeNull();
      expect(screen.getByTestId("location-probe").getAttribute("data-search")).toBe("");
    });
    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dateFrom: todayIsoDateLy(),
          dateTo: todayIsoDateLy(),
          modalityId: "",
          q: "",
          status: ["scheduled", "arrived", "waiting"],
        })
      );
    });
  });

  it("supports status[] URL params and preserves appointment deep links", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([registrationAppointment({ id: 99, accessionNumber: "ACC-99" })]);
    renderRegistrationsPage([
      "/registrations?appointmentId=7&patientId=1&tab=status&dateMode=single&date=2026-06-30&status[]=scheduled&status[]=waiting",
    ]);

    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: "1",
          status: ["scheduled", "waiting"],
        })
      );
      expect(getAppointmentByIdMock).toHaveBeenCalledWith(7);
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Manage" })).toBeTruthy();
      expect(screen.getByText("Change appointment status")).toBeTruthy();
    });
  });

  it("prints directly from the row print button", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    await userEvent.click(within(row).getByRole("button", { name: "Print" }));

    await waitFor(() => {
      expect(mockPrintAppointmentSlipById).toHaveBeenCalledWith(7, "en");
    });
  });

  it("renders fixed icon action slots with stable labels", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    const actionLabels = within(row)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(actionLabels.filter(Boolean)).toEqual(["Print", "Preview slip", "Link", "Report", "WhatsApp", "Notify", "Manage"]);
  });

  it("opens the patient drawer from the patient name while row click opens manage drawer", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(screen.getAllByRole("button", { name: "Test Patient" })[0]!);

    await waitFor(() => {
      expect(fetchPatientDirectorySummaryMock).toHaveBeenCalledWith(1);
      expect(screen.getByText("Patient Profile")).toBeTruthy();
    });

    await userEvent.click(screen.getByTestId("patient-drawer-backdrop"));

    await waitFor(() => {
      expect(screen.queryByText("Patient Profile")).toBeNull();
    });

    await userEvent.click(getAppointmentRow("ACC-7"));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Manage" })).toBeTruthy();
      expect(screen.queryByTitle("Appointment slip preview")).toBeNull();
    });
  });

  it("opens the patient profile from the manage drawer", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(getAppointmentRow("ACC-7"));
    await userEvent.click(screen.getByRole("button", { name: "Patient profile" }));

    await waitFor(() => {
      expect(fetchPatientDirectorySummaryMock).toHaveBeenCalledWith(1);
      expect(screen.getByText("Patient Profile")).toBeTruthy();
    });
  });

  it("opens the Documents workspace from an appointmentId deep link", async () => {
    fetchAppointmentsMock.mockResolvedValue([
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
    renderRegistrationsPage(["/registrations?appointmentId=7&patientId=1"]);

    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: "1",
        })
      );
      expect(getAppointmentByIdMock).toHaveBeenCalledWith(7);
    });

    const patientQuery = fetchAppointmentsMock.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((query) => query.patientId === "1");
    expect(patientQuery).not.toHaveProperty("dateFrom");
    expect(patientQuery).not.toHaveProperty("dateTo");

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Manage" })).toBeTruthy();
      expect(screen.getAllByText("Test Patient").length).toBeGreaterThan(0);
      expect(getFirstText("ACC-7")).toBeTruthy();
      expect(screen.getByText(/Showing registrations for Test Patient\./i)).toBeTruthy();
      expect(screen.getByTestId("appointment-document-workspace")).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Patient details" })).toBeNull();
    });
  });

  it("shows the Voided filter to supervisors and super admins only", async () => {
    mockAuthRole = "supervisor";
    const { unmount } = renderRegistrationsPage();
    expect(await screen.findByRole("button", { name: "Voided" })).toBeTruthy();
    unmount();

    mockAuthRole = "super_admin";
    renderRegistrationsPage();
    expect(await screen.findByRole("button", { name: "Voided" })).toBeTruthy();
  });

  it("does not show Voided or request it from a receptionist URL state", async () => {
    mockAuthRole = "receptionist";
    renderRegistrationsPage(["/registrations?status=voided"]);

    expect(screen.queryByRole("button", { name: "Voided" })).toBeNull();
    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: ["scheduled", "arrived", "waiting"] }),
      );
    });
  });

  it("includes voided in the supervisor Registration query when selected", async () => {
    mockAuthRole = "supervisor";
    renderRegistrationsPage();

    await userEvent.click(await screen.findByRole("button", { name: "Voided" }));
    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: expect.arrayContaining(["voided"]) }),
      );
    });
  });

  it("shows void audit rows in the existing Administrative and audit details disclosure", async () => {
    const voidedAppointment = registrationAppointment({
      status: "voided",
      voidedAt: "2027-01-03T10:15:00.000Z",
      voidedByUserId: 91,
      voidedByName: "Void Supervisor",
      voidedByUsername: "void-supervisor",
      voidReason: "Duplicate entry",
    });
    fetchAppointmentsMock.mockResolvedValueOnce([voidedAppointment]);
    getAppointmentByIdMock.mockResolvedValueOnce(voidedAppointment);
    renderRegistrationsPage();

    await waitFor(() => expect(getFirstText("ACC-7")).toBeTruthy());
    await userEvent.click(getAppointmentRow("ACC-7"));
    const dialog = await screen.findByRole("dialog", { name: "Manage" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Information" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Administrative and audit details" }));

    expect(within(dialog).getByText("Voided by")).toBeTruthy();
    expect(within(dialog).getByText("Void Supervisor")).toBeTruthy();
    expect(within(dialog).getByText("Voided date/time")).toBeTruthy();
    expect(within(dialog).getByText("Void reason")).toBeTruthy();
    expect(within(dialog).getByText("Duplicate entry")).toBeTruthy();
  });

  it("does not show void audit rows for a normal appointment", async () => {
    renderRegistrationsPage();

    await waitFor(() => expect(getFirstText("ACC-7")).toBeTruthy());
    await userEvent.click(getAppointmentRow("ACC-7"));
    const dialog = await screen.findByRole("dialog", { name: "Manage" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Information" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Administrative and audit details" }));

    expect(within(dialog).queryByText("Voided by")).toBeNull();
    expect(within(dialog).queryByText("Voided date/time")).toBeNull();
    expect(within(dialog).queryByText("Void reason")).toBeNull();
  });

  it("uses the same direct-print handler for both list buttons with the exact loaded rows", async () => {
    renderRegistrationsPage();
    await screen.findAllByText("ACC-7");
    const buttons = screen.getAllByRole("button", { name: "Print" });
    await userEvent.click(buttons[0]!);
    await userEvent.click(buttons[1]!);
    await waitFor(() => expect(directPrintRegistrationRowsMock).toHaveBeenCalledTimes(2));
    expect(directPrintRegistrationRowsMock.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: 7, accessionNumber: "ACC-7" })]));
    expect(directPrintRegistrationRowsMock.mock.calls[1]?.[0]).toEqual(directPrintRegistrationRowsMock.mock.calls[0]?.[0]);
  });

  it("updates the deep-linked tab and closes without removing unrelated query parameters", async () => {
    renderRegistrationsPage(["/registrations?appointmentId=7&tab=status&status[]=scheduled&customFilter=keep"]);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Manage" })).toBeTruthy();
      expect(screen.getByText("Change appointment status")).toBeTruthy();
    });

    const initialParams = new URLSearchParams(screen.getByTestId("location-probe").getAttribute("data-search") || "");
    expect(initialParams.has("tab")).toBe(false);
    expect(initialParams.get("customFilter")).toBe("keep");

    await userEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId("location-probe").getAttribute("data-search") || "");
      expect(screen.queryByRole("dialog", { name: "Manage" })).toBeNull();
      expect(params.has("appointmentId")).toBe(false);
      expect(params.has("tab")).toBe(false);
      expect(params.get("customFilter")).toBe("keep");
      expect(params.getAll("status[]")).toEqual(["scheduled"]);
    });
  });

  it("shows selected appointment workflow timestamps in the manage drawer", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([
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
        status: "waiting",
        isWalkIn: false,
        notes: null,
        arrivedAt: "2027-01-03T08:15:00Z",
        waitingStartedAt: "2027-01-03T08:20:00Z",
        completedAt: "2027-01-03T09:30:00Z",
        phone1: "0912345678",
        patientWebPushSubscribed: true,
        publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=sample-token",
      },
    ]);
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
      modalityNameAr: "CT",
      modalityNameEn: "CT",
      examNameAr: "CT Head",
      examNameEn: "CT Head",
      priorityNameAr: null,
      priorityNameEn: null,
      appointmentDate: "2027-01-03",
      status: "waiting",
      isWalkIn: false,
      notes: null,
      arrivedAt: "2027-01-03T08:15:00Z",
      waitingStartedAt: "2027-01-03T08:20:00Z",
      completedAt: "2027-01-03T09:30:00Z",
      phone1: "0912345678",
      patientWebPushSubscribed: true,
      publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=sample-token",
    });

    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(getAppointmentRow("ACC-7"));
    const dialog = await screen.findByRole("dialog", { name: "Manage" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Information" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Additional workflow timestamps" }));

    expect(within(dialog).getByText("Arrival time")).toBeTruthy();
    expect(within(dialog).getByText("Waiting duration")).toBeTruthy();
    expect(within(dialog).getByText("Completion time")).toBeTruthy();
    expect(within(dialog).getByText(/10:15/)).toBeTruthy();
    expect(within(dialog).getByText(/11:30/)).toBeTruthy();
  });

  it("shows assigned protocol status and compact summary in the appointment list", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([
      registrationAppointment({
        modalityNameEn: "MRI",
        modalityCode: "MRI",
        examNameEn: "MRI Rectum",
        protocolAssignmentSummary: {
          assignmentId: 11,
          protocolId: 21,
          protocolVersionId: 31,
          protocolName: "MRI Rectum Primary Staging",
          versionNumber: "1.2",
          modality: "MRI",
          scannerId: 41,
          scannerName: "Philips Ingenia Elition 3T",
          scannerVendor: "Philips",
          assignedBy: "Dr. Protocol",
          assignedAt: "2027-01-02T08:00:00Z",
          protocolNotes: "Patient prep notes.",
          contrastNotes: "Use rectal gel.",
          status: "ASSIGNED",
        },
      }),
    ]);

    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    expect(screen.getAllByText("Protocol assigned").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Protocol: MRI Rectum Primary Staging v1.2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Scanner: Philips Ingenia Elition 3T").length).toBeGreaterThan(0);
  });

  it("shows not protocolled for CT/MRI appointments without an assignment", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    expect(screen.getAllByText(/Protocol: Not protocolled/i).length).toBeGreaterThan(0);
  });

  it("shows the authoritative missing-request blocker only for applicable CT/MRI rows and opens request documents", async () => {
    fetchAppointmentsMock.mockResolvedValueOnce([
      registrationAppointment({ id: 11, accessionNumber: "CT-MISSING", requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: false }),
      registrationAppointment({ id: 12, accessionNumber: "MRI-MISSING", modalityCode: "MRI", modalityNameEn: "MRI", requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: false }),
      registrationAppointment({ id: 13, accessionNumber: "CT-READY", requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: true }),
      registrationAppointment({ id: 14, accessionNumber: "CT-ASSIGNED", requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: true, protocolAssignmentSummary: { assignmentId: 14, protocolName: "CT Head", versionNumber: "1", freeTextProtocol: null, scannerName: null, scannerVendor: null, assignedBy: null, assignedAt: null, protocolNotes: null, contrastNotes: null } }),
      registrationAppointment({ id: 15, accessionNumber: "MAMMO", modalityCode: "MG", modalityNameEn: "Mammo", requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: false, hasQualifyingRequestDocument: false }),
      registrationAppointment({ id: 16, accessionNumber: "US", modalityCode: "US", modalityNameEn: "Ultrasound", requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: false, hasQualifyingRequestDocument: false }),
    ]);

    renderRegistrationsPage();

    expect(await screen.findAllByRole("button", { name: "Missing request" })).toHaveLength(4);
    expect(within(getAppointmentRow("CT-READY")).getByText("Protocol: Not protocolled")).toBeTruthy();
    expect(within(getAppointmentRow("CT-ASSIGNED")).getByText("Protocol assigned")).toBeTruthy();
    expect(within(getAppointmentRow("MAMMO")).queryByRole("button", { name: "Missing request" })).toBeNull();
    expect(within(getAppointmentRow("US")).queryByRole("button", { name: "Missing request" })).toBeNull();

    await userEvent.click(screen.getAllByRole("button", { name: "Missing request" }).at(-1)!);
    expect(await screen.findByTestId("appointment-document-workspace")).toBeTruthy();
  });

  it("refreshes the missing-request row after a request upload invalidates registrations", async () => {
    fetchAppointmentsMock
      .mockResolvedValueOnce([registrationAppointment({ requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: false })])
      .mockResolvedValueOnce([registrationAppointment({ requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: true })]);

    renderRegistrationsPage();
    await userEvent.click((await screen.findAllByRole("button", { name: "Missing request" })).at(-1)!);

    const input = await screen.findByTestId("document-file-input");
    fireEvent.change(input, { target: { files: [new File(["request"], "request.pdf", { type: "application/pdf" })] } });
    await userEvent.click(screen.getByRole("button", { name: "Attach Request" }));

    await waitFor(() => {
      expect(uploadAppointmentDocumentMock).toHaveBeenCalled();
      expect(fetchAppointmentsMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("button", { name: "Missing request" })).toBeNull();
      expect(screen.getAllByText("Protocol: Not protocolled").length).toBeGreaterThan(0);
    });
  });

  it("shows protocol notes and contrast notes read-only in the manage drawer", async () => {
    const appointment = registrationAppointment({
        protocolAssignmentSummary: {
          assignmentId: 12,
          protocolId: 22,
          protocolVersionId: 32,
          protocolName: "CT Abdomen Liver",
          versionNumber: "3",
          modality: "CT",
          scannerId: 42,
          scannerName: "GE Revolution CT",
          scannerVendor: "GE",
          assignedBy: "Dr. Protocol",
          assignedAt: "2027-01-02T08:00:00Z",
          protocolNotes: "Hydration instructions reviewed.",
          contrastNotes: "IV contrast unless contraindicated.",
          status: "ASSIGNED",
        },
      });
    fetchAppointmentsMock.mockResolvedValue([appointment]);
    getAppointmentByIdMock.mockResolvedValue(appointment);

    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(getAppointmentRow("ACC-7"));
    const dialog = await screen.findByRole("dialog", { name: "Manage" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Information" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Technical PACS details" }));

    expect(within(dialog).getByText("Protocol notes")).toBeTruthy();
    expect(within(dialog).getByText("Hydration instructions reviewed.")).toBeTruthy();
    expect(within(dialog).getByText("Contrast notes")).toBeTruthy();
    expect(within(dialog).getByText("IV contrast unless contraindicated.")).toBeTruthy();
    expect(within(dialog).queryByText(/assign protocol|edit protocol|change protocol/i)).toBeNull();
  });

  it("clears the patient scope when switching to today", async () => {
    renderRegistrationsPage(["/registrations?appointmentId=7&patientId=1"]);

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const probe = screen.getByTestId("location-probe");
    await userEvent.click(screen.getByRole("button", { name: /Today/i }));

    await waitFor(() => {
      expect(probe.getAttribute("data-search")).toBe("?appointmentId=7");
    });

    const latestQuery = fetchAppointmentsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(latestQuery).not.toHaveProperty("patientId");
    expect(latestQuery).toEqual(
      expect.objectContaining({
        dateFrom: todayIsoDateLy(),
        dateTo: todayIsoDateLy(),
      })
    );
  });

  it("resets the deep link and clears the selected patient", async () => {
    renderRegistrationsPage(["/registrations?appointmentId=7&patientId=1"]);

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const probe = screen.getByTestId("location-probe");
    await userEvent.click(screen.getByRole("button", { name: /Reset/i }));

    await waitFor(() => {
      expect(probe.getAttribute("data-search")).toBe("");
      expect(screen.queryByRole("dialog", { name: "Manage" })).toBeNull();
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
      expect(getFirstText("ACC-10")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-10");
    const buttons = within(row)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-label")) as HTMLButtonElement[];

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Print",
      "Preview slip",
      "Link",
      "Report",
      "WhatsApp",
      "Notify",
      "Manage",
    ]);
    expect(buttons[3].disabled).toBe(true);
    expect(buttons[4].disabled).toBe(true);
    expect(buttons[5].disabled).toBe(true);
    expect(buttons[3].getAttribute("title")).toBe("No public appointment token is available for this registration.");
    expect(buttons[4].getAttribute("title")).toBe("No patient phone number is available for this registration.");
    expect(buttons[5].getAttribute("title")).toBe("Web notifications not enabled");
  });

  it("opens the WhatsApp dialog with its existing template default, locks page scrolling, and closes from the backdrop", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    const whatsappAction = within(row).getByRole("button", { name: "WhatsApp" });
    whatsappAction.focus();
    await userEvent.click(whatsappAction);

    const dialog = screen.getByRole("dialog", { name: "Send WhatsApp message" });
    expect((within(dialog).getByRole("combobox") as HTMLSelectElement).value).toBe("qr_link");
    expect(document.body.style.position).toBe("fixed");

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send WhatsApp message" })).toBeNull();
    });

    await userEvent.click(whatsappAction);

    fireEvent.click(screen.getByTestId("registrations-whatsapp-backdrop"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send WhatsApp message" })).toBeNull();
    });
    expect(document.activeElement).toBe(whatsappAction);
    expect(document.body.style.position).toBe("");
  });

  it("preserves WhatsApp custom-message sending and Escape focus restoration", async () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    const whatsappAction = within(row).getByRole("button", { name: "WhatsApp" });
    whatsappAction.focus();
    await userEvent.click(whatsappAction);

    const dialog = screen.getByRole("dialog", { name: "Send WhatsApp message" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Custom" }));
    const message = within(dialog).getByRole("textbox");
    await userEvent.type(message, "Custom WhatsApp message");
    expect(within(dialog).getAllByText("Custom WhatsApp message")).toHaveLength(2);

    await userEvent.click(within(dialog).getByRole("button", { name: "Open WhatsApp" }));
    expect(openWindow).toHaveBeenCalledWith(
      "https://wa.me/218912345678?text=Custom%20WhatsApp%20message",
      "_blank",
      "noopener,noreferrer",
    );

    await userEvent.click(whatsappAction);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send WhatsApp message" })).toBeNull();
    });
    expect(document.activeElement).toBe(whatsappAction);
  });

  it("opens the Web Push dialog with its existing template default and closes from the backdrop", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    const notifyAction = within(row).getByRole("button", { name: "Notify" });
    notifyAction.focus();
    await userEvent.click(notifyAction);

    const dialog = screen.getByRole("dialog", { name: "Send patient notification" });
    expect((within(dialog).getByRole("combobox") as HTMLSelectElement).value).toBe("appointment_reminder_24h");

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send patient notification" })).toBeNull();
    });

    await userEvent.click(notifyAction);

    fireEvent.click(screen.getByTestId("patient-web-push-message-backdrop"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send patient notification" })).toBeNull();
    });
    expect(document.activeElement).toBe(notifyAction);
  });

  it("preserves Web Push custom validation, payload, successful reset, and Escape focus restoration", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    const notifyAction = within(row).getByRole("button", { name: "Notify" });
    notifyAction.focus();
    await userEvent.click(notifyAction);

    let dialog = screen.getByRole("dialog", { name: "Send patient notification" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Custom" }));
    const send = within(dialog).getByRole("button", { name: "Notify" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    const [title, message] = within(dialog).getAllByRole("textbox");
    await userEvent.type(title, "Reminder");
    await userEvent.type(message, "Your appointment is tomorrow.");
    expect((send as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(send);
    await waitFor(() => {
      expect(sendPatientWebPushNotificationMock).toHaveBeenCalledWith(7, {
        templateEventType: undefined,
        title: "Reminder",
        message: "Your appointment is tomorrow.",
      });
      expect(screen.queryByRole("dialog", { name: "Send patient notification" })).toBeNull();
    });

    await userEvent.click(notifyAction);
    dialog = screen.getByRole("dialog", { name: "Send patient notification" });
    expect((within(dialog).getByRole("combobox") as HTMLSelectElement).value).toBe("appointment_reminder_24h");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Send patient notification" })).toBeNull();
    });
    expect(document.activeElement).toBe(notifyAction);
  });

  it("shows the appointment link from the row action button", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
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
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
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

  it("checks report status from the row action and shows open report only when allowed", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    expect(within(row).getByRole("button", { name: "Report" })).toBeTruthy();
    await userEvent.click(within(row).getByRole("button", { name: "Report" }));

    await waitFor(() => {
      expect(fetchPublicAppointmentReportStatusMock).toHaveBeenCalledWith("sample-token");
      expect(screen.getByText("Report is ready.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open report" })).toBeTruthy();
    });
  });

  it("shows PACS note above report status in the appointment drawer Report tab only when a note exists", async () => {
    const appointment = registrationAppointment({
        sonicDicomStudyNote: "mwa prior study note with enough text to preview compactly",
        sonicDicomStudyNoteCheckedAt: "2026-07-04T08:00:00.000Z",
      });
    fetchAppointmentsMock.mockResolvedValue([appointment]);
    getAppointmentByIdMock.mockResolvedValue(appointment);
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    await userEvent.click(within(row).getByRole("button", { name: "Report" }));

    await waitFor(() => {
      expect(fetchPublicAppointmentReportStatusMock).toHaveBeenCalledWith("sample-token");
      expect(screen.getByText("Report is ready.")).toBeTruthy();
    });
    const pacsNote = screen.getByTitle("PACS note: mwa prior study note with enough text to preview compactly");
    expect(within(pacsNote).getByText("PACS note")).toBeTruthy();
    expect(pacsNote.textContent).toContain("mwa prior study note");

  });

  it("does not render an empty PACS note placeholder in the Report tab", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(within(getAppointmentRow("ACC-7")).getByRole("button", { name: "Report" }));
    expect(screen.queryByTitle(/PACS note:/)).toBeNull();
  });

  it("does not show open report when status cannot be viewed", async () => {
    fetchPublicAppointmentReportStatusMock.mockResolvedValue({
      enabled: true,
      state: "draft",
      canViewReport: false,
      message: "Report is not final yet.",
      checkButtonLabel: "Check report status",
      viewButtonLabel: "Open report",
    });
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    await userEvent.click(within(row).getByRole("button", { name: "Report" }));

    await waitFor(() => {
      expect(screen.getByText("Report is not final yet.")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Open report" })).toBeNull();
  });

  it("keeps row reschedule absent and submits reschedule only from the manage drawer", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    expect(within(row).queryByRole("button", { name: "Reschedule" })).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "Manage" }));
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Reschedule" }));

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
      expect(rescheduleV2BookingMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          bookingDate: "2027-01-04",
          bookingTime: null,
          rescheduleReason: "Patient requested later date",
        })
      );
    });
  });

  it("submits a deferred reschedule override request with bookingId", async () => {
    mockAuthRole = "receptionist";
    useV2AvailabilityMock.mockReturnValue({
      data: {
        items: [
          {
            date: "2027-01-05",
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
              requiresSupervisorOverride: true,
              displayStatus: "available",
              suggestedBookingMode: "override",
              consumedCapacityMode: "override",
              remainingStandardCapacity: 8,
              remainingSpecialQuota: null,
              matchedRuleIds: [],
              reasons: [{ code: "closed_weekday_override_required", severity: "warning", message: "Closed weekday requires approval" }],
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

    renderRegistrationsPage();
    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    await userEvent.click(within(getAppointmentRow("ACC-7")).getByRole("button", { name: "Manage" }));
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Reschedule" }));
    await waitFor(() => expect(fetchPublicSchedulingCapacitySettingsMock).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole("button", { name: "Show full days" }));
    const restrictedDate = await screen.findByRole("button", { name: /2027-01-05 available/i });
    await userEvent.click(restrictedDate);
    await userEvent.click(screen.getByRole("button", { name: "Request override approval" }));

    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText("Requester reason is required.")).toBeTruthy();

    await userEvent.type(screen.getByPlaceholderText("Explain why this appointment needs override approval"), "Patient cannot attend original date");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(createSchedulingOverrideRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestType: "reschedule_booking",
          bookingId: 7,
          requesterReason: "Patient cannot attend original date",
          requestPayload: expect.objectContaining({
            bookingDate: "2027-01-05",
            bookingTime: null,
          }),
        })
      );
    });
    expect(rescheduleV2BookingMock).not.toHaveBeenCalled();
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
      expect(getFirstText("ACC-9")).toBeTruthy();
    });

    expect(screen.getByLabelText("Patient category legend")).toBeTruthy();
    const row = getAppointmentRow("ACC-9");
    expect(row.getAttribute("data-category")).toBe("oncology");
    expect(row.getAttribute("aria-label")).toContain("Oncology");
  });

  it("shows reschedule in the manage drawer", async () => {
    renderRegistrationsPage();

    await waitFor(() => {
      expect(getFirstText("ACC-7")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-7");
    await userEvent.click(within(row).getByRole("button", { name: "Manage" }));
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Reschedule" }));

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
      expect(getFirstText("ACC-8")).toBeTruthy();
    });

    const row = getAppointmentRow("ACC-8");
    expect(within(row).queryByRole("button", { name: "Reschedule" })).toBeNull();
  });
});
