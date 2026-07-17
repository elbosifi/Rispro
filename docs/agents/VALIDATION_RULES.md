# Validation Rules

## Order

1. Run the smallest targeted test that exercises the change.
2. Run broader typecheck, build, frontend, backend, harness, or DB checks when the touched surface warrants them.
3. Stop at the first unrelated failure and report it. Do not patch around unrelated failures.

## Required Commands

- Agent contract: `npm run agent:contract`
- Environment preflight: `npm run agent:preflight`
- Backend typecheck: `npm run typecheck`
- Frontend typecheck/lint/build: `npm run typecheck:frontend`, `npm run lint:frontend`, and `npm run build:frontend`
- Backend unit tests: `npm run test:backend:unit`
- Frontend tests: `npm run test:frontend`
- Frontend coverage: `npm run test:frontend:coverage`
- Backend coverage: `npm run test:backend:unit:coverage`, `npm run test:backend:db:coverage`, then `npm run coverage:backend:merge`
- Harness checks: `npm run harness:all`
- Deployment-gate regression: `npm run test:deployment:gate`
- Deployment functional-smoke unit test: `npm run test:deployment:smoke:unit`
- All test suites: `npm run test:suites`
- Full local quality validation: `npm run quality:local`

## Quality-Gate Command Names

| Need | Command | Database requirement |
| --- | --- | --- |
| Fast focused validation | The smallest relevant test command, such as `node --import tsx --test <file>` or `cd frontend && npm run test -- <file>` | Only when the selected test is DB-backed |
| Backend unit suite | `npm run test:backend:unit` | None |
| Frontend suite | `npm run test:frontend` | None |
| Frontend coverage | `npm run test:frontend:coverage` | None |
| Backend coverage | `npm run test:backend:unit:coverage`, `npm run test:backend:db:coverage`, then `npm run coverage:backend:merge` | Disposable Docker test DB for DB coverage |
| Complete test suites | `npm run test:suites` | Disposable Docker test DB must already be reachable |
| Complete local quality gate | `npm run quality:local` | Disposable Docker test DB must already be reachable |

`test:all` is retired because it did not represent the full quality gate. `test:suites` contains only the unit, frontend, and DB-backed test suites. `quality:local` additionally runs the repository contract, harness, deployment-gate regression, typechecks, frontend lint, and frontend production build.

## Validation Matrix

| Validation context | Required behavior |
| --- | --- |
| Local developer validation | Run `npm run agent:contract`, relevant targeted checks, and relevant typechecks. When the disposable Docker DB is already available and a complete local run is warranted, run `npm run quality:local`. Do not start or repair Docker solely for a non-DB task. |
| Pull-request required validation | The `repository-contract` job runs agent contract, harness, and deployment-gate regression without PostgreSQL. The backend job runs migrations, backend typecheck, coverage-wrapped unit/DB suites, merged coverage thresholds, the named scheduling gate, and the specially configured backup/restore integration. The frontend job runs lint, coverage-wrapped tests, and production build. A green required pull-request CI result is authoritative before merge. |
| Self-hosted clean-environment validation | Runs the same repository contract, harness, and deployment-gate regression before starting its disposable PostgreSQL container, then runs migrations, backend typecheck/unit/DB suites, and frontend lint/tests/production build. It intentionally does not repeat PR coverage enforcement. Pull-request-only coverage, named scheduling, and backup/restore gates remain visible in PR CI because they provide distinct authoritative signals. |
| Deployment-gate regression validation | `npm run test:deployment:gate` is mandatory in PR and self-hosted CI. It protects workflow/script deployment invariants; it does not replace product tests. |
| Post-deployment functional smoke | `npm run test:deployment:smoke` targets an explicitly supplied deployed URL. It runs only after restart, readiness, and runtime SHA verification; it is not a local-stack or browser-E2E command. |
| Deployment authorization | Deployment requires a full 40-character commit SHA and a successful self-hosted CI workflow run for that exact SHA, followed by readiness and running build-SHA verification. |

CI delegation is permitted for full DB validation; it is not permission to skip all validation. Known relevant failures must be fixed locally and must not be deferred to CI. Pending, skipped, blocked, and failed CI checks are not passing. Docker unavailability never authorizes use of a production, personal, or otherwise non-disposable PostgreSQL database. Do not copy CI setup, migration, or passing test output into the Codex conversation unless a failure requires diagnosis.

## Local DB-Backed Tests

Use the portable Docker test DB for focused iterative work only when Docker is already functional and the setup is reasonably quick:

```powershell
npm run db:test:up
npm run db:test:check
npm run test:db:one -- <test-file>
```

`npm run test:db:one` loads `codex-db-test.env`, sets `JWT_SECRET=test-secret`, runs migrations against the disposable test DB, and runs exactly one provided DB test file with `node --import tsx --test --test-concurrency=1`.

Do not spend Codex quota troubleshooting, installing, or provisioning Docker solely to run the full DB suite. Delegate that suite to the required GitHub pull-request CI workflow and report exactly: `DB-backed validation delegated to GitHub CI and remains pending.` A green required GitHub CI check is the authoritative full-suite result before merge.

Never claim pending, skipped, blocked, or failed local tests or CI checks as passing.

## CI Handoff Template

```text
Local validation:
- agent contract: PASS/FAIL
- typecheck: PASS/FAIL
- targeted tests: PASS/FAIL/NOT APPLICABLE
- targeted DB test: PASS/FAIL/NOT RUN

CI handoff:
- full DB-backed validation delegated to GitHub CI: YES/NO
- CI status: PENDING/PASS/FAIL
- no pending check is represented as passing
```
