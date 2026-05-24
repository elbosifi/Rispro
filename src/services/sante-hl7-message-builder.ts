import { createHash, randomUUID } from "crypto";
import { normalizeDateValue } from "../utils/date.js";
import { formatV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";
import type { ResolvedSanteWorklistSettings, SanteHl7OverflowPolicy } from "./sante-worklist-settings-resolver.js";

export type SanteOrderControl = "NW" | "XO" | "CA";

export interface SanteHl7BookingProjection {
  id: number;
  patient_id: number;
  patient_primary_id: string | null;
  mrn: string | null;
  national_id: string | null;
  phone_1: string | null;
  address: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  estimated_date_of_birth: string | null;
  sex: string | null;
  modality_code: string;
  modality_name_en: string;
  modality_name_ar: string;
  exam_type_code: string | null;
  exam_name_en: string | null;
  exam_name_ar: string | null;
  protocol_text: string | null;
  contrast_required: boolean | null;
  contrast_phase_or_protocol: string | null;
  booking_date: string;
  booking_time: string | null;
  status: string;
}

export interface BuiltSanteHl7Message {
  message: string;
  messageControlId: string;
  payloadHash: string;
  accessionNumber: string;
}

function hl7Timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function hl7Date(value: string | null | undefined): string {
  const normalized = normalizeDateValue(value);
  return normalized ? normalized.replaceAll("-", "") : "";
}

function hl7DateTime(dateValue: string, timeValue: string | null): string {
  const date = hl7Date(dateValue);
  const time = String(timeValue || "08:00:00").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  return `${date}${time ? `${time[1]}${time[2]}${time[3] || "00"}` : "080000"}`;
}

function escapeHl7(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\E\\")
    .replace(/\|/g, "\\F\\")
    .replace(/\^/g, "\\S\\")
    .replace(/~/g, "\\R\\")
    .replace(/&/g, "\\T\\")
    .replace(/\r?\n/g, " ");
}

function patientName(row: SanteHl7BookingProjection, settings: ResolvedSanteWorklistSettings): string {
  const selected = settings.patientNameField === "arabic_full_name" ? row.arabic_full_name : row.english_full_name;
  const fallback = row.english_full_name || row.arabic_full_name || "TEST PATIENT";
  const clean = String(selected || fallback).trim();
  return escapeHl7(clean.replace(/\s+/g, " "));
}

function patientId(row: SanteHl7BookingProjection, settings: ResolvedSanteWorklistSettings): string {
  switch (settings.patientIdField) {
    case "mrn": return escapeHl7(row.mrn || row.patient_primary_id || row.patient_id);
    case "national_id": return escapeHl7(row.national_id || row.patient_primary_id || row.patient_id);
    case "patient_id": return escapeHl7(row.patient_id);
    default: return escapeHl7(row.patient_primary_id || row.mrn || row.national_id || row.patient_id);
  }
}

function sex(value: string | null): string {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "male" || raw === "m") return "M";
  if (raw === "female" || raw === "f") return "F";
  if (raw === "other" || raw === "o") return "O";
  return "";
}

function compactText(value: unknown): string {
  return String(value ?? "").trim();
}

function selectProcedureCode(row: SanteHl7BookingProjection, settings: ResolvedSanteWorklistSettings): string {
  if (settings.procedureCodeField === "modality_code") {
    return compactText(row.modality_code);
  }
  return compactText(row.exam_type_code) || compactText(row.modality_code);
}

function selectProcedureDescription(row: SanteHl7BookingProjection, settings: ResolvedSanteWorklistSettings): string {
  switch (settings.procedureDescriptionField) {
    case "exam_name_ar": return compactText(row.exam_name_ar);
    case "modality_name_en": return compactText(row.modality_name_en);
    case "modality_name_ar": return compactText(row.modality_name_ar);
    case "modality_code": return compactText(row.modality_code);
    default: return compactText(row.exam_name_en);
  }
}

const DEFAULT_HL7_FIELD_LIMITS: Record<string, number> = {
  "PID.3": 64,
  "PID.5": 64,
  "OBR.13": 64,
  "OBR.20": 64,
  "OBR.31": 64,
};

