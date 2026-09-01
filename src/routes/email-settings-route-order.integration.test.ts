import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../app.js";
import { pool } from "../db/pool.js";
import { canReachDatabase, createTestAuthCookie, createTestSupervisorReauthCookie, fetchJson, isDatabaseAvailable, seedTestData, setupTestDatabase, type TestData } from "../modules/appointments-v2/tests/integration/helpers.js";

const TEST_PREFIX = "EMAIL_SETTINGS_ROUTE_ORDER_";
const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;

async function createApplicationServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
  return { baseUrl: `http://localhost:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

describe("Email settings route precedence", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createApplicationServer>>;
  let originalEmailConfiguration: { enabled: boolean; sender_name: string; sender_email: string; reply_to_email: string | null; smtp_host: string; smtp_port: number; security_mode: "tls" | "starttls"; smtp_username: string; smtp_password_secret: unknown; connection_timeout_seconds: number };

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    originalEmailConfiguration = (await pool.query<typeof originalEmailConfiguration>("select enabled, sender_name, sender_email, reply_to_email, smtp_host, smtp_port, security_mode, smtp_username, smtp_password_secret, connection_timeout_seconds from email_smtp_configuration where id = 1")).rows[0]!;
    app = await createApplicationServer();
  });

  after(async () => {
    if (!testData) return;
    await pool.query("update email_smtp_configuration set enabled = $1, sender_name = $2, sender_email = $3, reply_to_email = $4, smtp_host = $5, smtp_port = $6, security_mode = $7, smtp_username = $8, smtp_password_secret = $9, connection_timeout_seconds = $10 where id = 1", [originalEmailConfiguration.enabled, originalEmailConfiguration.sender_name, originalEmailConfiguration.sender_email, originalEmailConfiguration.reply_to_email, originalEmailConfiguration.smtp_host, originalEmailConfiguration.smtp_port, originalEmailConfiguration.security_mode, originalEmailConfiguration.smtp_username, originalEmailConfiguration.smtp_password_secret, originalEmailConfiguration.connection_timeout_seconds]);
    await app.close();
    await testDb.cleanup();
  });

  it("routes email settings before the generic category route while preserving authorization and re-auth", async () => {
    if (!testData) return;
    const supervisorCookie = createTestAuthCookie(testData.userId, "supervisor");
    const superAdminCookie = createTestAuthCookie(testData.userId, "super_admin");
    const reauthCookie = createTestSupervisorReauthCookie(testData.userId, "super_admin");
    const emailSettings = { enabled: false, senderName: "RISpro", senderEmail: "noreply@example.test", replyToEmail: "", smtpHost: "smtp.example.test", smtpPort: 465, securityMode: "tls" as const, smtpUsername: "rispro", connectionTimeoutSeconds: 10 };

    assert.equal((await fetchJson(app.baseUrl, "/api/settings/email-notifications", { cookie: supervisorCookie })).status, 403);
    const getEmailSettings = await fetchJson<{ settings: { enabled: boolean } }>(app.baseUrl, "/api/settings/email-notifications", { cookie: superAdminCookie });
    assert.equal(getEmailSettings.status, 200);
    assert.equal(typeof getEmailSettings.data.settings.enabled, "boolean");

    const withoutReauth = await fetchJson<{ error?: { message?: string } }>(app.baseUrl, "/api/settings/email-notifications", { method: "PUT", cookie: superAdminCookie, body: emailSettings });
    assert.equal(withoutReauth.status, 403);
    assert.equal(withoutReauth.data.error?.message, "Recent supervisor re-authentication is required.");

    const putEmailSettings = await fetchJson<{ settings: { enabled: boolean } }>(app.baseUrl, "/api/settings/email-notifications", { method: "PUT", cookie: `${superAdminCookie}; ${reauthCookie}`, body: emailSettings });
    assert.equal(putEmailSettings.status, 200);
    assert.equal(putEmailSettings.data.settings.enabled, false);
    assert.doesNotMatch(JSON.stringify(putEmailSettings.data), /entries must be a non-empty array/);

    const genericSettings = await fetchJson<{ settings: unknown[] }>(app.baseUrl, "/api/settings/normal-category", { cookie: `${superAdminCookie}; ${reauthCookie}` });
    assert.equal(genericSettings.status, 200);
    assert.ok(Array.isArray(genericSettings.data.settings));
  });
});
