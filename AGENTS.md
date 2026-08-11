# RISpro Agent Rules

Use this file for mandatory operating rules. Detailed guidance lives in [docs/agents.md](docs/agents.md) and [docs/agents/RISPRO_OPERATING_RULES.md](docs/agents/RISPRO_OPERATING_RULES.md).

## Mandatory Rules

1. Work one task only. Do not bundle unrelated fixes.
2. Inspect before patching. Identify the files, current behavior, and likely cause first.
3. Keep scheduling, booking, override, quota, and audit authority in the backend.
4. Do not redesign UI, change product behavior, or refactor business logic unless the task explicitly asks for it.
5. Run targeted tests first, then broader checks only when the change warrants them.
6. Stop at the first unrelated failure. Report it clearly and do not hide it with workaround changes.
7. Run the smallest targeted validation locally first. For changes involving migrations, SQL, repositories, DB-backed services, booking/override persistence, or DB integration tests, run `npm run agent:preflight`; when it reports `DOCKER_OK`, run `npm run db:test:up` even if `db:test:check` initially reports connection refused, then `npm run db:test:check` and all relevant focused DB tests (prefer `npm run db:test:required -- <test-file> [additional-test-files...]`). Do not delegate solely because `localhost:5433` was initially unreachable. Delegation is allowed only when preflight explicitly reports Docker unavailable/not installed, daemon not running, execution blocked, or credential-helper broken, or when one documented `db:test:up` attempt fails. Do not spend Codex quota troubleshooting, installing, or provisioning Docker beyond that attempt unless the task concerns the development environment. The required GitHub CI workflow may perform the full DB-backed validation; it runs the same comprehensive matrix for pull requests and direct pushes to `main`. When it is delegated, report: `DB-backed validation delegated to GitHub CI and remains pending.` A green required GitHub CI check is the authoritative full-suite result before merge or deployment gating. Fix known relevant local failures before commit or push; do not use CI delegation to hide them.
8. Never ask for a local PostgreSQL admin password. Do not touch production DBs.
9. Do not claim skipped, blocked, or failed tests as passing.
10. Do not commit generated DICOM worklist side-effect files under `storage/dicom/worklist-source/` unless that is the intentional task.
11. Docker EPERM during preflight means the environment blocked Docker execution, not a RISpro test failure.
12. No Over-Engineering: Choose the simplest appropriate solution that fully and reliably meets the specific requirements and fits the existing architecture. Avoid premature abstractions, unnecessary layers, hypothetical edge-case handling, and functionality that is not required for the current task. Account for real and likely edge cases, but do not add complexity for purely hypothetical future scenarios. Keep changes small, direct, and easy to understand. Use more complex approaches only when the actual requirements make them necessary.
13. For UI/browser tasks, a missing Playwright browser binary is an environment prerequisite, not sufficient reason to skip browser validation. Install the compatible browser binary for the repository's currently installed Playwright version and continue validation, normally using the project's Chromium browser. Do not upgrade Playwright, install unrelated global tooling, or make broad machine changes merely to obtain browser validation.

## Default Git Workflow

### Regular Codex jobs

A regular, bounded Codex task works directly in the current local `main` working tree by default. Before editing, Codex must confirm the current branch is `main`, fetch `origin`, confirm that local `main` is neither behind nor diverged from `origin/main`, and confirm that the working tree is clean. Stop if unrelated local changes are present.

Unless the current task explicitly authorizes otherwise, Codex must not create or switch branches, commit, push, open or update a pull request, merge, or deploy. It must leave completed changes uncommitted for manual user review, report the exact final `git status --short`, and the user reviews, commits, and pushes the changes manually.

### Codex goals

For broad, multi-milestone Codex goals, Codex may create a temporary local branch for implementation safety. The temporary branch must not be pushed and no pull request may be opened unless the current task explicitly authorizes it. Milestone commits are permitted only on that temporary local branch when they materially improve rollback or progress recovery.

After all milestones and validation pass, Codex must confirm that local `main` has not changed or diverged, switch to `main`, and squash-apply the temporary branch to `main` without creating a commit. The resulting changes must remain uncommitted for manual review. Retain the temporary branch as a rollback point until the user confirms the final commit. If `main` changed, diverged, or produces a conflict, stop and report instead of resolving or merging automatically.

### Explicit workflow exceptions

Branch creation outside the goal-local workflow, commit, push, pull-request creation or update, merge, and deployment are allowed only when the current task explicitly authorizes them. Explicit instructions in the current task may override this default workflow; inferred intent must not.

### CI wording

