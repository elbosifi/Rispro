import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, afterAll } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { DEFAULT_APPOINTMENT_SLIP_SETTINGS, type AppointmentSlipSettings, type PatientQrSettings } from "@/lib/api-hooks";
import {
  buildAppointmentSlipData,
  buildAppointmentSlipLayoutModel,
  createAppointmentSlipPdfBlob,
} from "./print-utils";

vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn().mockResolvedValue("<svg />"),
    toDataURL: vi
      .fn()
      .mockResolvedValue("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3R0bkAAAAASUVORK5CYII="),
  },
}));

const regularFont = readFileSync(resolve(process.cwd(), "src/assets/fonts/NotoNaskhArabic-Regular.ttf"));
const boldFont = readFileSync(resolve(process.cwd(), "src/assets/fonts/NotoNaskhArabic-Bold.ttf"));

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("NotoNaskhArabic-Regular.ttf")) {
      return new Response(regularFont, { status: 200 });
    }
    if (url.includes("NotoNaskhArabic-Bold.ttf")) {
      return new Response(boldFont, { status: 200 });
    }
    return new Response(null, { status: 404 });
  })
);

afterAll(() => {
  vi.unstubAllGlobals();
});

function makeAppointment(overrides: Partial<AppointmentWithDetails> = {}): AppointmentWithDetails {
  return {
    id: 45,
    patientId: 10,
    modalityId: 2,
    examTypeId: 3,
    reportingPriorityId: 1,
    caseCategory: "oncology",
    accessionNumber: "V2-45",
    appointmentDate: "2026-10-01",
    bookingTime: "09:30",
    dailySequence: 7,
    status: "scheduled",
    isWalkIn: false,
    isOverbooked: false,
    overbookingReason: null,
    approvedByName: null,
    demographicsEstimated: false,
    notes: null,
    noShowReason: null,
    cancelReason: null,
    arrivedAt: null,
    completedAt: null,
    createdAt: "2026-04-01",
    updatedAt: "2026-04-01",
    arabicFullName: "مريض اختبار",
    englishFullName: "Test Patient",
    nationalId: "123456789012",
    mrn: "MRN-10",
    ageYears: 30,
    sex: "M",
    phone1: "0911111111",
    modalityNameAr: "أشعة مقطعية",
    modalityNameEn: "CT",
    modalityCode: "CT",
    modalityGeneralInstructionAr: "تعليمات الجهاز",
    modalityGeneralInstructionEn: "Modality prep",
    examNameAr: "فحص الرأس",
    examNameEn: "CT Head",
    examSpecificInstructionAr: "تعليمات الفحص",
    examSpecificInstructionEn: "Exam prep",
    priorityNameAr: "عادي",
    priorityNameEn: "Routine",
    modalitySlotNumber: null,
    publicCancelToken: "signed-token",
    ...overrides,
  };
}

function makeSlipSettings(overrides: Partial<AppointmentSlipSettings> = {}): AppointmentSlipSettings {
  return {
    ...DEFAULT_APPOINTMENT_SLIP_SETTINGS,
    paperMode: "preprinted",
    languageMode: "bilingual",
    safeTopMm: 58,
    safeBottomMm: 56,
    safeLeftMm: 10,
    safeRightMm: 10,
    contentPaddingMm: 3,
    fontScale: 1,
    qrSizeMm: 24,
    barcodeHeightMm: 12,
    barcodeWidthMm: 100,
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
    showWalkIn: true,
    showLocation: true,
    showArrivalNote: true,
    showQrCode: true,
    qrCaptionAr: "امسح للاطلاع على تفاصيل الموعد",
    qrCaptionEn: "Scan for appointment details",
    qrHelperTextAr: "استخدم الرمز لعرض تعليمات الفحص والموقع وخدمات الموعد.",
    qrHelperTextEn: "Use this QR code to open your appointment page, instructions, and location details.",
    showAccessionBarcode: true,
    barcodeValueMode: "accessionNumber",
    barcodeCaptionAr: "امسح للدخول إلى قائمة الانتظار",
    barcodeCaptionEn: "Scan to Enter The Queue",
    showModalityInstructions: true,
    showExamSpecificInstructions: true,
    maxInstructionLinesOnSlip: 4,
    fallbackInstructionTextAr: "يرجى مسح رمز QR للاطلاع على تعليمات الجهاز والفحص والموقع.",
    fallbackInstructionTextEn: "Scan the QR code for modality instructions, exam-specific instructions, and location details.",
    locationTextAr: "الطابق الأول",
    locationTextEn: "First floor",
    ...overrides,
  };
}

