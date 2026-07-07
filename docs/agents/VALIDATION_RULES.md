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

## DB-Backed Tests

Use the portable Docker test DB:

```powershell
npm run db:test:up
npm run db:test:check
npm run test:db:one -- <test-file>
```

`npm run test:db:one` loads `codex-db-test.env`, sets `JWT_SECRET=test-secret`, runs migrations against the disposable test DB, and runs exactly one provided DB test file with `node --import tsx --test --test-concurrency=1`.

Never claim a skipped, blocked, or failed DB test as passing.
