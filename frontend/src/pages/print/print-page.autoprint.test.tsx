import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PrintPage from "./print-page";
import * as printUtils from "@/lib/print-utils";
import * as apiHooks from "@/lib/api-hooks";

const { mockAppointmentData: mockAppointment42, mockAppointment99 } = vi.hoisted(() => {
  const mockAppointmentData = {
    id: 42,
    patientId: 1,
    modalityId: 1,
    examTypeId: 101,
    reportingPriorityId: null,
    accessionNumber: "ACC-42",
    appointmentDate: "2027-01-03",
    dailySequence: 1,
    status: "scheduled" as const,
    isWalkIn: false,
    arabicFullName: "مريض",
    englishFullName: "Test Patient",
    nationalId: "123",
    mrn: "MRN-42",
    ageYears: 30,
    sex: "M",
    phone1: "123456",
    modalityNameAr: "CT",
    modalityNameEn: "CT",
    modalityCode: "CT",
    modalityGeneralInstructionAr: null,
    modalityGeneralInstructionEn: null,
    examNameAr: "رأس CT",
    examNameEn: "CT Head",
    priorityNameAr: "عادي",
    priorityNameEn: "Normal",
    modalitySlotNumber: null,
    createdAt: "2027-01-01",
    notes: null,
  };
  const mockAppointment99 = {
    ...mockAppointmentData,
    id: 99,
    accessionNumber: "ACC-99",
  };
  return { mockAppointmentData, mockAppointment99 };
});

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: vi.fn().mockResolvedValue([]),
  fetchAppointmentLookups: vi.fn().mockResolvedValue({ modalities: [], examTypes: [] }),
  getAppointmentById: vi.fn().mockResolvedValue(mockAppointment42),
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

  it("autoprint resets and fires again when appointmentId changes", async () => {
    const getAppointmentById = vi.spyOn(apiHooks, "getAppointmentById");

    getAppointmentById
      .mockResolvedValueOnce(mockAppointment42)
      .mockResolvedValueOnce(mockAppointment99);

    renderWithRouter("/print?appointmentId=42&autoprint=1");

    await waitFor(() => {
      expect(printUtils.printAppointmentSlip).toHaveBeenCalledTimes(1);
    });

    const firstCall = (printUtils.printAppointmentSlip as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.accessionNumber).toBe("ACC-42");

    vi.clearAllMocks();

    renderWithRouter("/print?appointmentId=99&autoprint=1");

    await waitFor(() => {
      expect(printUtils.printAppointmentSlip).toHaveBeenCalledTimes(1);
    });

    const secondCall = (printUtils.printAppointmentSlip as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(secondCall.accessionNumber).toBe("ACC-99");
  });
});
