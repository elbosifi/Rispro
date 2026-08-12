import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

function authCookie(cookieName: string, userId: number, role: string, username: string): string {
  return `${cookieName}=${jwt.sign({ sub: userId, role, username, fullName: `Orthanc ${role}` }, process.env.JWT_SECRET as string, { expiresIn: "1h" })}`;
}

test("Authoritative Orthanc Operations enforces the role matrix over HTTP", async () => {
  const [{ pool }, { createApp }, { env }] = await Promise.all([import("../db/pool.js"), import("../app.js"), import("../config/env.js")]);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const usernames: string[] = [];
  const originalAuthoritative = await pool.query("select category, setting_key, setting_value, updated_by_user_id from system_settings where category='authoritative_orthanc'");
  const originalVisibility = await pool.query("select setting_value, updated_by_user_id from system_settings where category='users_and_roles' and setting_key='page_visibility_by_role'");
  const createUser = async (role: string) => {
    const username = `orth_ops_${role}_${suffix}`;
    usernames.push(username);
    const { rows } = await pool.query<{ id: string }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,$3,$4,true) returning id::text id", [username, `Orthanc ${role}`, "$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS", role]);
    const id = Number(rows[0]!.id);
    return authCookie(env.cookieName, id, role, username);
  };
  const [receptionist, doctor, modalityStaff, supervisor, superAdmin] = await Promise.all(["receptionist", "doctor", "modality_staff", "supervisor", "super_admin"].map(createUser));
  await pool.query("delete from system_settings where category='authoritative_orthanc'");
  await pool.query(`insert into system_settings(category,setting_key,setting_value) values
    ('authoritative_orthanc','enabled','{"value":"disabled"}'::jsonb),
    ('authoritative_orthanc','auto_export_clinical_documents','{"value":"enabled"}'::jsonb),
    ('authoritative_orthanc','auto_route_enabled','{"value":"disabled"}'::jsonb),
    ('authoritative_orthanc','auto_route_destination_keys','{"value":"[]"}'::jsonb),
    ('authoritative_orthanc','base_url','{"value":""}'::jsonb),
    ('authoritative_orthanc','username','{"value":""}'::jsonb),
    ('authoritative_orthanc','password','{"value":""}'::jsonb),
    ('authoritative_orthanc','timeout_seconds','{"value":"5"}'::jsonb),
    ('authoritative_orthanc','verify_tls','{"value":"true"}'::jsonb),
    ('authoritative_orthanc','display_name','{"value":""}'::jsonb)`);
  const visibility = { "authoritative.orthanc": ["modality_staff", "supervisor", "super_admin"], settings: ["super_admin"] };
  await pool.query("insert into system_settings(category,setting_key,setting_value) values('users_and_roles','page_visibility_by_role',$1::jsonb) on conflict(category,setting_key) do update set setting_value=excluded.setting_value", [JSON.stringify({ value: visibility })]);

  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const request = async (path: string, cookie?: string, method = "GET") => fetch(`http://127.0.0.1:${address.port}/api/integrations/authoritative-orthanc${path}`, { method, headers: cookie ? { Cookie: cookie } : undefined });
  try {
    assert.equal((await request("/operations/summary")).status, 401);
    assert.equal((await request("/operations/summary", receptionist)).status, 403);
    assert.equal((await request("/operations/summary", doctor)).status, 403);
    assert.equal((await request("/operations/summary", modalityStaff)).status, 200);
    assert.equal((await request("/operations/routes/test-all", modalityStaff, "POST")).status, 403);
    assert.equal((await request("/operations/routes/test-all", supervisor, "POST")).status, 409);
    assert.equal((await request("/operations/routes/synchronize", supervisor, "POST")).status, 403);
    const synchronized = await request("/operations/routes/synchronize", superAdmin, "POST");
    assert.equal(synchronized.status, 200);
    assert.deepEqual((await synchronized.json()).summary, { created: 0, updated: 0, unchanged: 0, removed: 0, warnings: [] });
    assert.equal((await request("/document-exports/reconcile", supervisor, "POST")).status, 403);
    assert.equal((await request("/document-exports/reconcile", superAdmin, "POST")).status, 202);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query("delete from system_settings where category='authoritative_orthanc'");
    for (const row of originalAuthoritative.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3,$4)", [row.category, row.setting_key, row.setting_value, row.updated_by_user_id]);
    await pool.query("delete from system_settings where category='users_and_roles' and setting_key='page_visibility_by_role'");
    if (originalVisibility.rows[0]) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values('users_and_roles','page_visibility_by_role',$1,$2)", [originalVisibility.rows[0].setting_value, originalVisibility.rows[0].updated_by_user_id]);
    await pool.query("delete from audit_log where changed_by_user_id in (select id from users where username=any($1::text[]))", [usernames]);
    await pool.query("delete from users where username=any($1::text[])", [usernames]);
  }
});
