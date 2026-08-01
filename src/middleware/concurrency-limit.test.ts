import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { describe, it } from "node:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error.js";
import { createConcurrencyLimiter } from "./concurrency-limit.js";

function requestPair(): { req: Request; res: Response; events: { req: EventEmitter; res: EventEmitter } } {
  const request = new EventEmitter();
  const response = new EventEmitter();
  return {
    req: request as Request,
    res: response as Response,
    events: { req: request, res: response },
  };
}

function enter(limiter: ReturnType<typeof createConcurrencyLimiter>, pair = requestPair()): {
  admitted: boolean;
  error: HttpError | undefined;
  pair: ReturnType<typeof requestPair>;
} {
  let admitted = false;
  let error: HttpError | undefined;
  limiter(pair.req, pair.res, ((value?: unknown) => {
    if (value instanceof HttpError) error = value;
    else admitted = true;
  }) as NextFunction);
  return { admitted, error, pair };
}

describe("createConcurrencyLimiter", () => {
  it("admits four active requests and rejects the fifth with a typed 503 before downstream middleware", () => {
    const limiter = createConcurrencyLimiter({ maxConcurrent: 4, message: "busy", errorCode: "QZ_SIGN_BUSY" });
    const active = Array.from({ length: 4 }, () => enter(limiter));
    assert.equal(active.every((entry) => entry.admitted), true);

    let parserReached = false;
    const rejectedPair = requestPair();
    limiter(rejectedPair.req, rejectedPair.res, ((value?: unknown) => {
      if (!value) parserReached = true;
      assert.ok(value instanceof HttpError);
      assert.equal(value.statusCode, 503);
      assert.deepEqual(value.details, { code: "QZ_SIGN_BUSY" });
    }) as NextFunction);
    assert.equal(parserReached, false);
  });

  it("releases exactly one slot on finish and close so a later request is admitted", () => {
    const limiter = createConcurrencyLimiter({ maxConcurrent: 1, message: "busy" });
    const first = enter(limiter);
    first.pair.events.res.emit("finish");
    first.pair.events.res.emit("close");
    const second = enter(limiter);
    assert.equal(second.admitted, true);
    assert.equal(enter(limiter).error?.statusCode, 503);
  });

  it("releases slots after handler errors, parser rejection responses, and client aborts", () => {
    for (const release of [
      (entry: ReturnType<typeof enter>) => entry.pair.events.res.emit("finish"),
      (entry: ReturnType<typeof enter>) => entry.pair.events.res.emit("close"),
      (entry: ReturnType<typeof enter>) => entry.pair.events.req.emit("aborted"),
    ]) {
      const limiter = createConcurrencyLimiter({ maxConcurrent: 1, message: "busy" });
      const active = enter(limiter);
      assert.equal(active.admitted, true);
      release(active);
      assert.equal(enter(limiter).admitted, true);
    }
  });

  it("releases a slot after real JSON parser rejection and handler error responses", async () => {
    const limiter = createConcurrencyLimiter({ maxConcurrent: 1, message: "busy" });
    const app = express();
    app.post("/", limiter, express.json(), (req, res, next) => {
      if (req.body?.fail === true) next(new Error("handler failure"));
      else res.status(204).end();
    });
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: "rejected" });
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;

    try {
      const parserFailure = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
      assert.equal(parserFailure.status, 400);
      assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 204);

      const handlerFailure = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fail: true }) });
      assert.equal(handlerFailure.status, 400);
      assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 204);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
