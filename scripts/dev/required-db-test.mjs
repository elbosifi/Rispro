#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const containerName = "rispro-test-postgres";
const delegationStatuses = new Set([
  "DOCKER_NOT_INSTALLED",
  "DOCKER_DAEMON_NOT_RUNNING",
  "DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT",
  "DOCKER_CREDENTIAL_HELPER_BROKEN",
]);

export function parseRequiredDbArgs(args) {
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (!files.length) throw new Error("provide at least one DB test file: npm run db:test:required -- <test-file> [additional-test-files...]");
  if (files.length !== args.length) throw new Error("db:test:required accepts DB test file paths only.");
  return files;
}

function npmCommand(args) {
  return process.env.npm_execpath
    ? { command: process.execPath, args: [process.env.npm_execpath, ...args] }
    : { command: "npm", args };
}

function printCommand(command, args) {
  console.log(`$ ${[command, ...args].join(" ")}`);
}

function run(command, args, options = {}) {
  printCommand(command, args);
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`OUTCOME: exit ${result.status ?? 1}`);
  return result;
}

function dockerContainerRunning() {
  const result = spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", containerName], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

function dockerStatus(output) {
  return output.match(/^DOCKER_STATUS=([^\r\n]+)$/m)?.[1]?.trim() ?? "DOCKER_UNKNOWN_FAILURE";
}

function validateFiles(files) {
  for (const providedFile of files) {
    const file = path.resolve(repoRoot, providedFile);
    const rootPrefix = `${repoRoot}${path.sep}`;
    if (!file.startsWith(rootPrefix) || !existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`DB test file must exist inside the repository: ${providedFile}`);
    }
  }
}

function finish(outcome, code, message) {
  console.error(`${outcome}: ${message}`);
  process.exitCode = code;
}

async function main() {
  let files;
  try {
    files = parseRequiredDbArgs(process.argv.slice(2));
    validateFiles(files);
  } catch (error) {
    finish("DB_REQUIRED_ARGUMENT_FAILURE", 64, error instanceof Error ? error.message : String(error));
    return;
  }

  const preflight = run(process.execPath, ["scripts/dev/preflight-env.mjs"]);
  const status = dockerStatus(`${preflight.stdout ?? ""}\n${preflight.stderr ?? ""}`);
  if (status !== "DOCKER_OK") {
    const classification = delegationStatuses.has(status) ? "delegation permitted" : "delegation not permitted until Docker is explicitly classified";
    finish("DB_REQUIRED_DOCKER_ENVIRONMENT_FAILURE", 20, `${status}; ${classification}.`);
    return;
  }

  const wasRunning = dockerContainerRunning();
  const up = npmCommand(["run", "db:test:up"]);
  const upResult = run(up.command, up.args);
  if (upResult.status !== 0) {
    finish("DB_REQUIRED_DOCKER_SETUP_FAILURE", 21, "db:test:up failed after one documented attempt; delegation permitted.");
    return;
  }

  const createdByInvocation = !wasRunning;
  try {
    const check = npmCommand(["run", "db:test:check"]);
    const checkResult = run(check.command, check.args);
    if (checkResult.status !== 0) {
      finish("DB_REQUIRED_READINESS_FAILURE", 22, "db:test:check failed; DB-backed validation did not run.");
      return;
    }

    for (const file of files) {
      const focused = npmCommand(["run", "test:db:one", "--", file]);
      const focusedResult = run(focused.command, focused.args);
      if (focusedResult.status !== 0) {
        finish("DB_REQUIRED_TEST_FAILURE", focusedResult.status ?? 1, `focused DB test failed: ${file}`);
        return;
      }
    }
    console.log("DB_REQUIRED_PASS: disposable Docker DB check, migrations, and all focused serial DB tests passed.");
  } finally {
    if (createdByInvocation) {
      const down = npmCommand(["run", "db:test:down"]);
      const downResult = run(down.command, down.args);
      if (downResult.status !== 0 && !process.exitCode) {
        finish("DB_REQUIRED_CLEANUP_FAILURE", 23, "failed to remove the disposable container created by this invocation.");
      }
    } else {
      console.log(`DB_REQUIRED_CLEANUP: preserved already-running disposable test container ${containerName}.`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
