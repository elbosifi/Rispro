import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import { buildPatientAppointmentUrl } from "@/lib/patient-appointment-link";
import {
  DEFAULT_APPOINTMENT_SLIP_SETTINGS,
  DEFAULT_PATIENT_QR_SETTINGS,
  fetchAppointmentSlipSettings,
  fetchPatientQrSettings,
  type AppointmentSlipSettings,
  type PatientQrSettings,
} from "@/lib/api-hooks";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

const NOTO_NASKH_REGULAR_URL = new URL("../assets/fonts/NotoNaskhArabic-Regular.ttf", import.meta.url).toString();
const NOTO_NASKH_BOLD_URL = new URL("../assets/fonts/NotoNaskhArabic-Bold.ttf", import.meta.url).toString();
const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const NOTO_FONT_FAMILY = "NotoNaskhArabic";
const NOTO_REGULAR_FILE = "NotoNaskhArabic-Regular.ttf";
const NOTO_BOLD_FILE = "NotoNaskhArabic-Bold.ttf";
const HIDDEN_APPOINTMENT_STATUSES = new Set(["cancelled", "discontinued"]);

let notoFontsLoaded: Promise<void> | null = null;

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
  labelAr: string;
  labelEn: string;
  valueAr: string;
  valueEn: string;
}

function mm(value: number): number {
  return value * MM_TO_PT;
}

