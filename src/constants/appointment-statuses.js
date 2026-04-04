// @ts-check

/** @typedef {import("../types/domain.js").AppointmentStatus} AppointmentStatus */

export const APPOINTMENT_STATUS_SCHEDULED = "scheduled";
export const APPOINTMENT_STATUS_ARRIVED = "arrived";
export const APPOINTMENT_STATUS_WAITING = "waiting";
export const APPOINTMENT_STATUS_IN_PROGRESS = "in-progress";
export const APPOINTMENT_STATUS_COMPLETED = "completed";
export const APPOINTMENT_STATUS_DISCONTINUED = "discontinued";
export const APPOINTMENT_STATUS_NO_SHOW = "no-show";
export const APPOINTMENT_STATUS_CANCELLED = "cancelled";

/** @type {readonly AppointmentStatus[]} */
export const APPOINTMENT_RECEPTION_ACTIVE_STATUSES = [
  APPOINTMENT_STATUS_SCHEDULED,
  APPOINTMENT_STATUS_ARRIVED,
  APPOINTMENT_STATUS_WAITING
];

/** @type {readonly AppointmentStatus[]} */
export const APPOINTMENT_NON_CANCELLABLE_STATUSES = [
  APPOINTMENT_STATUS_CANCELLED,
  APPOINTMENT_STATUS_COMPLETED,
  APPOINTMENT_STATUS_DISCONTINUED,
  APPOINTMENT_STATUS_NO_SHOW,
  APPOINTMENT_STATUS_IN_PROGRESS
];

/** @type {readonly AppointmentStatus[]} */
export const APPOINTMENT_QUEUE_CLOSED_STATUSES = [
  APPOINTMENT_STATUS_CANCELLED,
  APPOINTMENT_STATUS_COMPLETED,
  APPOINTMENT_STATUS_NO_SHOW
];

/** @type {readonly AppointmentStatus[]} */
export const APPOINTMENT_QUEUE_WORKING_STATUSES = [
  APPOINTMENT_STATUS_ARRIVED,
  APPOINTMENT_STATUS_WAITING,
  APPOINTMENT_STATUS_IN_PROGRESS
];

/** @type {readonly AppointmentStatus[]} */
export const APPOINTMENT_ACTIVE_WORKLIST_STATUSES = [
  APPOINTMENT_STATUS_SCHEDULED,
  APPOINTMENT_STATUS_ARRIVED,
  APPOINTMENT_STATUS_WAITING,
  APPOINTMENT_STATUS_IN_PROGRESS
];

/** @type {readonly AppointmentStatus[]} */
export const APPOINTMENT_LISTABLE_STATUSES = [
  APPOINTMENT_STATUS_SCHEDULED,
  APPOINTMENT_STATUS_ARRIVED,
  APPOINTMENT_STATUS_WAITING,
  APPOINTMENT_STATUS_COMPLETED,
  APPOINTMENT_STATUS_NO_SHOW,
  APPOINTMENT_STATUS_CANCELLED
];

/**
 * @param {unknown} value
 * @returns {value is AppointmentStatus}
 */
export function isListableAppointmentStatus(value) {
  return typeof value === "string" && APPOINTMENT_LISTABLE_STATUSES.includes(/** @type {AppointmentStatus} */ (value));
}
