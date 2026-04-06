// @ts-check

import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import {
  buildEstimatedDobFromAge,
  formatDateForSql,
  normalizeArabicName,
  normalizeLibyanPhone
} from "../utils/normalize.js";
import { generateEnglishFromDictionary } from "../utils/name-generation.js";
import {
  isValidNationalId,
  deriveSexFromNationalId,
  deriveDobFromNationalId,
  calculateAgeFromDob
} from "../utils/national-id.js";

/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */
/** @typedef {import("../types/http.js").OptionalUserId} OptionalUserId */
/** @typedef {import("../types/http.js").UserId} UserId */
/** @typedef {import("../types/db.js").NullableDbNumeric} NullableDbNumeric */
/** @typedef {import("../types/settings.js").CategorySettings} CategorySettings */

/**
 * @typedef {object} PatientRegistrationRules
 * @property {string} nationalIdRule
 * @property {string} phoneRule
 * @property {string} dobRule
 */

/**
 * @typedef {object} PatientRow
 * @property {number} id
 * @property {string | null} mrn
 * @property {string | null} national_id
 * @property {string | null} identifier_type
 * @property {string | null} identifier_value
 * @property {string} arabic_full_name
 * @property {string | null} english_full_name
 * @property {number} age_years
 * @property {string | null} sex
 * @property {string | null} phone_1
 * @property {string | null} phone_2
 * @property {string | null} address
 * @property {string | null} estimated_date_of_birth
 */

/**
 * @typedef {object} PatientPayload
 * @property {string} [nationalId]
 * @property {string} [nationalIdConfirmation]
 * @property {string} [identifierType]
 * @property {string} [identifierValue]
 * @property {string} [arabicFullName]
 * @property {string} [englishFullName]
 * @property {UserId} [ageYears]
 * @property {string} [estimatedDateOfBirth]
 * @property {string} [sex]
 * @property {string} [phone1]
 * @property {string} [phone2]
 * @property {string} [address]
 * @property {boolean} [autoGenerateEnglish]
 */

/**
 * @typedef {object} MergePatientsPayload
 * @property {UserId} [targetPatientId]
 * @property {UserId} [sourcePatientId]
 * @property {string} [confirmationText]
 */

/**
 * @typedef {object} PatientSettingRow
 * @property {string} setting_key
 * @property {{ value?: unknown } | null} [setting_value]
 */

/**
 * @typedef {object} PatientNoShowSummaryRow
 * @property {NullableDbNumeric} [no_show_count]
 * @property {string | null} [last_no_show_date]
 */

/**
 * @typedef {UnknownRecord & { id: UserId }} PersistedPatientRow
 */

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
function normalizePositiveInteger(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive whole number.`);
  }

  return parsed;
}

/**
 * @param {unknown} nationalId
 * @param {unknown} nationalIdConfirmation
 * @param {string} identifierType
 * @param {unknown} identifierValue
 * @param {string} rule
 */
function validateNationalId(nationalId, nationalIdConfirmation, identifierType, identifierValue, rule) {
  // For national_id type
  if (identifierType === 'national_id' || (!identifierType && nationalId)) {
    const cleanId = String(nationalId || identifierValue || '').replace(/\D/g, '');
    const cleanConfirmation = String(nationalIdConfirmation || '').replace(/\D/g, '');
    const hasAny = cleanId.length > 0 || cleanConfirmation.length > 0;

    if (rule === "optional") {
      if (!hasAny) {
        return { nationalId: "", identifierValue: "" };
      }

      if (cleanId.length !== 11) {
        throw new HttpError(400, "National ID must contain exactly 11 digits.");
      }

      if (cleanConfirmation && cleanId !== cleanConfirmation) {
        throw new HttpError(400, "National ID confirmation does not match.");
      }

      return { nationalId: cleanId, identifierValue: cleanId };
    }

    if (cleanId.length !== 11) {
      throw new HttpError(400, "National ID must contain exactly 11 digits.");
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

/**
 * @param {unknown} phone
 * @param {string} fieldName
 * @param {{ required: boolean }} options
 */
function validatePhone(phone, fieldName, { required }) {
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

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
function normalizeDateString(value, fieldName) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, `${fieldName} must be in YYYY-MM-DD format.`);
  }

  return raw;
}

/**
 * @param {string} dob
 */
function calculateAgeYearsFromDob(dob) {
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

/**
 * @returns {Promise<PatientRegistrationRules>}
 */
async function loadPatientRegistrationSettings() {
  const { rows } = await pool.query(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'patient_registration'
    `
  );

  const settingRows = /** @type {PatientSettingRow[]} */ (rows);
  const settings = settingRows.reduce((accumulator, row) => {
    accumulator[row.setting_key] = String(row.setting_value?.value ?? "");
    return accumulator;
  }, /** @type {CategorySettings} */ ({}));

  return {
    nationalIdRule: settings.national_id_required || "required_with_confirmation",
    phoneRule: settings.phone1_required || "required",
    dobRule: settings.dob_or_age_rule || "age_or_dob_required"
  };
}

