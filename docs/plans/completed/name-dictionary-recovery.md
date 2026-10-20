# Custom names dictionary recovery and CSV implementation

Date: 2026-10-20

Starting branch: `main`, clean and synchronized with `origin/main`.
Starting HEAD: `848bdccb6ed317ceb2cc7847033fea0d8a189d2a`.
Implementation branch: `codex/name-dictionary-recovery`. No commits, pushes, PRs or deployments are authorized.

## Implemented behavior

- Dictionary queries distinguish pending, successful empty results, initial failure and background refresh failure. Transient GET failures receive at most two retries with bounded backoff; Retry and reconnect restore the existing query without restarting the application. Previously loaded rows remain visible. Dictionary mutations are not automatically retried.
- The patient form preserves entered names and suppresses missing-token classification while dictionary loading is unavailable. Saving waits for a successful dictionary load. Registration additions use a create-only endpoint; conflicts reload the dictionary instead of overwriting a mapping.
- Both management interfaces expose Export CSV beside Import. The Settings dictionary menu entry and deep link are restored. Export requests a fresh, complete active dictionary, independent of filtering, and uses UTF-8 BOM, CSV escaping and the Tripoli calendar date in `RISpro_Name_Dictionary_YYYY-MM-DD.csv`.
- Both import interfaces use the same parser, including headers, headerless files, Arabic text, quotes, commas and multiline values. Invalid rows receive localized errors. The existing checked-in CSV parses as 2909 mappings.
- Imports validate all rows before database modification, accept at most 50000 mappings with at most 1000 characters per field, and process exact duplicate Arabic keys using the last occurrence. One transaction and one connection cover dictionary writes and audit records; serial writes bound DB concurrency. Cache invalidation follows commit.
- Dictionary create, update and delete operations also commit audit records transactionally. A short dictionary-writer table lock makes normalized-alias checks and create-only additions safe against concurrent writers, while allowing reads. Lock acquisition is bounded to five seconds.
- Both API namespaces allow authenticated active reads, protect inactive reads consistently, and require supervisor/admin re-authentication for privileged writes, imports, Apply and unresolved-patient listings. `/missing` requires patient-page access and refuses existing keys, inactive keys and normalized aliases. Registration staff retain their permitted add-new-mapping workflow.
- Browser generation now matches backend two-token phrase, compact-alias and normalization behavior. A parity suite executes both implementations against the same specification.
- Bulk Apply remains explicit and privileged. It locks current patient rows before generation, records per-patient old/new English names and update metadata, and preserves identity-document verification revocation in the same transaction. Import never applies mappings to patients. Failed rollback causes the connection to be discarded.
- PostgreSQL acquisition/connection waits are bounded to five seconds, TCP keepalive is enabled with a ten-second initial delay, dictionary reads have an eight-second client deadline, and readiness has a five-second query deadline. Longer clinical operations have no new global query deadline. Structured pool logs include only event/code/counts; checked-out transaction clients have error listeners. The driver handles connection replacement without recreating the pool.

## Validation

All tests ran outside the sandbox, using guarded disposable databases where applicable.

| Check | Result |
| --- | --- |
| `npm run agent:contract` | PASS |
| `npm run agent:preflight`, `db:test:up`, `db:test:check` | PASS, `DOCKER_OK` |
| Backend name generation and patient route guardrails | PASS, 7 tests |
| Dictionary service/cache integration | PASS, 1 test |
| Dictionary atomicity, audit rollback, alias concurrency, cache recovery and patient safety | PASS, 7 tests |
| Dictionary HTTP authorization in both namespaces | PASS, 2 tests |
| PostgreSQL idle/active termination, acquisition exhaustion, redaction and silent-network recovery | PASS, 4 tests |
| Existing patient identity-document safeguards | PASS, 11 tests |
| Existing patient import regressions | PASS, 2 tests |
| Focused frontend, CSV, parity, API, registration, Settings navigation/re-auth and i18n | PASS, 103 tests across 11 files |
| Chromium real frontend/backend journey | PASS, 1 journey, both interfaces at 1440px/390px in English/Arabic, 8 screenshots, no unexpected console/page errors or document overflow |
| `npm run typecheck` | PASS on final uncommitted `main` |
| `npm run typecheck:frontend` and `npm run build:frontend` | PASS on final uncommitted `main`; existing chunk-size build warning |
| Changed-file frontend ESLint | PASS after two scoped lint corrections |
| `git diff --check` | PASS |
| `npm run harness:all` | FAIL at existing UI baseline: 44 manual-dialog markers versus baseline 42; unchanged starting HEAD also has 44. Structure/docs/quality passed. No baseline or unrelated files were patched. Broader checks stopped here. |

