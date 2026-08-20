import { spawnSync } from "node:child_process";
import { assertSafeE2eEnvironment } from "./e2e-db-safety.mjs";

const name = "rispro-e2e-postgres";
const target = assertSafeE2eEnvironment();
const url = new URL(target.url);
const password = decodeURIComponent(url.password);
const user = decodeURIComponent(url.username);
const port = url.port || "5444";

function run(args) {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function waitForDatabase() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = spawnSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-p", "5432", "-U", user, "-d", target.database], { stdio: "ignore" });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`Timed out waiting for ${name} to accept connections.`);
}

if (process.argv[2] === "up") {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  run(["run", "-d", "--name", name, "--label", "rispro.role=e2e-db", "-e", `POSTGRES_DB=${target.database}`, "-e", `POSTGRES_USER=${user}`, "-e", `POSTGRES_PASSWORD=${password}`, "-p", `127.0.0.1:${port}:5432`, "postgres:16-alpine"]);
  waitForDatabase();
} else if (process.argv[2] === "down") {
  spawnSync("docker", ["rm", "-f", name], { stdio: "inherit" });
} else {
  throw new Error("Usage: node scripts/e2e-db-container.mjs up|down");
}
