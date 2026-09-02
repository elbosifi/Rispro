import assert from "node:assert/strict";
import test from "node:test";
import { median, percentile, withTimelineMetrics } from "./reporting-board-metrics.js";
import type { ReportingBoardCaseRow } from "./reporting-board-types.js";

test("reporting board aggregate metrics preserve median and nearest-rank percentile behavior", () => {
  assert.equal(median([]), null);
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20]), 15);
  assert.equal(percentile([40, 10, 30, 20], 95), 40);
});

test("reporting board timeline metrics preserve assignment and completion ages", () => {
  const row = {
    appointmentStatus: "completed",
    assignmentStatus: "assigned",
    reportStatus: "draft",
    completedAt: "2026-01-01T10:00:00.000Z",
    firstAssignedAt: "2026-01-01T10:30:00.000Z",
    currentAssignedAt: "2026-01-01T11:00:00.000Z",
    reportFinalAt: null,
    dueAt: "2026-01-02",
  } as ReportingBoardCaseRow;

  const result = withTimelineMetrics(row, Date.parse("2026-01-01T12:00:00.000Z"));
  assert.equal(result.completedToAssignedMinutes, 30);
  assert.equal(result.currentAssignmentAgeMinutes, 60);
  assert.equal(result.completedToFinalMinutes, null);
  assert.equal(result.dueAt, "2026-01-02");
});
