import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import {
  normalizePositiveInteger,
  buildEstimatedDobFromAge,
  formatDateForSql,
  normalizeArabicName,
  normalizeArabicNameCompact,
  normalizeLibyanPhone
} from "../utils/normalize.js";
import { validateIsoDate } from "../utils/date.js";
import { getCached, setCached } from "../utils/cache.js";
import { logAuditEntry } from "./audit-service.js";
import {
  findBlockedArabicNameWord,
  listPatientNotAllowedNameWords,
  type PatientNotAllowedNameWordRow
} from "./patient-not-allowed-name-words-service.js";
import { generateEnglishFromDictionary, NameDictionaryLookup } from "../utils/name-generation.js";
import {
  isValidNationalId,
  deriveSexFromNationalId,
  deriveDobFromNationalId,
  calculateAgeFromDob
} from "../utils/national-id.js";
import { ensureIdentifierValue, normalizeIdentifierValue } from "../utils/identifier.js";
import { scheduleBookingWorklistDetailReplacement } from "./dicom-service.js";
import type { UserId, OptionalUserId, UnknownRecord } from "../types/http.js";
import type { NullableDbNumeric } from "../types/db.js";
import type { CategorySettings } from "../types/settings.js";
import type { Role } from "../types/domain.js";
import type { PoolClient } from "pg";
import {
  authorizeNoShowBookingRestriction,
  getPatientNoShowRestriction,
  type PatientNoShowRestriction
} from "./patient-no-show-restriction-service.js";
import {
  loadPatientNameDictionary,
  PATIENT_SEARCH_CANDIDATE_IDS_CTE,
  PATIENT_SEARCH_MATCH_SQL,
  PATIENT_SEARCH_PHONETIC_LATERALS,
  PATIENT_SEARCH_RANK_SQL,
  PATIENT_SEARCH_SIMILARITY_SQL,
  preparePatientSearch,
} from "./patient-search-query.js";
export {
  getPatientDirectory,
  type PatientDirectoryParams,
  type PatientDirectoryResult,
  type PatientDirectoryRowOutput,
} from "./patient-directory-service.js";

export interface PatientRegistrationRules {
  nationalIdRule: string;
  phoneRule: string;
  dobRule: string;
  mrnPrefix: string;
}

const PATIENT_IDENTIFIER_REQUIRED_MESSAGE =
  "Primary identifier is required. Enter a National ID, passport number, or other identifier before saving this patient.";

type LegacyPatientIdentifierType = "national_id" | "passport" | "other";

function toLegacyPatientIdentifierType(typeCode: string): LegacyPatientIdentifierType {
  return typeCode === "national_id" || typeCode === "passport" || typeCode === "other" ? typeCode : "other";
}

export interface PatientRow {
  id: number;
  mrn: string | null;
  national_id: string | null;
  identifier_type: string | null;
  identifier_value: string | null;
  category: "oncology" | "non_oncology" | null;
  identifiers?: Array<{
    id: number;
    type_id: number;
    type_code: string;
    value: string;
    normalized_value: string;
    is_primary: boolean;
  }>;
  arabic_full_name: string;
  english_full_name: string | null;
  age_years: number;
  demographics_estimated: boolean;
  sex: string | null;
  phone_1: string | null;
  phone_2: string | null;
  address: string | null;
  estimated_date_of_birth: string | null;
  created_at?: string | Date | null;
  created_by_user_id?: number | null;
  created_by_full_name?: string | null;
  created_by_username?: string | null;
}

export interface PatientPayload {
  nationalId?: unknown;
  nationalIdConfirmation?: unknown;
  identifierType?: string;
  identifierValue?: unknown;
  category?: unknown;
  arabicFullName?: string;
  englishFullName?: string;
  ageYears?: number;
  demographicsEstimated?: unknown;
  estimatedDateOfBirth?: string;
  sex?: string;
  phone1?: unknown;
  phone2?: unknown;
  address?: unknown;
  autoGenerateEnglish?: boolean;
  identifiers?: unknown;
}

export interface MergePatientsPayload {
  targetPatientId?: UserId;
  sourcePatientId?: UserId;
  confirmationText?: string;
}

export interface ValidatedPatientPayload {
  cleanNationalId: string | null;
  identifierType: string;
  cleanIdentifierValue: string | null;
  category: "oncology" | "non_oncology" | null;
  arabicFullName: string;
  englishFullName: string;
  normalizedArabicName: string;
  normalizedArabicNameCompact: string;
  parsedAge: number;
  demographicsEstimated: boolean;
  estimatedDob: string | null;
  sex: string;
  cleanPhone1: string;
  cleanPhone2: string;
  address: string;
}

interface PatientSettingRow {
  setting_key: string;
  setting_value?: unknown;
}

interface PatientNoShowSummaryRow {
  no_show_count?: NullableDbNumeric;
  last_no_show_date?: string | null;
}

interface IdentifierTypeRow {
  id: number;
  code: string;
}

interface PatientIdentifierInput {
  typeId?: unknown;
  typeCode?: unknown;
  value?: unknown;
  isPrimary?: unknown;
}

export interface PatientIdentifierTypeOption {
  code: string;
  label_ar: string;
  label_en: string;
}

export type PersistedPatientRow = PatientRow & { id: UserId };

