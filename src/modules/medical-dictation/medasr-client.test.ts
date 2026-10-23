import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import http from "node:http";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { checkMedAsrHealth, MAX_AUDIO_BYTES, transcribeMedAsr, validateAudio, validateMedAsrUrl, validateTargetAddress } from "./medasr-client.js";

const connection = { baseUrl: "http://medasr.test", allowInsecureHttp: true, timeoutSeconds: 1 };
const audio = { buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]), mimeType: "audio/webm;codecs=opus" };
let mode = "ready";
let received = Buffer.alloc(0);
let server: http.Server;
let port: number;
let answers = [{ address: "192.9.101.244", family: 4 }];
before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received = Buffer.concat(chunks);
      if (mode === "timeout") return;
      if (mode === "slow-body") { res.write('{"text":'); return; }
      if (mode === "redirect") { res.writeHead(302, { Location: "http://169.254.169.254/" }); res.end(); return; }
      if (mode === "bad-json") { res.end("not JSON"); return; }
      if (mode === "malformed") { res.end(JSON.stringify({ text: 3, processing_seconds: -1 })); return; }
      if (mode === "not-ready") { res.end(JSON.stringify({ status: "loading", model: "google/medasr" })); return; }
      if (mode === "large") { res.end("x".repeat(1024 * 1024 + 1)); return; }
      if (req.url === "/health") { assert.equal(req.headers["x-api-key"], undefined); res.end(JSON.stringify({ status: "ready", model: "google/medasr" })); return; }
      if (req.headers["x-api-key"] !== "test-key") { res.writeHead(401); res.end("secret upstream error"); return; }
      res.end(JSON.stringify({ text: "MRI brain demonstrates multiple enhancing lesions.", processing_seconds: 2.8 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
  mock.method(dns, "lookup", (_hostname: unknown, _options: unknown, callback: (error: null, addresses: typeof answers) => void) => callback(null, answers));
  const original = http.request;
  // Keep production URL/DNS validation; reroute only the validated socket to our mock.
  mock.method(http, "request", ((url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    const target = new URL(url); target.port = String(port);
    const lookup: LookupFunction = (host, opts, done) => options.lookup!(host, opts, (error) => {
      if (error) return done(error, "", 4);
      if (opts.all) done(null, [{ address: "127.0.0.1", family: 4 }]); else done(null, "127.0.0.1", 4);
    });
    return original(target, { ...options, lookup }, callback);
  }) as typeof http.request);
});
after(async () => { mock.restoreAll(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

test("URL and DNS protection rejects unsafe targets even when HTTP is allowed", () => {
  assert.equal(validateMedAsrUrl(connection), connection.baseUrl);
  assert.equal(validateMedAsrUrl({ ...connection, baseUrl: "https://medasr.example.org:8443/" }), "https://medasr.example.org:8443");
  for (const baseUrl of ["invalid", "file:///etc/passwd", "http://user:key@10.0.0.1", "http://10.0.0.1/path", "http://10.0.0.1?url=x", "http://10.0.0.1#x", "http://localhost", "http://127.1", "http://169.254.169.254", "http://100.100.100.200", "http://[::1]", "http://[::ffff:127.0.0.1]"]) assert.throws(() => validateMedAsrUrl({ ...connection, baseUrl }));
  assert.throws(() => validateMedAsrUrl({ ...connection, allowInsecureHttp: false }));
  for (const baseUrl of ["http://medasr.test", "https://medasr.test"]) {
    for (const address of ["127.0.0.1", "169.254.1.1", "0.0.0.0", "224.1.1.1", "::1", "fe80::1", "::ffff:a00:1", "fd00:ec2::254"]) assert.throws(() => validateTargetAddress(address, { ...connection, baseUrl }));
  }
  validateTargetAddress("fd00::1", connection);
  validateTargetAddress("192.168.1.100", connection);
});
test("explicit HTTP opt-in permits configured destinations outside private ranges", () => {
  for (const baseUrl of ["http://192.9.101.244:8000", "http://8.8.8.8", "HTTP://8.8.8.8"]) {
    assert.equal(validateMedAsrUrl({ ...connection, baseUrl }), new URL(baseUrl).origin);
    assert.throws(() => validateMedAsrUrl({ ...connection, baseUrl, allowInsecureHttp: false }), /acknowledgement/);
  }
  validateTargetAddress("192.9.101.244", connection);
  assert.throws(() => validateTargetAddress("192.9.101.244", { ...connection, allowInsecureHttp: false }), /acknowledgement/);
});
test("rejects missing, oversized, spoofed and unsupported audio", () => {
  assert.equal(validateAudio(audio), "audio/webm");
  for (const invalid of [{ ...audio, buffer: Buffer.alloc(0) }, { ...audio, buffer: Buffer.alloc(MAX_AUDIO_BYTES + 1) }, { ...audio, mimeType: "text/plain" }, { ...audio, buffer: Buffer.from("not audio") }]) assert.throws(() => validateAudio(invalid));
  for (const [mimeType, data] of [["audio/ogg", "OggSx"], ["audio/mp4", "0000ftypx"], ["audio/wav", "RIFF0000WAVE"], ["audio/mpeg", "ID3xxx"]]) validateAudio({ mimeType, buffer: Buffer.from(data) });
});
test("health and transcription use fixed paths, key header, original bytes and validated result", async () => {
  mode = "ready";
  assert.deepEqual(await checkMedAsrHealth(connection), { model: "google/medasr" });
  assert.deepEqual(await transcribeMedAsr(connection, "test-key", audio), { text: "MRI brain demonstrates multiple enhancing lesions.", processing_seconds: 2.8 });
  assert.ok(received.includes(audio.buffer));
  assert.match(received.toString(), /name="file"/);
  await assert.rejects(transcribeMedAsr(connection, "wrong-key", audio), /rejected authentication/);
});
test("rejects redirects, malformed responses, unready models and oversized responses", async () => {
  for (const next of ["redirect", "bad-json", "malformed", "large"]) {
    mode = next;
    await assert.rejects(transcribeMedAsr(connection, "test-key", audio));
  }
  mode = "not-ready"; await assert.rejects(checkMedAsrHealth(connection), /not ready/);
});
test("bounds total response time and aborts cancelled requests", async () => {
  mode = "timeout";
  await assert.rejects(checkMedAsrHealth({ ...connection, timeoutSeconds: 0.03 }), /timed out/);
  mode = "slow-body";
  await assert.rejects(transcribeMedAsr({ ...connection, timeoutSeconds: 0.03 }, "test-key", audio), /timed out/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transcribeMedAsr(connection, "test-key", audio, controller.signal), /cancelled/);
});
test("revalidates DNS each request, rejects mixed DNS answers and reports unreachable service", async () => {
  mode = "ready";
  answers = [{ address: "192.9.101.244", family: 4 }, { address: "169.254.169.254", family: 4 }];
  await assert.rejects(checkMedAsrHealth(connection), /prohibited/);
  answers = [{ address: "192.9.101.244", family: 4 }];
  assert.equal((await checkMedAsrHealth(connection)).model, "google/medasr");
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  await assert.rejects(checkMedAsrHealth(connection), /unreachable/);
});
