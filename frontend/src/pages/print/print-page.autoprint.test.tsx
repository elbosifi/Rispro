import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PrintPage from "./print-page";
import * as printUtils from "@/lib/print-utils";
import * as apiHooks from "@/lib/api-hooks";

const {
  mockAppointmentData: mockAppointment42,
  mockAppointment99,
  mockSlipSettings,
  mockPatientQrSettings,
} = vi.hoisted(() => {
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
    examSpecificInstructionAr: null,
    examSpecificInstructionEn: null,
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
  const mockSlipSettings = {
    paperMode: "blank",
    languageMode: "ar",
    safeTopMm: 12,
    safeBottomMm: 14,
    safeLeftMm: 8,
    safeRightMm: 9,
    contentPaddingMm: 4,
    fontScale: 1,
    qrSizeMm: 18,
    barcodeHeightMm: 10,
    barcodeWidthMm: 80,
    hospitalNameAr: "Arabic Hospital",
    hospitalNameEn: "English Hospital",
    departmentNameAr: "Arabic Department",
    departmentNameEn: "English Department",
    slipTitleAr: "Arabic Slip",
    slipTitleEn: "English Slip",
    patientDetailsHeadingAr: "Arabic Patient",
    patientDetailsHeadingEn: "English Patient",
    appointmentDetailsHeadingAr: "Arabic Appointment",
    appointmentDetailsHeadingEn: "English Appointment",
    instructionsHeadingAr: "Arabic Instructions",
    instructionsHeadingEn: "English Instructions",
    modalityInstructionsHeadingAr: "Arabic Modality",
    modalityInstructionsHeadingEn: "English Modality",
    examInstructionsHeadingAr: "Arabic Exam",
    examInstructionsHeadingEn: "English Exam",
    locationHeadingAr: "Arabic Location",
    locationHeadingEn: "English Location",
    showPatientName: true,
    showMrn: true,
    showNationalId: false,
    showPhone: true,
    showAgeSex: true,
    showAppointmentNumber: true,
    showAccessionNumber: true,
    showModality: true,
    showExamName: true,
    showDate: true,
    showTime: false,
    showWalkIn: true,
    showLocation: true,
    showArrivalNote: true,
    showQrCode: true,
    qrCaptionAr: "Arabic QR",
    qrCaptionEn: "English QR",
    qrHelperTextAr: "Arabic helper",
    qrHelperTextEn: "English helper",
    showAccessionBarcode: true,
    barcodeValueMode: "accessionNumber",
    barcodeCaptionAr: "Arabic Barcode",
    barcodeCaptionEn: "English Barcode",
    showModalityInstructions: true,
    showExamSpecificInstructions: true,
    maxInstructionLinesOnSlip: 4,
    fallbackInstructionTextAr: "Arabic fallback",
    fallbackInstructionTextEn: "English fallback",
    locationTextAr: "Arabic location text",
    locationTextEn: "English location text",
  };
  const mockPatientQrSettings = {
    enabled: true,
    printQrOnAppointmentSlip: true,
  };
  return { mockAppointmentData, mockAppointment99, mockSlipSettings, mockPatientQrSettings };
});

vi.mock("@/lib/api-hooks", () => ({
  fetchAppointments: vi.fn().mockResolvedValue([]),
  fetchAppointmentLookups: vi.fn().mockResolvedValue({ modalities: [], examTypes: [] }),
  getAppointmentById: vi.fn().mockResolvedValue(mockAppointment42),
  fetchAppointmentSlipSettings: vi.fn().mockResolvedValue(mockSlipSettings),
  fetchPatientQrSettings: vi.fn().mockResolvedValue(mockPatientQrSettings),
}));

vi.mock("@/lib/print-utils", () => ({
  downloadAppointmentSlipPdf: vi.fn(),
  prepareAppointmentSlipHtml: vi.fn().mockResolvedValue("<html><body>preview</body></html>"),
  printAppointmentSlip: vi.fn(),
  filterVisibleAppointments: vi.fn((items) => items),
  printAppointmentList: vi.fn(),
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
    expect((printUtils.printAppointmentSlip as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({
      slipSettings: mockSlipSettings,
      patientQrSettings: mockPatientQrSettings,
    });
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

  it("shows preview controls when appointmentId is present", async () => {
    renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(screen.getByText("print.previewTitle")).toBeTruthy();
    });
    await waitFor(() => {
      expect(printUtils.prepareAppointmentSlipHtml).toHaveBeenCalledWith(mockAppointment42, {
        slipSettings: mockSlipSettings,
        patientQrSettings: mockPatientQrSettings,
      });
    });
    expect(screen.getByRole("button", { name: "print.confirmPrint" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "print.downloadPdf" })).toBeTruthy();
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

  it("shows appointment-slip-specific error when appointment slip settings query fails", async () => {
    vi.mocked(apiHooks.fetchAppointmentSlipSettings).mockRejectedValueOnce(new Error("Slip settings 500"));
    renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(screen.getByText(/Appointment Slip Settings could not be loaded/i)).toBeTruthy();
    });
    expect(screen.getByText(/Appointment Slip Settings error: Slip settings 500/i)).toBeTruthy();
    expect(printUtils.prepareAppointmentSlipHtml).not.toHaveBeenCalled();
    expect(printUtils.printAppointmentSlip).not.toHaveBeenCalled();
  });

  it("shows patient-qr-specific error when patient QR settings query fails", async () => {
    vi.mocked(apiHooks.fetchPatientQrSettings).mockRejectedValueOnce(new Error("Patient QR 503"));
    renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(screen.getByText(/Patient QR Settings could not be loaded/i)).toBeTruthy();
    });
    expect(screen.getByText(/Patient QR Settings error: Patient QR 503/i)).toBeTruthy();
    expect(printUtils.prepareAppointmentSlipHtml).not.toHaveBeenCalled();
    expect(printUtils.printAppointmentSlip).not.toHaveBeenCalled();
  });
});
