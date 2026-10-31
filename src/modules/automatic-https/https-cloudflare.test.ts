import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import test, { mock } from "node:test";
import { validateHttpsConfiguration } from "./https-configuration.js";
import { checkCloudflare } from "./https-provider.js";

test("Cloudflare connection checks use only the fixed API and a readable matching zone", async () => {
  const oldKey = process.env.RISPRO_SECRET_ENCRYPTION_KEY;
  process.env.RISPRO_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  const token = `synthetic_${"x".repeat(30)}`;
  const config = validateHttpsConfiguration({ provider: "cloudflare", enabled: true, hostname: "ris.example.org", token });
  const requests: Array<{ hostname: string; path: string; headers: { Authorization: string } }> = [];
  let rejectToken = false;
  const requestMock = mock.method(https, "request", ((options: typeof requests[number], callback: (response: EventEmitter & { statusCode: number }) => void) => {
    requests.push(options);
    const request = new EventEmitter();
    return Object.assign(request, { setTimeout: () => request, destroy: () => request.emit("error", new Error("timeout")), end: () => {
      const response = Object.assign(new EventEmitter(), { statusCode: rejectToken ? 403 : 200 });
      callback(response);
      const result = options.path.includes("name=example.org") ? [{ name: "example.org", status: "active" }] : [];
      response.emit("data", Buffer.from(JSON.stringify({ success: !rejectToken, result })));
      response.emit("end");
      return request;
    } });
  }) as unknown as typeof https.request);
  try {
    await checkCloudflare(config);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((item) => item.hostname === "api.cloudflare.com" && item.headers.Authorization === `Bearer ${token}`));
    rejectToken = true;
    await assert.rejects(checkCloudflare(config), (error: Error) => !error.message.includes(token) && /rejected/.test(error.message));
  } finally {
    requestMock.mock.restore();
    if (oldKey === undefined) delete process.env.RISPRO_SECRET_ENCRYPTION_KEY; else process.env.RISPRO_SECRET_ENCRYPTION_KEY = oldKey;
  }
});
