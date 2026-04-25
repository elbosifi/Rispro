import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import { buildPatientAppointmentUrl } from "@/lib/patient-appointment-link";
import {
  fetchAppointmentSlipSettings,
  fetchPatientQrSettings,
  type AppointmentSlipSettings,
  type PatientQrSettings,
} from "@/lib/api-hooks";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

function escapeHtml(str: string = ""): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MM_TO_PT = 72 / 25.4;
const A5_WIDTH_PT = 148 * MM_TO_PT;
const A5_HEIGHT_PT = 210 * MM_TO_PT;

const DEFAULT_SLIP_SETTINGS: AppointmentSlipSettings = {
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
  locationTextAr: "",
  locationTextEn: "",
};

const DEFAULT_PATIENT_QR_SETTINGS: PatientQrSettings = {
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
};

export interface AppointmentSlipData {
  hospitalName: string;
  departmentName: string;
  patientName: string;
  mrn: string;
  nationalId: string;
  phone: string;
  accessionNumber: string;
  appointmentNumber: string;
  bookingId: string;
  bookingTime: string;
  modality: string;
  examName: string;
  appointmentDate: string;
  ageSex: string;
  walkInLabel: string;
  queueQrPayload: string;
  accessionBarcodePayload: string;
  locationText: string;
  arrivalNote: string;
  modalityInstructions: string;
  examInstructions: string;
  fallbackInstructionText: string;
  generatedAt: string;
}

export interface AppointmentSlipLayoutModel {
  page: { w: number; h: number };
  safeArea: { x: number; y: number; w: number; h: number };
  content: { x: number; y: number; w: number; h: number };
  qrBlock: { x: number; y: number; w: number; h: number; captionLines: number; helperLines: number; clipped: boolean } | null;
  barcodeBlock: { x: number; y: number; w: number; h: number; clipped: boolean } | null;
  mode: AppointmentSlipSettings["paperMode"];
}

type AppointmentSlipPdfMode = "blank" | "preprinted";

interface SlipRuntimeSettings {
  slipSettings: AppointmentSlipSettings;
  patientQrSettings: PatientQrSettings;
}

interface BuildSlipOptions {
  slipSettings?: AppointmentSlipSettings;
  patientQrSettings?: PatientQrSettings;
}

interface SlipField {
  label: string;
  value: string;
}

function mm(value: number): number {
  return value * MM_TO_PT;
}

function formatSlipDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return formatDateLy(isoDate);
  }
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatSlipTime(raw: string | null | undefined): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : trimmed;
}

function shorten(value: string, maxLength: number): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function wrapLines(doc: jsPDF, value: string, maxWidth: number, maxLines: number): string[] {
  const cleaned = String(value || "").trim();
  if (!cleaned) return ["—"];
  const lines = doc.splitTextToSize(cleaned, maxWidth) as string[];
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = shorten(visible[maxLines - 1], Math.max(12, visible[maxLines - 1].length - 1));
  return visible;
}

function sanitizeSettings(settings?: AppointmentSlipSettings): AppointmentSlipSettings {
  return settings ? { ...DEFAULT_SLIP_SETTINGS, ...settings } : { ...DEFAULT_SLIP_SETTINGS };
}

function sanitizePatientQrSettings(settings?: PatientQrSettings): PatientQrSettings {
  return settings ? { ...DEFAULT_PATIENT_QR_SETTINGS, ...settings } : { ...DEFAULT_PATIENT_QR_SETTINGS };
}

async function resolveSlipRuntimeSettings(options?: BuildSlipOptions): Promise<SlipRuntimeSettings> {
  if (options?.slipSettings || options?.patientQrSettings) {
    return {
      slipSettings: sanitizeSettings(options.slipSettings),
      patientQrSettings: sanitizePatientQrSettings(options.patientQrSettings),
    };
  }

  try {
    const [slipSettings, patientQrSettings] = await Promise.all([
      fetchAppointmentSlipSettings(),
      fetchPatientQrSettings(),
    ]);
    return {
      slipSettings: sanitizeSettings(slipSettings),
      patientQrSettings: sanitizePatientQrSettings(patientQrSettings),
    };
  } catch {
    return {
      slipSettings: { ...DEFAULT_SLIP_SETTINGS },
      patientQrSettings: { ...DEFAULT_PATIENT_QR_SETTINGS },
    };
  }
}

