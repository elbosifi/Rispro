import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];

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
    /\bnew\s+Pool\b/.test(source) ||
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
const selectedTests = allTests.filter((filePath) => {
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
}

const nodeCommand = process.execPath;
const baseArgs = ["--import", "tsx", "--test", "--test-concurrency=1"];
const maxCommandLength = process.platform === "win32" ? 7000 : 20000;
let batch = [];
let batchLength = baseArgs.join(" ").length;

function runBatch(files) {
  if (files.length === 0) return 0;
  const result = spawnSync(nodeCommand, [...baseArgs, ...files], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
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