function makePatientQrSettings(overrides: Partial<PatientQrSettings> = {}): PatientQrSettings {
  return {
    enabled: true,
    risproPublicBaseUrl: "https://rispro.nccb.com.ly",
    printQrOnAppointmentSlip: true,
    allowCancellation: true,
    allowAddToCalendar: true,
    showBookingTime: true,
    showPreparationInstructions: true,
    showDocumentsChecklist: true,
    showDepartmentContact: false,
    showLocationDirections: false,
    allowReportAccess: false,
    allowImageAccess: false,
    showReportPendingCard: true,
    reportAccessRequiresCompletedAppointment: true,
    imageAccessRequiresCompletedAppointment: true,
    imageAccessRequiresReportRequiredFlag: false,
    showReportNotRequiredMessage: false,
    defaultReportRequiredForOncology: true,
    defaultReportRequiredForNonOncology: false,
    qrReportCheckingMessage: "Checking report status...",
    qrReportFinalMessage: "Your report is ready.",
    qrReportDraftMessage: "Your report is still under review and is not finalized yet.",
    qrReportNoReportMessage: "No report is available for this appointment yet.",
    qrReportUnavailableMessage: "The report system is temporarily unavailable. Please try again later.",
    qrReportNotRequiredMessage: "",
    qrReportNotCompletedMessage: "Report access becomes available after the examination is completed.",
    qrReportCheckButtonLabel: "Check report",
    qrReportViewButtonLabel: "View report",
    qrImageViewButtonLabel: "View images",
    qrImageUnavailableMessage: "Image viewing is currently unavailable. Please try again later.",
    qrReportStudyNotFoundMessage: "Your study is not available in the report system yet. Please try again later.",
    qrImageStudyNotFoundMessage: "Your study images are not available yet. Please try again later.",
    pageTitleAr: "خدمة المريض عبر رمز QR",
    pageTitleEn: "Patient QR Service",
    introTextAr: "",
    introTextEn: "",
    genericPreparationTextAr: "",
    genericPreparationTextEn: "",
    documentsChecklistAr: [],
    documentsChecklistEn: [],
    contact: {
      primaryPhone: "",
      secondaryPhone: "",
      whatsapp: "",
      whatsappEnabled: false,
      workingHoursAr: "",
      workingHoursEn: "",
      noteAr: "",
      noteEn: "",
    },
    location: {
      centerNameAr: "المركز الوطني للأورام بنغازي",
      centerNameEn: "National Cancer Center Benghazi",
      departmentLocationAr: "",
      departmentLocationEn: "",
      roomUnitFloorAr: "",
      roomUnitFloorEn: "",
      addressAr: "",
      addressEn: "",
      arrivalInstructionsAr: "",
      arrivalInstructionsEn: "",
      googleMapsUrl: "",
      parkingNoteAr: "",
      parkingNoteEn: "",
    },
    ...overrides,
  };
}

describe("appointment slip PDF", () => {
  it("builds a localized render model", () => {
    const slip = buildAppointmentSlipData(makeAppointment(), {
      slipSettings: makeSlipSettings({ languageMode: "ar" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(slip.hospitalName).toBe("المركز الوطني للأورام بنغازي");
    expect(slip.patientName).toBe("مريض اختبار");
    expect(slip.bookingTime).toBe("09:30");
    expect(slip.accessionBarcodePayload).toBe("V2-45");
  });

  it("formats slip dates with weekday plus numeric date by languageMode", () => {
    const appointment = makeAppointment({ appointmentDate: "2026-04-28" });

    const arabicSlip = buildAppointmentSlipData(appointment, {
      slipSettings: makeSlipSettings({ languageMode: "ar" }),
      patientQrSettings: makePatientQrSettings(),
    });
    const englishSlip = buildAppointmentSlipData(appointment, {
      slipSettings: makeSlipSettings({ languageMode: "en" }),
      patientQrSettings: makePatientQrSettings(),
    });
    const bilingualSlip = buildAppointmentSlipData(appointment, {
      slipSettings: makeSlipSettings({ languageMode: "bilingual" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(arabicSlip.appointmentDate).toBe("الثلاثاء 28/04/2026");
    expect(englishSlip.appointmentDate).toBe("Tuesday 28/04/2026");
    expect(bilingualSlip.appointmentDate).toBe("الثلاثاء 28/04/2026 / Tuesday 28/04/2026");
  });

  it("respects preprinted safe area and keeps barcode within bounds", () => {
    const layout = buildAppointmentSlipLayoutModel(
      makeAppointment(),
      makeSlipSettings(),
      makePatientQrSettings()
    );

    expect(Math.round(layout.safeArea.y)).toBeCloseTo(Math.round((58 * 72) / 25.4), 0);
    expect(layout.barcodeBlock?.clipped).toBe(false);
    expect(layout.barcodeBlock!.y + layout.barcodeBlock!.h).toBeLessThanOrEqual(layout.content.y + layout.content.h);
  });

  it("renders a valid A5 PDF blob in preprinted mode", async () => {
    const blob = await createAppointmentSlipPdfBlob(
      makeAppointment(),
      "preprinted",
      {
        slipSettings: makeSlipSettings({ showQrCode: false }),
        patientQrSettings: makePatientQrSettings(),
      }
    );

    expect(blob.type).toBe("application/pdf");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });
});
