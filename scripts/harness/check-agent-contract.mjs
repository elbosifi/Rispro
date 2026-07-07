#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const errors = [];

const requiredFiles = [
  "AGENTS.md",
  "CURRENT_TASK.md",
  "docs/agents/RISPRO_OPERATING_RULES.md",
  "docs/agents/ENVIRONMENT_PREFLIGHT.md",
  "docs/agents/TASK_TEMPLATE.md",
  "docs/agents/VALIDATION_RULES.md",
  "docs/agents/CANONICAL_FILES.md",
  "scripts/dev/preflight-env.mjs",
  "scripts/dev/test-one-db.mjs",
  "scripts/harness/check-agent-contract.mjs",
];

const requiredScripts = ["agent:preflight", "test:db:one", "agent:contract"];
const requiredEnvKeys = ["DATABASE_URL", "TEST_DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
const absoluteLocalPathPattern = /(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s)]+|\/Users\/[^/\s)]+)/g;

for (const file of requiredFiles) {
  if (!existsSync(path.join(repoRoot, file))) errors.push(`Missing required file: ${file}`);
}

const packageJson = readJson("package.json");
for (const script of requiredScripts) {
  if (!packageJson?.scripts?.[script]) errors.push(`Missing package script: ${script}`);
}

checkEnv();
checkDocsForLocalPaths();
checkDicomWorklistSideEffects();

if (errors.length) {
  console.error("Agent contract errors:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("OK: agent contract checks passed.");

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
  } catch (error) {
    errors.push(`Unable to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function checkEnv() {
  const envPath = path.join(repoRoot, "codex-db-test.env");
  if (!existsSync(envPath)) {
    errors.push("Missing codex-db-test.env");
    return;
  }
  const values = loadEnv(envPath);
  for (const key of requiredEnvKeys) {
    if (!String(values[key] ?? "").trim()) errors.push(`Missing codex-db-test.env key: ${key}`);
  }
}

function checkDocsForLocalPaths() {
  const targets = ["AGENTS.md", "CURRENT_TASK.md", "docs"];
  for (const target of targets) {
    const fullPath = path.join(repoRoot, target);
    if (!existsSync(fullPath)) continue;
    const files = statSync(fullPath).isDirectory() ? walkMarkdown(fullPath) : [fullPath];
    for (const file of files) {
      const rel = relative(file);
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        absoluteLocalPathPattern.lastIndex = 0;
        if (absoluteLocalPathPattern.test(line)) errors.push(`${rel}:${index + 1} contains an absolute local user path`);
      });
    }
  }
}

function checkDicomWorklistSideEffects() {
  const worklistDir = path.join(repoRoot, "storage/dicom/worklist-source");
  if (!existsSync(worklistDir)) return;

  const tracked = readGitIndexPaths();
  if (!tracked) {
    errors.push("Unable to inspect .git/index for DICOM worklist-source tracking state");
    return;
  }

  const sideEffects = walkFiles(worklistDir)
    .map(relative)
    .filter((file) => !tracked.has(file));

  if (sideEffects.length) {
    errors.push(`Generated DICOM worklist-source files are untracked. Remove them unless this task intentionally updates those artifacts:\n${sideEffects.slice(0, 25).join("\n")}${sideEffects.length > 25 ? `\n... ${sideEffects.length - 25} more` : ""}`);
  }
}

function walkMarkdown(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "dist-frontend", "coverage"].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(fullPath));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
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

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
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

    const entryPath = buffer.toString("utf8", pathStart, pathEnd);
    paths.add(entryPath);

    let entryLength = 62 + (pathEnd - pathStart) + 1;
    entryLength = Math.ceil(entryLength / 8) * 8;
    offset += entryLength;
  }

  return paths;
}
