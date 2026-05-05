import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { DEFAULT_APPOINTMENT_SLIP_SETTINGS, DEFAULT_PATIENT_QR_SETTINGS, type AppointmentSlipSettings, type PatientQrSettings } from "@/lib/api-hooks";
import {
  buildAppointmentSlipLayoutModel,
  buildAppointmentSlipData,
  prepareAppointmentSlipHtml,
} from "./print-utils";

const toStringMock = vi.hoisted(() => vi.fn().mockResolvedValue("<svg data-testid=\"qr-image\"></svg>"));
vi.mock("qrcode", () => ({
  default: {
    toString: toStringMock,
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,Zm9v"),
  },
}));

function makeAppointment(overrides: Partial<AppointmentWithDetails> = {}): AppointmentWithDetails {
  return {
    id: 45,
    patientId: 10,
    modalityId: 2,
    examTypeId: 3,
    reportingPriorityId: 1,
    accessionNumber: "V2-45",
    appointmentDate: "2026-10-01",
    bookingTime: "11:15",
    dailySequence: 9,
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
    modalityNameAr: "رنين",
    modalityNameEn: "MRI",
    modalityCode: "MR",
    modalityGeneralInstructionAr: "تعليمات طويلة",
    modalityGeneralInstructionEn: "Long modality preparation text",
    examNameAr: "فحص",
    examNameEn: "MRI Brain",
    examSpecificInstructionAr: "تعليمات خاصة",
    examSpecificInstructionEn: "Specific instructions",
    priorityNameAr: "عادي",
    priorityNameEn: "Routine",
    modalitySlotNumber: null,
    publicCancelToken: "signed-token",
    publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=signed-token",
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
    ...DEFAULT_PATIENT_QR_SETTINGS,
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
    reportAccessModalityMode: "all",
    reportAccessModalityIds: [],
    allowImageAccess: false,
    imageAccessModalityMode: "all",
    imageAccessModalityIds: [],
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
  } as PatientQrSettings;
}

describe("appointment slip QR and layout behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes the QR to the patient page when token exists", () => {
    const slip = buildAppointmentSlipData(makeAppointment(), {
      slipSettings: makeSlipSettings(),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(slip.queueQrPayload).toBe("https://rispro.nccb.com.ly/public/appointment?t=signed-token");
    expect(slip.queueQrPayload).toContain("/public/appointment?t=");
    expect(slip.queueQrPayload).not.toContain("localhost");
    expect(slip.queueQrPayload).not.toContain("192.168.");
  });

  it("uses canonical URL even when token exists and local browser origin differs", () => {
    const slip = buildAppointmentSlipData(
      makeAppointment({
        publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=signed-token",
      }),
      {
        slipSettings: makeSlipSettings(),
        patientQrSettings: makePatientQrSettings(),
      }
    );
    expect(slip.queueQrPayload).toBe("https://rispro.nccb.com.ly/public/appointment?t=signed-token");
  });

  it("print preview and print-now rendering paths use the same QR URL", async () => {
    const appointment = makeAppointment({
      publicAppointmentUrl: "https://rispro.nccb.com.ly/public/appointment?t=signed-token",
    });
    const slip = buildAppointmentSlipData(appointment, {
      slipSettings: makeSlipSettings(),
      patientQrSettings: makePatientQrSettings(),
    });
    await prepareAppointmentSlipHtml(appointment, {
      slipSettings: makeSlipSettings(),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(slip.queueQrPayload).toBe("https://rispro.nccb.com.ly/public/appointment?t=signed-token");
    expect(toStringMock).toHaveBeenCalledWith(
      "https://rispro.nccb.com.ly/public/appointment?t=signed-token",
      expect.any(Object)
    );
  });

  it("respects languageMode", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ languageMode: "ar", hospitalNameAr: "المركز الوطني للأورام بنغازي" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain("المركز الوطني للأورام بنغازي");
    expect(html).not.toContain("National Cancer Center Benghazi</div>");
  });

  it("respects showTime", async () => {
    const hiddenHtml = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ showTime: false }),
      patientQrSettings: makePatientQrSettings(),
    });
    const shownHtml = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ showTime: true }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(hiddenHtml).not.toContain("11:15");
    expect(shownHtml).toContain("11:15");
  });

  it("respects showQrCode", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ showQrCode: false }),
      patientQrSettings: makePatientQrSettings(),
    });
    const layout = buildAppointmentSlipLayoutModel(
      makeAppointment(),
      makeSlipSettings({ showQrCode: false }),
      makePatientQrSettings()
    );

    expect(html).not.toContain("<aside class=\"qr-block\"");
    expect(layout.qrBlock).toBeNull();
  });

  it("keeps current QR behavior in all modality mode", () => {
    const slip = buildAppointmentSlipData(makeAppointment({ modalityId: 2 }), {
      slipSettings: makeSlipSettings({ qrModalityMode: "all", qrModalityIds: [999] }),
      patientQrSettings: makePatientQrSettings(),
    });
    expect(slip.queueQrPayload).toContain("/public/appointment?t=");
  });

  it("shows QR for included modality", () => {
    const slip = buildAppointmentSlipData(makeAppointment({ modalityId: 2 }), {
      slipSettings: makeSlipSettings({ qrModalityMode: "include", qrModalityIds: [2] }),
      patientQrSettings: makePatientQrSettings(),
    });
    expect(slip.queueQrPayload).toContain("/public/appointment?t=");
  });

  it("hides QR for unselected include modality", () => {
    const slip = buildAppointmentSlipData(makeAppointment({ modalityId: 3 }), {
      slipSettings: makeSlipSettings({ qrModalityMode: "include", qrModalityIds: [2] }),
      patientQrSettings: makePatientQrSettings(),
    });
    expect(slip.queueQrPayload).toBe("");
  });

  it("hides QR for excluded modality", () => {
    const slip = buildAppointmentSlipData(makeAppointment({ modalityId: 2 }), {
      slipSettings: makeSlipSettings({ qrModalityMode: "exclude", qrModalityIds: [2] }),
      patientQrSettings: makePatientQrSettings(),
    });
    expect(slip.queueQrPayload).toBe("");
  });

  it("shows QR for non-excluded modality", () => {
    const slip = buildAppointmentSlipData(makeAppointment({ modalityId: 3 }), {
      slipSettings: makeSlipSettings({ qrModalityMode: "exclude", qrModalityIds: [2] }),
      patientQrSettings: makePatientQrSettings(),
    });
    expect(slip.queueQrPayload).toContain("/public/appointment?t=");
  });

  it("respects showAccessionBarcode", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ showAccessionBarcode: false }),
      patientQrSettings: makePatientQrSettings(),
    });
    const layout = buildAppointmentSlipLayoutModel(
      makeAppointment(),
      makeSlipSettings({ showAccessionBarcode: false }),
      makePatientQrSettings()
    );

    expect(html).not.toContain("data-barcode-value");
    expect(layout.barcodeBlock).toBeNull();
  });

  it("renders the QR block when enabled", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings(),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain("<aside class=\"qr-block\"");
  });

  it("keeps barcode inside the safe area", () => {
    const layout = buildAppointmentSlipLayoutModel(
      makeAppointment(),
      makeSlipSettings(),
      makePatientQrSettings()
    );

    expect(layout.barcodeBlock?.clipped).toBe(false);
  });
});
