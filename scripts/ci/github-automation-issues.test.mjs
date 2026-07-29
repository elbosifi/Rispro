import assert from "node:assert/strict";
import test from "node:test";
import { boundedText, classifyWorkflowRun, decideAutoDeployment, findIssueInList, redactSecrets, shouldCloseRecoveredIssue } from "./github-automation-issues.mjs";

const sha = "a".repeat(40);
const success = { status: "completed", conclusion: "success" };
test("controller dispatches only after both exact-SHA workflows succeed", () => assert.equal(decideAutoDeployment({ targetSha: sha, mainSha: sha, ci: success, selfHosted: success }).action, "dispatch"));
test("controller waits when a required workflow is pending", () => assert.equal(decideAutoDeployment({ targetSha: sha, mainSha: sha, ci: success, selfHosted: { status: "in_progress" } }).action, "wait"));
test("controller reports CI failures without deployment", () => assert.equal(decideAutoDeployment({ targetSha: sha, mainSha: sha, ci: { status: "completed", conclusion: "failure" }, selfHosted: success }).action, "report-ci-failure"));
test("controller ignores superseded SHA", () => assert.equal(decideAutoDeployment({ targetSha: sha, mainSha: "b".repeat(40), ci: success, selfHosted: success }).action, "superseded"));
test("controller does not duplicate queued, successful, or failed deployments", () => {
  for (const deployment of [{ status: "queued" }, { status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }]) assert.notEqual(decideAutoDeployment({ targetSha: sha, mainSha: sha, ci: success, selfHosted: success, deployment }).action, "dispatch");
});
test("workflow classification identifies absent and terminal unsuccessful runs", () => { assert.equal(classifyWorkflowRun(null), "missing"); assert.equal(classifyWorkflowRun({ status: "completed", conclusion: "cancelled" }), "failure"); });
test("redaction and bounded diagnostics remove representative secrets", () => {
  const redacted = redactSecrets("DATABASE_URL=postgres://secret password=hunter2 Authorization: Bearer abc.def Cookie: x=y");
  assert.doesNotMatch(redacted, /postgres|hunter2|abc\.def|x=y/);
  assert.match(boundedText("x".repeat(2000), 50), /\[truncated\]/);
});
test("issue markers deduplicate and an open matching issue is recoverable", () => {
  const marker = "<!-- rispro-ci-failure:abc -->";
  const issue = findIssueInList([{ number: 1, state: "closed", body: "other" }, { number: 2, state: "open", body: marker }], marker);
  assert.equal(issue.number, 2);
  assert.equal(shouldCloseRecoveredIssue(issue), true);
  assert.equal(shouldCloseRecoveredIssue({ state: "closed" }), false);
});
