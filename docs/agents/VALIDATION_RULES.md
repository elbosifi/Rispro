# Validation Rules

## Order

1. Run the smallest targeted test that exercises the change.
2. Run broader typecheck, build, frontend, backend, harness, or DB checks when the touched surface warrants them.
3. Stop at the first unrelated failure and report it. Do not patch around unrelated failures.

## Required Commands

- Agent contract: `npm run agent:contract`
- Environment preflight: `npm run agent:preflight`
- Backend typecheck: `npm run typecheck`
- Frontend typecheck/build: `npm run typecheck:frontend` and `npm run build:frontend`
- Backend unit tests: `npm run test:backend:unit`
- Frontend tests: `npm run test:frontend`
- Harness checks: `npm run harness:all`

## Validation Matrix

| Change type | Local before push | CI before merge |
| --- | --- | --- |
| Non-DB changes | Agent contract, relevant typecheck, and targeted unit or frontend test | Required pull-request CI |
| DB-affecting changes | Agent contract, relevant typecheck, targeted unit tests, and an optional targeted DB test only when Docker is already available and setup is immediate | Migrations, backend DB suite, relevant scheduling/integration gates, and frontend checks where applicable |
| Environment/Docker tasks | `npm run agent:preflight`, `npm run db:test:up`, `npm run db:test:check`, and the relevant targeted DB test | Confirm the normal CI workflow remains green |

CI delegation is permitted for full DB validation; it is not permission to skip all validation. Known relevant failures must be fixed locally and must not be deferred to CI. Do not copy CI setup, migration, or passing test output into the Codex conversation unless a failure requires diagnosis.

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
