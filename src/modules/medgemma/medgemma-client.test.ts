import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { checkMedGemmaHealth, cleanupMedGemmaDictation, validateMedGemmaUrl, type MedGemmaConnection } from "./medgemma-client.js";
import { CLEANUP_DICTATION_INSTRUCTIONS } from "./cleanup-instructions.js";

async function withServer(handler: http.RequestListener, run: (connection: MedGemmaConnection) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const connection = { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, timeoutSeconds: 1, allowInsecureHttp: true };
  try { await run(connection); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("accepts hospital IPs, hostnames, HTTP acknowledgement and HTTPS without subnet policies", () => {
  for (const baseUrl of ["http://192.9.101.55:8000", "http://medgemma.hospital:8000", "https://model.example.org", "http://127.0.0.1:8080"]) {
    assert.equal(validateMedGemmaUrl({ baseUrl, timeoutSeconds: 180, allowInsecureHttp: true }), new URL(baseUrl).origin);
  }
  for (const baseUrl of ["ftp://host", "invalid", "https://user:pass@host", "https://host/path", "https://host?key=secret", "https://host#fragment"]) {
    assert.throws(() => validateMedGemmaUrl({ baseUrl, timeoutSeconds: 180, allowInsecureHttp: true }));
  }
  assert.throws(() => validateMedGemmaUrl({ baseUrl: "http://192.9.101.55:8000", timeoutSeconds: 180, allowInsecureHttp: false }), /Acknowledge/);
});

test("mock server receives the exact task, text, backend instructions and key; only defined response fields return", async () => {
  const original = "There is uh no left-sided lesion period";
  await withServer((req, res) => {
    assert.equal(req.headers["x-api-key"], "test-key");
    if (req.url === "/health") { assert.equal(req.method, "GET"); res.end(JSON.stringify({ status: "ready", model: "google/medgemma-1.5-4b-it" })); return; }
    assert.equal(req.url, "/generate"); assert.equal(req.method, "POST"); assert.equal(req.headers["content-type"], "application/json");
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { task: "cleanup_dictation", text: original, instructions: CLEANUP_DICTATION_INSTRUCTIONS });
      res.end(JSON.stringify({ text: "There is no left-sided lesion.", processing_seconds: 2.5, extra: "not forwarded" }));
    });
  }, async (connection) => {
    assert.deepEqual(await checkMedGemmaHealth(connection, "test-key"), { model: "google/medgemma-1.5-4b-it" });
    assert.deepEqual(await cleanupMedGemmaDictation(connection, "test-key", original), { text: "There is no left-sided lesion.", processing_seconds: 2.5 });
    assert.equal(original, "There is uh no left-sided lesion period");
  });
});

test("rejects redirects, failed authentication and unsuccessful responses without echoing bodies", async () => {
  for (const status of [302, 401, 403, 500]) await withServer((_req, res) => {
    res.writeHead(status, { Location: "/must-not-follow" }); res.end("sensitive-upstream-body");
  }, async (connection) => {
    await assert.rejects(cleanupMedGemmaDictation(connection, "secret-key", "synthetic input"), (error: Error) => {
      assert.doesNotMatch(error.message, /sensitive-upstream-body|secret-key|synthetic input/);
      assert.match(error.message, status === 302 ? /redirects/ : status === 401 || status === 403 ? /authentication/ : /unsuccessful/);
      return true;
    });
  });
});

test("rejects invalid JSON, unexpected health/generation shapes and oversized responses", async () => {
  for (const response of ["not json", "null", "[]", '{}', '{"text":"","processing_seconds":1}', '{"text":"x","processing_seconds":-1}', '{"text":"x","processing_seconds":"2"}', JSON.stringify({ text: "x".repeat(32_001), processing_seconds: 1 }), "x".repeat(256 * 1024 + 1)]) {
    await withServer((_req, res) => res.end(response), async (connection) => {
      await assert.rejects(cleanupMedGemmaDictation(connection, "", "input"), /invalid|too large/);
      await assert.rejects(checkMedGemmaHealth(connection, ""), /invalid|too large/);
    });
  }
});

test("bounds input before network access and handles timeouts, cancellations and unreachable servers", async () => {
  await withServer((_req, _res) => {}, async (connection) => {
    for (const text of ["", "  ", "x".repeat(32_001)]) await assert.rejects(cleanupMedGemmaDictation(connection, "", text), /required|limit/);
    await assert.rejects(cleanupMedGemmaDictation({ ...connection, timeoutSeconds: 0.02 }, "", "input"), /timed out/);
    await assert.rejects(cleanupMedGemmaDictation(connection, "", "input", AbortSignal.abort()), /cancelled/);
  });
  // Obtain and close an ephemeral port so this test does not assume a particular port is free.
  let closedConnection!: MedGemmaConnection;
  await withServer((_req, res) => res.end(), async (connection) => { closedConnection = connection; });
  await assert.rejects(cleanupMedGemmaDictation(closedConnection, "", "input"), /unreachable/);
});