function validateNationalIdField(
  nationalId: unknown,
  nationalIdConfirmation: unknown,
  identifierType: string,
  identifierValue: unknown,
  rule: string
): { nationalId: string | null; identifierValue: string | null } {
  // For national_id type
  if (identifierType === 'national_id' || (!identifierType && nationalId)) {
    const cleanId = String(nationalId || identifierValue || '').replace(/\D/g, '');
    const cleanConfirmation = String(nationalIdConfirmation || '').replace(/\D/g, '');
    const hasAny = cleanId.length > 0 || cleanConfirmation.length > 0;

    if (rule === "optional") {
      if (!hasAny) {
        return { nationalId: "", identifierValue: "" };
      }

      if (cleanId.length !== 12) {
        throw new HttpError(400, "National ID must contain exactly 12 digits.");
      }

      if (cleanConfirmation && cleanId !== cleanConfirmation) {
        throw new HttpError(400, "National ID confirmation does not match.");
      }

      return { nationalId: cleanId, identifierValue: cleanId };
    }

    if (cleanId.length === 0) {
      throw new HttpError(400, PATIENT_IDENTIFIER_REQUIRED_MESSAGE);
    }

    if (cleanId.length !== 12) {
      throw new HttpError(400, "National ID must contain exactly 12 digits.");
    }

    if (cleanConfirmation && cleanId !== cleanConfirmation) {
      throw new HttpError(400, "National ID confirmation does not match.");
    }

    return { nationalId: cleanId, identifierValue: cleanId };
  }

  // For passport or other types, just validate the identifier_value
  const cleanValue = String(identifierValue || '').trim();
  if (rule !== "optional" && !cleanValue) {
    throw new HttpError(400, PATIENT_IDENTIFIER_REQUIRED_MESSAGE);
  }
  return { nationalId: null, identifierValue: cleanValue || null };
}

function validatePhone(phone: unknown, fieldName: string, { required }: { required: boolean }): string {
  const normalized = normalizeLibyanPhone(String(phone || ""));

  if (!normalized && !required) {
    return "";
  }

  if (!normalized && fieldName !== "phone1") {
    return "";
  }

  if (!normalized && fieldName === "phone1") {
    throw new HttpError(400, "phone1 is required.");
  }

  if (normalized.length !== 10) {
    throw new HttpError(400, `${fieldName} must contain exactly 10 digits.`);
  }

  return normalized;
}

function normalizeDateString(value: unknown, fieldName: string): string {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  return validateIsoDate(raw, fieldName);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "") return false;
  return false;
}

function normalizePatientCategory(value: unknown): "oncology" | "non_oncology" | null {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw === "oncology" || raw === "non_oncology") {
    return raw;
  }

  throw new HttpError(400, "category must be one of: oncology, non_oncology.");
}

function calculateAgeYearsFromDob(dob: string): number | null {
  const parsed = new Date(`${dob}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - parsed.getUTCMonth();
  const dayDiff = today.getUTCDate() - parsed.getUTCDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  if (!Number.isInteger(age) || age < 0 || age > 130) {
    return null;
  }

  return age;
}

async function loadPatientRegistrationSettings(): Promise<PatientRegistrationRules> {
  const cacheKey = "patient_registration_settings";
  const cached = getCached<PatientRegistrationRules>(cacheKey);
  
  if (cached) {
    return cached;
  }
  
  const { rows } = await pool.query<PatientSettingRow>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'patient_registration'
    `
  );

  const settings = rows.reduce<CategorySettings>((accumulator, row) => {
    const raw = row.setting_value;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      accumulator[row.setting_key] = String((raw as { value?: unknown }).value ?? "");
    } else {
      accumulator[row.setting_key] = String(raw ?? "");
    }
    return accumulator;
  }, {});

  const result: PatientRegistrationRules = {
    nationalIdRule: settings.national_id_required || "required_with_confirmation",
    phoneRule: settings.phone1_required || "required",
    dobRule: settings.dob_or_age_rule || "age_or_dob_required",
    mrnPrefix: String(settings.mrn_prefix || "").trim()
  };
  
  setCached(cacheKey, result, 5 * 60 * 1000); // 5 minutes
  return result;
}

function formatPatientMrn(sequenceValue: number, prefix: string): string {
  const numericPart = String(sequenceValue).padStart(6, "0");
  return `${prefix}${numericPart}`;
}

async function readPatientMrnSequencePreview(client: { query: PoolClient["query"] }): Promise<number> {
  try {
    const { rows } = await client.query<{ last_value: string | number; is_called: boolean; increment_by: string | number }>(
      `
        select last_value, is_called, increment_by
        from patient_mrn_seq
      `
    );

    const row = rows[0];
    if (!row) {
      throw new HttpError(500, "Unable to read patient MRN sequence.");
    }

    const lastValue = Number(row.last_value);
    const incrementBy = Number(row.increment_by || 1);
    if (!Number.isFinite(lastValue) || !Number.isFinite(incrementBy) || incrementBy <= 0) {
      throw new HttpError(500, "Invalid patient MRN sequence state.");
    }

    return row.is_called ? lastValue + incrementBy : lastValue;
  } catch {
    const { rows } = await client.query<{ next_mrn: string | number | null }>(
      `
        select coalesce(max((mrn)::bigint), 0) + 1 as next_mrn
        from patients
        where mrn ~ '^[0-9]+$'
      `
    );

    const fallback = Number(rows[0]?.next_mrn ?? 1);
    if (!Number.isFinite(fallback) || fallback <= 0) {
      throw new HttpError(500, "Unable to determine next patient MRN.");
    }

    return fallback;
  }
}

async function allocateNextPatientMrn(client: PoolClient, prefix: string): Promise<string> {
  const { rows } = await client.query<{ next_value: string | number }>(
    `
      select nextval('patient_mrn_seq') as next_value
    `
  );

  const row = rows[0];
  const nextValue = Number(row?.next_value);
  if (!Number.isFinite(nextValue) || nextValue <= 0) {
    throw new HttpError(500, "Unable to allocate patient MRN.");
  }

  return formatPatientMrn(nextValue, prefix);
}

export async function previewNextPatientMrn(client?: { query: PoolClient["query"] }): Promise<string> {
  const rules = await loadPatientRegistrationSettings();
  const sequenceValue = await readPatientMrnSequencePreview(client ?? pool);
  return formatPatientMrn(sequenceValue, rules.mrnPrefix);
}

