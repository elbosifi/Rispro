import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";

const source = await fs.readFile(new URL("./reschedule-booking.service.ts", import.meta.url), "utf8");

test("appointment detail edits use Sante replacement sync path", () => {
  assert.match(source, /scheduleBookingWorklistDetailReplacement/);
  assert.doesNotMatch(source, /scheduleBookingWorklistSync\(bookingId\)/);
});
