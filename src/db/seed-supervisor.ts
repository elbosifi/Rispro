import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { pool } from "./pool.js";

async function run(): Promise<void> {
  if (env.isProduction && env.seedSupervisorPassword === "ChangeMe123!") {
    throw new Error("SEED_SUPERVISOR_PASSWORD must be changed before production seeding.");
  }

  const supervisorPasswordHash = await bcrypt.hash(env.seedSupervisorPassword, 10);
  const superAdminPasswordHash = await bcrypt.hash(env.seedSuperAdminPassword, 10);

  const supervisorResult = await pool.query(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      on conflict (username) do nothing
    `,
    [env.seedSupervisorUsername, env.seedSupervisorFullName, supervisorPasswordHash]
  );

  const superAdminResult = await pool.query(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'super_admin', true)
      on conflict (username) do nothing
    `,
    [env.seedSuperAdminUsername, env.seedSuperAdminFullName, superAdminPasswordHash]
  );

  console.log(Number(supervisorResult.rowCount || 0) > 0 ? "Seeded supervisor account." : "Supervisor account already exists.");
  console.log(Number(superAdminResult.rowCount || 0) > 0 ? "Seeded super_admin account." : "Super_admin account already exists.");
  await pool.end();
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
