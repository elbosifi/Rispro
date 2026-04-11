/**
 * Appointments V2 — Module entry point.
 *
 * Re-exports all V2 frontend components, hooks, and types.
 */

// Types
export type {
  CaseCategory,
  DecisionStatus,
  BookingStatus,
  DecisionReason,
  SchedulingDecisionDto,
  AvailabilityDayDto,
  AvailabilityResponse,
  SuggestionDto,
  SuggestionsResponse,
  EvaluateRequest,
  CreateBookingRequest,
  BookingResponse,
  ModalityDto,
  ExamTypeDto,
  LookupsResponse,
} from "./types";

// API hooks
export {
  fetchV2Availability,
  fetchV2Suggestions,
  evaluateV2Scheduling,
  fetchV2Modalities,
  fetchV2ExamTypes,
  fetchV2Lookups,
  createV2Booking,
  cancelV2Booking,
  useV2Availability,
  useV2Suggestions,
  useV2Evaluate,
  useV2Lookups,
  useV2ExamTypes,
  useV2CreateBooking,
  useV2CancelBooking,
} from "./api";

// Pages
export { AppointmentsV2Page } from "./page";

// Components
export { StatusBadge } from "./components/status-badge";
