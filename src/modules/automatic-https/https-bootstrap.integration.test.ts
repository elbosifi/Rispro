import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mock } from "node:test";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { settingsRouter } from "../../routes/settings.js";
import { buildSessionToken, buildSupervisorReauthToken } from "../../services/auth-service.js";
import { activateHttps, allowBootstrapClient, getHttpsSettings, reconcileHttpsBootstrap, recoverHttpsConfiguration, saveHttpsSettings } from "./https-service.js";
import { issueBootstrapCode } from "./https-bootstrap.js";

test.after(() => pool.end());

test("console authorizes one source temporarily and expiry or reload failure restores restrictions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-bootstrap-client-"));
  const keys = ["RISPRO_HTTPS_PROVISIONED", "RISPRO_HTTPS_GATEWAY_IDENTITY_FILE", "RISPRO_HTTPS_BOOTSTRAP_IP_FILE", "RISPRO_HTTPS_RUNTIME_DIR"];
  const before = keys.map((key) => process.env[key]);
  process.env.RISPRO_HTTPS_PROVISIONED = "true"; process.env.RISPRO_HTTPS_RUNTIME_DIR = directory;
  process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE = path.join(directory, "identity"); process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE = path.join(directory, "ip");
  await writeFile(path.join(directory, "identity"), "c".repeat(64)); await writeFile(path.join(directory, "ip"), "192.9.101.250");
  const previous = await pool.query("select * from system_settings where category='automatic_https' and setting_key='configuration'");
  const applied: string[] = []; let status = 200;
  const caddyMock = mock.method(http, "request", ((_options: unknown, callback: (response: { statusCode: number; resume: () => void }) => void) => {
    const request = new EventEmitter();
    return Object.assign(request, { setTimeout: () => request, end: (body: string) => { applied.push(body); callback({ statusCode: status, resume: () => undefined }); return request; } });
  }) as unknown as typeof http.request);
  try {
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='configuration'");
    await writeFile(path.join(directory, "ip"), "!ambiguous-routes");
    await assert.rejects(issueBootstrapCode(), /Multiple default routes have the same lowest metric/);
    await writeFile(path.join(directory, "ip"), "192.9.101.250");
    await assert.rejects(allowBootstrapClient("192.9.101.0/24"), /unicast IPv4/);
    await allowBootstrapClient("192.9.101.42");
    const clientFile = path.join(directory, "bootstrap-client.json");
    const entry = JSON.parse(await readFile(clientFile, "utf8"));
    assert.equal(entry.ip, "192.9.101.42");
    assert.ok(entry.expiresAt > Date.now() && entry.expiresAt <= Date.now() + 300_000);
    assert.match(applied.at(-1)!, /192\.9\.101\.42\/32/);
    status = 500;
    await assert.rejects(allowBootstrapClient("192.9.101.43"), /reload and restoration failed/);
    assert.equal(JSON.parse(await readFile(clientFile, "utf8")).ip, "192.9.101.42");
    status = 200;
    await reconcileHttpsBootstrap();
    assert.match(applied.at(-1)!, /192\.9\.101\.42\/32/);
    assert.doesNotMatch(applied.at(-1)!, /192\.9\.101\.43\/32/);
    await writeFile(clientFile, JSON.stringify({ ...entry, expiresAt: Date.now() - 1 }));
    await reconcileHttpsBootstrap();
    assert.doesNotMatch(applied.at(-1)!, /192\.9\.101\.42\/32/);
    await assert.rejects(readFile(clientFile));
    await recoverHttpsConfiguration();
    assert.doesNotMatch(applied.at(-1)!, /192\.9\.101\.42\/32/);
    // The console runs in a separate process, so the app may not know it
    // loaded an address before the entry expired.
    await writeFile(clientFile, JSON.stringify({ ...entry, expiresAt: Date.now() - 1 }));
    const reloads = applied.length;
    await reconcileHttpsBootstrap();
    assert.equal(applied.length, reloads + 1);
    assert.doesNotMatch(applied.at(-1)!, /192\.9\.101\.42\/32/);
  } finally {
    caddyMock.mock.restore();
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='configuration'");
    for (const row of previous.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [row.category, row.setting_key, JSON.stringify(row.setting_value), row.updated_by_user_id]);
    for (let index = 0; index < keys.length; index++) { if (before[index] === undefined) delete process.env[keys[index]]; else process.env[keys[index]] = before[index]; }
    await rm(directory, { recursive: true, force: true });
  }
});

