import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportCenter } from "./report-center";

const fetchAppointmentsMock = vi.fn();
const fetchAppointmentLookupsMock = vi.fn();
const fetchPatientDirectoryMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: (...args: unknown[]) => fetchAppointmentsMock(...args),
  fetchAppointmentLookups: (...args: unknown[]) => fetchAppointmentLookupsMock(...args),
  fetchPatientDirectory: (...args: unknown[]) => fetchPatientDirectoryMock(...args),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 1, username: "supervisor", fullName: "Supervisor", role: "supervisor" }, isLoading: false }),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/lib/print-utils", () => ({
  printAppointmentList: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: vi.fn(),
}));

function renderCenter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportCenter />
    </QueryClientProvider>
  );
}

describe("ReportCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAppointmentLookupsMock.mockResolvedValue({ modalities: [{ id: 1, nameEn: "CT", nameAr: "CT" }] });
    fetchPatientDirectoryMock.mockResolvedValue({ patients: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
    fetchAppointmentsMock.mockResolvedValue([
      {
        id: 1,
        appointmentDate: "2026-05-02",
        bookingTime: "08:00",
        accessionNumber: "V2-000001",
        arabicFullName: "Alpha One",
        englishFullName: "Alpha One",
        modalityNameAr: "CT",
        modalityNameEn: "CT",
        examNameAr: "Brain",
        examNameEn: "Brain",
        status: "scheduled",
      },
    ]);
  });

  it("loads the report center and updates preview filters", async () => {
    renderCenter();

    expect((await screen.findAllByText("Print & Reports Center")).length).toBeGreaterThan(0);
    await screen.findByRole("option", { name: "CT" });
    await userEvent.selectOptions(screen.getByLabelText("Modality"), "1");

    await waitFor(() => {
      expect(fetchAppointmentsMock).toHaveBeenCalledWith(expect.objectContaining({ modalityId: "1" }));
    });
  });
});
