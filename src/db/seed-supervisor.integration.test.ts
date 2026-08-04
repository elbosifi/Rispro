import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { pool } from "./pool.js";
import { seedAdminAccounts } from "./seed-supervisor-service.js";

const prefix = `seed_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const supervisorUsername = `${prefix}_admin`;
const superAdminUsername = `${prefix}_superadmin`;

describe("supervisor account seeding", () => {
  before(async () => {
    await pool.query(`delete from users where username like $1`, [`${prefix}%`]);
  });

  after(async () => {
    await pool.query(`delete from users where username like $1`, [`${prefix}%`]);
  });

  it("normalizes variants, preserves an existing password, and independently seeds the missing account", async () => {
    const existingHash = await bcrypt.hash("ExistingPassword123", 10);
    await pool.query(
      `insert into users (username, full_name, password_hash, role, is_active) values ($1, 'Existing Admin', $2, 'supervisor', true)`,
      [supervisorUsername, existingHash]
    );

    const first = await seedAdminAccounts(pool, {
      supervisor: { username: `  ${supervisorUsername.toUpperCase()}  `, password: "MustNotReplace123", fullName: "Supervisor" },
      superAdmin: { username: ` ${superAdminUsername.toUpperCase()} `, password: "NewSuperAdmin123", fullName: "Super Admin" },
    });
    assert.deepEqual(first, { supervisorSeeded: false, superAdminSeeded: true });

    const rows = await pool.query<{ username: string; password_hash: string; role: string }>(
      `select username, password_hash, role from users where username = any($1::text[]) order by username`,
      [[supervisorUsername, superAdminUsername]]
    );
    assert.equal(rows.rowCount, 2);
    assert.equal(rows.rows.find((row) => row.username === supervisorUsername)?.password_hash, existingHash);
    assert.equal(rows.rows.find((row) => row.username === superAdminUsername)?.role, "super_admin");
    assert.equal(await bcrypt.compare("NewSuperAdmin123", rows.rows.find((row) => row.username === superAdminUsername)!.password_hash), true);

    const second = await seedAdminAccounts(pool, {
      supervisor: { username: supervisorUsername.toUpperCase(), password: "AnotherPassword123", fullName: "Supervisor" },
      superAdmin: { username: superAdminUsername.toUpperCase(), password: "AnotherPassword456", fullName: "Super Admin" },
    });
    assert.deepEqual(second, { supervisorSeeded: false, superAdminSeeded: false });
    assert.equal((await pool.query(`select count(*)::int as count from users where username = any($1::text[])`, [[supervisorUsername, superAdminUsername]])).rows[0].count, 2);
  });

  it("fails clearly when either normalized seed username is empty", async () => {
    await assert.rejects(seedAdminAccounts(pool, {
      supervisor: { username: "   ", password: "Password123", fullName: "Supervisor" },
      superAdmin: { username: `${prefix}_unused`, password: "Password456", fullName: "Super Admin" },
    }), /SEED_SUPERVISOR_USERNAME must not be empty after trimming/);

    await assert.rejects(seedAdminAccounts(pool, {
      supervisor: { username: supervisorUsername, password: "Password123", fullName: "Supervisor" },
      superAdmin: { username: " \t ", password: "Password456", fullName: "Super Admin" },
    }), /SEED_SUPER_ADMIN_USERNAME must not be empty after trimming/);
  });
});
