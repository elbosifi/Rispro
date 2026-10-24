import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "../../app.js";
import { pool } from "../../db/pool.js";
import { decryptRuntimeSecret } from "../../services/runtime-secret-crypto.js";
import { createTestAuthCookie, createTestSupervisorReauthCookie } from "../appointments-v2/tests/integration/helpers.js";
import { DEFAULT_MEDGEMMA_INSTRUCTIONS, MEDGEMMA_TASKS } from "./task-instructions.js";

let app: http.Server;
let origin: string;
const servers: http.Server[] = [];
const users: number[] = [];
let admin: string;
let doctor: string;
let supervisor: string;
let receptionist: string;
let original: Record<string, unknown> | undefined;
let medAsrOriginal: unknown;
const oldKey = process.env.RISPRO_SECRET_ENCRYPTION_KEY;
const prefix = `medgemma_${randomUUID().replaceAll("-", "")}`;
let connection: { enabled: boolean; baseUrl: string; timeoutSeconds: number; allowInsecureHttp: boolean };
let received: unknown;
async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: http.Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
async function json(path: string, cookie = admin, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), cache: response.headers.get("cache-control") };
}
const settings = (value: unknown) => json("/medgemma/settings", admin, "PUT", value);
before(async () => {
  process.env.RISPRO_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  original = (await pool.query("select * from system_settings where category='medgemma' and setting_key='connection'")).rows[0];
  medAsrOriginal = (await pool.query("select * from medical_dictation_configuration where id=1")).rows;
  await pool.query("delete from system_settings where category='medgemma'");
  for (const role of ["super_admin", "doctor", "supervisor", "receptionist"]) {
    const result = await pool.query("insert into users(username,password_hash,full_name,role,is_active) values($1,'not-a-login',$1,$2,true) returning id", [`${prefix}_${role}`, role]);
    users.push(Number(result.rows[0].id));
  }
  await pool.query("insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active) values($1,'MedGemma Test','consultant',true)", [users[1]]);
  admin = `${createTestAuthCookie(users[0], "super_admin")}; ${createTestSupervisorReauthCookie(users[0], "super_admin")}`;
  doctor = createTestAuthCookie(users[1], "doctor"); supervisor = createTestAuthCookie(users[2], "supervisor"); receptionist = createTestAuthCookie(users[3], "receptionist");
  for (let i = 0; i < 2; i++) {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        if (req.headers["x-api-key"] !== "new-key") { res.writeHead(401); res.end("do-not-echo-secret"); return; }
        if (req.url === "/health") { res.end(JSON.stringify({ status: "ready", model: `google/medgemma-${i}` })); return; }
        received = JSON.parse(Buffer.concat(chunks).toString());
        res.end(JSON.stringify({ text: "No left frontal lesion.", processing_seconds: 2.5 }));
      });
    });
    servers.push(server); await listen(server);
  }
  connection = { enabled: true, baseUrl: `http://127.0.0.1:${(servers[0].address() as { port: number }).port}`, timeoutSeconds: 180, allowInsecureHttp: true };
  app = http.createServer(createApp()); origin = await listen(app);
});
after(async () => {
  if (app) await close(app);
  for (const server of servers) await close(server);
  await pool.query("delete from system_settings where category='medgemma'");
  if (original) await pool.query("insert into system_settings(id,category,setting_key,setting_value,updated_by_user_id,updated_at) values($1,'medgemma','connection',$2,$3,$4)", [original.id, original.setting_value, original.updated_by_user_id, original.updated_at]);
  await pool.query("delete from audit_log where changed_by_user_id=any($1::bigint[])", [users]);
  await pool.query("delete from doctor_portal.doctor_profiles where user_id=any($1::bigint[])", [users]);
  await pool.query("delete from users where id=any($1::bigint[])", [users]);
  if (oldKey === undefined) delete process.env.RISPRO_SECRET_ENCRYPTION_KEY; else process.env.RISPRO_SECRET_ENCRYPTION_KEY = oldKey;
  await pool.end();
});

