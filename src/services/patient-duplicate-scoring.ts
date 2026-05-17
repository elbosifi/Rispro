import { normalizeArabicName } from "../utils/normalize.js";
import { normalizeIdentifierValue } from "../utils/identifier.js";

export type PatientDuplicateScoringRow = {
  national_id: string | null;
  identifier_value: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  normalized_arabic_name: string;
  age_years: number;
  estimated_date_of_birth: string | null;
  sex: string | null;
  phone_1: string | null;
};

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

function bestNameScore(a: PatientDuplicateScoringRow, b: PatientDuplicateScoringRow): number {
  const arabicA = normalizeArabicName(a.arabic_full_name || a.normalized_arabic_name || "");
  const arabicB = normalizeArabicName(b.arabic_full_name || b.normalized_arabic_name || "");
  const englishA = normalizeName(a.english_full_name);
  const englishB = normalizeName(b.english_full_name);
  return Math.max(stringSimilarity(arabicA, arabicB), stringSimilarity(englishA, englishB));
}

function normalizedIdentifier(row: PatientDuplicateScoringRow): string {
  return normalizeIdentifierValue(row.identifier_value || row.national_id || "");
}

export function scorePatientDuplicatePair(a: PatientDuplicateScoringRow, b: PatientDuplicateScoringRow): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const identifierA = normalizedIdentifier(a);
  const identifierB = normalizedIdentifier(b);
  const phoneA = normalizePhone(a.phone_1);
  const phoneB = normalizePhone(b.phone_1);
  const nameScore = bestNameScore(a, b);
  const dobA = a.estimated_date_of_birth ? String(a.estimated_date_of_birth).slice(0, 10) : "";
  const dobB = b.estimated_date_of_birth ? String(b.estimated_date_of_birth).slice(0, 10) : "";
  const sexA = normalizeName(a.sex);
  const sexB = normalizeName(b.sex);

  if (identifierA && identifierA === identifierB) {
    score += 100;
    reasons.push("identifier_match");
  }
  if (phoneA && phoneA === phoneB) {
    score += 80;
    reasons.push("phone_match");
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
  } else if (Number(a.age_years) > 0 && Number(a.age_years) === Number(b.age_years)) {
    score += 12;
    reasons.push("age_match");
  }
  if (sexA && sexA === sexB) {
    score += 8;
    reasons.push("sex_match");
  }

  return { score: Math.min(100, score), reasons };
}
