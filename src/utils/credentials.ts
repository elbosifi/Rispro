import { HttpError } from "./http-error.js";

export function normalizeUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function requireExactPassword(value: unknown, fieldName = "password"): string {
  const password = String(value ?? "");
  if (!password) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  if (password !== password.trim()) {
    throw new HttpError(400, `${fieldName} must not start or end with whitespace.`);
  }
  return password;
}