Focused DB commands used `npm run db:test:required --` with:

```text
src/services/name-dictionary-service.integration.test.ts
src/services/name-dictionary-safety.integration.test.ts
src/routes/name-dictionary.integration.test.ts
src/db/pool.integration.test.ts
src/services/patient-identity-document-service.integration.test.ts
src/services/patient-import-service.integration.test.ts
```

Browser command:

```sh
VITE_API_PROXY_TARGET=http://127.0.0.1:3100 npm run test:e2e -- e2e/specs/name-dictionary.spec.ts
```

Initial validation failures were resolved: intentional i18n/menu baselines were updated for the added translations/menu entry; focused lint/type issues were corrected; browser setup used the explicit disposable-backend proxy and the real language control. The active-disconnection regression initially exposed a closing-client reuse race; dictionary transaction cleanup now discards a client after failed rollback, and the regression passes without weakening its immediate recovery assertion.

No automated tests were skipped. Comprehensive CI and full suites were not run; no push was authorized. The original VM incident is not claimed to be reproduced or confirmed. Actual production HA failover was not exercised. Process-local dictionary caches retain their existing five-minute TTL; invalidation occurs in the mutating process. A response lost after a successful commit can still leave a mutation outcome uncertain, so mutations are never automatically replayed.

`CURRENT_TASK.md` describes the earlier mobile-widget task and was left unchanged. Production databases, dictionary entries and patient names were not accessed or modified. No production services or VMs were restarted.

## Final review state

Final branch: `main`.
Final HEAD: `848bdccb6ed317ceb2cc7847033fea0d8a189d2a` (unchanged).
All 31 task files remain uncommitted and unstaged. The temporary branch is retained. A full patch and SHA-256 manifest are retained as local Git metadata (`codex-name-dictionary-recovery.patch` and `.json` in the Git directory); no checkpoint commit was created. The patch was transferred to main without commits, with byte-for-byte verification of every file.

Both task-created disposable PostgreSQL containers were removed after validation. No production services were restarted.

Exact modified/new files:

```text
docs/plans/completed/name-dictionary-recovery.md
e2e/specs/name-dictionary.spec.ts
frontend/src/components/name-dictionary/dictionary-interfaces.test.tsx
frontend/src/components/name-dictionary/dictionary-load-status.tsx
frontend/src/components/patients/patient-form.tsx
frontend/src/components/patients/patient-form.workflow.test.tsx
frontend/src/lib/api/catalog.test.ts
frontend/src/lib/api/catalog.ts
frontend/src/lib/i18n.test.ts
frontend/src/lib/i18n/ar.ts
frontend/src/lib/i18n/en.ts
frontend/src/lib/name-dictionary-csv.test.ts
frontend/src/lib/name-dictionary-csv.ts
frontend/src/lib/name-dictionary-query.test.ts
frontend/src/lib/name-dictionary-query.ts
frontend/src/lib/name-generation.test.ts
frontend/src/lib/name-generation.ts
frontend/src/pages/name-dictionary/name-dictionary-page.tsx
frontend/src/pages/settings/__snapshots__/settings-page.composition.test.ts.snap
frontend/src/pages/settings/name-dictionary-section.tsx
frontend/src/pages/settings/settings-page.composition.test.ts
frontend/src/pages/settings/settings-page.composition.ts
src/db/pool.integration.test.ts
src/db/pool.ts
src/routes/name-dictionary.integration.test.ts
src/routes/name-dictionary.ts
src/routes/settings.ts
src/services/name-dictionary-safety.integration.test.ts
src/services/name-dictionary-service.ts
src/services/patient-search-query.ts
src/utils/name-generation.test.ts
```
