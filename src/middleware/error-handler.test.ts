import test from "node:test";
import assert from "node:assert/strict";
import { SchedulingError } from "../modules/appointments-v2/shared/errors/scheduling-error.js";

test("errorHandler exposes scheduling reason codes", () => {
  process.env.DATABASE_URL ||= "postgresql://example/example";
  process.env.JWT_SECRET ||= "test-secret";

  let statusCode = 0;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
    },
  };

  return import("./error-handler.js").then(({ errorHandler }) => {
  errorHandler(
    new SchedulingError(400, "Missing patient data", ["patient_phone_required"]),
    {} as never,
    response as never,
    (() => undefined) as never
  );

  assert.equal(statusCode, 400);
  assert.deepEqual((payload as { error: { reasonCodes?: string[] } }).error.reasonCodes, ["patient_phone_required"]);
  });
});
