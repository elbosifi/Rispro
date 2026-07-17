# Coverage regression baselines

RISpro coverage is a regression signal for product source code. It records which statements, branches, functions, and executable lines ran in the existing test suites. It does not prove clinical correctness, security, data integrity, authorization correctness, or that an untested workflow is safe. Branch coverage matters because a line can run while one or more decision outcomes remain untested.

Unit, DB integration, frontend component, Playwright browser, named scheduling, backup/restore, repository-contract, and deployment-gate checks remain separately required. Coverage does not replace any of them.

## Commands and report locations

```sh
npm run test:frontend:coverage
npm run test:backend:unit:coverage
npm run db:test:up
npm run db:test:check
npm run test:backend:db:coverage
npm run coverage:backend:merge
```

Run the DB command only against the verified disposable Docker database described in [CODEX_DB_TESTING.md](../CODEX_DB_TESTING.md). Never use a production, personal, or shared database for coverage. The backend runner keeps its existing first-failure behavior and sequential DB-test-file execution.

Frontend reports are written to `frontend/coverage/`. Backend per-suite reports are written to `coverage/backend/unit/` and `coverage/backend/db/`; the authoritative merged report is `coverage/backend/merged/`. Each contains terminal-readable output plus JSON summary, JSON detail, LCOV, and HTML where supported. Raw inherited V8 data remains under `coverage/backend/raw/` until the next coverage run. All report directories are ignored by Git.

## Instrumentation and aggregation

Frontend coverage uses Vitest's supported V8 provider through `@vitest/coverage-v8`. `test:frontend:coverage` runs the existing Vitest suite once; it does not run a normal suite first. Its coverage-only command permits a 10-second test timeout because V8 instrumentation can add runner overhead on shared CI hardware; test assertions and the normal-suite timeout remain unchanged.

Backend coverage uses `c8`, which consumes V8 data and works with Node 22 and the repository's `tsx` loader. The existing backend runner is left intact. `c8` sets `NODE_V8_COVERAGE`, inherited by every Node test child process. Unit and DB runs write separate raw data directories; `coverage:backend:merge` copies the raw reports into a deterministic merge directory, generates the merged reports, and enforces the global and critical-domain floors. This captures every sequential DB child without rerunning that suite.

## Scope and exclusions

The frontend measures `frontend/src/**/*.{ts,tsx}` and the backend measures `src/**/*.{ts,tsx}`. No owned product area is broadly excluded: authentication, authorization, scheduling, appointments, patient identity, Reporting Board, routes, repositories, database access, and integrations all remain in scope.

The only exclusions are test files, test directories/fixtures/test utilities, TypeScript declaration files, and generated report/build directories. Test code is excluded because it is not product behavior; declarations contain no executable implementation; fixtures and E2E utilities are test support; report/build directories are generated output. Development tooling under `scripts/` is outside the backend product-source include rather than hidden by a product exclusion. Database migrations are intentionally still in backend scope.

## Baseline and enforced floors

Baselines were measured on Node `22.22.2` using the existing 72-file/715-test frontend suite, 99-file backend unit suite, and 62-file serial DB suite. Floors are the measured result rounded down to one decimal place only, allowing less than 0.1 percentage point of insignificant V8 instrumentation variation. The scheduling/override branch floor has a further 0.1-point cross-platform allowance: the unchanged suite measured 74.67% on GitHub Ubuntu (Node 22.23.1) versus 74.75% locally, so its 74.6% floor remains a small, nonzero regression guard. They are configured in `coverage-thresholds.json` and must remain nonzero.

| Scope | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Frontend measured / floor | 49.78 / 49.7 | 46.61 / 46.6 | 38.95 / 38.9 | 52.99 / 52.9 |
| Backend measured / floor | 62.48 / 62.4 | 68.75 / 68.7 | 66.31 / 66.3 | 62.48 / 62.4 |

Critical-domain coverage is computed from the explicit path prefixes in `coverage-thresholds.json`, not by excluding other product code. These groupings are intentionally backend-only: the backend source paths provide a stable, single implementation authority for these cross-screen domains.

| Critical domain | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Authentication and authorization | 65.29 / 65.2 | 71.85 / 71.8 | 71.43 / 71.4 | 65.29 / 65.2 |
| Patient identity and duplicate detection | 74.95 / 74.9 | 64.52 / 64.5 | 75.00 / 75.0 | 74.95 / 74.9 |
| Scheduling and overrides | 74.63 / 74.6 | 74.75 / 74.6 | 84.51 / 84.5 | 74.63 / 74.6 |
| Appointments | 78.72 / 78.7 | 75.14 / 75.1 | 74.76 / 74.7 | 78.72 / 78.7 |
| Queue and status progression | 52.66 / 52.6 | 75.17 / 75.1 | 46.15 / 46.1 | 52.66 / 52.6 |
| Reporting Board | 69.76 / 69.7 | 74.95 / 74.9 | 76.56 / 76.5 | 69.76 / 69.7 |

## CI policy

The comprehensive `CI` workflow is authoritative for coverage enforcement. It runs for pull requests and direct pushes to `main`. Its backend job runs the coverage-wrapped unit suite once and the coverage-wrapped DB suite once, merges/enforces once, uploads `backend-coverage`, and writes the global plus critical-domain table to the GitHub Actions summary. Its frontend job substitutes the Vitest coverage command for the previous normal test command, uploads `frontend-coverage`, and writes its summary. The named scheduling gate, backup/restore integration, Playwright Chromium E2E, repository contract, harness, deployment gate, migrations, lint, typechecks, and production build remain in place.

Self-hosted CI deliberately continues to run its existing normal suites and does not duplicate coverage enforcement. Comprehensive `CI` is the authoritative regression gate; making self-hosted CI also run complete coverage suites would duplicate expensive work without a distinct release signal.

## Maintaining the policy

Raise floors when durable test coverage improves. Do not lower a floor merely to merge a feature. A justified change needs a reviewed explanation of the scope change or unavoidable instrumentation change, freshly generated frontend and merged backend reports, updated measured/floor tables, and explicit approval from a maintainer responsible for test quality. Keep branch coverage in every proposal; line coverage alone is insufficient.
