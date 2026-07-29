const API_VERSION = "2022-11-28";
const MAX_DIAGNOSTIC_LENGTH = 1800;

export function boundedText(value, limit = MAX_DIAGNOSTIC_LENGTH) {
  const text = String(value ?? "").trim();
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}

export function redactSecrets(value) {
  return boundedText(value)
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/\b((?:DATABASE_URL|JWT_SECRET|GITHUB_TOKEN)\s*=)\s*[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:bearer|token)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
    .replace(/\b(authorization|cookie)\s*:\s*[^\r\n]+/gi, "$1: [REDACTED]")
    .replace(/\b((?:password|passwd|secret)\s*=)\s*[^\s]+/gi, "$1[REDACTED]");
}

export function classifyWorkflowRun(run) {
  if (!run) return "missing";
  if (run.status !== "completed") return "pending";
  return run.conclusion === "success" ? "success" : "failure";
}

export function decideAutoDeployment({ targetSha, mainSha, ci, selfHosted, deployment }) {
  if (!/^[0-9a-f]{40}$/i.test(targetSha ?? "")) return { action: "invalid" };
  if (targetSha.toLowerCase() !== String(mainSha ?? "").toLowerCase()) return { action: "superseded" };
  const ciState = classifyWorkflowRun(ci);
  const selfHostedState = classifyWorkflowRun(selfHosted);
  if ([ciState, selfHostedState].includes("missing") || [ciState, selfHostedState].includes("pending")) return { action: "wait" };
  if ([ciState, selfHostedState].includes("failure")) return { action: "report-ci-failure" };
  if (!deployment) return { action: "dispatch" };
  if (deployment.status !== "completed") return { action: "deployment-exists" };
  return deployment.conclusion === "success" ? { action: "deployment-exists" } : { action: "deployment-failed" };
}

export function selectDeploymentRun(runs, expectedName) {
  return (runs ?? [])
    .filter((run) => run.display_title === expectedName && run.event === "workflow_dispatch")
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))[0] ?? null;
}

function client({ token = process.env.GITHUB_TOKEN, repository = process.env.GITHUB_REPOSITORY } = {}) {
  if (!token || !repository?.includes("/")) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
  const [owner, repo] = repository.split("/");
  async function request(path, options = {}) {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": API_VERSION, ...options.headers },
    });
    if (!response.ok) throw new Error(`GitHub API ${options.method ?? "GET"} ${path} failed: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  return { owner, repo, request };
}

export async function failedJobs(api, runId) {
  if (!runId) return [];
  const data = await api.request(`/repos/${api.owner}/${api.repo}/actions/runs/${runId}/jobs?per_page=100`);
  return (data.jobs ?? []).filter((job) => job.conclusion && job.conclusion !== "success").map((job) => ({
    name: job.name,
    steps: (job.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name),
  }));
}

async function ensureLabels(api, labels) {
  for (const name of labels) {
    try { await api.request(`/repos/${api.owner}/${api.repo}/labels/${encodeURIComponent(name)}`); }
    catch {
      try { await api.request(`/repos/${api.owner}/${api.repo}/labels`, { method: "POST", body: JSON.stringify({ name, color: "1d76db", description: "RISpro automation" }) }); }
      catch { await api.request(`/repos/${api.owner}/${api.repo}/labels/${encodeURIComponent(name)}`); }
    }
  }
}

export async function findIssueByMarker(api, marker) {
  const query = encodeURIComponent(`repo:${api.owner}/${api.repo} is:issue in:body "${marker}"`);
  const data = await api.request(`/search/issues?q=${query}&per_page=10`);
  return findIssueInList(data.items, marker);
}

export function findIssueInList(issues, marker) {
  return (issues ?? []).find((issue) => String(issue.body ?? "").includes(marker)) ?? null;
}

export function shouldCloseRecoveredIssue(issue) {
  return issue?.state === "open";
}

export async function upsertIssue({ marker, title, body, labels, reopen = true }) {
  const api = client();
  await ensureLabels(api, labels);
  const issue = await findIssueByMarker(api, marker);
  if (!issue) return api.request(`/repos/${api.owner}/${api.repo}/issues`, { method: "POST", body: JSON.stringify({ title, body: `${marker}\n${body}`, labels }) });
  if (reopen && issue.state !== "open") await api.request(`/repos/${api.owner}/${api.repo}/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "open" }) });
  return api.request(`/repos/${api.owner}/${api.repo}/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ title, body: `${marker}\n${body}`, labels }) });
}

export async function recoverIssue({ marker, comment }) {
  const api = client();
  const issue = await findIssueByMarker(api, marker);
  if (!shouldCloseRecoveredIssue(issue)) return false;
  await api.request(`/repos/${api.owner}/${api.repo}/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: boundedText(comment, 500) }) });
  await api.request(`/repos/${api.owner}/${api.repo}/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  return true;
}
