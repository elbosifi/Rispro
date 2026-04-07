import type { UserId } from '../types/http.js';

export function asString(value: unknown): string {
  return String(value || "");
}

export function asOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return String(value);
}

export function asStringArray(value: unknown): string[] | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  return [String(value)];
}

export function asBooleanFlag(value: unknown): boolean {
  return String(value || "").trim() === "true";
}

export function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "enabled", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "disabled", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function asOptionalUserId(value: unknown): UserId | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  return String(value);
}

export function asUserId(value: unknown): UserId {
  if (typeof value === "number") {
    return value;
  }

  return String(value || "");
}
