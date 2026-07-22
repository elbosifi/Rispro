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
  "scripts/dev/required-db-test.mjs",
  "scripts/dev/ci-inspect.mjs",
  "coverage.config.json",
  "coverage-thresholds.json",
  "scripts/coverage/check-coverage.mjs",
  "scripts/coverage/merge-backend-coverage.mjs",
  "scripts/coverage/write-summary.mjs",
  "scripts/harness/check-agent-contract.mjs",
];

const requiredScripts = [
  "agent:preflight",
  "test:db:one",
  "db:test:required",
  "ci:inspect",
  "test:tooling",
  "agent:contract",
  "test:backend:scheduling-gate",
  "test:frontend:coverage",
  "test:backend:unit:coverage",
  "test:backend:db:coverage",
  "coverage:backend:merge",
];
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
checkCoverageContract(packageJson);
checkE2eEnvironmentContract();
checkGitWorkflowContract();
checkRequiredDbAndCiInspectionContract(packageJson);
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
  const workflow = readText(".github/workflows/ci.yml");
  const schedulingStep = workflow.match(/- name: Run scheduling test gate\s+run: ([^\r\n]+)/);
  if (!schedulingStep || schedulingStep[1].trim() !== "npm run test:backend:scheduling-gate") {
    errors.push("Pull-request CI scheduling gate must invoke npm run test:backend:scheduling-gate.");
  }
}

function checkRequiredDbAndCiInspectionContract(packageJson) {
  const requiredDb = packageJson?.scripts?.["db:test:required"];
  if (requiredDb !== "node scripts/dev/required-db-test.mjs") {
    errors.push("db:test:required must invoke the required disposable-DB wrapper.");
  }
  const ciInspect = packageJson?.scripts?.["ci:inspect"];
  if (ciInspect !== "node scripts/dev/ci-inspect.mjs") {
    errors.push("ci:inspect must invoke the exact-SHA read-only CI inspector.");
  }

  const requiredDbScript = readText("scripts/dev/required-db-test.mjs");
  for (const requiredSnippet of [
    "scripts/dev/preflight-env.mjs",
    "db:test:up",
    "db:test:check",
    "test:db:one",
    "DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT",
  ]) {
    if (!requiredDbScript.includes(requiredSnippet)) errors.push(`Required DB wrapper must include ${requiredSnippet}.`);
  }
  if (!readText("scripts/dev/test-one-db.mjs").includes("--test-concurrency=1")) {
    errors.push("The focused DB test primitive must keep serial test concurrency.");
  }

  const ciScript = readText("scripts/dev/ci-inspect.mjs");
  for (const requiredSnippet of [
    "elbosifi/Rispro",
    "RISpro self-hosted CI",
    "headSha",
    "--log-failed",
    "gh auth status",
  ]) {
    if (!ciScript.includes(requiredSnippet)) errors.push(`CI inspector must include ${requiredSnippet}.`);
  }

  const agents = readText("AGENTS.md");
  const validationRules = readText("docs/agents/VALIDATION_RULES.md");
  const dbTesting = readText("docs/CODEX_DB_TESTING.md");
  const operatingRules = readText("docs/agents/RISPRO_OPERATING_RULES.md");
  for (const [name, document] of [["AGENTS.md", agents], ["VALIDATION_RULES.md", validationRules], ["CODEX_DB_TESTING.md", dbTesting], ["RISPRO_OPERATING_RULES.md", operatingRules]]) {
    requireMatch(document, /DOCKER_OK/, `${name} must require the Docker-ready DB validation sequence.`);
    requireMatch(document, /db:test:required/, `${name} must document the required DB wrapper.`);
  }
  requireMatch(agents, /ci:inspect[^\n]*--sha/, "AGENTS.md must require exact-SHA CI inspection after an authorized push.");
  requireMatch(validationRules, /--log-failed/, "VALIDATION_RULES.md must document failed-log inspection.");
}

