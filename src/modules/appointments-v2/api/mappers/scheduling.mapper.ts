/**
 * Appointments V2 — Scheduling mapper.
 *
 * TODO (Stage 5): Map internal decision objects to API response DTOs.
 */

import type { BookingDecision } from "../../rules/models/booking-decision.js";
import type { SchedulingDecisionDto } from "../dto/scheduling.dto.js";

export function mapToSchedulingDecisionDto(
  _decision: BookingDecision
): SchedulingDecisionDto {
  // TODO: Implement mapping (Stage 5)
  return {} as SchedulingDecisionDto;
}