test("disabled defaults need no migration; admin writes/tests require recent re-auth", async () => {
  const initial = await json("/medgemma/settings");
  assert.equal(initial.data.settings.enabled, false); assert.equal(initial.data.settings.timeoutSeconds, 180);
  assert.equal(initial.data.settings.provider, "standalone"); assert.equal(initial.data.settings.ollamaModel, "medgemma1.5:4b");
  assert.equal((await json("/medgemma/health", doctor)).data.status, "not_configured");
  assert.equal((await json("/medgemma/settings", "")).status, 401);
  for (const cookie of [doctor, supervisor, receptionist]) for (const [path, method] of [["/settings", "GET"], ["/settings", "PUT"], ["/test-connection", "POST"]]) {
    assert.equal((await json(`/medgemma${path}`, cookie, method, method === "PUT" ? connection : undefined)).status, 403);
  }
  const withoutReauth = createTestAuthCookie(users[0], "super_admin");
  assert.equal((await json("/medgemma/settings", withoutReauth, "PUT", connection)).status, 403);
  assert.equal((await json("/medgemma/test-connection", withoutReauth, "POST")).status, 403);
});
test("saves encrypted API keys, retains blank keys, replaces them and exposes no secrets in responses or audit", async () => {
  const first = await settings({ ...connection, apiKey: "old-key" });
  assert.equal(first.status, 200); assert.equal(first.cache, "no-store"); assert.equal(first.data.settings.apiKeyConfigured, true);
  assert.doesNotMatch(JSON.stringify(first.data), /old-key|ciphertext|apiKeySecret/);
  const stored = (await pool.query("select setting_value from system_settings where category='medgemma'")).rows[0].setting_value;
  assert.equal(decryptRuntimeSecret(stored.apiKeySecret), "old-key"); assert.doesNotMatch(JSON.stringify(stored), /old-key/);
  await settings({ ...connection, apiKey: "", timeoutSeconds: 200 });
  assert.deepEqual((await pool.query("select setting_value from system_settings where category='medgemma'")).rows[0].setting_value.apiKeySecret, stored.apiKeySecret);
  assert.equal((await settings({ ...connection, apiKey: "new-key" })).status, 200);
  const audit = await pool.query("select old_values,new_values from audit_log where changed_by_user_id=$1", [users[0]]);
  assert.ok(audit.rowCount! >= 3); assert.doesNotMatch(JSON.stringify(audit.rows), /old-key|new-key|ciphertext|apiKeySecret/);
  assert.doesNotMatch(JSON.stringify((await json("/medgemma/settings")).data), /new-key|ciphertext/);
});
test("generic settings endpoints cannot read or overwrite MedGemma configuration", async () => {
  const catalog = await json("/settings"); assert.equal(catalog.status, 200); assert.equal(catalog.data.settings.medgemma, undefined);
  assert.equal((await json("/settings/medgemma")).status, 404);
  assert.equal((await json("/settings/medgemma", admin, "PUT", { entries: [{ key: "connection", value: { enabled: true } }] })).status, 404);
});
test("reloads settings in a fresh process and switches mock servers immediately", async () => {
  const fresh = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", 'const {getMedGemmaSettings}=await import("./src/modules/medgemma/medgemma-settings-service.ts");const {pool}=await import("./src/db/pool.ts");console.log(JSON.stringify(await getMedGemmaSettings()));await pool.end();']);
  assert.equal(JSON.parse(fresh.stdout).baseUrl, connection.baseUrl);
  assert.equal((await json("/medgemma/test-connection", admin, "POST")).data.model, "google/medgemma-0");
  connection.baseUrl = `http://127.0.0.1:${(servers[1].address() as { port: number }).port}`;
  await settings(connection);
  assert.equal((await json("/medgemma/health", doctor)).data.model, "google/medgemma-1");
});
test("only active clinical Doctor Workspace users can generate; preserves original and uses backend prompt", async () => {
  const body = { task: "cleanup_dictation", text: "No uh left frontal lesion period" };
  for (const cookie of ["", admin, supervisor, receptionist]) {
    assert.equal((await json("/medgemma/generate", cookie, "POST", body)).status, cookie ? 403 : 401);
    assert.equal((await json("/medgemma/health", cookie)).status, cookie ? 403 : 401);
  }
  const result = await json("/medgemma/generate", doctor, "POST", body);
  assert.equal(result.status, 200); assert.deepEqual(result.data, { text: "No left frontal lesion.", processing_seconds: 2.5 });
  assert.equal(body.text, "No uh left frontal lesion period");
  assert.equal((received as typeof body).text, body.text); assert.match((received as { instructions: string }).instructions, /negation, laterality, measurements/);
  await pool.query("update doctor_portal.doctor_profiles set active=false where user_id=$1", [users[1]]);
  assert.equal((await json("/medgemma/generate", doctor, "POST", body)).status, 403);
  await pool.query("update doctor_portal.doctor_profiles set active=true where user_id=$1", [users[1]]);
});
test("rejects arbitrary upstream URLs, instructions, unsupported tasks, invalid input and oversized JSON safely", async () => {
  for (const body of [{}, { task: "other", text: "input" }, { task: "cleanup_dictation", text: "" }, { task: "cleanup_dictation", text: "input", baseUrl: "http://other" }, { task: "cleanup_dictation", text: "input", instructions: "custom" }]) assert.equal((await json("/medgemma/generate", doctor, "POST", body)).status, 400);
  assert.equal((await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "x".repeat(32_001) })).status, 413);
  assert.equal((await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "x".repeat(150_000) })).status, 413);
  const malformed = await fetch(`${origin}/api/medgemma/generate`, { method: "POST", headers: { Cookie: doctor, "Content-Type": "application/json" }, body: '{"text":"sensitive-malformed-input",oops}' });
  assert.equal(malformed.status, 400); assert.doesNotMatch(await malformed.text(), /sensitive-malformed-input/);
});
test("hospital addresses are accepted, HTTP needs acknowledgement and invalid settings are rejected", async () => {
  assert.equal((await settings({ ...connection, baseUrl: "http://192.9.101.55:8000" })).status, 200);
  for (const change of [{ allowInsecureHttp: false }, { baseUrl: "ftp://host" }, { timeoutSeconds: 1 }, { timeoutSeconds: 601 }, { enabled: "true" }, { apiKey: "bad\r\nkey" }, { apiKey: "key", removeApiKey: true }]) assert.equal((await settings({ ...connection, ...change })).status, 400);
  await settings(connection);
});
test("instruction presets and generation controls persist, forward immediately and restore defaults", async () => {
  const taskIds = ["cleanup_dictation", "correct_terminology", "format_radiology_report", "review_radiology_report"] as const;
  assert.deepEqual(MEDGEMMA_TASKS, taskIds);
  const previous = (await json("/medgemma/settings")).data.settings;
  const instructions = Object.fromEntries(MEDGEMMA_TASKS.map((task) => [task, `Custom synthetic instructions for ${task}`]));
  const saved = await settings({ ...connection, instructions, temperature: 0.2, maxGeneratedTokens: 1024 });
  assert.equal(saved.status, 200); assert.deepEqual(saved.data.settings.instructions, instructions);
  const fresh = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", 'const {getMedGemmaSettings}=await import("./src/modules/medgemma/medgemma-settings-service.ts");const {pool}=await import("./src/db/pool.ts");console.log(JSON.stringify(await getMedGemmaSettings()));await pool.end();']);
  const loaded = JSON.parse(fresh.stdout);
  assert.deepEqual(loaded.instructions, instructions); assert.equal(loaded.temperature, 0.2); assert.equal(loaded.maxGeneratedTokens, 1024);
  for (const task of taskIds) {
    const body = { task, text: "Synthetic original medical text" };
    assert.equal((await json("/medgemma/generate", doctor, "POST", body)).status, 200);
    assert.deepEqual(received, { ...body, instructions: instructions[task], temperature: 0.2, max_new_tokens: 1024 });
  }
  // Verify saved changes are forwarded, including a zero temperature, rather
  // than a client default or stale configuration. RISpro does no model work.
  assert.equal((await settings({ ...connection, temperature: 0, maxGeneratedTokens: 8192 })).status, 200);
  for (const task of taskIds) {
    const body = { task, text: "Unchanged synthetic original medical text" };
    assert.equal((await json("/medgemma/generate", doctor, "POST", body)).status, 200);
    assert.deepEqual(received, { ...body, instructions: instructions[task], temperature: 0, max_new_tokens: 8192 });
  }
  // Saving the backend-supplied default is the same action used by Restore Default in Settings.
  assert.equal((await settings({ ...connection, instructions: { cleanup_dictation: loaded.instructionDefaults.cleanup_dictation } })).status, 200);
  const restored = (await json("/medgemma/settings")).data.settings;
  assert.equal(restored.instructions.cleanup_dictation, DEFAULT_MEDGEMMA_INSTRUCTIONS.cleanup_dictation);
  assert.equal(restored.instructions.correct_terminology, instructions.correct_terminology);
  await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "input" });
  assert.equal((received as { instructions: string }).instructions, DEFAULT_MEDGEMMA_INSTRUCTIONS.cleanup_dictation);
  // Old clients saving connection fields alone must retain these new settings.
  await settings(connection);
  assert.equal((await json("/medgemma/settings")).data.settings.temperature, 0);
  await settings(previous);
});
test("legacy saved connections acquire defaults without replacing encrypted credentials", async () => {
  const stored = (await pool.query("select setting_value from system_settings where category='medgemma'")).rows[0].setting_value;
  await pool.query("update system_settings set setting_value=setting_value - 'instructions' - 'temperature' - 'maxGeneratedTokens' - 'provider' - 'ollamaBaseUrl' - 'ollamaModel' where category='medgemma'");
  const loaded = (await json("/medgemma/settings")).data.settings;
  assert.deepEqual(loaded.instructions, DEFAULT_MEDGEMMA_INSTRUCTIONS); assert.equal(loaded.temperature, 0.1); assert.equal(loaded.maxGeneratedTokens, 2048);
  assert.equal(loaded.apiKeyConfigured, true);
  assert.equal(loaded.provider, "standalone"); assert.equal(loaded.baseUrl, stored.baseUrl);
  assert.deepEqual((await pool.query("select setting_value from system_settings where category='medgemma'")).rows[0].setting_value.apiKeySecret, stored.apiKeySecret);
  assert.equal((await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "input" })).status, 200);
  await pool.query("update system_settings set setting_value=$1 where category='medgemma'", [stored]);
});
test("per-test instructions are restricted to clinical super admins and never change saved presets", async () => {
  const body = { task: "review_radiology_report", text: "Synthetic original report", instructionsOverride: "Only flag possible laterality contradictions." };
  assert.equal((await json("/medgemma/generate", doctor, "POST", body)).status, 403);
  assert.equal((await json("/medgemma/generate", admin, "POST", body)).status, 403);
  await pool.query("insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active) values($1,'Clinical admin test','consultant',true)", [users[0]]);
  const previous = (await json("/medgemma/settings")).data.settings;
  try {
    assert.equal((await json("/medgemma/generate", admin, "POST", body)).status, 200);
    assert.equal((received as { instructions: string }).instructions, body.instructionsOverride);
    for (const instructionsOverride of ["", " ", "x".repeat(8001), 123]) assert.equal((await json("/medgemma/generate", admin, "POST", { ...body, instructionsOverride })).status, 400);
    assert.deepEqual((await json("/medgemma/settings")).data.settings, previous);
    const audit = await pool.query("select old_values,new_values from audit_log where changed_by_user_id=any($1::bigint[])", [users]);
    assert.doesNotMatch(JSON.stringify(audit.rows), /Synthetic original report|Only flag possible laterality contradictions/);
  } finally { await pool.query("delete from doctor_portal.doctor_profiles where user_id=$1", [users[0]]); }
});
test("rejects invalid generation settings and unknown or empty instruction presets", async () => {
  for (const change of [{ temperature: -0.1 }, { temperature: 1.1 }, { temperature: "0.1" }, { maxGeneratedTokens: 127 }, { maxGeneratedTokens: 8193 }, { maxGeneratedTokens: 200.5 }, { instructions: null }, { instructions: [] }, { instructions: { unknown: "test" } }, { instructions: { cleanup_dictation: "" } }, { instructions: { correct_terminology: "x".repeat(8001) } }]) {
    assert.equal((await settings({ ...connection, ...change })).status, 400);
  }
});

