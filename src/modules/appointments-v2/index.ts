/**
 * Appointments V2 — Module entry point.
 *
 * Exports all V2 routers for registration in the main app.
 * No logic here — only wiring.
 */

import { Router } from "express";
import { appointmentsV2Router } from "./api/routes/appointments-v2-routes.js";
import { schedulingV2Router } from "./api/routes/scheduling-v2-routes.js";
import { adminSchedulingV2Router } from "./api/routes/admin-scheduling-v2-routes.js";
import { lookupsV2Router } from "./api/routes/lookups-v2-routes.js";

/**
 * Create and return the complete V2 router tree.
 *
 * Mount points:
 *   /api/v2/appointments   — booking CRUD
 *   /api/v2/scheduling     — availability, suggestions, evaluate
 *   /api/v2/scheduling/admin — policy versioning
 *   /api/v2/lookups        — catalog lookups (modalities, exam types)
 */
export function createAppointmentsV2Router(): Router {
  const v2Router = Router();

  // Booking endpoints
  v2Router.use("/appointments", appointmentsV2Router);

  // Scheduling decision + availability endpoints
  v2Router.use("/scheduling", schedulingV2Router);

  // Admin policy versioning (nested under scheduling)
  v2Router.use("/scheduling/admin", adminSchedulingV2Router);

  // Catalog lookups (modalities, exam types)
  v2Router.use("/lookups", lookupsV2Router);

  return v2Router;
}

// Re-export individual routers for testing if needed
export { appointmentsV2Router } from "./api/routes/appointments-v2-routes.js";
export { schedulingV2Router } from "./api/routes/scheduling-v2-routes.js";
export { adminSchedulingV2Router } from "./api/routes/admin-scheduling-v2-routes.js";
export { lookupsV2Router } from "./api/routes/lookups-v2-routes.js";

// Re-export shared utilities
export { SchedulingError } from "./shared/errors/scheduling-error.js";

// Re-export decision types
export type { BookingDecision, BookingDecisionInput } from "./rules/models/booking-decision.js";

// Re-export DTOs
export type {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  AppointmentResponseDto,
} from "./api/dto/appointment.dto.js";

export type {
  AvailabilityQueryDto,
  SuggestionsQueryDto,
  EvaluateRequestDto,
  SchedulingDecisionDto,
  AvailabilityDayDto,
  SuggestionDto,
} from "./api/dto/scheduling.dto.js";

export type {
  CreatePolicyDraftDto,
  SavePolicyDraftDto,
  PublishPolicyDto,
  PolicyVersionResponseDto,
  PolicyConfigSnapshotDto,
} from "./api/dto/admin-scheduling.dto.js";
