import { getSettingsByCategory } from "../../../../services/settings-service.js";

export interface PatientQrContactSettings {
  primaryPhone: string;
  secondaryPhone: string;
  whatsapp: string;
  whatsappEnabled: boolean;
  workingHoursAr: string;
  workingHoursEn: string;
  noteAr: string;
  noteEn: string;
}

export interface PatientQrLocationSettings {
  centerNameAr: string;
  centerNameEn: string;
  departmentLocationAr: string;
  departmentLocationEn: string;
  roomUnitFloorAr: string;
  roomUnitFloorEn: string;
  addressAr: string;
  addressEn: string;
  arrivalInstructionsAr: string;
  arrivalInstructionsEn: string;
  googleMapsUrl: string;
  parkingNoteAr: string;
  parkingNoteEn: string;
}

export interface PatientQrSettings {
  enabled: boolean;
  printQrOnAppointmentSlip: boolean;
  allowCancellation: boolean;
  allowAddToCalendar: boolean;
  showBookingTime: boolean;
  showPreparationInstructions: boolean;
  showDocumentsChecklist: boolean;
  showDepartmentContact: boolean;
  showLocationDirections: boolean;
  allowReportAccess: boolean;
  allowImageAccess: boolean;
  showReportPendingCard: boolean;
  reportAccessRequiresCompletedAppointment: boolean;
  imageAccessRequiresCompletedAppointment: boolean;
  imageAccessRequiresReportRequiredFlag: boolean;
  showReportNotRequiredMessage: boolean;
  defaultReportRequiredForOncology: boolean;
  defaultReportRequiredForNonOncology: boolean;
  qrReportCheckingMessage: string;
  qrReportFinalMessage: string;
  qrReportDraftMessage: string;
  qrReportNoReportMessage: string;
  qrReportUnavailableMessage: string;
  qrReportNotRequiredMessage: string;
  qrReportNotCompletedMessage: string;
  qrReportCheckButtonLabel: string;
  qrReportViewButtonLabel: string;
  qrImageViewButtonLabel: string;
  qrImageUnavailableMessage: string;
  qrReportStudyNotFoundMessage: string;
  qrImageStudyNotFoundMessage: string;
  pageTitleAr: string;
  pageTitleEn: string;
  introTextAr: string;
  introTextEn: string;
  genericPreparationTextAr: string;
  genericPreparationTextEn: string;
  documentsChecklistAr: string[];
  documentsChecklistEn: string[];
  contact: PatientQrContactSettings;
  location: PatientQrLocationSettings;
}

const DEFAULT_SETTINGS: PatientQrSettings = {
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
  introTextAr: "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة.",
  introTextEn: "You can review appointment details, instructions, and department information from this page.",
  genericPreparationTextAr: "",
  genericPreparationTextEn: "",
  documentsChecklistAr: [
    "ورقة الإحالة",
    "إثبات الهوية",
    "صور أو تقارير سابقة إن وجدت",
    "تحاليل حديثة إذا طُلبت من القسم",
  ],
  documentsChecklistEn: [
    "Referral paper",
    "ID proof",
    "Previous images or reports if available",
    "Recent tests if requested by the department",
  ],
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

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [...fallback];
}

