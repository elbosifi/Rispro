import { createHash, randomUUID } from "crypto";
import { normalizeDateValue } from "../utils/date.js";
import { formatV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";
import type { ResolvedSanteWorklistSettings } from "./sante-worklist-settings-resolver.js";

export type SanteOrderControl = "NW" | "XO" | "CA";

export interface SanteHl7BookingProjection {
  id: number;
  patient_id: number;
  patient_primary_id: string | null;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  estimated_date_of_birth: string | null;
  sex: string | null;
  modality_code: string;
  modality_name_en: string;
  modality_name_ar: string;
  exam_name_en: string | null;
  exam_name_ar: string | null;
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
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return escapeHl7(clean.replace(/\s+/g, "^"));
  return parts.map(escapeHl7).join("^");
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
  const procedureDescription = booking.exam_name_en || booking.exam_name_ar || booking.modality_name_en || booking.modality_name_ar || booking.modality_code;
  const scheduledDateTime = hl7DateTime(booking.booking_date, booking.booking_time);
  const timestamp = hl7Timestamp(input.now);
  const acceptAckType = settings.deliveryMethod === "mllp" && settings.mllpExpectAck ? "AL" : "";
  const obr = Array<string>(25).fill("");
  obr[0] = "OBR";
  obr[1] = "1";
  obr[2] = escapeHl7(accessionNumber);
  obr[4] = `^${escapeHl7(procedureDescription)}`;
  obr[6] = scheduledDateTime;
  obr[7] = scheduledDateTime;
  obr[18] = escapeHl7(accessionNumber);
  obr[21] = escapeHl7(settings.scheduledStationAeTitleDefault);
  obr[24] = escapeHl7(booking.modality_code);

  const segments = [
    [
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
    ].join("|"),
    [
      "PID",
      "1",
      "",
      patientId(booking, settings),
      "",
      patientName(booking, settings),
      "",
      hl7Date(booking.estimated_date_of_birth),
      sex(booking.sex),
    ].join("|"),
    [
      "PV1",
      "1",
      "O",
    ].join("|"),
    [
      "ORC",
      orderControl,
      escapeHl7(accessionNumber),
      "",
      "",
      orderControl === "CA" ? "CA" : "SC",
      "",
      "",
      timestamp,
    ].join("|"),
    obr.join("|"),
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
    arabic_full_name: "Test Patient",
    english_full_name: "Test Patient",
    estimated_date_of_birth: "1980-01-01",
    sex: "other",
    modality_code: "CT",
    modality_name_en: "CT",
    modality_name_ar: "CT",
    exam_name_en: "Synthetic Sante Worklist Test",
    exam_name_ar: "Synthetic Sante Worklist Test",
    booking_date: normalizeDateValue(new Date()) || "2026-01-01",
    booking_time: "08:00:00",
    status: "scheduled",
  };
}
