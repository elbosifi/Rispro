import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "passkey-settings-test-secret";

test("passkey configuration derives the RP ID from the saved HTTPS origin", async () => {
  const { validatePasskeyConfiguration } = await import("./passkey-settings-service.js");
  assert.deepEqual(
    validatePasskeyConfiguration({ rpName: "RISpro", origin: "https://rispro.example.test" }),
    { rpName: "RISpro", rpId: "rispro.example.test", origin: "https://rispro.example.test" }
  );
});

test("passkey configuration rejects a non-local HTTP origin", async () => {
  const { validatePasskeyConfiguration } = await import("./passkey-settings-service.js");
  assert.throws(
    () => validatePasskeyConfiguration({ rpName: "RISpro", origin: "http://rispro.example.test" }),
    /HTTPS/
  );
});
