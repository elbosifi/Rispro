import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "health-test-secret";
process.env.RISPRO_BUILD_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

test("health reports the running build SHA", async () => {
  const { createApp } = await import("./app.js");
  const server = http.createServer(createApp());

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = (await response.json()) as { ok: boolean; buildSha: string };

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      environment: process.env.NODE_ENV || "development",
      buildSha: process.env.RISPRO_BUILD_COMMIT_SHA,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
