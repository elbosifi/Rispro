import { createHash } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { PoolClient } from "pg";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { normalizeIdentifierValue } from "../utils/identifier.js";
import { normalizeArabicName, normalizeArabicNameCompact } from "../utils/normalize.js";
import { HttpError } from "../utils/http-error.js";

export const PATIENT_IDENTITY_RULE_VERSION = "name_first_three_v1";
export const PATIENT_IDENTITY_PROOF_PURPOSE = "patient_identity_verification";
/** Fixed-width safe display prefix for primary identifiers. */
export const PATIENT_IDENTIFIER_MASK_PREFIX = "••••";
const PROOF_TTL_SECONDS = 12 * 60;

export type PatientIdentityVerificationMethod = "primary_identifier" | "exact_dob" | "phone_suffix";
export type PatientIdentityRisk = "none" | "ambiguous";

export interface PatientSelectionSafetyPatient {
  id: number;
  mrn: string | null;
  arabicFullName: string;
  englishFullName: string | null;
  category: "oncology" | "non_oncology" | null;
  sex: string | null;
  ageYears: number | null;
  estimatedDateOfBirth: string | null;
  demographicsEstimated: boolean;
  primaryIdentifierType: string | null;
  primaryIdentifierValue: string | null;
  phone1: string | null;
}

export interface PatientIdentityRiskResult {
  patient: PatientSelectionSafetyPatient;
  identityRisk: PatientIdentityRisk;
  similarPatientCount: number;
  availableVerificationMethods: PatientIdentityVerificationMethod[];
  identityFingerprint: string;
  ambiguityRuleVersion: typeof PATIENT_IDENTITY_RULE_VERSION;
}

export interface PatientIdentityVerificationAssertion {
  patientId: number;
  verifierUserId: number;
  verificationMethod: PatientIdentityVerificationMethod;
  verifiedAt: string;
  identityFingerprint: string;
  ambiguityRuleVersion: typeof PATIENT_IDENTITY_RULE_VERSION;
}

export type PatientIdentityVerificationStoredAssertion = Omit<PatientIdentityVerificationAssertion, "identityFingerprint">;

type PatientIdentityDbRow = {
  id: number;
  mrn: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  normalized_arabic_name: string | null;
  normalized_arabic_name_compact: string | null;
  category: "oncology" | "non_oncology" | null;
  sex: string | null;
  age_years: number | null;
  estimated_date_of_birth: string | null;
  demographics_estimated: boolean | null;
  phone_1: string | null;
  identifier_type: string | null;
  identifier_value: string | null;
};

type DbExecutor = Pick<PoolClient, "query">;

