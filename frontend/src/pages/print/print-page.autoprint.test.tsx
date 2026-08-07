import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PrintPage from "./print-page";
import * as printUtils from "@/lib/print-utils";
import * as apiHooks from "@/lib/api-hooks";

const {
  mockAppointmentData: mockAppointment42,
  mockAppointment42Updated,
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
    caseCategory: "oncology" as const,
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
  const mockAppointment42Updated = {
    ...mockAppointmentData,
    modalityGeneralInstructionEn: "New MRI preparation instructions",
    modalityGeneralInstructionAr: "ØªØ¹Ù„ÙŠÙ…Ø§Øª Ø¬Ø¯ÙŠØ¯Ø© Ù„Ù„ØªØ­Ø¶ÙŠØ± Ù‚Ø¨Ù„ Ø§Ù„ÙØ­Øµ",
  };
  const mockSlipSettings = {
    paperMode: "blank",
    paperSize: "a5",
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
    showPatientCategory: false,
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
    boldAppointmentSlipText: false,
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
    risproPublicBaseUrl: "https://rispro.nccb.com.ly",
    printQrOnAppointmentSlip: true,
    qrSlipPaperMode: "blank",
    qrSlipPaperSize: "a4",
  };
  return { mockAppointmentData, mockAppointment42Updated, mockAppointment99, mockSlipSettings, mockPatientQrSettings };
});

vi.mock("@/lib/api-hooks", () => ({
  DEFAULT_APPOINTMENT_SLIP_SETTINGS: mockSlipSettings,
  DEFAULT_PATIENT_QR_SETTINGS: mockPatientQrSettings,
  fetchAppointments: vi.fn().mockResolvedValue([]),
  fetchAppointmentLookups: vi.fn().mockResolvedValue({ modalities: [], examTypes: [] }),
  getAppointmentById: vi.fn().mockResolvedValue(mockAppointment42),
  fetchAppointmentSlipSettings: vi.fn().mockResolvedValue(mockSlipSettings),
  fetchPatientQrSettings: vi.fn().mockResolvedValue(mockPatientQrSettings),
}));

vi.mock("@/lib/print-utils", () => ({
  prepareAppointmentSlipHtml: vi.fn().mockResolvedValue("<html><body>preview</body></html>"),
  printAppointmentSlip: vi.fn(),
  filterVisibleAppointments: vi.fn((items) => items),
}));
vi.mock("@/lib/registration-list-printing", () => ({
  printAppointmentListV2: vi.fn(),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 1, username: "supervisor", fullName: "Supervisor", role: "supervisor" }, isLoading: false }),
}));

vi.mock("@/lib/i18n", () => ({
  chooseLocalized: vi.fn((_, primary, secondary) => primary || secondary || ""),
  statusLabel: vi.fn((_, status) => status),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    expect(screen.queryByRole("button", { name: "print.downloadPdf" })).toBeNull();
  });

  it("Confirm Print remains disabled while direct appointment is loading", async () => {
    const pending = deferred<typeof mockAppointment42>();
    vi.mocked(apiHooks.getAppointmentById).mockImplementationOnce(() => pending.promise);
    renderWithRouter("/print?appointmentId=42");

    const confirmButton = await screen.findByRole("button", { name: "print.confirmPrint" });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);
    expect(printUtils.prepareAppointmentSlipHtml).not.toHaveBeenCalled();
    pending.resolve(mockAppointment42);
  });

  it("Confirm Print becomes enabled when direct appointment loads", async () => {
    renderWithRouter("/print?appointmentId=42");

    const confirmButton = await screen.findByRole("button", { name: "print.confirmPrint" });
    await waitFor(() => {
      expect(confirmButton.hasAttribute("disabled")).toBe(false);
    });
  });

  it("direct preview print action uses appointmentById and is not overwritten by list selection", async () => {
    vi.mocked(apiHooks.fetchAppointments).mockResolvedValueOnce([mockAppointment99]);
    renderWithRouter("/print?appointmentId=42");

    const confirmButton = await screen.findByRole("button", { name: "print.confirmPrint" });
    await waitFor(() => {
      expect(confirmButton.hasAttribute("disabled")).toBe(false);
    });
    confirmButton.click();

    await waitFor(() => {
      expect(printUtils.printAppointmentSlip).toHaveBeenCalledTimes(1);
    });
    const printedAppointment = (printUtils.printAppointmentSlip as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(printedAppointment.id).toBe(42);
  });

  it("shows explicit error when appointmentById request fails", async () => {
    vi.mocked(apiHooks.getAppointmentById).mockRejectedValueOnce(new Error("HTTP 404: not found"));
    renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(screen.getByText(/Appointment could not be loaded/i)).toBeTruthy();
    });
    expect(screen.getByText(/HTTP 404: not found/i)).toBeTruthy();
    expect(printUtils.prepareAppointmentSlipHtml).not.toHaveBeenCalled();
  });

  it("preview generation does not loop in direct preview mode", async () => {
    renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(printUtils.prepareAppointmentSlipHtml).toHaveBeenCalledTimes(1);
    });
  });

  it("refetches direct print data after remount so updated modality instructions are used", async () => {
    const oldAppointment = {
      ...mockAppointment42,
      modalityGeneralInstructionEn: "Remove metal items before the study and follow MRI unit instructions.",
      modalityGeneralInstructionAr: "إزالة المعادن قبل الفحص واتباع تعليمات القسم.",
    };
    const getAppointmentById = vi.mocked(apiHooks.getAppointmentById);
    getAppointmentById
      .mockResolvedValueOnce(oldAppointment)
      .mockResolvedValueOnce(mockAppointment42Updated);

    const firstRender = renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(printUtils.prepareAppointmentSlipHtml).toHaveBeenCalledTimes(1);
    });
    expect(printUtils.prepareAppointmentSlipHtml).toHaveBeenLastCalledWith(oldAppointment, {
      slipSettings: mockSlipSettings,
      patientQrSettings: mockPatientQrSettings,
    });

    firstRender.unmount();
    renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(printUtils.prepareAppointmentSlipHtml).toHaveBeenCalledTimes(2);
    });
    expect(printUtils.prepareAppointmentSlipHtml).toHaveBeenLastCalledWith(mockAppointment42Updated, {
      slipSettings: mockSlipSettings,
      patientQrSettings: mockPatientQrSettings,
    });
  });

  it("list mode renders the report center", async () => {
    vi.mocked(apiHooks.fetchAppointments).mockResolvedValueOnce([mockAppointment99, mockAppointment42]);
    renderWithRouter("/print");

    expect((await screen.findAllByText("Print & Reports Center")).length).toBeGreaterThan(0);
    expect(screen.getByText("Daily appointment list")).toBeTruthy();
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
      expect(screen.getByText(/Appointment Slip Settings error: Slip settings 500/i)).toBeTruthy();
    });
    expect(printUtils.prepareAppointmentSlipHtml).not.toHaveBeenCalled();
    expect(printUtils.printAppointmentSlip).not.toHaveBeenCalled();
  });

  it("shows patient-qr-specific error when patient QR settings query fails", async () => {
    vi.mocked(apiHooks.fetchPatientQrSettings).mockRejectedValueOnce(new Error("Patient QR 503"));
    renderWithRouter("/print?appointmentId=42");

    await waitFor(() => {
      expect(screen.getByText(/Patient QR Settings error: Patient QR 503/i)).toBeTruthy();
    });
    expect(printUtils.prepareAppointmentSlipHtml).not.toHaveBeenCalled();
    expect(printUtils.printAppointmentSlip).not.toHaveBeenCalled();
  });
});
