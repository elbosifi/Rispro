import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./appointments-v2-pacs-auto-completion-worker.ts", import.meta.url), "utf8");

test("worker separates PACS start eligibility from PACS-owned in-progress tracking", () => {
  assert.match(source, /PACS_START_ELIGIBLE_STATUSES = \["scheduled", "arrived", "waiting"\]/);
  assert.match(source, /b\.status = any\(\$1::text\[\]\)[\s\S]*b\.status = 'in-progress'[\s\S]*b\.acquisition_status_source = 'pacs'/);
  assert.match(source, /inactivity_completion_minutes: number/);
});

test("worker excludes completed and other terminal statuses by allow-listing eligibility", () => {
  assert.ok(!source.includes(`PACS_START_ELIGIBLE_STATUSES = ["completed"`));
  assert.match(source, /b\.status = any\(\$1::text\[\]\)[\s\S]*b\.status = 'in-progress'/);
});

test("worker preserves manually disabled and MPPS-owned rows after for update re-check", () => {
  assert.match(source, /for update/);
  assert.match(source, /current\.status === "in-progress" && current\.acquisition_status_source === "pacs"/);
  assert.match(source, /current\.pacs_auto_completion_disabled_at/);
  assert.match(source, /return false/);
});

test("worker starts safe PACS evidence instead of immediately completing it", () => {
  assert.match(source, /result\.status === "matched" \|\| isBelowMinimumSeriesResult/);
  assert.match(source, /status = 'in-progress'/);
  assert.match(source, /actionType: "orthanc_auto_start"/);
  assert.match(source, /pacs_timing_checked_at = now\(\)/);
});

test("worker excludes bookings after manual or MPPS PACS override", () => {
  assert.match(source, /b\.pacs_auto_completion_disabled_at is null/);
  assert.match(source, /acquisition_status_source/);
  assert.match(source, /current\.pacs_auto_completion_disabled_at/);
});

test("worker completes only PACS-owned inactive bookings through the canonical transition service", () => {
  assert.match(source, /applyBookingTerminalTransition/);
  assert.match(source, /source: "pacs"/);
  assert.match(source, /current_timestamp >= pacs_last_activity_at \+ make_interval\(mins => \$2::int\)/);
  assert.match(source, /\[bookingId, setting\.inactivity_completion_minutes\]/);
  assert.doesNotMatch(source, /Date\.now\(\).*inactivity_completion_minutes/);
  assert.match(source, /entityType: "appointment_v2_booking"/);
  assert.doesNotMatch(source, /entityType: "appointments_v2_booking"/);
  assert.match(source, /verificationCheckId: historyId/);
});

