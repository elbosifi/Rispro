import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(
  new URL("../../booking/services/status-booking.service.ts", import.meta.url),
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
});