function formatSlipDate(isoDate: string, languageMode: AppointmentSlipSettings["languageMode"]): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return formatDateLy(isoDate);
  }
  if (languageMode === "ar") {
    return date.toLocaleDateString("en-GB");
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

function containsArabic(value: string): boolean {
  return ARABIC_REGEX.test(String(value || ""));
}

function processPdfText(doc: jsPDF, value: string): string {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  const processor = (doc as jsPDF & { processArabic?: (input: string) => string }).processArabic;
  if (containsArabic(cleaned) && typeof processor === "function") {
    return processor(cleaned);
  }
  return cleaned;
}

function wrapLines(doc: jsPDF, value: string, maxWidth: number, maxLines: number): string[] {
  const cleaned = processPdfText(doc, String(value || "").trim());
  if (!cleaned) return ["—"];
  const lines = doc.splitTextToSize(cleaned, maxWidth) as string[];
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = shorten(visible[maxLines - 1], Math.max(12, visible[maxLines - 1].length - 1));
  return visible;
}

function setPdfFont(doc: jsPDF, style: "normal" | "bold" = "normal"): void {
  doc.setFont(NOTO_FONT_FAMILY, style);
}

async function loadFontAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load font: ${url}`);
  }
  const buffer = await response.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function ensureArabicFontsLoaded(doc: jsPDF): Promise<void> {
  if (!notoFontsLoaded) {
    notoFontsLoaded = (async () => {
      const [regular, bold] = await Promise.all([loadFontAsBase64(NOTO_NASKH_REGULAR_URL), loadFontAsBase64(NOTO_NASKH_BOLD_URL)]);
      const instance = doc as jsPDF & { addFileToVFS?: (fileName: string, base64: string) => void; addFont?: (fileName: string, fontName: string, fontStyle: string) => void };
      if (!instance.addFileToVFS || !instance.addFont) {
        throw new Error("jsPDF font registration is unavailable.");
      }
      instance.addFileToVFS(NOTO_REGULAR_FILE, regular);
      instance.addFont(NOTO_REGULAR_FILE, NOTO_FONT_FAMILY, "normal");
      instance.addFileToVFS(NOTO_BOLD_FILE, bold);
      instance.addFont(NOTO_BOLD_FILE, NOTO_FONT_FAMILY, "bold");
    })();
  }
  await notoFontsLoaded;
}

function drawPdfText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  options?: { align?: "left" | "right" | "center"; bold?: boolean }
) {
  const processed = processPdfText(doc, text);
  const align = options?.align ?? "left";
  const bold = options?.bold ?? false;
  setPdfFont(doc, bold ? "bold" : "normal");
  doc.setR2L(containsArabic(text) || align === "right");
  doc.text(processed, x, y, { align });
  doc.setR2L(false);
}

function sanitizeSettings(settings?: AppointmentSlipSettings): AppointmentSlipSettings {
  return settings ? { ...DEFAULT_APPOINTMENT_SLIP_SETTINGS, ...settings } : { ...DEFAULT_APPOINTMENT_SLIP_SETTINGS };
}

function sanitizePatientQrSettings(settings?: PatientQrSettings): PatientQrSettings {
  return settings ? { ...DEFAULT_PATIENT_QR_SETTINGS, ...settings } : { ...DEFAULT_PATIENT_QR_SETTINGS };
}

export function shouldShowAppointmentInList(appointment: Pick<AppointmentWithDetails, "status">): boolean {
  return !HIDDEN_APPOINTMENT_STATUSES.has(String(appointment.status || "").toLowerCase());
}

export function filterVisibleAppointments<T extends Pick<AppointmentWithDetails, "status">>(appointments: T[]): T[] {
  return appointments.filter(shouldShowAppointmentInList);
}

async function resolveSlipRuntimeSettings(options?: BuildSlipOptions): Promise<SlipRuntimeSettings> {
  try {
    const [slipSettings, patientQrSettings] = await Promise.all([
      options?.slipSettings ? Promise.resolve(options.slipSettings) : fetchAppointmentSlipSettings(),
      options?.patientQrSettings ? Promise.resolve(options.patientQrSettings) : fetchPatientQrSettings(),
    ]);
    return {
      slipSettings: sanitizeSettings(slipSettings),
      patientQrSettings: sanitizePatientQrSettings(patientQrSettings),
    };
  } catch {
    return {
      slipSettings: sanitizeSettings(options?.slipSettings),
      patientQrSettings: sanitizePatientQrSettings(options?.patientQrSettings),
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

function localizeValueSafe(ar: string, en: string, mode: AppointmentSlipSettings["languageMode"]): string {
  const cleanAr = String(ar || "").trim();
  const cleanEn = String(en || "").trim();
  if (mode === "ar") return cleanAr || cleanEn || "-";
  if (mode === "en") return cleanEn || cleanAr || "-";
  if (cleanAr && cleanEn && cleanAr !== cleanEn) return `${cleanAr} / ${cleanEn}`;
  return cleanAr || cleanEn || "-";
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
): { headingAr: string; headingEn: string; bodyAr: string; bodyEn: string; usedFallback: boolean }[] {
  const sections: Array<{ headingAr: string; headingEn: string; bodyAr: string; bodyEn: string; usedFallback: boolean }> = [];
  const maxChars = settings.maxInstructionLinesOnSlip * 54;

  if (settings.showModalityInstructions) {
    const bodyAr = String(apt.modalityGeneralInstructionAr || "").trim();
    const bodyEn = String(apt.modalityGeneralInstructionEn || "").trim();
    const safeBodyAr = bodyAr && bodyAr !== "—" && bodyAr.length <= maxChars ? bodyAr : settings.fallbackInstructionTextAr;
    const safeBodyEn = bodyEn && bodyEn !== "—" && bodyEn.length <= maxChars ? bodyEn : settings.fallbackInstructionTextEn;
    sections.push({
      headingAr: settings.modalityInstructionsHeadingAr,
      headingEn: settings.modalityInstructionsHeadingEn,
      bodyAr: safeBodyAr,
      bodyEn: safeBodyEn,
      usedFallback: safeBodyAr !== bodyAr || safeBodyEn !== bodyEn,
    });
  }

  if (settings.showExamSpecificInstructions) {
    const bodyAr = String(apt.examSpecificInstructionAr || "").trim();
    const bodyEn = String(apt.examSpecificInstructionEn || "").trim();
    const safeBodyAr = bodyAr && bodyAr !== "—" && bodyAr.length <= maxChars ? bodyAr : settings.fallbackInstructionTextAr;
    const safeBodyEn = bodyEn && bodyEn !== "—" && bodyEn.length <= maxChars ? bodyEn : settings.fallbackInstructionTextEn;
    sections.push({
      headingAr: settings.examInstructionsHeadingAr,
      headingEn: settings.examInstructionsHeadingEn,
      bodyAr: safeBodyAr,
      bodyEn: safeBodyEn,
      usedFallback: safeBodyAr !== bodyAr || safeBodyEn !== bodyEn,
    });
  }

  return sections;
}

function buildSlipFields(apt: AppointmentWithDetails, slip: AppointmentSlipData, settings: AppointmentSlipSettings): SlipField[] {
  const fields: SlipField[] = [];
  if (settings.showPatientName) fields.push({ labelAr: "Ø§Ø³Ù… Ø§Ù„Ù…Ø±ÙŠØ¶", labelEn: "Patient Name", valueAr: apt.arabicFullName, valueEn: apt.englishFullName || slip.patientName });
  if (settings.showMrn) fields.push({ labelAr: "MRN", labelEn: "MRN", valueAr: slip.mrn, valueEn: slip.mrn });
  if (settings.showNationalId) fields.push({ labelAr: "Ø§Ù„Ø±Ù‚Ù… Ø§Ù„ÙˆØ·Ù†ÙŠ", labelEn: "National ID", valueAr: slip.nationalId, valueEn: slip.nationalId });
  if (settings.showPhone) fields.push({ labelAr: "Ø§Ù„Ù‡Ø§ØªÙ", labelEn: "Phone", valueAr: slip.phone, valueEn: slip.phone });
  if (settings.showAgeSex) fields.push({ labelAr: "Ø§Ù„Ø¹Ù…Ø± / Ø§Ù„Ø¬Ù†Ø³", labelEn: "Age / Sex", valueAr: slip.ageSex, valueEn: slip.ageSex });
  if (settings.showAppointmentNumber) fields.push({ labelAr: "Ø±Ù‚Ù… Ø§Ù„Ù…ÙˆØ¹Ø¯", labelEn: "Appointment Number", valueAr: slip.appointmentNumber, valueEn: slip.appointmentNumber });
  if (settings.showAccessionNumber) fields.push({ labelAr: "Ø±Ù‚Ù… Ø§Ù„Ø¯Ø®ÙˆÙ„", labelEn: "Accession Number", valueAr: slip.accessionNumber, valueEn: slip.accessionNumber });
  if (settings.showModality) fields.push({ labelAr: "Ù†ÙˆØ¹ Ø§Ù„Ø¬Ù‡Ø§Ø²", labelEn: "Modality", valueAr: apt.modalityNameAr || slip.modality, valueEn: apt.modalityNameEn || slip.modality });
  if (settings.showExamName) fields.push({ labelAr: "Ø§Ø³Ù… Ø§Ù„ÙØ­Øµ", labelEn: "Exam", valueAr: apt.examNameAr || slip.examName, valueEn: apt.examNameEn || slip.examName });
  if (settings.showDate) fields.push({ labelAr: "Ø§Ù„ØªØ§Ø±ÙŠØ®", labelEn: "Date", valueAr: slip.appointmentDate, valueEn: slip.appointmentDate });
  if (settings.showTime && slip.bookingTime) fields.push({ labelAr: "Ø§Ù„ÙˆÙ‚Øª", labelEn: "Time", valueAr: slip.bookingTime, valueEn: slip.bookingTime });
  if (settings.showWalkIn) fields.push({ labelAr: "Ø­Ø§Ù„Ø© Walk-in", labelEn: "Walk-in", valueAr: slip.walkInLabel, valueEn: slip.walkInLabel });
  if (settings.showLocation && slip.locationText) fields.push({ labelAr: "Ø§Ù„Ù…ÙˆÙ‚Ø¹", labelEn: "Location", valueAr: slip.locationText, valueEn: slip.locationText });
  if (settings.showArrivalNote) fields.push({ labelAr: "Ù…Ù„Ø§Ø­Ø¸Ø© Ø§Ù„Ø­Ø¶ÙˆØ±", labelEn: "Arrival Note", valueAr: slip.arrivalNote, valueEn: slip.arrivalNote });
  return fields;
}

function buildSlipFieldsClean(apt: AppointmentWithDetails, slip: AppointmentSlipData, settings: AppointmentSlipSettings): SlipField[] {
  const fields: SlipField[] = [];
  if (settings.showPatientName) fields.push({ labelAr: "اسم المريض", labelEn: "Patient Name", valueAr: apt.arabicFullName, valueEn: apt.englishFullName || slip.patientName });
  if (settings.showMrn) fields.push({ labelAr: "MRN", labelEn: "MRN", valueAr: slip.mrn, valueEn: slip.mrn });
  if (settings.showNationalId) fields.push({ labelAr: "الرقم الوطني", labelEn: "National ID", valueAr: slip.nationalId, valueEn: slip.nationalId });
  if (settings.showPhone) fields.push({ labelAr: "الهاتف", labelEn: "Phone", valueAr: slip.phone, valueEn: slip.phone });
  if (settings.showAgeSex) fields.push({ labelAr: "العمر / الجنس", labelEn: "Age / Sex", valueAr: slip.ageSex, valueEn: slip.ageSex });
  if (settings.showAppointmentNumber) fields.push({ labelAr: "رقم الموعد", labelEn: "Appointment Number", valueAr: slip.appointmentNumber, valueEn: slip.appointmentNumber });
  if (settings.showAccessionNumber) fields.push({ labelAr: "رقم الدخول", labelEn: "Accession Number", valueAr: slip.accessionNumber, valueEn: slip.accessionNumber });
  if (settings.showModality) fields.push({ labelAr: "نوع الجهاز", labelEn: "Modality", valueAr: apt.modalityNameAr || slip.modality, valueEn: apt.modalityNameEn || slip.modality });
  if (settings.showExamName) fields.push({ labelAr: "اسم الفحص", labelEn: "Exam", valueAr: apt.examNameAr || slip.examName, valueEn: apt.examNameEn || slip.examName });
  if (settings.showDate) fields.push({ labelAr: "التاريخ", labelEn: "Date", valueAr: slip.appointmentDate, valueEn: slip.appointmentDate });
  if (settings.showTime && slip.bookingTime) fields.push({ labelAr: "الوقت", labelEn: "Time", valueAr: slip.bookingTime, valueEn: slip.bookingTime });
  if (settings.showWalkIn) fields.push({ labelAr: "حالة Walk-in", labelEn: "Walk-in", valueAr: slip.walkInLabel, valueEn: slip.walkInLabel });
  return fields;
}

const _legacyHelpers = [localizeValue, buildSlipFields];
void _legacyHelpers;

export function buildAppointmentSlipData(
  apt: AppointmentWithDetails,
  options?: BuildSlipOptions
): AppointmentSlipData {
  const slipSettings = sanitizeSettings(options?.slipSettings);
  const patientQrSettings = sanitizePatientQrSettings(options?.patientQrSettings);
  const queueQrPayload = buildSlipQrPayload(apt, slipSettings, patientQrSettings);
  const hospitalName = localizeValueSafe(slipSettings.hospitalNameAr, slipSettings.hospitalNameEn, slipSettings.languageMode);
  const departmentName = localizeValueSafe(slipSettings.departmentNameAr, slipSettings.departmentNameEn, slipSettings.languageMode);
  const patientName = localizeValueSafe(apt.arabicFullName || "", apt.englishFullName || "", slipSettings.languageMode);
  const modality = localizeValueSafe(apt.modalityNameAr || "", apt.modalityNameEn || "", slipSettings.languageMode);
  const examName = localizeValueSafe(apt.examNameAr || "", apt.examNameEn || "", slipSettings.languageMode);
  const ageSex = `${apt.ageYears || "—"} / ${apt.sex || "—"}`;
  const locationText = localizeValueSafe(slipSettings.locationTextAr, slipSettings.locationTextEn, slipSettings.languageMode);
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
    appointmentDate: formatSlipDate(apt.appointmentDate, slipSettings.languageMode),
    ageSex,
    walkInLabel: apt.isWalkIn ? localizeText("Ù†Ø¹Ù…", "Yes", slipSettings.languageMode) : localizeText("Ù„Ø§", "No", slipSettings.languageMode),
    queueQrPayload,
    accessionBarcodePayload: buildSlipBarcodePayload(apt, slipSettings),
    locationText,
    arrivalNote: localizeText("ÙŠØ±Ø¬Ù‰ Ø§Ù„Ø­Ø¶ÙˆØ± Ù‚Ø¨Ù„ Ø§Ù„Ù…ÙˆØ¹Ø¯ Ø¨Ù€ 15 Ø¯Ù‚ÙŠÙ‚Ø©", "Please arrive 15 minutes before your appointment", slipSettings.languageMode),
    modalityInstructions: localizeValueSafe(apt.modalityGeneralInstructionAr || "", apt.modalityGeneralInstructionEn || "", slipSettings.languageMode),
    examInstructions: localizeValueSafe(apt.examSpecificInstructionAr || "", apt.examSpecificInstructionEn || "", slipSettings.languageMode),
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

function drawSlipFieldCard(
  doc: jsPDF,
  field: SlipField,
  x: number,
  y: number,
  w: number,
  h: number,
  languageMode: AppointmentSlipSettings["languageMode"]
) {
  drawBox(doc, x, y, w, h);

  if (languageMode === "ar") {
    drawPdfText(doc, field.labelAr, x + w - 5, y + 8, { align: "right", bold: true });
    drawPdfText(doc, field.valueAr, x + w - 5, y + 18, { align: "right" });
    return;
  }

  if (languageMode === "en") {
    drawPdfText(doc, field.labelEn, x + 5, y + 8, { align: "left", bold: true });
    drawPdfText(doc, field.valueEn, x + 5, y + 18, { align: "left" });
    return;
  }

  const halfW = Math.max(1, (w - 6) / 2);
  const leftX = x + 5;
  const rightX = x + w - 5;
  drawPdfText(doc, field.labelAr, rightX, y + 8, { align: "right", bold: true });
  drawPdfText(doc, field.valueAr, rightX, y + 18, { align: "right" });
  drawPdfText(doc, field.labelEn, leftX, y + 8, { align: "left", bold: true });
  drawPdfText(doc, field.valueEn, leftX, y + 18, { align: "left" });

  // Keep a little breathing room for very long bilingual cards.
  if (field.valueAr.length > 40 || field.valueEn.length > 40) {
    doc.setDrawColor("#e5e7eb");
    doc.line(x + halfW, y + 4, x + halfW, y + h - 4);
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
  await ensureArabicFontsLoaded(doc);

  doc.setFillColor("#ffffff");
  doc.rect(0, 0, layout.page.w, layout.page.h, "F");

  const fontScale = slipSettings.fontScale || 1;
  const content = layout.content;
  const fields = buildSlipFieldsClean(apt, slip, slipSettings);
  const instructions = buildInstructionText(apt, slipSettings);

  let cursorY = content.y;
  if (mode !== "preprinted") {
    const logoDataUrl = await loadImageDataUrl(`${window.location.origin}/assets/nccb-logo.png`);
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", content.x, cursorY, 40, 40);
    }
    doc.setTextColor("#b11116");
    if (slipSettings.languageMode === "ar") {
      doc.setFontSize(13 * fontScale);
      drawPdfText(doc, slipSettings.hospitalNameAr, content.x + 46, cursorY + 12, { align: "right", bold: true });
      doc.setFontSize(9 * fontScale);
      doc.setTextColor("#1f2937");
      drawPdfText(doc, slipSettings.departmentNameAr, content.x + 46, cursorY + 25, { align: "right", bold: false });
      doc.setFontSize(12 * fontScale);
      doc.setTextColor("#b11116");
      drawPdfText(doc, "ÙˆØµÙ„ Ø§Ù„Ù…ÙˆØ¹Ø¯", content.x + 46, cursorY + 40, { align: "right", bold: true });
    } else if (slipSettings.languageMode === "en") {
      doc.setFontSize(13 * fontScale);
      drawPdfText(doc, slipSettings.hospitalNameEn, content.x + 46, cursorY + 12, { align: "left", bold: true });
      doc.setFontSize(9 * fontScale);
      doc.setTextColor("#1f2937");
      drawPdfText(doc, slipSettings.departmentNameEn, content.x + 46, cursorY + 25, { align: "left", bold: false });
      doc.setFontSize(12 * fontScale);
      doc.setTextColor("#b11116");
      drawPdfText(doc, "Appointment Slip", content.x + 46, cursorY + 40, { align: "left", bold: true });
    } else {
      doc.setFontSize(13 * fontScale);
      drawPdfText(doc, slipSettings.hospitalNameAr, content.x + 46, cursorY + 10, { align: "right", bold: true });
      drawPdfText(doc, slipSettings.hospitalNameEn, content.x + 46, cursorY + 22, { align: "left", bold: true });
      doc.setFontSize(9 * fontScale);
      doc.setTextColor("#1f2937");
      drawPdfText(doc, slipSettings.departmentNameAr, content.x + 46, cursorY + 34, { align: "right", bold: false });
      drawPdfText(doc, slipSettings.departmentNameEn, content.x + 46, cursorY + 44, { align: "left", bold: false });
    }
  }

  if (layout.qrBlock && slip.queueQrPayload) {
    const qrDataUrl = await QRCode.toDataURL(slip.queueQrPayload, { margin: 1, width: 220 });
    const qrSize = Math.min(mm(slipSettings.qrSizeMm), layout.qrBlock.w);
    const qrX = layout.qrBlock.x + (layout.qrBlock.w - qrSize) / 2;
    doc.setDrawColor("#e2676d");
    doc.roundedRect(layout.qrBlock.x, layout.qrBlock.y, layout.qrBlock.w, layout.qrBlock.h, 4, 4, "S");
    doc.addImage(qrDataUrl, "PNG", qrX, layout.qrBlock.y + 4, qrSize, qrSize);
    doc.setFontSize(8 * fontScale);
    doc.setTextColor("#b11116");
    const qrCaptionLinesAr = wrapLines(doc, slipSettings.qrCaptionAr, layout.qrBlock.w - 8, 2);
    const qrCaptionLinesEn = wrapLines(doc, slipSettings.qrCaptionEn, layout.qrBlock.w - 8, 2);
    if (slipSettings.languageMode === "ar") {
      doc.setFontSize(8 * fontScale);
      drawPdfText(doc, qrCaptionLinesAr.join(" "), layout.qrBlock.x + layout.qrBlock.w - 4, layout.qrBlock.y + qrSize + 12, { align: "right", bold: true });
    } else if (slipSettings.languageMode === "en") {
      doc.setFontSize(8 * fontScale);
      drawPdfText(doc, qrCaptionLinesEn.join(" "), layout.qrBlock.x + 4, layout.qrBlock.y + qrSize + 12, { align: "left", bold: true });
    } else {
      drawPdfText(doc, qrCaptionLinesAr.join(" "), layout.qrBlock.x + layout.qrBlock.w - 4, layout.qrBlock.y + qrSize + 12, { align: "right", bold: true });
      drawPdfText(doc, qrCaptionLinesEn.join(" "), layout.qrBlock.x + 4, layout.qrBlock.y + qrSize + 22, { align: "left", bold: true });
    }
    doc.setFontSize(6.8 * fontScale);
    doc.setTextColor("#374151");
    const qrHelperLinesAr = wrapLines(doc, slipSettings.qrHelperTextAr, layout.qrBlock.w - 8, 4);
    const qrHelperLinesEn = wrapLines(doc, slipSettings.qrHelperTextEn, layout.qrBlock.w - 8, 4);
    if (slipSettings.languageMode === "ar") {
      drawPdfText(doc, qrHelperLinesAr.join(" "), layout.qrBlock.x + layout.qrBlock.w - 4, layout.qrBlock.y + qrSize + 28, { align: "right" });
    } else if (slipSettings.languageMode === "en") {
      drawPdfText(doc, qrHelperLinesEn.join(" "), layout.qrBlock.x + 4, layout.qrBlock.y + qrSize + 28, { align: "left" });
    } else {
      drawPdfText(doc, qrHelperLinesAr.join(" "), layout.qrBlock.x + layout.qrBlock.w - 4, layout.qrBlock.y + qrSize + 28, { align: "right" });
      drawPdfText(doc, qrHelperLinesEn.join(" "), layout.qrBlock.x + 4, layout.qrBlock.y + qrSize + 38, { align: "left" });
    }
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
    drawSlipFieldCard(doc, field, x, y, fieldWidth, fieldHeight, slipSettings.languageMode);
  });

  cursorY += Math.ceil(fields.length / columns) * (fieldHeight + 4) + 6;

  const barcodeTop = layout.barcodeBlock ? layout.barcodeBlock.y - 8 : content.y + content.h;
  for (const section of instructions) {
    const sectionHeight = slipSettings.languageMode === "bilingual" ? 42 * fontScale : 30 * fontScale;
    if (cursorY + sectionHeight > barcodeTop) break;
    drawBox(doc, content.x, cursorY, content.w, sectionHeight, "#fffaf9", "#f0b4b7");
    if (slipSettings.languageMode === "ar") {
      drawPdfText(doc, section.headingAr, content.x + content.w - 5, cursorY + 9, { align: "right", bold: true });
      drawPdfText(doc, wrapLines(doc, section.bodyAr, content.w - 10, Math.max(1, slipSettings.maxInstructionLinesOnSlip)).join(" "), content.x + content.w - 5, cursorY + 18, { align: "right" });
    } else if (slipSettings.languageMode === "en") {
      drawPdfText(doc, section.headingEn, content.x + 5, cursorY + 9, { align: "left", bold: true });
      drawPdfText(doc, wrapLines(doc, section.bodyEn, content.w - 10, Math.max(1, slipSettings.maxInstructionLinesOnSlip)).join(" "), content.x + 5, cursorY + 18, { align: "left" });
    } else {
      drawPdfText(doc, section.headingAr, content.x + content.w - 5, cursorY + 9, { align: "right", bold: true });
      drawPdfText(doc, section.headingEn, content.x + 5, cursorY + 9, { align: "left", bold: true });
      drawPdfText(doc, wrapLines(doc, section.bodyAr, content.w / 2 - 8, Math.max(1, slipSettings.maxInstructionLinesOnSlip)).join(" "), content.x + content.w - 5, cursorY + 20, { align: "right" });
      drawPdfText(doc, wrapLines(doc, section.bodyEn, content.w / 2 - 8, Math.max(1, slipSettings.maxInstructionLinesOnSlip)).join(" "), content.x + 5, cursorY + 20, { align: "left" });
    }
    cursorY += sectionHeight + 4;
  }

  if (layout.barcodeBlock) {
    doc.setFontSize(8.5 * fontScale);
    doc.setTextColor("#b11116");
    if (slipSettings.languageMode === "ar") {
      drawPdfText(doc, slipSettings.barcodeCaptionAr, layout.barcodeBlock.x + layout.barcodeBlock.w - 4, layout.barcodeBlock.y - 4, { align: "right", bold: true });
    } else if (slipSettings.languageMode === "en") {
      drawPdfText(doc, slipSettings.barcodeCaptionEn, layout.barcodeBlock.x + 4, layout.barcodeBlock.y - 4, { align: "left", bold: true });
    } else {
      drawPdfText(doc, slipSettings.barcodeCaptionAr, layout.barcodeBlock.x + layout.barcodeBlock.w - 4, layout.barcodeBlock.y - 4, { align: "right", bold: true });
      drawPdfText(doc, slipSettings.barcodeCaptionEn, layout.barcodeBlock.x + 4, layout.barcodeBlock.y + 7, { align: "left", bold: true });
    }
    drawBox(doc, layout.barcodeBlock.x, layout.barcodeBlock.y, layout.barcodeBlock.w, layout.barcodeBlock.h, "#ffffff", "#d8dadd");
    const barcodeInnerX = layout.barcodeBlock.x + 8;
    const barcodeInnerY = layout.barcodeBlock.y + 6;
    const barcodeInnerW = layout.barcodeBlock.w - 16;
    const barcodeInnerH = mm(slipSettings.barcodeHeightMm);
    drawCode39Barcode(doc, slip.accessionBarcodePayload, barcodeInnerX, barcodeInnerY, barcodeInnerW, barcodeInnerH);
    doc.setFontSize(7.5 * fontScale);
    doc.setTextColor("#111827");
    drawPdfText(doc, shorten(slip.accessionBarcodePayload, 40), layout.barcodeBlock.x + layout.barcodeBlock.w / 2, layout.barcodeBlock.y + layout.barcodeBlock.h - 6, { align: "center" });
  }

  return doc.output("blob");
}

function renderFieldHtml(field: SlipField): string {
  return `
    <div class="summary-item">
      <div class="label ar">${escapeHtml(field.labelAr)}</div>
      <div class="value ar">${escapeHtml(field.valueAr || "—")}</div>
      <div class="label en">${escapeHtml(field.labelEn)}</div>
      <div class="value en">${escapeHtml(field.valueEn || "—")}</div>
    </div>
  `;
}

function isMeaningfulSlipValue(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim();
  return normalized !== "" && normalized !== "—";
}

function renderLocalizedFieldHtml(field: SlipField, languageMode: AppointmentSlipSettings["languageMode"]): string {
  const valueAr = isMeaningfulSlipValue(field.valueAr) ? field.valueAr : field.valueEn;
  const valueEn = isMeaningfulSlipValue(field.valueEn) ? field.valueEn : field.valueAr;

  if (languageMode === "ar") {
    return `
      <div class="summary-item single-language single-language-ar">
        <div class="label ar">${escapeHtml(field.labelAr)}</div>
        <div class="value ar">${escapeHtml(valueAr || "—")}</div>
      </div>
    `;
  }

  if (languageMode === "en") {
    return `
      <div class="summary-item single-language single-language-en">
        <div class="label en">${escapeHtml(field.labelEn)}</div>
        <div class="value en">${escapeHtml(valueEn || "—")}</div>
      </div>
    `;
  }

  return `
    <div class="summary-item bilingual-card">
      <div class="label ar">${escapeHtml(field.labelAr)}</div>
      <div class="value ar">${escapeHtml(field.valueAr || "—")}</div>
      <div class="label en">${escapeHtml(field.labelEn)}</div>
      <div class="value en">${escapeHtml(field.valueEn || "—")}</div>
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

function renderInstructionHtml(
  section: { headingAr: string; headingEn: string; bodyAr: string; bodyEn: string; usedFallback: boolean },
  languageMode: AppointmentSlipSettings["languageMode"]
): string {
  if (languageMode === "ar") {
    return `
      <div class="instruction">
        <div class="instruction-title ar">${escapeHtml(section.headingAr)}</div>
        <div class="instruction-body ar">${escapeHtml(section.bodyAr)}</div>
      </div>
    `;
  }

  if (languageMode === "en") {
    return `
      <div class="instruction">
        <div class="instruction-title en">${escapeHtml(section.headingEn)}</div>
        <div class="instruction-body en">${escapeHtml(section.bodyEn)}</div>
      </div>
    `;
  }

  return `
    <div class="instruction">
      <div class="instruction-title ar">${escapeHtml(section.headingAr)}</div>
      <div class="instruction-title en">${escapeHtml(section.headingEn)}</div>
      <div class="instruction-body ar">${escapeHtml(section.bodyAr)}</div>
      <div class="instruction-body en">${escapeHtml(section.bodyEn)}</div>
    </div>
  `;
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
  const fields = buildSlipFieldsClean(apt, slip, slipSettings);
  const instructions = buildInstructionText(apt, slipSettings);
  const languageMode = slipSettings.languageMode;
  const dir = languageMode === "en" ? "ltr" : "rtl";
  const qrSvg = slip.queueQrPayload
    ? await QRCode.toString(slip.queueQrPayload, { type: "svg", width: 160, margin: 1 })
    : "";
  const barcodeSvg = layout.barcodeBlock
    ? renderCode39Svg(slip.accessionBarcodePayload, slipSettings.barcodeWidthMm, slipSettings.barcodeHeightMm)
    : "";
  const patientFieldLabels = ["Patient Name", "MRN", "National ID", "Phone", "Age / Sex"];
  const appointmentFieldLabels = ["Appointment Number", "Accession Number", "Modality", "Exam", "Date", "Time", "Walk-in"];
  const dedicatedBlockLabels = ["Location", "Arrival Note"];
  const patientFields = fields.filter((field) => patientFieldLabels.includes(field.labelEn));
  const appointmentFields = fields.filter((field) => appointmentFieldLabels.includes(field.labelEn));
  const extraFields = fields.filter((field) => !patientFields.includes(field) && !appointmentFields.includes(field) && !dedicatedBlockLabels.includes(field.labelEn));
  const qrPanelWidthMm = qrSvg ? Math.min(Math.max(slipSettings.qrSizeMm + 10, 24), 28) : 0;
  const compactScale = slipSettings.paperMode === "preprinted" ? 0.92 : 0.95;
  const sectionTitle = (ar: string, en: string) =>
    languageMode === "ar"
      ? `<div class="section-title ar">${escapeHtml(ar)}</div>`
      : languageMode === "en"
        ? `<div class="section-title en">${escapeHtml(en)}</div>`
        : `<div class="section-title bilingual"><span class="ar">${escapeHtml(ar)}</span><span class="en">${escapeHtml(en)}</span></div>`;
  const renderFieldGroup = (group: SlipField[]) => `<div class="field-grid">${group.map((field) => renderLocalizedFieldHtml(field, languageMode)).join("")}</div>`;
  const renderLocation = slipSettings.showLocation && slip.locationText
    ? `
      <section class="section">
        ${sectionTitle(slipSettings.locationHeadingAr, slipSettings.locationHeadingEn)}
        <div class="location-card ${languageMode === "en" ? "en" : "ar"}" data-location-block="true">${escapeHtml(slip.locationText)}</div>
      </section>
    `
    : "";

  return `
    <html dir="${dir}">
      <head>
        <title>${escapeHtml(localizeText(slipSettings.slipTitleAr, slipSettings.slipTitleEn, languageMode))}</title>
        <style>
          @page { size: A5 portrait; margin: 0; }
          @font-face { font-family: "Noto Naskh Arabic"; src: url("${NOTO_NASKH_REGULAR_URL}") format("truetype"); font-weight: 400; }
          @font-face { font-family: "Noto Naskh Arabic"; src: url("${NOTO_NASKH_BOLD_URL}") format("truetype"); font-weight: 700; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            width: 148mm;
            min-height: 210mm;
            direction: ${languageMode === "en" ? "ltr" : "rtl"};
            unicode-bidi: plaintext;
            font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "Tahoma", "Arial", sans-serif;
            color: #1f2937;
            background: #ffffff;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .sheet { width: 148mm; height: 210mm; position: relative; overflow: hidden; }
          .safe-area {
            position: absolute;
            top: ${slipSettings.paperMode === "preprinted" ? slipSettings.safeTopMm : 0}mm;
            left: ${slipSettings.paperMode === "preprinted" ? slipSettings.safeLeftMm : 0}mm;
            width: ${slipSettings.paperMode === "preprinted" ? layout.safeArea.w / MM_TO_PT : 148}mm;
            height: ${slipSettings.paperMode === "preprinted" ? layout.safeArea.h / MM_TO_PT : 210}mm;
            padding: ${slipSettings.contentPaddingMm}mm;
          }
          .content { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 1.2mm; }
          .header {
            display: ${slipSettings.paperMode === "blank" ? "grid" : "none"};
            grid-template-columns: auto 1fr;
            gap: 2mm;
            align-items: center;
          }
          .header-logo { width: 14mm; height: 14mm; object-fit: contain; }
          .header-copy { display: grid; gap: 0.35mm; }
          .header-title { color: #8f0f14; font-size: ${4.1 * slipSettings.fontScale * compactScale}mm; font-weight: 700; line-height: 1.1; }
          .header-subtitle { color: #475569; font-size: ${2.8 * slipSettings.fontScale * compactScale}mm; line-height: 1.1; }
          .content-grid { display: grid; grid-template-columns: ${qrSvg ? "1fr auto" : "1fr"}; gap: 1.4mm; align-items: start; }
          .main-stack { display: grid; gap: 1.2mm; min-width: 0; }
          .section { display: grid; gap: 0.8mm; }
          .section-title { color: #8f0f14; font-size: ${3.1 * slipSettings.fontScale * compactScale}mm; font-weight: 700; line-height: 1.1; }
          .section-title.bilingual { display: flex; justify-content: space-between; gap: 2mm; }
          .section-title .ar, .summary-item .ar, .instruction .ar, .location-card.ar, .arrival-note.ar { direction: rtl; text-align: right; unicode-bidi: plaintext; }
          .section-title .en, .summary-item .en, .instruction .en, .location-card.en, .arrival-note.en { direction: ltr; text-align: left; unicode-bidi: plaintext; }
          .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.9mm; }
          .summary-item { border: 0.25mm solid #d1d5db; border-radius: 1.6mm; padding: 1mm; min-height: 8.5mm; background: #ffffff; }
          .summary-item .label { color: #8f0f14; font-size: ${2.4 * slipSettings.fontScale * compactScale}mm; font-weight: 700; line-height: 1.1; }
          .summary-item .value { margin-top: 0.35mm; font-size: ${2.7 * slipSettings.fontScale * compactScale}mm; line-height: 1.15; word-break: break-word; overflow-wrap: anywhere; }
          .bilingual-card .label.en, .bilingual-card .value.en { margin-top: 0.35mm; }
          .qr-block { width: ${qrPanelWidthMm}mm; max-width: ${qrPanelWidthMm}mm; border: 0.25mm solid #e2676d; border-radius: 1.6mm; padding: 0.9mm; background: #fffdfd; }
          .qr-block svg { width: 100%; height: auto; display: block; }
          .qr-caption { margin-top: 0.6mm; color: #8f0f14; font-size: ${2.35 * slipSettings.fontScale * compactScale}mm; font-weight: 700; line-height: 1.15; }
          .qr-helper { margin-top: 0.5mm; color: #475569; font-size: ${2.1 * slipSettings.fontScale * compactScale}mm; line-height: 1.2; }
          .instructions { display: grid; gap: 0.9mm; }
          .instruction { border: 0.25mm solid #f0b4b7; border-radius: 1.6mm; padding: 1mm; background: #fffaf9; }
          .instruction-title { color: #8f0f14; font-size: ${2.45 * slipSettings.fontScale * compactScale}mm; font-weight: 700; line-height: 1.1; }
          .instruction-body { margin-top: 0.45mm; font-size: ${2.45 * slipSettings.fontScale * compactScale}mm; line-height: 1.2; word-break: break-word; overflow-wrap: anywhere; }
          .location-card, .arrival-note { border: 0.25mm solid #d1d5db; border-radius: 1.6mm; padding: 1mm; background: #ffffff; font-size: ${2.55 * slipSettings.fontScale * compactScale}mm; line-height: 1.2; }
          .barcode-block { margin-top: auto; border: 0.25mm solid #d1d5db; border-radius: 1.6mm; padding: 1mm; background: #ffffff; }
          .barcode-caption { color: #8f0f14; font-size: ${2.35 * slipSettings.fontScale * compactScale}mm; font-weight: 700; text-align: center; margin-bottom: 0.6mm; line-height: 1.1; }
          .barcode-block svg { width: 100%; height: ${slipSettings.barcodeHeightMm}mm; display: block; }
          .barcode-text { margin-top: 0.45mm; font-size: ${2.25 * slipSettings.fontScale * compactScale}mm; text-align: center; word-break: break-word; line-height: 1.1; }
        </style>
      </head>
      <body>
        <div class="sheet" data-paper-mode="${slipSettings.paperMode}" data-language-mode="${languageMode}" data-page-width-mm="148" data-page-height-mm="210">
          <div class="safe-area" data-safe-top-mm="${slipSettings.safeTopMm}" data-safe-bottom-mm="${slipSettings.safeBottomMm}" data-safe-left-mm="${slipSettings.safeLeftMm}" data-safe-right-mm="${slipSettings.safeRightMm}" data-content-padding-mm="${slipSettings.contentPaddingMm}" data-font-scale="${slipSettings.fontScale}">
            <div class="content">
              <header class="header" data-header-visible="${slipSettings.paperMode === "blank"}">
                <img class="header-logo" src="${window.location.origin}/assets/nccb-logo.png" alt="" />
                <div class="header-copy">
                  <div class="header-title">${escapeHtml(localizeText(slipSettings.hospitalNameAr, slipSettings.hospitalNameEn, languageMode))}</div>
                  <div class="header-subtitle">${escapeHtml(localizeText(slipSettings.departmentNameAr, slipSettings.departmentNameEn, languageMode))}</div>
                  <div class="header-subtitle">${escapeHtml(localizeText(slipSettings.slipTitleAr, slipSettings.slipTitleEn, languageMode))}</div>
                </div>
              </header>
              <div class="content-grid">
                <div class="main-stack">
                  <section class="section">
                    ${sectionTitle(slipSettings.patientDetailsHeadingAr, slipSettings.patientDetailsHeadingEn)}
                    ${renderFieldGroup(patientFields)}
                  </section>
                  <section class="section">
                    ${sectionTitle(slipSettings.appointmentDetailsHeadingAr, slipSettings.appointmentDetailsHeadingEn)}
                    ${renderFieldGroup(appointmentFields)}
                  </section>
                  ${extraFields.length ? `<section class="section">${renderFieldGroup(extraFields)}</section>` : ""}
                  ${renderLocation}
                  ${slipSettings.showArrivalNote && slip.arrivalNote ? `<div class="arrival-note ${languageMode === "en" ? "en" : "ar"}" data-arrival-note="true">${escapeHtml(slip.arrivalNote)}</div>` : ""}
                  ${instructions.length ? `<section class="section">${sectionTitle(slipSettings.instructionsHeadingAr, slipSettings.instructionsHeadingEn)}<div class="instructions">${instructions.map((section) => renderInstructionHtml(section, languageMode)).join("")}</div></section>` : ""}
                </div>
                ${qrSvg ? `<aside class="qr-block" data-qr-size-mm="${slipSettings.qrSizeMm}" data-qr-panel-width-mm="${qrPanelWidthMm}">${qrSvg}<div class="qr-caption">${escapeHtml(localizeText(slipSettings.qrCaptionAr, slipSettings.qrCaptionEn, languageMode))}</div><div class="qr-helper">${escapeHtml(localizeText(slipSettings.qrHelperTextAr, slipSettings.qrHelperTextEn, languageMode))}</div></aside>` : ""}
              </div>
              ${layout.barcodeBlock ? `<section class="barcode-block" data-barcode-value="${escapeHtml(slip.accessionBarcodePayload)}"><div class="barcode-caption">${escapeHtml(localizeText(slipSettings.barcodeCaptionAr, slipSettings.barcodeCaptionEn, languageMode))}</div>${barcodeSvg}<div class="barcode-text">${escapeHtml(slip.accessionBarcodePayload)}</div></section>` : ""}
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

async function waitForPrintableDocument(doc: Document): Promise<void> {
  const fontReady = "fonts" in doc ? (doc as Document & { fonts: FontFaceSet }).fonts.ready.catch(() => undefined) : Promise.resolve();
  const imageReady = Promise.all(
    Array.from(doc.images).map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        })
    )
  ).then(() => undefined);
  await Promise.all([fontReady, imageReady]);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
}

async function openAppointmentSlipPrintFrame(html: string): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    throw new Error("Unable to create appointment slip print frame.");
  }

  doc.open();
  doc.write(html);
  doc.close();
  await waitForPrintableDocument(doc);
  return frame;
}

export async function downloadAppointmentSlipPdf(apt: AppointmentWithDetails, options?: BuildSlipOptions): Promise<void> {
  const blob = await createAppointmentSlipPdfBlob(apt, undefined, options);
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

export function printAppointmentSlip(apt: AppointmentWithDetails, options?: BuildSlipOptions): void {
  void printAppointmentSlipInternal(apt, options);
}

async function printAppointmentSlipInternal(apt: AppointmentWithDetails, options?: BuildSlipOptions): Promise<void> {
  const html = await prepareAppointmentSlipHtml(apt, options);
  let frame: HTMLIFrameElement | null = null;
  try {
    frame = await openAppointmentSlipPrintFrame(html);
    const printWindow = frame.contentWindow;
    if (!printWindow) return;
    printWindow.focus();
    printWindow.print();
  } finally {
    window.setTimeout(() => {
      frame?.remove();
    }, 1000);
  }
}

export function printAppointmentList(list: AppointmentWithDetails[], listDate: string): void {
  const visibleList = filterVisibleAppointments(list);
  if (visibleList.length === 0) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const now = new Date().toLocaleString();

  const rows = visibleList
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
          .header { display: flex; align-items: center; justify-content: center; gap: 12px; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #d1d5db; }
          .logo { width: 20mm; height: 20mm; object-fit: contain; flex: 0 0 auto; }
          .brand-wrap { text-align: center; }
          .brand { margin: 0; font-size: 17px; font-weight: 800; color: #0f766e; }
          .brand-ar { margin: 2px 0 0; font-size: 12px; font-weight: 700; color: #0f766e; direction: rtl; }
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
            <img class="logo" src="/assets/nccb-logo.png" alt="Hospital logo" />
            <div class="brand-wrap">
              <p class="brand">National Cancer Center Benghazi</p>
              <p class="brand-ar">Ø§Ù„Ù…Ø±ÙƒØ² Ø§Ù„ÙˆØ·Ù†ÙŠ Ù„Ù„Ø£ÙˆØ±Ø§Ù… Ø¨Ù†ØºØ§Ø²ÙŠ</p>
              <p class="title">Appointment List</p>
            </div>
          </div>
          <p class="summary">Date window: ${escapeHtml(listDate)} · Total: ${visibleList.length} · Printed: ${escapeHtml(now)}</p>
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
