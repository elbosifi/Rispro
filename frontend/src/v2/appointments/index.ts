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
  SpecialReasonCodeDto,
  BookingWithPatientInfo,
  ListBookingsResponse,
  RescheduleBookingRequest,
  RescheduleBookingResponse,
  PolicySnapshotDto,
  PolicyStatusDto,
  PolicyPreviewDto,
  FieldValidationErrorDto,
} from "./types";

export { RESCHEDULABLE_STATUSES, CANCELLABLE_STATUSES } from "./types";

// API hooks
export {
  fetchV2Availability,
  fetchV2Suggestions,
  evaluateV2Scheduling,
  fetchV2Modalities,
  fetchV2ExamTypes,
  fetchV2Lookups,
  fetchV2SpecialReasonCodes,
  createV2Booking,
  cancelV2Booking,
  rescheduleV2Booking,
  listV2Bookings,
  useV2Availability,
  useV2Suggestions,
  useV2Evaluate,
  useV2Lookups,
  useV2ExamTypes,
  useV2SpecialReasonCodes,
  useV2CreateBooking,
  useV2CancelBooking,
  useV2ListBookings,
  useV2RescheduleBooking,
  fetchV2PolicyStatus,
  createV2PolicyDraft,
  saveV2PolicyDraft,
  fetchV2PolicyPreview,
  fetchV2PolicyUsers,
  publishV2PolicyDraft,
  useV2PolicyStatus,
  useV2CreatePolicyDraft,
  useV2SavePolicyDraft,
  useV2PolicyPreview,
  useV2PolicyUsers,
  useV2PublishPolicyDraft,
} from "./api";

// Pages
export { SchedulingAdminV2Page } from "./scheduling-admin-page";
export { AppointmentCreatePage } from "./appointment-create-page";

// Components
export { PatientSearch } from "./components/patient-search";
export { CreateAppointmentTab } from "./components/CreateAppointmentTab";
export { useCreateAppointmentForm } from "./hooks/useCreateAppointmentForm";
export { useAppointmentAvailability } from "./hooks/useAppointmentAvailability";
