#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(repoRoot, "codex-db-test.env");
const requiredEnvKeys = ["DATABASE_URL", "TEST_DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
const errors = [];
const warnings = [];

section("Git");
ok(`branch: ${gitBranch()}`);
ok(`status: ${gitStatusSummary()}`);

section("Runtime");
ok(`node: ${process.version}`);
ok(`npm: ${npmVersion()}`);

section("Package scripts");
const packageJson = readJson("package.json");
for (const script of ["db:test:up", "db:test:check"]) {
  if (packageJson?.scripts?.[script]) {
    ok(`${script}: ${packageJson.scripts[script]}`);
  } else {
    fail(`missing package script: ${script}`);
  }
}

section("Docker");
const dockerVersion = run("docker", ["version", "--format", "{{.Server.Version}}"]);
if (dockerVersion.status === 0) {
  ok(`Docker engine: ${dockerVersion.stdout.trim()}`);
  const imageInspect = run("docker", ["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"]);
  if (imageInspect.status === 0) {
    ok("postgres:16-alpine image present locally");
  } else {
    warn("postgres:16-alpine image not present locally; `npm run db:test:up` may pull it when Docker/network are available");
    const detail = combined(imageInspect);
    if (isMacCredentialHelperFailure(detail)) {
      fail("Detected common Mac Docker credential-helper failure while checking postgres:16-alpine.");
    }
  }
} else {
  const detail = combined(dockerVersion);
  fail(`Docker unavailable or blocked: ${detail || dockerVersion.error?.message || "docker version failed"}`);
  if (isMacCredentialHelperFailure(detail)) {
    fail("Detected common Mac Docker credential-helper failure. Fix Docker credential helper or Docker Desktop, then rerun preflight.");
  }
}

section("codex-db-test.env");
if (!existsSync(envPath)) {
  fail("missing codex-db-test.env");
} else {
  const values = loadEnv(envPath);
  for (const key of requiredEnvKeys) {
    if (String(values[key] ?? "").trim()) {
      ok(`${key}: ${key.includes("PASSWORD") ? masked(values[key]) : values[key]}`);
    } else {
      fail(`missing codex-db-test.env value: ${key}`);
    }
  }
}

if (warnings.length) {
  section("Warnings");
  for (const warning of warnings) console.log(`WARN: ${warning}`);
}

if (errors.length) {
  section("Failures");
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exit(1);
}

console.log("\nOK: agent environment preflight passed.");

function section(title) {
  console.log(`\n${title}`);
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.log(`WARN: ${message}`);
}

function fail(message) {
  errors.push(message);
}

function run(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
}

function reportCommand(label, command, args) {
  const result = run(command, args);
  if (result.status === 0) {
    const output = result.stdout.trim();
    ok(`${label}: ${output || "(clean)"}`);
  } else {
    fail(`${label}: ${combined(result) || `${command} ${args.join(" ")} failed`}`);
  }
}

function combined(result) {
  return [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n").trim();
}

function npmVersion() {
  const userAgent = process.env.npm_config_user_agent || "";
  const match = userAgent.match(/npm\/([^\s]+)/);
  return match ? match[1] : "(unknown from npm_config_user_agent)";
}

function gitBranch() {
  const headPath = path.join(repoRoot, ".git/HEAD");
  if (!existsSync(headPath)) return "(not a git checkout)";
  const head = readFileSync(headPath, "utf8").trim();
  if (head.startsWith("ref: refs/heads/")) return head.slice("ref: refs/heads/".length);
  return head ? `(detached ${head.slice(0, 12)})` : "(unknown)";
}

function gitStatusSummary() {
  const tracked = readGitIndexPaths();
  if (!tracked) return "unable to read .git/index";

  const candidates = [
    "AGENTS.md",
    "CURRENT_TASK.md",
    "package.json",
    "docs/agents",
    "scripts/dev",
    "scripts/harness/check-agent-contract.mjs",
  ];
  const untracked = [];
  for (const candidate of candidates) {
    const fullPath = path.join(repoRoot, candidate);
    if (!existsSync(fullPath)) continue;
    const files = statSync(fullPath).isDirectory() ? walkFiles(fullPath) : [fullPath];
    for (const file of files) {
      const rel = relative(file);
      if (!tracked.has(rel)) untracked.push(rel);
    }
  }

  if (untracked.length) return `untracked files detected (${untracked.length})`;
  return "no untracked files in agent contract paths";
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
  } catch (error) {
    fail(`unable to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
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

function masked(value) {
  return "*".repeat(Math.min(8, Math.max(4, String(value).length)));
}

function isMacCredentialHelperFailure(text) {
  return /docker-credential-(?:osxkeychain|desktop)|credentials store|error getting credentials|executable file not found/i.test(text || "");
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "dist-frontend", "coverage"].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function readGitIndexPaths() {
  const indexPath = path.join(repoRoot, ".git/index");
  if (!existsSync(indexPath)) return null;

  const buffer = readFileSync(indexPath);
  if (buffer.length < 12 || buffer.toString("utf8", 0, 4) !== "DIRC") return null;

  const version = buffer.readUInt32BE(4);
  if (![2, 3].includes(version)) return null;

  const entryCount = buffer.readUInt32BE(8);
  const paths = new Set();
  let offset = 12;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 62 > buffer.length) return null;
    const flags = buffer.readUInt16BE(offset + 60);
    const pathLength = flags & 0x0fff;
    const pathStart = offset + 62;
    let pathEnd = pathStart;

    if (pathLength < 0x0fff) {
      pathEnd = pathStart + pathLength;
    } else {
      while (pathEnd < buffer.length && buffer[pathEnd] !== 0) pathEnd += 1;
    }

    paths.add(buffer.toString("utf8", pathStart, pathEnd));

    let entryLength = 62 + (pathEnd - pathStart) + 1;
    entryLength = Math.ceil(entryLength / 8) * 8;
    offset += entryLength;
  }

  return paths;
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}