async function validatePatientPayload(
  payload: PatientPayload,
  rules: PatientRegistrationRules,
  dictionary: NameDictionaryLookup[],
  notAllowedNameWords: PatientNotAllowedNameWordRow[] = []
): Promise<ValidatedPatientPayload> {
  const {
    nationalId,
    nationalIdConfirmation,
    identifierType,
    identifierValue,
    category,
    arabicFullName,
    englishFullName,
    ageYears,
    demographicsEstimated = false,
    estimatedDateOfBirth,
    sex,
    phone1,
    phone2 = "",
    address = "",
    autoGenerateEnglish = false
  } = payload;

  if (!arabicFullName) {
    throw new HttpError(400, "arabicFullName is required.");
  }

  const blockedWord = findBlockedArabicNameWord(arabicFullName, notAllowedNameWords);
  if (blockedWord) {
    throw new HttpError(400, `Arabic name contains a not-allowed word: ${blockedWord}`);
  }

  const resolvedIdentifierType = identifierType || 'national_id';
  const { nationalId: cleanNationalId, identifierValue: cleanIdentifierValue } = validateNationalIdField(
    nationalId, nationalIdConfirmation, resolvedIdentifierType, identifierValue, rules.nationalIdRule
  );
  const cleanPhone1 = validatePhone(phone1, "phone1", { required: rules.phoneRule !== "optional" });
  const cleanPhone2 = validatePhone(phone2, "phone2", { required: false });
  const cleanDemographicsEstimated = normalizeBoolean(demographicsEstimated);
  const dobValue = normalizeDateString(estimatedDateOfBirth, "estimatedDateOfBirth");
  const hasDob = Boolean(dobValue);
  const hasAgeValue = String(ageYears ?? "").trim() !== "";
  const parsedAge = hasAgeValue ? Number(ageYears) : null;

  if (!hasDob && hasAgeValue && (parsedAge === null || !Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 130)) {
    throw new HttpError(400, "ageYears must be a whole number between 0 and 130.");
  }

  if (rules.dobRule === "age_required" && !hasDob && !hasAgeValue) {
    throw new HttpError(400, "ageYears is required.");
  }

  if (rules.dobRule === "dob_required" && !hasDob) {
    throw new HttpError(400, "estimatedDateOfBirth is required.");
  }

  if (rules.dobRule === "age_or_dob_required" && !hasDob && !hasAgeValue) {
    throw new HttpError(400, "ageYears or estimatedDateOfBirth is required.");
  }

  // Auto-derive sex/DOB/age from national ID if applicable
  let resolvedSex = sex;
  let resolvedDob = dobValue;
  let resolvedAge = parsedAge;

  if (resolvedIdentifierType === 'national_id' && cleanNationalId && isValidNationalId(cleanNationalId)) {
    const derivedSex = deriveSexFromNationalId(cleanNationalId);
    const derivedDob = deriveDobFromNationalId(cleanNationalId);

    // Only auto-derive if not explicitly provided
    if (!resolvedSex && derivedSex) {
      resolvedSex = derivedSex;
    }
    if (!resolvedDob && derivedDob) {
      resolvedDob = derivedDob;
      const derivedAge = calculateAgeFromDob(derivedDob);
      if (derivedAge !== null && !hasAgeValue) {
        resolvedAge = derivedAge;
      }
    }
  }

  if (!resolvedSex) {
    throw new HttpError(400, "sex is required.");
  }

  let finalAge = resolvedAge;
  let finalDob = resolvedDob;

  if (hasDob) {
    finalDob = dobValue;
    finalAge = calculateAgeFromDob(dobValue);
  } else if (hasAgeValue) {
    finalAge = parsedAge;
  }

  if (finalAge === null || finalAge === undefined) {
    throw new HttpError(400, "ageYears is required when DOB cannot be calculated.");
  }

  // Auto-generate English name from dictionary
  let finalEnglishName = String(englishFullName || "").trim();
  if (autoGenerateEnglish && !englishFullName) {
    const generated = generateEnglishFromDictionary(arabicFullName, dictionary);
    if (generated.missingTokens.length > 0) {
      throw new HttpError(
        400,
        `Cannot auto-generate English name. Unresolved Arabic token(s): ${generated.missingTokens.join(", ")}.`
      );
    }
    finalEnglishName = generated.englishName;
  }

  return {
    cleanNationalId,
    identifierType: resolvedIdentifierType,
    cleanIdentifierValue: cleanIdentifierValue,
    category: normalizePatientCategory(category),
    arabicFullName: arabicFullName.trim(),
    englishFullName: finalEnglishName,
    normalizedArabicName: normalizeArabicName(arabicFullName),
    normalizedArabicNameCompact: normalizeArabicNameCompact(arabicFullName),
    parsedAge: finalAge,
    demographicsEstimated: cleanDemographicsEstimated,
    estimatedDob: finalDob || formatDateForSql(buildEstimatedDobFromAge(finalAge)),
    sex: resolvedSex,
    cleanPhone1,
    cleanPhone2,
    address: String(address).trim()
  };
}

