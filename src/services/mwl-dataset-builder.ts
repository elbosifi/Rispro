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

export interface CanonicalMwlInput {
  modalityCode: string | null | undefined;
  appointmentDate: string | null | undefined;
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
  const mrn = normalizeOptionalText(input.patientMrn);
  if (mrn) return mrn;

  const nationalId = normalizeOptionalText(input.patientNationalId);
  if (nationalId) return nationalId;

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

  return [
    "# RISpro generated Modality Worklist source file",
    `(0008,0005) CS ${quoteDicomValue(dataset.specificCharacterSet)}`,
    `(0010,0010) PN ${quoteDicomValue(dataset.patientName)}`,
    `(0010,0020) LO ${quoteDicomValue(dataset.patientId)}`,
    `(0010,0030) DA ${quoteDicomValue(dataset.patientBirthDate)}`,
    `(0010,0040) CS ${quoteDicomValue(dataset.patientSex)}`,
    ...buildSequenceDump("(0040,0100)", [
      `(0008,0060) CS ${quoteDicomValue(sps.modality)}`,
      `(0040,0002) DA ${quoteDicomValue(sps.scheduledProcedureStepStartDate)}`,
      `(0040,0007) LO ${quoteDicomValue(sps.scheduledProcedureStepDescription)}`,
    ]),
  ].join("\n");
}

export function renderCanonicalMwlToOrthancJson(dataset: CanonicalMwlDataset): Record<string, unknown> {
  const sps = dataset.scheduledProcedureStepSequence[0];

  return {
    SpecificCharacterSet: dataset.specificCharacterSet,
    PatientName: dataset.patientName,
    PatientID: dataset.patientId,
    PatientBirthDate: dataset.patientBirthDate,
    PatientSex: dataset.patientSex,
    ScheduledProcedureStepSequence: [
      {
        Modality: sps.modality,
        ScheduledProcedureStepStartDate: sps.scheduledProcedureStepStartDate,
        ScheduledProcedureStepDescription: sps.scheduledProcedureStepDescription,
      },
    ],
  };
}
