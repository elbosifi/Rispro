# Environment Preflight

Run this before validation on a new machine or after switching branches:

```powershell
npm run agent:preflight
```

The preflight reports:

- current git branch and working-tree status
- Node.js and npm versions
- Docker CLI and Docker engine availability
- whether `postgres:16-alpine` is already present locally
- whether `db:test:up` and `db:test:check` package scripts exist
- common Docker credential-helper failures on Mac
- missing required values in `codex-db-test.env`

The preflight does not start containers, run migrations, or edit env files. If Docker is unavailable, start Docker Desktop and rerun the preflight. Do not route around Docker by using a production or personal PostgreSQL database.

## Windows and Mac Handoff

1. Commit or create a patch before switching machines.
2. On the new machine, run `git pull` or apply the patch.
3. Run `npm run agent:preflight`.
4. Run `npm run db:test:up` and `npm run db:test:check`.
5. Run targeted DB tests with `npm run test:db:one -- <test-file>`.
