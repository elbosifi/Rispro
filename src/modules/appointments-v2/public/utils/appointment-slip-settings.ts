import { getSettingsByCategory } from "../../../../services/settings-service.js";

export type AppointmentSlipPaperMode = "blank" | "preprinted";
export type AppointmentSlipLanguageMode = "ar" | "en" | "bilingual";
export type AppointmentSlipBarcodeValueMode = "accessionNumber" | "appointmentNumber" | "bookingId";
export type AppointmentSlipQrModalityMode = "all" | "include" | "exclude";

export interface AppointmentSlipSettings {
  paperMode: AppointmentSlipPaperMode;
  languageMode: AppointmentSlipLanguageMode;
  safeTopMm: number;
  safeBottomMm: number;
  safeLeftMm: number;
  safeRightMm: number;
  contentPaddingMm: number;
  fontScale: number;
  qrSizeMm: number;
  barcodeHeightMm: number;
  barcodeWidthMm: number;
  hospitalNameAr: string;
  hospitalNameEn: string;
  departmentNameAr: string;
  departmentNameEn: string;
  slipTitleAr: string;
  slipTitleEn: string;
  patientDetailsHeadingAr: string;
  patientDetailsHeadingEn: string;
  appointmentDetailsHeadingAr: string;
  appointmentDetailsHeadingEn: string;
  instructionsHeadingAr: string;
  instructionsHeadingEn: string;
  modalityInstructionsHeadingAr: string;
  modalityInstructionsHeadingEn: string;
  examInstructionsHeadingAr: string;
  examInstructionsHeadingEn: string;
  locationHeadingAr: string;
  locationHeadingEn: string;
  showPatientCategory: boolean;
  showPatientName: boolean;
  showMrn: boolean;
  showNationalId: boolean;
  showPhone: boolean;
  showAgeSex: boolean;
  showAppointmentNumber: boolean;
  showAccessionNumber: boolean;
  showModality: boolean;
  showExamName: boolean;
  showDate: boolean;
  showTime: boolean;
  showWalkIn: boolean;
  showLocation: boolean;
  showArrivalNote: boolean;
  boldAppointmentSlipText: boolean;
  showQrCode: boolean;
  qrModalityMode: AppointmentSlipQrModalityMode;
  qrModalityIds: number[];
  qrCaptionAr: string;
  qrCaptionEn: string;
  qrHelperTextAr: string;
  qrHelperTextEn: string;
  showAccessionBarcode: boolean;
  barcodeValueMode: AppointmentSlipBarcodeValueMode;
  barcodeCaptionAr: string;
  barcodeCaptionEn: string;
  showModalityInstructions: boolean;
  showExamSpecificInstructions: boolean;
  maxInstructionLinesOnSlip: number;
  fallbackInstructionTextAr: string;
  fallbackInstructionTextEn: string;
  locationTextAr: string;
  locationTextEn: string;
}

const DEFAULT_SETTINGS: AppointmentSlipSettings = {
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
  slipTitleAr: "وصل الموعد",
  slipTitleEn: "Appointment Slip",
  patientDetailsHeadingAr: "بيانات المريض",
  patientDetailsHeadingEn: "Patient Details",
  appointmentDetailsHeadingAr: "بيانات الموعد",
  appointmentDetailsHeadingEn: "Appointment Details",
  instructionsHeadingAr: "التعليمات",
  instructionsHeadingEn: "Instructions",
  modalityInstructionsHeadingAr: "تعليمات حسب نوع الجهاز",
  modalityInstructionsHeadingEn: "Modality Instructions",
  examInstructionsHeadingAr: "تعليمات خاصة بالفحص",
  examInstructionsHeadingEn: "Exam Instructions",
  locationHeadingAr: "موقع الفحص",
  locationHeadingEn: "Exam Location",
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
  showTime: true,
  showWalkIn: true,
  showLocation: true,
  showArrivalNote: true,
  boldAppointmentSlipText: false,
  showQrCode: true,
  qrModalityMode: "all",
  qrModalityIds: [],
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
  locationTextAr: "",
  locationTextEn: "",
};

function readRawValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "enabled", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "disabled", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value).trim();
}

function asNumber(value: unknown, fallback: number, bounds?: { min?: number; max?: number }): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  let next = parsed;
  if (bounds?.min != null && next < bounds.min) next = bounds.min;
  if (bounds?.max != null && next > bounds.max) next = bounds.max;
  return next;
}

