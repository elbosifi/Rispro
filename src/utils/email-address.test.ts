import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./http-error.js";
import { emailFromUsername, normalizeOptionalEmail } from "./email-address.js";

test("email address helpers normalize optional addresses and derive only email-shaped usernames", () => {
  assert.equal(normalizeOptionalEmail("  doctor@nccb.ly "), "doctor@nccb.ly");
  assert.equal(normalizeOptionalEmail("   "), null);
  assert.equal(normalizeOptionalEmail(null), null);
  assert.throws(() => normalizeOptionalEmail("not an email"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
  assert.equal(emailFromUsername(" doctor@nccb.ly "), "doctor@nccb.ly");
  assert.equal(emailFromUsername("doctor.login"), null);
});
