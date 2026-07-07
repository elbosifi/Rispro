# RISpro Agent Rules

Use this file for mandatory operating rules. Detailed guidance lives in [docs/agents.md](docs/agents.md) and [docs/agents/RISPRO_OPERATING_RULES.md](docs/agents/RISPRO_OPERATING_RULES.md).

## Mandatory Rules

1. Work one task only. Do not bundle unrelated fixes.
2. Inspect before patching. Identify the files, current behavior, and likely cause first.
3. Keep scheduling, booking, override, quota, and audit authority in the backend.
4. Do not redesign UI, change product behavior, or refactor business logic unless the task explicitly asks for it.
5. Run targeted tests first, then broader checks only when the change warrants them.
6. Stop at the first unrelated failure. Report it clearly and do not hide it with workaround changes.
7. Use the portable Docker test DB flow for DB-backed validation: `npm run db:test:up`, `npm run db:test:check`, then `codex-db-test.env`.
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
- Backend unit tests: `npm run test:backend:unit`
- Frontend tests: `npm run test:frontend`
- Harness checks: `npm run harness:all`
- DB-backed tests: `npm run db:test:up`, `npm run db:test:check`, then `npm run test:db:one -- <test-file>`