test("worker persists PACS timing while it starts and tracks acquisition", () => {
  assert.match(source, /pacs_study_started_at = coalesce\(pacs_study_started_at/);
  assert.match(source, /pacs_first_seen_at = coalesce\(pacs_first_seen_at/);
  assert.match(source, /pacs_timing_source = \$7/);
  assert.match(source, /pacs_timing_checked_at = now\(\)/);
  assert.match(source, /result\.studyStartedAt/);
  assert.match(source, /result\.pacsFirstSeenAt/);
  assert.match(source, /result\.timingSource/);
  assert.match(source, /result\.timingConfidence/);
});

test("worker audit payload records persisted PACS timing and activity fields", () => {
  assert.match(source, /pacsStudyStartedAt: result\.studyStartedAt/);
  assert.match(source, /pacsFirstSeenAt: result\.pacsFirstSeenAt/);
  assert.match(source, /pacsTimingSource: result\.timingSource/);
  assert.match(source, /pacsTimingConfidence: result\.timingConfidence/);
});

test("worker runs shared terminal post-commit effects after PACS completion", () => {
  assert.match(source, /runBookingTerminalTransitionPostCommit/);
  assert.match(source, /reportingIntentNotification: terminalTransition\.reportingIntentNotification/);
});

test("worker defers below-minimum discontinuation until PACS inactivity", () => {
  assert.match(source, /below_minimum_series_action/);
  assert.match(source, /series_count_below_minimum/);
  assert.match(source, /current\.pacs_inactivity_elapsed/);
  assert.match(source, /targetStatus === "discontinued" && setting\.below_minimum_series_action !== "discontinue"/);
  assert.match(source, /source: "pacs"/);
  assert.match(source, /applyBookingTerminalTransition/);
});

test("worker marks only completed PACS verification history as completed", () => {
  assert.match(source, /if \(targetStatus === "completed"\) \{\s*await markHistoryCompleted\(historyId, client\);/);
});

test("worker isolates post-commit PACS-start MWL scheduling failures", () => {
  assert.match(source, /schedulePacsStartWorklistSync/);
  assert.match(source, /appointments_v2_pacs_auto_start_worklist_sync_schedule_failed/);
  assert.match(source, /try \{\s*schedulePacsStartWorklistSync\(bookingId\);\s*\} catch/);
});

test("worker distinguishes strict start evidence from zero-instance tracking evidence", () => {
  assert.match(source, /function isSafePacsStartObservation/);
  assert.match(source, /function isTrackablePacsObservation/);
  assert.match(source, /result\.lastError === "instance_count_zero"/);
  assert.match(source, /if \(!isSafePacsStartObservation\(result\)\)/);
  assert.match(source, /if \(!isTrackablePacsObservation\(result\)\)/);
  assert.match(source, /result\.status === "matched"\s*\? "completed"\s*:\s*null/);
});

test("worker does not auto-discontinue unavailable series counts", () => {
  assert.match(source, /result\.lastError === "series_count_below_minimum"/);
  assert.doesNotMatch(source, /series_count_unavailable[\s\S]*status = 'discontinued'/);
});

test("worker setting defaults include minimum series count of 2", () => {
  assert.match(source, /coalesce\(s\.minimum_series_count, 2\) as minimum_series_count/);
  assert.match(source, /normalizePositive\(payload\.minimumSeriesCount \?\? payload\.minimum_series_count, "minimumSeriesCount", 2\)/);
});

test("worker updates settings last check fields", () => {
  assert.match(source, /last_check_status = \$2/);
  assert.match(source, /last_check_result_json = \$3::jsonb/);
  assert.match(source, /last_error = \$4/);
  assert.match(source, /last_checked_at = now\(\)/);
});

test("worker writes verification history row for every check", () => {
  assert.match(source, /insert into appointments_v2\.pacs_auto_completion_verification_history/);
  assert.match(source, /completed_booking/);
});

test("worker records Orthanc failures without blocking manual completion paths", () => {
  assert.match(source, /result_status/);
  assert.match(source, /last_error/);
  assert.ok(!source.includes("markAppointmentCompleted"));
  assert.ok(!source.includes("modality-service"));
});

test("manual PACS auto-completion test preserves response shape and adds diagnostics", () => {
  assert.match(source, /return \{\s*result,\s*history,\s*bookingId: Number\(booking\.id\),\s*diagnostics: buildTestDiagnostics\(booking, setting, result\),\s*\}/);
  assert.match(source, /export interface PacsAutoCompletionTestDiagnostics/);
  assert.match(source, /expectedAccession: booking\.accession_number/);
  assert.match(source, /candidateCount: readCandidateCount\(result\.resultJson\)/);
  assert.match(source, /legacyRawAccessionFallbackUsed/);
});

test("manual PACS auto-completion test accepts pasted V2 accession text as bookingId input", () => {
  assert.match(source, /function normalizeTestBookingId/);
  assert.match(source, /\^V2-\(\\d\+\)\$/);
  assert.match(source, /normalizePositiveInteger\(accessionMatch\[1\], "bookingId"\)/);
});

test("PACS auto-completion booking projections use canonical padded accession", () => {
  assert.match(source, /\('V2-' \|\| lpad\(b\.id::text, 6, '0'\)\) as accession_number/);
  assert.ok(!source.includes("('V2-' || b.id::text) as accession_number"));
});
