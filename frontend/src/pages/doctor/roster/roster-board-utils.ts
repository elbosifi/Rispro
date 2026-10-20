import type { TranslationKey } from "@/lib/i18n";
import type {
  DoctorProfileRole,
  DoctorRosterWeek,
  RosterDutyTypeConfig,
} from "@/types/api";

export const DOCTOR_GRADES = [
  "consultant",
  "specialist",
  "senior_house_officer",
  "resident",
] as const satisfies readonly DoctorProfileRole[];
export function addRosterDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
export function tripoliDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (key: string) => parts.find((part) => part.type === key)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
/** Creation always starts on the next Sunday, including when today is Sunday. */
export function nextRosterRange(now = new Date()) {
  const today = tripoliDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = addRosterDays(today, (7 - weekday) % 7 || 7);
  return { start, end: addRosterDays(start, 4) };
}
export function rosterDays(start: string, end: string): string[] {
  if (!start || !end || end < start) return [];
  const count =
    Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  return Array.from({ length: count }, (_, index) =>
    addRosterDays(start, index),
  );
}
export function previewRosterDate(
  date: string,
  sourceStart: string,
  start: string,
  end: string,
): string | null {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const sourceDay = new Date(`${sourceStart}T00:00:00Z`).getUTCDay();
  const targetDay = new Date(`${start}T00:00:00Z`).getUTCDay();
  const occurrence = Math.floor(
    ((Date.parse(date) - Date.parse(sourceStart)) / 86_400_000 -
      ((weekday - sourceDay + 7) % 7)) /
      7,
  );
  const mapped = addRosterDays(
    start,
    ((weekday - targetDay + 7) % 7) + occurrence * 7,
  );
  return mapped >= start && mapped <= end ? mapped : null;
}
export function preferredRosterSource(
  weeks: DoctorRosterWeek[],
  start: string,
): DoctorRosterWeek | undefined {
  const earlier = weeks
    .filter((week) => week.weekEndDate < start)
    .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));
  return earlier.find((week) => week.status === "published") ?? earlier[0];
}

export function configuredRosterDutyLabel(
  duty: RosterDutyTypeConfig,
  t: (key: TranslationKey) => string,
): string {
  if (!duty.builtIn) return duty.label;
  const key = `roster.dutyLabel.${duty.code}` as TranslationKey;
  const localized = t(key);
  return localized === key ? duty.label : localized;
}
