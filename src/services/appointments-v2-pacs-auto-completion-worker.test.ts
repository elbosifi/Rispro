import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./appointments-v2-pacs-auto-completion-worker.ts", import.meta.url), "utf8");

test("worker completes only scheduled, arrived, and waiting bookings", () => {
  assert.match(source, /ELIGIBLE_BOOKING_STATUSES = \["scheduled", "arrived", "waiting"\]/);
  assert.match(source, /b\.status = any\(\$1::text\[\]\)/);
});

test("worker excludes completed and other terminal statuses by allow-listing eligibility", () => {
  assert.ok(!source.includes(`ELIGIBLE_BOOKING_STATUSES = ["completed"`));
  assert.match(source, /status = 'completed'/);
});

test("worker preserves manually or MPPS completed rows after for update re-check", () => {
  assert.match(source, /for update/);
  assert.match(source, /!ELIGIBLE_BOOKING_STATUSES\.includes/);
  assert.match(source, /return false/);
});

test("worker writes orthanc_auto_complete audit payload", () => {
  assert.match(source, /actionType: "orthanc_auto_complete"/);
  assert.match(source, /entityType: "appointments_v2_booking"/);
  assert.match(source, /verificationCheckId: historyId/);
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
});
