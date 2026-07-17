# RISpro Local DB-Backed Tests

`codex-db-test.env` is the local-only source of truth for DB-backed test credentials. It is intentionally separate from production `.env` and Docker deployment settings.

## Disposable Docker PostgreSQL

Preferred setup:

```powershell
npm run db:test:up
npm run db:test:check
```

`npm run db:test:up` starts a disposable Docker PostgreSQL container named `rispro-test-postgres`. It uses test-only settings and rewrites these fields in `codex-db-test.env` so they stay internally consistent:

- `DATABASE_URL`
- `TEST_DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`

Default test values:

```env
PGHOST=localhost
PGPORT=5433
PGDATABASE=rispro_test
PGUSER=rispro_test
PGPASSWORD=rispro_test_password
DATABASE_URL=postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test
TEST_DATABASE_URL=postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test
```

The container binds to `localhost:5432` only when it is free. If the user's installed PostgreSQL already uses `5432`, the script binds Docker PostgreSQL to `localhost:5433` and updates `codex-db-test.env`.

Stop and remove the disposable container with:

```powershell
npm run db:test:down
```

## Validation Sequence

When local Docker is already operational and focused DB validation is warranted, use this sequence:

```powershell
npm run db:test:up
npm run db:test:check
npm run harness:all
npm run typecheck
npm run typecheck:frontend
npm run test:backend:unit
npm run test:backend:db
npm run test:frontend
npm run build:frontend
```

`npm run test:db` is the convenience wrapper for `db:test:check`, migrations, and `test:backend:db`.

## Failure Rules

- Do not use or modify the production database.
- Do not ask for the local PostgreSQL admin password.
- If `5432` is occupied, use the Docker test database on `5433`.
- If Docker is unavailable, do not repair it solely for a full DB suite. Report any local DB validation as not run and delegate the full suite to required GitHub pull-request CI as pending.
- If `db:test:check` fails, DB-backed validation has not passed.

## Local PostgreSQL Repair

Prefer Docker when the local PostgreSQL admin password is unknown. If an admin connection URL is intentionally available, the existing local test role/database can be repaired with:

```powershell
npm run db:test:repair -- --admin-url "postgresql://postgres:<admin-password>@localhost:5432/postgres"
npm run db:test:check
```

The repair script only targets `PGDATABASE` and `PGUSER` from `codex-db-test.env`, refuses names that do not look test-only, and does not store the admin URL.