test("temporary bootstrap requires super-admin reauthentication and an expiring, single-use, rate-limited code", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-bootstrap-auth-"));
  const keys = ["RISPRO_HTTPS_PROVISIONED", "RISPRO_HTTPS_GATEWAY_IDENTITY_FILE", "RISPRO_SECRET_ENCRYPTION_KEY"];
  const before = keys.map((key) => process.env[key]);
  const identity = "b".repeat(64);
  process.env.RISPRO_HTTPS_PROVISIONED = "true"; process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE = path.join(directory, "identity");
  process.env.RISPRO_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  await writeFile(path.join(directory, "identity"), identity);
  const existing = await pool.query("select * from system_settings where category='automatic_https' and setting_key='bootstrap_code'");
  const existingConfiguration = await pool.query("select * from system_settings where category='automatic_https' and setting_key='configuration'");
  const users = await pool.query(`insert into users(username,full_name,password_hash,role,is_active)
    values($1,'Bootstrap super admin','test','super_admin',true),($2,'Bootstrap supervisor','test','supervisor',true) returning id,username,full_name,role,auth_version`, [`bootstrap_admin_${Date.now()}`, `bootstrap_supervisor_${Date.now()}`]);
  const app = express(); app.set("trust proxy", 1); app.use(express.json()); app.use(cookieParser()); app.use("/api/settings", settingsRouter);
  app.use((error: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(error.statusCode || 500));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  const cookie = (role: string, recent = true, secure = true) => {
    const user = { ...users.rows.find((item) => item.role === role), must_change_password: false };
    return `${env.cookieName}${secure ? "_https" : ""}=${buildSessionToken(user)}${recent ? `; ${env.reauthCookieName}${secure ? "_https" : ""}=${buildSupervisorReauthToken(user)}` : ""}`;
  };
  const code = "0123456789abcdef";
  const saveCode = (expiresAt: number) => pool.query(`insert into system_settings(category,setting_key,setting_value) values('automatic_https','bootstrap_code',$1::jsonb)
    on conflict(category,setting_key) do update set setting_value=excluded.setting_value`, [JSON.stringify({ digest: createHash("sha256").update(code).digest("hex"), expiresAt })]);
  const submit = (credential: string | undefined, value: string, bootstrap = true) => fetch(`http://127.0.0.1:${port}/api/settings/https/bootstrap-authorize`, { method: "POST", headers: { "Content-Type": "application/json", ...(credential ? { Cookie: credential } : {}), ...(bootstrap ? { "X-Forwarded-Proto": "https", "X-Rispro-Https-Gateway": identity, "X-Rispro-Temporary-Bootstrap": identity } : {}) }, body: JSON.stringify({ code: value }) });
  const save = (credential: string, bootstrap: boolean) => fetch(`http://127.0.0.1:${port}/api/settings/https`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: credential, ...(bootstrap ? { "X-Forwarded-Proto": "https", "X-Rispro-Https-Gateway": identity, "X-Rispro-Temporary-Bootstrap": identity } : {}) }, body: JSON.stringify({ provider: "cloudflare", enabled: true, hostname: "ris.example.org", token: `synthetic_${"x".repeat(30)}` }) });
  try {
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='bootstrap_code'");
    assert.equal((await submit(undefined, code)).status, 401);
    assert.equal((await submit(cookie("supervisor"), code)).status, 403);
    assert.equal((await submit(cookie("super_admin", false), code)).status, 403);
    assert.equal((await submit(cookie("super_admin", true, false), code, false)).status, 403);
    assert.equal((await save(cookie("super_admin", true, false), false)).status, 403);
    const localSecret = await fetch(`http://127.0.0.1:${port}/api/settings/https`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie("super_admin", true, false), Host: "localhost:3001", "X-Rispro-Local-Bootstrap": identity }, body: JSON.stringify({ provider: "cloudflare", enabled: true, hostname: "ris.example.org", token: `synthetic_${"x".repeat(30)}` }) });
    assert.equal(localSecret.status, 403);
    assert.equal((await save(cookie("super_admin"), true)).status, 403);
    await saveCode(Date.now() - 1000);
    assert.equal((await submit(cookie("super_admin"), code)).status, 403);
    await saveCode(Date.now() + 60_000);
    assert.equal((await submit(cookie("super_admin"), "ffffffffffffffff")).status, 403);
    const authenticated = cookie("super_admin");
    const attempts = await Promise.all([submit(authenticated, code), submit(authenticated, code)]);
    assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 403]);
    const success = attempts.find((response) => response.status === 200)!;
    assert.match(success.headers.get("set-cookie") || "", /HttpOnly; Secure; SameSite=Strict/i);
    const grant = (success.headers.get("set-cookie") || "").split(";")[0];
    const saved = await save(`${authenticated}; ${grant}`, true);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).temporaryBootstrap, true);
    assert.equal((await submit(cookie("super_admin"), code)).status, 429);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query("delete from audit_log where entity_type='https_configuration' and changed_by_user_id=any($1::int[])", [users.rows.map((user) => user.id)]);
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='bootstrap_code'");
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='configuration'");
    for (const row of existing.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [row.category, row.setting_key, JSON.stringify(row.setting_value), row.updated_by_user_id]);
    for (const row of existingConfiguration.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [row.category, row.setting_key, JSON.stringify(row.setting_value), row.updated_by_user_id]);
    await pool.query("delete from users where id=any($1::int[])", [users.rows.map((user) => user.id)]);
    for (let index = 0; index < keys.length; index++) { if (before[index] === undefined) delete process.env[keys[index]]; else process.env[keys[index]] = before[index]; }
    await rm(directory, { recursive: true, force: true });
  }
});