function localizeText(ar: string, en: string, mode: AppointmentSlipSettings["languageMode"]): string {
  if (mode === "ar") return ar;
  if (mode === "en") return en;
  return `${ar} / ${en}`;
}

function localizeValue(ar: string, en: string, mode: AppointmentSlipSettings["languageMode"]): string {
  const cleanAr = String(ar || "").trim();
  const cleanEn = String(en || "").trim();
  if (mode === "ar") return cleanAr || cleanEn || "—";
  if (mode === "en") return cleanEn || cleanAr || "—";
  if (cleanAr && cleanEn && cleanAr !== cleanEn) return `${cleanAr} / ${cleanEn}`;
  return cleanAr || cleanEn || "—";
}

function buildSlipQrPayload(
  apt: AppointmentWithDetails,
  settings: AppointmentSlipSettings,
  patientQrSettings: PatientQrSettings
): string {
  const token = String(apt.publicCancelToken || "").trim();
  if (!settings.showQrCode) return "";
  if (!patientQrSettings.enabled || !patientQrSettings.printQrOnAppointmentSlip) return "";
  if (!token) return "";
  return buildPatientAppointmentUrl(token, window.location.origin);
}

function buildSlipBarcodePayload(apt: AppointmentWithDetails, settings: AppointmentSlipSettings): string {
  if (settings.barcodeValueMode === "bookingId") return String(apt.id);
  if (settings.barcodeValueMode === "appointmentNumber") return String(apt.dailySequence || apt.id);
  return String(apt.accessionNumber || `V2-${apt.id}`).trim();
}

function buildInstructionText(
  apt: AppointmentWithDetails,
  settings: AppointmentSlipSettings
): { heading: string; body: string; usedFallback: boolean }[] {
  const sections: Array<{ heading: string; body: string; usedFallback: boolean }> = [];
  const maxChars = settings.maxInstructionLinesOnSlip * 54;

  if (settings.showModalityInstructions) {
    const body = localizeValue(apt.modalityGeneralInstructionAr || "", apt.modalityGeneralInstructionEn || "", settings.languageMode);
    const safeBody = body && body !== "—" && body.length <= maxChars ? body : localizeText(
      "يرجى مسح رمز QR للاطلاع على تعليمات الجهاز والفحص والموقع.",
      "Scan the QR code for modality instructions, exam-specific instructions, and location details.",
      settings.languageMode
    );
    sections.push({
      heading: localizeText("تعليمات حسب نوع الجهاز", "Modality Instructions", settings.languageMode),
      body: safeBody,
      usedFallback: safeBody !== body,
    });
  }

  if (settings.showExamSpecificInstructions) {
    const body = localizeValue(apt.examSpecificInstructionAr || "", apt.examSpecificInstructionEn || "", settings.languageMode);
    const safeBody = body && body !== "—" && body.length <= maxChars ? body : localizeText(
      settings.fallbackInstructionTextAr,
      settings.fallbackInstructionTextEn,
      settings.languageMode
    );
    sections.push({
      heading: localizeText("تعليمات خاصة بالفحص", "Exam Instructions", settings.languageMode),
      body: safeBody,
      usedFallback: safeBody !== body,
    });
  }

  return sections;
}

function buildSlipFields(apt: AppointmentWithDetails, slip: AppointmentSlipData, settings: AppointmentSlipSettings): SlipField[] {
  const fields: SlipField[] = [];
  if (settings.showPatientName) fields.push({ label: localizeText("اسم المريض", "Patient Name", settings.languageMode), value: slip.patientName });
  if (settings.showMrn) fields.push({ label: "MRN", value: slip.mrn });
  if (settings.showNationalId) fields.push({ label: localizeText("الرقم الوطني", "National ID", settings.languageMode), value: slip.nationalId });
  if (settings.showPhone) fields.push({ label: localizeText("الهاتف", "Phone", settings.languageMode), value: slip.phone });
  if (settings.showAgeSex) fields.push({ label: localizeText("العمر / الجنس", "Age / Sex", settings.languageMode), value: slip.ageSex });
  if (settings.showAppointmentNumber) fields.push({ label: localizeText("رقم الموعد", "Appointment Number", settings.languageMode), value: slip.appointmentNumber });
  if (settings.showAccessionNumber) fields.push({ label: localizeText("رقم الدخول", "Accession Number", settings.languageMode), value: slip.accessionNumber });
  if (settings.showModality) fields.push({ label: localizeText("نوع الجهاز", "Modality", settings.languageMode), value: slip.modality });
  if (settings.showExamName) fields.push({ label: localizeText("اسم الفحص", "Exam", settings.languageMode), value: slip.examName });
  if (settings.showDate) fields.push({ label: localizeText("التاريخ", "Date", settings.languageMode), value: slip.appointmentDate });
  if (settings.showTime && slip.bookingTime) fields.push({ label: localizeText("الوقت", "Time", settings.languageMode), value: slip.bookingTime });
  if (settings.showWalkIn) fields.push({ label: localizeText("Walk-in", "Walk-in", settings.languageMode), value: slip.walkInLabel });
  if (settings.showLocation && slip.locationText) fields.push({ label: localizeText("الموقع", "Location", settings.languageMode), value: slip.locationText });
  if (settings.showArrivalNote) fields.push({ label: localizeText("ملاحظة الحضور", "Arrival Note", settings.languageMode), value: slip.arrivalNote });
  return fields;
}

