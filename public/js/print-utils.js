/**
 * Print utilities for browser environment
 * Provides barcode generation, HTML escaping, and print helpers
 */

// CODE39 barcode patterns
const CODE39_PATTERNS = {
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
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn"
};

/**
 * Escape HTML special characters to prevent XSS
 * @param {*} value - Value to escape
 * @returns {string} Escaped string
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Generate Code39 barcode as SVG
 * @param {string} value - Value to encode
 * @returns {string} SVG markup
 */
function buildCode39Svg(value) {
  const cleanValue = String(value || "")
    .toUpperCase()
    .split("")
    .map((char) => (CODE39_PATTERNS[char] ? char : "-"))
    .join("");
  const encoded = `*${cleanValue}*`;
  const height = 72;
  const narrowWidth = 2;
  const wideWidth = 6;
  let x = 0;
  const rects = [];

  for (const character of encoded || "**") {
    const pattern = CODE39_PATTERNS[character];
    if (!pattern) {
      continue;
    }

    for (let index = 0; index < pattern.length; index += 1) {
      const isBar = index % 2 === 0;
      const width = pattern[index] === "w" ? wideWidth : narrowWidth;

      if (isBar) {
        rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}" fill="#111827"></rect>`);
      }

      x += width;
    }

    x += narrowWidth;
  }

  return `<svg class="barcode-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(x, 1)} ${height}" role="img" aria-label="${escapeHtml(`Barcode ${cleanValue || "-"}`)}">${rects.join("")}</svg>`;
}

/**
 * Normalize date text for consistent formatting
 * @param {string} value - Date value
 * @returns {string} Normalized date string
 */
function normalizeDateText(value) {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toISOString().split("T")[0];
  } catch {
    return String(value);
  }
}

/**
 * Format date for display
 * @param {string} value - ISO date string
 * @returns {string} Formatted date
 */
function formatDisplayDate(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(state.language === "ar" ? "ar-LY" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(date);
  } catch {
    return "—";
  }
}

/**
 * Format modality name based on language
 * @param {object} entry - Modality object
 * @returns {string} Formatted name
 */
function formatModalityName(entry) {
  if (!entry) return "";
  const lang = state.language;
  return (
    (lang === "ar" ? entry.name_ar : entry.name_en) ||
    (lang === "ar" ? entry.modality_name_ar : entry.modality_name_en) ||
    entry.name ||
    entry.modality_name ||
    ""
  );
}

/**
 * Format exam name based on language
 * @param {object} entry - Exam type object
 * @returns {string} Formatted name
 */
function formatExamName(entry) {
  if (!entry) return "";
  const lang = state.language;
  return (
    (lang === "ar" ? entry.exam_name_ar : entry.exam_name_en) ||
    (lang === "ar" ? entry.name_ar : entry.name_en) ||
    entry.exam_name ||
    entry.name ||
    ""
  );
}

/**
 * Get localized appointment field label
 * @param {string} key - Field key
 * @returns {string} Localized label
 */
function appointmentFieldLabel(key) {
  const labels = t().appointments.fields;
  return labels[key] || key;
}

/**
 * Build appointment slip data from source object
 * @param {object} source - Source object with appointment/patient data
 * @returns {object|null} Slip data or null if invalid
 */
function buildAppointmentSlipData(source) {
  if (!source) {
    return null;
  }

  const appointment = source.appointment || source;
  const patient = source.patient || source;
  const modality = source.modality || appointment;
  const examType = source.examType || appointment;
  const language = state.language;

  const modalityInstruction =
    language === "ar"
      ? modality?.general_instruction_ar || appointment?.general_instruction_ar || ""
      : modality?.general_instruction_en || appointment?.general_instruction_en || "";

  const examInstruction =
    language === "ar"
      ? examType?.specific_instruction_ar || appointment?.specific_instruction_ar || ""
      : examType?.specific_instruction_en || appointment?.specific_instruction_en || "";

  return {
    accessionNumber: source.barcodeValue || appointment.accession_number || "",
    appointmentDate: normalizeDateText(appointment.appointment_date),
    registrationDate: appointment.created_at || null,
    patientArabicName: patient?.arabic_full_name || appointment?.arabic_full_name || "",
    patientEnglishName: patient?.english_full_name || appointment?.english_full_name || "",
    modalityName: formatModalityName(modality),
    examName: formatExamName(examType),
    notes: appointment.notes || "",
    modalityInstruction,
    examInstruction
  };
}

/**
 * Validate print data before generating HTML
 * @param {object} slip - Slip data
 * @returns {boolean} True if valid
 */
function validatePrintData(slip) {
  if (!slip) {
    console.error("Print validation failed: No slip data provided");
    return false;
  }
  
  if (!slip.accessionNumber) {
    console.error("Print validation failed: Missing accession number");
    return false;
  }
  
  if (!slip.patientArabicName && !slip.patientEnglishName) {
    console.warn("Print warning: No patient name found");
  }
  
  return true;
}

// Export for use in app.js
window.PrintUtils = {
  CODE39_PATTERNS,
  escapeHtml,
  buildCode39Svg,
  normalizeDateText,
  formatDisplayDate,
  formatModalityName,
  formatExamName,
  appointmentFieldLabel,
  buildAppointmentSlipData,
  validatePrintData
};
