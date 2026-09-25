import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "teaching-routes-test-secret";

test("Teaching API mount, authentication, permission resolution, and minimal identity payload", async (t) => {
  const [{ createApp }, { pool }, { env }] = await Promise.all([
    import("../../../app.js"),
    import("../../../db/pool.js"),
    import("../../../config/env.js"),
  ]);

  try {
    await pool.query("select 1 from teaching.user_profiles limit 1");
  } catch {
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }

  const teachingIdentitySubject = `teaching-test-${randomUUID()}`;
  const unauthorizedSubject = `teaching-test-${randomUUID()}`;
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = async (pathname: string, role?: string, subject = teachingIdentitySubject, displayName = "Teaching Test Learner") => {
    const cookie = role
      ? `${env.cookieName}=${jwt.sign({ sub: subject, role, fullName: displayName }, env.jwtSecret)}`
      : "";
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: cookie ? { Cookie: cookie } : undefined,
    });
    return { status: response.status, data: await response.json() as Record<string, unknown> };
  };

  try {
    const health = await request("/api/teaching/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.data, { ok: true, module: "teaching" });

    const anonymousIdentity = await request("/api/teaching/me");
    assert.equal(anonymousIdentity.status, 401);

    const learner = await request("/api/teaching/me", "doctor");
    assert.equal(learner.status, 200);
    assert.deepEqual(Object.keys(learner.data).sort(), ["displayName", "identitySubject", "permissions"]);
    assert.equal(learner.data.identitySubject, teachingIdentitySubject);
    assert.equal(learner.data.displayName, "Teaching Test Learner");
    assert.deepEqual(learner.data.permissions, ["teaching.access", "teaching.learn"]);
    for (const forbiddenKey of ["patient", "patientId", "appointment", "appointmentId", "report", "studyInstanceUid", "role"]) {
      assert.equal(Object.hasOwn(learner.data, forbiddenKey), false);
    }

    const persisted = await pool.query<{ permission: string }>(
      `select permission from teaching.user_permissions
       where identity_issuer = 'rispro' and identity_subject = $1
       order by permission`,
      [teachingIdentitySubject],
    );
    assert.deepEqual(persisted.rows.map((row) => row.permission), ["teaching.access", "teaching.learn"]);

    const persistedIdentity = await request("/api/teaching/me", "receptionist", teachingIdentitySubject, "Updated Teaching Name");
    assert.equal(persistedIdentity.status, 200);
    assert.equal(persistedIdentity.data.displayName, "Updated Teaching Name");
    assert.deepEqual(persistedIdentity.data.permissions, ["teaching.access", "teaching.learn"]);

    const unauthorized = await request("/api/teaching/me", "receptionist", unauthorizedSubject);
    assert.equal(unauthorized.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query(
      "delete from teaching.user_profiles where identity_issuer = 'rispro' and identity_subject = any($1::text[])",
      [[teachingIdentitySubject, unauthorizedSubject]],
    );
  }
});
