// @ts-check

/** @type {[RegExp, string][]} */
const arabicVariants = [
  [/[\u0623\u0625\u0622]/g, "\u0627"],
  [/\u0629/g, "\u0647"],
  [/\u0649/g, "\u064A"],
  [/\u0624/g, "\u0648"],
  [/\u0626/g, "\u064A"]
];

/**
 * @param {string | null | undefined} value
 */
export function normalizeArabicName(value) {
  let result = (value || "").trim().replace(/\s+/g, " ");

  for (const [pattern, replacement] of arabicVariants) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * @param {string | null | undefined} value
 */
export function normalizeLibyanPhone(value) {
  return (value || "").replace(/\D/g, "");
}

/**
 * @param {number} ageYears
 */
export function buildEstimatedDobFromAge(ageYears) {
  if (!Number.isInteger(ageYears) || ageYears < 0 || ageYears > 130) {
    return null;
  }

  const today = new Date();
  return new Date(today.getFullYear() - ageYears, today.getMonth(), today.getDate());
}

/**
 * @param {Date | null | undefined} date
 */
export function formatDateForSql(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
