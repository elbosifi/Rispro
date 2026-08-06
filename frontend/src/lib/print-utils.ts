import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import { LIBYAN_CITIES } from "@/lib/libyan-cities";
import {
  DEFAULT_APPOINTMENT_SLIP_SETTINGS,
  DEFAULT_PATIENT_QR_SETTINGS,
  fetchAppointmentSlipSettings,
  fetchPatientQrSettings,
  type AppointmentSlipSettings,
  type PatientQrSettings,
} from "@/lib/api-hooks";
import QRCode from "qrcode";
import { NOTO_NASKH_BOLD_URL, NOTO_NASKH_REGULAR_URL } from "@/lib/pdf-text-utils";

const HIDDEN_APPOINTMENT_STATUSES = new Set(["cancelled", "discontinued", "voided"]);

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
const A4_WIDTH_PT = 210 * MM_TO_PT;
const A4_HEIGHT_PT = 297 * MM_TO_PT;

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

function formatAccessionFromBookingId(id: number): string {
  return `V2-${String(id).padStart(6, "0")}`;
}

function mm(value: number): number {
  return value * MM_TO_PT;
}

function getPaperDimensions(settings: Pick<AppointmentSlipSettings, "paperSize">): { label: "A5" | "A4"; widthMm: number; heightMm: number; widthPt: number; heightPt: number } {
  return settings.paperSize === "a4"
    ? { label: "A4", widthMm: 210, heightMm: 297, widthPt: A4_WIDTH_PT, heightPt: A4_HEIGHT_PT }
    : { label: "A5", widthMm: 148, heightMm: 210, widthPt: A5_WIDTH_PT, heightPt: A5_HEIGHT_PT };
}

