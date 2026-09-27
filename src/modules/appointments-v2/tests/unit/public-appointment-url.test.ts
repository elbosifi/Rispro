import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPublicAppointmentUrl } from "../../public/utils/public-appointment-url.js";

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("buildPublicAppointmentUrl uses PUBLIC_APP_BASE_URL and encodes the token", () => {
  withEnv({ NODE_ENV: "production", PUBLIC_APP_BASE_URL: "https://public.example.test/" }, () => {
    assert.equal(buildPublicAppointmentUrl("signed token/with?characters"), "https://public.example.test/public/appointment?t=signed%20token%2Fwith%3Fcharacters");
  });
});

test("buildPublicAppointmentUrl preserves blank-token behavior", () => {
  withEnv({ NODE_ENV: "production", PUBLIC_APP_BASE_URL: "https://public.example.test" }, () => {
    assert.equal(buildPublicAppointmentUrl("  "), "");
  });
});

test("public appointment URLs do not read or accept Patient QR settings", () => {
  const source = readFileSync("src/modules/appointments-v2/public/utils/public-appointment-url.ts", "utf8");
  assert.doesNotMatch(source, /PatientQrSettings|readPatientQrSettings|risproPublicBaseUrl/);
});