function normalizeEnglishName(value: string | null | undefined): string {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function nameKey(value: string): string {
  const tokens = value.split(" ").filter(Boolean);
  return tokens.length < 3 ? value : tokens.slice(0, 3).join(" ");
}

function compactNameKey(value: string): string {
  return nameKey(value).replace(/\s+/g, "");
}

function normalizedArabic(row: PatientIdentityDbRow): string {
  return normalizeArabicName(row.normalized_arabic_name || row.arabic_full_name || "");
}

function normalizedCompactArabic(row: PatientIdentityDbRow): string {
  return normalizeArabicNameCompact(row.normalized_arabic_name_compact || row.arabic_full_name || "");
}

function rowsAreAmbiguous(a: PatientIdentityDbRow, b: PatientIdentityDbRow): boolean {
  const arabicA = normalizedArabic(a);
  const arabicB = normalizedArabic(b);
  const englishA = normalizeEnglishName(a.english_full_name);
  const englishB = normalizeEnglishName(b.english_full_name);
  const arabicTokensA = arabicA.split(" ").filter(Boolean);
  const arabicTokensB = arabicB.split(" ").filter(Boolean);
  const compactA = compactNameKey(arabicA);
  const compactB = compactNameKey(arabicB);
  const compactSpacingMatch = arabicTokensA.length >= 3 && arabicTokensB.length >= 3 && (compactA === compactB || compactA.startsWith(compactB) || compactB.startsWith(compactA));
  const arabicMatch = Boolean(arabicA && arabicB && (nameKey(arabicA) === nameKey(arabicB) || compactSpacingMatch));
  const englishMatch = Boolean(englishA && englishB && nameKey(englishA) === nameKey(englishB));
  return arabicMatch || englishMatch;
}

export function patientNamesAreAmbiguous(input: { arabicA?: string | null; arabicB?: string | null; englishA?: string | null; englishB?: string | null }): boolean {
  return rowsAreAmbiguous(
    { id: 1, mrn: null, arabic_full_name: input.arabicA || "", english_full_name: input.englishA || null, normalized_arabic_name: input.arabicA || "", normalized_arabic_name_compact: input.arabicA || "", category: null, sex: null, age_years: null, estimated_date_of_birth: null, demographics_estimated: false, phone_1: null, identifier_type: null, identifier_value: null },
    { id: 2, mrn: null, arabic_full_name: input.arabicB || "", english_full_name: input.englishB || null, normalized_arabic_name: input.arabicB || "", normalized_arabic_name_compact: input.arabicB || "", category: null, sex: null, age_years: null, estimated_date_of_birth: null, demographics_estimated: false, phone_1: null, identifier_type: null, identifier_value: null },
  );
}

function toPatient(row: PatientIdentityDbRow): PatientSelectionSafetyPatient {
  return {
    id: Number(row.id), mrn: row.mrn, arabicFullName: row.arabic_full_name,
    englishFullName: row.english_full_name, category: row.category, sex: row.sex, ageYears: row.age_years == null ? null : Number(row.age_years),
    estimatedDateOfBirth: row.estimated_date_of_birth ? String(row.estimated_date_of_birth).slice(0, 10) : null,
    demographicsEstimated: Boolean(row.demographics_estimated),
    primaryIdentifierType: row.identifier_type,
    primaryIdentifierValue: row.identifier_value,
    phone1: row.phone_1,
  };
}

export function availablePatientIdentityVerificationMethods(patient: PatientSelectionSafetyPatient): PatientIdentityVerificationMethod[] {
  const methods: PatientIdentityVerificationMethod[] = [];
  if (normalizeIdentifierValue(patient.primaryIdentifierValue || "")) methods.push("primary_identifier");
  if (!patient.demographicsEstimated && patient.estimatedDateOfBirth) methods.push("exact_dob");
  if (String(patient.phone1 || "").replace(/\D/g, "").length >= 4) methods.push("phone_suffix");
  return methods;
}

export function calculatePatientIdentityFingerprint(patient: PatientSelectionSafetyPatient): string {
  const canonical = JSON.stringify({
    patientId: patient.id,
    arabicName: normalizeArabicName(patient.arabicFullName),
    compactArabicName: normalizeArabicNameCompact(patient.arabicFullName),
    englishName: normalizeEnglishName(patient.englishFullName),
    primaryIdentifierType: String(patient.primaryIdentifierType || "").trim().toLowerCase(),
    primaryIdentifierValue: normalizeIdentifierValue(patient.primaryIdentifierValue || ""),
    exactDob: patient.demographicsEstimated ? "" : patient.estimatedDateOfBirth || "",
    demographicsEstimated: patient.demographicsEstimated,
    phone1: String(patient.phone1 || "").replace(/\D/g, ""),
    sex: String(patient.sex || "").trim().toUpperCase(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

const PATIENT_SELECTION_COLUMNS = `
  select p.id, p.mrn, p.arabic_full_name, p.english_full_name, p.normalized_arabic_name,
    p.normalized_arabic_name_compact, p.category, p.sex, p.age_years, p.estimated_date_of_birth::text,
    p.demographics_estimated, p.phone_1,
    coalesce(primary_identifier.identifier_type, p.identifier_type) as identifier_type,
    coalesce(primary_identifier.identifier_value, p.identifier_value, p.national_id) as identifier_value
  from patients p
  left join lateral (
    select pit.code as identifier_type, pi.value as identifier_value
    from patient_identifiers pi join patient_identifier_types pit on pit.id = pi.identifier_type_id
    where pi.patient_id = p.id order by pi.is_primary desc, pi.id asc limit 1
  ) primary_identifier on true
`;

async function loadRequestedRows(executor: DbExecutor, patientIds: number[]): Promise<PatientIdentityDbRow[]> {
  const { rows } = await executor.query<PatientIdentityDbRow>(`
    ${PATIENT_SELECTION_COLUMNS}
    where p.id = any($1::bigint[])
    order by p.id asc
  `, [patientIds]);
  return rows;
}

function buildCandidatePredicate(targets: PatientIdentityDbRow[]): { sql: string; values: string[] } {
  const values: string[] = [];
  const bind = (value: string) => {
    values.push(value);
    return `$${values.length + 1}`;
  };
  const arabicExpression = "p.normalized_arabic_name";
  const compactArabicExpression = "p.normalized_arabic_name_compact";
  const englishExpression = "lower(regexp_replace(coalesce(p.english_full_name, ''), '\\s+', ' ', 'g'))";
  const clauses: string[] = [];

  for (const target of targets) {
    const arabic = normalizedArabic(target);
    const arabicTokens = arabic.split(" ").filter(Boolean);
    const english = normalizeEnglishName(target.english_full_name);
    const targetClauses: string[] = [];

    if (arabic) {
      const arabicKey = nameKey(arabic);
      if (arabicTokens.length < 3) {
        targetClauses.push(`${arabicExpression} = ${bind(arabicKey)}`);
      } else {
        targetClauses.push(`(${arabicExpression} = ${bind(arabicKey)} or ${arabicExpression} like ${bind(`${arabicKey} %`)})`);
        const compactKey = compactNameKey(arabic);
        targetClauses.push(`(
          cardinality(regexp_split_to_array(trim(${arabicExpression}), '\\s+')) >= 3
          and (${compactArabicExpression} = ${bind(compactKey)} or ${compactArabicExpression} like ${bind(`${compactKey}%`)} or ${bind(compactKey)} like ${compactArabicExpression} || '%')
        )`);
      }
    }

    if (english) {
      const englishTokens = english.split(" ").filter(Boolean);
      const englishKey = nameKey(english);
      targetClauses.push(englishTokens.length < 3
        ? `${englishExpression} = ${bind(englishKey)}`
        : `(${englishExpression} = ${bind(englishKey)} or ${englishExpression} like ${bind(`${englishKey} %`)})`);
    }

    if (targetClauses.length > 0) clauses.push(`(${targetClauses.join(" or ")})`);
  }

  return { sql: clauses.length > 0 ? clauses.join(" or ") : "false", values };
}

async function loadAmbiguityCandidateRows(executor: DbExecutor, patientIds: number[], targets: PatientIdentityDbRow[]): Promise<PatientIdentityDbRow[]> {
  const predicate = buildCandidatePredicate(targets);
  const { rows } = await executor.query<PatientIdentityDbRow>(`
    ${PATIENT_SELECTION_COLUMNS}
    where p.id = any($1::bigint[]) or (${predicate.sql})
    order by p.id asc
  `, [patientIds, ...predicate.values]);
  return rows;
}

function resolvePatientIdentityRiskFromRows(patientId: number, rows: PatientIdentityDbRow[]): PatientIdentityRiskResult {
  const target = rows.find((row) => Number(row.id) === patientId);
  if (!target) throw new HttpError(404, "Patient not found.", { code: "patient_not_found" });
  const patient = toPatient(target);
  const similarPatientCount = rows.filter((row) => Number(row.id) !== patientId && rowsAreAmbiguous(target, row)).length;
  return {
    patient,
    identityRisk: similarPatientCount > 0 ? "ambiguous" : "none",
    similarPatientCount,
    availableVerificationMethods: availablePatientIdentityVerificationMethods(patient),
    identityFingerprint: calculatePatientIdentityFingerprint(patient),
    ambiguityRuleVersion: PATIENT_IDENTITY_RULE_VERSION,
  };
}

export async function resolvePatientIdentityRisks(patientIds: number[], executor: DbExecutor = pool): Promise<Map<number, PatientIdentityRiskResult>> {
  const uniquePatientIds = [...new Set(patientIds.filter((patientId) => Number.isInteger(patientId) && patientId > 0))];
  if (uniquePatientIds.length === 0) return new Map();
  const targets = await loadRequestedRows(executor, uniquePatientIds);
  const candidates = await loadAmbiguityCandidateRows(executor, uniquePatientIds, targets);
  return new Map(uniquePatientIds.map((patientId) => [patientId, resolvePatientIdentityRiskFromRows(patientId, candidates)]));
}

export async function resolvePatientIdentityRisk(patientId: number, executor: DbExecutor = pool): Promise<PatientIdentityRiskResult> {
  const risks = await resolvePatientIdentityRisks([patientId], executor);
  const risk = risks.get(patientId);
  if (!risk) throw new HttpError(404, "Patient not found.", { code: "patient_not_found" });
  return risk;
}

function normalizeMethod(value: unknown): PatientIdentityVerificationMethod {
  if (value === "primary_identifier" || value === "exact_dob" || value === "phone_suffix") return value;
  throw new HttpError(422, "Identity verification method is unavailable.", { code: "patient_identity_verification_method_unavailable" });
}

function evidenceMatches(patient: PatientSelectionSafetyPatient, method: PatientIdentityVerificationMethod, evidence: unknown): boolean {
  const raw = String(evidence || "").trim();
  if (method === "primary_identifier") return Boolean(raw) && normalizeIdentifierValue(raw) === normalizeIdentifierValue(patient.primaryIdentifierValue || "");
  if (method === "exact_dob") return raw === patient.estimatedDateOfBirth && !patient.demographicsEstimated;
  const phone = String(patient.phone1 || "").replace(/\D/g, "");
  const suffix = raw.replace(/\D/g, "");
  return suffix.length === 4 && phone.endsWith(suffix);
}

export function issuePatientIdentityVerificationProof(assertion: PatientIdentityVerificationAssertion): string {
  return jwt.sign({ purpose: PATIENT_IDENTITY_PROOF_PURPOSE, ...assertion }, env.jwtSecret, { algorithm: "HS256", expiresIn: PROOF_TTL_SECONDS });
}

export async function verifyPatientIdentityEvidence(input: { patientId: number; userId: number; method: unknown; evidence: unknown; executor?: DbExecutor }): Promise<{ proof: string; assertion: PatientIdentityVerificationAssertion; risk: PatientIdentityRiskResult }> {
  const risk = await resolvePatientIdentityRisk(input.patientId, input.executor ?? pool);
  const method = normalizeMethod(input.method);
  if (risk.identityRisk !== "ambiguous") throw new HttpError(422, "Patient identity verification is not required.", { code: "patient_identity_verification_method_unavailable" });
  if (!risk.availableVerificationMethods.includes(method)) throw new HttpError(422, "Identity verification method is unavailable.", { code: "patient_identity_verification_method_unavailable" });
  if (!evidenceMatches(risk.patient, method, input.evidence)) throw new HttpError(422, "Patient identity verification is incorrect.", { code: "patient_identity_verification_incorrect" });
  const assertion: PatientIdentityVerificationAssertion = {
    patientId: input.patientId, verifierUserId: input.userId, verificationMethod: method,
    verifiedAt: new Date().toISOString(), identityFingerprint: risk.identityFingerprint,
    ambiguityRuleVersion: PATIENT_IDENTITY_RULE_VERSION,
  };
  return { proof: issuePatientIdentityVerificationProof(assertion), assertion, risk };
}

export function validatePatientIdentityVerificationProof(proof: string | null | undefined, input: { patientId: number; userId: number; risk: PatientIdentityRiskResult }): PatientIdentityVerificationAssertion {
  if (!proof) throw new HttpError(422, "Patient identity verification is required.", { code: "patient_identity_verification_required" });
  try {
    const decoded = jwt.verify(proof, env.jwtSecret, { algorithms: ["HS256"] });
    if (!decoded || typeof decoded === "string") throw new Error("invalid proof");
    const payload = decoded as JwtPayload & Partial<PatientIdentityVerificationAssertion> & { purpose?: unknown };
    if (payload.purpose !== PATIENT_IDENTITY_PROOF_PURPOSE || Number(payload.patientId) !== input.patientId || Number(payload.verifierUserId) !== input.userId || payload.ambiguityRuleVersion !== PATIENT_IDENTITY_RULE_VERSION || payload.identityFingerprint !== input.risk.identityFingerprint || !normalizeMethod(payload.verificationMethod)) throw new Error("invalid proof");
    return { patientId: input.patientId, verifierUserId: input.userId, verificationMethod: payload.verificationMethod as PatientIdentityVerificationMethod, verifiedAt: String(payload.verifiedAt || ""), identityFingerprint: input.risk.identityFingerprint, ambiguityRuleVersion: PATIENT_IDENTITY_RULE_VERSION };
  } catch {
    throw new HttpError(422, "Patient identity verification is required again.", { code: "patient_identity_reverification_required" });
  }
}

export function revalidateStoredPatientIdentityAssertion(
  assertion: PatientIdentityVerificationStoredAssertion | null | undefined,
  input: { patientId: number; verifierUserId: number; expectedIdentityFingerprint: string | null | undefined; risk: PatientIdentityRiskResult }
): PatientIdentityVerificationAssertion {
  if (
    !assertion
    || assertion.patientId !== input.patientId
    || assertion.verifierUserId !== input.verifierUserId
    || assertion.ambiguityRuleVersion !== PATIENT_IDENTITY_RULE_VERSION
    || input.expectedIdentityFingerprint !== input.risk.identityFingerprint
  ) {
    throw new HttpError(422, "Patient identity verification is required again.", { code: "patient_identity_reverification_required" });
  }
  return { ...assertion, identityFingerprint: input.risk.identityFingerprint };
}

export function maskPatientIdentifier(value: string | null): string | null {
  const clean = String(value || "").trim();
  // Never reveal more than the final four characters; short values reveal none.
  return clean.length >= 4 ? `${PATIENT_IDENTIFIER_MASK_PREFIX}${clean.slice(-4)}` : clean ? PATIENT_IDENTIFIER_MASK_PREFIX : null;
}

export function maskPatientPhone(value: string | null): string | null {
  const clean = String(value || "").replace(/\D/g, "");
  return clean.length >= 4 ? `••••••${clean.slice(-4)}` : null;
}
