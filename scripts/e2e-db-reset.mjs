import { spawnSync } from "node:child_process";
import pg from "pg";
import { assertSafeE2eEnvironment } from "./e2e-db-safety.mjs";

const target = assertSafeE2eEnvironment();
const client = new pg.Client({ connectionString: target.url });
await client.connect();
try {
  await client.query("drop schema if exists doctor_portal cascade");
  await client.query("drop schema if exists appointments_v2 cascade");
  await client.query("drop schema if exists ohif cascade");
  await client.query("drop schema if exists public cascade");
  await client.query("create schema public");
} finally {
  await client.end();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["--env-file=e2e/.env", "--import", "tsx", "src/db/migrate.ts"]);
run("node", ["--env-file=e2e/.env", "--import", "tsx", "e2e/seed.ts"]);
