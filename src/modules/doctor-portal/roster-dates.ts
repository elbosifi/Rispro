import { HttpError } from "../../utils/http-error.js";
import { getTripoliToday, validateIsoDate } from "../../utils/date.js";

export function validateRosterDates(start: string, end: string): void {
  try {
    validateIsoDate(start, "weekStartDate");
    validateIsoDate(end, "weekEndDate");
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  if (end < start)
    throw new HttpError(400, "Roster end must be on or after its start.");
  if (end < getTripoliToday())
    throw new HttpError(409, "Past roster edits are blocked.");
}

/** Match the first Sunday to the first Sunday, etc., preserving subsequent occurrences. */
export function mapRosterDate(
  date: string,
  sourceStart: string,
  targetStart: string,
  targetEnd: string,
): string | null {
  const dayMs = 86_400_000;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const sourceDay = new Date(`${sourceStart}T00:00:00Z`).getUTCDay();
  const targetDay = new Date(`${targetStart}T00:00:00Z`).getUTCDay();
  const firstSourceOffset = (weekday - sourceDay + 7) % 7;
  const occurrence = Math.floor(
    ((Date.parse(date) - Date.parse(sourceStart)) / dayMs - firstSourceOffset) /
      7,
  );
  const mapped = new Date(
    Date.parse(targetStart) +
      (((weekday - targetDay + 7) % 7) + occurrence * 7) * dayMs,
  )
    .toISOString()
    .slice(0, 10);
  return mapped >= targetStart && mapped <= targetEnd ? mapped : null;
}
