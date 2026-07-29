# Development CI/CD Automation

## Architecture

```text
Pull request or main push
        |
        +--> CI -----------------------------+
        |                                    |
        +--> RISpro self-hosted CI ----------+--> Auto Deploy RISpro Development
                                                   | (same full SHA, current main tip)
                                                   v
                                      Deploy RISpro Development Target
                                                   |
                                      SSH health, readiness, SHA, smoke
                                                   v
                                         development environment only

RISpro Development Health (every ~15 minutes) --> HTTP health/readiness monitoring
```

The required workflow names are `CI`, `RISpro self-hosted CI`, and `Deploy RISpro Development Target`. `Auto Deploy RISpro Development` is a controller, not a deployment implementation: it dispatches `deploy.yml` only after both required workflows have completed successfully for the exact same 40-character commit SHA.

The controller first confirms that the triggering SHA is still `refs/heads/main`. Superseded commits are ignored. It also detects the deterministic deployment run name, `Deploy RISpro development <FULL_SHA>`, and will not dispatch again for queued, active, successful, or failed runs. A failed deployment requires human review or a manual rerun; it is never automatically retried.

`deploy.yml` remains the only deployment implementation. Its existing exact-SHA checks, SSH connectivity, post-deployment health/build-SHA/readiness verification, and functional smoke test remain fail-closed. Before the deployment command it makes a best-effort health/readiness/SHA precheck. Only an already healthy, ready target reporting the requested SHA skips that command; all final verification and smoke testing still run.

## Failure issues

Automation uses deterministic hidden markers so repeated events update a single issue:

| Failure | Marker | Labels |
| --- | --- | --- |
| CI | `<!-- rispro-ci-failure:<FULL_SHA> -->` | `automation`, `ci-failure`, `development`, `codex-ready` |
| Deployment | `<!-- rispro-development-deployment-failure:<FULL_SHA> -->` | `automation`, `deployment-failure`, `development`, `codex-ready` |
| Health | `<!-- rispro-development-health-failure -->` | `automation`, `health-failure`, `development`, `codex-ready` |

The CI and deployment reports query GitHub Actions jobs for failed job and step names. They do not download full logs or include secrets. Diagnostics are bounded and redact likely credentials. A later successful CI, deployment, or health check comments on and closes the matching open issue.

The scheduled health workflow runs on `self-hosted`, `Linux`, `X64`, and `rispro-ci`, using the same SSH identity and strict host-key path as deployment. It checks SSH, `/api/health`, `health.ok`, full `buildSha`, and `/api/ready`. The repository does not authoritatively identify the deployed process manager/service name or a clinical-document export-worker service name, so it does not guess or run service-manager commands; this absence is recorded in a health failure issue.

## Human and Codex response

A human may manually assign a `codex-ready` issue to OpenAI Codex. Codex must inspect the exact-SHA run and first actionable failure, make one focused fix on a repair branch, validate it locally, push that branch, and open a pull request. Codex must not push directly to `main`, merge, deploy, or invoke an endless retry loop. No workflow in this automation calls OpenAI, Codex, Copilot, or another model.

## Manual operations

Manual development deployment remains available from **Actions → Deploy RISpro Development Target → Run workflow**. Supply a full 40-character SHA with successful exact-SHA `CI` and `RISpro self-hosted CI` runs. For a failed automated deployment, inspect its visible workflow run and failure issue, fix the cause or confirm an infrastructure recovery, then use the same manual workflow to rerun the exact SHA. This does not deploy production.

To disable automatic development deployment safely, disable `Auto Deploy RISpro Development` in the Actions UI (or temporarily remove its `workflow_run` trigger in a reviewed pull request). Keep `deploy.yml` intact for manual deployment. To disable scheduled monitoring safely, disable `RISpro Development Health` in the Actions UI (or remove only its `schedule` trigger in a reviewed pull request); `workflow_dispatch` may remain for manual monitoring.

## Required configuration

The development deployment workflow requires the `development` GitHub environment and its existing `DEPLOY_APP_DIR` Actions variable. The self-hosted runner must retain labels `self-hosted`, `Linux`, `X64`, and `rispro-ci`, plus the existing SSH identity and known-host configuration used by `deploy.yml`. Do not store or print private keys, database URLs, or application secrets in workflow files.

Workflow permissions are intentionally narrow: the controller uses `actions: write`, `contents: read`, and `issues: write`; deployment failure reporting uses `actions: read`, `contents: read`, and `issues: write`; health monitoring uses `contents: read` and `issues: write`.

Configure these GitHub repository settings manually; this repository does not alter them automatically:

- Protect `main` and require pull requests before merge.
- Require the comprehensive `CI` checks and `RISpro self-hosted CI`.
- Prevent force pushes and branch deletion.
- Retain administrator control for emergency intervention.

## Troubleshooting

Inspect an exact SHA without changing state:

```bash
npm run ci:inspect -- --sha <FULL_SHA> --wait 900
```

Useful GitHub CLI commands are:

```bash
gh run list --repo elbosifi/Rispro --commit <FULL_SHA>
gh run view <RUN_ID> --repo elbosifi/Rispro --log-failed
```

For health failures, inspect the health workflow run and the current development host through the established operational access path. Do not restart, deploy, roll back, alter data, clear queues, or expose configuration while diagnosing.
