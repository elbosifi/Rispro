#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rawRoot = path.join(repoRoot, "coverage/backend/raw");
const mergedRawDirectory = path.join(rawRoot, "merged");
const reportsDirectory = path.join(repoRoot, "coverage/backend/merged");
const sourceDirectories = ["unit", "db"].map((name) => path.join(rawRoot, name));

for (const directory of sourceDirectories) {
  if (!existsSync(directory)) {
    console.error(`Missing backend raw coverage directory: ${path.relative(repoRoot, directory)}`);
    process.exit(1);
  }
}

rmSync(mergedRawDirectory, { recursive: true, force: true });
rmSync(reportsDirectory, { recursive: true, force: true });
mkdirSync(mergedRawDirectory, { recursive: true });

let copiedFiles = 0;
for (const directory of sourceDirectories) {
  const prefix = path.basename(directory);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    cpSync(path.join(directory, entry.name), path.join(mergedRawDirectory, `${prefix}-${entry.name}`));
    copiedFiles += 1;
  }
}

if (copiedFiles === 0) {
  console.error("No raw backend V8 coverage files were found.");
  process.exit(1);
}

const c8Command = path.join(repoRoot, "node_modules/.bin", process.platform === "win32" ? "c8.cmd" : "c8");
const result = spawnSync(c8Command, [
  "report",
  "--config", "coverage.config.json",
  "--temp-directory", path.relative(repoRoot, mergedRawDirectory),
  "--reports-dir", path.relative(repoRoot, reportsDirectory),
  "--reporter=text",
  "--reporter=json",
  "--reporter=json-summary",
  "--reporter=lcov",
  "--reporter=html",
], { cwd: repoRoot, stdio: "inherit" });

if (result.error) {
  console.error(`Failed to start c8 report: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const thresholdResult = spawnSync(process.execPath, ["scripts/coverage/check-coverage.mjs", "backend"], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (thresholdResult.error) {
  console.error(`Failed to enforce backend coverage thresholds: ${thresholdResult.error.message}`);
  process.exit(1);
}
process.exit(thresholdResult.status ?? 1);
