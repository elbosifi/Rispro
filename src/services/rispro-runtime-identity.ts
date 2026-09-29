import os from "node:os";

function normalized(value: string | undefined, fallback: string, maxLength: number): string {
  const clean = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (clean || fallback).slice(0, maxLength);
}

export function resolveRisproProcessRole(): string {
  const configured = normalized(process.env.RISPRO_PROCESS_ROLE, "", 24);
  if (configured) return configured;
  return process.argv.some((value) => value.includes("request-scan-worker-main"))
    ? "request_scan_worker"
    : "web";
}

export function getRisproRuntimeIdentity(): {
  instanceId: string;
  processRole: string;
  hostname: string;
  buildCommitSha: string;
  postgresApplicationName: string;
} {
  const hostname = normalized(os.hostname(), "unknown-host", 48);
  const instanceId = normalized(process.env.RISPRO_INSTANCE_ID, hostname, 32);
  const processRole = resolveRisproProcessRole();
  const buildCommitSha = normalized(process.env.RISPRO_BUILD_COMMIT_SHA, "unknown", 64);
  // PostgreSQL application_name is limited to 63 bytes. This is ASCII-only.
  const postgresApplicationName = `rispro:${processRole}:${instanceId}`.slice(0, 63);
  return { instanceId, processRole, hostname, buildCommitSha, postgresApplicationName };
}
