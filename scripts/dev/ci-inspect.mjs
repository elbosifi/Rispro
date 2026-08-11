#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repository = "elbosifi/Rispro";
const requiredWorkflows = ["CI", "RISpro self-hosted CI"];
const pollIntervalMs = 10_000;

export function parseCiInspectArgs(args) {
  const options = { ref: "HEAD", waitSeconds: 0, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--sha") {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error("--sha requires a commit SHA or ref.");
      options.ref = value;
    } else if (arg === "--wait") {
      const value = args[index + 1] && !args[index + 1].startsWith("-") ? args[++index] : "300";
      if (!/^\d+$/.test(value)) throw new Error("--wait must be a number of seconds.");
      options.waitSeconds = Number(value);
      if (options.waitSeconds < 1 || options.waitSeconds > 900) throw new Error("--wait must be between 1 and 900 seconds.");
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function isDirectExecution(moduleUrl, entryPath) {
  return Boolean(entryPath) && path.resolve(entryPath) === fileURLToPath(moduleUrl);
}

function usage() {
  console.log("Usage: npm run ci:inspect -- --sha <SHA|HEAD> [--wait [seconds]]");
  console.log("Read-only: inspects exact-SHA CI and RISpro self-hosted CI runs. --wait defaults to 300 seconds and is bounded to 900.");
}

function run(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
}

function requireSuccess(label, command, args) {
  const result = run(command, args);
  if (result.status === 0) return result.stdout.trim();
  const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
}

function resolveSha(ref) {
  const sha = requireSuccess("git rev-parse", "git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`could not resolve ${ref} to a full 40-character commit SHA.`);
  return sha.toLowerCase();
}

function matchingRun(workflow, sha) {
  const output = requireSuccess(
    `gh run list for ${workflow}`,
    "gh",
    ["run", "list", "--repo", repository, "--workflow", workflow, "--commit", sha, "--limit", "20", "--json", "databaseId,workflowName,status,conclusion,url,headSha,createdAt"],
  );
  const runs = JSON.parse(output || "[]").filter((runItem) => String(runItem.headSha || "").toLowerCase() === sha);
  runs.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  return runs[0] ?? null;
}

function failedJobs(runId) {
  try {
    const output = requireSuccess(`gh run view ${runId}`, "gh", ["run", "view", String(runId), "--repo", repository, "--json", "jobs"]);
    const jobs = JSON.parse(output || "{}").jobs ?? [];
    return jobs
      .filter((job) => ["failure", "cancelled", "timed_out", "action_required"].includes(job.conclusion))
      .map((job) => job.name);
  } catch (error) {
    console.error(`WARN: unable to inspect failed jobs for run ${runId}: ${error instanceof Error ? error.message : String(error)}`);
    return ["unavailable"];
  }
}

function showRun(workflow, runItem) {
  if (!runItem) {
    console.log(`WORKFLOW: ${workflow} | missing exact-headSha run`);
    return { state: "missing" };
  }
  const failed = runItem.conclusion === "success" ? [] : failedJobs(runItem.databaseId);
  console.log(`WORKFLOW: ${workflow} | run ID: ${runItem.databaseId} | status: ${runItem.status} | conclusion: ${runItem.conclusion ?? "pending"} | URL: ${runItem.url}`);
  console.log(`FAILED JOBS: ${failed.length ? failed.join(", ") : "none"}`);
  if (runItem.status !== "completed" || runItem.conclusion !== "success") return { state: runItem.status === "completed" ? "failed" : "pending", runItem };
  return { state: "success", runItem };
}

function showFailedLogs(runItem) {
  if (!runItem || runItem.status !== "completed" || runItem.conclusion === "success") return;
  console.log(`FAILED LOGS: gh run view ${runItem.databaseId} --log-failed`);
  const result = spawnSync("gh", ["run", "view", String(runItem.databaseId), "--repo", repository, "--log-failed"], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) console.error(`WARN: unable to retrieve failed logs for run ${runItem.databaseId}.`);
}

async function main() {
  let options;
  try {
    options = parseCiInspectArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`CI_INSPECT_ARGUMENT_FAILURE: ${error instanceof Error ? error.message : String(error)}`);
    usage();
    process.exitCode = 64;
    return;
  }
  if (options.help) {
    usage();
    return;
  }

  try {
    requireSuccess("gh --version", "gh", ["--version"]);
    requireSuccess("gh auth status", "gh", ["auth", "status"]);
    const sha = resolveSha(options.ref);
    console.log(`CI_INSPECT_SHA=${sha}`);
    const deadline = Date.now() + options.waitSeconds * 1000;

    while (true) {
      const results = requiredWorkflows.map((workflow) => ({ workflow, ...showRun(workflow, matchingRun(workflow, sha)) }));
      for (const result of results) showFailedLogs(result.runItem);
      if (results.every((result) => result.state === "success")) {
        console.log("CI_INSPECT_PASS: both required exact-SHA workflows succeeded.");
        return;
      }
      const canWait = options.waitSeconds > 0 && Date.now() + pollIntervalMs <= deadline;
      if (!canWait) {
        console.error("CI_INSPECT_NOT_READY: required exact-SHA workflows are missing, pending, cancelled, or failed.");
        process.exitCode = 1;
        return;
      }
      console.log(`CI_INSPECT_WAIT: polling again in ${pollIntervalMs / 1000} seconds.`);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } catch (error) {
    console.error(`CI_INSPECT_FAILURE: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) await main();
