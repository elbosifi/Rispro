import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { pool } from "../../db/pool.js";
import { activateWithRollback, getHttpsSettings, recoverHttpsConfiguration, saveHttpsSettings } from "./https-service.js";
import { decryptRuntimeSecret } from "../../services/runtime-secret-crypto.js";
import { getSettingsByCategory, listSettingsCatalog, upsertSettings } from "../../services/settings-service.js";
import express from "express";
import cookieParser from "cookie-parser";
import { settingsRouter } from "../../routes/settings.js";
import { buildSessionToken, buildSupervisorReauthToken, writeSessionCookie, writeSupervisorReauthCookie } from "../../services/auth-service.js";
import { env } from "../../config/env.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readToken, readSupervisorReauthToken } from "../../middleware/auth.js";
import http from "node:http";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

test.after(() => pool.end());

test("encrypted account persists across reads, remains absent from generic settings and audit, and retains on blank submission", async () => {
  const oldKey = process.env.RISPRO_SECRET_ENCRYPTION_KEY;
  process.env.RISPRO_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  const previous = await pool.query("select * from system_settings where category='automatic_https'");
  const created = await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'HTTPS synthetic administrator','test','super_admin',true) returning id", [`https_test_${Date.now()}`]);
  const userId = Number(created.rows[0].id);
  const input = { enabled: true, hostname: "rispro.nccb.com.ly", serverUrl: "https://provider.example.org", subdomain: "synthetic", fullDomain: "synthetic.provider.example.org", username: "synthetic-user", password: "synthetic-secret" };
  try {
    await pool.query("delete from system_settings where category='automatic_https'");
    const saved = await saveHttpsSettings(input, userId);
    assert.equal(saved.credentialsConfigured, true);
    assert.equal(saved.status, "Pending");
    assert.equal(JSON.stringify(saved).includes(input.password), false);
    assert.equal(JSON.stringify(saved).includes(input.username), false);
    const stored = await pool.query("select setting_value from system_settings where category='automatic_https'");
    assert.equal(JSON.stringify(stored.rows).includes(input.password), false);
    assert.deepEqual(JSON.parse(decryptRuntimeSecret(stored.rows[0].setting_value.draft.credentials)), { username: input.username, password: input.password });
    const reread = await getHttpsSettings();
    assert.deepEqual(reread, saved);
    await saveHttpsSettings({ ...input, username: "", password: "" }, userId);
    assert.equal((await getHttpsSettings()).credentialsConfigured, true);
    assert.equal((await listSettingsCatalog()).automatic_https, undefined);
    await assert.rejects(getSettingsByCategory("automatic_https"), /dedicated endpoint/);
    await assert.rejects(upsertSettings("automatic_https", [{ key: "configuration", value: "bypass" }], userId), /dedicated endpoint/);
    const audit = await pool.query("select new_values from audit_log where entity_type='https_configuration' and changed_by_user_id=$1", [userId]);
    assert.equal(audit.rows.length, 2);
    assert.equal(JSON.stringify(audit.rows).includes(input.password), false);
    assert.equal(JSON.stringify(audit.rows).includes(input.username), false);
  } finally {
    await pool.query("delete from audit_log where entity_type='https_configuration' and changed_by_user_id=$1", [userId]);
    await pool.query("delete from system_settings where category='automatic_https'");
    for (const row of previous.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [row.category, row.setting_key, JSON.stringify(row.setting_value), row.updated_by_user_id]);
    await pool.query("delete from users where id=$1", [userId]);
    if (oldKey === undefined) delete process.env.RISPRO_SECRET_ENCRYPTION_KEY; else process.env.RISPRO_SECRET_ENCRYPTION_KEY = oldKey;
  }
});

