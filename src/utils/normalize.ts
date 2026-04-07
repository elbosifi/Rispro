import { HttpError } from "./http-error.js";

const arabicVariants: [RegExp, string][] = [
  [/[\u0623\u0625\u0622]/g, "\u0627"],
  [/\u0629/g, "\u0647"],
  [/\u0649/g, "\u064A"],
  [/\u0624/g, "\u0648"],
  [/\u0626/g, "\u064A"]
];

export interface NormalizePositiveIntegerOptions {
  required?: boolean;
  max?: number;
}

/**
 * Validate and normalize a value to a positive integer.
 * @param value - The value to normalize
 * @param fieldName - Field name for error messages
 * @param options - Optional: `required` (default true), `max` (no upper limit by default)
 * @returns The normalized number, or null if not required and value is empty
 */
export function normalizePositiveInteger(
  value: unknown,
  fieldName: string,
  { required = true, max }: NormalizePositiveIntegerOptions = {}
): number | null {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new HttpError(400, `${fieldName} is required.`);
    }
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive whole number.`);
  }

  if (max !== undefined && parsed > max) {
    throw new HttpError(400, `${fieldName} must not exceed ${max}.`);
  }

  return parsed;
}

export function normalizeArabicName(value: unknown): string {
  let result = String(value || "").trim().replace(/\s+/g, " ");

  for (const [pattern, replacement] of arabicVariants) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

export function normalizeLibyanPhone(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function buildEstimatedDobFromAge(ageYears: number): Date | null {
  if (!Number.isInteger(ageYears) || ageYears < 0 || ageYears > 130) {
    return null;
  }

  const today = new Date();
  return new Date(today.getFullYear() - ageYears, today.getMonth(), today.getDate());
}

export function formatDateForSql(date: Date | null | undefined): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
