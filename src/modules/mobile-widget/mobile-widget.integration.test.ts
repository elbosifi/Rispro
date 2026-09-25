import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { mobileWidgetRouter, mobileWidgetAdminRouter } from "./mobile-widget-routes.js";
import { getOperationsSummary, OPERATIONS_SUMMARY_SQL } from "./operations-summary-service.js";
import { hashMobileToken } from "./mobile-token-service.js";
import { seedTestData, cleanupTestData, createTestAuthCookie, createTestSupervisorReauthCookie, type TestData } from "../appointments-v2/tests/integration/helpers.js";

const prefix = `MW${randomUUID().replaceAll("-", "").slice(0, 8)}`;
let data: TestData;
let other: TestData;
let server: Server;
let base: string;
let cookie: string;
let session: string;
const expiry = () => new Date(Date.now() + 86400_000).toISOString();
async function request(path: string, options: RequestInit = {}) { return fetch(`${base}${path}`, options); }
async function manage(path: string, body: unknown = {}, auth = cookie) {
  return request(`/api/settings/mobile-widget${path}`, { method: "POST", headers: { Cookie: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
async function create() {
  const res = await manage("/tokens", { deviceName: "Synthetic iPhone", expiresAt: expiry() });
  assert.equal(res.status, 201); return res.json() as Promise<{ secret: string; token: { id: string } }>;
}
async function summary(secret?: string) { return request("/api/mobile/operations-summary", { headers: secret ? { Authorization: `Bearer ${secret}` } : {} }); }

before(async () => {
  data = await seedTestData("appointments_v2", prefix);
  other = await seedTestData("appointments_v2", `${prefix}B`);
  session = createTestAuthCookie(data.userId);
  cookie = `${session}; ${createTestSupervisorReauthCookie(data.userId)}`;
  const app = express(); app.use(express.json(), cookieParser());
  app.use("/api/mobile", mobileWidgetRouter); app.use("/api/settings/mobile-widget", mobileWidgetAdminRouter);
  app.get("/normal", requireAuth, (_req, res) => res.json({ ok: true })); app.use(errorHandler);
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object"); base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  if (data) await pool.query("delete from mobile_widget_tokens where created_by_user_id = any($1::bigint[])", [[data.userId, other?.userId].filter(Boolean)]);
  await cleanupTestData(prefix); await pool.end();
});

test("one-time secret, hash at rest, safe list/audit, isolated bearer auth and throttled last-used", async () => {
  const { secret, token } = await create();
  assert.match(secret, /^rwm_[\w-]{43}$/);
  const stored = (await pool.query("select * from mobile_widget_tokens where id=$1", [token.id])).rows[0];
  assert.equal(stored.token_hash, hashMobileToken(secret)); assert.ok(!JSON.stringify(stored).includes(secret));
  const listed = await request("/api/settings/mobile-widget/tokens", { headers: { Cookie: session } });
  assert.equal(listed.status, 200); const list = await listed.text();
  assert.ok(!list.includes(secret)); assert.ok(!list.includes(stored.token_hash)); assert.ok(!list.includes("token_hash"));
  const result = await summary(secret); assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store, private"); assert.match(result.headers.get("content-type")!, /application\/json/);
  assert.equal(result.headers.get("set-cookie"), null);
  const used = (await pool.query("select last_used_at from mobile_widget_tokens where id=$1", [token.id])).rows[0].last_used_at;
  assert.ok(used); await summary(secret);
  assert.deepEqual((await pool.query("select last_used_at from mobile_widget_tokens where id=$1", [token.id])).rows[0].last_used_at, used);
  assert.equal((await request("/normal", { headers: { Authorization: `Bearer ${secret}` } })).status, 401);
  assert.equal((await request(`/api/mobile/operations-summary?token=${secret}`)).status, 401);
  const audit = (await pool.query("select * from audit_log where entity_type='mobile_widget_token' and entity_id=$1", [token.id])).rows;
  assert.equal(audit.length, 1); assert.equal(audit[0].action_type, "security_mobile_widget_created");
  assert.ok(!JSON.stringify(audit).includes(secret)); assert.ok(!JSON.stringify(audit).includes(stored.token_hash));
});

test("missing, malformed and unknown credentials fail uniformly", async () => {
  for (const secret of [undefined, "bad", `rwm_${"x".repeat(43)}`]) assert.equal((await summary(secret)).status, 401);
});

test("expiry, scope, revocation, disabled and ineligible owner are enforced", async () => {
  const { secret, token } = await create();
  await pool.query("update mobile_widget_tokens set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=$1", [token.id]);
  assert.equal((await summary(secret)).status, 401);
  await pool.query("update mobile_widget_tokens set expires_at=now()+interval '1 day', scope='unsupported' where id=$1", [token.id]);
  assert.equal((await summary(secret)).status, 403);
  await pool.query("update mobile_widget_tokens set scope='mobile.operations-summary:read' where id=$1", [token.id]);
  for (const change of ["is_active=false", "role='receptionist'", "must_change_password=true"]) {
    await pool.query(`update users set ${change} where id=$1`, [data.userId]);
    assert.equal((await summary(secret)).status, 401);
    await pool.query("update users set is_active=true,role='supervisor',must_change_password=false where id=$1", [data.userId]);
  }
  assert.equal((await manage(`/tokens/${token.id}/revoke`)).status, 200);
  assert.equal((await summary(secret)).status, 401);
});

test("rotation atomically invalidates old credential and returns replacement once", async () => {
  const old = await create();
  const response = await manage(`/tokens/${old.token.id}/rotate`, { expiresAt: expiry() }); assert.equal(response.status, 200);
  const replacement = await response.json(); assert.notEqual(replacement.secret, old.secret);
  assert.equal((await summary(old.secret)).status, 401); assert.equal((await summary(replacement.secret)).status, 200);
  assert.equal((await manage(`/tokens/${old.token.id}/rotate`, { expiresAt: expiry() })).status, 409);
  const actions = (await pool.query("select action_type from audit_log where entity_type='mobile_widget_token' and entity_id=$1", [old.token.id])).rows;
  assert.ok(actions.some(row => row.action_type === "security_mobile_widget_rotated"));
});

test("management requires session, supervisor role, current eligibility and recent reauth for mutations", async () => {
  assert.equal((await manage("/tokens", {}, "")).status, 401);
  assert.equal((await manage("/tokens", {}, createTestAuthCookie(data.userId, "receptionist"))).status, 403);
  for (const path of ["/tokens", "/tokens/1/rotate", "/tokens/1/revoke"]) assert.equal((await manage(path, {}, session)).status, 403);
  const adminCookie = `${createTestAuthCookie(other.userId, "super_admin")}; ${createTestSupervisorReauthCookie(other.userId, "super_admin")}`;
  await pool.query("update users set role='super_admin' where id=$1", [other.userId]);
  assert.equal((await manage("/tokens", { deviceName: "Admin iPhone", expiresAt: expiry() }, adminCookie)).status, 201);
  assert.equal((await manage("/tokens", { deviceName: "", expiresAt: expiry() })).status, 400);
  assert.equal((await manage("/tokens", { deviceName: "phone", expiresAt: "invalid" })).status, 400);
});

test("Tripoli date, all statuses, inactive modality, waiting boundaries and privacy/read-only contract", async () => {
  const now = new Date("2081-01-01T22:30:00Z");
  const statuses = ["scheduled", "arrived", "waiting", "in-progress", "completed", "no-show", "cancelled", "discontinued", "voided"];
  const phi = "PHI_TEST_PATIENT_NAME_123";
  // PHI remains in patient/booking fields, never in modality labels or summary inputs.
  await pool.query("update patients set address=$2, phone_2='0919999888' where id=$1", [data.patientId, phi]);
  await pool.query("update modalities set is_active=false where id=$1", [other.modalityId]);
  for (const status of statuses) await pool.query(`insert into appointments_v2.bookings
    (patient_id,modality_id,booking_date,case_category,status,policy_version_id,notes,is_walk_in,waiting_started_at)
    values ($1,$2,'2081-01-02','non_oncology',$3,$4,$5,true,$6)`,
  [data.patientId, data.modalityId, status, data.policyVersionId, phi, status === "waiting" ? new Date(now.getTime()-61*60000) : null]);
  for (const minutes of [30, 60, null, -5]) await pool.query(`insert into appointments_v2.bookings
    (patient_id,modality_id,booking_date,case_category,status,policy_version_id,waiting_started_at,arrived_at)
    values ($1,$2,'2081-01-02','non_oncology','waiting',$3,$4,$5)`,
  [data.patientId, other.modalityId, data.policyVersionId, minutes === null ? null : new Date(now.getTime()-minutes*60000), new Date(now.getTime()-120*60000)]);
  await pool.query(`insert into appointments_v2.bookings (patient_id,modality_id,booking_date,case_category,status,policy_version_id)
    values ($1,$2,'2081-01-01','non_oncology','scheduled',$3)`, [data.patientId,data.modalityId,data.policyVersionId]);
  const beforeRows = (await pool.query("select * from appointments_v2.bookings where patient_id=$1 order by id", [data.patientId])).rows;
  const auditBefore = (await pool.query("select count(*) from audit_log")).rows[0].count;
  const value = await getOperationsSummary(now);
  assert.equal(value.date, "2081-01-02"); assert.equal(value.timezone, "Africa/Tripoli");
  assert.deepEqual(value.totals, { totalAppointments:13,scheduled:1,arrived:1,waiting:5,inProgress:1,inQueue:7,completed:1,noShow:1,cancelled:1,discontinued:1,voided:1,walkIn:9 });
  assert.deepEqual(value.waiting, { count:5,oldestWaitingMinutes:61,over30Minutes:2,over60Minutes:1,unknownDurationCount:1 });
  assert.equal(value.modalities.length, 2); assert.equal(value.modalities.find(m=>m.modalityId===other.modalityId)?.waiting,4);
  const deny = /^(patient.*|national.?id|mrn|phone.*|email|accession.*|appointment.?id|booking.?id|studyinstanceuid|notes|dob|address|report.*|referring.*|exam.*|arrivedAt|waitingStartedAt)$/i;
  function inspect(node: unknown) { if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) { assert.ok(!deny.test(key),key); inspect(child); } }
  inspect(value); for (const sentinel of [phi,"0919999888"]) assert.ok(!JSON.stringify(value).includes(sentinel));
  assert.deepEqual((await pool.query("select * from appointments_v2.bookings where patient_id=$1 order by id", [data.patientId])).rows,beforeRows);
  assert.equal((await pool.query("select count(*) from audit_log")).rows[0].count,auditBefore);
  const empty = await getOperationsSummary(new Date("2081-01-05T00:00:00Z")); assert.equal(empty.totals.totalAppointments,0); assert.equal(empty.waiting.oldestWaitingMinutes,null);
  const plan = await pool.query(`explain (format json) ${OPERATIONS_SUMMARY_SQL}`, [value.date,now.toISOString()]);
  assert.ok(plan.rows.length);
});