/**
 * @returns {Promise<import("../utils/name-generation.js").NameDictionaryLookup[]>}
 */
async function loadNameDictionary() {
  const { rows } = await pool.query(
    `
      select arabic_text, english_text
      from name_dictionary
      where is_active = true
      order by arabic_text asc
    `
  );
  return /** @type {import("../utils/name-generation.js").NameDictionaryLookup[]} */ (rows);
}

/**
 * @param {PatientPayload} payload
 * @param {PatientRegistrationRules} rules
 * @param {import("../utils/name-generation.js").NameDictionaryLookup[]} dictionary
 */
async function validatePatientPayload(payload, rules, dictionary) {
  const {
    nationalId,
    nationalIdConfirmation,
    identifierType,
    identifierValue,
    arabicFullName,
    englishFullName,
    ageYears,
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
  const { nationalId: cleanNationalId, identifierValue: cleanIdentifierValue } = validateNationalId(
    nationalId, nationalIdConfirmation, resolvedIdentifierType, identifierValue, rules.nationalIdRule
  );
  const cleanPhone1 = validatePhone(phone1, "phone1", { required: rules.phoneRule !== "optional" });
  const cleanPhone2 = validatePhone(phone2, "phone2", { required: false });
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
    estimatedDob: finalDob || formatDateForSql(buildEstimatedDobFromAge(finalAge)),
    sex: resolvedSex,
    cleanPhone1,
    cleanPhone2,
    address: address.trim()
  };
}

/**
 * @param {UserId} patientId
 * @returns {Promise<PatientRow>}
 */
export async function getPatientById(patientId) {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId");
  const { rows } = await pool.query(
    `
      select id, mrn, national_id, identifier_type, identifier_value, arabic_full_name, english_full_name, age_years, sex, phone_1, phone_2, address, estimated_date_of_birth
      from patients
      where id = $1
      limit 1
    `,
    [cleanPatientId]
  );

  const patient = /** @type {PatientRow | undefined} */ (rows[0]);

  if (!patient) {
    throw new HttpError(404, "Patient not found.");
  }

  return patient;
}

/**
 * @param {UserId} patientId
 * @returns {Promise<{ noShowCount: number, lastNoShowDate: string | null }>}
 */
export async function getPatientNoShowSummary(patientId) {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId");
  const { rows } = await pool.query(
    `
      select
        count(*) filter (where status = 'no-show') as no_show_count,
        max(appointment_date) filter (where status = 'no-show') as last_no_show_date
      from appointments
      where patient_id = $1
    `,
    [cleanPatientId]
  );

  const summary = /** @type {PatientNoShowSummaryRow | undefined} */ (rows[0]);

  return {
    noShowCount: Number(summary?.no_show_count || 0),
    lastNoShowDate: summary?.last_no_show_date || null
  };
}

/**
 * @param {string} [searchTerm]
 * @returns {Promise<PatientRow[]>}
 */
export async function searchPatients(searchTerm = "") {
  const term = searchTerm.trim();
  const pattern = `%${term}%`;
  const normalizedPattern = `%${normalizeArabicName(term)}%`;
  const query = `
    select id, mrn, national_id, identifier_type, identifier_value, arabic_full_name, english_full_name, age_years, sex, phone_1, phone_2, address, estimated_date_of_birth
    from patients
    where
      $1 = ''
      or mrn ilike $2
      or national_id ilike $2
      or identifier_value ilike $2
      or phone_1 ilike $2
      or phone_2 ilike $2
      or arabic_full_name ilike $2
      or normalized_arabic_name ilike $3
      or english_full_name ilike $2
    order by created_at desc
    limit 25
  `;
  const { rows } = await pool.query(query, [term, pattern, normalizedPattern]);
  return /** @type {PatientRow[]} */ (rows);
}

/**
 * @param {PatientPayload} payload
 * @param {OptionalUserId} createdByUserId
 * @returns {Promise<PersistedPatientRow>}
 */