export function normalizeAppointmentSlipSettings(raw: unknown): AppointmentSlipSettings {
  const record = (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const paperMode = asString(record.paperMode, DEFAULT_SETTINGS.paperMode);
  const languageMode = asString(record.languageMode, DEFAULT_SETTINGS.languageMode);
  const barcodeValueMode = asString(record.barcodeValueMode, DEFAULT_SETTINGS.barcodeValueMode);
  const qrModalityMode = asString(record.qrModalityMode, DEFAULT_SETTINGS.qrModalityMode);
  const qrModalityIds = Array.isArray(record.qrModalityIds)
    ? record.qrModalityIds
        .map((value) => Number(value))
        .filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index)
    : [];

  return {
    paperMode: paperMode === "blank" ? "blank" : "preprinted",
    languageMode: languageMode === "ar" || languageMode === "en" ? languageMode : "bilingual",
    safeTopMm: asNumber(record.safeTopMm, DEFAULT_SETTINGS.safeTopMm, { min: 0, max: 120 }),
    safeBottomMm: asNumber(record.safeBottomMm, DEFAULT_SETTINGS.safeBottomMm, { min: 0, max: 120 }),
    safeLeftMm: asNumber(record.safeLeftMm, DEFAULT_SETTINGS.safeLeftMm, { min: 0, max: 80 }),
    safeRightMm: asNumber(record.safeRightMm, DEFAULT_SETTINGS.safeRightMm, { min: 0, max: 80 }),
    contentPaddingMm: asNumber(record.contentPaddingMm, DEFAULT_SETTINGS.contentPaddingMm, { min: 0, max: 20 }),
    fontScale: asNumber(record.fontScale, DEFAULT_SETTINGS.fontScale, { min: 0.7, max: 1.6 }),
    qrSizeMm: asNumber(record.qrSizeMm, DEFAULT_SETTINGS.qrSizeMm, { min: 12, max: 48 }),
    barcodeHeightMm: asNumber(record.barcodeHeightMm, DEFAULT_SETTINGS.barcodeHeightMm, { min: 6, max: 28 }),
    barcodeWidthMm: asNumber(record.barcodeWidthMm, DEFAULT_SETTINGS.barcodeWidthMm, { min: 40, max: 130 }),
    hospitalNameAr: asString(record.hospitalNameAr, DEFAULT_SETTINGS.hospitalNameAr),
    hospitalNameEn: asString(record.hospitalNameEn, DEFAULT_SETTINGS.hospitalNameEn),
    departmentNameAr: asString(record.departmentNameAr, DEFAULT_SETTINGS.departmentNameAr),
    departmentNameEn: asString(record.departmentNameEn, DEFAULT_SETTINGS.departmentNameEn),
    slipTitleAr: asString(record.slipTitleAr, DEFAULT_SETTINGS.slipTitleAr),
    slipTitleEn: asString(record.slipTitleEn, DEFAULT_SETTINGS.slipTitleEn),
    patientDetailsHeadingAr: asString(record.patientDetailsHeadingAr, DEFAULT_SETTINGS.patientDetailsHeadingAr),
    patientDetailsHeadingEn: asString(record.patientDetailsHeadingEn, DEFAULT_SETTINGS.patientDetailsHeadingEn),
    appointmentDetailsHeadingAr: asString(record.appointmentDetailsHeadingAr, DEFAULT_SETTINGS.appointmentDetailsHeadingAr),
    appointmentDetailsHeadingEn: asString(record.appointmentDetailsHeadingEn, DEFAULT_SETTINGS.appointmentDetailsHeadingEn),
    instructionsHeadingAr: asString(record.instructionsHeadingAr, DEFAULT_SETTINGS.instructionsHeadingAr),
    instructionsHeadingEn: asString(record.instructionsHeadingEn, DEFAULT_SETTINGS.instructionsHeadingEn),
    modalityInstructionsHeadingAr: asString(record.modalityInstructionsHeadingAr, DEFAULT_SETTINGS.modalityInstructionsHeadingAr),
    modalityInstructionsHeadingEn: asString(record.modalityInstructionsHeadingEn, DEFAULT_SETTINGS.modalityInstructionsHeadingEn),
    examInstructionsHeadingAr: asString(record.examInstructionsHeadingAr, DEFAULT_SETTINGS.examInstructionsHeadingAr),
    examInstructionsHeadingEn: asString(record.examInstructionsHeadingEn, DEFAULT_SETTINGS.examInstructionsHeadingEn),
    locationHeadingAr: asString(record.locationHeadingAr, DEFAULT_SETTINGS.locationHeadingAr),
    locationHeadingEn: asString(record.locationHeadingEn, DEFAULT_SETTINGS.locationHeadingEn),
    showPatientCategory: asBoolean(record.showPatientCategory, DEFAULT_SETTINGS.showPatientCategory),
    showPatientName: asBoolean(record.showPatientName, DEFAULT_SETTINGS.showPatientName),
    showMrn: asBoolean(record.showMrn, DEFAULT_SETTINGS.showMrn),
    showNationalId: asBoolean(record.showNationalId, DEFAULT_SETTINGS.showNationalId),
    showPhone: asBoolean(record.showPhone, DEFAULT_SETTINGS.showPhone),
    showAgeSex: asBoolean(record.showAgeSex, DEFAULT_SETTINGS.showAgeSex),
    showAppointmentNumber: asBoolean(record.showAppointmentNumber, DEFAULT_SETTINGS.showAppointmentNumber),
    showAccessionNumber: asBoolean(record.showAccessionNumber, DEFAULT_SETTINGS.showAccessionNumber),
    showModality: asBoolean(record.showModality, DEFAULT_SETTINGS.showModality),
    showExamName: asBoolean(record.showExamName, DEFAULT_SETTINGS.showExamName),
    showDate: asBoolean(record.showDate, DEFAULT_SETTINGS.showDate),
    showTime: asBoolean(record.showTime, DEFAULT_SETTINGS.showTime),
    showWalkIn: asBoolean(record.showWalkIn, DEFAULT_SETTINGS.showWalkIn),
    showLocation: asBoolean(record.showLocation, DEFAULT_SETTINGS.showLocation),
    showArrivalNote: asBoolean(record.showArrivalNote, DEFAULT_SETTINGS.showArrivalNote),
    boldAppointmentSlipText: asBoolean(record.boldAppointmentSlipText, DEFAULT_SETTINGS.boldAppointmentSlipText),
    showQrCode: asBoolean(record.showQrCode, DEFAULT_SETTINGS.showQrCode),
    qrModalityMode: qrModalityMode === "include" || qrModalityMode === "exclude" ? qrModalityMode : "all",
    qrModalityIds,
    qrCaptionAr: asString(record.qrCaptionAr, DEFAULT_SETTINGS.qrCaptionAr),
    qrCaptionEn: asString(record.qrCaptionEn, DEFAULT_SETTINGS.qrCaptionEn),
    qrHelperTextAr: asString(record.qrHelperTextAr, DEFAULT_SETTINGS.qrHelperTextAr),
    qrHelperTextEn: asString(record.qrHelperTextEn, DEFAULT_SETTINGS.qrHelperTextEn),
    showAccessionBarcode: asBoolean(record.showAccessionBarcode, DEFAULT_SETTINGS.showAccessionBarcode),
    barcodeValueMode:
      barcodeValueMode === "appointmentNumber" || barcodeValueMode === "bookingId" ? barcodeValueMode : "accessionNumber",
    barcodeCaptionAr: asString(record.barcodeCaptionAr, DEFAULT_SETTINGS.barcodeCaptionAr),
    barcodeCaptionEn: asString(record.barcodeCaptionEn, DEFAULT_SETTINGS.barcodeCaptionEn),
    showModalityInstructions: asBoolean(record.showModalityInstructions, DEFAULT_SETTINGS.showModalityInstructions),
    showExamSpecificInstructions: asBoolean(record.showExamSpecificInstructions, DEFAULT_SETTINGS.showExamSpecificInstructions),
    maxInstructionLinesOnSlip: asNumber(record.maxInstructionLinesOnSlip, DEFAULT_SETTINGS.maxInstructionLinesOnSlip, { min: 1, max: 8 }),
    fallbackInstructionTextAr: asString(record.fallbackInstructionTextAr, DEFAULT_SETTINGS.fallbackInstructionTextAr),
    fallbackInstructionTextEn: asString(record.fallbackInstructionTextEn, DEFAULT_SETTINGS.fallbackInstructionTextEn),
    locationTextAr: asString(record.locationTextAr, DEFAULT_SETTINGS.locationTextAr),
    locationTextEn: asString(record.locationTextEn, DEFAULT_SETTINGS.locationTextEn),
  };
}

export async function readAppointmentSlipSettings(): Promise<AppointmentSlipSettings> {
  const rows = await getSettingsByCategory("appointment_slip");
  const configRow = rows.find((row) => row.setting_key === "config");
  const rawValue = readRawValue(configRow?.setting_value);
  return normalizeAppointmentSlipSettings(rawValue);
}

export function getDefaultAppointmentSlipSettings(): AppointmentSlipSettings {
  return normalizeAppointmentSlipSettings(DEFAULT_SETTINGS);
}
