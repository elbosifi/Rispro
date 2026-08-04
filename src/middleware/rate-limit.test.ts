import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error.js";
import { createFailureRateLimiter, createRateLimiter } from "./rate-limit.js";

describe("login rate limiting primitives", () => {
  it("isolates username failures and clears a username after success", () => {
    const limiter = createFailureRateLimiter({ windowMs: 60_000, maxRequests: 2, message: "generic" });
    limiter.recordFailure("doctor-one");
    limiter.recordFailure("doctor-one");
    assert.throws(() => limiter.check("doctor-one"), (error: unknown) => error instanceof HttpError && error.statusCode === 429 && error.message === "generic");
    assert.doesNotThrow(() => limiter.check("doctor-two"));
    limiter.reset("doctor-one");
    assert.doesNotThrow(() => limiter.check("doctor-one"));
  });

  it("retains a separate higher per-IP request ceiling", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3, message: "generic" });
    const req = { ip: "10.0.0.1" } as Request;
    const res = {} as Response;
    const enter = () => {
      let error: unknown;
      limiter(req, res, ((value?: unknown) => { error = value; }) as NextFunction);
      return error;
    };
    assert.equal(enter(), undefined);
    assert.equal(enter(), undefined);
    assert.equal(enter(), undefined);
    const blocked = enter();
    assert.ok(blocked instanceof HttpError);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.message, "generic");
  });
});
