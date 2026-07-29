#!/usr/bin/env node
import fs from "node:fs";
import { boundedText, decideAutoDeployment, failedJobs, recoverIssue, redactSecrets, selectDeploymentRun, upsertIssue } from "./github-automation-issues.mjs";

const shaPattern = /^[0-9a-f]{40}$/i;
const short = (sha) => sha.slice(0, 12);
const url = (path) => `https://github.com/${process.env.GITHUB_REPOSITORY}${path}`;
const marker = (kind, sha) => kind === "health" ? "<!-- rispro-development-health-failure -->" : `<!-- rispro-${kind}-failure:${sha} -->`;
const runLink = (id) => id ? url(`/actions/runs/${id}`) : "unavailable";
const jobsText = (jobs) => jobs.length ? jobs.map((job) => `- ${job.name}${job.steps.length ? ` (failed steps: ${job.steps.join(", ")})` : ""}`).join("\n") : "- unavailable";

function api() {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  if (!token || !owner || !repo) throw new Error("GitHub workflow token and repository are required.");
  return {
    owner, repo,
    async request(path, options = {}) {
      const response = await fetch(`https://api.github.com${path}`, { ...options, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...options.headers } });
      if (!response.ok) throw new Error(`GitHub API ${options.method ?? "GET"} ${path} failed: ${response.status}`);
      return response.status === 204 ? null : response.json();
    },
  };
}

async function newestRun(client, workflow, sha) {
  const data = await client.request(`/repos/${client.owner}/${client.repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`);
  return (data.workflow_runs ?? []).filter((run) => run.head_sha?.toLowerCase() === sha.toLowerCase()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] ?? null;
}

async function ciIssue(sha, ci, selfHosted, mainTip) {
  const client = api();
  const ciFailures = await failedJobs(client, ci?.id);
  const selfHostedFailures = await failedJobs(client, selfHosted?.id);
  const failures = [...ciFailures, ...selfHostedFailures];
  const first = failures[0]?.name ?? "unavailable";
  return upsertIssue({
    marker: marker("ci", sha), title: `CI failure for ${short(sha)}`, labels: ["automation", "ci-failure", "development", "codex-ready"],
    body: `## Exact-SHA CI failure\n\n- Full SHA: [\`${sha}\`](${url(`/commit/${sha}`)})\n- Short SHA: \`${short(sha)}\`\n- Current branch: \`main\`\n- Current main-tip confirmation: \`${mainTip}\`\n- CI: ${ci ? `${ci.name} | ${ci.status} | ${ci.conclusion ?? "pending"} | ${ci.html_url}` : "missing"}\n- Self-hosted: ${selfHosted ? `${selfHosted.name} | ${selfHosted.status} | ${selfHosted.conclusion ?? "pending"} | ${selfHosted.html_url}` : "missing"}\n\n### Failed jobs\nCI:\n${jobsText(ciFailures)}\n\nRISpro self-hosted CI:\n${jobsText(selfHostedFailures)}\n\nFirst actionable failed job: \`${first}\`.\n\nInspect locally:\n\n\`npm run ci:inspect -- --sha ${sha} --wait 900\`\n\nNo development or production deployment was dispatched for this SHA.\n\nA human may assign this issue to OpenAI Codex. Codex must create a focused repair branch and pull request; it must not push directly to main, merge or deploy.`,
  });
}

