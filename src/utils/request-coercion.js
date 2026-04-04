// @ts-check

/** @typedef {import("../types/http.js").UserId} UserId */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function asString(value) {
  return String(value || "");
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function asOptionalString(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return String(value);
}

/**
 * @param {unknown} value
 * @returns {string[] | undefined}
 */
export function asStringArray(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  return [String(value)];
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function asBooleanFlag(value) {
  return String(value || "").trim() === "true";
}

/**
 * @param {unknown} value
 * @returns {boolean | undefined}
 */
export function asOptionalBoolean(value) {
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

/**
 * @param {unknown} value
 * @returns {UserId | undefined}
 */
export function asOptionalUserId(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  return String(value);
}

/**
 * @param {unknown} value
 * @returns {UserId}
 */
export function asUserId(value) {
  if (typeof value === "number") {
    return value;
  }

  return String(value || "");
}