export async function getPatientById(patientId: UserId): Promise<PatientRow> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const { rows } = await pool.query<PatientRow>(
    `
      select
        p.id,
        p.mrn,
        case
          when coalesce(primary_identifier.identifier_type, p.identifier_type) = 'national_id'
            then coalesce(primary_identifier.identifier_value, p.identifier_value, p.national_id)
          else null
        end as national_id,
        coalesce(primary_identifier.identifier_type, p.identifier_type) as identifier_type,
        coalesce(primary_identifier.identifier_value, p.identifier_value) as identifier_value,
        p.category,
        p.arabic_full_name,
        p.english_full_name,
        p.age_years,
        p.demographics_estimated,
        p.sex,
        p.phone_1,
        p.phone_2,
        p.address,
        p.estimated_date_of_birth,
        p.created_at,
        p.created_by_user_id,
        created_by_user.full_name as created_by_full_name,
        created_by_user.username as created_by_username,
        (
          select coalesce(json_agg(json_build_object(
            'id', pi.id,
            'type_id', pit.id,
            'type_code', pit.code,
            'value', pi.value,
            'normalized_value', pi.normalized_value,
            'is_primary', pi.is_primary
          ) order by pi.is_primary desc, pi.id asc), '[]'::json)
          from patient_identifiers pi
          join patient_identifier_types pit on pit.id = pi.identifier_type_id
          where pi.patient_id = p.id
        ) as identifiers
      from patients p
      left join lateral (
        select
          pit.code as identifier_type,
          pi.value as identifier_value
        from patient_identifiers pi
        join patient_identifier_types pit on pit.id = pi.identifier_type_id
        where pi.patient_id = p.id
        order by pi.is_primary desc, pi.id asc
        limit 1
      ) as primary_identifier on true
      left join users created_by_user on created_by_user.id = p.created_by_user_id
      where p.id = $1
      limit 1
    `,
    [cleanPatientId]
  );

  const patient = rows[0];

  if (!patient) {
    throw new HttpError(404, "Patient not found.");
  }

  return patient;
}

export async function getPatientNoShowSummary(patientId: UserId): Promise<PatientNoShowRestriction & { lastNoShowDate: string | null }> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const summary = await getPatientNoShowRestriction(cleanPatientId);
  return {
    ...summary,
    lastNoShowDate: summary.lastNoShowAppointment?.date ?? null
  };
}

export async function authorizePatientNoShowBooking(patientId: UserId, reason: unknown, userId: UserId, userRole?: Role): Promise<PatientNoShowRestriction> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const cleanUserId = normalizePositiveInteger(userId, "userId") as number;
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) {
    throw new HttpError(400, "Authorization reason is required.");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await authorizeNoShowBookingRestriction(client, cleanPatientId, cleanUserId, cleanReason, null, userRole);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return getPatientNoShowRestriction(cleanPatientId);
}

export async function searchPatients(searchTerm = ""): Promise<PatientRow[]> {
  const preparedSearch = await preparePatientSearch(searchTerm);

  const query = String.raw`
    with ${PATIENT_SEARCH_CANDIDATE_IDS_CTE}
    select
      p.id,
      p.mrn,
      case
        when coalesce(primary_identifier.identifier_type, p.identifier_type) = 'national_id'
          then coalesce(primary_identifier.identifier_value, p.identifier_value, p.national_id)
        else null
      end as national_id,
      coalesce(primary_identifier.identifier_type, p.identifier_type) as identifier_type,
      coalesce(primary_identifier.identifier_value, p.identifier_value) as identifier_value,
      p.category,
      p.arabic_full_name,
      p.english_full_name,
      p.age_years,
      p.demographics_estimated,
      p.sex,
      p.phone_1,
      p.phone_2,
      p.address,
      p.estimated_date_of_birth
    from candidate_ids candidate
    join patients p on p.id = candidate.id
    left join lateral (
      select
        pit.code as identifier_type,
        pi.value as identifier_value
      from patient_identifiers pi
      join patient_identifier_types pit on pit.id = pi.identifier_type_id
      where pi.patient_id = p.id
      order by pi.is_primary desc, pi.id asc
      limit 1
    ) as primary_identifier on true
    ${PATIENT_SEARCH_PHONETIC_LATERALS}
    where ${PATIENT_SEARCH_MATCH_SQL}
    order by
      ${PATIENT_SEARCH_RANK_SQL} asc,
      ${PATIENT_SEARCH_SIMILARITY_SQL} desc,
      phonetic_match.matching_token_count desc,
      p.id desc
    limit 25
  `;
  const { rows } = await pool.query<PatientRow>(query, preparedSearch.queryParameters);
  return rows;
}

export async function listActivePatientIdentifierTypes(): Promise<PatientIdentifierTypeOption[]> {
  const { rows } = await pool.query<PatientIdentifierTypeOption>(
    `
      select code, label_ar, label_en
      from patient_identifier_types
      where is_active = true
      order by
        case code
          when 'national_id' then 1
          when 'passport' then 2
          when 'other' then 3
          else 4
        end asc,
        id asc
    `
  );
  return rows;
}

async function resolveIdentifierTypeMap(client: PoolClient): Promise<Map<string, number>> {
  const { rows } = await client.query<IdentifierTypeRow>(
    `
      select id, code
      from patient_identifier_types
      where true
    `
  );

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(String(row.code), Number(row.id));
  }
  return map;
}

function normalizeIdentifierInputs(
  payload: PatientPayload,
  validated: ValidatedPatientPayload
): Array<{ typeCode: string; value: string; normalizedValue: string; isPrimary: boolean }> {
  const raw = Array.isArray(payload.identifiers) ? (payload.identifiers as PatientIdentifierInput[]) : [];
  const normalized = raw
    .map((entry) => {
      const typeCode = String(entry.typeCode || "").trim();
      const value = String(entry.value || "").trim();
      const normalizedValue = normalizeIdentifierValue(value);
      return {
        typeCode,
        value,
        normalizedValue,
        isPrimary: Boolean(entry.isPrimary)
      };
    })
    .filter((entry) => entry.typeCode && entry.value && entry.normalizedValue);

  if (normalized.length === 0) {
    if (validated.cleanIdentifierValue) {
      return [
        {
          typeCode: validated.identifierType,
          value: validated.cleanIdentifierValue,
          normalizedValue: normalizeIdentifierValue(validated.cleanIdentifierValue),
          isPrimary: true
        }
      ];
    }
    return [];
  }

  const primaryCount = normalized.filter((entry) => entry.isPrimary).length;
  if (primaryCount === 0) {
    normalized[0]!.isPrimary = true;
  } else if (primaryCount > 1) {
    throw new HttpError(400, "Only one primary identifier is allowed.");
  }

  return normalized;
}

