import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import http from "node:http";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "../../app.js";
import { pool } from "../../db/pool.js";
import { decryptRuntimeSecret } from "../../services/runtime-secret-crypto.js";
import { createTestAuthCookie, createTestSupervisorReauthCookie } from "../appointments-v2/tests/integration/helpers.js";

let app: http.Server;
let origin: string;
const upstream: http.Server[] = [];
const users: number[] = [];
let adminCookie: string;
let doctorCookie: string;
let supervisorCookie: string;
let receptionCookie: string;
let original: Record<string, unknown>;
const oldKey = process.env.RISPRO_SECRET_ENCRYPTION_KEY;
const prefix = `medasr_${randomUUID().replaceAll("-", "")}`;
let connection: { enabled: boolean; baseUrl: string; allowInsecureHttp: boolean; timeoutSeconds: number };
async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: http.Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
async function json(path: string, cookie = adminCookie, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}/api/medical-dictation${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function upload(cookie: string, mimeType = "audio/webm", buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]), extra = false) {
  const form = new FormData(); form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), "recording.webm");
  if (extra) form.append("baseUrl", "http://169.254.169.254");
  const response = await fetch(`${origin}/api/medical-dictation/transcribe`, { method: "POST", headers: { Cookie: cookie }, body: form });
  return { status: response.status, data: await response.json() };
}
before(async () => {
  process.env.RISPRO_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  original = (await pool.query("select * from medical_dictation_configuration where id=1")).rows[0];
  for (const role of ["super_admin", "doctor", "supervisor", "receptionist"]) {
    const result = await pool.query("insert into users (username,password_hash,full_name,role,is_active) values ($1,'test-not-a-login',$1,$2,true) returning id", [`${prefix}_${role}`, role]);
    users.push(Number(result.rows[0].id));
  }
  await pool.query("insert into doctor_portal.doctor_profiles (user_id,display_name,doctor_role,active) values ($1,'MedASR Test Doctor','consultant',true)", [users[1]]);
  adminCookie = `${createTestAuthCookie(users[0], "super_admin")}; ${createTestSupervisorReauthCookie(users[0], "super_admin")}`;
  doctorCookie = createTestAuthCookie(users[1], "doctor");
  supervisorCookie = createTestAuthCookie(users[2], "supervisor");
  receptionCookie = createTestAuthCookie(users[3], "receptionist");
  const originalLookup = dns.lookup;
  mock.method(dns, "lookup", ((host: string, opts: dns.LookupAllOptions, cb: (e: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => {
    if (host === "medasr.test") cb(null, [{ address: "10.1.2.3", family: 4 }]);
    else originalLookup(host, opts, cb);
  }) as typeof dns.lookup);
  const originalRequest = http.request;
  mock.method(http, "request", ((url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    const lookup: LookupFunction = (host, opts, done) => options.lookup!(host, opts, (error) => {
      if (error) return done(error, "", 4);
      if (opts.all) done(null, [{ address: "127.0.0.1", family: 4 }]); else done(null, "127.0.0.1", 4);
    });
    return originalRequest(url, { ...options, lookup }, callback);
  }) as typeof http.request);
  for (let i = 0; i < 2; i++) {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        if (req.url === "/health") { res.end(JSON.stringify({ status: "ready", model: `google/medasr-${i}` })); return; }
        if (req.headers["x-api-key"] !== "new-test-key") { res.writeHead(401); res.end("do not echo credentials"); return; }
        res.end(JSON.stringify({ text: "Normal chest radiograph.", processing_seconds: 1.2 }));
      });
    });
    upstream.push(server); await listen(server);
  }
  connection = { enabled: true, baseUrl: `http://medasr.test:${(upstream[0].address() as { port: number }).port}`, timeoutSeconds: 180, allowInsecureHttp: true };
  app = http.createServer(createApp()); origin = await listen(app);
});
after(async () => {
  mock.restoreAll();
  if (app) await close(app);
  for (const server of upstream) await close(server);
  if (original) await pool.query("update medical_dictation_configuration set enabled=$1,base_url=$2,api_key_secret=$3,timeout_seconds=$4,allow_insecure_http=$5,updated_by_user_id=$6,updated_at=$7 where id=1", [original.enabled, original.base_url, original.api_key_secret, original.timeout_seconds, original.allow_insecure_http, original.updated_by_user_id, original.updated_at]);
  await pool.query("delete from audit_log where changed_by_user_id=any($1::bigint[])", [users]);
  await pool.query("delete from doctor_portal.doctor_profiles where user_id=any($1::bigint[])", [users]);
  await pool.query("delete from users where id=any($1::bigint[])", [users]);
  if (oldKey === undefined) delete process.env.RISPRO_SECRET_ENCRYPTION_KEY; else process.env.RISPRO_SECRET_ENCRYPTION_KEY = oldKey;
  await pool.end();
});

