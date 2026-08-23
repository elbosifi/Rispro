import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "users-routes-test-secret";

async function startServer() {
  const [{ usersRouter }, { errorHandler }] = await Promise.all([
    import("./users.js"),
    import("../middleware/error-handler.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/users", usersRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("users identity, active-state, and temporary-password routes preserve middleware and service wiring", async () => {
  const [{ pool }, { env }] = await Promise.all([
    import("../db/pool.js"),
    import("../config/env.js"),
  ]);
  try {
    await pool.query("select 1 from users limit 1");
  } catch {
    return;
  }

  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const createdIds: number[] = [];
  const insertUser = async (username: string, role: "supervisor" | "receptionist" | "super_admin", isActive: boolean) => {
    const result = await pool.query<{ id: number }>(
      `insert into users (username, full_name, password_hash, role, is_active)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [username, `Route ${username}`, "unused-password-hash", role, isActive],
    );
    createdIds.push(result.rows[0]!.id);
    return result.rows[0]!.id;
  };

  const actorId = await insertUser(`users_route_actor_${suffix}`, "supervisor", true);
  const targetId = await insertUser(`users_route_target_${suffix}`, "receptionist", false);
  const duplicateId = await insertUser(`users_route_duplicate_${suffix}`, "receptionist", true);
  const superAdminId = await insertUser(`users_route_super_admin_${suffix}`, "super_admin", true);
  const authToken = jwt.sign({ sub: actorId, role: "supervisor" }, env.jwtSecret);
  const reauthToken = jwt.sign({ sub: actorId, role: "supervisor", purpose: "supervisor-reauth" }, env.jwtSecret);
  const cookie = `${env.cookieName}=${authToken}; ${env.reauthCookieName}=${reauthToken}`;
  const server = await startServer();
  const request = async (path: string, method: "PUT" | "POST", body: unknown) => {
    const response = await fetch(`${server.baseUrl}/api/users${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() as { user?: { id: number; username: string; full_name: string; role: string; is_active: boolean; must_change_password: boolean; can_request_scheduling_override: boolean }; message?: string; error?: { message: string } } };
  };

  try {
    const identity = await request(`/${targetId}/identity`, "PUT", {
      username: `  IDENTITY_TARGET_${suffix}  `,
      fullName: "  Identity Target  ",
      role: "super_admin",
    });
    assert.equal(identity.status, 200);
    assert.equal(identity.data.user?.username, `identity_target_${suffix}`);
    assert.equal(identity.data.user?.full_name, "Identity Target");
    assert.equal(identity.data.user?.role, "receptionist");
    assert.equal(identity.data.user?.is_active, false);
    assert.equal(identity.data.user?.must_change_password, false);
    assert.equal(identity.data.user?.can_request_scheduling_override, false);
    const identityAudit = await pool.query<{ changed_by_user_id: number }>(
      `select changed_by_user_id
       from audit_log
       where entity_type = 'user' and entity_id = $1 and action_type = 'update_identity'
       order by id desc
       limit 1`,
      [targetId],
    );
    assert.equal(identityAudit.rows[0]?.changed_by_user_id, actorId);

    const emptyUsername = await request(`/${targetId}/identity`, "PUT", { username: "   ", fullName: "Identity Target" });
    assert.equal(emptyUsername.status, 400);
    const emptyFullName = await request(`/${targetId}/identity`, "PUT", { username: "identity-target", fullName: "   " });
    assert.equal(emptyFullName.status, 400);
    const duplicateUsername = await request(`/${targetId}/identity`, "PUT", { username: `users_route_duplicate_${suffix}`, fullName: "Identity Target" });
    assert.equal(duplicateUsername.status, 409);
    assert.match(duplicateUsername.data.error?.message ?? "", /already exists/);
    const protectedIdentity = await request(`/${superAdminId}/identity`, "PUT", { username: `protected_${suffix}`, fullName: "Protected Admin" });
    assert.equal(protectedIdentity.status, 403);
    assert.match(protectedIdentity.data.error?.message ?? "", /Only super_admin/);

    const activate = await request(`/${targetId}/active`, "PUT", { isActive: true });
    assert.equal(activate.status, 200);
    assert.equal(activate.data.user?.id, targetId);
    assert.equal(activate.data.user?.is_active, true);
    const activationAudit = await pool.query<{ changed_by_user_id: number }>(
      `select changed_by_user_id
       from audit_log
       where entity_type = 'user' and entity_id = $1 and action_type = 'activate'
       order by id desc
       limit 1`,
      [targetId],
    );
    assert.equal(activationAudit.rows[0]?.changed_by_user_id, actorId);

    const deactivate = await request(`/${targetId}/active`, "PUT", { isActive: false });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.data.user?.is_active, false);

    const missingActive = await request(`/${targetId}/active`, "PUT", {});
    assert.equal(missingActive.status, 400);
    assert.match(missingActive.data.message ?? "", /isActive must be a boolean/);

    const invalidActive = await request(`/${targetId}/active`, "PUT", { isActive: "false" });
    assert.equal(invalidActive.status, 400);
    assert.match(invalidActive.data.message ?? "", /isActive must be a boolean/);

    const temporaryPassword = await request(`/${targetId}/temporary-password`, "POST", { password: "TemporaryPassword123!" });
    assert.equal(temporaryPassword.status, 200);
    assert.equal(temporaryPassword.data.user?.id, targetId);
    assert.equal(temporaryPassword.data.user?.must_change_password, true);

    const missingPassword = await request(`/${targetId}/temporary-password`, "POST", {});
    assert.equal(missingPassword.status, 400);
  } finally {
    await server.close();
    await pool.query(
      "delete from audit_log where entity_type = 'user' and (entity_id = any($1::int[]) or changed_by_user_id = any($1::int[]))",
      [createdIds],
    );
    await pool.query("delete from users where id = any($1::int[])", [createdIds]);
  }
});
