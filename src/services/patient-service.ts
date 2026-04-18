import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger, buildEstimatedDobFromAge, formatDateForSql, normalizeArabicName, normalizeLibyanPhone } from "../utils/normalize.js";
import { validateIsoDate } from "../utils/date.js";
import { getCached, setCached, invalidateCache } from "../utils/cache.js";
import { logAuditEntry } from "./audit-service.js";
import { generateEnglishFromDictionary, NameDictionaryLookup } from "../utils/name-generation.js";
import {
  isValidNationalId,
  deriveSexFromNationalId,
  deriveDobFromNationalId,
  calculateAgeFromDob
} from "../utils/national-id.js";
import { ensureIdentifierValue, normalizeIdentifierValue } from "../utils/identifier.js";
import type { UserId, OptionalUserId, UnknownRecord } from "../types/http.js";
import type { NullableDbNumeric } from "../types/db.js";
import type { CategorySettings } from "../types/settings.js";
import type { PoolClient } from "pg";

export interface PatientRegistrationRules {
  nationalIdRule: string;
  phoneRule: string;
  dobRule: string;
}

export interface PatientRow {
  id: number;
  mrn: string | null;
  national_id: string | null;
  identifier_type: string | null;
  identifier_value: string | null;
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
}

export interface PatientPayload {
  nationalId?: unknown;
  nationalIdConfirmation?: unknown;
  identifierType?: string;
  identifierValue?: unknown;
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
  arabicFullName: string;
  englishFullName: string;
  normalizedArabicName: string;
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
  setting_value?: { value?: unknown } | null;
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
    accumulator[row.setting_key] = String(row.setting_value?.value ?? "");
    return accumulator;
  }, {});

  const result: PatientRegistrationRules = {
    nationalIdRule: settings.national_id_required || "required_with_confirmation",
    phoneRule: settings.phone1_required || "required",
    dobRule: settings.dob_or_age_rule || "age_or_dob_required"
  };
  
  setCached(cacheKey, result, 5 * 60 * 1000); // 5 minutes
  return result;
}

async function loadNameDictionary(): Promise<NameDictionaryLookup[]> {
  const cacheKey = "name_dictionary";
  const cached = getCached<NameDictionaryLookup[]>(cacheKey);
  
  if (cached) {
    return cached;
  }
  
  const { rows } = await pool.query<NameDictionaryLookup>(
    `
      select arabic_text, english_text
      from name_dictionary
      where is_active = true
      order by arabic_text asc
    `
  );
  
  setCached(cacheKey, rows, 5 * 60 * 1000); // 5 minutes
  return rows;
}

async function validatePatientPayload(
  payload: PatientPayload,
  rules: PatientRegistrationRules,
  dictionary: NameDictionaryLookup[]
): Promise<ValidatedPatientPayload> {
  const {
    nationalId,
    nationalIdConfirmation,
    identifierType,
    identifierValue,
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
    finalEnglishName = generated.englishName;
  }

  return {
    cleanNationalId,
    identifierType: resolvedIdentifierType,
    cleanIdentifierValue: cleanIdentifierValue,
    arabicFullName: arabicFullName.trim(),
    englishFullName: finalEnglishName,
    normalizedArabicName: normalizeArabicName(arabicFullName),
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
        id,
        mrn,
        national_id,
        identifier_type,
        identifier_value,
        arabic_full_name,
        english_full_name,
        age_years,
        demographics_estimated,
        sex,
        phone_1,
        phone_2,
        address,
        estimated_date_of_birth,
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
          where pi.patient_id = patients.id
        ) as identifiers
      from patients
      where id = $1
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

export async function getPatientNoShowSummary(patientId: UserId): Promise<{ noShowCount: number; lastNoShowDate: string | null }> {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId") as number;
  const { rows } = await pool.query<PatientNoShowSummaryRow>(
    `
      select
        count(*) filter (where status = 'no-show') as no_show_count,
        max(appointment_date) filter (where status = 'no-show') as last_no_show_date
      from appointments
      where patient_id = $1
    `,
    [cleanPatientId]
  );

  const summary = rows[0];

  return {
    noShowCount: Number(summary?.no_show_count || 0),
    lastNoShowDate: summary?.last_no_show_date || null
  };
}

export async function searchPatients(searchTerm = ""): Promise<PatientRow[]> {
  const term = searchTerm.trim();
  const pattern = `%${term}%`;
  const normalizedPattern = `%${normalizeArabicName(term)}%`;
  const normalizedIdentifierPattern = `%${normalizeIdentifierValue(term)}%`;

  const query = `
    select distinct
      p.id,
      p.mrn,
      p.national_id,
      p.identifier_type,
      p.identifier_value,
      p.arabic_full_name,
      p.english_full_name,
      p.age_years,
      p.demographics_estimated,
      p.sex,
      p.phone_1,
      p.phone_2,
      p.address,
      p.estimated_date_of_birth
    from patients p
    left join patient_identifiers pi on pi.patient_id = p.id
    where
      $1 = ''
      or p.mrn ilike $2
      or p.national_id ilike $2
      or p.identifier_value ilike $2
      or pi.value ilike $2
      or pi.normalized_value ilike $4
      or p.phone_1 ilike $2
      or p.phone_2 ilike $2
      or p.arabic_full_name ilike $2
      or p.normalized_arabic_name ilike $3
      or p.english_full_name ilike $2
    order by p.id desc
    limit 25
  `;

  const { rows } = await pool.query<PatientRow>(query, [
    term,
    pattern,
    normalizedPattern,
    normalizedIdentifierPattern
  ]);
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
    [patientId, typeCode, value, actingUserId]
  );
}

