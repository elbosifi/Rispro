#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const requiredFiles = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/domains/index.md",
  "docs/domains/reporting-board/README.md",
  "docs/domains/doctor-portal/README.md",
  "docs/domains/dicom-remap/README.md",
  "docs/domains/sonicdicom-notes/README.md",
  "docs/domains/appointments/README.md",
  "docs/domains/qr-patient-portal/README.md",
  "docs/domains/comparison-requests/README.md",
  "docs/plans/active/README.md",
  "docs/plans/completed/README.md",
  "docs/plans/templates/EXECUTION_PLAN_TEMPLATE.md",
  "docs/plans/templates/REVIEW_SUMMARY_TEMPLATE.md",
  "docs/plans/templates/FAILED_TASK_TEMPLATE.md"
];

const routeImportAllowlist = new Set([
  "src/modules/appointments-v2/api/routes/appointments-v2-routes.ts"
]);

const errors = [];
const warnings = [];

for (const file of requiredFiles) {
  if (!existsSync(path.join(repoRoot, file))) errors.push(`Missing required file: ${file}`);
}

const sourceFiles = [
  ...walk(path.join(repoRoot, "src")),
  ...walk(path.join(repoRoot, "frontend/src"))
].filter(isCodeFile);

const productionFiles = sourceFiles.filter((file) => !isTestPath(relative(file)));

for (const file of productionFiles) {
  const rel = relative(file);
  const imports = readImports(file);

  for (const specifier of imports) {
    const resolved = resolveImport(file, specifier);
    const targetRel = resolved ? relative(resolved) : specifier;
    if (isTestImportTarget(targetRel)) {
      errors.push(`Production source imports a test file: ${rel} -> ${specifier}`);
    }

    if (isRouteFile(rel) && isRouteImportTarget(targetRel) && !routeImportAllowlist.has(rel)) {
      errors.push(`Route file imports another route file: ${rel} -> ${specifier}`);
    }
  }
}

const routeNamingDrift = productionFiles
  .map(relative)
  .filter((file) => isRouteFile(file) && !file.endsWith("-routes.ts"));

const serviceNamingDrift = productionFiles
  .map(relative)
  .filter((file) => file.startsWith("src/services/") && file.endsWith(".ts") && !file.endsWith("-service.ts"));

if (routeNamingDrift.length) {
  warnings.push(formatList("Route-like files not ending with -routes.ts", routeNamingDrift));
}

if (serviceNamingDrift.length) {
  warnings.push(formatList("Service-directory files not ending with -service.ts", serviceNamingDrift));
}

printSection("Structure warnings", warnings);
printSection("Structure errors", errors);

if (errors.length) process.exit(1);

console.log("OK: structure harness checks passed.");

function walk(dir) {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build" || entry.name === "coverage") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function isCodeFile(file) {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file);
}

function isTestPath(file) {
  return /(^|\/)(tests?|__tests__)(\/|$)/.test(file) || /\.(?:test|spec)\.[cm]?[tj]sx?$/.test(file);
}

function isTestImportTarget(target) {
  return /(^|\/)(tests?|__tests__)(\/|$)/.test(target) || /\.(?:test|spec)(?:\.[cm]?[tj]sx?)?$/.test(target) || /\.(?:test|spec)\.[cm]?[tj]sx?$/.test(target);
}

function isRouteFile(file) {
  return file.endsWith("-routes.ts") || /^src\/routes\/[^/]+\.ts$/.test(file);
}

function isRouteImportTarget(target) {
  return target.endsWith("-routes.ts") || /^src\/routes\/[^/]+\.ts$/.test(target) || /\/[^/]*-routes(?:\.[cm]?[tj]sx?)?$/.test(target);
}

function readImports(file) {
  const content = readFileSync(file, "utf8");
  const imports = [];
  const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
  let match;
  while ((match = importPattern.exec(content))) imports.push(match[1]);
  return imports;
}

function resolveImport(sourceFile, specifier) {
  if (!specifier.startsWith(".")) return null;

  const basePath = path.resolve(path.dirname(sourceFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function formatList(title, values, limit = 30) {
  const shown = values.slice(0, limit).map((value) => `  - ${value}`).join("\n");
  const suffix = values.length > limit ? `\n  ... ${values.length - limit} more` : "";
  return `${title} (${values.length}):\n${shown}${suffix}`;
}

function printSection(title, values) {
  if (!values.length) return;
  console.log(`\n${title}:`);
  for (const value of values) console.log(value);
}
