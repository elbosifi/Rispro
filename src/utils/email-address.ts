import { HttpError } from "./http-error.js";

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailLike(value: string): boolean {
  return EMAIL_LIKE.test(value);
}

export function normalizeOptionalEmail(value: string | null | undefined): string | null {
  const email = String(value ?? "").trim();
  if (!email) return null;
  if (!isEmailLike(email)) throw new HttpError(400, "A valid email is required.");
  return email;
}

export function emailFromUsername(value: string | null | undefined): string | null {
  const username = String(value ?? "").trim();
  return isEmailLike(username) ? username : null;
}