test("verified activation removes bootstrap and failure restores it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-bootstrap-activation-"));
  const keys = ["RISPRO_HTTPS_PROVISIONED", "RISPRO_HTTPS_GATEWAY_IDENTITY_FILE", "RISPRO_HTTPS_BOOTSTRAP_IP_FILE", "RISPRO_HTTPS_RUNTIME_DIR", "RISPRO_SECRET_ENCRYPTION_KEY", "NODE_ENV"];
  const before = keys.map((key) => process.env[key]);
  process.env.RISPRO_HTTPS_PROVISIONED = "true"; process.env.RISPRO_HTTPS_RUNTIME_DIR = directory;
  process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE = path.join(directory, "identity"); process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE = path.join(directory, "ip");
  process.env.RISPRO_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64"); process.env.NODE_ENV = "production";
  await writeFile(path.join(directory, "identity"), "a".repeat(64)); await writeFile(path.join(directory, "ip"), "192.168.55.23");
  const previous = await pool.query("select * from system_settings where category='automatic_https' and setting_key='configuration'");
  const created = await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'Bootstrap activation','test','super_admin',true) returning id", [`bootstrap_activation_${Date.now()}`]);
  const userId = Number(created.rows[0].id);
  const applied: Array<{ apps: { http: { servers: Record<string, unknown> } } }> = [];
  const caddyMock = mock.method(http, "request", ((_options: unknown, callback: (response: { statusCode: number; resume: () => void }) => void) => {
    const request = new EventEmitter();
    return Object.assign(request, { setTimeout: () => request, end: (body: string) => { applied.push(JSON.parse(body)); callback({ statusCode: 200, resume: () => undefined }); return request; } });
  }) as unknown as typeof http.request);
  const httpsMock = mock.method(https, "request", ((options: { hostname: string }, callback: (response: EventEmitter) => void) => {
    const request = new EventEmitter();
    return Object.assign(request, { setTimeout: () => request, end: () => {
      const publicGateway = options.hostname === "caddy";
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { "x-rispro-https-gateway": "caddy" }, socket: { getPeerCertificate: () => ({ issuer: { O: "Synthetic trusted issuer" }, valid_to: "Jan 01 2030 00:00:00 GMT" }) } });
      callback(response);
      response.emit("data", Buffer.from(JSON.stringify(publicGateway ? { ok: true } : { success: true, result: [{ name: "ris.example.org", status: "active" }] })));
      response.emit("end"); return request;
    } });
  }) as unknown as typeof https.request);
  try {
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='configuration'");
    const input = { provider: "cloudflare", enabled: true, hostname: "ris.example.org", token: `synthetic_${"x".repeat(30)}` };
    await saveHttpsSettings(input, userId);
    await activateHttps(userId, true);
    for (let attempt = 0; applied.length < 2 && attempt < 120; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(applied.length, 2);
    assert.ok(applied[0].apps.http.servers.bootstrap);
    assert.equal(applied[1].apps.http.servers.bootstrap, undefined);
    assert.equal((await getHttpsSettings()).status, "Active");
    await new Promise((resolve) => setTimeout(resolve, 200));
    process.env.NODE_ENV = "test";
    await saveHttpsSettings({ ...input, token: "" }, userId);
    await activateHttps(userId, true);
    for (let attempt = 0; applied.length < 4 && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(applied.length, 4);
    assert.ok(applied[3].apps.http.servers.bootstrap);
    const state = await getHttpsSettings();
    assert.equal(state.status, "Error");
    assert.equal(state.activeHostname, "ris.example.org");
  } finally {
    caddyMock.mock.restore(); httpsMock.mock.restore();
    await pool.query("delete from audit_log where entity_type='https_configuration' and changed_by_user_id=$1", [userId]);
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='configuration'");
    for (const row of previous.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [row.category, row.setting_key, JSON.stringify(row.setting_value), row.updated_by_user_id]);
    await pool.query("delete from users where id=$1", [userId]);
    for (let index = 0; index < keys.length; index++) { if (before[index] === undefined) delete process.env[keys[index]]; else process.env[keys[index]] = before[index]; }
    await rm(directory, { recursive: true, force: true });
  }
});

