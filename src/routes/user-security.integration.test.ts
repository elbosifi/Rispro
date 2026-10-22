import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import http from "node:http";
import jwt from "jsonwebtoken";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "user-security-test-secret";

test("user security controls revoke sessions, enforce forced password change, record login, and expose scoped activity", async () => {
  const [
    { pool },
    { env },
    { authRouter },
    { usersRouter },
    { blockForcedPasswordChange, requireAuth },
    { errorHandler },
    { logSecurityAuditEntry }
  ] = await Promise.all([
    import("../db/pool.js"),
    import("../config/env.js"),
    import("./auth.js"),
    import("./users.js"),
    import("../middleware/auth.js"),
    import("../middleware/error-handler.js"),
    import("../services/audit-service.js")
  ]);

  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const actorPassword = "SecurityActorPass123!";
  const targetPassword = "SecurityTargetPass123!";
  const userIds: number[] = [];
  const previousAuditSetting = await pool.query<{ setting_value: unknown; updated_by_user_id: number | null }>(
    `select setting_value, updated_by_user_id from system_settings
      where category = 'audit_and_logging' and setting_key = 'audit_trail'`
  );
  const serverApp = express();
  serverApp.use(express.json());
  serverApp.use(cookieParser());
  serverApp.use("/api/auth", authRouter);
  serverApp.use("/api", blockForcedPasswordChange);
  serverApp.get("/api/protected", requireAuth, (req, res) => res.json({ role: req.user!.role, mustChangePassword: req.user!.mustChangePassword }));
  serverApp.use("/api/users", usersRouter);
  serverApp.use(errorHandler);
  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const insertUser = async (username: string, role: "supervisor" | "receptionist" | "super_admin", password: string) => {
    const result = await pool.query<{ id: number }>(
      `insert into users (username, full_name, password_hash, role, is_active)
       values ($1, $2, $3, $4, true) returning id`,
      [username, `Security ${username}`, await bcrypt.hash(password, 4), role]
    );
    userIds.push(result.rows[0]!.id);
    return result.rows[0]!.id;
  };
  const request = async (path: string, method: "GET" | "POST" | "PUT" | "DELETE", cookie?: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const raw = await response.text();
    return {
      status: response.status,
      data: raw ? JSON.parse(raw) as Record<string, any> : {},
      setCookies: (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
    };
  };
  const cookieFrom = (setCookies: string[], name: string) => setCookies.map((value) => value.split(";", 1)[0]!).find((value) => value.startsWith(`${name}=`)) ?? "";

  try {
    const actorId = await insertUser(`security_actor_${suffix}`, "supervisor", actorPassword);
    const targetId = await insertUser(`security_target_${suffix}`, "receptionist", targetPassword);
    const superAdminId = await insertUser(`security_admin_${suffix}`, "super_admin", "SecurityAdminPass123!");
    const protectedSupervisorId = await insertUser(`security_protected_supervisor_${suffix}`, "supervisor", "ProtectedSupervisorPass123!");
    await pool.query("update users set must_change_password=true, last_login_at=now() where id=$1", [superAdminId]);
    await pool.query("update users set must_change_password=true, last_login_at=now() where id=$1", [protectedSupervisorId]);
    const actorSession = jwt.sign({ sub: actorId, role: "supervisor", authVersion: 0 }, env.jwtSecret);
    const actorReauth = jwt.sign({ sub: actorId, role: "supervisor", authVersion: 0, purpose: "supervisor-reauth" }, env.jwtSecret);
    const actorCookie = `${env.cookieName}=${actorSession}; ${env.reauthCookieName}=${actorReauth}`;

    await pool.query(
      `insert into system_settings (category, setting_key, setting_value)
       values ('audit_and_logging', 'audit_trail', '{"value":"disabled"}'::jsonb)
       on conflict (category, setting_key) do update set setting_value = excluded.setting_value`
    );
    const force = await request(`/api/users/${targetId}/force-password-change`, "POST", actorCookie);
    assert.equal(force.status, 200, JSON.stringify(force.data));
    assert.equal(force.data.user.must_change_password, true);
    assert.equal(Number((await pool.query<{ auth_version: number }>("select auth_version from users where id=$1", [targetId])).rows[0]?.auth_version), 1);
    const forceAudit = await pool.query<{ changed_by_user_id: number }>(
      `select changed_by_user_id from audit_log
        where entity_type='user' and entity_id=$1 and action_type='force_password_change'`,
      [targetId]
    );
    assert.equal(forceAudit.rows[0]?.changed_by_user_id, actorId, "security audit is retained even when ordinary audit collection is disabled");

    const login = await request("/api/auth/login", "POST", undefined, { username: `security_target_${suffix}`, password: targetPassword });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.ok(login.data.user.mustChangePassword);
    const targetCookie = cookieFrom(login.setCookies, env.cookieName);
    assert.ok(targetCookie);
    assert.ok((await pool.query<{ last_login_at: string | null }>("select last_login_at from users where id=$1", [targetId])).rows[0]?.last_login_at);

    const forcedApi = await request("/api/protected", "GET", targetCookie);
    assert.equal(forcedApi.status, 403);
    const changePassword = await request("/api/auth/change-password", "POST", targetCookie, {
      currentPassword: targetPassword,
      newPassword: "SecurityTargetPass456!"
    });
    assert.equal(changePassword.status, 200, JSON.stringify(changePassword.data));
    const replacementCookie = cookieFrom(changePassword.setCookies, env.cookieName);
    assert.ok(replacementCookie);
    assert.equal((await request("/api/protected", "GET", replacementCookie)).status, 200);
    assert.equal((await request("/api/protected", "GET", targetCookie)).status, 401, "self-service password change invalidates the prior session");

    const access = await request(`/api/users/${targetId}/effective-access`, "GET", actorCookie);
    assert.equal(access.status, 200, JSON.stringify(access.data));
    assert.equal(access.data.access.role, "receptionist");
    assert.equal(access.data.access.canRequestSchedulingOverride, false);
    assert.equal(access.data.access.navigationVisibility.source, "role_page_access");
    assert.match(access.data.access.navigationVisibility.note, /API authorization/);

    const forbiddenAccess = await request(`/api/users/${superAdminId}/effective-access`, "GET", actorCookie);
    const forbiddenActivity = await request(`/api/users/${superAdminId}/security-activity`, "GET", actorCookie);
    assert.equal(forbiddenAccess.status, 403);
    assert.equal(forbiddenActivity.status, 403);
    const listedUsers = await request("/api/users", "GET", actorCookie);
    assert.equal(listedUsers.status, 200, JSON.stringify(listedUsers.data));
    const listedSuperAdmin = listedUsers.data.users.find((user: { id: number }) => user.id === superAdminId);
    assert.equal(listedSuperAdmin.last_login_at, null);
    assert.equal(listedSuperAdmin.must_change_password, null);
    const listedSupervisor = listedUsers.data.users.find((user: { id: number }) => user.id === protectedSupervisorId);
    assert.equal(listedSupervisor.last_login_at, null);
    assert.equal(listedSupervisor.must_change_password, null);

    const protectedBefore = await pool.query<{ username: string; role: string; is_active: boolean; password_hash: string; must_change_password: boolean; auth_version: number }>(
      `select username, role, is_active, password_hash, must_change_password, auth_version from users where id=$1`,
      [protectedSupervisorId]
    );
    const protectedIdentity = await request(`/api/users/${protectedSupervisorId}/identity`, "PUT", actorCookie, {
      username: `security_attempt_${suffix}`, fullName: "Attempted Change"
    });
    const protectedRole = await request(`/api/users/${protectedSupervisorId}/role`, "PUT", actorCookie, { role: "doctor" });
    const protectedSchedulingPermission = await request(`/api/users/${protectedSupervisorId}/scheduling-override-permission`, "PUT", actorCookie, { canRequestSchedulingOverride: true });
    const protectedPassword = await request(`/api/users/${protectedSupervisorId}/password`, "PUT", actorCookie, { password: "DeniedDirectPassword123!" });
    const protectedTemporaryPassword = await request(`/api/users/${protectedSupervisorId}/temporary-password`, "POST", actorCookie, { password: "DeniedTemporaryPassword123!" });
    const protectedForce = await request(`/api/users/${protectedSupervisorId}/force-password-change`, "POST", actorCookie);
    const protectedRevoke = await request(`/api/users/${protectedSupervisorId}/revoke-sessions`, "POST", actorCookie);
    const protectedDeactivate = await request(`/api/users/${protectedSupervisorId}/active`, "PUT", actorCookie, { isActive: false });
    const protectedReactivate = await request(`/api/users/${protectedSupervisorId}/active`, "PUT", actorCookie, { isActive: true });
    const protectedDelete = await request(`/api/users/${protectedSupervisorId}`, "DELETE", actorCookie);
    const protectedAccess = await request(`/api/users/${protectedSupervisorId}/effective-access`, "GET", actorCookie);
    const protectedActivity = await request(`/api/users/${protectedSupervisorId}/security-activity`, "GET", actorCookie);
    for (const denied of [protectedIdentity, protectedRole, protectedSchedulingPermission, protectedPassword, protectedTemporaryPassword, protectedForce, protectedRevoke, protectedDeactivate, protectedReactivate, protectedDelete, protectedAccess, protectedActivity]) {
      assert.equal(denied.status, 403, JSON.stringify(denied.data));
      assert.doesNotMatch(JSON.stringify(denied.data), /security_protected_supervisor/);
    }
    const protectedAfter = await pool.query<{ username: string; role: string; is_active: boolean; password_hash: string; must_change_password: boolean; auth_version: number }>(
      `select username, role, is_active, password_hash, must_change_password, auth_version from users where id=$1`,
      [protectedSupervisorId]
    );
    assert.deepEqual(protectedAfter.rows[0], protectedBefore.rows[0], "denied administration leaves protected account state unchanged");

    await pool.query("update users set must_change_password=false where id=$1", [superAdminId]);
    const adminSession = jwt.sign({ sub: superAdminId, role: "super_admin", username: `security_admin_${suffix}`, authVersion: 0 }, env.jwtSecret);
    const adminReauth = jwt.sign({ sub: superAdminId, role: "super_admin", authVersion: 0, purpose: "supervisor-reauth" }, env.jwtSecret);
    const adminCookie = `${env.cookieName}=${adminSession}; ${env.reauthCookieName}=${adminReauth}`;
    const allowedProtectedIdentity = await request(`/api/users/${protectedSupervisorId}/identity`, "PUT", adminCookie, {
      username: `security_protected_updated_${suffix}`, fullName: "Admin Updated Supervisor"
    });
    assert.equal(allowedProtectedIdentity.status, 200, JSON.stringify(allowedProtectedIdentity.data));
    assert.equal(allowedProtectedIdentity.data.user.username, `security_protected_updated_${suffix}`);

    const actorLogin = await request("/api/auth/login", "POST", undefined, {
      username: `security_actor_${suffix}`, password: actorPassword
    });
    assert.equal(actorLogin.status, 200, JSON.stringify(actorLogin.data));
    const actorSessionCookie = cookieFrom(actorLogin.setCookies, env.cookieName);
    assert.ok(actorSessionCookie);
    const actorRename = await request(`/api/users/${actorId}/identity`, "PUT", adminCookie, {
      username: `security_actor_renamed_${suffix}`,
      fullName: "Renamed Security Actor",
      englishName: "Renamed Security Actor English"
    });
    assert.equal(actorRename.status, 200, JSON.stringify(actorRename.data));
    const renamedMe = await request("/api/auth/me", "GET", actorSessionCookie);
    assert.equal(renamedMe.status, 200, JSON.stringify(renamedMe.data));
    assert.equal(renamedMe.data.user.username, `security_actor_renamed_${suffix}`);
    assert.equal(renamedMe.data.user.fullName, "Renamed Security Actor");
    assert.equal(renamedMe.data.user.englishName, "Renamed Security Actor English");
    const reauthenticated = await request("/api/auth/re-auth", "POST", actorSessionCookie, { password: actorPassword });
    assert.equal(reauthenticated.status, 200, JSON.stringify(reauthenticated.data));
    assert.equal(reauthenticated.data.user.username, `security_actor_renamed_${suffix}`);
    const actorReauthCookie = cookieFrom(reauthenticated.setCookies, env.reauthCookieName);
    assert.ok(actorReauthCookie);
    const actorReauthenticatedCookie = `${actorSessionCookie}; ${actorReauthCookie}`;
    assert.equal((await request("/api/protected", "GET", actorSessionCookie)).status, 200, "identity changes do not revoke the existing session");

    await logSecurityAuditEntry({
      entityType: "user", entityId: targetId, actionType: "security_redaction_check",
      newValues: { password: "must-not-be-returned", accessToken: "must-not-be-returned" },
      changedByUserId: actorId
    });
    const activity = await request(`/api/users/${targetId}/security-activity`, "GET", actorReauthenticatedCookie);
    assert.equal(activity.status, 200, JSON.stringify(activity.data));
    assert.equal(activity.data.pagination.pageSize, 25);
    const forceEntry = activity.data.entries.find((entry: { actionType: string }) => entry.actionType === "force_password_change");
    assert.equal(forceEntry.changedByUserId, actorId, "activity preserves actor attribution");
    const redactedEntry = activity.data.entries.find((entry: { actionType: string }) => entry.actionType === "security_redaction_check");
    assert.equal(redactedEntry.newValues.password, "[REDACTED]");
    assert.equal(redactedEntry.newValues.accessToken, "[REDACTED]");
    const invalidPageSize = await request(`/api/users/${targetId}/security-activity?pageSize=101`, "GET", actorReauthenticatedCookie);
    assert.equal(invalidPageSize.status, 400);

    const revoke = await request(`/api/users/${targetId}/revoke-sessions`, "POST", actorReauthenticatedCookie);
    assert.equal(revoke.status, 200, JSON.stringify(revoke.data));
    assert.equal((await request("/api/protected", "GET", replacementCookie)).status, 401);

    const selfRevoke = await request(`/api/users/${actorId}/revoke-sessions`, "POST", actorReauthenticatedCookie);
    assert.equal(selfRevoke.status, 200, JSON.stringify(selfRevoke.data));
    assert.equal(selfRevoke.data.selfRevoked, true);
    assert.ok(selfRevoke.setCookies.some((value) => value.startsWith(`${env.cookieName}=`)));
    assert.equal((await request("/api/protected", "GET", actorSessionCookie)).status, 401);
  } finally {
    if (previousAuditSetting.rows[0]) {
      await pool.query(
        `update system_settings set setting_value=$1::jsonb, updated_by_user_id=$2
          where category='audit_and_logging' and setting_key='audit_trail'`,
        [JSON.stringify(previousAuditSetting.rows[0].setting_value), previousAuditSetting.rows[0].updated_by_user_id]
      );
    } else {
      await pool.query("delete from system_settings where category='audit_and_logging' and setting_key='audit_trail'");
    }
    if (userIds.length) {
      await pool.query("delete from audit_log where entity_id = any($1::bigint[]) or changed_by_user_id = any($1::bigint[])", [userIds]);
      await pool.query("delete from users where id = any($1::bigint[])", [userIds]);
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
