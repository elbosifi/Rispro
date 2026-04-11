/**
 * Appointments V2 — Suggestion service (stub).
 *
 * TODO (Stage 5): Return next available appointment suggestions.
 */

export interface SuggestionDto {
  date: string;
  modalityId: number;
  decision: import("../../rules/models/booking-decision.js").BookingDecision;
}

export async function getSuggestions(
  _modalityId: number,
  _days: number,
  _examTypeId?: number | null,
  _caseCategory?: "oncology" | "non_oncology"
): Promise<SuggestionDto[]> {
  // TODO: Implement suggestion logic (Stage 5)
  return [];
}