async function listV2BookingIdsForPatientSync(
  client: PoolClient,
  patientIds: number[],
  options?: { activeOnly?: boolean; queueOnly?: boolean }
): Promise<number[]> {
  const ids = Array.from(new Set(patientIds)).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return [];

  const statusSql = options?.queueOnly
    ? `and b.status in ('arrived', 'waiting')`
    : options?.activeOnly
      ? `and b.status in ('scheduled', 'arrived', 'waiting')`
      : "";

  const { rows } = await client.query<{ id: number }>(
    `
      select b.id
      from appointments_v2.bookings b
      where b.patient_id = any($1::bigint[])
      ${statusSql}
      order by b.id asc
    `,
    [ids]
  );

  return Array.from(new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0)));
}

function scheduleBookingSyncBatch(bookingIds: number[]): void {
  for (const bookingId of bookingIds) {
    scheduleBookingWorklistDetailReplacement(bookingId as UserId);
  }
}

async function replacePatientIdentifiers(
  client: PoolClient,
  patientId: number,
  payload: PatientPayload,
  validated: ValidatedPatientPayload,
  actingUserId: OptionalUserId
): Promise<void> {
  const identifiers = normalizeIdentifierInputs(payload, validated);
  await client.query(`delete from patient_identifiers where patient_id = $1`, [patientId]);
  if (identifiers.length === 0) {
    return;
  }

  const typeMap = await resolveIdentifierTypeMap(client);
  for (const identifier of identifiers) {
    const typeId = typeMap.get(identifier.typeCode);
    if (!typeId) {
      throw new HttpError(400, `Unknown identifier type: ${identifier.typeCode}`);
    }

    const normalizedValue = ensureIdentifierValue(identifier.normalizedValue, "identifier value");
    await client.query(
      `
        insert into patient_identifiers (
          patient_id,
          identifier_type_id,
          value,
          normalized_value,
          is_primary,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $6)
      `,
      [patientId, typeId, identifier.value, normalizedValue, identifier.isPrimary, actingUserId]
    );
  }
}

async function syncPatientPrimaryIdentifierColumns(
  client: PoolClient,
  patientId: number,
  actingUserId: OptionalUserId
): Promise<void> {
  const { rows } = await client.query<{ type_code: string; value: string }>(
    `
      select pit.code as type_code, pi.value
      from patient_identifiers pi
      join patient_identifier_types pit on pit.id = pi.identifier_type_id
      where pi.patient_id = $1
      order by pi.is_primary desc, pi.id asc
      limit 1
    `,
    [patientId]
  );

  const primary = rows[0];
  if (!primary) return;

  const typeCode = String(primary.type_code || "national_id");
  const legacyTypeCode = toLegacyPatientIdentifierType(typeCode);
  const value = String(primary.value || "");

  await client.query(
    `
      update patients
      set
        identifier_type = $2,
        identifier_value = nullif($3, ''),
        national_id = case when $2 = 'national_id' then nullif($3, '') else null end,
        updated_by_user_id = $4,
        updated_at = now()
      where id = $1
    `,
    [patientId, legacyTypeCode, value, actingUserId]
  );
}

export async function createPatient(payload: PatientPayload, createdByUserId: OptionalUserId): Promise<PersistedPatientRow> {
  const rules = await loadPatientRegistrationSettings();
  const dictionary = await loadPatientNameDictionary();
  const notAllowedNameWords = await listPatientNotAllowedNameWords();
  const validated = await validatePatientPayload(payload, rules, dictionary, notAllowedNameWords);

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const allocatedMrn = await allocateNextPatientMrn(client, rules.mrnPrefix);
      const { rows } = await client.query<PersistedPatientRow>(
        `
          insert into patients (
            mrn,
            national_id,
            identifier_type,
            identifier_value,
            arabic_full_name,
            english_full_name,
            normalized_arabic_name,
            normalized_arabic_name_compact,
            age_years,
            demographics_estimated,
            estimated_date_of_birth,
            sex,
            phone_1,
            phone_2,
            address,
            category,
            created_by_user_id,
            updated_by_user_id
          )
          values (
            $1,
            nullif($2, ''),
            $3,
            nullif($4, ''),
            $5,
            nullif($6, ''),
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            nullif($13, ''),
            nullif($14, ''),
            nullif($15, ''),
            $16,
            $17,
            $17
          )
          returning *
        `,
        [
          allocatedMrn,
          validated.cleanNationalId,
          toLegacyPatientIdentifierType(validated.identifierType),
          validated.cleanIdentifierValue,
          validated.arabicFullName,
          validated.englishFullName,
          validated.normalizedArabicName,
          validated.normalizedArabicNameCompact,
          validated.parsedAge,
          validated.demographicsEstimated,
          validated.estimatedDob,
          validated.sex,
          validated.cleanPhone1,
          validated.cleanPhone2,
          validated.address,
          validated.category,
          createdByUserId
        ]
      );

      const createdPatient = rows[0];

      if (!createdPatient) {
        throw new HttpError(500, "Failed to create patient.");
      }

      await replacePatientIdentifiers(client, Number(createdPatient.id), payload, validated, createdByUserId);
      await syncPatientPrimaryIdentifierColumns(client, Number(createdPatient.id), createdByUserId);

      await logAuditEntry(
        {
          entityType: "patient",
          entityId: createdPatient.id,
          actionType: "create",
          oldValues: null,
          newValues: createdPatient,
          changedByUserId: createdByUserId
        },
        client
      );

      await client.query("commit");
      return createdPatient;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String(error.code) === "23505"
    ) {
      throw new HttpError(409, "A patient with that national ID or MRN already exists.");
    }

    throw error;
  }
}

