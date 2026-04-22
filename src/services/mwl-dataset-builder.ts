import { normalizeDateValue } from "../utils/date.js";
import { normalizeOptionalText } from "../utils/normalize.js";

export type MwlProfile = "minimal";

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
  scheduledProcedureStepSequence: [CanonicalScheduledProcedureStep];
}

interface CanonicalMwlDatasetWithOptionalIds extends CanonicalMwlDataset {
  accessionNumber?: string;
  requestedProcedureId?: string;
  scheduledStationAeTitle?: string;
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

function buildPersonName(englishName: string | null | undefined, arabicName: string | null | undefined): string {
  const value = normalizeOptionalText(englishName) || normalizeOptionalText(arabicName);
  return value || "UNKNOWN";
}

function buildPatientId(input: CanonicalMwlInput): string {
  const primaryId = normalizeOptionalText(input.patientPrimaryId);
  if (primaryId) return primaryId;

  const mrn = normalizeOptionalText(input.patientMrn);
  if (mrn) return mrn;

  return String(input.patientId);
}

function buildSpsDescription(input: CanonicalMwlInput): string {
  return (
    normalizeOptionalText(input.examNameEn) ||
    normalizeOptionalText(input.examNameAr) ||
    normalizeOptionalText(input.modalityNameEn) ||
    normalizeOptionalText(input.modalityNameAr) ||
    "Scheduled study"
  );
}

export function buildCanonicalMwlDataset(
  input: CanonicalMwlInput,
  options: { mwlProfile: string }
): CanonicalMwlDataset {
  assertMinimalProfile(options.mwlProfile);

  return {
    specificCharacterSet: "ISO_IR 192",
    patientName: buildPersonName(input.patientEnglishFullName, input.patientArabicFullName),
    patientId: buildPatientId(input),
    patientBirthDate: normalizeDateForDicom(input.patientBirthDate),
    patientSex: normalizeSexForDicom(input.patientSex),
    scheduledProcedureStepSequence: [
      {
        modality: normalizeModalityForDicom(input.modalityCode),
        scheduledProcedureStepStartDate: normalizeDateForDicom(input.appointmentDate),
        scheduledProcedureStepDescription: buildSpsDescription(input),
      },
    ],
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
  const extended = dataset as CanonicalMwlDatasetWithOptionalIds;
  const sequenceLines = [
    extended.accessionNumber ? `(0008,0050) SH ${quoteDicomValue(extended.accessionNumber)}` : null,
    `(0008,0060) CS ${quoteDicomValue(sps.modality)}`,
    extended.scheduledStationAeTitle ? `(0040,0001) AE ${quoteDicomValue(extended.scheduledStationAeTitle)}` : null,
    extended.requestedProcedureId ? `(0040,0009) SH ${quoteDicomValue(extended.requestedProcedureId)}` : null,
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
  const extended = dataset as CanonicalMwlDatasetWithOptionalIds;

  return {
    SpecificCharacterSet: dataset.specificCharacterSet,
    PatientName: dataset.patientName,
    PatientID: dataset.patientId,
    PatientBirthDate: dataset.patientBirthDate,
    PatientSex: dataset.patientSex,
    ...(extended.accessionNumber ? { AccessionNumber: extended.accessionNumber } : {}),
    ...(extended.requestedProcedureId ? { RequestedProcedureID: extended.requestedProcedureId } : {}),
    ScheduledProcedureStepSequence: [
      {
        Modality: sps.modality,
        ...(extended.scheduledStationAeTitle ? { ScheduledStationAETitle: extended.scheduledStationAeTitle } : {}),
        ...(extended.requestedProcedureId ? { ScheduledProcedureStepID: extended.requestedProcedureId } : {}),
        ScheduledProcedureStepStartDate: sps.scheduledProcedureStepStartDate,
        ScheduledProcedureStepDescription: sps.scheduledProcedureStepDescription,
      },
    ],
  };
}
