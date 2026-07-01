# RISpro Local DB-Backed Tests

`codex-db-test.env` is the local-only source of truth for DB-backed test credentials.
It is intentionally separate from production `.env` and Docker deployment settings.

Before running DB-backed tests:

```powershell
npm run db:test:up
npm run db:test:check
```

`npm run db:test:up` starts a disposable Docker PostgreSQL container named
`rispro-test-postgres`. It uses the test-only database/user from
`codex-db-test.env`, uses the existing `PGPASSWORD` or generates a test-only
password when missing, and rewrites these local test fields so they match:

- `DATABASE_URL`
- `TEST_DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`

The container binds to `localhost:5432` when free. If another PostgreSQL is
already using `5432`, it binds to `localhost:5433` and updates
`codex-db-test.env` consistently.

Stop and remove the disposable container with:

```powershell
npm run db:test:down
```

If the check reports `wrong password`, the PostgreSQL server is reachable but the
stored password for the local test role does not match `PGPASSWORD` in
`codex-db-test.env`.

Prefer `npm run db:test:up` when the local PostgreSQL admin password is unknown.
If you intentionally want to repair an existing local PostgreSQL test role
instead, use an admin connection URL:

Repair the local test role/database with an admin connection URL:

```powershell
npm run db:test:repair -- --admin-url "postgresql://postgres:<admin-password>@localhost:5432/postgres"
npm run db:test:check
```

The repair script only targets `PGDATABASE` and `PGUSER` from `codex-db-test.env`,
refuses names that do not look test-only, and does not store the admin URL.

Do not use a production database URL for this workflow.