export async function updatePatient(patientId: UserId, payload: PatientPayload, updatedByUserId: OptionalUserId): Promise<PersistedPatientRow> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const previousPatient = await getPatientById(cleanPatientId);
  const rules = await loadPatientRegistrationSettings();
  const dictionary = await loadPatientNameDictionary();
  const notAllowedNameWords = await listPatientNotAllowedNameWords();
  const validated = await validatePatientPayload(payload, rules, dictionary, notAllowedNameWords);

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const bookingIdsToSync = await listV2BookingIdsForPatientSync(client, [cleanPatientId], { queueOnly: true });
      const { rows } = await client.query<PersistedPatientRow>(
      `
        update patients
        set
          national_id = nullif($2, ''),
          identifier_type = $3,
          identifier_value = nullif($4, ''),
          arabic_full_name = $5,
          english_full_name = nullif($6, ''),
          normalized_arabic_name = $7,
          normalized_arabic_name_compact = $8,
          age_years = $9,
          demographics_estimated = $10,
          estimated_date_of_birth = $11,
          sex = $12,
          phone_1 = nullif($13, ''),
          phone_2 = nullif($14, ''),
          address = nullif($15, ''),
          category = $16,
          updated_by_user_id = $17,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        cleanPatientId,
        validated.cleanNationalId,
        toLegacyPatientIdentifierType(validated.identifierType),
        validated.cleanIdentifierValue,
        validated.arabicFullName,
        validated.englishFullName,
        validated.normalizedArabicName,
        validated.normalizedArabicNameCompact,
        validated.parsedAge,
        validated.demographicsEstimated,
        validated.estimatedDob,
        validated.sex,
        validated.cleanPhone1,
        validated.cleanPhone2,
        validated.address,
        validated.category,
        updatedByUserId
      ]
    );

      const updatedPatient = rows[0];

      if (!updatedPatient) {
        throw new HttpError(500, "Failed to update patient.");
      }

      await replacePatientIdentifiers(client, Number(updatedPatient.id), payload, validated, updatedByUserId);
      await syncPatientPrimaryIdentifierColumns(client, Number(updatedPatient.id), updatedByUserId);

      await logAuditEntry(
        {
          entityType: "patient",
          entityId: updatedPatient.id,
          actionType: "update",
          oldValues: previousPatient,
          newValues: updatedPatient,
          changedByUserId: updatedByUserId
        },
        client
      );

      await client.query("commit");
      scheduleBookingSyncBatch(bookingIdsToSync);
      return updatedPatient;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String(error.code) === "23505"
    ) {
      throw new HttpError(409, "Another patient already uses that national ID or MRN.");
    }

    throw error;
  }
}

export async function deletePatient(patientId: UserId, deletedByUserId: OptionalUserId): Promise<{ ok: boolean }> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const previousPatient = await getPatientById(cleanPatientId);

    const { rows: appointmentRows } = await client.query<{ id: unknown }>(
      `select id from appointments where patient_id = $1`,
      [cleanPatientId]
    );
    const appointmentIds = appointmentRows
      .map((row) => Number(row.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const { rows: bookingRows } = await client.query<{ id: unknown }>(
      `select id from appointments_v2.bookings where patient_id = $1`,
      [cleanPatientId]
    );
    const bookingIds = bookingRows
      .map((row) => Number(row.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (appointmentIds.length > 0) {
      await client.query(`delete from queue_entries where appointment_id = any($1::bigint[])`, [appointmentIds]);
      await client.query(`delete from documents where appointment_id = any($1::bigint[]) or patient_id = $2`, [appointmentIds, cleanPatientId]);
      await client.query(`delete from appointment_status_history where appointment_id = any($1::bigint[])`, [appointmentIds]);
      await client.query(`delete from appointments where patient_id = $1`, [cleanPatientId]);
    } else {
      await client.query(`delete from documents where patient_id = $1`, [cleanPatientId]);
    }

    if (bookingIds.length > 0) {
      await client.query(`delete from documents where v2_booking_id = any($1::bigint[]) or patient_id = $2`, [bookingIds, cleanPatientId]);
      await client.query(`delete from appointments_v2.bookings where patient_id = $1`, [cleanPatientId]);
    }

    await client.query(`delete from scan_sessions where patient_id = $1`, [cleanPatientId]);
    await client.query(`update scheduling_override_audit_events set patient_id = null where patient_id = $1`, [cleanPatientId]);
    await client.query(`update appointments_v2.override_audit_events set patient_id = null where patient_id = $1`, [cleanPatientId]);
    await client.query(`update dicom_remap_jobs set rispro_patient_id = null, updated_at = now() where rispro_patient_id = $1`, [cleanPatientId]);
    await client.query(`update patient_import_staging_rows set matched_existing_patient_id = null, updated_at = now() where matched_existing_patient_id = $1`, [cleanPatientId]);
    await client.query(`update patient_import_staging_rows set migrated_patient_id = null, updated_at = now() where migrated_patient_id = $1`, [cleanPatientId]);
    await client.query(`delete from patient_custom_values where patient_id = $1`, [cleanPatientId]);
    await client.query(`delete from patient_identifiers where patient_id = $1`, [cleanPatientId]);
    await client.query(`delete from patients where id = $1`, [cleanPatientId]);

    await logAuditEntry(
      {
        entityType: "patient",
        entityId: cleanPatientId,
        actionType: "delete",
        oldValues: previousPatient,
        newValues: null,
        changedByUserId: deletedByUserId
      },
      client
    );

    await client.query("commit");
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function mergePatientIdentifiers(
  client: PoolClient,
  targetPatientId: number,
  sourcePatientId: number,
  actingUserId: OptionalUserId
): Promise<void> {
  await client.query(
    `
      delete from patient_identifiers src
      using patient_identifiers tgt
      where src.patient_id = $2
        and tgt.patient_id = $1
        and src.identifier_type_id = tgt.identifier_type_id
        and src.normalized_value = tgt.normalized_value
    `,
    [targetPatientId, sourcePatientId]
  );

  await client.query(
    `
      update patient_identifiers
      set
        patient_id = $1,
        is_primary = false,
        updated_by_user_id = $3,
        updated_at = now()
      where patient_id = $2
    `,
    [targetPatientId, sourcePatientId, actingUserId]
  );

  const primaryRows = await client.query<{ id: number }>(
    `
      select id
      from patient_identifiers
      where patient_id = $1 and is_primary = true
      order by id asc
    `,
    [targetPatientId]
  );

  if (primaryRows.rows.length === 0) {
    await client.query(
      `
        update patient_identifiers
        set is_primary = true, updated_by_user_id = $2, updated_at = now()
        where id = (
          select id
          from patient_identifiers
          where patient_id = $1
          order by id asc
          limit 1
        )
      `,
      [targetPatientId, actingUserId]
    );
  } else if (primaryRows.rows.length > 1) {
    const keepId = Number(primaryRows.rows[0]!.id);
    await client.query(
      `
        update patient_identifiers
        set is_primary = (id = $2), updated_by_user_id = $3, updated_at = now()
        where patient_id = $1
      `,
      [targetPatientId, keepId, actingUserId]
    );
  }

  await client.query(`delete from patient_identifiers where patient_id = $1`, [sourcePatientId]);
}

export async function mergePatients(payload: MergePatientsPayload, updatedByUserId: OptionalUserId): Promise<PatientRow> {
  const targetPatientId = normalizePositiveInteger(payload.targetPatientId, "targetPatientId") as number;
  const sourcePatientId = normalizePositiveInteger(payload.sourcePatientId, "sourcePatientId") as number;
  const confirmationText = String(payload.confirmationText || "").trim().toUpperCase();

  if (targetPatientId === sourcePatientId) {
    throw new HttpError(400, "Choose two different patient records to merge.");
  }

  if (confirmationText !== "MERGE") {
    throw new HttpError(400, "confirmationText must be MERGE.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const bookingIdsToSync = await listV2BookingIdsForPatientSync(client, [targetPatientId, sourcePatientId], { queueOnly: true });

    const { rows } = await client.query<{ id: number; arabic_full_name: string; english_full_name: string | null }>(
      `
        select id, arabic_full_name, english_full_name
        from patients
        where id = any($1::bigint[])
        order by id asc
      `,
      [[targetPatientId, sourcePatientId]]
    );

    if (rows.length !== 2) {
      throw new HttpError(404, "Both patient records must exist before merging.");
    }

    await client.query(`update appointments set patient_id = $1, updated_by_user_id = $3, updated_at = now() where patient_id = $2`, [
      targetPatientId,
      sourcePatientId,
      updatedByUserId
    ]);
    await client.query(`update appointments_v2.bookings set patient_id = $1, updated_by_user_id = $3, updated_at = now() where patient_id = $2`, [
      targetPatientId,
      sourcePatientId,
      updatedByUserId
    ]);
    await client.query(`update documents set patient_id = $1 where patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`update scan_sessions set patient_id = $1, updated_at = now() where patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`update patient_web_push_booking_subscriptions set patient_id = $1, updated_at = now() where patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`update patient_notification_events set patient_id = $1, updated_at = now() where patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`update dicom_remap_jobs set rispro_patient_id = $1, updated_at = now() where rispro_patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`update patient_import_staging_rows set matched_existing_patient_id = $1, updated_at = now() where matched_existing_patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`update patient_import_staging_rows set migrated_patient_id = $1, updated_at = now() where migrated_patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`update scheduling_override_audit_events set patient_id = $1 where patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`update appointments_v2.override_audit_events set patient_id = $1 where patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`delete from patient_custom_values where patient_id = $1`, [sourcePatientId]);
    await mergePatientIdentifiers(client, targetPatientId, sourcePatientId, updatedByUserId);
    await client.query(`delete from patient_duplicate_dismissals where patient_a_id = $1 or patient_b_id = $1`, [sourcePatientId]);
    await client.query(`delete from patients where id = $1`, [sourcePatientId]);

    const targetPatient = await client.query<PatientRow>(
      `
        select id, mrn, national_id, arabic_full_name, english_full_name, age_years, demographics_estimated, sex, phone_1, phone_2, address, estimated_date_of_birth, category
        from patients
        where id = $1
        limit 1
      `,
      [targetPatientId]
    );

    await logAuditEntry(
      {
        entityType: "patient_merge",
        entityId: targetPatientId,
        actionType: "merge",
        oldValues: { sourcePatientId, targetPatientId } as UnknownRecord,
        newValues: { mergedInto: targetPatientId, removedPatientId: sourcePatientId } as UnknownRecord,
        changedByUserId: updatedByUserId
      },
      client
    );

    await client.query("commit");
    scheduleBookingSyncBatch(bookingIdsToSync);
    const mergedPatient = targetPatient.rows[0];

    if (!mergedPatient) {
      throw new HttpError(500, "Failed to load merged patient.");
    }

    return mergedPatient;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

