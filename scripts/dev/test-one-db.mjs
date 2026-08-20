#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(repoRoot, "codex-db-test.env");
const requiredEnvKeys = ["DATABASE_URL", "TEST_DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
const providedFiles = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (providedFiles.length !== 1) {
  console.error("FAIL: provide exactly one DB test file: npm run test:db:one -- <test-file>");
  process.exit(1);
}

if (!existsSync(envPath)) {
  console.error("FAIL: missing codex-db-test.env. Run npm run db:test:up and npm run db:test:check first.");
  process.exit(1);
}

const envValues = loadEnv(envPath);
const missing = requiredEnvKeys.filter((key) => !String(envValues[key] ?? "").trim());
if (missing.length) {
  console.error(`FAIL: missing codex-db-test.env values: ${missing.join(", ")}`);
  process.exit(1);
}

const testFile = path.resolve(repoRoot, providedFiles[0]);
const rootPrefix = `${repoRoot}${path.sep}`;
if (testFile !== repoRoot && !testFile.startsWith(rootPrefix)) {
  console.error("FAIL: test file must be inside the repository.");
  process.exit(1);
}

if (!existsSync(testFile) || !statSync(testFile).isFile()) {
  console.error(`FAIL: test file does not exist: ${path.relative(repoRoot, testFile)}`);
  process.exit(1);
}

const env = {
  ...process.env,
  ...envValues,
  JWT_SECRET: "test-secret",
  NODE_ENV: process.env.NODE_ENV || "test",
};

const migrateCommand = npmCommand(["run", "migrate"]);
runOrExit(migrateCommand.command, migrateCommand.args, env);
runOrExit(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx", "--test", "--test-concurrency=1", testFile], env);

function runOrExit(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function npmCommand(args) {
  if (process.env.npm_execpath) return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  return { command: "npm", args };
}

function loadEnv(filePath) {
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    values[line.slice(0, equalsIndex).trim()] = line.slice(equalsIndex + 1).trim();
  }
  return values;
}
