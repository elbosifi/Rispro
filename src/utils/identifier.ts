import { HttpError } from "./http-error.js";

export function normalizeIdentifierValue(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

export function ensureIdentifierValue(value: unknown, fieldName = "identifierValue"): string {
  const normalized = normalizeIdentifierValue(value);
  if (!normalized) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  return normalized;
}