test("restart recovery restores the temporary listener after an interrupted initial activation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-bootstrap-restart-"));
  const keys = ["RISPRO_HTTPS_PROVISIONED", "RISPRO_HTTPS_GATEWAY_IDENTITY_FILE", "RISPRO_HTTPS_BOOTSTRAP_IP_FILE", "RISPRO_HTTPS_RUNTIME_DIR"];
  const before = keys.map((key) => process.env[key]);
  process.env.RISPRO_HTTPS_PROVISIONED = "true"; process.env.RISPRO_HTTPS_RUNTIME_DIR = directory;
  process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE = path.join(directory, "identity"); process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE = path.join(directory, "ip");
  await writeFile(path.join(directory, "identity"), "c".repeat(64)); await writeFile(path.join(directory, "ip"), "192.168.55.23");
  const previous = await pool.query("select * from system_settings where category='automatic_https' and setting_key='configuration'");
  const auditId = Number((await pool.query("select coalesce(max(id),0) as id from audit_log")).rows[0].id);
  let loaded: { apps: { http: { servers: { bootstrap?: unknown } } } } | undefined;
  const caddyMock = mock.method(http, "request", ((_options: unknown, callback: (response: { statusCode: number; resume: () => void }) => void) => {
    const request = new EventEmitter();
    return Object.assign(request, { setTimeout: () => request, end: (body: string) => { loaded = JSON.parse(body); callback({ statusCode: 200, resume: () => undefined }); return request; } });
  }) as unknown as typeof http.request);
  try {
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='configuration'");
    await pool.query("insert into system_settings(category,setting_key,setting_value) values('automatic_https','configuration',$1::jsonb)", [JSON.stringify({ draft: null, active: null, phase: "pending", lastError: null, certificate: null })]);
    await recoverHttpsConfiguration();
    assert.ok(loaded?.apps.http.servers.bootstrap);
    const state = await getHttpsSettings();
    assert.equal(state.status, "Error");
    assert.match(state.bootstrapUrl || "", /^https:\/\/192\.168\.55\.23:3443\//);
  } finally {
    caddyMock.mock.restore();
    await pool.query("delete from audit_log where entity_type='https_configuration' and action_type='https_activation_recovered' and id>$1", [auditId]);
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='configuration'");
    for (const row of previous.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [row.category, row.setting_key, JSON.stringify(row.setting_value), row.updated_by_user_id]);
    for (let index = 0; index < keys.length; index++) { if (before[index] === undefined) delete process.env[keys[index]]; else process.env[keys[index]] = before[index]; }
    await rm(directory, { recursive: true, force: true });
  }
});
