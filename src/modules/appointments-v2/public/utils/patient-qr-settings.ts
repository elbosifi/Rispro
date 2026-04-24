import { getSettingsByCategory } from "../../../../services/settings-service.js";

export interface PatientQrContactSettings {
  primaryPhone: string;
  secondaryPhone: string;
  whatsapp: string;
  whatsappEnabled: boolean;
  workingHoursAr: string;
  noteAr: string;
}

export interface PatientQrLocationSettings {
  centerNameAr: string;
  departmentLocationAr: string;
  arrivalInstructionsAr: string;
  googleMapsUrl: string;
  parkingNoteAr: string;
}

export interface PatientQrSettings {
  enabled: boolean;
  printQrOnAppointmentSlip: boolean;
  allowCancellation: boolean;
  allowAddToCalendar: boolean;
  showPreparationInstructions: boolean;
  showDocumentsChecklist: boolean;
  showDepartmentContact: boolean;
  showLocationDirections: boolean;
  pageTitleAr: string;
  introTextAr: string;
  genericPreparationTextAr: string;
  documentsChecklistAr: string[];
  contact: PatientQrContactSettings;
  location: PatientQrLocationSettings;
}

const DEFAULT_SETTINGS: PatientQrSettings = {
  enabled: true,
  printQrOnAppointmentSlip: true,
  allowCancellation: true,
  allowAddToCalendar: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: false,
  showLocationDirections: false,
  pageTitleAr: "خدمة المريض عبر رمز QR",
  introTextAr: "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة.",
  genericPreparationTextAr: "",
  documentsChecklistAr: [
    "ورقة الإحالة",
    "إثبات الهوية",
    "صور أو تقارير سابقة إن وجدت",
    "تحاليل حديثة إذا طُلبت من القسم",
  ],
  contact: {
    primaryPhone: "",
    secondaryPhone: "",
    whatsapp: "",
    whatsappEnabled: false,
    workingHoursAr: "",
    noteAr: "",
  },
  location: {
    centerNameAr: "المركز الوطني لعلاج الأورام - بنغازي",
    departmentLocationAr: "",
    arrivalInstructionsAr: "",
    googleMapsUrl: "",
    parkingNoteAr: "",
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
    showPreparationInstructions: asBoolean(record.showPreparationInstructions, DEFAULT_SETTINGS.showPreparationInstructions),
    showDocumentsChecklist: asBoolean(record.showDocumentsChecklist, DEFAULT_SETTINGS.showDocumentsChecklist),
    showDepartmentContact: asBoolean(record.showDepartmentContact, DEFAULT_SETTINGS.showDepartmentContact),
    showLocationDirections: asBoolean(record.showLocationDirections, DEFAULT_SETTINGS.showLocationDirections),
    pageTitleAr: asString(record.pageTitleAr, DEFAULT_SETTINGS.pageTitleAr),
    introTextAr: asString(record.introTextAr, DEFAULT_SETTINGS.introTextAr),
    genericPreparationTextAr: asString(record.genericPreparationTextAr, DEFAULT_SETTINGS.genericPreparationTextAr),
    documentsChecklistAr: asStringArray(record.documentsChecklistAr, DEFAULT_SETTINGS.documentsChecklistAr),
    contact: {
      primaryPhone: asString(contactRaw.primaryPhone, DEFAULT_SETTINGS.contact.primaryPhone),
      secondaryPhone: asString(contactRaw.secondaryPhone, DEFAULT_SETTINGS.contact.secondaryPhone),
      whatsapp: asString(contactRaw.whatsapp, DEFAULT_SETTINGS.contact.whatsapp),
      whatsappEnabled: asBoolean(contactRaw.whatsappEnabled, DEFAULT_SETTINGS.contact.whatsappEnabled),
      workingHoursAr: asString(contactRaw.workingHoursAr, DEFAULT_SETTINGS.contact.workingHoursAr),
      noteAr: asString(contactRaw.noteAr, DEFAULT_SETTINGS.contact.noteAr),
    },
    location: {
      centerNameAr: asString(locationRaw.centerNameAr, DEFAULT_SETTINGS.location.centerNameAr),
      departmentLocationAr: asString(locationRaw.departmentLocationAr, DEFAULT_SETTINGS.location.departmentLocationAr),
      arrivalInstructionsAr: asString(locationRaw.arrivalInstructionsAr, DEFAULT_SETTINGS.location.arrivalInstructionsAr),
      googleMapsUrl: asString(locationRaw.googleMapsUrl, DEFAULT_SETTINGS.location.googleMapsUrl),
      parkingNoteAr: asString(locationRaw.parkingNoteAr, DEFAULT_SETTINGS.location.parkingNoteAr),
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
