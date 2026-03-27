import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import {
  buildEstimatedDobFromAge,
  formatDateForSql,
  normalizeArabicName,
  normalizeLibyanPhone
} from "../utils/normalize.js";

function normalizePositiveInteger(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive whole number.`);
  }

  return parsed;
}

function validateNationalId(nationalId, nationalIdConfirmation) {
  const cleanId = (nationalId || "").replace(/\D/g, "");
  const cleanConfirmation = (nationalIdConfirmation || "").replace(/\D/g, "");

  if (cleanId.length !== 11) {
    throw new HttpError(400, "National ID must contain exactly 11 digits.");
  }

  if (cleanId !== cleanConfirmation) {
    throw new HttpError(400, "National ID confirmation does not match.");
  }

  return cleanId;
}

function validatePhone(phone, fieldName) {
  const normalized = normalizeLibyanPhone(phone);

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

function validatePatientPayload(payload) {
  const {
    nationalId,
    nationalIdConfirmation,
    mrn = "",
    arabicFullName,
    englishFullName,
    ageYears,
    sex,
    phone1,
    phone2 = "",
    address = ""
  } = payload;

  if (!arabicFullName || !englishFullName || !sex) {
    throw new HttpError(400, "arabicFullName, englishFullName, and sex are required.");
  }

  const cleanNationalId = validateNationalId(nationalId, nationalIdConfirmation);
  const cleanPhone1 = validatePhone(phone1, "phone1");
  const cleanPhone2 = validatePhone(phone2, "phone2");
  const parsedAge = Number(ageYears);

  if (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 130) {
    throw new HttpError(400, "ageYears must be a whole number between 0 and 130.");
  }

  return {
    mrn,
    cleanNationalId,
    arabicFullName: arabicFullName.trim(),
    englishFullName: englishFullName.trim(),
    normalizedArabicName: normalizeArabicName(arabicFullName),
    parsedAge,
    estimatedDob: formatDateForSql(buildEstimatedDobFromAge(parsedAge)),
    sex,
    cleanPhone1,
    cleanPhone2,
    address: address.trim()
  };
}

export async function getPatientById(patientId) {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId");
  const { rows } = await pool.query(
    `
      select id, mrn, national_id, arabic_full_name, english_full_name, age_years, sex, phone_1, phone_2, address, estimated_date_of_birth
      from patients
      where id = $1
      limit 1
    `,
    [cleanPatientId]
  );

  if (!rows[0]) {
    throw new HttpError(404, "Patient not found.");
  }

  return rows[0];
}

export async function searchPatients(searchTerm = "") {
  const term = searchTerm.trim();
  const pattern = `%${term}%`;
  const normalizedPattern = `%${normalizeArabicName(term)}%`;
  const query = `
    select id, mrn, national_id, arabic_full_name, english_full_name, age_years, sex, phone_1, phone_2, address, estimated_date_of_birth
    from patients
    where
      $1 = ''
      or mrn ilike $2
      or national_id ilike $2
      or phone_1 ilike $2
      or phone_2 ilike $2
      or arabic_full_name ilike $2
      or normalized_arabic_name ilike $3
      or english_full_name ilike $2
    order by created_at desc
    limit 25
  `;
  const { rows } = await pool.query(query, [term, pattern, normalizedPattern]);
  return rows;
}

export async function createPatient(payload, createdByUserId) {
  const validated = validatePatientPayload(payload);

  try {
    const { rows } = await pool.query(
      `
        insert into patients (
          mrn,
          national_id,
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
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          nullif($10, ''),
          nullif($11, ''),
          $12,
          $12
        )
        returning *
      `,
      [
        validated.mrn,
        validated.cleanNationalId,
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

    return rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "A patient with that national ID or MRN already exists.");
    }

    throw error;
  }
}

export async function updatePatient(patientId, payload, updatedByUserId) {
  const cleanPatientId = normalizePositiveInteger(patientId, "patientId");
  const validated = validatePatientPayload(payload);

  await getPatientById(cleanPatientId);

  try {
    const { rows } = await pool.query(
      `
        update patients
        set
          mrn = nullif($2, ''),
          national_id = $3,
          arabic_full_name = $4,
          english_full_name = $5,
          normalized_arabic_name = $6,
          age_years = $7,
          estimated_date_of_birth = $8,
          sex = $9,
          phone_1 = $10,
          phone_2 = nullif($11, ''),
          address = nullif($12, ''),
          updated_by_user_id = $13,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        cleanPatientId,
        validated.mrn,
        validated.cleanNationalId,
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

    return rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "Another patient already uses that national ID or MRN.");
    }

    throw error;
  }
}

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

    await client.query("commit");
    return targetPatient.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
