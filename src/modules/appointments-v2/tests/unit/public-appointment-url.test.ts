import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPublicAppointmentUrlForBaseUrl } from "../../public/utils/public-appointment-url.js";

test("buildPublicAppointmentUrl constructs a canonical URL and encodes the token", () => {
  assert.equal(buildPublicAppointmentUrlForBaseUrl("signed token/with?characters", "https://public.example.test"), "https://public.example.test/public/appointment?t=signed%20token%2Fwith%3Fcharacters");
});

test("buildPublicAppointmentUrl preserves blank-token behavior", () => {
  assert.equal(buildPublicAppointmentUrlForBaseUrl("  ", "https://public.example.test"), "");
});

test("public appointment URLs do not read or accept Patient QR settings", () => {
  const source = readFileSync("src/modules/appointments-v2/public/utils/public-appointment-url.ts", "utf8");
  assert.doesNotMatch(source, /PatientQrSettings|readPatientQrSettings|risproPublicBaseUrl/);
});
