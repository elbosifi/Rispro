import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import {
  buildEstimatedDobFromAge,
  formatDateForSql,
  normalizeArabicName,
  normalizeLibyanPhone
} from "../utils/normalize.js";

function validateNationalId(nationalId, nationalIdConfirmation) {
  const cleanId = (nationalId || "").replace(/\D/g, "");
  const cleanConfirmation = (nationalIdConfirmation || "").replace(/\D/g, "");

  if (cleanId.length !== 13) {
    throw new HttpError(400, "National ID must contain exactly 13 digits.");
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

  if (normalized.length !== 11) {
    throw new HttpError(400, `${fieldName} must contain exactly 11 digits.`);
  }

  return normalized;
}

export async function searchPatients(searchTerm = "") {
  const query = `
    select id, mrn, national_id, arabic_full_name, english_full_name, age_years, sex, phone_1, phone_2, address, estimated_date_of_birth
    from patients
    where
      $1 = ''
      or national_id ilike $2
      or phone_1 ilike $2
      or phone_2 ilike $2
      or arabic_full_name ilike $2
      or english_full_name ilike $2
    order by created_at desc
    limit 25
  `;
  const term = searchTerm.trim();
  const pattern = `%${term}%`;
  const { rows } = await pool.query(query, [term, pattern]);
  return rows;
}

export async function createPatient(payload, createdByUserId) {
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

  const estimatedDob = formatDateForSql(buildEstimatedDobFromAge(parsedAge));
  const normalizedArabicName = normalizeArabicName(arabicFullName);

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
        mrn,
        cleanNationalId,
        arabicFullName.trim(),
        englishFullName.trim(),
        normalizedArabicName,
        parsedAge,
        estimatedDob,
        sex,
        cleanPhone1,
        cleanPhone2,
        address.trim(),
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
