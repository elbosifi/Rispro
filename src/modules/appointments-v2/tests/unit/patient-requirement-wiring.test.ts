import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("createBooking validates patient requirements before capacity evaluation", () => {
  const source = readFileSync("src/modules/appointments-v2/booking/services/create-booking.service.ts", "utf8");
  const createStart = source.indexOf("export async function createBookingInternal");
  const validateIndex = source.indexOf("assertPatientMeetsBookingQueueRequirements", createStart);
  const policyIndex = source.indexOf("findPublishedPolicyVersion", createStart);

  assert.ok(createStart >= 0, "createBookingInternal should exist");
  assert.ok(validateIndex > createStart, "create booking should validate patient requirements");
  assert.ok(policyIndex > validateIndex, "patient requirements should run before capacity policy work");
});

test("rescheduleBooking validates patient requirements before capacity evaluation", () => {
  const source = readFileSync("src/modules/appointments-v2/booking/services/reschedule-booking.service.ts", "utf8");
  const rescheduleStart = source.indexOf("export async function rescheduleBookingInternal");
  const validateIndex = source.indexOf("assertPatientMeetsBookingQueueRequirements", rescheduleStart);
  const policyIndex = source.indexOf("findPublishedPolicyVersion", rescheduleStart);

  assert.ok(rescheduleStart >= 0, "rescheduleBookingInternal should exist");
  assert.ok(validateIndex > rescheduleStart, "reschedule should validate patient requirements");
  assert.ok(policyIndex > validateIndex, "patient requirements should run before capacity policy work");
});