const DEFAULT_HL7_OVERFLOW_POLICY: Record<string, SanteHl7OverflowPolicy> = {
  "PID.3": "reject",
  "PID.5": "reject",
  "OBR.13": "truncate",
  "OBR.20": "truncate",
  "OBR.31": "truncate",
};

function logHl7CompatibilityEvent(type: string, field: string, originalLength: number, maxLength: number): void {
  console.warn(JSON.stringify({ type, field, originalLength, maxLength }));
}

function fieldKey(segment: string, field: number): string {
  return `${segment}.${field}`;
}

function applyHl7FieldCompatibility(
  value: string,
  key: string,
  settings: ResolvedSanteWorklistSettings,
  fallbackPolicy?: SanteHl7OverflowPolicy
): string {
  if (settings.hl7EnabledFields?.[key] === false) {
    if (value) {
      logHl7CompatibilityEvent("hl7_value_omitted", key, value.length, 0);
    }
    return "";
  }

  const maxLength = settings.hl7FieldLimits?.[key] || DEFAULT_HL7_FIELD_LIMITS[key];
  if (!maxLength || value.length <= maxLength) {
    return value;
  }

  const policy = settings.hl7OverflowPolicy?.[key] || DEFAULT_HL7_OVERFLOW_POLICY[key] || fallbackPolicy || "reject";
  if (policy === "omit") {
    logHl7CompatibilityEvent("hl7_value_omitted", key, value.length, maxLength);
    return "";
  }
  if (policy === "truncate") {
    logHl7CompatibilityEvent("hl7_value_truncated", key, value.length, maxLength);
    return value.slice(0, maxLength);
  }
  throw new Error(`${key} exceeds maximum length ${maxLength}.`);
}

function applySegmentCompatibility(
  segment: string[],
  settings: ResolvedSanteWorklistSettings
): string[] {
  const name = segment[0];
  for (let index = 1; index < segment.length; index += 1) {
    const key = fieldKey(name, index);
    segment[index] = applyHl7FieldCompatibility(segment[index] || "", key, settings);
  }

  for (const extraField of settings.hl7ExtraFields || []) {
    if (extraField.segment !== name) continue;
    const key = fieldKey(name, extraField.field);
    const maxLength = extraField.maxLength || settings.hl7FieldLimits?.[key];
    const originalLimits = settings.hl7FieldLimits || {};
    const originalPolicy = settings.hl7OverflowPolicy || {};
    const compatibilitySettings = {
      ...settings,
      hl7FieldLimits: maxLength ? { ...originalLimits, [key]: maxLength } : originalLimits,
      hl7OverflowPolicy: extraField.policy ? { ...originalPolicy, [key]: extraField.policy } : originalPolicy,
    };
    while (segment.length <= extraField.field) {
      segment.push("");
    }
    segment[extraField.field] = applyHl7FieldCompatibility(
      escapeHl7(extraField.value),
      key,
      compatibilitySettings
    );
  }

  return segment;
}

export function buildAccessionNumber(bookingId: number): string {
  return formatV2AccessionNumber(bookingId);
}

