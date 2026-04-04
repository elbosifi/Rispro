// @ts-check

/**
 * Centralized Libyan National ID derivation utilities.
 * Shared between frontend and backend via the src/utils/ path.
 *
 * Format: 11 digits
 *   - Digit 1: sex (1 = male, 2 = female)
 *   - Digits 2-5: birth year (YYYY)
 *   - Remaining digits: sequential / regional codes
 */

const NATIONAL_ID_LENGTH = 11;
const VALID_NATIONAL_ID_REGEX = /^\d{11}$/;

/**
 * Check if a value is a valid 11-digit Libyan National ID.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidNationalId(value) {
  const clean = String(value || '').replace(/\D/g, '');
  return VALID_NATIONAL_ID_REGEX.test(clean);
}

/**
 * Derive sex from the first digit of a National ID.
 * @param {string} nationalId - cleaned 11-digit string
 * @returns {'M' | 'F' | ''}
 */
export function deriveSexFromNationalId(nationalId) {
  if (nationalId.length !== NATIONAL_ID_LENGTH) return '';
  const firstDigit = nationalId[0];
  if (firstDigit === '1') return 'M';
  if (firstDigit === '2') return 'F';
  return '';
}

/**
 * Derive birth year from digits 2-5 of a National ID.
 * @param {string} nationalId - cleaned 11-digit string
 * @returns {number | null}
 */
export function deriveBirthYearFromNationalId(nationalId) {
  if (nationalId.length !== NATIONAL_ID_LENGTH) return null;
  const yearStr = nationalId.slice(1, 5);
  const year = parseInt(yearStr, 10);
  const currentYear = new Date().getFullYear();
  if (year >= 1900 && year <= currentYear) {
    return year;
  }
  return null;
}

/**
 * Derive estimated date of birth (YYYY-01-01) from a National ID.
 * @param {string} nationalId - cleaned 11-digit string
 * @returns {string | null} - ISO date string or null
 */
export function deriveDobFromNationalId(nationalId) {
  const year = deriveBirthYearFromNationalId(nationalId);
  if (year === null) return null;
  return `${year}-01-01`;
}

/**
 * Calculate age in years from a DOB string (YYYY-MM-DD).
 * @param {string} dobIso - ISO date string
 * @returns {number | null}
 */
export function calculateAgeFromDob(dobIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dobIso)) return null;
  const parsed = new Date(`${dobIso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const today = new Date();
  let age = today.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - parsed.getUTCMonth();
  const dayDiff = today.getUTCDate() - parsed.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  if (!Number.isInteger(age) || age < 0 || age > 130) return null;
  return age;
}

/**
 * Given a national ID, return all derivable patient demographics.
 * Returns an object with only the fields that could be derived.
 * @param {string} nationalId - cleaned 11-digit string
 * @returns {{ sex?: 'M' | 'F', estimatedDateOfBirth?: string, ageYears?: number }}
 */
export function deriveDemographicsFromNationalId(nationalId) {
  /** @type {{ sex?: 'M' | 'F', estimatedDateOfBirth?: string, ageYears?: number }} */
  const result = {};

  if (!isValidNationalId(nationalId)) {
    return result;
  }

  const sex = deriveSexFromNationalId(nationalId);
  if (sex) result.sex = sex;

  const dob = deriveDobFromNationalId(nationalId);
  if (dob) {
    result.estimatedDateOfBirth = dob;
    const age = calculateAgeFromDob(dob);
    if (age !== null) result.ageYears = age;
  }

  return result;
}
