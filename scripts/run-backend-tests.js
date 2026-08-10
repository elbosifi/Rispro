import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const requestedTestPaths = process.argv.slice(3);
const dbTestEnvPath = path.join(repoRoot, "codex-db-test.env");

if (!["unit", "db"].includes(mode)) {
  console.error("Usage: node scripts/run-backend-tests.js <unit|db>");
  process.exit(1);
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function resolveLocalImport(fromPath, specifier) {
  if (!specifier.startsWith(".")) return null;

  const basePath = path.resolve(path.dirname(fromPath), specifier);
  const candidates = [];
  if (basePath.endsWith(".js")) {
    candidates.push(basePath.slice(0, -3) + ".ts");
    candidates.push(basePath.slice(0, -3) + ".tsx");
    candidates.push(basePath);
  } else {
    candidates.push(basePath);
    candidates.push(`${basePath}.ts`);
    candidates.push(`${basePath}.tsx`);
    candidates.push(`${basePath}.js`);
    candidates.push(`${basePath}.mjs`);
    candidates.push(path.join(basePath, "index.ts"));
  }

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function sourceHasDbUsage(source) {
  return (
    /from\s+["'][^"']*\/db\/pool\.js["']/.test(source) ||
    /import\s+\{\s*pool\s*\}\s+from\s+["'][^"']*pool\.js["']/.test(source) ||
    /\bnew\s+pg\.Pool\b/.test(source) ||
    /\bnew\s+pg\.Client\b/.test(source) ||
    /\bnew\s+Pool\b/.test(source) ||
    (/import\s+\{[^}]*\bClient\b[^}]*\}\s+from\s+["']pg["']/.test(source) && /\bnew\s+Client\b/.test(source)) ||
    /\bpool\.query\s*\(/.test(source)
  );
}

function importsDbBackedModule(filePath, seen = new Set()) {
  if (seen.has(filePath)) return false;
  seen.add(filePath);

  const source = fs.readFileSync(filePath, "utf8");
  if (sourceHasDbUsage(source)) return true;

  const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const importedPath = resolveLocalImport(filePath, match[1]);
    if (importedPath && importsDbBackedModule(importedPath, seen)) {
      return true;
    }
  }

  return false;
}

function isDbBackedTest(filePath) {
  const normalizedPath = filePath.split(path.sep).join("/");
  if (
    normalizedPath.includes("/tests/integration/") ||
    normalizedPath.endsWith(".integration.test.ts") ||
    normalizedPath.endsWith(".e2e.test.ts") ||
    normalizedPath.endsWith(".db.test.ts")
  ) {
    return true;
  }

  return importsDbBackedModule(filePath);
}

const allTests = walk(path.join(repoRoot, "src")).sort();
const selectedTests = requestedTestPaths.length > 0
  ? selectExplicitDbTests(requestedTestPaths)
  : allTests.filter((filePath) => {
    if (mode === "unit" && fs.readFileSync(filePath, "utf8").includes("frontend/src/")) {
      return false;
    }

    return isDbBackedTest(filePath) === (mode === "db");
  });

if (selectedTests.length === 0) {
  console.error(`No backend ${mode} tests found.`);
  process.exit(1);
}

console.log(`Running ${selectedTests.length} backend ${mode} test file(s).`);

if (mode === "unit") {
  process.env.DATABASE_URL ||= "postgres://unit-test:unit-test@127.0.0.1:1/rispro_unit_placeholder";
  process.env.TEST_DATABASE_URL ||= process.env.DATABASE_URL;
  process.env.JWT_SECRET ||= "unit-test-secret";
} else {
  loadEnvFile(dbTestEnvPath);
  process.env.NODE_ENV ||= "test";
  process.env.JWT_SECRET ||= "db-test-secret";
  process.env.COOKIE_SECURE ||= "false";
  process.env.COOKIE_SAME_SITE ||= "lax";
  runMigration();
}

const nodeCommand = process.execPath;
const baseArgs = ["--import", "tsx", "--test", "--test-concurrency=1"];
const maxCommandLength = process.platform === "win32" ? 7000 : 20000;
const dbTestFileTimeoutMs = Number(process.env.DB_TEST_FILE_TIMEOUT_MS ?? 120_000);
let batch = [];
let batchLength = baseArgs.join(" ").length;

function runBatch(files) {
  if (files.length === 0) return 0;
  if (mode === "db") {
    for (const file of files) {
      console.log(`Running DB test file: ${file}`);
      const result = spawnSync(nodeCommand, [...baseArgs, file], {
        cwd: repoRoot,
        env: process.env,
        stdio: "inherit",
        timeout: dbTestFileTimeoutMs,
      });
      if (result.error) {
        console.error(`DB test file failed to complete: ${file}`);
        console.error(`detail: ${result.error.message}`);
        return result.status ?? 1;
      }
      if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
  }

  const result = spawnSync(nodeCommand, [...baseArgs, ...files], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing DB test env file: ${filePath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    process.env[line.slice(0, equalsIndex).trim()] = line.slice(equalsIndex + 1).trim();
  }
}

function runMigration() {
  console.log("Running database migrations for DB-backed tests.");
  const { command, args } = npmScriptCommand(["run", "migrate"]);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to start migration command: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`Migration command failed with exit code ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }
}

function npmScriptCommand(args) {
  if (process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}

function selectExplicitDbTests(requestedPaths) {
  if (mode !== "db") {
    console.error("Explicit test-file selection is supported only for DB-backed tests.");
    process.exit(1);
  }

  const selected = [];
  const seen = new Set();
  for (const requestedPath of requestedPaths) {
    const filePath = path.resolve(repoRoot, requestedPath);
    const relativePath = path.relative(repoRoot, filePath);
    if (!allTests.includes(filePath)) {
      console.error(`Requested DB test file does not exist: ${relativePath}`);
      process.exit(1);
    }
    if (!isDbBackedTest(filePath)) {
      console.error(`Requested test file is not DB-backed: ${relativePath}`);
      process.exit(1);
    }
    if (!seen.has(filePath)) {
      selected.push(filePath);
      seen.add(filePath);
    }
  }

  return selected;
}

for (const filePath of selectedTests) {
  const relativePath = path.relative(repoRoot, filePath);
  const nextLength = batchLength + relativePath.length + 1;
  if (batch.length > 0 && nextLength > maxCommandLength) {
    const status = runBatch(batch);
    if (status !== 0) process.exit(status);
    batch = [];
    batchLength = baseArgs.join(" ").length;
  }
  batch.push(relativePath);
  batchLength += relativePath.length + 1;
}

const status = runBatch(batch);
if (status !== 0) process.exit(status);
