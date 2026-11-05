# Module access security validation — 2026-11-05

Baseline: `761b4261f7c5f11c0f06faa5c6e07730cbbf7840` on local `main`, matching
`origin/main` when work began, including migrations 243–246. The initial tree was
clean. Implementation remains uncommitted. No commit, push, deployment or
production-database operation was performed.

Architecture, administrator behavior, compatibility and future-module instructions:
[Module access](../domains/module-access/README.md).

## Results

| Command or focused selection | Actual result |
| --- | --- |
| `npm run agent:preflight` | PASS; `DOCKER_OK` |
| `npm run db:test:up` then `npm run db:test:check` | PASS; existing disposable test container preserved, database `rispro_test` on port 5433 |
| `npm run agent:contract` | PASS |
| `npm run harness:all` | PASS; existing report-only warnings |
| `npm run typecheck` | PASS |
| `npm run typecheck:frontend` | PASS on the final frontend source |
| `npm run build:frontend` | PASS on the final frontend source; bundle-size/tooling warnings |
| `npm run lint:frontend` | PASS: zero errors, ten existing hook warnings |
| `npm run test:backend:unit` | PASS: 1,229 passed, two skipped, zero failed across its two Windows command batches |
| Focused frontend selection below | PASS: 60 tests |
| Focused DB selection below | PASS: 209 tests, including 16 real-application module tests |
| Relevant Chromium journeys below | PASS: nine journeys across the workflow run and the focused module rerun |
| `git diff --check` | PASS |

Frontend selection:

```text
npm run test:frontend -- src/pages/auth/login-page.test.tsx src/pages/settings/users-section.test.tsx src/pages/settings/module-access-section.test.tsx src/pages/gamma-knife/use-gamma-knife-text.test.tsx src/pages/gamma-knife/clinical-editor.test.tsx src/lib/unsaved-navigation-guard.test.ts src/pages/workstation/workstation-printing-page.test.tsx src/lib/module-access.test.ts
```

Each DB file was executed serially with `npm run test:db:one -- <file>` after the
preflight/start/check sequence. On this Windows host `db:test:required` returned
without executing tests because of its existing entry-point URL guard; its exit
code was not counted as test evidence. The actual focused commands ran migrations
and reported test totals:

| File | Passed |
| --- | ---: |
| `src/db/migrations/247_user_module_access.lifecycle.test.ts` | 1 |
| `src/db/migrations/248_gamma_knife_historical_references.lifecycle.test.ts` | 1 |
| `src/modules/module-access/module-access.integration.test.ts` | 16 |
| `src/modules/gamma-knife/historical-treatment.integration.test.ts` | 1 |
| `src/modules/gamma-knife/gamma-knife-account.integration.test.ts` | 2 |
| `src/modules/gamma-knife/gamma-knife.integration.test.ts` | 9 |
| `src/services/scan-session-service.test.ts` | 3 |
| `src/routes/scanner-bootstrap-routes.integration.test.ts` | 9 |
| `src/modules/medical-dictation/medical-dictation.integration.test.ts` | 7 |
| `src/modules/medgemma/medgemma.integration.test.ts` | 14 |
| `src/routes/passkeys.integration.test.ts` | 1 |
| `src/modules/doctor-portal/doctor-portal.integration.test.ts` | 28 |
| `src/modules/doctor-portal/reporting-board.integration.test.ts` | 111 |
| `src/modules/teaching/tests/teaching-routes.integration.test.ts` | 1 |
| `src/modules/ohif-viewer/ohif-schema.integration.test.ts` | 5 |

Browser commands used the installed repository Playwright/Chromium and the
disposable E2E database:

```text
npm run e2e:db:up
npm run e2e:db:reset
npx playwright test e2e/specs/module-access.spec.ts e2e/specs/workspace-switcher.spec.ts e2e/specs/gamma-knife.spec.ts e2e/specs/medical-dictation.spec.ts --reporter=line
npx playwright test e2e/specs/module-access.spec.ts --reporter=line
npm run e2e:db:down
```

The combined run passed all seven existing workflow journeys, but a new module
test hit a Windows file-overwrite error saving an already inspected screenshot;
its second serial test was therefore not run. Captures now use unique filenames.
The focused rerun passed both module journeys, including desktop/mobile Arabic,
module grants/defaults/audit, unauthorized direct URLs, workstation setup and a
real revocation retaining the mounted clinical draft. Reauthentication with the
reduced grants also retains the blocked draft until the user chooses to leave.

Synthetic screenshots and command logs are in `artifacts/module-access/`.

## Authorization evidence

The module suite starts `createApp()` and uses real login, cookies, middleware,
routers, services and the disposable database. It covers Gamma Knife-only,
Core-only, Doctor-only, Core + Gamma Knife, Doctor + Gamma Knife, Teaching-only,
all current modules and an unrestricted Super Admin. Additional checks cover:

- The future-module registry contract and no automatic grant to ordinary legacy users.
- Role/clinical restrictions surviving a module grant; self-grant and protected-account denials.
- Metadata/file/guessed-document denials, generic document isolation and independent QR token checks.
- Action PIN, dictation and narrowly shared scanner/printing endpoints.
- Last-module loss through grants, Gamma Knife capabilities or Doctor profile deactivation; explicit deactivation/repair/reactivation.
- Previously issued viewer cookies, launch tokens, contexts, native authorization and recovery after module loss; denials identify `MODULE_ACCESS_DENIED`.
- Scanner companion tokens after the requesting user loses Core access.
- Real migration conversion in an isolated schema, unchanged credentials/authentication versions and compatibility writes remaining restricted.
- Separate historical treatment references rejecting cross-patient/stale writes while leaving current MDT approval and one-active-episode rules intact.

## Failures investigated and corrected

The initial broad backend run found three pre-existing source-pattern assertions:
the discontinued-appointment history filter, moved roster transaction checks and
filtered document response mapping. Their sources were unchanged at the baseline.
Assertions now check the current safeguards; clinical behavior was not weakened.
The next batch exposed an outdated scanner readiness message assertion, now
checking both setup readiness and the required browser verification message.

Nine pre-existing unused declarations caused frontend lint errors. They were
removed after the user explicitly authorized fixing these failures. No UI or
clinical behavior was changed for those lint corrections.

Older Teaching/scanner fixtures assumed arbitrary JWT subjects or authoritative
JWT role claims. They now use persisted users and current database authority.
The Doctor profile regression now asserts that permission changes invalidate its
old cookie before testing the refreshed session. The Gamma Knife browser denial
asserts the unified redirect plus a backend 403 instead of the old inline message.

## Limits

Full frontend/DB suites, comprehensive GitHub CI, self-hosted CI, production rollout,
hospital-LAN Orthanc, physical printers/scanners and workstation GPU behavior were
not run. These local/synthetic results do not establish those outcomes. Native
delivery admission was exercised through the real route boundary; no live native
gateway image transfer was claimed. Already delivered bytes remain local, and the
browser policy display can lag a change by up to 30 seconds; backend admission is
checked on subsequent requests.
