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
const prepareAppointmentSlipHtmlMock = vi.fn();
const mockPrintAppointmentSlipById = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  cancelAppointment: vi.fn(),
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchAppointmentSlipSettings: (...args: unknown[]) => fetchAppointmentSlipSettingsMock(...args),
  fetchPatientQrSettings: (...args: unknown[]) => fetchPatientQrSettingsMock(...args),
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

function renderRegistrationsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/registrations"]}>
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
    fetchAppointmentsMock.mockResolvedValue([
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
        publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=sample-token",
      },
    ]);
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
    await userEvent.click(within(row).getByRole("button", { name: "View Appointment Link" }));

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
    await userEvent.click(within(row).getByRole("button", { name: "View Appointment Link" }));

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
});