export async function createPatient(payload, createdByUserId) {
  const rules = await loadPatientRegistrationSettings();
  const dictionary = await loadNameDictionary();
  const validated = await validatePatientPayload(payload, rules, dictionary);

  try {
    const { rows } = await pool.query(
      `
        insert into patients (
          national_id,
          identifier_type,
          identifier_value,
          arabic_full_name,
          english_full_name,
          normalized_arabic_name,
          age_years,
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
          nullif($10, ''),
          nullif($11, ''),
          nullif($12, ''),
          $13,
          $13
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
        validated.estimatedDob,
        validated.sex,
        validated.cleanPhone1,
        validated.cleanPhone2,
        validated.address,
        createdByUserId
      ]
    );

    const createdPatient = /** @type {PersistedPatientRow | undefined} */ (rows[0]);

    if (!createdPatient) {
      throw new HttpError(500, "Failed to create patient.");
    }

    await logAuditEntry(
      {
        entityType: "patient",
        entityId: createdPatient.id,
        actionType: "create",
        oldValues: null,
        newValues: createdPatient,
        changedByUserId: createdByUserId
      }
    );

    return createdPatient;
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

/**
 * @param {UserId} patientId
 * @param {PatientPayload} payload
 * @param {OptionalUserId} updatedByUserId
 * @returns {Promise<PersistedPatientRow>}
 */
export async function updatePatient(patientId, payload, updatedByUserId) {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId");
  const previousPatient = await getPatientById(cleanPatientId);
  const rules = await loadPatientRegistrationSettings();
  const dictionary = await loadNameDictionary();
  const validated = await validatePatientPayload(payload, rules, dictionary);

  try {
    const { rows } = await pool.query(
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
          estimated_date_of_birth = $9,
          sex = $10,
          phone_1 = nullif($11, ''),
          phone_2 = nullif($12, ''),
          address = nullif($13, ''),
          updated_by_user_id = $14,
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
        validated.estimatedDob,
        validated.sex,
        validated.cleanPhone1,
        validated.cleanPhone2,
        validated.address,
        updatedByUserId
      ]
    );

    const updatedPatient = /** @type {PersistedPatientRow | undefined} */ (rows[0]);

    if (!updatedPatient) {
      throw new HttpError(500, "Failed to update patient.");
    }

    await logAuditEntry(
      {
        entityType: "patient",
        entityId: updatedPatient.id,
        actionType: "update",
        oldValues: previousPatient,
        newValues: updatedPatient,
        changedByUserId: updatedByUserId
      }
    );

    return updatedPatient;
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

/**
 * @param {UserId} patientId
 * @param {OptionalUserId} deletedByUserId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function deletePatient(patientId, deletedByUserId) {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId");
  const client = await pool.connect();

  try {
    await client.query("begin");
    const previousPatient = await getPatientById(cleanPatientId);

    const { rows: appointmentRows } = await client.query(
      `select id from appointments where patient_id = $1`,
      [cleanPatientId]
    );
    const appointmentIds = appointmentRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);

    if (appointmentIds.length > 0) {
      await client.query(`delete from queue_entries where appointment_id = any($1::bigint[])`, [appointmentIds]);
      await client.query(`delete from documents where appointment_id = any($1::bigint[]) or patient_id = $2`, [appointmentIds, cleanPatientId]);
      await client.query(`delete from appointment_status_history where appointment_id = any($1::bigint[])`, [appointmentIds]);
      await client.query(`delete from appointments where patient_id = $1`, [cleanPatientId]);
    } else {
      await client.query(`delete from documents where patient_id = $1`, [cleanPatientId]);
    }

    await client.query(`delete from patient_custom_values where patient_id = $1`, [cleanPatientId]);
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

/**
 * @param {MergePatientsPayload} payload
 * @param {OptionalUserId} updatedByUserId
 * @returns {Promise<PatientRow>}
 */
export async function mergePatients(payload, updatedByUserId) {
  const targetPatientId = normalizePositiveInteger(payload.targetPatientId, "targetPatientId");
  const sourcePatientId = normalizePositiveInteger(payload.sourcePatientId, "sourcePatientId");
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

    const { rows } = await client.query(
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
    await client.query(`delete from patients where id = $1`, [sourcePatientId]);

    const targetPatient = await client.query(
      `
        select id, mrn, national_id, arabic_full_name, english_full_name, age_years, sex, phone_1, phone_2, address, estimated_date_of_birth
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
        oldValues: { sourcePatientId, targetPatientId },
        newValues: { mergedInto: targetPatientId, removedPatientId: sourcePatientId },
        changedByUserId: updatedByUserId
      },
      client
    );

    await client.query("commit");
    const mergedPatient = /** @type {PatientRow | undefined} */ (targetPatient.rows[0]);

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
