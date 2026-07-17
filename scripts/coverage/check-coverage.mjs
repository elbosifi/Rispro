#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = process.argv[2];
const metrics = ["statements", "branches", "functions", "lines"];
const thresholds = readJson("coverage-thresholds.json");

if (!["frontend", "backend"].includes(target)) {
  console.error("Usage: node scripts/coverage/check-coverage.mjs <frontend|backend>");
  process.exit(1);
}

const summaryPath = target === "frontend"
  ? "frontend/coverage/coverage-summary.json"
  : "coverage/backend/merged/coverage-summary.json";
const summary = readJson(summaryPath);
const failures = checkSummary(target, summary.total, thresholds[target]);

if (target === "backend") {
  const coverage = readJson("coverage/backend/merged/coverage-final.json");
  const criticalDomainSummaries = {};
  for (const [name, domain] of Object.entries(thresholds.criticalDomains)) {
    const domainSummary = summarizeDomain(coverage, domain.paths);
    criticalDomainSummaries[name] = domainSummary;
    if (domainSummary.files === 0) {
      failures.push(`${name}: no covered product files matched its documented scope`);
      continue;
    }
    failures.push(...checkSummary(`critical domain ${name}`, domainSummary, domain));
  }
  writeFileSync(
    path.join(repoRoot, "coverage/backend/merged/critical-domain-summary.json"),
    `${JSON.stringify(criticalDomainSummaries, null, 2)}\n`,
  );
}

if (failures.length) {
  console.error("Coverage threshold failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`${target} coverage thresholds passed.`);

function checkSummary(label, actual, expected) {
  const failures = [];
  for (const metric of metrics) {
    const actualPct = Number(actual[metric]?.pct);
    const expectedPct = Number(expected[metric]);
    if (!Number.isFinite(actualPct) || !Number.isFinite(expectedPct)) {
      failures.push(`${label} ${metric}: missing percentage`);
      continue;
    }
    if (actualPct + 1e-9 < expectedPct) {
      failures.push(`${label} ${metric}: ${actualPct.toFixed(2)}% is below ${expectedPct.toFixed(1)}%`);
    }
  }
  return failures;
}

function summarizeDomain(coverage, prefixes) {
  const totals = Object.fromEntries(metrics.map((metric) => [metric, { total: 0, covered: 0 }]));
  const lineHits = new Map();
  let files = 0;

  for (const [filePath, fileCoverage] of Object.entries(coverage)) {
    const relativePath = normalizeRelativePath(filePath);
    if (!prefixes.some((prefix) => relativePath.startsWith(prefix))) continue;
    files += 1;

    for (const [id, hits] of Object.entries(fileCoverage.s ?? {})) {
      totals.statements.total += 1;
      if (hits > 0) totals.statements.covered += 1;
      const line = fileCoverage.statementMap?.[id]?.start?.line;
      if (Number.isInteger(line)) {
        const lineKey = `${relativePath}:${line}`;
        lineHits.set(lineKey, Math.max(lineHits.get(lineKey) ?? 0, hits));
      }
    }
    for (const hits of Object.values(fileCoverage.f ?? {})) {
      totals.functions.total += 1;
      if (hits > 0) totals.functions.covered += 1;
    }
    for (const branchHits of Object.values(fileCoverage.b ?? {})) {
      for (const hits of branchHits) {
        totals.branches.total += 1;
        if (hits > 0) totals.branches.covered += 1;
      }
    }
  }

  totals.lines.total = lineHits.size;
  totals.lines.covered = [...lineHits.values()].filter((hits) => hits > 0).length;
  return {
    files,
    ...Object.fromEntries(metrics.map((metric) => [metric, {
      ...totals[metric],
      pct: toPercentage(totals[metric].covered, totals[metric].total),
    }])),
  };
}

function normalizeRelativePath(filePath) {
  const absolutePath = filePath.startsWith("file:") ? fileURLToPath(filePath) : filePath;
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function toPercentage(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    console.error(`Missing coverage report: ${relativePath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}