interface PatientDirectorySummaryOutput {
  demographics: {
    id: number;
    mrn: string | null;
    arabicFullName: string;
    englishFullName: string | null;
    sex: string | null;
    ageYears: number;
    demographicsEstimated: boolean;
    dateOfBirth: string | null;
  };
  identifiers: {
    nationalId: string | null;
    identifierType: string | null;
    identifierValue: string | null;
    items: Array<{
      id: number;
      typeId: number;
      typeCode: string;
      value: string;
      normalizedValue: string;
      isPrimary: boolean;
    }>;
  };
  contact: {
    phone1: string | null;
    phone2: string | null;
    address: string | null;
  };
  category: "oncology" | "non_oncology" | null;
  registration: {
    createdAt: string | null;
    createdByUserId: number | null;
    createdByName: string | null;
    createdByUsername: string | null;
  };
  warnings: {
    missingPhone: boolean;
    missingDob: boolean;
    missingSex: boolean;
    missingName: boolean;
    incompleteData: boolean;
    possibleDuplicate: boolean;
    duplicateReasons: string[];
  };
  lastAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  } | null;
  nextAppointment: {
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  } | null;
  recentAppointments: Array<{
    id: number;
    date: string;
    status: string;
    modalityName: string;
    examTypeName: string;
  }>;
  noShow: PatientNoShowRestriction;
}

