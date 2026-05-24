import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("src/services/queue-service.ts", "utf8");

test("scanAppointmentIntoQueue validates patient requirements before enqueueing", () => {
  const scanStart = source.indexOf("export async function scanAppointmentIntoQueue");
  const validateIndex = source.indexOf("assertPatientMeetsBookingQueueRequirements", scanStart);
  const enqueueIndex = source.indexOf("enqueueAppointmentRecord", scanStart);

  assert.ok(scanStart >= 0, "scanAppointmentIntoQueue should exist");
  assert.ok(validateIndex > scanStart, "scan should validate patient requirements");
  assert.ok(enqueueIndex > validateIndex, "scan should validate before enqueueing");
});