export function buildAppointmentSlipData(
  apt: AppointmentWithDetails,
  options?: BuildSlipOptions
): AppointmentSlipData {
  const slipSettings = sanitizeSettings(options?.slipSettings);
  const patientQrSettings = sanitizePatientQrSettings(options?.patientQrSettings);
  const queueQrPayload = buildSlipQrPayload(apt, slipSettings, patientQrSettings);
  const hospitalName = localizeValue(slipSettings.hospitalNameAr, slipSettings.hospitalNameEn, slipSettings.languageMode);
  const departmentName = localizeValue(slipSettings.departmentNameAr, slipSettings.departmentNameEn, slipSettings.languageMode);
  const patientName = localizeValue(apt.arabicFullName || "", apt.englishFullName || "", slipSettings.languageMode);
  const modality = localizeValue(apt.modalityNameAr || "", apt.modalityNameEn || "", slipSettings.languageMode);
  const examName = localizeValue(apt.examNameAr || "", apt.examNameEn || "", slipSettings.languageMode);
  const ageSex = `${apt.ageYears || "—"} / ${apt.sex || "—"}`;
  const locationText = localizeValue(slipSettings.locationTextAr, slipSettings.locationTextEn, slipSettings.languageMode);
  return {
    hospitalName,
    departmentName,
    patientName,
    mrn: apt.mrn || "—",
    nationalId: apt.nationalId || "—",
    phone: apt.phone1 || "—",
    accessionNumber: String(apt.accessionNumber || `V2-${apt.id}`).trim(),
    appointmentNumber: String(apt.dailySequence || apt.id),
    bookingId: String(apt.id),
    bookingTime: formatSlipTime(apt.bookingTime),
    modality,
    examName,
    appointmentDate: formatSlipDate(apt.appointmentDate),
    ageSex,
    walkInLabel: apt.isWalkIn ? localizeText("نعم", "Yes", slipSettings.languageMode) : localizeText("لا", "No", slipSettings.languageMode),
    queueQrPayload,
    accessionBarcodePayload: buildSlipBarcodePayload(apt, slipSettings),
    locationText,
    arrivalNote: localizeText("يرجى الحضور قبل الموعد بـ 15 دقيقة", "Please arrive 15 minutes before your appointment", slipSettings.languageMode),
    modalityInstructions: localizeValue(apt.modalityGeneralInstructionAr || "", apt.modalityGeneralInstructionEn || "", slipSettings.languageMode),
    examInstructions: localizeValue(apt.examSpecificInstructionAr || "", apt.examSpecificInstructionEn || "", slipSettings.languageMode),
    fallbackInstructionText: localizeText(slipSettings.fallbackInstructionTextAr, slipSettings.fallbackInstructionTextEn, slipSettings.languageMode),
    generatedAt: new Date().toLocaleString(),
  };
}

