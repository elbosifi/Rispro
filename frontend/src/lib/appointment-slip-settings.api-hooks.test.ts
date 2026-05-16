import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  DEFAULT_APPOINTMENT_SLIP_SETTINGS,
  DEFAULT_PATIENT_QR_SETTINGS,
  fetchAppointmentSlipSettings,
  fetchPublicAppointmentSlipDetails,
  fetchPatientQrSettings,
  saveAppointmentSlipSettings,
  type AppointmentSlipSettings,
} from "./api-hooks";

vi.mock("@/lib/api-client", () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;

    constructor(message: string, status: number, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));

describe("appointment slip settings api hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes defaults when config is missing values", async () => {
    vi.mocked(api).mockResolvedValue({
      settings: [{ setting_key: "config", setting_value: { value: {} } }],
    });

    const settings = await fetchAppointmentSlipSettings();

    expect(settings.paperMode).toBe("preprinted");
    expect(settings.paperSize).toBe("a5");
    expect(settings.languageMode).toBe("bilingual");
    expect(settings.safeTopMm).toBe(58);
    expect(settings.safeBottomMm).toBe(56);
    expect(settings.hospitalNameAr).toBe("المركز الوطني للأورام بنغازي");
    expect(settings.departmentNameEn).toBe("Diagnostic Radiology Department");
    expect(settings.showQrCode).toBe(true);
    expect(settings.qrModalityMode).toBe("all");
    expect(settings.qrModalityIds).toEqual([]);
    expect(settings.showPatientCategory).toBe(false);
    expect(settings.boldAppointmentSlipText).toBe(false);
    expect(settings.barcodeValueMode).toBe("accessionNumber");
  });

  it("fetches appointment slip settings from the dedicated category", async () => {
    vi.mocked(api).mockResolvedValue({
      settings: [
        {
          setting_key: "config",
          setting_value: {
            value: {
              paperMode: "blank",
              paperSize: "a4",
              languageMode: "ar",
              showTime: false,
            },
          },
        },
      ],
    });

    const settings = await fetchAppointmentSlipSettings();

    expect(api).toHaveBeenCalledWith("/settings/appointment_slip");
    expect(settings.paperMode).toBe("blank");
    expect(settings.paperSize).toBe("a4");
    expect(settings.languageMode).toBe("ar");
    expect(settings.showTime).toBe(false);
  });

  it("saves appointment slip settings under appointment_slip/config", async () => {
    vi.mocked(api).mockResolvedValue({});
    const payload: AppointmentSlipSettings = {
      ...DEFAULT_APPOINTMENT_SLIP_SETTINGS,
      paperMode: "blank",
      languageMode: "en",
      safeTopMm: 10,
      safeBottomMm: 12,
      safeLeftMm: 8,
      safeRightMm: 9,
      contentPaddingMm: 3,
      fontScale: 1,
      qrSizeMm: 24,
      barcodeHeightMm: 12,
      barcodeWidthMm: 90,
      hospitalNameAr: "المركز الوطني للأورام بنغازي",
      hospitalNameEn: "National Cancer Center Benghazi",
      departmentNameAr: "قسم الأشعة التشخيصية",
      departmentNameEn: "Diagnostic Radiology Department",
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
      showTime: true,
      showWalkIn: false,
      showLocation: true,
      showArrivalNote: true,
      showQrCode: true,
      qrModalityMode: "exclude",
      qrModalityIds: [2, 7],
      qrCaptionAr: "QR",
      qrCaptionEn: "QR",
      qrHelperTextAr: "Helper",
      qrHelperTextEn: "Helper",
      showAccessionBarcode: true,
      barcodeValueMode: "bookingId",
      barcodeCaptionAr: "Barcode",
      barcodeCaptionEn: "Barcode",
      showModalityInstructions: true,
      showExamSpecificInstructions: true,
      maxInstructionLinesOnSlip: 4,
      fallbackInstructionTextAr: "Fallback",
      fallbackInstructionTextEn: "Fallback",
      locationTextAr: "Location",
      locationTextEn: "Location",
    };

    await saveAppointmentSlipSettings(payload);

    expect(api).toHaveBeenCalledWith("/settings/appointment_slip", {
      method: "PUT",
      body: JSON.stringify({
        entries: [{ key: "config", value: payload }],
      }),
    });
  });

  it("normalizes invalid qr modality rule values safely", async () => {
    vi.mocked(api).mockResolvedValue({
      settings: [
        {
          setting_key: "config",
          setting_value: {
            value: {
              qrModalityMode: "bad-mode",
              qrModalityIds: [2, "7", null, "x", 2, -1],
            },
          },
        },
      ],
    });

    const settings = await fetchAppointmentSlipSettings();

    expect(settings.qrModalityMode).toBe("all");
    expect(settings.qrModalityIds).toEqual([2, 7]);
  });

  it("fetches patient QR settings from the dedicated category", async () => {
    vi.mocked(api).mockResolvedValue({
      settings: [{ setting_key: "config", setting_value: { value: {} } }],
    });

    await fetchPatientQrSettings();

    expect(api).toHaveBeenCalledWith("/settings/patient_qr_self_service");
  });

  it("normalizes patient QR public RISpro base URL", async () => {
    vi.mocked(api).mockResolvedValue({
      settings: [
        {
          setting_key: "config",
          setting_value: {
            value: {
              risproPublicBaseUrl: "https://custom.rispro.example",
            },
          },
        },
      ],
    });

    const settings = await fetchPatientQrSettings();

    expect(settings.risproPublicBaseUrl).toBe("https://custom.rispro.example");
  });

  it("normalizes patient QR slip paper defaults", async () => {
    vi.mocked(api).mockResolvedValue({
      settings: [{ setting_key: "config", setting_value: { value: {} } }],
    });

    const settings = await fetchPatientQrSettings();

    expect(settings.qrSlipPaperMode).toBe("blank");
    expect(settings.qrSlipPaperSize).toBe("a4");
  });

  it("normalizes public appointment slip details", async () => {
    vi.mocked(api).mockResolvedValue({
      appointment: {
        id: 12,
        patient_id: 1,
        accession_number: "V2-000012",
        appointment_date: "2026-07-01",
        booking_time: "10:30:00",
        daily_sequence: 1,
        status: "scheduled",
        is_walk_in: false,
        arabic_full_name: "مريض",
        english_full_name: "Patient",
        age_years: 40,
        sex: "F",
        modality_name_ar: "CT",
        modality_name_en: "CT",
        modality_code: "CT",
      },
      slipSettings: { paperMode: "blank", paperSize: "a4" },
      patientQrSettings: {},
    });

    const details = await fetchPublicAppointmentSlipDetails("signed-token");

    expect(api).toHaveBeenCalledWith("/public/appointments/slip?t=signed-token");
    expect(details.appointment.id).toBe(12);
    expect(details.slipSettings.paperMode).toBe("blank");
    expect(details.slipSettings.paperSize).toBe("a4");
    expect(details.patientQrSettings.qrSlipPaperMode).toBe("blank");
    expect(details.patientQrSettings.qrSlipPaperSize).toBe("a4");
  });

  it("normalizes patient QR modality scope fields safely", async () => {
    vi.mocked(api).mockResolvedValue({
      settings: [
        {
          setting_key: "config",
          setting_value: {
            value: {
              reportAccessModalityMode: "bad",
              reportAccessModalityIds: [2, "7", null, "x", 2],
              imageAccessModalityMode: "exclude",
              imageAccessModalityIds: [5, "5", -1, "a"],
            },
          },
        },
      ],
    });

    const settings = await fetchPatientQrSettings();

    expect(settings.reportAccessModalityMode).toBe("all");
    expect(settings.reportAccessModalityIds).toEqual([2, 7]);
    expect(settings.imageAccessModalityMode).toBe("exclude");
    expect(settings.imageAccessModalityIds).toEqual([5]);
  });

  it("default settings constants do not contain mojibake markers", () => {
    const serialized = JSON.stringify({
      slip: DEFAULT_APPOINTMENT_SLIP_SETTINGS,
      patientQr: DEFAULT_PATIENT_QR_SETTINGS,
    });

    expect(serialized).not.toMatch(/[ÃÂþ]|â€”|â€¦|ï¿½/);
  });
});
