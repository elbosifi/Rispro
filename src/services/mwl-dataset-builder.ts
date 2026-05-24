import { normalizeDateValue } from "../utils/date.js";
import { normalizeOptionalText } from "../utils/normalize.js";

export type MwlProfile = "minimal";
export type WorklistOverflowPolicy = "reject" | "truncate" | "omit";

export interface MwlExtraTag {
  tag: string;
  vr: "AE" | "CS" | "DA" | "LO" | "PN" | "SH" | "UI";
  value: string;
  maxLength?: number;
  policy?: WorklistOverflowPolicy;
}

export interface MwlCompatibilityOptions {
  specificCharacterSet?: string;
  enforceDicomVrLimits?: boolean;
  enabledTags?: Record<string, boolean>;
  tagLimits?: Record<string, number>;
  overflowPolicy?: Record<string, WorklistOverflowPolicy>;
  patientIdSource?: "identifier_value" | "mrn" | "national_id" | "patient_id";
  patientNameSource?: "english_full_name" | "arabic_full_name";
  procedureDescriptionSource?: "exam_name_en" | "exam_name_ar" | "modality_name_en" | "modality_name_ar";
  extraTags?: MwlExtraTag[];
}

export interface CanonicalScheduledProcedureStep {
  modality: string;
  scheduledProcedureStepStartDate: string;
  scheduledProcedureStepDescription: string;
}

export interface CanonicalMwlDataset {
  specificCharacterSet: string;
  patientName: string;
  patientId: string;
  patientBirthDate: string;
  patientSex: string;
  accessionNumber?: string;
  scheduledProcedureStepSequence: [CanonicalScheduledProcedureStep];
  orthancEnabledTags?: Record<string, boolean>;
  orthancExtraTags?: Record<string, string>;
}

export interface CanonicalMwlInput {
  modalityCode: string | null | undefined;
  appointmentDate: string | null | undefined;
  patientPrimaryId: string | null | undefined;
  patientMrn: string | null | undefined;
  patientNationalId: string | null | undefined;
  patientId: string | number;
  patientEnglishFullName: string | null | undefined;
  patientArabicFullName: string | null | undefined;
  patientBirthDate: string | null | undefined;
  patientSex: string | null | undefined;
  examNameEn: string | null | undefined;
  examNameAr: string | null | undefined;
  modalityNameEn: string | null | undefined;
  modalityNameAr: string | null | undefined;
  accessionNumber?: string | null | undefined;
  requestedProcedureId?: string | null | undefined;
  scheduledStationAeTitle?: string | null | undefined;
}

function assertMinimalProfile(profile: string): asserts profile is MwlProfile {
  if (profile !== "minimal") {
    throw new Error(`Unsupported MWL profile \"${profile}\". Only \"minimal\" is supported.`);
  }
}

const DICOM_CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

const DICOM_DEFAULT_LIMITS: Record<string, number> = {
  SpecificCharacterSet: 16,
  PatientName: 64,
  PatientID: 64,
  PatientBirthDate: 8,
  PatientSex: 16,
  AccessionNumber: 16,
  Modality: 16,
  ScheduledProcedureStepStartDate: 8,
  ScheduledProcedureStepDescription: 64,
};

const DICOM_EXTRA_TAG_DEFAULT_LIMITS: Record<MwlExtraTag["vr"], number> = {
  AE: 16,
  CS: 16,
  DA: 8,
  LO: 64,
  PN: 64,
  SH: 16,
  UI: 64,
};

function logMwlCompatibilityEvent(type: string, field: string, originalLength: number, maxLength: number): void {
  console.warn(JSON.stringify({ type, field, originalLength, maxLength }));
}

function assertNoControlChars(value: string, field: string): void {
  if (DICOM_CONTROL_CHAR_PATTERN.test(value)) {
    throw new Error(`${field} contains invalid DICOM control characters.`);
  }
}

