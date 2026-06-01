import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(
  new URL("../../booking/services/status-booking.service.ts", import.meta.url),
  "utf8"
);
const readV2RoutesSource = readFileSync(
  new URL("../../api/routes/read-v2-routes.ts", import.meta.url),
  "utf8"
);

describe("status booking service source guards", () => {
  it("allows manual status targets but rejects voided", () => {
    assert.match(source, /MANUAL_STATUS_TARGETS/);
    assert.match(source, /"completed"/);
    assert.match(source, /"no-show"/);
    assert.match(source, /targetStatus === "voided"/);
  });

  it("requires reasons for no-show, cancelled, and discontinued", () => {
    assert.match(source, /REASON_REQUIRED_STATUSES/);
    assert.match(source, /"no-show", "cancelled", "discontinued"/);
    assert.match(source, /status_reason_required/);
  });

  it("auto no-show only updates scheduled bookings", () => {
    assert.match(source, /status = 'scheduled'/);
    assert.doesNotMatch(source, /status in \('scheduled', 'arrived', 'waiting'\)/);
  });

  it("auto no-show is controlled by an explicit auto setting", () => {
    assert.match(source, /auto_no_show_enabled/);
    assert.match(source, /autoNoShowEnabled/);
    assert.match(source, /!settings\.autoNoShowEnabled/);
  });

  it("bulk cleanup only targets older scheduled bookings", () => {
    assert.match(source, /booking_date < \(\$1::date - \(\$2::int \* interval '1 day'\)\)/);
    assert.match(source, /old_no_show_bulk_confirm/);
  });

  it("bulk cleanup is capped to the reviewed candidate batch", () => {
    assert.match(source, /with candidates as/);
    assert.match(source, /limit 200/);
  });

  it("syncs worklists after status changes", () => {
    assert.match(source, /scheduleBookingWorklistSync\(bookingId\)/);
    assert.match(source, /for \(const bookingId of markedIds\)/);
  });

  it("V2 manual status update cannot set arrived/waiting without patient queue requirements", () => {
    assert.match(source, /assertPatientMeetsBookingQueueRequirements/);
    assert.match(source, /patient_id,[\s\S]*status,[\s\S]*booking_date::text/);
    assert.match(source, /targetStatus === "arrived" \|\| targetStatus === "waiting"/);
    assert.match(source, /assertPatientMeetsBookingQueueRequirements\(client, Number\(booking\.patient_id\), userRole\)/);
  });

  it("manual reversal of Orthanc auto-completed bookings disables future auto-completion", () => {
    assert.match(source, /auto_completed_by/);
    assert.match(source, /booking\.status === "completed"[\s\S]*targetStatus !== "completed"[\s\S]*orthanc_pacs_auto_completion/);
    assert.match(source, /pacs_auto_completion_disabled_at = case when \$4 then now\(\)/);
    assert.match(source, /orthanc_auto_completion_disabled/);
    assert.match(source, /autoCompletionDisabledMessage/);
  });

  it("manual reversal does not disable future auto-completion for non-Orthanc completed bookings", () => {
    assert.match(source, /booking\.auto_completed_by === "orthanc_pacs_auto_completion"/);
    assert.match(source, /!booking\.pacs_auto_completion_disabled_at/);
  });

  it("manual status update to non-queue statuses keeps existing behavior", () => {
    assert.match(source, /MANUAL_STATUS_TARGETS/);
    assert.match(source, /"completed"/);
    assert.match(source, /"no-show"/);
    assert.doesNotMatch(source, /targetStatus === "completed"[\s\S]*assertPatientMeetsBookingQueueRequirements/);
  });

  it("V2 queue scan cannot set arrived without patient queue requirements", () => {
    assert.match(readV2RoutesSource, /"\/queue\/scan"/);
    assert.match(readV2RoutesSource, /select id, patient_id, status[\s\S]*for update/);
    assert.match(readV2RoutesSource, /assertPatientMeetsBookingQueueRequirements\(client, Number\(booking\.patient_id\), user\?\.role\)/);
    assert.match(readV2RoutesSource, /set status = 'arrived'/);
  });
});
