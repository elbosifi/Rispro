/**
 * Appointments V2 — Shared type definitions.
 *
 * These types are used across scheduler, rules, booking, and admin modules.
 */

export type CaseCategory = "oncology" | "non_oncology";

export type BookingStatus =
  | "scheduled"
  | "arrived"
  | "waiting"
  | "completed"
  | "no-show"
  | "cancelled";

export type DecisionStatus = "available" | "restricted" | "blocked";

export type PolicyStatus = "draft" | "published" | "archived";

export interface ReasonCode {
  code: string;
  severity: "error" | "warning";
  message: string;
  ruleRef?: { type: string; id: number };
}

export interface PaginationParams {
  offset: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Booking statuses that allow rescheduling.
 *
 * Used by both backend (reschedule service validation) and frontend
 * (reschedule button disabled state). Single source of truth — do not
 * duplicate this list elsewhere.
 */
export const RESCHEDULABLE_STATUSES: readonly BookingStatus[] = [
  "scheduled",
  "arrived",
  "waiting",
];

/**
 * Booking statuses that allow cancellation.
 *
 * Completed and no-show bookings represent past events and should not be
 * cancellable. Used by both backend (cancel service validation) and
 * frontend (cancel button disabled state).
 */
export const CANCELLABLE_STATUSES: readonly BookingStatus[] = [
  "scheduled",
  "arrived",
  "waiting",
];
