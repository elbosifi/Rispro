// @ts-check

/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @param {unknown} value
 * @returns {UnknownRecord}
 */
export function asUnknownRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {UnknownRecord} */ (value)
    : {};
}
