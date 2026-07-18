import type { BackupScheduleFrequency } from "./backup-v3-control-center-service.js";

export interface BackupV3ScheduleTiming {
  frequency: BackupScheduleFrequency;
  timeOfDay: string;
  timezone: string;
  selectedWeekdays: number[];
  selectedDayOfMonth: number | null;
}

interface LocalScheduleParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  weekday: number;
}

function localScheduleParts(date: Date, timezone: string): LocalScheduleParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const weekdayName = value("weekday");
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[weekdayName];
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), weekday };
}

function matchesLocalSchedule(schedule: BackupV3ScheduleTiming, parts: LocalScheduleParts): boolean {
  const matchesDay = schedule.frequency === "daily"
    || (schedule.frequency === "weekdays" && (schedule.selectedWeekdays.length ? schedule.selectedWeekdays.includes(parts.weekday) : parts.weekday >= 1 && parts.weekday <= 5))
    || (schedule.frequency === "weekly" && schedule.selectedWeekdays.includes(parts.weekday))
    || (schedule.frequency === "monthly" && schedule.selectedDayOfMonth === Number(parts.day));
  return matchesDay && `${parts.hour}:${parts.minute}` === schedule.timeOfDay;
}

export function backupV3ScheduleSlot(schedule: BackupV3ScheduleTiming, date: Date): string {
  const parts = localScheduleParts(date, schedule.timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}[${schedule.timezone}]`;
}

/**
 * Produces the next wall-clock schedule occurrence after `after`.  Iterating
 * UTC minutes keeps the calculation correct through IANA-zone DST gaps and
 * repeats; duplicate repeated wall-clock slots are de-duplicated by the slot
 * stored with the schedule claim.
 */
export function nextBackupV3ScheduleRun(schedule: BackupV3ScheduleTiming, after = new Date()): Date {
  let candidate = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  const maxMinutes = 370 * 24 * 60;
  for (let minute = 0; minute < maxMinutes; minute += 1) {
    if (matchesLocalSchedule(schedule, localScheduleParts(candidate, schedule.timezone))) return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new Error("Backup schedule has no occurrence within the next 370 days.");
}
