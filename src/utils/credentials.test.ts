import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "./http-error.js";
import { normalizeUsername, requireExactPassword } from "./credentials.js";

describe("credential normalization", () => {
  it("canonicalizes usernames by trimming and lowercasing", () => {
    assert.equal(normalizeUsername("  Doctor.One  "), "doctor.one");
  });

  it("preserves passwords exactly and explicitly rejects boundary whitespace", () => {
    assert.equal(requireExactPassword("Exact Pass123"), "Exact Pass123");
    assert.throws(
      () => requireExactPassword(" ExactPass123", "temporaryPassword"),
      (error: unknown) => error instanceof HttpError && error.statusCode === 400 && /must not start or end/.test(error.message)
    );
    assert.throws(() => requireExactPassword("ExactPass123 "));
  });
});
