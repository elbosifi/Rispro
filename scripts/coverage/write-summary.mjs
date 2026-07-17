#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = process.argv[2];
const metrics = ["statements", "branches", "functions", "lines"];

if (!["frontend", "backend"].includes(target)) {
  console.error("Usage: node scripts/coverage/write-summary.mjs <frontend|backend>");
  process.exit(1);
}

const reportPath = target === "frontend"
  ? "frontend/coverage/coverage-summary.json"
  : "coverage/backend/merged/coverage-summary.json";
const summary = readJson(reportPath).total;
const rows = [
  `### ${target === "frontend" ? "Frontend" : "Backend"} coverage`,
  "",
  "| Statements | Branches | Functions | Lines |",
  "| ---: | ---: | ---: | ---: |",
  `| ${format(summary.statements)} | ${format(summary.branches)} | ${format(summary.functions)} | ${format(summary.lines)} |`,
  "",
  `Report: \`${target === "frontend" ? "frontend/coverage/" : "coverage/backend/merged/"}\``,
];

if (target === "backend") {
  const domains = readJson("coverage/backend/merged/critical-domain-summary.json");
  rows.push("", "Critical domains:", "", "| Domain | Statements | Branches | Functions | Lines |", "| --- | ---: | ---: | ---: | ---: |");
  for (const [name, domain] of Object.entries(domains)) {
    rows.push(`| ${name} | ${format(domain.statements)} | ${format(domain.branches)} | ${format(domain.functions)} | ${format(domain.lines)} |`);
  }
}

rows.push("");
const markdown = rows.join("\n");

process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);

function format(metric) {
  return `${Number(metric.pct).toFixed(2)}% (${metric.covered}/${metric.total})`;
}

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    console.error(`Missing coverage report: ${relativePath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}
