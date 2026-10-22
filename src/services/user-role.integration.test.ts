import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Role } from "../types/domain.js";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";

async function createUser(pool: import("pg").Pool, username: string, role: Role, active = true) {
  const result = await pool.query<{ id: number }>(
    `insert into users (username, full_name, password_hash, role, is_active)
     values ($1, $2, 'unused-test-hash', $3, $4) returning id`,
    [username, username, role, active],
  );
  return result.rows[0]!.id;
}

async function cleanupUsers(pool: import("pg").Pool, ids: number[]) {
  if (ids.length === 0) return;
  await pool.query(
    `delete from doctor_portal.reporting_board_saved_views
      where target_doctor_id in (select id from doctor_portal.doctor_profiles where user_id = any($1::bigint[]))
        and link_kind = 'doctor_worklist' and system_managed = true`,
    [ids],
  ).catch(() => undefined);
  await pool.query("delete from doctor_portal.doctor_profiles where user_id = any($1::bigint[])", [ids]).catch(() => undefined);
  await pool.query("delete from audit_log where entity_id = any($1::bigint[]) or changed_by_user_id = any($1::bigint[])", [ids]);
  await pool.query("delete from users where id = any($1::bigint[])", [ids]);
}

test("identity updates lock authorization and commit identity plus audit atomically", async () => {
  const [{ pool }, { updateUserIdentity }] = await Promise.all([
    import("../db/pool.js"),
    import("./user-service.js"),
  ]);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const ids: number[] = [];
  let triggerName = "";
  let functionName = "";
  let lockClient: import("pg").PoolClient | undefined;

  try {
    const supervisorId = await createUser(pool, `identity_actor_${suffix}`, "supervisor");
    const targetId = await createUser(pool, `identity_target_${suffix}`, "receptionist");
    const duplicateId = await createUser(pool, `identity_duplicate_${suffix}`, "receptionist");
    const raceTargetId = await createUser(pool, `identity_race_target_${suffix}`, "receptionist");
    ids.push(supervisorId, targetId, duplicateId, raceTargetId);

    const updated = await updateUserIdentity(
      targetId,
      { username: `  IDENTITY_Normalized_${suffix}  `, email: " identity@example.test ", fullName: " Updated Identity ", englishName: " Updated English " },
      { userId: supervisorId, role: "supervisor" },
    );
    assert.equal(updated.username, `identity_normalized_${suffix}`);
    assert.equal(updated.email, "identity@example.test");
    assert.equal(updated.full_name, "Updated Identity");
    assert.equal(updated.english_name, "Updated English");
    const identityEvent = await pool.query<{ old_values: Record<string, unknown>; new_values: Record<string, unknown>; changed_by_user_id: number }>(
      `select old_values, new_values, changed_by_user_id from audit_log
        where entity_type='user' and entity_id=$1 and action_type='update_identity' order by id desc limit 1`,
      [targetId],
    );
    assert.equal(identityEvent.rows[0]?.new_values.username, `identity_normalized_${suffix}`);
    assert.equal(identityEvent.rows[0]?.changed_by_user_id, supervisorId);

    const beforeDuplicate = await pool.query<{ username: string; email: string | null; full_name: string; english_name: string | null }>(
      "select username, email, full_name, english_name from users where id=$1", [targetId],
    );
    await assert.rejects(
      updateUserIdentity(targetId, { username: `identity_duplicate_${suffix}`, email: "new@example.test", fullName: "Must Roll Back", englishName: "Must Roll Back" }, { userId: supervisorId, role: "supervisor" }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 409,
    );
    const afterDuplicate = await pool.query("select username, email, full_name, english_name from users where id=$1", [targetId]);
    assert.deepEqual(afterDuplicate.rows[0], beforeDuplicate.rows[0], "duplicate username leaves all identity fields unchanged");

    triggerName = `identity_audit_fail_${suffix}`;
    functionName = `identity_audit_fail_fn_${suffix}`;
    await pool.query(
      `create function public.${functionName}() returns trigger language plpgsql as $$
       begin
         if new.entity_type = 'user' and new.entity_id = ${targetId} and new.action_type = 'update_identity' then
           raise exception 'forced identity audit failure';
         end if;
         return new;
       end $$`,
    );
    await pool.query(`create trigger ${triggerName} before insert on audit_log for each row execute function public.${functionName}()`);
    await assert.rejects(
      updateUserIdentity(targetId, { username: `identity_audit_fail_${suffix}`, email: "fail@example.test", fullName: "Must Roll Back", englishName: "Must Roll Back" }, { userId: supervisorId, role: "supervisor" }),
      /forced identity audit failure/,
    );
    const afterAuditFailure = await pool.query("select username, email, full_name, english_name from users where id=$1", [targetId]);
    assert.deepEqual(afterAuditFailure.rows[0], beforeDuplicate.rows[0], "audit failure rolls back every identity field");
    await pool.query(`drop trigger ${triggerName} on audit_log`);
    await pool.query(`drop function public.${functionName}()`);
    triggerName = "";
    functionName = "";

    lockClient = await pool.connect();
    await lockClient.query("begin");
    await lockClient.query("select id from users where id=$1 for update", [raceTargetId]);
    let raceOutcome: { error?: unknown; username?: string } | undefined;
    const raceUpdate = updateUserIdentity(
      raceTargetId,
      { username: `identity_race_renamed_${suffix}`, fullName: "Race Rename" },
      { userId: supervisorId, role: "supervisor" },
    ).then(
      (result) => { raceOutcome = { username: result.username }; },
      (error: unknown) => { raceOutcome = { error }; },
    );
    let targetLockWaitObserved = false;
    const lockDeadline = Date.now() + 5000;
    while (!targetLockWaitObserved && Date.now() < lockDeadline) {
      const wait = await pool.query<{ waiting: boolean }>(
        `select exists (
           select 1 from pg_stat_activity
            where pid <> pg_backend_pid() and wait_event_type = 'Lock'
              and query ilike '%from users%for update%'
         ) as waiting`,
      );
      targetLockWaitObserved = wait.rows[0]?.waiting === true;
      if (!targetLockWaitObserved) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await lockClient.query("update users set role='supervisor' where id=$1", [raceTargetId]);
    await lockClient.query("commit");
    lockClient.release();
    lockClient = undefined;
    await raceUpdate;
    assert.equal(targetLockWaitObserved, true, "identity authorization waits for the concurrently locked target row");
    assert.equal((raceOutcome?.error as { statusCode?: number } | undefined)?.statusCode, 403);
    const raceAfter = await pool.query<{ username: string; role: Role }>("select username, role from users where id=$1", [raceTargetId]);
    assert.deepEqual(raceAfter.rows[0], { username: `identity_race_target_${suffix}`, role: "supervisor" });
  } finally {
    if (lockClient) {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
    }
    if (triggerName) await pool.query(`drop trigger if exists ${triggerName} on audit_log`).catch(() => undefined);
    if (functionName) await pool.query(`drop function if exists public.${functionName}()`).catch(() => undefined);
    await cleanupUsers(pool, ids);
  }
});

test("user role changes enforce authorization, preserve Doctor Workspace history, and audit atomically", async () => {
  const [{ pool }, { createUser: createManagedUser, updateUserRole }] = await Promise.all([
    import("../db/pool.js"),
    import("./user-service.js"),
  ]);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const ids: number[] = [];
  let triggerName = "";
  let functionName = "";

  try {
    const supervisorId = await createUser(pool, `role_supervisor_${suffix}`, "supervisor");
    const targetId = await createUser(pool, `role_target_${suffix}`, "receptionist");
    const superAdminId = await createUser(pool, `role_super_admin_${suffix}`, "super_admin");
    const privilegedTargetId = await createUser(pool, `role_privileged_target_${suffix}`, "receptionist");
    ids.push(supervisorId, targetId, superAdminId, privilegedTargetId);

    await assert.rejects(
      updateUserRole(supervisorId, "super_admin", { userId: supervisorId, role: "supervisor" }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );
    const selfPromotionState = await pool.query<{ role: Role }>("select role from users where id=$1", [supervisorId]);
    assert.equal(selfPromotionState.rows[0]?.role, "supervisor", "a supervisor cannot grant themselves Super Admin");

    const grantedSupervisor = await updateUserRole(privilegedTargetId, "supervisor", { userId: superAdminId, role: "super_admin" });
    assert.equal(grantedSupervisor.role, "supervisor");
    const grantedSuperAdmin = await updateUserRole(privilegedTargetId, "super_admin", { userId: superAdminId, role: "super_admin" });
    assert.equal(grantedSuperAdmin.role, "super_admin");
    const restoredOperationalRole = await updateUserRole(privilegedTargetId, "administrative", { userId: superAdminId, role: "super_admin" });
    assert.equal(restoredOperationalRole.role, "administrative");

    await assert.rejects(
      createManagedUser(
        { username: `role_new_supervisor_${suffix}`, fullName: "New supervisor", password: "TemporaryPassword123!", role: "supervisor" },
        { userId: supervisorId, role: "supervisor" },
      ),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );

    await assert.rejects(
      updateUserRole(targetId, "super_admin", { userId: supervisorId, role: "supervisor" }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );
    await assert.rejects(
      updateUserRole(targetId, "supervisor", { userId: supervisorId, role: "supervisor" }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );
    await assert.rejects(
      updateUserRole(superAdminId, "doctor", { userId: supervisorId, role: "supervisor" }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403,
    );

    const toDoctor = await updateUserRole(targetId, "doctor", { userId: supervisorId, role: "supervisor" });
    assert.equal(toDoctor.role, "doctor");
    const profile = await pool.query<{ id: number }>(
      `insert into doctor_portal.doctor_profiles (user_id, display_name, doctor_role, active)
       values ($1, 'User role integration profile', 'consultant', true) returning id`,
      [targetId],
    );
    const toAdministrative = await updateUserRole(targetId, "administrative", { userId: supervisorId, role: "supervisor" });
    assert.equal(toAdministrative.role, "administrative");
    const preservedProfile = await pool.query<{ id: number; active: boolean }>(
      "select id, active from doctor_portal.doctor_profiles where user_id = $1",
      [targetId],
    );
    assert.deepEqual(preservedProfile.rows[0], { id: profile.rows[0]!.id, active: false });

    const event = await pool.query<{ old_values: Record<string, unknown>; new_values: Record<string, unknown>; changed_by_user_id: number }>(
      `select old_values, new_values, changed_by_user_id from audit_log
        where entity_type = 'user' and entity_id = $1 and action_type = 'user_role_changed'
        order by id desc limit 1`,
      [targetId],
    );
    assert.equal(event.rows[0]?.old_values.role, "doctor");
    assert.equal(event.rows[0]?.new_values.role, "administrative");
    assert.equal(event.rows[0]?.changed_by_user_id, supervisorId);

    triggerName = `role_audit_fail_${suffix}`;
    functionName = `role_audit_fail_fn_${suffix}`;
    await pool.query(
      `create function public.${functionName}() returns trigger language plpgsql as $$
       begin
         if new.entity_type = 'user' and new.entity_id = ${targetId} and new.action_type = 'user_role_changed' then
           raise exception 'forced role audit failure';
         end if;
         return new;
       end $$`,
    );
    await pool.query(
      `create trigger ${triggerName} before insert on audit_log for each row execute function public.${functionName}()`,
    );
    await assert.rejects(
      updateUserRole(targetId, "doctor", { userId: supervisorId, role: "supervisor" }),
      /forced role audit failure/,
    );
    const afterAuditFailure = await pool.query<{ role: Role; auth_version: number }>(
      "select role, auth_version from users where id = $1",
      [targetId],
    );
    assert.equal(afterAuditFailure.rows[0]?.role, "administrative");
    assert.equal(afterAuditFailure.rows[0]?.auth_version, 2);
  } finally {
    if (triggerName) await pool.query(`drop trigger if exists ${triggerName} on audit_log`).catch(() => undefined);
    if (functionName) await pool.query(`drop function if exists public.${functionName}()`).catch(() => undefined);
    await cleanupUsers(pool, ids);
  }
});

test("concurrent Super Admin role removals leave one active account", async () => {
  const [{ pool }, { updateUserRole }] = await Promise.all([
    import("../db/pool.js"),
    import("./user-service.js"),
  ]);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const ids: number[] = [];
  const baselineAdmins = await pool.query<{ id: number }>(
    `select id from users where role = 'super_admin' and is_active = true and username not like $1`,
    [`role_concurrency_%`],
  );
  const baselineIds = baselineAdmins.rows.map((row) => Number(row.id));

  try {
    if (baselineIds.length) {
      await pool.query("update users set is_active = false where id = any($1::bigint[])", [baselineIds]);
    }
    const firstAdmin = await createUser(pool, `role_concurrency_first_${suffix}`, "super_admin");
    const secondAdmin = await createUser(pool, `role_concurrency_second_${suffix}`, "super_admin");
    ids.push(firstAdmin, secondAdmin);

    const results = await Promise.allSettled([
      updateUserRole(firstAdmin, "receptionist", { userId: firstAdmin, role: "super_admin" }),
      updateUserRole(secondAdmin, "doctor", { userId: firstAdmin, role: "super_admin" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal((rejected?.reason as { statusCode?: number }).statusCode, 409);
    const remaining = await pool.query<{ count: string }>(
      "select count(*)::text as count from users where role = 'super_admin' and is_active = true",
    );
    assert.equal(Number(remaining.rows[0]?.count ?? 0), 1);
  } finally {
    await cleanupUsers(pool, ids);
    if (baselineIds.length) await pool.query("update users set is_active = true where id = any($1::bigint[])", [baselineIds]);
  }
});
