import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.js";
import { canReachDatabase, createTestAuthCookie, fetchJson, isDatabaseAvailable } from "../appointments-v2/tests/integration/helpers.js";

const TEST_PREFIX = "DOCTOR_WORKLIST_EMAIL_";
const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;

interface TestUser {
  id: number;
  doctorId: number;
  cookie: string;
}

interface TestApp {
  baseUrl: string;
  close: () => Promise<void>;
}

describe("Doctor worklist link email", { skip: skipEnv }, () => {
  let app: TestApp;
  let manager: TestUser;
  let admin: TestUser;
  let doctor: TestUser;
  let worklistId = 0;
  let worklistToken = "";
  let doctorEmail = "";
  let originalEmailConfig: { enabled: boolean; smtp_password_secret: unknown };
  let originalPublicBaseUrl: string | undefined;
  let ready = false;

  async function createDoctor(label: string, role: "doctor" | "supervisor" | "super_admin", email: string | null): Promise<TestUser> {
    const suffix = randomUUID().replace(/-/g, "");
    const username = `${TEST_PREFIX}${label}_${suffix}`.toLowerCase();
    const user = await pool.query<{ id: string }>(
      `
        insert into users (username, email, full_name, password_hash, role, is_active)
        values ($1, $2, $3, 'unused-password-hash', $4, true)
        returning id::text as id
      `,
      [username, email, `${TEST_PREFIX}${label} Doctor`, role]
    );
    const userId = Number(user.rows[0]!.id);
    const profile = await pool.query<{ id: string }>(
      `
        insert into doctor_portal.doctor_profiles (
          user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise
        )
        values ($1, $2, 'consultant', true, true, true, $3)
        returning id::text as id
      `,
      [userId, `${TEST_PREFIX}${label} Doctor`, role !== "doctor"]
    );
    return { id: userId, doctorId: Number(profile.rows[0]!.id), cookie: createTestAuthCookie(userId, role) };
  }

  async function api<T = unknown>(cookie: string, path: string, options: { method?: string; body?: unknown } = {}) {
    return fetchJson<T>(app.baseUrl, path, { cookie, ...options });
  }

  async function outboxRows() {
    return pool.query<{
      id: string;
      event_type: string;
      recipient_user_id: string;
      recipient_email: string;
      status: string;
      related_entity_type: string;
      related_entity_id: string;
      idempotency_key: string;
      subject: string;
      text_body: string;
    }>(
      `
        select id::text, event_type, recipient_user_id::text, recipient_email, status,
               related_entity_type, related_entity_id, idempotency_key, subject, text_body
        from email_outbox
        where related_entity_type = 'reporting_board_saved_view' and related_entity_id = $1
        order by id
      `,
      [String(worklistId)]
    );
  }

  async function resetState() {
    if (!ready) return;
    await pool.query("delete from email_outbox where related_entity_type = 'reporting_board_saved_view' and related_entity_id = $1", [String(worklistId)]);
    await pool.query("delete from doctor_portal.doctor_module_audit_events where target_type = 'reporting_board_saved_view' and target_id = $1", [worklistId]);
    await pool.query("update users set email = $1, is_active = true where id = $2", [doctorEmail, doctor.id]);
    await pool.query("update doctor_portal.doctor_profiles set active = true where id = $1", [doctor.doctorId]);
    await pool.query(
      "update doctor_portal.reporting_board_saved_views set active = true, revoked_at = null, admin_disabled_at = null, expires_at = null where id = $1",
      [worklistId]
    );
    await pool.query("update email_smtp_configuration set enabled = true, smtp_password_secret = $1 where id = 1", [{}]);
    process.env.PUBLIC_APP_BASE_URL = "https://public.example.test/";
  }

  before(async () => {
    if (!await canReachDatabase()) return;
    originalPublicBaseUrl = process.env.PUBLIC_APP_BASE_URL;
    originalEmailConfig = (await pool.query<typeof originalEmailConfig>("select enabled, smtp_password_secret from email_smtp_configuration where id = 1")).rows[0]!;
    process.env.PUBLIC_APP_BASE_URL = "https://public.example.test/";
    await pool.query("update email_smtp_configuration set enabled = true, smtp_password_secret = $1 where id = 1", [{}]);

    const express = (await import("express")).default;
    const cookieParser = (await import("cookie-parser")).default;
    const http = await import("node:http");
    const { createDoctorPortalRouter } = await import("./index.js");
    const appInstance = express();
    appInstance.use(express.json({ limit: "10mb" }));
    appInstance.use(cookieParser());
    appInstance.use("/api/doctor", createDoctorPortalRouter());
    appInstance.use((err: Error, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
      res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: err.message });
    });
    const server = http.createServer(appInstance);
    app = await new Promise<TestApp>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 3000;
        resolve({ baseUrl: `http://localhost:${port}`, close: async () => { await new Promise<void>((done) => server.close(() => done())); } });
      });
    });

    doctorEmail = `doctor-${randomUUID().replace(/-/g, "")}@example.test`;
    manager = await createDoctor("Manager", "supervisor", `manager-${randomUUID().replace(/-/g, "")}@example.test`);
    admin = await createDoctor("Admin", "super_admin", `admin-${randomUUID().replace(/-/g, "")}@example.test`);
    doctor = await createDoctor("Target", "doctor", doctorEmail);
    const worklist = await pool.query<{ id: string; token: string }>(
      `
        insert into doctor_portal.reporting_board_saved_views (
          owner_user_id, owner_doctor_id, name, token, filters_json, notification_settings_json,
          active, link_kind, system_managed, target_doctor_id
        )
        values (null, null, $1, $2, '{}'::jsonb, '{}'::jsonb, true, 'doctor_worklist', true, $3)
        returning id::text as id, token
      `,
      [`${TEST_PREFIX}Target Worklist`, `current-${randomUUID()}`, doctor.doctorId]
    );
    worklistId = Number(worklist.rows[0]!.id);
    worklistToken = worklist.rows[0]!.token;
    ready = true;
  });

  afterEach(async () => {
    await resetState();
  });

  after(async () => {
    if (ready) {
      await resetState();
      await pool.query("delete from doctor_portal.reporting_board_saved_views where id = $1", [worklistId]);
      await pool.query("delete from doctor_portal.doctor_module_audit_events where actor_user_id = any($1::bigint[])", [[manager.id, admin.id, doctor.id]]);
      await pool.query("delete from doctor_portal.doctor_profiles where id = any($1::bigint[])", [[manager.doctorId, admin.doctorId, doctor.doctorId]]);
      await pool.query("delete from users where id = any($1::bigint[])", [[manager.id, admin.id, doctor.id]]);
    }
    if (originalEmailConfig) {
      await pool.query("update email_smtp_configuration set enabled = $1, smtp_password_secret = $2 where id = 1", [originalEmailConfig.enabled, originalEmailConfig.smtp_password_secret]);
    }
    if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_APP_BASE_URL;
    else process.env.PUBLIC_APP_BASE_URL = originalPublicBaseUrl;
    if (app) await app.close();
  });

  it("queues the canonical target doctor's email and returns only safe queue metadata", async () => {
    if (!ready) return;
    const response = await api<{ queued: true; outboxId: number; status: string; recipientEmail: string }>(
      manager.cookie,
      `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`,
      { method: "POST", body: { recipientEmail: "attacker@example.test", url: "https://attacker.example.test" } }
    );
    assert.equal(response.status, 202, JSON.stringify(response.data));
    assert.equal(response.data.queued, true);
    assert.equal(response.data.status, "pending");
    assert.equal(response.data.recipientEmail, doctorEmail);
    const responseText = JSON.stringify(response.data);
    assert.doesNotMatch(responseText, new RegExp(worklistToken));
    assert.doesNotMatch(responseText, /public\.example\.test|Hello/);

    const rows = await outboxRows();
    assert.equal(rows.rowCount, 1);
    const row = rows.rows[0]!;
    assert.equal(row.event_type, "doctor_worklist_link");
    assert.equal(Number(row.recipient_user_id), doctor.id);
    assert.equal(row.recipient_email, doctorEmail);
    assert.equal(row.related_entity_type, "reporting_board_saved_view");
    assert.equal(row.related_entity_id, String(worklistId));
    assert.match(row.text_body, new RegExp(`https://public\\.example\\.test/reporting/worklist/${worklistToken}`));
    assert.doesNotMatch(row.text_body, /patient|MRN|accession|case|modality|assignment|urgent|report status/i);
    assert.doesNotMatch(row.idempotency_key, new RegExp(worklistToken));

    const audit = await pool.query<{ event_type: string; metadata_json: unknown }>(
      `select event_type, metadata_json from doctor_portal.doctor_module_audit_events where target_type = 'reporting_board_saved_view' and target_id = $1 order by id desc limit 1`,
      [worklistId]
    );
    assert.equal(audit.rows[0]!.event_type, "doctor_worklist_link_email_queued");
    const auditText = JSON.stringify(audit.rows[0]!.metadata_json);
    assert.match(auditText, new RegExp(`"targetDoctorId":${doctor.doctorId}`));
    assert.match(auditText, new RegExp(`"recipientUserId":${doctor.id}`));
    assert.doesNotMatch(auditText, new RegExp(worklistToken));
    assert.doesNotMatch(auditText, /public\.example\.test/);
  });

  it("allows supervisor and super-admin managers but rejects ordinary doctors", async () => {
    if (!ready) return;
    const supervisorResponse = await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(supervisorResponse.status, 202);
    await pool.query("delete from email_outbox where related_entity_type = 'reporting_board_saved_view' and related_entity_id = $1", [String(worklistId)]);
    const adminResponse = await api(admin.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(adminResponse.status, 202);
    await pool.query("delete from email_outbox where related_entity_type = 'reporting_board_saved_view' and related_entity_id = $1", [String(worklistId)]);
    const doctorResponse = await api(doctor.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(doctorResponse.status, 403);
    assert.equal((await outboxRows()).rowCount, 0);
  });

  it("rejects missing email, inactive identities, inactive links, and invalid public URL without queueing", async () => {
    if (!ready) return;
    for (const invalidEmail of [null, "not-an-email"]) {
      await pool.query("update users set email = $1 where id = $2", [invalidEmail, doctor.id]);
      const missingEmail = await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
      assert.equal(missingEmail.status, 409);
      assert.match(JSON.stringify(missingEmail.data), /no valid email address/i);
      assert.equal((await outboxRows()).rowCount, 0);
    }

    await pool.query("update users set email = $1 where id = $2", [doctorEmail, doctor.id]);
    await pool.query("update doctor_portal.doctor_profiles set active = false where id = $1", [doctor.doctorId]);
    assert.equal((await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" })).status, 409);
    await pool.query("update doctor_portal.doctor_profiles set active = true where id = $1", [doctor.doctorId]);
    await pool.query("update users set is_active = false where id = $1", [doctor.id]);
    assert.equal((await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" })).status, 409);
    await pool.query("update users set is_active = true where id = $1", [doctor.id]);
    await pool.query("update doctor_portal.reporting_board_saved_views set active = false where id = $1", [worklistId]);
    assert.equal((await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" })).status, 409);
    await pool.query("update doctor_portal.reporting_board_saved_views set active = true, expires_at = now() - interval '1 minute' where id = $1", [worklistId]);
    assert.equal((await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" })).status, 409);
    await pool.query("update doctor_portal.reporting_board_saved_views set expires_at = null where id = $1", [worklistId]);

    delete process.env.PUBLIC_APP_BASE_URL;
    const missingUrl = await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(missingUrl.status, 409);
    assert.match(JSON.stringify(missingUrl.data), /public application URL is not configured/i);
    assert.equal((await outboxRows()).rowCount, 0);
  });

  it("requires enabled outbound email and configured SMTP credentials", async () => {
    if (!ready) return;
    await pool.query("update email_smtp_configuration set enabled = false where id = 1");
    let response = await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(response.status, 409);
    assert.match(JSON.stringify(response.data), /Outbound email is disabled/);
    assert.equal((await outboxRows()).rowCount, 0);

    await pool.query("update email_smtp_configuration set enabled = true, smtp_password_secret = null where id = 1");
    response = await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(response.status, 409);
    assert.match(JSON.stringify(response.data), /SMTP credentials are not configured/);
    assert.equal((await outboxRows()).rowCount, 0);
  });

  it("blocks active duplicate queue states and permits accepted or failed resends", async () => {
    if (!ready) return;
    for (const status of ["pending", "processing", "retry_scheduled"]) {
      await pool.query(
        `insert into email_outbox (event_type, recipient_user_id, recipient_email, subject, text_body, idempotency_key, related_entity_type, related_entity_id, created_by_user_id, status)
         values ('doctor_worklist_link', $1, $2, 'Existing', 'Existing', $3, 'reporting_board_saved_view', $4, $5, $6)`,
        [doctor.id, doctorEmail, `existing:${status}:${randomUUID()}`, String(worklistId), manager.id, status]
      );
      const response = await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
      assert.equal(response.status, 409);
      assert.match(JSON.stringify(response.data), /already queued for this doctor/);
      await pool.query("delete from email_outbox where related_entity_type = 'reporting_board_saved_view' and related_entity_id = $1", [String(worklistId)]);
    }

    const first = await api<{ outboxId: number }>(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(first.status, 202);
    await pool.query("update email_outbox set status = 'accepted', accepted_at = now() where id = $1", [first.data.outboxId]);
    const acceptedResend = await api<{ outboxId: number }>(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(acceptedResend.status, 202);
    await pool.query("update email_outbox set status = 'failed' where id = $1", [acceptedResend.data.outboxId]);
    const failedResend = await api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" });
    assert.equal(failedResend.status, 202);
    assert.equal((await outboxRows()).rowCount, 3);
  });

  it("serializes concurrent manager clicks to one active queue entry", async () => {
    if (!ready) return;
    const responses = await Promise.all([
      api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" }),
      api(manager.cookie, `/api/doctor/reporting-board/doctor-worklists/${worklistId}/email-link`, { method: "POST" }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [202, 409]);
    assert.equal((await outboxRows()).rowCount, 1);
  });
});
