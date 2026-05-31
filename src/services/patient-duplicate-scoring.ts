import { normalizeArabicName, normalizeArabicNameCompact } from "../utils/normalize.js";
import { normalizeIdentifierValue } from "../utils/identifier.js";

export type PatientDuplicateScoringRow = {
  national_id: string | null;
  identifier_type?: string | null;
  identifier_value: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  normalized_arabic_name: string;
  normalized_arabic_name_compact?: string | null;
  age_years: number;
  estimated_date_of_birth: string | null;
  sex: string | null;
  phone_1: string | null;
  category?: "oncology" | "non_oncology" | null;
};

export type PatientDuplicateSignalStatus = "match" | "similar" | "mismatch" | "info";

export interface PatientDuplicateSignal {
  field: string;
  label: string;
  status: PatientDuplicateSignalStatus;
  score?: number;
}

export interface PatientDuplicateConflict {
  field: string;
  patientAValue: string | null;
  patientBValue: string | null;
}

function normalizePhone(value: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeName(value: string | null): string {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }

  return previous[b.length]!;
}

function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return Math.round((1 - distance / Math.max(a.length, b.length)) * 100);
}

function nameScores(a: PatientDuplicateScoringRow, b: PatientDuplicateScoringRow): { arabic: number; compactArabic: number; english: number; combined: number } {
  const arabicA = normalizeArabicName(a.arabic_full_name || a.normalized_arabic_name || "");
  const arabicB = normalizeArabicName(b.arabic_full_name || b.normalized_arabic_name || "");
  const compactArabicA = a.normalized_arabic_name_compact || normalizeArabicNameCompact(a.arabic_full_name || a.normalized_arabic_name || "");
  const compactArabicB = b.normalized_arabic_name_compact || normalizeArabicNameCompact(b.arabic_full_name || b.normalized_arabic_name || "");
  const englishA = normalizeName(a.english_full_name);
  const englishB = normalizeName(b.english_full_name);
  const arabic = stringSimilarity(arabicA, arabicB);
  const compactArabic = stringSimilarity(compactArabicA, compactArabicB);
  const english = stringSimilarity(englishA, englishB);
  return { arabic, compactArabic, english, combined: Math.max(arabic, compactArabic, english) };
}

function normalizedIdentifier(row: PatientDuplicateScoringRow): string {
  return normalizeIdentifierValue(row.identifier_value || row.national_id || "");
}

function addConflict(conflicts: PatientDuplicateConflict[], field: string, patientAValue: string | null | undefined, patientBValue: string | null | undefined) {
  const aValue = String(patientAValue || "").trim();
  const bValue = String(patientBValue || "").trim();
  if (aValue && bValue && aValue.toLowerCase() !== bValue.toLowerCase()) {
    conflicts.push({ field, patientAValue: aValue, patientBValue: bValue });
  }
}

export function scorePatientDuplicatePair(a: PatientDuplicateScoringRow, b: PatientDuplicateScoringRow): {
  score: number;
  reasons: string[];
  signals: PatientDuplicateSignal[];
  conflicts: PatientDuplicateConflict[];
} {
  let score = 0;
  const reasons: string[] = [];
  const signals: PatientDuplicateSignal[] = [];
  const conflicts: PatientDuplicateConflict[] = [];
  const identifierA = normalizedIdentifier(a);
  const identifierB = normalizedIdentifier(b);
  const phoneA = normalizePhone(a.phone_1);
  const phoneB = normalizePhone(b.phone_1);
  const names = nameScores(a, b);
  const nameScore = names.combined;
  const dobA = a.estimated_date_of_birth ? String(a.estimated_date_of_birth).slice(0, 10) : "";
  const dobB = b.estimated_date_of_birth ? String(b.estimated_date_of_birth).slice(0, 10) : "";
  const sexA = normalizeName(a.sex);
  const sexB = normalizeName(b.sex);

  if (identifierA && identifierA === identifierB) {
    score += 100;
    reasons.push("identifier_match");
    signals.push({ field: "identifier", label: "Identifier exact", status: "match" });
  }
  if (phoneA && phoneA === phoneB) {
    score += 80;
    reasons.push("phone_match");
    signals.push({ field: "phone", label: "Phone exact", status: "match" });
  }
  if (names.arabic > 0) {
    signals.push({ field: "arabic_name", label: `Arabic name ${names.arabic}%`, status: names.arabic >= 92 ? "match" : names.arabic >= 82 ? "similar" : "info", score: names.arabic });
  }
  if (names.compactArabic > 0 && names.compactArabic > names.arabic) {
    signals.push({ field: "arabic_name_compact", label: `Compact Arabic name ${names.compactArabic}%`, status: names.compactArabic >= 92 ? "match" : names.compactArabic >= 82 ? "similar" : "info", score: names.compactArabic });
  }
  if (names.english > 0) {
    signals.push({ field: "english_name", label: `English name ${names.english}%`, status: names.english >= 92 ? "match" : names.english >= 82 ? "similar" : "info", score: names.english });
  }
  if (nameScore >= 92) {
    score += 55;
    reasons.push("name_match");
  } else if (nameScore >= 82) {
    score += 40;
    reasons.push("similar_name");
  }
  if (dobA && dobA === dobB) {
    score += 25;
    reasons.push("date_of_birth_match");
    signals.push({ field: "date_of_birth", label: "DOB exact", status: "match" });
  } else if (Number(a.age_years) > 0 && Number(a.age_years) === Number(b.age_years)) {
    score += 12;
    reasons.push("age_match");
    signals.push({ field: "age", label: "Age exact", status: "match" });
  }
  if (sexA && sexA === sexB) {
    score += 8;
    reasons.push("sex_match");
    signals.push({ field: "sex", label: "Sex match", status: "match" });
  }
  if (a.category && b.category && a.category === b.category) {
    score += 5;
    reasons.push("category_match");
    signals.push({ field: "category", label: "Category match", status: "match" });
  }

  addConflict(conflicts, "identifier", identifierA, identifierB);
  addConflict(conflicts, "national_id", a.national_id, b.national_id);
  addConflict(conflicts, "date_of_birth", dobA, dobB);
  addConflict(conflicts, "sex", sexA, sexB);

  for (const conflict of conflicts) {
    signals.push({ field: conflict.field, label: `${conflict.field.replace(/_/g, " ")} mismatch`, status: "mismatch" });
  }

  return { score: Math.min(100, score), reasons, signals, conflicts };
}
