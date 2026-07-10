import test from "node:test";
import assert from "node:assert/strict";
import { requestIdMiddleware } from "./request-id.js";

function run(header?: string) {
  const headers: Record<string, string> = {};
  const req = { header: () => header } as never;
  const res = { setHeader: (key: string, value: string) => { headers[key] = value; } } as never;
  requestIdMiddleware(req, res, () => undefined);
  return { req: req as { requestId?: string }, headers };
}
test("request ID is generated and returned", () => { const result = run(); assert.match(result.req.requestId || "", /^[0-9a-f-]{36}$/); assert.equal(result.headers["X-Request-Id"], result.req.requestId); });
test("valid incoming request ID is preserved", () => { const id = "2b57d0c7-1ff8-4c70-a14f-dbb2ec5ec1a9"; const result = run(id); assert.equal(result.req.requestId, id); });
