// @ts-check

/** @typedef {import("../types/domain.js").Role} Role */

/** @type {readonly Role[]} */
export const ROLE_VALUES = ["receptionist", "supervisor", "modality_staff"];

/**
 * @param {unknown} value
 * @returns {value is Role}
 */
export function isRole(value) {
  return typeof value === "string" && ROLE_VALUES.includes(/** @type {Role} */ (value));
}
