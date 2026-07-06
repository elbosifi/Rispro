#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsRoots = ["README.md", "AGENTS.md", "ARCHITECTURE.md", "docs"];
const absoluteLocalPathPattern = /(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s)]+|\/Users\/[^/\s)]+)/g;
const errors = [];

for (const target of docsRoots) {
  const fullPath = path.join(repoRoot, target);
  if (!existsSync(fullPath)) continue;
  const files = target.endsWith(".md") ? [fullPath] : walkMarkdown(fullPath);
  for (const file of files) checkFile(file);
}

if (errors.length) {
  console.error("Documentation harness errors:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("OK: documentation harness checks passed.");

function walkMarkdown(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(fullPath));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function checkFile(file) {
  const rel = relative(file);
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (absoluteLocalPathPattern.test(line)) {
      errors.push(`${rel}:${index + 1} contains an absolute local path`);
    }
    absoluteLocalPathPattern.lastIndex = 0;
  });

  for (const target of markdownLinks(content)) {
    if (shouldSkipLink(target)) continue;

    const targetWithoutAnchor = target.split("#")[0];
    if (!targetWithoutAnchor) continue;

    const resolved = path.resolve(path.dirname(file), decodeURIComponent(targetWithoutAnchor));
    const rootPrefix = `${repoRoot}${path.sep}`;
    if (resolved !== repoRoot && !resolved.startsWith(rootPrefix)) {
      errors.push(`${rel} links outside the repository: ${target}`);
      continue;
    }

    if (!existsSync(resolved)) {
      errors.push(`${rel} has a broken markdown link: ${target}`);
      continue;
    }

    if (targetWithoutAnchor.endsWith("/") && !statSync(resolved).isDirectory()) {
      errors.push(`${rel} links to a non-directory with trailing slash: ${target}`);
    }
  }
}

function markdownLinks(content) {
  const links = [];
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = linkPattern.exec(content))) links.push(match[1].trim());
  return links;
}

function shouldSkipLink(target) {
  return target.startsWith("#") || target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}
