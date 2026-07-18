import test from "node:test";
import assert from "node:assert/strict";
import { backupV3ScheduleSlot, nextBackupV3ScheduleRun } from "./backup-v3-scheduling.js";

test("next backup schedule run uses the configured Africa/Tripoli local clock", () => {
  const next = nextBackupV3ScheduleRun({ frequency: "daily", timeOfDay: "02:00", timezone: "Africa/Tripoli", selectedWeekdays: [], selectedDayOfMonth: null }, new Date("2026-07-18T22:30:00.000Z"));
  assert.equal(backupV3ScheduleSlot({ frequency: "daily", timeOfDay: "02:00", timezone: "Africa/Tripoli", selectedWeekdays: [], selectedDayOfMonth: null }, next), "2026-07-19T02:00[Africa/Tripoli]");
});

test("weekdays default to Monday through Friday and honor an explicit weekday list", () => {
  const defaultWeekdays = { frequency: "weekdays" as const, timeOfDay: "09:00", timezone: "UTC", selectedWeekdays: [], selectedDayOfMonth: null };
  const nextDefault = nextBackupV3ScheduleRun(defaultWeekdays, new Date("2026-07-17T09:00:00.000Z"));
  assert.equal(nextDefault.toISOString(), "2026-07-20T09:00:00.000Z");
  const explicitSaturday = { ...defaultWeekdays, selectedWeekdays: [6] };
  const nextSaturday = nextBackupV3ScheduleRun(explicitSaturday, new Date("2026-07-17T09:00:00.000Z"));
  assert.equal(nextSaturday.toISOString(), "2026-07-18T09:00:00.000Z");
});
