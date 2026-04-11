/**
 * Appointments V2 — SchedulingError unit tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

describe("SchedulingError", () => {
  it("should extend HttpError with correct name", () => {
    const err = new SchedulingError(400, "test message");
    assert.equal(err.name, "SchedulingError");
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, "test message");
  });

  it("should store reasonCodes", () => {
    const err = new SchedulingError(409, "conflict", ["capacity_exhausted"]);
    assert.deepEqual(err.reasonCodes, ["capacity_exhausted"]);
  });

  it("should default reasonCodes to empty array", () => {
    const err = new SchedulingError(500, "error");
    assert.deepEqual(err.reasonCodes, []);
  });

  it("should accept details parameter", () => {
    const details = { modalityId: 5 };
    const err = new SchedulingError(404, "not found", [], details);
    assert.equal(err.details, details);
  });
});