export function buildAppointmentSlipLayoutModel(
  apt: AppointmentWithDetails,
  settings: AppointmentSlipSettings,
  patientQrSettings: PatientQrSettings,
  modeOverride?: AppointmentSlipPdfMode
): AppointmentSlipLayoutModel {
  const mode = modeOverride ?? settings.paperMode;
  const page = { w: A5_WIDTH_PT, h: A5_HEIGHT_PT };
  const safeArea = {
    x: mm(mode === "preprinted" ? settings.safeLeftMm : 8),
    y: mm(mode === "preprinted" ? settings.safeTopMm : 8),
    w: page.w - mm(mode === "preprinted" ? settings.safeLeftMm + settings.safeRightMm : 16),
    h: page.h - mm(mode === "preprinted" ? settings.safeTopMm + settings.safeBottomMm : 16),
  };
  const content = {
    x: safeArea.x + mm(settings.contentPaddingMm),
    y: safeArea.y + mm(settings.contentPaddingMm),
    w: safeArea.w - mm(settings.contentPaddingMm * 2),
    h: safeArea.h - mm(settings.contentPaddingMm * 2),
  };

  const fontScale = settings.fontScale || 1;
  const qrShown = Boolean(buildSlipQrPayload(apt, settings, patientQrSettings));
  const qrWidth = qrShown ? Math.min(mm(settings.qrSizeMm + 18), content.w * 0.34) : 0;
  const qrCaptionLines = qrShown ? Math.ceil(localizeText(settings.qrCaptionAr, settings.qrCaptionEn, settings.languageMode).length / 24) : 0;
  const qrHelperLines = qrShown ? Math.ceil(localizeText(settings.qrHelperTextAr, settings.qrHelperTextEn, settings.languageMode).length / 42) : 0;
  const qrHeight = qrShown ? mm(settings.qrSizeMm) + 10 + qrCaptionLines * 9 * fontScale + qrHelperLines * 7 * fontScale : 0;
  const headerHeight = mode === "blank" ? 34 * fontScale + (qrShown ? Math.max(qrHeight, 22 * fontScale) : 0) : (qrShown ? qrHeight : 0);
  const barcodeBlockHeight = settings.showAccessionBarcode ? mm(settings.barcodeHeightMm) + 24 * fontScale : 0;
  const barcodeWidth = Math.min(mm(settings.barcodeWidthMm), content.w - 6);
  const barcodeX = content.x + (content.w - barcodeWidth) / 2;
  const barcodeY = content.y + content.h - barcodeBlockHeight;
  const barcodeBlock = settings.showAccessionBarcode
    ? {
        x: barcodeX,
        y: barcodeY,
        w: barcodeWidth,
        h: barcodeBlockHeight,
        clipped: barcodeY + barcodeBlockHeight > content.y + content.h || barcodeX < content.x || barcodeX + barcodeWidth > content.x + content.w,
      }
    : null;

  const qrBlock = qrShown
    ? {
        x: content.x + content.w - qrWidth,
        y: content.y,
        w: qrWidth,
        h: qrHeight,
        captionLines: qrCaptionLines,
        helperLines: qrHelperLines,
        clipped: qrWidth > content.w || qrHeight > content.h,
      }
    : null;

  return {
    page,
    safeArea,
    content,
    qrBlock,
    barcodeBlock,
    mode,
  };
}

function drawBox(doc: jsPDF, x: number, y: number, w: number, h: number, fill = "#ffffff", stroke = "#d1d5db") {
  doc.setFillColor(fill);
  doc.setDrawColor(stroke);
  doc.roundedRect(x, y, w, h, 4, 4, "FD");
}

const CODE39_PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  "$": "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

function buildCode39Bars(value: string): { units: number; bars: Array<{ x: number; units: number }> } {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z. \-$/+%]/g, "");
  const payload = `*${cleaned || "APPOINTMENT"}*`;
  const bars: Array<{ x: number; units: number }> = [];
  let cursor = 10;
  for (let i = 0; i < payload.length; i += 1) {
    const pattern = CODE39_PATTERNS[payload[i]] || CODE39_PATTERNS["-"];
    for (let j = 0; j < pattern.length; j += 1) {
      const isWide = pattern[j] === "w";
      const units = isWide ? 3 : 1;
      const isBar = j % 2 === 0;
      if (isBar) bars.push({ x: cursor, units });
      cursor += units;
    }
    cursor += 1;
  }
  return { units: cursor + 10, bars };
}

function drawCode39Barcode(doc: jsPDF, value: string, x: number, y: number, w: number, h: number) {
  const spec = buildCode39Bars(value);
  const scale = w / spec.units;
  doc.setFillColor("#111111");
  for (const bar of spec.bars) {
    doc.rect(x + bar.x * scale, y, Math.max(scale * bar.units, 0.8), h, "F");
  }
}

async function toDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return toDataUrl(blob);
}

async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await toDataUrl(await response.blob());
  } catch {
    return null;
  }
}