function parseSlipDate(isoDate: string): Date | null {
  const normalized = String(isoDate || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!normalized) return null;
  const date = new Date(Date.UTC(Number(normalized[1]), Number(normalized[2]) - 1, Number(normalized[3]), 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSlipNumericDate(date: Date): string {
  return [
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCFullYear()),
  ].join("/");
}

function formatSlipWeekday(date: Date, locale: "ar-LY" | "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function formatSlipDate(isoDate: string, languageMode: AppointmentSlipSettings["languageMode"]): string {
  const date = parseSlipDate(isoDate);
  if (!date) {
    return formatDateLy(isoDate);
  }

  const numericDate = formatSlipNumericDate(date);
  const weekdayAr = formatSlipWeekday(date, "ar-LY");
  const weekdayEn = formatSlipWeekday(date, "en-GB");

  if (languageMode === "ar") {
    return `${weekdayAr} ${numericDate}`;
  }
  if (languageMode === "en") {
    return `${weekdayEn} ${numericDate}`;
  }
  return `${weekdayAr} ${numericDate} / ${weekdayEn} ${numericDate}`;
}

function formatSlipTime(raw: string | null | undefined): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : trimmed;
}

function sanitizeSettings(settings?: AppointmentSlipSettings): AppointmentSlipSettings {
  const next = settings ? { ...DEFAULT_APPOINTMENT_SLIP_SETTINGS, ...settings } : { ...DEFAULT_APPOINTMENT_SLIP_SETTINGS };
  return {
    ...next,
    paperMode: next.paperMode === "blank" ? "blank" : "preprinted",
    paperSize: next.paperSize === "a4" ? "a4" : "a5",
  };
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

function localizeValueSafe(ar: string, en: string, mode: AppointmentSlipSettings["languageMode"]): string {
  const cleanAr = String(ar || "").trim();
  const cleanEn = String(en || "").trim();
  if (mode === "ar") return cleanAr || cleanEn || "-";
  if (mode === "en") return cleanEn || cleanAr || "-";
  if (cleanAr && cleanEn && cleanAr !== cleanEn) return `${cleanAr} / ${cleanEn}`;
  return cleanAr || cleanEn || "-";
}

function formatCaseCategoryValue(
  category: AppointmentWithDetails["caseCategory"],
  mode: AppointmentSlipSettings["languageMode"]
): string {
  if (category === "oncology") {
    return mode === "ar" ? "أورام" : mode === "en" ? "Oncology" : "أورام / Oncology";
  }
  if (category === "non_oncology") {
    return mode === "ar" ? "غير أورام" : mode === "en" ? "Non-oncology" : "غير أورام / Non-oncology";
  }
  return "";
}

function buildSlipQrPayload(
  apt: AppointmentWithDetails,
  settings: AppointmentSlipSettings,
  patientQrSettings: PatientQrSettings
): string {
  const publicAppointmentUrl = String(apt.publicAppointmentUrl || "").trim();
  const token = String(apt.publicCancelToken || "").trim();
  if (!settings.showQrCode) return "";
  if (!isSlipQrAllowedForModality(apt, settings)) return "";
  if (!patientQrSettings.enabled || !patientQrSettings.printQrOnAppointmentSlip) return "";
  if (publicAppointmentUrl) return publicAppointmentUrl;
  if (!token) return "";
  return "";
}

function isSlipQrAllowedForModality(apt: AppointmentWithDetails, settings: AppointmentSlipSettings): boolean {
  const mode = settings.qrModalityMode;
  if (mode === "all") return true;
  const modalityId = Number(apt.modalityId);
  if (!Number.isFinite(modalityId) || modalityId <= 0) return false;
  const selected = new Set(
    (settings.qrModalityIds ?? [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
  if (mode === "include") return selected.has(modalityId);
  if (mode === "exclude") return !selected.has(modalityId);
  return true;
}

function buildSlipBarcodePayload(apt: AppointmentWithDetails, settings: AppointmentSlipSettings): string {
  if (settings.barcodeValueMode === "bookingId") return String(apt.id);
  if (settings.barcodeValueMode === "appointmentNumber") return String(apt.dailySequence || apt.id);
  return String(apt.accessionNumber || formatAccessionFromBookingId(apt.id)).trim();
}

function buildInstructionText(
  apt: AppointmentWithDetails,
  settings: AppointmentSlipSettings
): { headingAr: string; headingEn: string; bodyAr: string; bodyEn: string; usedFallback: boolean }[] {
  const sections: Array<{ headingAr: string; headingEn: string; bodyAr: string; bodyEn: string; usedFallback: boolean }> = [];
  const resolveBody = (value: string, fallback: string) => {
    // Keep the real instruction text when it exists; fallback is only for empty input.
    const cleaned = String(value || "").trim();
    return cleaned && cleaned !== "—" ? cleaned : fallback;
  };

  if (settings.showModalityInstructions) {
    const bodyAr = String(apt.modalityGeneralInstructionAr || "").trim();
    const bodyEn = String(apt.modalityGeneralInstructionEn || "").trim();
    const safeBodyAr = resolveBody(bodyAr, settings.fallbackInstructionTextAr);
    const safeBodyEn = resolveBody(bodyEn, settings.fallbackInstructionTextEn);
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
    const safeBodyAr = resolveBody(bodyAr, settings.fallbackInstructionTextAr);
    const safeBodyEn = resolveBody(bodyEn, settings.fallbackInstructionTextEn);
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

function buildSpecialReasonField(apt: AppointmentWithDetails): SlipField | null {
  const fallbackCode = String(apt.specialReasonCode || "").trim();
  const valueAr = String(apt.specialReasonLabelAr || fallbackCode).trim();
  const valueEn = String(apt.specialReasonLabelEn || fallbackCode).trim();
  if (!valueAr && !valueEn) return null;
  return {
    labelAr: "سبب الحصة الخاصة",
    labelEn: "Special Reason",
    valueAr: valueAr || valueEn,
    valueEn: valueEn || valueAr,
  };
}

function buildSlipFieldsClean(apt: AppointmentWithDetails, slip: AppointmentSlipData, settings: AppointmentSlipSettings): SlipField[] {
  const fields: SlipField[] = [];
  if (settings.showPatientCategory && apt.caseCategory) {
    fields.push({
      labelAr: "التصنيف",
      labelEn: "Category",
      valueAr: formatCaseCategoryValue(apt.caseCategory, "ar"),
      valueEn: formatCaseCategoryValue(apt.caseCategory, "en"),
    });
  }
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
  if (settings.showSpecialReason) {
    const specialReasonField = buildSpecialReasonField(apt);
    if (specialReasonField) fields.push(specialReasonField);
  }
  return fields;
}

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
    accessionNumber: String(apt.accessionNumber || formatAccessionFromBookingId(apt.id)).trim(),
    appointmentNumber: String(apt.dailySequence || apt.id),
    bookingId: String(apt.id),
    bookingTime: formatSlipTime(apt.bookingTime),
    modality,
    examName,
    appointmentDate: formatSlipDate(apt.appointmentDate, slipSettings.languageMode),
    ageSex,
    walkInLabel: apt.isWalkIn ? localizeText("نعم", "Yes", slipSettings.languageMode) : localizeText("لا", "No", slipSettings.languageMode),
    queueQrPayload,
    accessionBarcodePayload: buildSlipBarcodePayload(apt, slipSettings),
    locationText,
    arrivalNote: localizeText("يرجى الحضور قبل الموعد بـ 15 دقيقة", "Please arrive 15 minutes before your appointment", slipSettings.languageMode),
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
  modeOverride?: AppointmentSlipSettings["paperMode"]
): AppointmentSlipLayoutModel {
  const mode = modeOverride ?? settings.paperMode;
  const paper = getPaperDimensions(settings);
  const page = { w: paper.widthPt, h: paper.heightPt };
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
  const paper = getPaperDimensions(slipSettings);
  const qrSvg = slip.queueQrPayload
    ? await QRCode.toString(slip.queueQrPayload, { type: "svg", width: 160, margin: 1 })
    : "";
  const barcodeSvg = layout.barcodeBlock
    ? renderCode39Svg(slip.accessionBarcodePayload, slipSettings.barcodeWidthMm, slipSettings.barcodeHeightMm)
    : "";
  const patientFieldLabels = ["Category", "Patient Name", "MRN", "National ID", "Phone", "Age / Sex"];
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
          @page { size: ${paper.label} portrait; margin: 0; }
          @font-face { font-family: "Noto Naskh Arabic"; src: url("${NOTO_NASKH_REGULAR_URL}") format("truetype"); font-weight: 400; }
          @font-face { font-family: "Noto Naskh Arabic"; src: url("${NOTO_NASKH_BOLD_URL}") format("truetype"); font-weight: 700; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            width: ${paper.widthMm}mm;
            min-height: ${paper.heightMm}mm;
            direction: ${languageMode === "en" ? "ltr" : "rtl"};
            unicode-bidi: plaintext;
            font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "Tahoma", "Arial", sans-serif;
            color: #1f2937;
            background: #ffffff;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .sheet { width: ${paper.widthMm}mm; height: ${paper.heightMm}mm; position: relative; overflow: hidden; }
          .safe-area {
            position: absolute;
            top: ${slipSettings.paperMode === "preprinted" ? slipSettings.safeTopMm : 0}mm;
            left: ${slipSettings.paperMode === "preprinted" ? slipSettings.safeLeftMm : 0}mm;
            width: ${slipSettings.paperMode === "preprinted" ? layout.safeArea.w / MM_TO_PT : paper.widthMm}mm;
            height: ${slipSettings.paperMode === "preprinted" ? layout.safeArea.h / MM_TO_PT : paper.heightMm}mm;
            padding: ${slipSettings.contentPaddingMm}mm;
          }
          .content { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 1.2mm; }
          .appointment-slip-bold .content { font-weight: 700; }
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
      <body class="${slipSettings.boldAppointmentSlipText ? "appointment-slip-bold" : ""}" data-appointment-slip-document="true">
        <div class="sheet" data-paper-mode="${slipSettings.paperMode}" data-paper-size="${slipSettings.paperSize}" data-language-mode="${languageMode}" data-page-width-mm="${paper.widthMm}" data-page-height-mm="${paper.heightMm}">
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
        <div class="arabic">
          <div class="label">Patient</div>
          <div class="value">${escapeHtml(apt.arabicFullName)}</div>
          <div class="meta">Age: ${escapeHtml(apt.ageYears ? String(apt.ageYears) : "â€”")} Â· City: ${escapeHtml(apt.address ? (LIBYAN_CITIES.find((city) => city.code === apt.address)?.nameEn ?? apt.address) : "â€”")}</div>
        </div>
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
          .meta { margin-top: 2px; font-size: 8.5px; color: #4b5563; line-height: 1.2; }
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
  const printDoc = printWindow.document;
  const brandAr = printDoc.querySelector(".brand-ar");
  if (brandAr) {
    brandAr.textContent = "المركز الوطني للأورام بنغازي";
  }
  const summary = printDoc.querySelector(".summary");
  if (summary && summary.textContent) {
    summary.textContent = summary.textContent.replace(/Â·/g, "·");
  }
  printWindow.focus();
  printWindow.print();
}

export function printAppointmentListV2(list: AppointmentWithDetails[], listDate: string): void {
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
        <div class="arabic">
          <div class="label">Patient</div>
          <div class="value">${escapeHtml(apt.arabicFullName)}</div>
          <div class="meta">Age: ${escapeHtml(apt.ageYears ? String(apt.ageYears) : "N/A")} | City: ${escapeHtml(apt.address ? (LIBYAN_CITIES.find((city) => city.code === apt.address)?.nameEn ?? apt.address) : "N/A")}</div>
        </div>
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
          .meta { margin-top: 2px; font-size: 8.5px; color: #4b5563; line-height: 1.2; }
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
              <p class="brand-ar">المركز الوطني للأورام بنغازي</p>
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
