import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { pool } from "../db/pool.js";
import { nameDictionaryRouter } from "./name-dictionary.js";
import { settingsRouter } from "./settings.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createTestAuthCookie, createTestSupervisorReauthCookie } from "../modules/appointments-v2/tests/integration/helpers.js";
import { invalidateCache } from "../utils/cache.js";

const marker = crypto.randomUUID().replaceAll("-", "");
let userId: number;
let baseUrl: string;
let server: http.Server;
const token = (role: "receptionist" | "supervisor" | "super_admin", reauth = false) => createTestAuthCookie(userId, role) + (reauth && role !== "receptionist" ? `; ${createTestSupervisorReauthCookie(userId, role)}` : "");
async function request(path: string, method = "GET", cookie = "", body?: unknown) {
  return fetch(baseUrl + path, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
test.before(async () => {
  userId = Number((await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'Dictionary routes','test','supervisor',true) returning id", [`dictionary_routes_${marker}`])).rows[0].id);
  const app = express(); app.use(express.json(), cookieParser());
  app.use("/api/name-dictionary", nameDictionaryRouter); app.use("/api/settings", settingsRouter); app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.query("delete from name_dictionary where arabic_text like $1", [`%${marker}%`]);
  await pool.query("delete from audit_log where changed_by_user_id=$1", [userId]);
  await pool.query("delete from users where id=$1", [userId]);
  invalidateCache("name_dictionary");
});

for (const prefix of ["/api/name-dictionary", "/api/settings/name-dictionary"]) {
  test(`${prefix}: equivalent read, mutation, re-auth and create-only registration permissions`, async () => {
    assert.equal((await request(prefix)).status, 401);
    assert.equal((await request(prefix, "GET", token("receptionist"))).status, 200);
    const mapping = { arabicText: `قاموس${marker}${prefix.includes("settings") ? "اعداد" : "مباشر"}`, englishText: "New" };
    for (const [path, method, body] of [["", "POST", mapping], ["/1", "PUT", mapping], ["/1", "DELETE", undefined], ["/import", "POST", { entries: [mapping] }], ["/apply-to-patients", "POST", {}], ["/unresolved-patients", "GET", undefined]] as const) {
      assert.equal((await request(prefix + path, method, token("receptionist"), body)).status, 403);
      assert.equal((await request(prefix + path, method, token("supervisor"), body)).status, 403);
    }
    const added = await request(prefix + "/missing", "POST", token("receptionist"), mapping);
    assert.equal(added.status, 201);
    const id = Number((await added.json()).entry.id);
    assert.equal((await request(prefix + "/missing", "POST", token("receptionist"), { ...mapping, englishText: "Overwrite" })).status, 409);
    for (const role of ["supervisor", "super_admin"] as const) {
      assert.equal((await request(prefix + `/${id}`, "PUT", token(role, true), { ...mapping, englishText: role, isActive: false })).status, 200);
      const staffEntries = (await (await request(prefix + "?includeInactive=true", "GET", token("receptionist"))).json()).entries;
      assert.equal(staffEntries.some((row: { id: unknown }) => Number(row.id) === id), false);
      const adminEntries = (await (await request(prefix + "?includeInactive=true", "GET", token(role, true))).json()).entries;
      assert.equal(adminEntries.some((row: { id: unknown }) => Number(row.id) === id), true);
    }
    assert.equal((await request(prefix + "/import", "POST", token("supervisor", true), { entries: [{ ...mapping, englishText: "Imported" }] })).status, 201);
    assert.equal((await request(prefix + "/unresolved-patients", "GET", token("supervisor", true))).status, 200);
    assert.equal((await request(prefix + `/${id}`, "DELETE", token("supervisor", true))).status, 200);
  });
}
