// @ts-check

import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { pool } from "./pool.js";

/** @returns {Promise<void>} */
async function run() {
  if (env.isProduction && env.seedSupervisorPassword === "ChangeMe123!") {
    throw new Error("SEED_SUPERVISOR_PASSWORD must be changed before production seeding.");
  }

  const passwordHash = await bcrypt.hash(env.seedSupervisorPassword, 10);

  const { rowCount } = await pool.query(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      on conflict (username) do nothing
    `,
    [env.seedSupervisorUsername, env.seedSupervisorFullName, passwordHash]
  );

  console.log(Number(rowCount || 0) > 0 ? "Seeded supervisor account." : "Supervisor account already exists.");
  await pool.end();
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
