/**
 * Centralized Libyan National ID derivation utilities (frontend version).
 * Mirrors src/utils/national-id.js for use in React components.
 */

const NATIONAL_ID_LENGTH = 11;
const VALID_NATIONAL_ID_REGEX = /^\d{11}$/;

export function isValidNationalId(value: unknown): boolean {
  const clean = String(value || '').replace(/\D/g, '');
  return VALID_NATIONAL_ID_REGEX.test(clean);
}

export function deriveSexFromNationalId(nationalId: string): 'M' | 'F' | '' {
  if (nationalId.length !== NATIONAL_ID_LENGTH) return '';
  const firstDigit = nationalId[0];
  if (firstDigit === '1') return 'M';
  if (firstDigit === '2') return 'F';
  return '';
}

export function deriveBirthYearFromNationalId(nationalId: string): number | null {
  if (nationalId.length !== NATIONAL_ID_LENGTH) return null;
  const yearStr = nationalId.slice(1, 5);
  const year = parseInt(yearStr, 10);
  const currentYear = new Date().getFullYear();
  if (year >= 1900 && year <= currentYear) {
    return year;
  }
  return null;
}

export function deriveDobFromNationalId(nationalId: string): string | null {
  const year = deriveBirthYearFromNationalId(nationalId);
  if (year === null) return null;
  return `${year}-01-01`;
}

export function calculateAgeFromDob(dobIso: string): number | null {
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

export interface DerivedDemographics {
  sex?: 'M' | 'F';
  estimatedDateOfBirth?: string;
  ageYears?: number;
}

export function deriveDemographicsFromNationalId(nationalId: string): DerivedDemographics {
  const result: DerivedDemographics = {};

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