function checkCoverageContract(packageJson) {
  const thresholds = readJson("coverage-thresholds.json");
  const metrics = ["statements", "branches", "functions", "lines"];
  for (const scope of ["frontend", "backend"]) {
    for (const metric of metrics) {
      if (!(Number(thresholds?.[scope]?.[metric]) > 0)) {
        errors.push(`Coverage threshold ${scope}.${metric} must be a nonzero number.`);
      }
    }
  }
  const domains = thresholds?.criticalDomains;
  if (!domains || Object.keys(domains).length < 6) {
    errors.push("Coverage thresholds must define all critical-domain baselines.");
  } else {
    for (const [name, domain] of Object.entries(domains)) {
      if (!Array.isArray(domain.paths) || domain.paths.length === 0) {
        errors.push(`Critical coverage domain ${name} must document its source scope.`);
      }
      for (const metric of metrics) {
        if (!(Number(domain[metric]) > 0)) {
          errors.push(`Critical coverage threshold ${name}.${metric} must be nonzero.`);
        }
      }
    }
  }

  const frontendConfigPath = path.join(repoRoot, "frontend/vitest.config.ts");
  const frontendConfig = existsSync(frontendConfigPath) ? readFileSync(frontendConfigPath, "utf8") : "";
  if (!frontendConfig.includes('provider: "v8"') || !frontendConfig.includes("thresholds: coverageThresholds.frontend")) {
    errors.push("Frontend coverage must use Vitest's V8 provider and the shared threshold configuration.");
  }

  for (const script of ["test:backend:unit:coverage", "test:backend:db:coverage"]) {
    const command = packageJson?.scripts?.[script];
    if (typeof command !== "string" || !command.includes("c8 --config coverage.config.json") || !command.includes("scripts/run-backend-tests.js")) {
      errors.push(`${script} must collect V8 coverage through c8 around the existing backend runner.`);
    }
  }

  const workflowPath = path.join(repoRoot, ".github/workflows/ci.yml");
  const workflow = existsSync(workflowPath) ? readText(".github/workflows/ci.yml") : "";
  const backendJob = jobBlock(workflow, "backend-scheduling");
  const frontendJob = jobBlock(workflow, "frontend-build");
  for (const command of ["npm run test:backend:unit:coverage", "npm run test:backend:db:coverage", "npm run coverage:backend:merge"]) {
    if (countRunCommand(backendJob, command) !== 1) {
      errors.push(`Pull-request backend CI must invoke ${command} exactly once.`);
    }
  }
  if (countRunCommand(backendJob, "npm run test:backend:unit") !== 0 || countRunCommand(backendJob, "npm run test:backend:db") !== 0) {
    errors.push("Pull-request backend CI must not duplicate complete normal and coverage suites.");
  }
  if (countRunCommand(frontendJob, "npm run test:coverage") !== 1 || countRunCommand(frontendJob, "npm run test") !== 0) {
    errors.push("Pull-request frontend CI must run the coverage suite once instead of a normal duplicate suite.");
  }
  for (const artifact of ["backend-coverage", "frontend-coverage"]) {
    if (!workflow.includes(`name: ${artifact}`)) errors.push(`Pull-request CI must upload the ${artifact} artifact.`);
  }

  const gitignorePath = path.join(repoRoot, ".gitignore");
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!gitignore.includes("/coverage/") || !gitignore.includes("/frontend/coverage/")) {
    errors.push("Coverage report directories must be ignored.");
  }
}

