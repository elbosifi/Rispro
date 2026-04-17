/**
 * Appointments V2 — Suggestion service.
 *
 * Returns the next N available dates where a booking can be made,
 * based on the availability service's decision engine output.
 * Filters out blocked, full, and restricted (without override) dates.
 */

import { getAvailability, type GetAvailabilityParams } from "./availability.service.js";
import type { SchedulingDecisionDto } from "../../api/dto/scheduling.dto.js";
import type { AvailabilityDayDto } from "../../scheduler/services/availability.service.js";

export interface SuggestionDto {
  date: string;
  modalityId: number;
  decision: SchedulingDecisionDto;
}

export interface GetSuggestionsParams {
  modalityId: number;
  days: number;
  examTypeId?: number | null;
  caseCategory?: "oncology" | "non_oncology";
  includeOverrideCandidates?: boolean;
}

/** Map a domain BookingDecision to the API-facing SchedulingDecisionDto */
function mapDecisionToDto(day: AvailabilityDayDto): SchedulingDecisionDto {
  const { decision } = day;
  return {
    isAllowed: decision.isAllowed,
    requiresSupervisorOverride: decision.requiresSupervisorOverride,
    displayStatus: decision.displayStatus,
    suggestedBookingMode: decision.suggestedBookingMode,
    consumedCapacityMode: decision.consumedCapacityMode,
    remainingStandardCapacity: decision.remainingStandardCapacity,
    remainingSpecialQuota: decision.remainingSpecialQuota,
    matchedRuleIds: decision.matchedRuleIds,
    matchedExamRuleSummaries: decision.matchedExamRuleSummaries,
    reasons: decision.reasons,
    policy: {
      policySetKey: decision.policyVersionRef.policySetKey,
      versionId: decision.policyVersionRef.versionId,
      versionNo: decision.policyVersionRef.versionNo,
      configHash: decision.policyVersionRef.configHash,
    },
    decisionTrace: decision.decisionTrace,
  };
}

export async function getSuggestions(
  params: GetSuggestionsParams
): Promise<SuggestionDto[]> {
  const availabilityParams: GetAvailabilityParams = {
    modalityId: params.modalityId,
    days: params.days,
    offset: 0,
    examTypeId: params.examTypeId ?? null,
    caseCategory: params.caseCategory ?? "non_oncology",
    includeOverrideCandidates: params.includeOverrideCandidates ?? false,
  };

  const availability = await getAvailability(availabilityParams);

  // Filter for bookable dates: not blocked, not full, and either allowed or override-available
  const suggestions: SuggestionDto[] = [];
  for (const day of availability) {
    const { decision } = day;
    const isBookable =
      decision.isAllowed ||
      (decision.requiresSupervisorOverride && decision.displayStatus !== "blocked");

    if (isBookable && !day.isFull) {
      suggestions.push({
        date: day.date,
        modalityId: params.modalityId,
        decision: mapDecisionToDto(day),
      });
    }

    // Stop once we have enough suggestions
    if (suggestions.length >= params.days) {
      break;
    }
  }

  return suggestions;
}