test("Ollama switches without replacing standalone credentials and uses saved instructions through unchanged routes", async () => {
  const previous = (await json("/medgemma/settings")).data.settings;
  const stored = (await pool.query("select setting_value from system_settings where category='medgemma'")).rows[0].setting_value;
  const encryptionKey = process.env.RISPRO_SECRET_ENCRYPTION_KEY;
  let installed = true;
  let ollamaRequest: Record<string, unknown> | undefined;
  const model = "medgemma1.5:4b";
  const server = http.createServer((req, res) => {
    assert.equal(req.headers["x-api-key"], undefined); assert.equal(req.headers.authorization, undefined);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") { res.end(JSON.stringify({ models: installed ? [{ name: model }] : [] })); return; }
    assert.equal(req.url, "/api/chat");
    let body = ""; req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => { ollamaRequest = JSON.parse(body); res.end(JSON.stringify({ message: { content: "Generated result" }, total_duration: 2_500_000_000 })); });
  });
  servers.push(server);
  const ollamaBaseUrl = await listen(server);
  const selected = { ...previous, provider: "ollama", baseUrl: "", ollamaBaseUrl, ollamaModel: model, temperature: 0, maxGeneratedTokens: 512, removeApiKey: true };
  try {
    assert.equal((await settings(selected)).status, 200);
    const loaded = (await json("/medgemma/settings")).data.settings;
    assert.equal(loaded.provider, "ollama"); assert.equal(loaded.baseUrl, previous.baseUrl); assert.equal(loaded.apiKeyConfigured, true);
    assert.deepEqual(loaded.instructions, previous.instructions);
    assert.deepEqual((await pool.query("select setting_value from system_settings where category='medgemma'")).rows[0].setting_value.apiKeySecret, stored.apiKeySecret);
    assert.deepEqual((await json("/medgemma/test-connection", admin, "POST")).data, { status: "connected", model });
    for (const task of MEDGEMMA_TASKS) {
      const result = await json("/medgemma/generate", doctor, "POST", { task, text: "Original synthetic text" });
      assert.equal(result.status, 200); assert.deepEqual(result.data, { text: "Generated result", processing_seconds: 2.5 });
      assert.deepEqual(ollamaRequest, { model, stream: false, messages: [{ role: "user", content: `Task: ${task}\nInstructions:\n${previous.instructions[task]}\n\nOriginal text:\nOriginal synthetic text` }], options: { temperature: 0, num_predict: 512 } });
    }
    // Existing administrator overrides remain clinical-profile and role gated.
    const override = { task: "cleanup_dictation", text: "source", instructionsOverride: "Only correct punctuation." };
    assert.equal((await json("/medgemma/generate", doctor, "POST", override)).status, 403);
    await pool.query("insert into doctor_portal.doctor_profiles(user_id,display_name,doctor_role,active) values($1,'Ollama admin test','consultant',true)", [users[0]]);
    try {
      assert.equal((await json("/medgemma/generate", admin, "POST", override)).status, 200);
      assert.match(JSON.stringify(ollamaRequest), /Only correct punctuation/);
      assert.deepEqual((await json("/medgemma/settings")).data.settings.instructions, previous.instructions);
    } finally { await pool.query("delete from doctor_portal.doctor_profiles where user_id=$1", [users[0]]); }
    installed = false;
    const missing = (await json("/medgemma/health", doctor)).data;
    assert.equal(missing.status, "unavailable"); assert.equal(missing.model, model); assert.match(missing.message, /not installed/);
    installed = true;
    // An encrypted standalone key can remain stored even if platform encryption
    // is unavailable: Ollama must neither decrypt it nor require a replacement.
    delete process.env.RISPRO_SECRET_ENCRYPTION_KEY;
    assert.equal((await settings({ ...selected, removeApiKey: false, apiKey: "ignored-standalone-key" })).status, 200);
    assert.deepEqual((await json("/medgemma/health", doctor)).data, { status: "connected", model });
    assert.equal((await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "source" })).status, 200);
    assert.equal((await settings(previous)).status, 503);
  } finally {
    process.env.RISPRO_SECRET_ENCRYPTION_KEY = encryptionKey;
    assert.equal((await settings(previous)).status, 200);
  }
  assert.deepEqual((await pool.query("select setting_value from system_settings where category='medgemma'")).rows[0].setting_value.apiKeySecret, stored.apiKeySecret);
  assert.equal((await json("/medgemma/health", doctor)).data.model, "google/medgemma-1");
});