export function buildSanteOrmO01Message(input: {
  booking: SanteHl7BookingProjection;
  orderControl: SanteOrderControl;
  settings: ResolvedSanteWorklistSettings;
  messageControlId?: string;
  now?: Date;
}): BuiltSanteHl7Message {
  const { booking, orderControl, settings } = input;
  const messageControlId = input.messageControlId || `RISPRO-${randomUUID()}`;
  const accessionNumber = buildAccessionNumber(booking.id);
  const procedureDescription = selectProcedureDescription(booking, settings)
    || booking.exam_name_en
    || booking.exam_name_ar
    || booking.modality_name_en
    || booking.modality_name_ar
    || booking.modality_code;
  const procedureCode = selectProcedureCode(booking, settings) || procedureDescription;
  const scheduledDateTime = hl7DateTime(booking.booking_date, booking.booking_time);
  const timestamp = hl7Timestamp(input.now);
  const acceptAckType = settings.deliveryMethod === "mllp" && settings.mllpExpectAck ? "AL" : "";
  const procedureStatus = orderControl === "CA" ? "CA" : "SC";
  const contrastText = booking.contrast_required
    ? compactText(booking.contrast_phase_or_protocol) || compactText(booking.protocol_text) || "Contrast required"
    : "";
  const contrastComment = booking.contrast_required
    ? compactText(booking.protocol_text) || compactText(booking.contrast_phase_or_protocol)
    : "";

  const pid = Array<string>(14).fill("");
  pid[0] = "PID";
  pid[1] = "1";
  pid[3] = patientId(booking, settings);
  pid[5] = patientName(booking, settings);
  pid[7] = hl7Date(booking.estimated_date_of_birth);
  pid[8] = sex(booking.sex);
  pid[11] = escapeHl7(booking.address);
  pid[13] = escapeHl7(booking.phone_1);

  const orc = Array<string>(16).fill("");
  orc[0] = "ORC";
  orc[1] = orderControl;
  orc[2] = escapeHl7(accessionNumber);
  orc[5] = procedureStatus;
  orc[9] = timestamp;
  orc[15] = scheduledDateTime;

  const obr = Array<string>(32).fill("");
  obr[0] = "OBR";
  obr[1] = "1";
  obr[2] = escapeHl7(accessionNumber);
  obr[4] = `${escapeHl7(procedureCode)}^${escapeHl7(procedureDescription)}`;
  obr[6] = scheduledDateTime;
  obr[7] = scheduledDateTime;
  obr[13] = escapeHl7(contrastText);
  obr[18] = escapeHl7(booking.modality_code);
  obr[20] = escapeHl7(procedureDescription);
  obr[21] = escapeHl7(settings.scheduledStationAeTitleDefault);
  obr[24] = escapeHl7(booking.modality_code);
  obr[25] = escapeHl7(booking.modality_code);
  obr[31] = escapeHl7(contrastComment);

  const segments = [
    applySegmentCompatibility([
      "MSH",
      "^~\\&",
      escapeHl7(settings.sendingApplication),
      escapeHl7(settings.sendingFacility),
      escapeHl7(settings.receivingApplication),
      escapeHl7(settings.receivingFacility),
      timestamp,
      "",
      "ORM^O01",
      escapeHl7(messageControlId),
      "P",
      escapeHl7(settings.hl7Version),
      "",
      "",
      acceptAckType,
      "",
      escapeHl7(settings.charset),
    ], settings).join("|"),
    applySegmentCompatibility(pid, settings).join("|"),
    applySegmentCompatibility([
      "PV1",
      "1",
      "O",
    ], settings).join("|"),
    applySegmentCompatibility(orc, settings).join("|"),
    applySegmentCompatibility(obr, settings).join("|"),
  ];

  const message = `${segments.join("\r")}\r`;
  return {
    message,
    messageControlId,
    payloadHash: createHash("sha256").update(message).digest("hex"),
    accessionNumber,
  };
}

export function buildSyntheticSanteTestProjection(): SanteHl7BookingProjection {
  return {
    id: 0,
    patient_id: 0,
    patient_primary_id: "TEST-SANTE-001",
    mrn: "TEST-MRN-001",
    national_id: null,
    phone_1: null,
    address: null,
    arabic_full_name: "Test Patient",
    english_full_name: "Test Patient",
    estimated_date_of_birth: "1980-01-01",
    sex: "other",
    modality_code: "CT",
    modality_name_en: "CT",
    modality_name_ar: "CT",
    exam_type_code: "SANTE_TEST",
    exam_name_en: "Synthetic Sante Worklist Test",
    exam_name_ar: "Synthetic Sante Worklist Test",
    protocol_text: null,
    contrast_required: null,
    contrast_phase_or_protocol: null,
    booking_date: normalizeDateValue(new Date()) || "2026-01-01",
    booking_time: "08:00:00",
    status: "scheduled",
  };
}