test("activation order verifies trust and gateway before commit, and rolls back any failure", async () => {
  const steps = ["credentials", "dns", "apply", "verify", "commit"] as const;
  for (const failAt of [...steps, "none"]) {
    const calls: string[] = [];
    const operation = (name: string) => async () => { calls.push(name); if (failAt === name) throw new Error(`synthetic ${name} failure`); };
    const operations = { credentials: operation("credentials"), dns: operation("dns"), apply: operation("apply"), verify: operation("verify"), commit: operation("commit"), rollback: operation("rollback") };
    if (failAt === "none") { await activateWithRollback(operations); assert.deepEqual(calls, steps); }
    else { await assert.rejects(activateWithRollback(operations), /synthetic/); assert.deepEqual(calls, [...steps.slice(0, steps.indexOf(failAt as typeof steps[number]) + 1), "rollback"]); }
  }
});

test("HTTPS settings endpoints enforce authentication, super-admin role and recent reauthentication", async () => {
  const users = await pool.query(`insert into users(username,full_name,password_hash,role,is_active)
    values($1,'HTTPS synthetic administrator','test','super_admin',true),($2,'HTTPS synthetic supervisor','test','supervisor',true)
    returning id,username,full_name,role,auth_version`, [`https_admin_${Date.now()}`, `https_supervisor_${Date.now()}`]);
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use("/api/settings", settingsRouter);
  app.use((error: { statusCode?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.statusCode || 500).json({ message: error.message }); });
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const cookie = (role: string, recent = false) => {
    const user = { ...users.rows.find((item) => item.role === role), must_change_password: false };
    return `${env.cookieName}=${buildSessionToken(user)}${recent ? `; ${env.reauthCookieName}=${buildSupervisorReauthToken(user)}` : ""}`;
  };
  try {
    for (const [method, route] of [["GET", ""], ["GET", "/status"], ["PUT", ""], ["POST", "/activate"], ["POST", "/check-dns"]]) {
      const request = (credential?: string) => fetch(`http://127.0.0.1:${address.port}/api/settings/https${route}`, { method, headers: credential ? { Cookie: credential } : {} });
      assert.equal((await request()).status, 401, `${method} ${route} anonymous`);
      assert.equal((await request(cookie("supervisor", true))).status, 403, `${method} ${route} supervisor`);
      assert.equal((await request(cookie("super_admin"))).status, 403, `${method} ${route} without reauthentication`);
    }
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/settings/https`, { headers: { Cookie: cookie("super_admin", true) } })).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/settings/https`, { method: "PUT", headers: { Cookie: cookie("super_admin", true), "X-Forwarded-Proto": "https" } })).status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query("delete from users where id = any($1::int[])", [users.rows.map((user) => Number(user.id))]);
  }
});

test("HTTPS session and reauthentication cookies are Secure and coexist with unchanged HTTP cookies", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-https-cookie-"));
  const names = ["RISPRO_HTTPS_PROVISIONED", "RISPRO_HTTPS_GATEWAY_IDENTITY_FILE"];
  const before = names.map((name) => process.env[name]);
  process.env.RISPRO_HTTPS_PROVISIONED = "true";
  process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE = path.join(directory, "identity");
  try {
    const identity = "a".repeat(64);
    await writeFile(path.join(directory, "identity"), identity);
    const cookies: Array<{ name: string; secure?: boolean; httpOnly?: boolean }> = [];
    const secureRequest = { secure: true, headers: { "x-rispro-https-gateway": identity } } as unknown as express.Request;
    const httpRequest = { secure: true, headers: { "x-forwarded-proto": "https" } } as unknown as express.Request;
    const capture = (req: express.Request) => ({ req, cookie: (name: string, _value: string, options: object) => { cookies.push({ name, ...options }); } });
    writeSessionCookie(capture(secureRequest), "synthetic-session"); writeSupervisorReauthCookie(capture(secureRequest), "synthetic-reauth");
    assert.equal(cookies[0].name, `${env.cookieName}_https`);
    assert.equal(cookies[1].name, `${env.reauthCookieName}_https`);
    for (const value of cookies) { assert.equal(value.secure, true); assert.equal(value.httpOnly, true); }
    writeSessionCookie(capture(httpRequest), "legacy-session"); writeSupervisorReauthCookie(capture(httpRequest), "legacy-reauth");
    assert.equal(cookies[2].name, env.cookieName); assert.equal(cookies[2].secure, env.cookieSecure);
    assert.equal(cookies[3].name, env.reauthCookieName); assert.equal(cookies[3].secure, env.cookieSecure);
    const both = { [env.cookieName]: "legacy-session", [`${env.cookieName}_https`]: "synthetic-session", [env.reauthCookieName]: "legacy-reauth", [`${env.reauthCookieName}_https`]: "synthetic-reauth" };
    secureRequest.cookies = both; httpRequest.cookies = both;
    assert.equal(readToken(secureRequest), "synthetic-session"); assert.equal(readToken(httpRequest), "legacy-session");
    assert.equal(readSupervisorReauthToken(secureRequest), "synthetic-reauth"); assert.equal(readSupervisorReauthToken(httpRequest), "legacy-reauth");
  } finally {
    for (let index = 0; index < names.length; index++) { if (before[index] === undefined) delete process.env[names[index]]; else process.env[names[index]] = before[index]; }
    await rm(directory, { recursive: true, force: true });
  }
});

