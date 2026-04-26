import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  DEFAULT_APPOINTMENT_SLIP_SETTINGS,
  DEFAULT_PATIENT_QR_SETTINGS,
  fetchAppointmentSlipSettings,
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
    expect(settings.languageMode).toBe("bilingual");
    expect(settings.safeTopMm).toBe(58);
    expect(settings.safeBottomMm).toBe(56);
    expect(settings.hospitalNameAr).toBe("المركز الوطني للأورام بنغازي");
    expect(settings.departmentNameEn).toBe("Diagnostic Radiology Department");
    expect(settings.showQrCode).toBe(true);
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

  it("fetches patient QR settings from the dedicated category", async () => {
    vi.mocked(api).mockResolvedValue({
      settings: [{ setting_key: "config", setting_value: { value: {} } }],
    });

    await fetchPatientQrSettings();

    expect(api).toHaveBeenCalledWith("/settings/patient_qr_self_service");
  });

  it("default settings constants do not contain mojibake markers", () => {
    const serialized = JSON.stringify({
      slip: DEFAULT_APPOINTMENT_SLIP_SETTINGS,
      patientQr: DEFAULT_PATIENT_QR_SETTINGS,
    });

    expect(serialized).not.toMatch(/[ÃÂþ]|â€”|â€¦|ï¿½/);
  });
});
