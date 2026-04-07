import { HttpError } from "./http-error.js";
import type { UnknownRecord } from "../types/http.js";

export function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new HttpError(500, message);
  }

  return row;
}

export function asUnknownRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
