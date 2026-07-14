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
  EvaluateRequest,
  CreateBookingRequest,
  BookingResponse,
  ModalityDto,
  ExamTypeDto,
  LookupsResponse,
  SpecialReasonCodeDto,
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
  evaluateV2Scheduling,
  fetchV2Modalities,
  fetchV2ExamTypes,
  fetchV2Lookups,
  fetchV2SpecialReasonCodes,
  createV2Booking,
  rescheduleV2Booking,
  useV2Availability,
  useV2Lookups,
  useV2ExamTypes,
  useV2SpecialReasonCodes,
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
export { SchedulingAdminPage } from "./scheduling-admin-page";
export { AppointmentCreatePage } from "./appointment-create-page";

// Components
export { PatientSearch } from "./components/patient-search";
export { CreateAppointmentTab } from "./components/CreateAppointmentTab";
export { useCreateAppointmentForm } from "./hooks/useCreateAppointmentForm";
export { useAppointmentAvailability } from "./hooks/useAppointmentAvailability";
