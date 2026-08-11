#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontendRoot = path.join(repoRoot, "frontend", "src");
const baselinePath = path.join(repoRoot, "scripts", "harness", "ui-normalization-baseline.json");
const printCurrent = process.argv.includes("--print-current");

const patterns = {
  genericButton: /<button\b[^>]*\bclassName\s*=\s*(?:"[^"]*\bbtn-(?:primary|secondary|ghost|outline|destructive)\b[^"]*"|'[^']*\bbtn-(?:primary|secondary|ghost|outline|destructive)\b[^']*'|\{`[^`]*\bbtn-(?:primary|secondary|ghost|outline|destructive)\b[^`]*`\})[^>]*>/gs,
  genericInput: /<input\b[^>]*\bclassName\s*=\s*(?:"[^"]*\binput-premium\b[^"]*"|'[^']*\binput-premium\b[^']*'|\{`[^`]*\binput-premium\b[^`]*`\})[^>]*>/gs,
  genericTextarea: /<textarea\b[^>]*\bclassName\s*=\s*(?:"[^"]*\binput-premium\b[^"]*"|'[^']*\binput-premium\b[^']*'|\{`[^`]*\binput-premium\b[^`]*`\})[^>]*>/gs,
  manualDialogMarker: /\b(?:role="dialog"|aria-modal="true")/g,
  genericClone: /\b(?:export\s+)?(?:function|const)\s+(?:Button|Input|Card|Table|Dialog|LoadingState|EmptyState|ErrorState)\b/g,
};

const current = {};
for (const file of walk(frontendRoot)) {
  const relativePath = relative(file);
  if (!file.endsWith(".tsx") || isTestPath(relativePath) || relativePath.startsWith("frontend/src/components/shared/")) continue;
  const source = readFileSync(file, "utf8");
  const counts = Object.fromEntries(Object.entries(patterns).map(([name, pattern]) => [name, source.match(pattern)?.length ?? 0]));
  if (Object.values(counts).some(Boolean)) current[relativePath] = counts;
}

if (printCurrent) {
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error("UI normalization baseline is missing: scripts/harness/ui-normalization-baseline.json");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const regressions = [];
for (const category of Object.keys(patterns)) {
  const rule = baseline[category];
  if (!rule || !Number.isInteger(rule.total) || !Array.isArray(rule.files)) {
    regressions.push(`baseline category ${category} is missing or invalid`);
    continue;
  }
  const currentEntries = Object.entries(current).filter(([, counts]) => (counts[category] ?? 0) > 0);
  const currentTotal = currentEntries.reduce((sum, [, counts]) => sum + counts[category], 0);
  if (currentTotal > rule.total) regressions.push(`${category} total ${currentTotal} exceeds baseline ${rule.total}`);
  for (const [file] of currentEntries) {
    if (!rule.files.includes(file)) regressions.push(`${file}: new ${category} debt is not in the reviewed legacy baseline`);
  }
}

if (regressions.length) {
  console.error("UI normalization ratchet failed. Reuse a shared primitive or document a genuine exception before changing the reviewed baseline:");
  for (const regression of regressions) console.error(`- ${regression}`);
  process.exit(1);
}

const totals = Object.keys(patterns).map((category) => [
  category,
  Object.values(current).reduce((sum, counts) => sum + (counts[category] ?? 0), 0),
]);
console.log("OK: UI normalization debt did not increase.");
for (const [category, count] of totals) console.log(`- ${category}: ${count}`);

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "build", "coverage"].includes(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function isTestPath(file) {
  return /(^|\/)(tests?|__tests__)(\/|$)/.test(file) || /\.(?:test|spec)\.[cm]?[tj]sx?$/.test(file);
}