async function controller() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const sha = String(event.workflow_run?.head_sha ?? "").toLowerCase();
  if (!shaPattern.test(sha)) { console.log("Malformed workflow_run head SHA; no action."); return; }
  const client = api();
  const main = await client.request(`/repos/${client.owner}/${client.repo}/git/ref/heads/main`);
  const mainTip = main.object.sha.toLowerCase();
  if (sha !== mainTip) { console.log(`Superseded SHA ${sha}; current main is ${mainTip}.`); return; }
  const [ci, selfHosted] = await Promise.all([newestRun(client, "ci.yml", sha), newestRun(client, "self-hosted-ci.yml", sha)]);
  const deployments = await client.request(`/repos/${client.owner}/${client.repo}/actions/workflows/deploy.yml/runs?per_page=100`);
  const expectedName = `Deploy RISpro development ${sha}`;
  const deployment = selectDeploymentRun(deployments.workflow_runs, expectedName);
  const decision = decideAutoDeployment({ targetSha: sha, mainSha: mainTip, ci, selfHosted, deployment });
  console.log(`Auto-deploy decision for ${sha}: ${decision.action}.`);
  if (decision.action === "report-ci-failure") { await ciIssue(sha, ci, selfHosted, mainTip); return; }
  if (["dispatch", "deployment-exists", "deployment-failed"].includes(decision.action)) {
    await recoverIssue({ marker: marker("ci", sha), comment: `Recovery: both required exact-SHA workflows succeeded for ${sha}.` });
  }
  if (decision.action !== "dispatch") {
    return;
  }
  await client.request(`/repos/${client.owner}/${client.repo}/actions/workflows/deploy.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { commit_sha: sha } }) });
  console.log(`Dispatched deploy.yml for ${sha}.`);
}

async function deploymentReport() {
  const sha = String(process.env.DEPLOY_SHA ?? "").toLowerCase();
  if (!shaPattern.test(sha)) throw new Error("DEPLOY_SHA must be a full SHA.");
  const client = api();
  const runId = process.env.GITHUB_RUN_ID;
  const jobs = await failedJobs(client, runId);
  await upsertIssue({ marker: marker("development-deployment", sha), title: `Development deployment failure for ${short(sha)}`, labels: ["automation", "deployment-failure", "development", "codex-ready"], body: `## Development deployment failure\n\n- Full SHA: \`${sha}\`\n- Short SHA: \`${short(sha)}\`\n- Deployment workflow run: ${runLink(runId)}\n- Trigger actor: \`${process.env.GITHUB_ACTOR}\`\n- Development environment: \`development\`\n\n### Failed jobs\n${jobsText(jobs)}\n\nProduction was not deployed. Automatic rollback was not attempted.\n\nInspect the workflow run before taking action. A human may assign this issue to Codex for a focused repair pull request.` });
}

async function deploymentRecovery() {
  const sha = String(process.env.DEPLOY_SHA ?? "").toLowerCase();
  if (shaPattern.test(sha)) await recoverIssue({ marker: marker("development-deployment", sha), comment: `Recovery: development deployment for ${sha} succeeded.` });
}

async function healthReport() {
  const passed = process.env.HEALTH_PASSED === "true";
  const buildSha = String(process.env.HEALTH_BUILD_SHA ?? "");
  const details = redactSecrets(process.env.HEALTH_DETAILS ?? "No additional diagnostics.");
  const body = `## Development health status\n\n- Check time (UTC): ${new Date().toISOString()}\n- Workflow run: ${runLink(process.env.GITHUB_RUN_ID)}\n- SSH status: ${process.env.SSH_STATUS ?? "unknown"}\n- Health endpoint status: ${process.env.HEALTH_STATUS ?? "unknown"}\n- Readiness status: ${process.env.READINESS_STATUS ?? "unknown"}\n- Reported buildSha: ${shaPattern.test(buildSha) ? `\`${buildSha}\`` : "unavailable"}\n- Application service state: not monitored because the deployed process manager/service name is not confirmed by repository configuration.\n- Clinical-document export worker state: not monitored because a deployed process/service name is not confirmed by repository configuration.\n\n### Bounded diagnostics\n\`\`\`\n${boundedText(details)}\n\`\`\`\n\nNo restart, deployment, or rollback was attempted.`;
  if (passed) { await recoverIssue({ marker: marker("health"), comment: `Recovery: development health check passed at ${new Date().toISOString()}.` }); return; }
  await upsertIssue({ marker: marker("health"), title: "RISpro development health failure", labels: ["automation", "health-failure", "development", "codex-ready"], body });
}

const command = process.argv[2];
if (command === "controller") await controller();
else if (command === "deployment-report") await deploymentReport();
else if (command === "deployment-recovery") await deploymentRecovery();
else if (command === "health-report") await healthReport();
else throw new Error("Usage: development-automation.mjs <controller|deployment-report|deployment-recovery|health-report>");
