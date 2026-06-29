# RISpro Local DB-Backed Tests

`codex-db-test.env` is the local-only source of truth for DB-backed test credentials.
It is intentionally separate from production `.env` and Docker deployment settings.

Before running DB-backed tests:

```powershell
npm run db:test:check
```

If the check reports `wrong password`, the PostgreSQL server is reachable but the
stored password for the local test role does not match `PGPASSWORD` in
`codex-db-test.env`.

Repair the local test role/database with an admin connection URL:

```powershell
npm run db:test:repair -- --admin-url "postgresql://postgres:<admin-password>@localhost:5432/postgres"
npm run db:test:check
```

The repair script only targets `PGDATABASE` and `PGUSER` from `codex-db-test.env`,
refuses names that do not look test-only, and does not store the admin URL.

Do not use a production database URL for this workflow.