export async function createAppointmentSlipPdfBlob(
  apt: AppointmentWithDetails,
  mode?: AppointmentSlipPdfMode,
  options?: BuildSlipOptions
): Promise<Blob> {
  const runtime = await resolveSlipRuntimeSettings(options);
  const slipSettings = runtime.slipSettings;
  const patientQrSettings = runtime.patientQrSettings;
  const slip = buildAppointmentSlipData(apt, runtime);
  const layout = buildAppointmentSlipLayoutModel(apt, slipSettings, patientQrSettings, mode);
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: [A5_WIDTH_PT, A5_HEIGHT_PT],
    compress: true,
  });

  doc.setFillColor("#ffffff");
  doc.rect(0, 0, layout.page.w, layout.page.h, "F");

  const fontScale = slipSettings.fontScale || 1;
  const content = layout.content;
  const fields = buildSlipFields(apt, slip, slipSettings);
  const instructions = buildInstructionText(apt, slipSettings);

  let cursorY = content.y;
  if (mode !== "preprinted") {
    const logoDataUrl = await loadImageDataUrl(`${window.location.origin}/assets/nccb-logo.png`);
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", content.x, cursorY, 40, 40);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13 * fontScale);
    doc.setTextColor("#b11116");
    doc.text(slip.hospitalName, content.x + 46, cursorY + 12);
    doc.setFontSize(9 * fontScale);
    doc.setTextColor("#1f2937");
    doc.text(slip.departmentName, content.x + 46, cursorY + 25);
    doc.setFontSize(12 * fontScale);
    doc.setTextColor("#b11116");
    doc.text(localizeText("وصل الموعد", "Appointment Slip", slipSettings.languageMode), content.x + 46, cursorY + 40);
  }

  if (layout.qrBlock && slip.queueQrPayload) {
    const qrDataUrl = await QRCode.toDataURL(slip.queueQrPayload, { margin: 1, width: 220 });
    const qrSize = Math.min(mm(slipSettings.qrSizeMm), layout.qrBlock.w);
    const qrX = layout.qrBlock.x + (layout.qrBlock.w - qrSize) / 2;
    doc.setDrawColor("#e2676d");
    doc.roundedRect(layout.qrBlock.x, layout.qrBlock.y, layout.qrBlock.w, layout.qrBlock.h, 4, 4, "S");
    doc.addImage(qrDataUrl, "PNG", qrX, layout.qrBlock.y + 4, qrSize, qrSize);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8 * fontScale);
    doc.setTextColor("#b11116");
    doc.text(
      wrapLines(doc, localizeText(slipSettings.qrCaptionAr, slipSettings.qrCaptionEn, slipSettings.languageMode), layout.qrBlock.w - 8, 2),
      layout.qrBlock.x + 4,
      layout.qrBlock.y + qrSize + 12,
      { baseline: "top" }
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8 * fontScale);
    doc.setTextColor("#374151");
    doc.text(
      wrapLines(doc, localizeText(slipSettings.qrHelperTextAr, slipSettings.qrHelperTextEn, slipSettings.languageMode), layout.qrBlock.w - 8, 4),
      layout.qrBlock.x + 4,
      layout.qrBlock.y + qrSize + 28,
      { baseline: "top" }
    );
  }

  cursorY += mode !== "preprinted" ? 52 * fontScale : 0;
  const qrReserve = layout.qrBlock ? layout.qrBlock.w + 8 : 0;
  const fieldsWidth = content.w - qrReserve;
  const fieldGap = 6;
  const columns = fieldsWidth > 210 ? 2 : 1;
  const fieldWidth = columns === 2 ? (fieldsWidth - fieldGap) / 2 : fieldsWidth;
  const fieldHeight = 30 * fontScale;

  fields.forEach((field, index) => {
    const column = columns === 2 ? index % 2 : 0;
    const row = columns === 2 ? Math.floor(index / 2) : index;
    const x = content.x + column * (fieldWidth + fieldGap);
    const y = cursorY + row * (fieldHeight + 4);
    drawBox(doc, x, y, fieldWidth, fieldHeight);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5 * fontScale);
    doc.setTextColor("#b11116");
    doc.text(shorten(field.label, 32), x + 5, y + 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.6 * fontScale);
    doc.setTextColor("#111827");
    doc.text(wrapLines(doc, field.value, fieldWidth - 10, 2), x + 5, y + 18, { baseline: "top" });
  });

  cursorY += Math.ceil(fields.length / columns) * (fieldHeight + 4) + 6;

  const barcodeTop = layout.barcodeBlock ? layout.barcodeBlock.y - 8 : content.y + content.h;
  for (const section of instructions) {
    const sectionHeight = 30 * fontScale;
    if (cursorY + sectionHeight > barcodeTop) break;
    drawBox(doc, content.x, cursorY, content.w, sectionHeight, "#fffaf9", "#f0b4b7");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8 * fontScale);
    doc.setTextColor("#b11116");
    doc.text(section.heading, content.x + 5, cursorY + 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8 * fontScale);
    doc.setTextColor("#1f2937");
    doc.text(
      wrapLines(doc, section.body, content.w - 10, Math.max(1, slipSettings.maxInstructionLinesOnSlip)),
      content.x + 5,
      cursorY + 18,
      { baseline: "top" }
    );
    cursorY += sectionHeight + 4;
  }

  if (layout.barcodeBlock) {
    const caption = localizeText(slipSettings.barcodeCaptionAr, slipSettings.barcodeCaptionEn, slipSettings.languageMode);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5 * fontScale);
    doc.setTextColor("#b11116");
    doc.text(caption, layout.barcodeBlock.x + layout.barcodeBlock.w / 2, layout.barcodeBlock.y - 4, { align: "center" });
    drawBox(doc, layout.barcodeBlock.x, layout.barcodeBlock.y, layout.barcodeBlock.w, layout.barcodeBlock.h, "#ffffff", "#d8dadd");
    const barcodeInnerX = layout.barcodeBlock.x + 8;
    const barcodeInnerY = layout.barcodeBlock.y + 6;
    const barcodeInnerW = layout.barcodeBlock.w - 16;
    const barcodeInnerH = mm(slipSettings.barcodeHeightMm);
    drawCode39Barcode(doc, slip.accessionBarcodePayload, barcodeInnerX, barcodeInnerY, barcodeInnerW, barcodeInnerH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5 * fontScale);
    doc.setTextColor("#111827");
    doc.text(shorten(slip.accessionBarcodePayload, 40), layout.barcodeBlock.x + layout.barcodeBlock.w / 2, layout.barcodeBlock.y + layout.barcodeBlock.h - 6, { align: "center" });
  }

  return doc.output("blob");
}

