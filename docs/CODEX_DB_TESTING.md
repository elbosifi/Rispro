# Codex DB Testing

Codex DB-backed tests use one disposable local PostgreSQL database on every machine:

- database: `rispro_test`
- user: `rispro_test`
- password: `rispro_test`
- host: `localhost`
- port: `5432`

Check DB access:

```bash
npm run db:test:check
```

Run DB tests:

```bash
npm run test:db
```

`codex-db-test.env` is for disposable local test DB values only. Never put production credentials in `codex-db-test.env`.
