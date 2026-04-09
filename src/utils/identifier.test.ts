import test from "node:test";
import assert from "node:assert/strict";
import { ensureIdentifierValue, normalizeIdentifierValue } from "./identifier.js";

test("normalizeIdentifierValue trims, strips spaces, and uppercases", () => {
  assert.equal(normalizeIdentifierValue(" ab 12 c "), "AB12C");
});

test("ensureIdentifierValue throws when empty", () => {
  assert.throws(() => ensureIdentifierValue("   "), /required/i);
});

test("ensureIdentifierValue returns normalized value", () => {
  assert.equal(ensureIdentifierValue(" x y z "), "XYZ");
});