function renderFieldHtml(field: SlipField): string {
  return `
    <div class="summary-item">
      <div class="label">${escapeHtml(field.label)}</div>
      <div class="value">${escapeHtml(field.value || "—")}</div>
    </div>
  `;
}

function renderCode39Svg(value: string, widthMm: number, heightMm: number): string {
  const spec = buildCode39Bars(value);
  const unitWidth = 1;
  const totalWidth = spec.units * unitWidth;
  const height = Math.max(40, Math.round(heightMm * 4));
  const rects = spec.bars
    .map((bar) => `<rect x="${bar.x}" y="0" width="${bar.units}" height="${height}" fill="#111111" />`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(widthMm * 4)}" height="${height}" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="xMidYMid meet">${rects}</svg>`;
}

export async function prepareAppointmentSlipHtml(
  apt: AppointmentWithDetails,
  options?: BuildSlipOptions
): Promise<string> {
  const runtime = await resolveSlipRuntimeSettings(options);
  const slipSettings = runtime.slipSettings;
  const patientQrSettings = runtime.patientQrSettings;
  const slip = buildAppointmentSlipData(apt, runtime);
  const layout = buildAppointmentSlipLayoutModel(apt, slipSettings, patientQrSettings);
  const fields = buildSlipFields(apt, slip, slipSettings);
  const instructions = buildInstructionText(apt, slipSettings);
  let qrSvg = "";
  if (slip.queueQrPayload) {
    qrSvg = await QRCode.toString(slip.queueQrPayload, { type: "svg", width: 140, margin: 1 });
  }

  return `
    <html>
      <head>
        <title>Appointment Slip</title>
        <style>
          @page { size: A5 portrait; margin: 0; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1f2937; background: #ffffff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .page { width: 148mm; min-height: 210mm; background: #fff; }
          .safe {
            margin-top: ${layout.safeArea.y / MM_TO_PT}mm;
            margin-left: ${layout.safeArea.x / MM_TO_PT}mm;
            width: ${layout.safeArea.w / MM_TO_PT}mm;
            min-height: ${layout.safeArea.h / MM_TO_PT}mm;
          }
          .content { padding: ${slipSettings.contentPaddingMm}mm; position: relative; }
          .header { display: ${layout.mode === "blank" ? "grid" : "none"}; grid-template-columns: 1fr; gap: 1mm; margin-bottom: 2mm; }
          .title { color: #b11116; font-weight: 800; font-size: ${14 * slipSettings.fontScale}px; }
          .subtitle { color: #334155; font-size: ${11 * slipSettings.fontScale}px; }
          .grid { display: grid; grid-template-columns: ${layout.qrBlock ? "1fr auto" : "1fr"}; gap: 2mm; align-items: start; }
          .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.2mm; }
          .summary-item { border: 1px solid #d1d5db; border-radius: 2mm; padding: 1.4mm; min-height: 11mm; overflow: hidden; }
          .summary-item .label { color: #b11116; font-size: ${10 * slipSettings.fontScale}px; font-weight: 700; line-height: 1.2; }
          .summary-item .value { color: #111827; font-size: ${11 * slipSettings.fontScale}px; line-height: 1.25; margin-top: 0.7mm; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
          .qr-block { width: ${layout.qrBlock ? `${layout.qrBlock.w / MM_TO_PT}mm` : "0"}; border: 1px solid #e2676d; border-radius: 2mm; padding: 1mm; }
          .qr-svg svg { width: 100%; height: auto; display: block; }
          .qr-caption { color: #b11116; font-size: ${10 * slipSettings.fontScale}px; font-weight: 700; line-height: 1.25; margin-top: 1mm; overflow-wrap: anywhere; }
          .qr-helper { color: #334155; font-size: ${8.5 * slipSettings.fontScale}px; line-height: 1.3; margin-top: 0.7mm; overflow-wrap: anywhere; }
          .instructions { margin-top: 2mm; display: grid; gap: 1.2mm; }
          .instruction { border: 1px solid #f0b4b7; border-radius: 2mm; padding: 1.4mm; background: #fffaf9; }
          .instruction-title { color: #b11116; font-size: ${10 * slipSettings.fontScale}px; font-weight: 700; }
          .instruction-body { font-size: ${10 * slipSettings.fontScale}px; line-height: 1.3; margin-top: 0.8mm; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
          .barcode { margin-top: 2mm; border: 1px solid #d1d5db; border-radius: 2mm; padding: 1.4mm; }
          .barcode-caption { color: #b11116; font-size: ${10 * slipSettings.fontScale}px; font-weight: 700; text-align: center; margin-bottom: 1mm; overflow-wrap: anywhere; }
          .barcode-visual svg { width: 100%; height: ${slipSettings.barcodeHeightMm}mm; display: block; }
          .barcode-text { color: #111827; font-size: ${9 * slipSettings.fontScale}px; text-align: center; margin-top: 1mm; word-break: break-word; }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="safe">
            <div class="content" data-safe-top-mm="${slipSettings.safeTopMm}" data-safe-bottom-mm="${slipSettings.safeBottomMm}">
              <div class="header">
                <div class="title">${escapeHtml(slip.hospitalName)}</div>
                <div class="subtitle">${escapeHtml(slip.departmentName)}</div>
              </div>
              <div class="grid">
                <div class="fields">
                  ${fields.map(renderFieldHtml).join("")}
                </div>
                ${
                  layout.qrBlock && qrSvg
                    ? `
                      <div class="qr-block" data-qr-clipped="${String(layout.qrBlock.clipped)}" data-qr-helper-lines="${layout.qrBlock.helperLines}">
                        <div class="qr-svg">${qrSvg}</div>
                        <div class="qr-caption">${escapeHtml(localizeText(slipSettings.qrCaptionAr, slipSettings.qrCaptionEn, slipSettings.languageMode))}</div>
                        <div class="qr-helper">${escapeHtml(localizeText(slipSettings.qrHelperTextAr, slipSettings.qrHelperTextEn, slipSettings.languageMode))}</div>
                      </div>
                    `
                    : ""
                }
              </div>
              <div class="instructions">
                ${instructions
                  .map(
                    (section) => `
                    <div class="instruction">
                      <div class="instruction-title">${escapeHtml(section.heading)}</div>
                      <div class="instruction-body">${escapeHtml(section.body)}</div>
                    </div>
                  `
                  )
                  .join("")}
              </div>
              ${
                layout.barcodeBlock
                  ? `
                    <div class="barcode" data-barcode-clipped="${String(layout.barcodeBlock.clipped)}">
                      <div class="barcode-caption">${escapeHtml(localizeText(slipSettings.barcodeCaptionAr, slipSettings.barcodeCaptionEn, slipSettings.languageMode))}</div>
                      <div class="barcode-visual">${renderCode39Svg(slip.accessionBarcodePayload, slipSettings.barcodeWidthMm, slipSettings.barcodeHeightMm)}</div>
                      <div class="barcode-text">${escapeHtml(slip.accessionBarcodePayload)}</div>
                    </div>
                  `
                  : ""
              }
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

function getAppointmentSlipFileName(apt: AppointmentWithDetails): string {
  const suffix = String(apt.accessionNumber || `appointment-${apt.id}`)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `appointment-slip-${suffix || apt.id}.pdf`;
}

export async function downloadAppointmentSlipPdf(apt: AppointmentWithDetails): Promise<void> {
  const blob = await createAppointmentSlipPdfBlob(apt);
  const fileName = getAppointmentSlipFileName(apt);
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(anchor.href);
    anchor.remove();
  }, 1000);
}

export function printAppointmentSlip(apt: AppointmentWithDetails): void {
  void printAppointmentSlipInternal(apt);
}

async function printAppointmentSlipInternal(apt: AppointmentWithDetails): Promise<void> {
  const blob = await createAppointmentSlipPdfBlob(apt);
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.src = url;

  try {
    document.body.appendChild(frame);
    await new Promise<void>((resolve) => {
      frame.addEventListener("load", () => resolve(), { once: true });
    });

    const printWindow = frame.contentWindow;
    if (!printWindow) return;

    await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
    printWindow.focus();
    printWindow.print();
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      frame.remove();
    }, 1000);
  }
}

export function printAppointmentList(list: AppointmentWithDetails[], listDate: string): void {
  if (list.length === 0) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const now = new Date().toLocaleString();

  const rows = list
    .map(
      (apt, idx) => `
      <div class="row">
        <div class="arabic"><div class="label">${idx + 1}</div><div class="value">${apt.dailySequence ?? "—"}</div></div>
        <div class="arabic"><div class="label">Patient</div><div class="value">${escapeHtml(apt.arabicFullName)}</div></div>
        <div><div class="label">Accession</div><div class="value">${escapeHtml(apt.accessionNumber)}</div></div>
        <div><div class="label">Date</div><div class="value">${escapeHtml(formatDateLy(apt.appointmentDate))}</div></div>
        <div><div class="label">Modality</div><div class="value">${escapeHtml(apt.modalityNameEn || "—")}</div></div>
        <div><div class="label">Exam</div><div class="value">${escapeHtml(apt.examNameEn || "—")}</div></div>
        <div><div class="label">Priority</div><div class="value">${escapeHtml(apt.priorityNameEn || "Routine")}</div></div>
        <div><div class="label">Status</div><div class="value">${escapeHtml(apt.status || "—")}</div></div>
      </div>
    `
    )
    .join("");

  printWindow.document.write(`
    <html>
      <head>
        <title>Appointment List</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
          .slip { width: 100%; min-height: 100%; border: 1.5px solid #0f766e; border-radius: 12px; padding: 10px; }
          .header { text-align: center; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #d1d5db; }
          .brand { margin: 0; font-size: 17px; font-weight: 800; color: #0f766e; }
          .title { margin: 3px 0 0; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.14em; }
          .summary { margin: 0 0 8px; font-size: 10px; color: #374151; text-align: center; }
          .row {
            display: grid;
            grid-template-columns: 22mm 2fr 22mm 1fr 22mm 1.1fr 22mm 1.5fr;
            gap: 5px 7px;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid #e5e7eb;
            font-size: 11px;
          }
          .row:nth-child(odd) { background: #f8fafc; }
          .row:nth-child(even) { background: #eef6f5; }
          .label { font-size: 8.5px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
          .value { font-size: 11px; font-weight: 700; color: #111827; word-break: break-word; line-height: 1.25; }
          .arabic { direction: rtl; text-align: right; }
          .footer { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #d1d5db; display: flex; justify-content: space-between; gap: 12px; font-size: 8px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="slip">
          <div class="header">
            <p class="brand">RISpro Reception</p>
            <p class="title">Appointment List</p>
          </div>
          <p class="summary">Date window: ${escapeHtml(listDate)} · Total: ${list.length} · Printed: ${escapeHtml(now)}</p>
          ${rows}
          <div class="footer">
            <span>Generated by RISpro</span>
            <span>${escapeHtml(now)}</span>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
