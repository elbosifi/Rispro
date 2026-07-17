# RISpro Agent Rules

Use this file for mandatory operating rules. Detailed guidance lives in [docs/agents.md](docs/agents.md) and [docs/agents/RISPRO_OPERATING_RULES.md](docs/agents/RISPRO_OPERATING_RULES.md).

## Mandatory Rules

1. Work one task only. Do not bundle unrelated fixes.
2. Inspect before patching. Identify the files, current behavior, and likely cause first.
3. Keep scheduling, booking, override, quota, and audit authority in the backend.
4. Do not redesign UI, change product behavior, or refactor business logic unless the task explicitly asks for it.
5. Run targeted tests first, then broader checks only when the change warrants them.
6. Stop at the first unrelated failure. Report it clearly and do not hide it with workaround changes.
7. Run the smallest targeted validation locally first. For DB-affecting work, use the portable Docker test DB flow when Docker is already functional and the targeted test is reasonably quick; do not spend Codex quota troubleshooting, installing, or provisioning Docker unless the task concerns the development environment. The required GitHub pull-request CI workflow may perform the full DB-backed validation. When it is delegated, report: `DB-backed validation delegated to GitHub CI and remains pending.` A green required GitHub CI check is the authoritative full-suite result before merge. Fix known relevant local failures before pushing; do not use CI delegation to hide them.
8. Never ask for a local PostgreSQL admin password. Do not touch production DBs.
9. Do not claim skipped, blocked, or failed tests as passing.
10. Do not commit generated DICOM worklist side-effect files under `storage/dicom/worklist-source/` unless that is the intentional task.
11. Docker EPERM during preflight means the environment blocked Docker execution, not a RISpro test failure.

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
- Harness checks: `npm run harness:all`
- All test suites (requires the disposable DB to be reachable): `npm run test:suites`
- Full local quality gate (requires the disposable DB to be reachable): `npm run quality:local`
- DB-backed tests when local Docker is already ready: `npm run db:test:up`, `npm run db:test:check`, then `npm run test:db:one -- <test-file>`; otherwise delegate the full suite to required GitHub pull-request CI and report it as pending

`quality:local` is for a complete local run; do not invoke it as an additional CI wrapper around individually reported CI steps. Pull-request CI is the authoritative before-merge result. A successful self-hosted CI run for the exact commit is additionally required before deployment.
