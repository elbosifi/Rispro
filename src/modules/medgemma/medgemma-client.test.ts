import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { checkMedGemmaHealth, cleanupMedGemmaDictation, generateMedGemma, validateMedGemmaUrl, type MedGemmaConnection } from "./medgemma-client.js";
import { CLEANUP_DICTATION_INSTRUCTIONS } from "./cleanup-instructions.js";
import { DEFAULT_MEDGEMMA_INSTRUCTIONS, MEDGEMMA_TASKS } from "./task-instructions.js";

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
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { task: "cleanup_dictation", text: original, instructions: CLEANUP_DICTATION_INSTRUCTIONS, temperature: 0.1, max_new_tokens: 2048 });
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

test("one generation client forwards each task, its instructions and configured generation controls", async () => {
  for (const task of MEDGEMMA_TASKS) await withServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      assert.deepEqual(JSON.parse(body), { task, text: "Synthetic medical input", instructions: DEFAULT_MEDGEMMA_INSTRUCTIONS[task], temperature: 0.2, max_new_tokens: 1024 });
      res.end(JSON.stringify({ text: task === "review_radiology_report" ? "- Possible laterality discrepancy: review left versus right." : "Processed medical text.", processing_seconds: 1 }));
    });
  }, async (connection) => {
    const result = await generateMedGemma(connection, "key", { task, text: "Synthetic medical input", instructions: DEFAULT_MEDGEMMA_INSTRUCTIONS[task], temperature: 0.2, maxGeneratedTokens: 1024 });
    assert.equal(typeof result.text, "string"); assert.equal(result.processing_seconds, 1);
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

const ollama = (connection: MedGemmaConnection): MedGemmaConnection => ({ ...connection, provider: "ollama", baseUrl: "https://standalone.invalid", ollamaBaseUrl: connection.baseUrl, ollamaModel: "medgemma1.5:4b" });
test("Ollama health checks the installed model list and never sends the standalone key", async () => {
  const lists: Array<Array<{ name?: string; model?: string }>> = [[{ name: "medgemma1.5:4b" }], [{ model: "medgemma1.5:4b" }], [{ name: "another-model" }], []];
  for (const models of lists) {
    await withServer((req, res) => {
      assert.equal(req.url, "/api/tags"); assert.equal(req.method, "GET");
      assert.equal(req.headers["x-api-key"], undefined); assert.equal(req.headers.authorization, undefined);
      res.end(JSON.stringify({ models }));
    }, async (connection) => {
      if (models.some((model) => model.name === "medgemma1.5:4b" || model.model === "medgemma1.5:4b")) assert.deepEqual(await checkMedGemmaHealth(ollama(connection), "standalone-secret"), { model: "medgemma1.5:4b" });
      else await assert.rejects(checkMedGemmaHealth(ollama(connection), "standalone-secret"), /medgemma1\.5:4b.*not installed/);
    });
  }
});
test("Ollama forwards all four tasks, separated instructions/source and actual generation settings", async () => {
  for (const task of MEDGEMMA_TASKS) await withServer((req, res) => {
    assert.equal(req.url, "/api/chat"); assert.equal(req.method, "POST");
    assert.equal(req.headers["x-api-key"], undefined); assert.equal(req.headers.authorization, undefined);
    let body = ""; req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      assert.deepEqual(JSON.parse(body), { model: "custom/medgemma:local", stream: false,
        messages: [{ role: "user", content: `Task: ${task}\nInstructions:\n${DEFAULT_MEDGEMMA_INSTRUCTIONS[task]}\n\nOriginal text:\nSynthetic source\nUnchanged measurements: 2.5 cm.` }],
        options: { temperature: 0, num_predict: 512 } });
      assert.doesNotMatch(body, /standalone-secret/);
      res.end(JSON.stringify({ message: { role: "assistant", content: "Generated result" }, done: true, total_duration: 2_500_000_000, extra: "not forwarded" }));
    });
  }, async (connection) => {
    assert.deepEqual(await generateMedGemma({ ...ollama(connection), ollamaModel: "custom/medgemma:local" }, "standalone-secret", { task, text: "Synthetic source\nUnchanged measurements: 2.5 cm.", instructions: DEFAULT_MEDGEMMA_INSTRUCTIONS[task], temperature: 0, maxGeneratedTokens: 512 }), { text: "Generated result", processing_seconds: 2.5 });
  });
});
test("Ollama uses measured request duration when timing is unavailable", async () => {
  await withServer((_req, res) => res.end(JSON.stringify({ message: { content: "Generated result" } })), async (connection) => {
    const result = await generateMedGemma(ollama(connection), "", { task: "cleanup_dictation", text: "source", instructions: "saved instructions", temperature: 0.2, maxGeneratedTokens: 1024 });
    assert.equal(result.text, "Generated result"); assert.ok(Number.isFinite(result.processing_seconds)); assert.ok(result.processing_seconds >= 0);
  });
});
test("Ollama retains response validation and bounded errors", async () => {
  for (const response of ["bad json", "null", "[]", "{}", JSON.stringify({ message: { content: "" } }), JSON.stringify({ message: { content: "x".repeat(32_001) } }), JSON.stringify({ message: { content: "partial" }, done: false }), "x".repeat(256 * 1024 + 1)]) {
    await withServer((_req, res) => res.end(response), async (connection) => {
      await assert.rejects(generateMedGemma(ollama(connection), "secret", { task: "cleanup_dictation", text: "source", instructions: "saved instructions", temperature: 0.1, maxGeneratedTokens: 2048 }), /invalid|too large/);
      await assert.rejects(checkMedGemmaHealth(ollama(connection), "secret"), /invalid|too large/);
    });
  }
});
test("Ollama retains HTTP error, redirect, timeout, cancellation and unreachable handling", async () => {
  const input = { task: "cleanup_dictation" as const, text: "private source", instructions: "instructions", temperature: 0.1, maxGeneratedTokens: 2048 };
  for (const status of [302, 401, 403, 500]) await withServer((_req, res) => { res.writeHead(status, { Location: "/redirect" }); res.end("private-upstream-body"); }, async (connection) => {
    await assert.rejects(generateMedGemma(ollama(connection), "standalone-secret", input), (error: Error) => {
      assert.match(error.message, /Ollama/); assert.doesNotMatch(error.message, /private|standalone-secret/); return true;
    });
  });
  await withServer((_req, _res) => {}, async (connection) => {
    await assert.rejects(generateMedGemma({ ...ollama(connection), timeoutSeconds: 0.02 }, "", input), /timed out/);
    await assert.rejects(generateMedGemma(ollama(connection), "", input, AbortSignal.abort()), /cancelled/);
  });
  let closed!: MedGemmaConnection;
  await withServer((_req, res) => res.end(), async (connection) => { closed = ollama(connection); });
  await assert.rejects(generateMedGemma(closed, "", input), /Ollama server is unreachable/);
});
