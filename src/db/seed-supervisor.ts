import { env } from "../config/env.js";
import { pool } from "./pool.js";
import { seedAdminAccounts } from "./seed-supervisor-service.js";

async function run(): Promise<void> {
  if (env.isProduction && env.seedSupervisorPassword === "ChangeMe123!") {
    throw new Error("SEED_SUPERVISOR_PASSWORD must be changed before production seeding.");
  }

  const result = await seedAdminAccounts(pool, {
    supervisor: { username: env.seedSupervisorUsername, password: env.seedSupervisorPassword, fullName: env.seedSupervisorFullName },
    superAdmin: { username: env.seedSuperAdminUsername, password: env.seedSuperAdminPassword, fullName: env.seedSuperAdminFullName },
  });

  console.log(result.supervisorSeeded ? "Seeded supervisor account." : "Supervisor account already exists.");
  console.log(result.superAdminSeeded ? "Seeded super_admin account." : "Super_admin account already exists.");
  await pool.end();
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
