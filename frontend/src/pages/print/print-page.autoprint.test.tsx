import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PrintPage from "./print-page";
import * as printUtils from "@/lib/print-utils";

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: vi.fn().mockResolvedValue([]),
  fetchAppointmentLookups: vi.fn().mockResolvedValue({ modalities: [], examTypes: [] }),
  getAppointmentById: vi.fn().mockResolvedValue({
    id: 42,
    accessionNumber: "ACC-42",
    appointmentDate: "2027-01-03",
    arabicFullName: "مريض",
    englishFullName: "Test Patient",
    nationalId: "123",
    mrn: "MRN-42",
    ageYears: 30,
    sex: "M",
    phone1: "123456",
    modalityNameEn: "CT",
    modalityGeneralInstructionAr: null,
    modalityGeneralInstructionEn: null,
    examNameEn: "CT Head",
    priorityNameEn: "Normal",
    status: "scheduled",
    isWalkIn: false,
    dailySequence: 1,
    modalitySlotNumber: null,
    createdAt: "2027-01-01",
    notes: null,
  }),
}));

vi.mock("@/lib/print-utils", () => ({
  printAppointmentSlip: vi.fn(),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/lib/i18n", () => ({
  t: vi.fn((_, key) => key),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

function renderWithRouter(initialEntry: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/print" element={<PrintPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PrintPage autoprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("autoprint fires once when autoprint=1 param is present", async () => {
    renderWithRouter("/print?appointmentId=42&autoprint=1");

    await waitFor(() => {
      expect(printUtils.printAppointmentSlip).toHaveBeenCalledTimes(1);
    });

    const mockCall = (printUtils.printAppointmentSlip as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mockCall.accessionNumber).toBe("ACC-42");
  });

  it("does not auto-print when autoprint param is missing", async () => {
    renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(printUtils.printAppointmentSlip).not.toHaveBeenCalled();
    });
  });

  it("does not auto-print when autoprint is not 1", async () => {
    renderWithRouter("/print?appointmentId=42&autoprint=0");

    await waitFor(() => {
      expect(printUtils.printAppointmentSlip).not.toHaveBeenCalled();
    });
  });
});