function normalizePolicy(
  field: string,
  compatibility: MwlCompatibilityOptions | undefined,
  fallback: WorklistOverflowPolicy
): WorklistOverflowPolicy {
  const policy = compatibility?.overflowPolicy?.[field];
  return policy === "omit" || policy === "truncate" || policy === "reject" ? policy : fallback;
}

function enforceMaxLength(
  value: string,
  field: string,
  maxLength: number,
  policy: WorklistOverflowPolicy
): string | undefined {
  assertNoControlChars(value, field);
  if (field === "PatientName") {
    for (const group of value.split("=")) {
      if (group.length > maxLength) {
        if (policy === "omit") {
          logMwlCompatibilityEvent("mwl_value_omitted", field, group.length, maxLength);
          return undefined;
        }
        if (policy === "truncate") {
          logMwlCompatibilityEvent("mwl_value_truncated", field, group.length, maxLength);
          return value
            .split("=")
            .map((part) => part.slice(0, maxLength))
            .join("=");
        }
        throw new Error(`${field} exceeds DICOM PN maximum length ${maxLength}.`);
      }
    }
    return value;
  }

  if (value.length <= maxLength) {
    return value;
  }

  if (policy === "omit") {
    logMwlCompatibilityEvent("mwl_value_omitted", field, value.length, maxLength);
    return undefined;
  }

  if (policy === "truncate") {
    logMwlCompatibilityEvent("mwl_value_truncated", field, value.length, maxLength);
    return value.slice(0, maxLength);
  }

  throw new Error(`${field} exceeds DICOM ${field === "PatientID" ? "LO" : "VR"} maximum length ${maxLength}.`);
}

function applyCompatibilityLimit(
  value: string,
  field: string,
  compatibility: MwlCompatibilityOptions | undefined,
  fallbackPolicy: WorklistOverflowPolicy
): string | undefined {
  if (!compatibility?.enforceDicomVrLimits) {
    return value;
  }
  const maxLength = compatibility.tagLimits?.[field] || DICOM_DEFAULT_LIMITS[field];
  return enforceMaxLength(value, field, maxLength, normalizePolicy(field, compatibility, fallbackPolicy));
}

function normalizeDateForDicom(value: string | null | undefined): string {
  const normalized = normalizeDateValue(value);
  return normalized ? normalized.replaceAll("-", "") : "";
}

function normalizeSexForDicom(value: string | null | undefined): string {
  const raw = String(value || "").trim().toUpperCase();

  if (raw === "M" || raw === "MALE") return "M";
  if (raw === "F" || raw === "FEMALE") return "F";
  if (raw === "O" || raw === "OTHER") return "O";

  return "";
}

function normalizeModalityForDicom(value: string | null | undefined): string {
  const raw = String(value || "").trim().toUpperCase();

  if (!raw) {
    return "";
  }

  const mapped: Record<string, string> = {
    MRI: "MR",
    CT: "CT",
    ULTRASOUND: "US",
    US: "US",
    MR: "MR",
  };

  return mapped[raw] || raw;
}

function buildPersonName(
  input: CanonicalMwlInput,
  compatibility?: MwlCompatibilityOptions
): string {
  const source = compatibility?.patientNameSource;
  const selected = source === "arabic_full_name"
    ? input.patientArabicFullName
    : source === "english_full_name"
      ? input.patientEnglishFullName
      : null;
  const value = normalizeOptionalText(selected)
    || normalizeOptionalText(input.patientEnglishFullName)
    || normalizeOptionalText(input.patientArabicFullName);
  return value || "UNKNOWN";
}