export async function getPatientDirectorySummary(patientId: UserId): Promise<PatientDirectorySummaryOutput> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const patient = await getPatientById(cleanPatientId);

  type AppointmentSummaryRow = {
    id: number;
    date: string;
    status: string;
    modality_name: string;
    exam_type_name: string;
  };

  type DuplicateCheckRow = {
    is_dupe: boolean;
  };

  const [lastApptResult, nextApptResult, recentApptsResult, duplicateResult, noShow] = await Promise.all([
    pool.query<AppointmentSummaryRow>(
      `
        select
          b.id,
          b.booking_date::text as date,
          b.status,
          m.name_en as modality_name,
          coalesce(et.name_en, '') as exam_type_name
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        where b.patient_id = $1 and b.booking_date < current_date and b.status not in ('cancelled', 'voided')
        order by b.booking_date desc
        limit 1
      `,
      [cleanPatientId]
    ),
    pool.query<AppointmentSummaryRow>(
      `
        select
          b.id,
          b.booking_date::text as date,
          b.status,
          m.name_en as modality_name,
          coalesce(et.name_en, '') as exam_type_name
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        where b.patient_id = $1 and b.booking_date >= current_date and b.status not in ('cancelled', 'voided')
        order by b.booking_date asc
        limit 1
      `,
      [cleanPatientId]
    ),
    pool.query<AppointmentSummaryRow>(
      `
        select
          b.id,
          b.booking_date::text as date,
          b.status,
          m.name_en as modality_name,
          coalesce(et.name_en, '') as exam_type_name
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        where b.patient_id = $1 and b.status not in ('cancelled', 'voided')
        order by b.booking_date desc, b.id desc
        limit 5
      `,
      [cleanPatientId]
    ),
    pool.query<DuplicateCheckRow>(
      `
        select exists (
          select 1
          from patients p2
          where p2.id != $1
            and (
              ($2::text is not null and $2 <> '' and p2.phone_1 = $2)
              or ($3::text is not null and $3 <> '' and p2.national_id = $3)
            )
        ) as is_dupe
      `,
      [cleanPatientId, patient.phone_1 || null, patient.national_id || null]
    ),
    getPatientNoShowRestriction(cleanPatientId)
  ]);

  const toAppointmentSummary = (row?: AppointmentSummaryRow | null) =>
    row
      ? {
          id: Number(row.id),
          date: String(row.date),
          status: String(row.status),
          modalityName: String(row.modality_name ?? ""),
          examTypeName: String(row.exam_type_name ?? "")
        }
      : null;

  const duplicateReasons = Boolean(duplicateResult.rows[0]?.is_dupe) ? ["phone_or_id_match"] : [];
  const missingPhone = !patient.phone_1;
  const missingDob = !patient.estimated_date_of_birth;
  const missingSex = !patient.sex;
  const missingName = !patient.arabic_full_name;

  return {
    demographics: {
      id: patient.id,
      mrn: patient.mrn,
      arabicFullName: patient.arabic_full_name,
      englishFullName: patient.english_full_name,
      sex: patient.sex,
      ageYears: patient.age_years,
      demographicsEstimated: patient.demographics_estimated,
      dateOfBirth: patient.estimated_date_of_birth
    },
    identifiers: {
      nationalId: patient.national_id,
      identifierType: patient.identifier_type,
      identifierValue: patient.identifier_value,
      items: (patient.identifiers ?? []).map((identifier) => ({
        id: identifier.id,
        typeId: identifier.type_id,
        typeCode: identifier.type_code,
        value: identifier.value,
        normalizedValue: identifier.normalized_value,
        isPrimary: identifier.is_primary
      }))
    },
    contact: {
      phone1: patient.phone_1,
      phone2: patient.phone_2,
      address: patient.address
    },
    category: patient.category,
    registration: {
      createdAt: patient.created_at ? new Date(patient.created_at).toISOString() : null,
      createdByUserId: patient.created_by_user_id ? Number(patient.created_by_user_id) : null,
      createdByName: patient.created_by_full_name ?? null,
      createdByUsername: patient.created_by_username ?? null
    },
    warnings: {
      missingPhone,
      missingDob,
      missingSex,
      missingName,
      incompleteData: missingPhone || missingDob || missingSex || missingName,
      possibleDuplicate: duplicateReasons.length > 0,
      duplicateReasons
    },
    lastAppointment: toAppointmentSummary(lastApptResult.rows[0]),
    nextAppointment: toAppointmentSummary(nextApptResult.rows[0]),
    recentAppointments: recentApptsResult.rows.map((row) => toAppointmentSummary(row)).filter(Boolean) as NonNullable<PatientDirectorySummaryOutput["recentAppointments"][number]>[],
    noShow
  };
}