export function normalizePatientQrSettings(raw: unknown): PatientQrSettings {
  const record = (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const contactRaw = (record.contact && typeof record.contact === "object" && !Array.isArray(record.contact) ? (record.contact as Record<string, unknown>) : {}) as Record<string, unknown>;
  const locationRaw = (record.location && typeof record.location === "object" && !Array.isArray(record.location) ? (record.location as Record<string, unknown>) : {}) as Record<string, unknown>;

  return {
    enabled: asBoolean(record.enabled, DEFAULT_SETTINGS.enabled),
    printQrOnAppointmentSlip: asBoolean(record.printQrOnAppointmentSlip, DEFAULT_SETTINGS.printQrOnAppointmentSlip),
    allowCancellation: asBoolean(record.allowCancellation, DEFAULT_SETTINGS.allowCancellation),
    allowAddToCalendar: asBoolean(record.allowAddToCalendar, DEFAULT_SETTINGS.allowAddToCalendar),
    showBookingTime: asBoolean(record.showBookingTime, DEFAULT_SETTINGS.showBookingTime),
    showPreparationInstructions: asBoolean(record.showPreparationInstructions, DEFAULT_SETTINGS.showPreparationInstructions),
    showDocumentsChecklist: asBoolean(record.showDocumentsChecklist, DEFAULT_SETTINGS.showDocumentsChecklist),
    showDepartmentContact: asBoolean(record.showDepartmentContact, DEFAULT_SETTINGS.showDepartmentContact),
    showLocationDirections: asBoolean(record.showLocationDirections, DEFAULT_SETTINGS.showLocationDirections),
    allowReportAccess: asBoolean(record.allowReportAccess, DEFAULT_SETTINGS.allowReportAccess),
    allowImageAccess: asBoolean(record.allowImageAccess, DEFAULT_SETTINGS.allowImageAccess),
    showReportPendingCard: asBoolean(record.showReportPendingCard, DEFAULT_SETTINGS.showReportPendingCard),
    reportAccessRequiresCompletedAppointment: asBoolean(record.reportAccessRequiresCompletedAppointment, DEFAULT_SETTINGS.reportAccessRequiresCompletedAppointment),
    imageAccessRequiresCompletedAppointment: asBoolean(record.imageAccessRequiresCompletedAppointment, DEFAULT_SETTINGS.imageAccessRequiresCompletedAppointment),
    imageAccessRequiresReportRequiredFlag: asBoolean(record.imageAccessRequiresReportRequiredFlag, DEFAULT_SETTINGS.imageAccessRequiresReportRequiredFlag),
    showReportNotRequiredMessage: asBoolean(record.showReportNotRequiredMessage, DEFAULT_SETTINGS.showReportNotRequiredMessage),
    defaultReportRequiredForOncology: asBoolean(record.defaultReportRequiredForOncology, DEFAULT_SETTINGS.defaultReportRequiredForOncology),
    defaultReportRequiredForNonOncology: asBoolean(record.defaultReportRequiredForNonOncology, DEFAULT_SETTINGS.defaultReportRequiredForNonOncology),
    qrReportCheckingMessage: asString(record.qrReportCheckingMessage, DEFAULT_SETTINGS.qrReportCheckingMessage),
    qrReportFinalMessage: asString(record.qrReportFinalMessage, DEFAULT_SETTINGS.qrReportFinalMessage),
    qrReportDraftMessage: asString(record.qrReportDraftMessage, DEFAULT_SETTINGS.qrReportDraftMessage),
    qrReportNoReportMessage: asString(record.qrReportNoReportMessage, DEFAULT_SETTINGS.qrReportNoReportMessage),
    qrReportUnavailableMessage: asString(record.qrReportUnavailableMessage, DEFAULT_SETTINGS.qrReportUnavailableMessage),
    qrReportNotRequiredMessage: asString(record.qrReportNotRequiredMessage, DEFAULT_SETTINGS.qrReportNotRequiredMessage),
    qrReportNotCompletedMessage: asString(record.qrReportNotCompletedMessage, DEFAULT_SETTINGS.qrReportNotCompletedMessage),
    qrReportCheckButtonLabel: asString(record.qrReportCheckButtonLabel, DEFAULT_SETTINGS.qrReportCheckButtonLabel),
    qrReportViewButtonLabel: asString(record.qrReportViewButtonLabel, DEFAULT_SETTINGS.qrReportViewButtonLabel),
    qrImageViewButtonLabel: asString(record.qrImageViewButtonLabel, DEFAULT_SETTINGS.qrImageViewButtonLabel),
    qrImageUnavailableMessage: asString(record.qrImageUnavailableMessage, DEFAULT_SETTINGS.qrImageUnavailableMessage),
    qrReportStudyNotFoundMessage: asString(record.qrReportStudyNotFoundMessage, DEFAULT_SETTINGS.qrReportStudyNotFoundMessage),
    qrImageStudyNotFoundMessage: asString(record.qrImageStudyNotFoundMessage, DEFAULT_SETTINGS.qrImageStudyNotFoundMessage),
    pageTitleAr: asString(record.pageTitleAr, DEFAULT_SETTINGS.pageTitleAr),
    pageTitleEn: asString(record.pageTitleEn, DEFAULT_SETTINGS.pageTitleEn),
    introTextAr: asString(record.introTextAr, DEFAULT_SETTINGS.introTextAr),
    introTextEn: asString(record.introTextEn, DEFAULT_SETTINGS.introTextEn),
    genericPreparationTextAr: asString(record.genericPreparationTextAr, DEFAULT_SETTINGS.genericPreparationTextAr),
    genericPreparationTextEn: asString(record.genericPreparationTextEn, DEFAULT_SETTINGS.genericPreparationTextEn),
    documentsChecklistAr: asStringArray(record.documentsChecklistAr, DEFAULT_SETTINGS.documentsChecklistAr),
    documentsChecklistEn: asStringArray(record.documentsChecklistEn, DEFAULT_SETTINGS.documentsChecklistEn),
    contact: {
      primaryPhone: asString(contactRaw.primaryPhone, DEFAULT_SETTINGS.contact.primaryPhone),
      secondaryPhone: asString(contactRaw.secondaryPhone, DEFAULT_SETTINGS.contact.secondaryPhone),
      whatsapp: asString(contactRaw.whatsapp, DEFAULT_SETTINGS.contact.whatsapp),
      whatsappEnabled: asBoolean(contactRaw.whatsappEnabled, DEFAULT_SETTINGS.contact.whatsappEnabled),
      workingHoursAr: asString(contactRaw.workingHoursAr, DEFAULT_SETTINGS.contact.workingHoursAr),
      workingHoursEn: asString(contactRaw.workingHoursEn, DEFAULT_SETTINGS.contact.workingHoursEn),
      noteAr: asString(contactRaw.noteAr, DEFAULT_SETTINGS.contact.noteAr),
      noteEn: asString(contactRaw.noteEn, DEFAULT_SETTINGS.contact.noteEn),
    },
    location: {
      centerNameAr: asString(locationRaw.centerNameAr, DEFAULT_SETTINGS.location.centerNameAr),
      centerNameEn: asString(locationRaw.centerNameEn, DEFAULT_SETTINGS.location.centerNameEn),
      departmentLocationAr: asString(locationRaw.departmentLocationAr, DEFAULT_SETTINGS.location.departmentLocationAr),
      departmentLocationEn: asString(locationRaw.departmentLocationEn, DEFAULT_SETTINGS.location.departmentLocationEn),
      roomUnitFloorAr: asString(locationRaw.roomUnitFloorAr, DEFAULT_SETTINGS.location.roomUnitFloorAr),
      roomUnitFloorEn: asString(locationRaw.roomUnitFloorEn, DEFAULT_SETTINGS.location.roomUnitFloorEn),
      addressAr: asString(locationRaw.addressAr, DEFAULT_SETTINGS.location.addressAr),
      addressEn: asString(locationRaw.addressEn, DEFAULT_SETTINGS.location.addressEn),
      arrivalInstructionsAr: asString(locationRaw.arrivalInstructionsAr, DEFAULT_SETTINGS.location.arrivalInstructionsAr),
      arrivalInstructionsEn: asString(locationRaw.arrivalInstructionsEn, DEFAULT_SETTINGS.location.arrivalInstructionsEn),
      googleMapsUrl: asString(locationRaw.googleMapsUrl, DEFAULT_SETTINGS.location.googleMapsUrl),
      parkingNoteAr: asString(locationRaw.parkingNoteAr, DEFAULT_SETTINGS.location.parkingNoteAr),
      parkingNoteEn: asString(locationRaw.parkingNoteEn, DEFAULT_SETTINGS.location.parkingNoteEn),
    },
  };
}

export async function readPatientQrSettings(): Promise<PatientQrSettings> {
  const rows = await getSettingsByCategory("patient_qr_self_service");
  const configRow = rows.find((row) => row.setting_key === "config");
  const rawValue = readRawValue(configRow?.setting_value);
  return normalizePatientQrSettings(rawValue);
}

export function getDefaultPatientQrSettings(): PatientQrSettings {
  return normalizePatientQrSettings(DEFAULT_SETTINGS);
}
