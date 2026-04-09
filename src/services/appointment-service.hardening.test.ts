import test from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "../utils/http-error.js";
import { overrideOutcomeForFailure, toSchedulingConflictError } from "./appointment-service.js";

test("maps serialization failure to retryable scheduling conflict", () => {
  const mapped = toSchedulingConflictError({ code: "40001" });
  assert.ok(mapped instanceof HttpError);
  assert.equal(mapped?.statusCode, 409);
  assert.match(String(mapped?.message), /retry/i);
});

test("maps lock not available to retryable scheduling conflict", () => {
  const mapped = toSchedulingConflictError({ code: "55P03" });
  assert.ok(mapped instanceof HttpError);
  assert.equal(mapped?.statusCode, 409);
});

test("maps unique violation race to scheduling conflict", () => {
  const mapped = toSchedulingConflictError({ code: "23505" });
  assert.ok(mapped instanceof HttpError);
  assert.equal(mapped?.statusCode, 409);
});

test("returns null for non-race DB error codes", () => {
  const mapped = toSchedulingConflictError({ code: "22001" });
  assert.equal(mapped, null);
});

test("override outcome is denied for invalid credentials", () => {
  assert.equal(overrideOutcomeForFailure("invalid_credentials"), "denied");
});

test("override outcome is cancelled for missing username/password/reason", () => {
  assert.equal(overrideOutcomeForFailure("missing_username"), "cancelled");
  assert.equal(overrideOutcomeForFailure("missing_password"), "cancelled");
  assert.equal(overrideOutcomeForFailure("missing_reason"), "cancelled");
});