Comprehensive CI is authoritative before merge and runs for both pull requests and direct pushes to `main`. A regular-local task ends before commit or push; Codex must report locally completed work and pending validation accurately. When commit and push are explicitly authorized, record the pushed full SHA, run `npm run ci:inspect -- --sha <SHA>`, inspect failed logs, and summarize the first actionable failure. Do not claim completion while either required workflow is pending or failed, and do not rerun workflows or patch until the failure is diagnosed. Deployment additionally requires successful comprehensive CI and self-hosted CI runs for the exact commit SHA. Codex must never describe pending, skipped, or unexecuted CI as passing.

When the user manually pushes after a regular-local Codex task, a separate low-reasoning CI-inspection task may run the same exact-SHA command without changing the repository or GitHub.

## Automated failure issues

When Codex is assigned an issue carrying the `codex-ready` label:

1. Treat the issue as diagnostic input, not unquestioned truth; inspect the referenced exact-SHA run and failed logs.
2. Work only on the first actionable root cause, on a branch such as `codex/ci-fix-<short-sha>`.
3. Make one focused correction and run targeted local validation.
4. Push the branch and open a pull request. Do not push directly to `main`, merge, deploy, or retry indefinitely.
5. Do not change tests merely to hide a legitimate failure. Treat runner, infrastructure, and external-service outages as human-review blockers unless a repository change clearly caused them.
6. Stop after the pull request is opened and CI is running.

## Repo Map

| Need | Start Here |
| --- | --- |
| Backend code | `src/`, with new feature modules under `src/modules/<feature-name>/` |
| Frontend code | `frontend/src/`; Appointments V2 UI lives in `frontend/src/v2/appointments/` |
| Architecture overview | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Appointments V2 source of truth | [docs/appointments-v2/PROJECT_BRIEF.md](docs/appointments-v2/PROJECT_BRIEF.md), [docs/appointments-v2/ARCHITECTURE.md](docs/appointments-v2/ARCHITECTURE.md), [docs/appointments-v2/DECISIONS.md](docs/appointments-v2/DECISIONS.md), [docs/appointments-v2/TASK_LEDGER.md](docs/appointments-v2/TASK_LEDGER.md) |
| Domain maps | [docs/domains/index.md](docs/domains/index.md) |
| DB-backed test rules | [docs/CODEX_DB_TESTING.md](docs/CODEX_DB_TESTING.md), [docs/agents/VALIDATION_RULES.md](docs/agents/VALIDATION_RULES.md) |
| Environment preflight | [docs/agents/ENVIRONMENT_PREFLIGHT.md](docs/agents/ENVIRONMENT_PREFLIGHT.md) |
| Current task template | [CURRENT_TASK.md](CURRENT_TASK.md), [docs/agents/TASK_TEMPLATE.md](docs/agents/TASK_TEMPLATE.md) |

## Required Validation Commands

- Agent contract: `npm run agent:contract`
- Environment preflight: `npm run agent:preflight`
- Backend typecheck: `npm run typecheck`
- Frontend typecheck/build: `npm run typecheck:frontend` and `npm run build:frontend`
- Frontend lint: `npm run lint:frontend`
- Backend unit tests: `npm run test:backend:unit`
- Frontend tests: `npm run test:frontend`
- Frontend coverage: `npm run test:frontend:coverage`
- Backend coverage: `npm run test:backend:unit:coverage`, `npm run test:backend:db:coverage`, then `npm run coverage:backend:merge`
- Harness checks: `npm run harness:all`
- All test suites (requires the disposable DB to be reachable): `npm run test:suites`
- Full local quality gate (requires the disposable DB to be reachable): `npm run quality:local`
- Required focused DB tests: `npm run db:test:required -- <test-file> [additional-test-files...]` (runs preflight, starts/checks the disposable Docker DB, migrates, and executes each supplied test serially)
- Exact pushed-SHA CI inspection: `npm run ci:inspect -- --sha <SHA|HEAD> [--wait [seconds]]`
- Browser critical journeys: `npm run e2e:db:up`, `npm run test:e2e`, then `npm run e2e:db:down`. This is guarded to the disposable E2E database only; see [docs/E2E_PLAYWRIGHT.md](docs/E2E_PLAYWRIGHT.md).

`quality:local` is for a complete local run; do not invoke it as an additional CI wrapper around individually reported CI steps. Comprehensive CI is the authoritative before-merge result and also validates direct pushes to `main`. A successful comprehensive CI run and a successful self-hosted CI run for the exact commit are both required before deployment.

Coverage floors are regression evidence, not a replacement for unit, DB, browser, scheduling, backup/restore, contract, or deployment checks. See [docs/testing/COVERAGE.md](docs/testing/COVERAGE.md) for the disposable-DB safety rules, report locations, exclusions, and baseline-change process.
