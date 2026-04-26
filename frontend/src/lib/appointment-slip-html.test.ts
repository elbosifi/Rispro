import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPOINTMENT_SLIP_SETTINGS, type AppointmentSlipSettings, type PatientQrSettings } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { prepareAppointmentSlipHtml, printAppointmentSlip } from "./print-utils";

vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn().mockResolvedValue("<svg data-testid=\"qr\"></svg>"),
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,Zm9v"),
  },
}));

function makeAppointment(overrides: Partial<AppointmentWithDetails> = {}): AppointmentWithDetails {
  return {
    id: 7,
    patientId: 9,
    modalityId: 2,
    examTypeId: 3,
    reportingPriorityId: 1,
    accessionNumber: "ACC-7",
    appointmentDate: "2026-10-01",
    bookingTime: "10:30",
    dailySequence: 12,
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
    mrn: "MRN-1",
    ageYears: 33,
    sex: "F",
    phone1: "0911111111",
    modalityNameAr: "رنين",
    modalityNameEn: "MRI",
    modalityCode: "MR",
    modalityGeneralInstructionAr: "تعليمات الجهاز",
    modalityGeneralInstructionEn: "Modality instructions",
    examNameAr: "فحص الدماغ",
    examNameEn: "MRI Brain",
    examSpecificInstructionAr: "تعليمات الفحص",
    examSpecificInstructionEn: "Exam instructions",
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
    locationTextAr: "الطابق الأول",
    locationTextEn: "First floor",
    ...overrides,
  };
}

function makePatientQrSettings(overrides: Partial<PatientQrSettings> = {}): PatientQrSettings {
  return {
    enabled: true,
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
    qrReportCheckingMessage: "",
    qrReportFinalMessage: "",
    qrReportDraftMessage: "",
    qrReportNoReportMessage: "",
    qrReportUnavailableMessage: "",
    qrReportNotRequiredMessage: "",
    qrReportNotCompletedMessage: "",
    qrReportCheckButtonLabel: "",
    qrReportViewButtonLabel: "",
    qrImageViewButtonLabel: "",
    qrImageUnavailableMessage: "",
    qrReportStudyNotFoundMessage: "",
    qrImageStudyNotFoundMessage: "",
    pageTitleAr: "",
    pageTitleEn: "",
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
      centerNameAr: "",
      centerNameEn: "",
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

describe("appointment slip html renderer", () => {
  it("keeps real arabic text and rtl mode", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ languageMode: "ar" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain("مريض اختبار");
    expect(html).toContain('dir="rtl"');
  });

  it("uses english headings in english mode", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ languageMode: "en" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain("Patient Details");
    expect(html).toContain("Appointment Details");
  });

  it("includes bilingual captions when bilingual mode is selected", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ languageMode: "bilingual", qrCaptionAr: "تفاصيل الموعد", qrCaptionEn: "Appointment details" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain("تفاصيل الموعد");
    expect(html).toContain("Appointment details");
  });

  it("uses configurable captions and instruction headings", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({
        languageMode: "ar",
        qrCaptionAr: "امسح هنا",
        barcodeCaptionAr: "باركود الانتظار",
        modalityInstructionsHeadingAr: "تعليمات الجهاز",
        examInstructionsHeadingAr: "تعليمات الفحص",
      }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain("امسح هنا");
    expect(html).toContain("باركود الانتظار");
    expect(html).toContain("تعليمات الجهاز");
    expect(html).toContain("تعليمات الفحص");
  });

  it("uses preprinted geometry and suppresses the blank-paper header", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ paperMode: "preprinted" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain('data-paper-mode="preprinted"');
    expect(html).toContain('data-page-width-mm="148"');
    expect(html).toContain('data-page-height-mm="210"');
    expect(html).toContain('data-safe-top-mm="58"');
    expect(html).toContain('data-header-visible="false"');
  });

  it("renders compact single-language cards for arabic and english modes", async () => {
    const arabicHtml = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ languageMode: "ar" }),
      patientQrSettings: makePatientQrSettings(),
    });
    const englishHtml = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ languageMode: "en" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(arabicHtml).toContain("single-language-ar");
    expect(arabicHtml).not.toContain("bilingual-card");
    expect(arabicHtml).not.toContain("Patient Name");
    expect(englishHtml).toContain("single-language-en");
    expect(englishHtml).not.toContain("bilingual-card");
  });

  it("uses compact spacing css for a5 slips", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ paperMode: "blank", languageMode: "en" }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain(".content { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 1.2mm; }");
    expect(html).toContain(".summary-item { border: 0.25mm solid #d1d5db; border-radius: 1.6mm; padding: 1mm; min-height: 8.5mm; background: #ffffff; }");
    expect(html).toContain('data-qr-panel-width-mm="');
  });

  it("hides time when showTime is false", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ showTime: false }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).not.toContain("10:30");
  });

  it("renders qr only when enabled and a token exists", async () => {
    const enabledHtml = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings(),
      patientQrSettings: makePatientQrSettings(),
    });
    const disabledHtml = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ showQrCode: false }),
      patientQrSettings: makePatientQrSettings(),
    });
    const noTokenHtml = await prepareAppointmentSlipHtml(makeAppointment({ publicCancelToken: "" }), {
      slipSettings: makeSlipSettings(),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(enabledHtml).toContain("qr-block");
    expect(disabledHtml).not.toContain("qr-block");
    expect(noTokenHtml).not.toContain("qr-block");
  });

  it("uses the accession number in the barcode by default", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment({ accessionNumber: "ACC-7" }), {
      slipSettings: makeSlipSettings(),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain('data-barcode-value="ACC-7"');
  });

  it("keeps accession number visible in appointment details when enabled", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment({ accessionNumber: "ACC-42" }), {
      slipSettings: makeSlipSettings({ languageMode: "en", showAccessionNumber: true }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html).toContain("Accession Number");
    expect(html).toContain("ACC-42");
  });

  it("renders location and arrival note only once in dedicated blocks", async () => {
    const html = await prepareAppointmentSlipHtml(makeAppointment(), {
      slipSettings: makeSlipSettings({ languageMode: "en", showLocation: true, showArrivalNote: true }),
      patientQrSettings: makePatientQrSettings(),
    });

    expect(html.match(/data-location-block="true"/g)?.length ?? 0).toBe(1);
    expect(html.match(/First floor/g)?.length ?? 0).toBe(1);
    expect(html.match(/data-arrival-note="true"/g)?.length ?? 0).toBe(1);
    expect(html.match(/Please arrive 15 minutes before your appointment/g)?.length ?? 0).toBe(1);
  });

  it("prints from html without routing through jsPDF blob generation", async () => {
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const printSpy = vi.fn();
    const focusSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);

    const frameDocument = document.implementation.createHTMLDocument("print");
    Object.defineProperty(frameDocument, "fonts", {
      value: { ready: Promise.resolve() },
      configurable: true,
    });

    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName !== "iframe") {
        return originalCreateElement(tagName);
      }
      const iframe = originalCreateElement("iframe");
      Object.defineProperty(iframe, "contentDocument", { value: frameDocument, configurable: true });
      Object.defineProperty(iframe, "contentWindow", {
        value: { print: printSpy, focus: focusSpy },
        configurable: true,
      });
      return iframe;
    }) as typeof document.createElement);

    printAppointmentSlip(makeAppointment());
    await Promise.resolve();
    await Promise.resolve();

    expect(appendChildSpy).toHaveBeenCalled();
    expect(printSpy).toHaveBeenCalled();
  });
});