function buildPatientId(input: CanonicalMwlInput, compatibility?: MwlCompatibilityOptions): string {
  if (compatibility?.patientIdSource === "mrn") {
    return normalizeOptionalText(input.patientMrn) || String(input.patientId);
  }
  if (compatibility?.patientIdSource === "national_id") {
    return normalizeOptionalText(input.patientNationalId) || String(input.patientId);
  }
  if (compatibility?.patientIdSource === "patient_id") {
    return String(input.patientId);
  }

  const primaryId = normalizeOptionalText(input.patientPrimaryId);
  if (primaryId) return primaryId;

  const mrn = normalizeOptionalText(input.patientMrn);
  if (mrn) return mrn;

  return String(input.patientId);
}

function buildSpsDescription(input: CanonicalMwlInput, compatibility?: MwlCompatibilityOptions): string {
  const source = compatibility?.procedureDescriptionSource;
  if (source === "exam_name_en") return normalizeOptionalText(input.examNameEn) || "Scheduled study";
  if (source === "exam_name_ar") return normalizeOptionalText(input.examNameAr) || "Scheduled study";
  if (source === "modality_name_en") return normalizeOptionalText(input.modalityNameEn) || "Scheduled study";
  if (source === "modality_name_ar") return normalizeOptionalText(input.modalityNameAr) || "Scheduled study";

  return (
    normalizeOptionalText(input.examNameEn) ||
    normalizeOptionalText(input.examNameAr) ||
    normalizeOptionalText(input.modalityNameEn) ||
    normalizeOptionalText(input.modalityNameAr) ||
    "Scheduled study"
  );
}

function normalizeExtraTags(extraTags: MwlExtraTag[] | undefined): Record<string, string> | undefined {
  if (!extraTags || extraTags.length === 0) return undefined;
  const result: Record<string, string> = {};

  for (const extraTag of extraTags) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(extraTag.tag)) {
      throw new Error(`Invalid DICOM tag key: ${extraTag.tag}`);
    }
    if (!DICOM_EXTRA_TAG_DEFAULT_LIMITS[extraTag.vr]) {
      throw new Error(`Unsupported DICOM VR: ${extraTag.vr}`);
    }
    const maxLength = extraTag.maxLength || DICOM_EXTRA_TAG_DEFAULT_LIMITS[extraTag.vr];
    const value = enforceMaxLength(String(extraTag.value ?? ""), extraTag.tag, maxLength, extraTag.policy || "reject");
    if (value !== undefined) {
      result[extraTag.tag] = value;
    }
  }

  return result;
}

export function buildCanonicalMwlDataset(
  input: CanonicalMwlInput,
  options: { mwlProfile: string; compatibility?: MwlCompatibilityOptions }
): CanonicalMwlDataset {
  assertMinimalProfile(options.mwlProfile);
  const compatibility = options.compatibility;
  const patientName = applyCompatibilityLimit(buildPersonName(input, compatibility), "PatientName", compatibility, "reject") || "";
  const patientId = applyCompatibilityLimit(buildPatientId(input, compatibility), "PatientID", compatibility, "reject") || "";
  const patientBirthDate = applyCompatibilityLimit(normalizeDateForDicom(input.patientBirthDate), "PatientBirthDate", compatibility, "reject") || "";
  const patientSex = applyCompatibilityLimit(normalizeSexForDicom(input.patientSex), "PatientSex", compatibility, "reject") || "";
  const accessionNumber = normalizeOptionalText(input.accessionNumber);
  const modality = applyCompatibilityLimit(normalizeModalityForDicom(input.modalityCode), "Modality", compatibility, "reject") || "";
  const startDate = applyCompatibilityLimit(normalizeDateForDicom(input.appointmentDate), "ScheduledProcedureStepStartDate", compatibility, "reject") || "";
  const description = applyCompatibilityLimit(buildSpsDescription(input, compatibility), "ScheduledProcedureStepDescription", compatibility, "truncate") || "";

  return {
    specificCharacterSet: applyCompatibilityLimit(compatibility?.specificCharacterSet || "ISO_IR 192", "SpecificCharacterSet", compatibility, "reject") || "",
    patientName,
    patientId,
    patientBirthDate,
    patientSex,
    accessionNumber: accessionNumber
      ? applyCompatibilityLimit(accessionNumber, "AccessionNumber", compatibility, "reject")
      : undefined,
    scheduledProcedureStepSequence: [
      {
        modality,
        scheduledProcedureStepStartDate: startDate,
        scheduledProcedureStepDescription: description,
      },
    ],
    ...(compatibility?.enabledTags ? { orthancEnabledTags: compatibility.enabledTags } : {}),
    ...(compatibility?.extraTags ? { orthancExtraTags: normalizeExtraTags(compatibility.extraTags) } : {}),
  };
}

