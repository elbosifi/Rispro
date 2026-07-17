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

const requiredScripts = ["agent:preflight", "test:db:one", "agent:contract", "test:backend:scheduling-gate"];
const requiredEnvKeys = ["DATABASE_URL", "TEST_DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
const absoluteLocalPathPattern = /(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s)]+|\/Users\/[^/\s)]+)/g;

for (const file of requiredFiles) {
  if (!existsSync(path.join(repoRoot, file))) errors.push(`Missing required file: ${file}`);
}

const packageJson = readJson("package.json");
for (const script of requiredScripts) {
  if (!packageJson?.scripts?.[script]) errors.push(`Missing package script: ${script}`);
}

checkSchedulingGateContract(packageJson);
checkE2eEnvironmentContract();
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

function checkSchedulingGateContract(packageJson) {
  const command = packageJson?.scripts?.["test:backend:scheduling-gate"];
  const expectedDbTests = [
    "src/services/scheduling-settings-service.integration.test.ts",
    "src/services/scheduling-settings-service.idempotent.test.ts",
  ];

  if (typeof command !== "string") return;
  if (!command.startsWith("node --import tsx --test src/domain/scheduling/evaluator.test.ts && node scripts/run-backend-tests.js db ")) {
    errors.push("Scheduling gate must run the pure evaluator test and use the serial DB test runner.");
  }
  for (const testFile of expectedDbTests) {
    if (!command.includes(testFile)) errors.push(`Scheduling gate must include ${testFile}.`);
  }

  const workflowPath = path.join(repoRoot, ".github/workflows/ci.yml");
  if (!existsSync(workflowPath)) {
    errors.push("Missing pull-request CI workflow for scheduling gate validation.");
    return;
  }
  const workflow = readFileSync(workflowPath, "utf8");
  const schedulingStep = workflow.match(/- name: Run scheduling test gate\s+run: ([^\r\n]+)/);
  if (!schedulingStep || schedulingStep[1].trim() !== "npm run test:backend:scheduling-gate") {
    errors.push("Pull-request CI scheduling gate must invoke npm run test:backend:scheduling-gate.");
  }
}

function checkE2eEnvironmentContract() {
  const templatePath = path.join(repoRoot, "e2e/.env.example");
  if (!existsSync(templatePath)) {
    errors.push("Missing tracked e2e/.env.example for browser CI.");
    return;
  }
  const values = loadEnv(templatePath);
  const required = ["RISPRO_E2E", "DATABASE_URL", "TEST_DATABASE_URL", "JWT_SECRET", "RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY"];
  for (const key of required) {
    if (!String(values[key] ?? "").trim()) errors.push(`Missing e2e/.env.example key: ${key}`);
  }
  if (values.RISPRO_E2E !== "1") errors.push("e2e/.env.example must set RISPRO_E2E=1.");
  for (const key of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
    const value = String(values[key] ?? "");
    if (!/127\.0\.0\.1|localhost/.test(value) || !/(test|e2e)/i.test(value)) errors.push(`e2e/.env.example ${key} must target a loopback test database.`);
  }
  const workflowPath = path.join(repoRoot, ".github/workflows/ci.yml");
  const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
  if (!workflow.includes("cp e2e/.env.example e2e/.env")) errors.push("Browser CI must copy e2e/.env.example before running E2E commands.");
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