export async function createPatient(payload: PatientPayload, createdByUserId: OptionalUserId): Promise<PersistedPatientRow> {
  const rules = await loadPatientRegistrationSettings();
  const dictionary = await loadNameDictionary();
  const validated = await validatePatientPayload(payload, rules, dictionary);

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query<PersistedPatientRow>(
      `
        insert into patients (
          national_id,
          identifier_type,
          identifier_value,
          arabic_full_name,
          english_full_name,
          normalized_arabic_name,
          age_years,
          demographics_estimated,
          estimated_date_of_birth,
          sex,
          phone_1,
          phone_2,
          address,
          created_by_user_id,
          updated_by_user_id
        )
        values (
          nullif($1, ''),
          $2,
          nullif($3, ''),
          $4,
          nullif($5, ''),
          $6,
          $7,
          $8,
          $9,
          $10,
          nullif($11, ''),
          nullif($12, ''),
          nullif($13, ''),
          $14,
          $14
        )
        returning *
      `,
      [
        validated.cleanNationalId,
        validated.identifierType,
        validated.cleanIdentifierValue,
        validated.arabicFullName,
        validated.englishFullName,
        validated.normalizedArabicName,
        validated.parsedAge,
        validated.demographicsEstimated,
        validated.estimatedDob,
        validated.sex,
        validated.cleanPhone1,
        validated.cleanPhone2,
        validated.address,
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
  const dictionary = await loadNameDictionary();
  const validated = await validatePatientPayload(payload, rules, dictionary);

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
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
          age_years = $8,
          demographics_estimated = $9,
          estimated_date_of_birth = $10,
          sex = $11,
          phone_1 = nullif($12, ''),
          phone_2 = nullif($13, ''),
          address = nullif($14, ''),
          updated_by_user_id = $15,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        cleanPatientId,
        validated.cleanNationalId,
        validated.identifierType,
        validated.cleanIdentifierValue,
        validated.arabicFullName,
        validated.englishFullName,
        validated.normalizedArabicName,
        validated.parsedAge,
        validated.demographicsEstimated,
        validated.estimatedDob,
        validated.sex,
        validated.cleanPhone1,
        validated.cleanPhone2,
        validated.address,
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

    if (appointmentIds.length > 0) {
      await client.query(`delete from queue_entries where appointment_id = any($1::bigint[])`, [appointmentIds]);
      await client.query(`delete from documents where appointment_id = any($1::bigint[]) or patient_id = $2`, [appointmentIds, cleanPatientId]);
      await client.query(`delete from appointment_status_history where appointment_id = any($1::bigint[])`, [appointmentIds]);
      await client.query(`delete from appointments where patient_id = $1`, [cleanPatientId]);
    } else {
      await client.query(`delete from documents where patient_id = $1`, [cleanPatientId]);
    }

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
    await client.query(`update documents set patient_id = $1 where patient_id = $2`, [targetPatientId, sourcePatientId]);
    await client.query(`delete from patient_custom_values where patient_id = $1`, [sourcePatientId]);
    await mergePatientIdentifiers(client, targetPatientId, sourcePatientId, updatedByUserId);
    await client.query(`delete from patients where id = $1`, [sourcePatientId]);

    const targetPatient = await client.query<PatientRow>(
      `
        select id, mrn, national_id, arabic_full_name, english_full_name, age_years, demographics_estimated, sex, phone_1, phone_2, address, estimated_date_of_birth
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
