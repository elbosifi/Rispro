import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";

const source = await fs.readFile(new URL("./patient-service.ts", import.meta.url), "utf8");

test("patient detail edits sync only queued bookings to Sante via replacement path", () => {
  assert.match(source, /queueOnly\?: boolean/);
  assert.match(source, /b\.status in \('arrived', 'waiting'\)/);
  assert.match(source, /scheduleBookingWorklistDetailReplacement/);
  assert.match(source, /listV2BookingIdsForPatientSync\(client, \[cleanPatientId\], \{ queueOnly: true \}\)/);
  assert.match(source, /listV2BookingIdsForPatientSync\(client, \[targetPatientId, sourcePatientId\], \{ queueOnly: true \}\)/);
});
