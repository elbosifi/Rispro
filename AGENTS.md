# RISpro Agent Map

Use this file as a table of contents. Detailed rules remain in [docs/agents.md](docs/agents.md).

| Need | Start Here |
| --- | --- |
| Backend code | `src/`, with new feature modules under `src/modules/<feature-name>/` |
| Frontend code | `frontend/src/`; Appointments V2 UI lives in `frontend/src/v2/appointments/` |
| Architecture overview | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Appointments V2 source of truth | [docs/appointments-v2/PROJECT_BRIEF.md](docs/appointments-v2/PROJECT_BRIEF.md), [docs/appointments-v2/ARCHITECTURE.md](docs/appointments-v2/ARCHITECTURE.md), [docs/appointments-v2/DECISIONS.md](docs/appointments-v2/DECISIONS.md), [docs/appointments-v2/TASK_LEDGER.md](docs/appointments-v2/TASK_LEDGER.md) |
| Domain maps | [docs/domains/index.md](docs/domains/index.md) |
| Deployment docs | [docs/production-rollout.md](docs/production-rollout.md), [docs/deployment-guide.md](docs/deployment-guide.md), [docs/docker-deployment.md](docs/docker-deployment.md) |
| Active/completed plans | [docs/plans/active/README.md](docs/plans/active/README.md), [docs/plans/completed/README.md](docs/plans/completed/README.md) |
| Plan templates | [docs/plans/templates/EXECUTION_PLAN_TEMPLATE.md](docs/plans/templates/EXECUTION_PLAN_TEMPLATE.md) |
| Quality and cleanup | [docs/quality/QUALITY_SCORE.md](docs/quality/QUALITY_SCORE.md), [docs/quality/DESLOPPIFY.md](docs/quality/DESLOPPIFY.md), [docs/quality/FOLLOW_UP_BACKLOG.md](docs/quality/FOLLOW_UP_BACKLOG.md) |
| Reliability and observability | [docs/reliability/OBSERVABILITY.md](docs/reliability/OBSERVABILITY.md), [docs/reliability/RUNBOOKS.md](docs/reliability/RUNBOOKS.md) |
| DB-backed test rules | [docs/CODEX_DB_TESTING.md](docs/CODEX_DB_TESTING.md) |

## Required Validation Commands

- Backend typecheck: `npm run typecheck`
- Frontend typecheck/build: `npm run typecheck:frontend` and `npm run build:frontend`
- Backend unit tests: `npm run test:backend:unit`
- Frontend tests: `npm run test:frontend`
- Harness checks: `npm run harness:all`
- DB-backed tests: run `npm run db:test:check` first, then use `codex-db-test.env`; never guess DB credentials.

## Defaults

- Make the smallest maintainable change that solves the request.
- Preserve Appointments V2 docs and legacy/V2 boundaries.
- Do not move DICOM, Orthanc, PACS, MWL, or scheduling authority into the frontend.
- Document risky follow-ups instead of implementing broad refactors.
