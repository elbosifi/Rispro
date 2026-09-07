import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://example/example";
process.env.JWT_SECRET ||= "settings-validation-test-secret";

const { validatePatientRegistrationSettings } = await import("./settings.js");

test("patient identity name-match setting accepts only 2 or 3", () => {
  assert.doesNotThrow(() => validatePatientRegistrationSettings([{ key: "patient_identity_name_match_components", value: "2" }]));
  assert.doesNotThrow(() => validatePatientRegistrationSettings([{ key: "patient_identity_name_match_components", value: { value: "3" } }]));

  for (const value of [1, 2, "1", 3, 4, "4", "arbitrary text"]) {
    assert.throws(
      () => validatePatientRegistrationSettings([{ key: "patient_identity_name_match_components", value }]),
      (error: unknown) => error instanceof Error && "statusCode" in error && error.statusCode === 400,
    );
  }
});
