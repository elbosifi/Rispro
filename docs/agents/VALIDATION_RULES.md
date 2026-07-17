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
| Local developer validation | Run `npm run agent:contract`, relevant targeted checks, and relevant typechecks. For DB-affecting changes, follow the mandatory Docker sequence below; for a non-DB task, do not start or repair Docker solely for validation. When complete local validation is warranted, run `npm run quality:local`. |
| Comprehensive CI validation | The `CI` workflow runs the same `repository-contract`, backend, frontend, and browser-E2E jobs for pull requests and direct pushes to `main`. The backend job runs migrations, backend typecheck, coverage-wrapped unit/DB suites, merged coverage thresholds, the named scheduling gate, and the specially configured backup/restore integration. The frontend job runs lint, coverage-wrapped tests, and production build. A green exact-commit result is authoritative before merge and is required for deployment. |
| Self-hosted clean-environment validation | Runs the same repository contract, harness, and deployment-gate regression before starting its disposable PostgreSQL container, then runs migrations, backend typecheck/unit/DB suites, and frontend lint/tests/production build. It intentionally does not repeat comprehensive-CI coverage enforcement. Comprehensive-CI-only coverage, named scheduling, and backup/restore gates remain visible in the comprehensive workflow because they provide distinct authoritative signals. |
| Deployment-gate regression validation | `npm run test:deployment:gate` is mandatory in comprehensive CI and self-hosted CI. It protects workflow/script deployment invariants; it does not replace product tests. |
| Post-deployment functional smoke | `npm run test:deployment:smoke` targets an explicitly supplied deployed URL. It runs only after restart, readiness, and runtime SHA verification; it is not a local-stack or browser-E2E command. |
| Deployment authorization | Deployment requires a full 40-character commit SHA, a successful comprehensive `CI` workflow run for that exact SHA, and a successful `RISpro self-hosted CI` workflow run for that exact SHA, followed by readiness and running build-SHA verification. |

CI delegation is permitted for full DB validation only under the Docker classifications below; it is not permission to skip all validation. Known relevant failures must be fixed locally before commit or push and must not be deferred to CI. Pending, skipped, blocked, and failed CI checks are not passing. Docker unavailability never authorizes use of a production, personal, or otherwise non-disposable PostgreSQL database. Do not copy CI setup, migration, or passing test output into the Codex conversation unless a failure requires diagnosis.

## Local DB-Backed Tests

For changes involving migrations, SQL, repositories, DB-backed services, booking/override persistence, or DB integration tests, this sequence is mandatory:

```powershell
npm run db:test:up
npm run db:test:check
npm run db:test:required -- <test-file> [additional-test-files...]
```

Run `npm run agent:preflight` first. If it reports `DOCKER_OK`, run `npm run db:test:up` even when an initial `db:test:check` failed because `localhost:5433` was unreachable. Then run `npm run db:test:check` and all relevant focused tests. `npm run db:test:required -- <test-file> [additional-test-files...]` performs that sequence, runs migrations through the existing `test:db:one` safe focused-test command, and executes each supplied test file with concurrency one. It preserves an already-running `rispro-test-postgres` container and removes only a container it created.

Do not delegate solely because `localhost:5433` was initially unreachable. Delegation is allowed only when `agent:preflight` explicitly reports `DOCKER_NOT_INSTALLED` (Docker unavailable), `DOCKER_DAEMON_NOT_RUNNING`, `DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT`, or `DOCKER_CREDENTIAL_HELPER_BROKEN`, or when one documented `npm run db:test:up` attempt fails. Do not spend Codex quota troubleshooting, installing, or provisioning Docker beyond that one attempt solely to run the full DB suite. In a permitted delegation case, report exactly: `DB-backed validation delegated to GitHub CI and remains pending.`

Never claim pending, skipped, blocked, or failed local tests or CI checks as passing.

## Exact-SHA CI Inspection After an Authorized Push

When commit and push are explicitly authorized, record the pushed full SHA and run:

```powershell
npm run ci:inspect -- --sha <SHA> [--wait [seconds]]
```

The command is read-only. It verifies `gh` and `gh auth status`, resolves `HEAD` or the supplied ref to a full SHA, and inspects only `CI` and `RISpro self-hosted CI` runs in `elbosifi/Rispro` whose `headSha` exactly equals that SHA. It prints each workflow's name, run ID, status, conclusion, URL, failed job names, and failed logs via `gh run view <id> --log-failed` when applicable. It returns `0` only when both required workflows succeed; missing, pending, cancelled, or failed workflows return nonzero. `--wait` polls internally for 1–900 seconds (300 seconds when supplied without a value). Never rerun workflows or perform GitHub writes. Diagnose the first actionable failure before patching, and do not claim completion while either workflow is pending or failed.

After a user manually pushes a regular-local task, a separate low-reasoning Codex CI-inspection task may run this read-only command.

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