test("configuration is super-admin only, writes and connection tests require recent re-auth", async () => {
  assert.equal((await json("/settings", "")).status, 401);
  for (const cookie of [doctorCookie, supervisorCookie, receptionCookie]) {
    assert.equal((await json("/settings", cookie)).status, 403);
    assert.equal((await json("/settings", cookie, "PUT", connection)).status, 403);
    assert.equal((await json("/test-connection", cookie, "POST")).status, 403);
  }
  const withoutReauth = createTestAuthCookie(users[0], "super_admin");
  assert.equal((await json("/settings", withoutReauth)).status, 200);
  assert.equal((await json("/settings", withoutReauth, "PUT", connection)).status, 403);
  assert.equal((await json("/test-connection", withoutReauth, "POST")).status, 403);
});
test("saves encrypted keys, retains blanks, replaces keys and excludes secrets from responses/audit", async () => {
  const saved = await json("/settings", adminCookie, "PUT", { ...connection, apiKey: "old-test-key" });
  assert.equal(saved.status, 200); assert.equal(saved.data.settings.apiKeyConfigured, true);
  assert.doesNotMatch(JSON.stringify(saved.data), /old-test-key|ciphertext/);
  const stored = (await pool.query("select api_key_secret from medical_dictation_configuration where id=1")).rows[0].api_key_secret;
  assert.equal(stored.alg, "aes-256-gcm"); assert.equal(decryptRuntimeSecret(stored), "old-test-key");
  assert.doesNotMatch(JSON.stringify(stored), /old-test-key/);
  assert.equal((await json("/settings", adminCookie, "PUT", { ...connection, timeoutSeconds: 200, apiKey: "" })).status, 200);
  assert.deepEqual((await pool.query("select api_key_secret from medical_dictation_configuration where id=1")).rows[0].api_key_secret, stored);
  assert.equal((await json("/settings", adminCookie, "PUT", { ...connection, apiKey: "new-test-key" })).status, 200);
  const audit = await pool.query("select old_values,new_values from audit_log where changed_by_user_id=$1 and entity_type='medical_dictation_configuration'", [users[0]]);
  assert.ok(audit.rowCount! >= 3); assert.doesNotMatch(JSON.stringify(audit.rows), /old-test-key|new-test-key|ciphertext/);
});
test("settings survive a fresh Express application and target changes apply without restarting it", async () => {
  const fresh = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", 'const {getMedicalDictationSettings}=await import("./src/modules/medical-dictation/medical-dictation-settings-service.ts");const {pool}=await import("./src/db/pool.ts");console.log(JSON.stringify(await getMedicalDictationSettings()));await pool.end();']);
  const freshSettings = JSON.parse(fresh.stdout);
  assert.equal(freshSettings.baseUrl, connection.baseUrl); assert.equal(freshSettings.apiKeyConfigured, true);
  await close(app); app = http.createServer(createApp()); origin = await listen(app);
  const loaded = await json("/settings"); assert.equal(loaded.data.settings.baseUrl, connection.baseUrl); assert.equal(loaded.data.settings.apiKeyConfigured, true);
  const first = await json("/test-connection", adminCookie, "POST"); assert.equal(first.data.status, "connected"); assert.equal(first.data.model, "google/medasr-0"); assert.equal(first.data.credentialsValidated, false);
  connection.baseUrl = `http://medasr.test:${(upstream[1].address() as { port: number }).port}`;
  assert.equal((await json("/settings", adminCookie, "PUT", connection)).status, 200);
  assert.equal((await json("/health", doctorCookie)).data.model, "google/medasr-1");
});
test("all authenticated workspaces can transcribe, including staff without a clinical profile", async () => {
  assert.equal((await upload("")).status, 401);
  assert.equal((await json("/health", "")).status, 401);
  for (const cookie of [doctorCookie, adminCookie, supervisorCookie, receptionCookie]) {
    assert.equal((await json("/health", cookie)).status, 200);
    const result = await upload(cookie);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { text: "Normal chest radiograph.", processing_seconds: 1.2 });
  }
  await pool.query("update doctor_portal.doctor_profiles set active=false where user_id=$1", [users[1]]);
  assert.equal((await upload(doctorCookie)).status, 200);
  await pool.query("update doctor_portal.doctor_profiles set active=true where user_id=$1", [users[1]]);
  await pool.query("update users set is_active=false where id=$1", [users[3]]);
  assert.equal((await upload(receptionCookie)).status, 401);
  await pool.query("update users set is_active=true where id=$1", [users[3]]);
});
test("rejects invalid and oversized audio, missing files, and target override fields", async () => {
  assert.equal((await upload(doctorCookie, "text/plain")).status, 415);
  assert.equal((await upload(doctorCookie, "audio/webm", Buffer.alloc(0))).status, 400);
  assert.equal((await upload(doctorCookie, "audio/webm", Buffer.alloc(15 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await upload(doctorCookie, "audio/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), true)).status, 400);
  assert.equal((await json("/transcribe", doctorCookie, "POST", {})).status, 400);
});
test("disabled/not-configured status, key removal and failed authentication are explicit", async () => {
  await json("/settings", adminCookie, "PUT", { ...connection, enabled: false });
  assert.equal((await json("/health", doctorCookie)).data.status, "disabled"); assert.equal((await upload(doctorCookie)).status, 409);
  await json("/settings", adminCookie, "PUT", { ...connection, enabled: false, baseUrl: "" });
  assert.equal((await json("/health", doctorCookie)).data.status, "not_configured");
  assert.equal((await json("/settings", adminCookie, "PUT", { ...connection, removeApiKey: true })).data.settings.apiKeyConfigured, false);
  assert.equal((await pool.query("select api_key_secret from medical_dictation_configuration where id=1")).rows[0].api_key_secret, null);
  assert.equal((await json("/test-connection", adminCookie, "POST")).data.status, "connected");
  const result = await upload(doctorCookie); assert.equal(result.status, 502); assert.match(result.data.error.message, /authentication/); assert.doesNotMatch(JSON.stringify(result.data), /do not echo/);
});
test("invalid configuration and missing platform encryption fail securely", async () => {
  for (const change of [{ baseUrl: "http://127.0.0.1" }, { baseUrl: "ftp://server" }, { timeoutSeconds: 1 }, { timeoutSeconds: 601 }, { enabled: "true" }, { apiKey: "bad\r\nkey" }, { apiKey: "x", removeApiKey: true }]) assert.equal((await json("/settings", adminCookie, "PUT", { ...connection, ...change })).status, 400);
  const key = process.env.RISPRO_SECRET_ENCRYPTION_KEY; delete process.env.RISPRO_SECRET_ENCRYPTION_KEY;
  try {
    assert.equal((await json("/settings", adminCookie, "PUT", { ...connection, apiKey: "never-plaintext" })).status, 503);
    assert.equal((await json("/health", doctorCookie)).data.status, "error");
    assert.equal((await upload(doctorCookie)).status, 503);
    assert.equal((await pool.query("select api_key_secret from medical_dictation_configuration where id=1")).rows[0].api_key_secret, null);
  } finally { process.env.RISPRO_SECRET_ENCRYPTION_KEY = key; }
});