test("restart recovery resolves interrupted activation before attempting the private Caddy reload", async () => {
  const previous = await pool.query("select * from system_settings where category='automatic_https'");
  const auditId = Number((await pool.query("select coalesce(max(id),0) as id from audit_log")).rows[0].id);
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-https-recovery-"));
  const oldProvisioned = process.env.RISPRO_HTTPS_PROVISIONED;
  const oldDirectory = process.env.RISPRO_HTTPS_RUNTIME_DIR;
  process.env.RISPRO_HTTPS_PROVISIONED = "true"; process.env.RISPRO_HTTPS_RUNTIME_DIR = directory;
  let phaseAtReload: string | undefined;
  const requestMock = mock.method(http, "request", ((_options: unknown, callback: (response: { statusCode: number; resume: () => void }) => void) => {
    const request = new EventEmitter();
    return Object.assign(request, { setTimeout: () => request, end: () => {
      void pool.query("select setting_value from system_settings where category='automatic_https'").then((result) => {
        phaseAtReload = result.rows[0].setting_value.phase;
        callback({ statusCode: 200, resume: () => undefined });
      }).catch((error: Error) => request.emit("error", error));
      return request;
    } });
  }) as unknown as typeof http.request);
  try {
    await pool.query("delete from system_settings where category='automatic_https'");
    await pool.query("insert into system_settings(category,setting_key,setting_value) values('automatic_https','configuration',$1::jsonb)", [JSON.stringify({ draft: null, active: null, phase: "pending", lastError: null, certificate: null })]);
    await recoverHttpsConfiguration();
    assert.equal(phaseAtReload, "error");
    const status = await getHttpsSettings();
    assert.equal(status.activationPending, false);
    assert.equal(status.redirectHttpToHttps, false);
    assert.equal(status.httpRedirectActive, false);
    assert.match(status.lastError || "", /interrupted by a restart/);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "current.json"), "utf8")).apps, {});
  } finally {
    requestMock.mock.restore();
    await pool.query("delete from audit_log where entity_type='https_configuration' and id>$1", [auditId]);
    await pool.query("delete from system_settings where category='automatic_https'");
    for (const row of previous.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [row.category, row.setting_key, JSON.stringify(row.setting_value), row.updated_by_user_id]);
    if (oldProvisioned === undefined) delete process.env.RISPRO_HTTPS_PROVISIONED; else process.env.RISPRO_HTTPS_PROVISIONED = oldProvisioned;
    if (oldDirectory === undefined) delete process.env.RISPRO_HTTPS_RUNTIME_DIR; else process.env.RISPRO_HTTPS_RUNTIME_DIR = oldDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
