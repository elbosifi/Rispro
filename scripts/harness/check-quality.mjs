#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const largeFileLineThreshold = 1000;
const codeRoots = ["src", "frontend/src", "scripts"];
const productionRoots = ["src", "frontend/src"];
const generatedPaths = ["dist", "build", "coverage", "dist-frontend", "frontend/dist", "frontend/build", "frontend/coverage"];
const topLimit = 15;
const consoleAllowlist = [
  "src/modules/appointments-v2/observability/shadow-diff.ts",
  "src/server.ts",
  "src/services/dicom-gateway-service.ts",
  "src/observability/logger.ts"
];

const files = codeRoots.flatMap((root) => walk(path.join(repoRoot, root))).filter(isCodeFile);
const tsFiles = files.filter((file) => /\.(?:ts|tsx|mts|cts)$/.test(file));
const productionFiles = files.filter((file) => productionRoots.some((root) => relative(file).startsWith(`${root}/`)) && !isTestPath(relative(file)));

const largeFiles = tsFiles
  .map((file) => ({ file: relative(file), lines: readFileSync(file, "utf8").split(/\r?\n/).length }))
  .filter((entry) => entry.lines >= largeFileLineThreshold)
  .sort((a, b) => b.lines - a.lines);

const consoleCounts = countPatternByFile(productionFiles, /\bconsole\.(?:log|warn|error)\s*\(/g)
  .filter((entry) => !consoleAllowlist.includes(entry.file));

const allowedConsoleCounts = countPatternByFile(productionFiles, /\bconsole\.(?:log|warn|error)\s*\(/g)
  .filter((entry) => consoleAllowlist.includes(entry.file));

const todoCounts = countTodoCommentsByFile(files);
const anyCounts = countPatternByFile(tsFiles, /(?::\s*any\b|\bas\s+any\b|Record<[^>\n]*\bany\b|<[^>\n]*\bany\b)/g);
const generatedPresent = generatedPaths.filter((target) => existsSync(path.join(repoRoot, target)));

printSummary();
printTable("Top large TypeScript/TSX files", largeFiles, (entry) => `${entry.file} (${entry.lines} lines)`, topLimit);
printTable("Files with most likely TypeScript any usage", anyCounts, (entry) => `${entry.file} (${entry.count})`, topLimit);
printTable("Files with console usage requiring review", consoleCounts, (entry) => `${entry.file} (${entry.count})`, topLimit);
printTable("Allowed console usage", allowedConsoleCounts, (entry) => `${entry.file} (${entry.count})`, topLimit);
printTable("TODO/FIXME/HACK counts", todoCounts, (entry) => `${entry.file} (${entry.count})`, topLimit);

if (generatedPresent.length) {
  printTable("Generated/build artifact paths present", generatedPresent.map((file) => ({ file })), (entry) => entry.file);
}

console.log("\nResult: PASS with warnings/report-only baseline findings.");
console.log("Hard failures: none.");

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

function countPatternByFile(candidateFiles, pattern) {
  const counts = [];
  for (const file of candidateFiles) {
    const content = readFileSync(file, "utf8");
    const matches = content.match(pattern);
    if (matches?.length) counts.push({ file: relative(file), count: matches.length });
  }
  return counts.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

function printTable(title, entries, format, limit = 40) {
  if (!entries.length) {
    console.log(`${title}: none`);
    return;
  }

  console.log(`\n${title}:`);
  for (const entry of entries.slice(0, limit)) {
    console.log(`- ${format(entry)}`);
  }
  if (entries.length > limit) console.log(`- ... ${entries.length - limit} more`);
}

function countTodoCommentsByFile(candidateFiles) {
  const counts = [];
  const commentPattern = /\/\/.*|\/\*[\s\S]*?\*\//g;
  const markerPattern = /\b(?:TODO|FIXME|HACK)\b/g;

  for (const file of candidateFiles) {
    const content = readFileSync(file, "utf8");
    let count = 0;
    for (const comment of content.match(commentPattern) ?? []) {
      count += comment.match(markerPattern)?.length ?? 0;
    }
    if (count > 0) counts.push({ file: relative(file), count });
  }

  return counts.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

function printSummary() {
  const todoTotal = todoCounts.reduce((total, entry) => total + entry.count, 0);
  const anyTotal = anyCounts.reduce((total, entry) => total + entry.count, 0);
  const consoleTotal = consoleCounts.reduce((total, entry) => total + entry.count, 0);

  console.log("Quality harness summary");
  console.log(`- Large files: ${largeFiles.length}`);
  console.log(`- Files with likely any usage: ${anyCounts.length} (${anyTotal} matches)`);
  console.log(`- Files with console usage requiring review: ${consoleCounts.length} (${consoleTotal} calls)`);
  console.log(`- TODO/FIXME/HACK comments: ${todoTotal} across ${todoCounts.length} file(s)`);
  console.log(`- Generated/build artifact path warnings: ${generatedPresent.length}`);
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}
