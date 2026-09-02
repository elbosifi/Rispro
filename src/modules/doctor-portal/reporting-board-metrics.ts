import type { ReportingBoardCaseRow } from "./reporting-board-types.js";

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 60000);
}

export function minutesSince(start: string | null | undefined, nowMs: number): number | null {
  const startMs = timestampMs(start);
  if (startMs === null || nowMs < startMs) return null;
  return Math.floor((nowMs - startMs) / 60000);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

export function withTimelineMetrics(row: ReportingBoardCaseRow, nowMs = Date.now()): ReportingBoardCaseRow {
  const completedToAssignedMinutes = minutesBetween(row.completedAt, row.firstAssignedAt);
  const assignedToFinalMinutes = row.reportFinalAt ? minutesBetween(row.currentAssignedAt, row.reportFinalAt) : null;
  const completedToFinalMinutes = row.reportFinalAt ? minutesBetween(row.completedAt, row.reportFinalAt) : null;
  const activeNonFinal = row.assignmentStatus === "assigned" && row.reportStatus !== "final";
  const completedUnassigned = row.appointmentStatus === "completed" && row.assignmentStatus === "unassigned" && !row.reportFinalAt;
  return {
    ...row,
    dueAt: row.dueAt ?? null,
    completedToAssignedMinutes,
    assignedToFinalMinutes,
    completedToFinalMinutes,
    currentAssignmentAgeMinutes: activeNonFinal ? minutesSince(row.currentAssignedAt, nowMs) : null,
    completedUnassignedAgeMinutes: completedUnassigned ? minutesSince(row.completedAt, nowMs) : null,
  };
}