test("Ollama works without standalone configuration or encryption, while retaining validation and authorization", async () => {
  const previous = (await json("/medgemma/settings")).data.settings;
  const encryptionKey = process.env.RISPRO_SECRET_ENCRYPTION_KEY;
  try {
    await settings({ ...connection, enabled: false, baseUrl: "", removeApiKey: true });
    delete process.env.RISPRO_SECRET_ENCRYPTION_KEY;
    const ollamaBaseUrl = `http://127.0.0.1:${(servers[2].address() as { port: number }).port}`;
    const selected = { ...connection, baseUrl: "", provider: "ollama", ollamaBaseUrl, ollamaModel: "medgemma1.5:4b" };
    assert.equal((await settings(selected)).status, 200);
    assert.deepEqual((await json("/medgemma/health", doctor)).data, { status: "connected", model: selected.ollamaModel });
    assert.equal((await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "source" })).status, 200);
    for (const change of [{ provider: "unknown" }, { ollamaBaseUrl: "ftp://host" }, { ollamaBaseUrl: "http://host/api" }, { ollamaBaseUrl: "http://user:pass@host" }, { ollamaBaseUrl: "" }, { ollamaBaseUrl: 123 }, { ollamaModel: "" }, { ollamaModel: "name with spaces" }, { ollamaModel: "x".repeat(201) }, { allowInsecureHttp: false }]) assert.equal((await settings({ ...selected, ...change })).status, 400);
    for (const cookie of [doctor, supervisor, receptionist]) assert.equal((await json("/medgemma/test-connection", cookie, "POST")).status, 403);
    assert.equal((await settings({ ...selected, enabled: false, ollamaBaseUrl: "" })).status, 200);
    assert.equal((await json("/medgemma/health", doctor)).data.status, "not_configured");
  } finally {
    process.env.RISPRO_SECRET_ENCRYPTION_KEY = encryptionKey;
    await settings({ ...previous, apiKey: "new-key" });
  }
});
test("disable/not configured, key removal, failed auth and platform encryption failure are explicit; MedASR is unchanged", async () => {
  await settings({ ...connection, enabled: false });
  assert.equal((await json("/medgemma/health", doctor)).data.status, "disabled");
  assert.equal((await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "input" })).status, 409);
  await settings({ ...connection, enabled: false, baseUrl: "" });
  assert.equal((await json("/medgemma/health", doctor)).data.status, "not_configured");
  assert.equal((await settings({ ...connection, removeApiKey: true })).data.settings.apiKeyConfigured, false);
  assert.equal((await json("/medgemma/test-connection", admin, "POST")).data.status, "unavailable");
  const failure = await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "input" });
  assert.equal(failure.status, 502); assert.doesNotMatch(JSON.stringify(failure.data), /do-not-echo-secret/);
  delete process.env.RISPRO_SECRET_ENCRYPTION_KEY;
  try {
    assert.equal((await settings({ ...connection, apiKey: "not-plaintext" })).status, 503);
    assert.equal((await json("/medgemma/health", doctor)).data.status, "unavailable");
    assert.equal((await json("/medgemma/generate", doctor, "POST", { task: "cleanup_dictation", text: "input" })).status, 503);
  } finally { process.env.RISPRO_SECRET_ENCRYPTION_KEY = oldKey ?? randomBytes(32).toString("base64"); }
  assert.deepEqual((await pool.query("select * from medical_dictation_configuration where id=1")).rows, medAsrOriginal);
});