function quoteDicomValue(value: unknown): string {
  return `[${String(value ?? "").replaceAll("]", "\\]")}]`;
}

function buildSequenceDump(tag: string, lines: string[]): string[] {
  return [
    `${tag} SQ (Sequence with undefined length)`,
    "(fffe,e000) na (Item with undefined length)",
    ...lines.map((line) => `  ${line}`),
    "(fffe,e00d) na (ItemDelimitationItem)",
    "(fffe,e0dd) na (SequenceDelimitationItem)",
  ];
}

export function renderCanonicalMwlToDump(dataset: CanonicalMwlDataset): string {
  const sps = dataset.scheduledProcedureStepSequence[0];
  const sequenceLines = [
    dataset.accessionNumber ? `(0008,0050) SH ${quoteDicomValue(dataset.accessionNumber)}` : null,
    `(0008,0060) CS ${quoteDicomValue(sps.modality)}`,
    `(0040,0002) DA ${quoteDicomValue(sps.scheduledProcedureStepStartDate)}`,
    `(0040,0007) LO ${quoteDicomValue(sps.scheduledProcedureStepDescription)}`,
  ].filter((line): line is string => Boolean(line));

  return [
    "# RISpro generated Modality Worklist source file",
    `(0008,0005) CS ${quoteDicomValue(dataset.specificCharacterSet)}`,
    `(0010,0010) PN ${quoteDicomValue(dataset.patientName)}`,
    `(0010,0020) LO ${quoteDicomValue(dataset.patientId)}`,
    `(0010,0030) DA ${quoteDicomValue(dataset.patientBirthDate)}`,
    `(0010,0040) CS ${quoteDicomValue(dataset.patientSex)}`,
    ...buildSequenceDump("(0040,0100)", sequenceLines),
  ].join("\n");
}

export function renderCanonicalMwlToOrthancJson(dataset: CanonicalMwlDataset): Record<string, unknown> {
  const sps = dataset.scheduledProcedureStepSequence[0];
  const enabledTags = dataset.orthancEnabledTags || {};
  const isEnabled = (tag: string) => enabledTags[tag] !== false;

  return {
    ...(isEnabled("SpecificCharacterSet") ? { SpecificCharacterSet: dataset.specificCharacterSet } : {}),
    ...(isEnabled("PatientName") ? { PatientName: dataset.patientName } : {}),
    ...(isEnabled("PatientID") ? { PatientID: dataset.patientId } : {}),
    ...(isEnabled("PatientBirthDate") ? { PatientBirthDate: dataset.patientBirthDate } : {}),
    ...(isEnabled("PatientSex") ? { PatientSex: dataset.patientSex } : {}),
    ...(dataset.accessionNumber && isEnabled("AccessionNumber") ? { AccessionNumber: dataset.accessionNumber } : {}),
    ScheduledProcedureStepSequence: [
      {
        ...(isEnabled("Modality") ? { Modality: sps.modality } : {}),
        ...(isEnabled("ScheduledProcedureStepStartDate") ? { ScheduledProcedureStepStartDate: sps.scheduledProcedureStepStartDate } : {}),
        ...(isEnabled("ScheduledProcedureStepDescription") ? { ScheduledProcedureStepDescription: sps.scheduledProcedureStepDescription } : {}),
      },
    ],
    ...(dataset.orthancExtraTags || {}),
  };
}