function jobBlock(workflow, jobName) {
  const marker = `  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) return "";
  const nextJob = workflow.slice(start + marker.length).search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJob === -1
    ? workflow.slice(start + marker.length)
    : workflow.slice(start + marker.length, start + marker.length + nextJob);
}

function countRunCommand(job, command) {
  const escaped = command.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return (job.match(new RegExp(`^\\s*run: ${escaped}\\s*$`, "gm")) ?? []).length;
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
  const workflow = existsSync(workflowPath) ? readText(".github/workflows/ci.yml") : "";
  const envCopyIndex = workflow.indexOf("cp e2e/.env.example e2e/.env");
  const frontendInstallIndex = workflow.indexOf("working-directory: frontend\n        run: npm ci", workflow.indexOf("browser-e2e:"));
  const dbUpIndex = workflow.indexOf("npm run e2e:db:up");
  const e2eTestIndex = workflow.indexOf("npm run test:e2e:ci");
  if (envCopyIndex === -1 || frontendInstallIndex === -1 || dbUpIndex === -1 || e2eTestIndex === -1 || !(frontendInstallIndex < envCopyIndex && envCopyIndex < dbUpIndex && dbUpIndex < e2eTestIndex)) {
    errors.push("Browser CI must install frontend dependencies, copy e2e/.env.example, and start the guarded E2E database before browser tests.");
  }
}

function checkGitWorkflowContract() {
  const agents = readText("AGENTS.md");
  const taskTemplate = readText("docs/agents/TASK_TEMPLATE.md");
  const currentTask = readText("CURRENT_TASK.md");

  requireMatch(agents, /^## Default Git Workflow$/m, "AGENTS.md must include a Default Git Workflow section.");
  for (const workflow of ["regular-local", "goal-local", "pull-request", "deployment"]) {
    requireMatch(agents, new RegExp(`\\b${escapeRegExp(workflow)}\\b`), `AGENTS.md Default Git Workflow must name ${workflow}.`);
    requireMatch(taskTemplate, new RegExp(`\\b${escapeRegExp(workflow)}\\b`), `TASK_TEMPLATE.md Git workflow must allow ${workflow}.`);
  }

  for (const operation of ["commit", "push", "pull request"]) {
    requireMatch(agents, new RegExp(`must not[^.\\n]*${escapeRegExp(operation)}|${escapeRegExp(operation)}[^.\\n]*must not`, "i"), `AGENTS.md must explicitly prohibit regular-job ${operation}.`);
  }
  requireMatch(agents, /leave completed changes uncommitted/i, "AGENTS.md must require regular-job changes to remain uncommitted.");
  requireMatch(agents, /temporary local branch/i, "AGENTS.md must describe temporary local branch behavior for Codex goals.");
  requireMatch(agents, /squash-apply[^.\n]*`main`[^.\n]*without creating a commit/i, "AGENTS.md must require squash application back to main without committing.");
  requireMatch(agents, /merge[^.\n]*deployment[^.\n]*explicitly authorizes/i, "AGENTS.md must require explicit authorization for merge and deployment.");

  requireMatch(taskTemplate, /^## Git workflow$/m, "TASK_TEMPLATE.md must include a Git workflow section.");
  requireMatch(taskTemplate, /^Selected workflow:/m, "TASK_TEMPLATE.md must include a Selected workflow field.");
  for (const operation of ["Branch", "Commit", "Push", "Pull request", "Merge", "Deploy"]) {
    requireMatch(taskTemplate, new RegExp(`^- ${escapeRegExp(operation)}:`, "m"), `TASK_TEMPLATE.md must include an explicit authorization field for ${operation}.`);
  }

  const activeWorkflow = currentTask.match(/^Selected workflow:\s*`(regular-local|goal-local|pull-request|deployment)`\s*$/m);
  if (activeWorkflow) {
    for (const operation of ["Branch", "Commit", "Push", "Pull request", "Merge", "Deploy"]) {
      requireMatch(currentTask, new RegExp(`^- ${escapeRegExp(operation)}:`, "m"), `CURRENT_TASK.md selected workflow requires an explicit authorization field for ${operation}.`);
    }
  }
}

function readText(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!existsSync(fullPath)) return "";
  return readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
}

function requireMatch(value, pattern, error) {
  if (!pattern.test(value)) errors.push(error);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
